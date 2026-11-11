import { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { notifyAdmins } from '../../lib/notifications';
import { phpBot } from '../../lib/php-bot-bridge';
import { getBot, getAdminIds } from '../../bot';
import { checkoutCreatePayment, checkoutIsPaid } from '../../lib/checkout-uz';
import { createStarsInvoiceLink } from '../../lib/telegram-stars';

/**
 * GET /api/marketplace/wallet
 * Wallet ma'lumotlari + oxirgi 30 ta tranzaksiya
 */
export const handleGetWallet: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: pgUser.id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
      },
    });

    if (!wallet) {
      res.status(404).json({ success: false, error: 'Wallet topilmadi' });
      return;
    }

    res.json({
      success: true,
      wallet: {
        balance: wallet.balance,
        frozenBalance: wallet.frozenBalance,
        totalEarned: wallet.totalEarned,
        totalSpent: wallet.totalSpent,
        withdrawable: Math.max(0, wallet.balance - wallet.depositBalance),
      },
      payoutLimits: await (await import('../../lib/marketplace-config')).getPayoutLimits(),
      transactions: wallet.transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        status: t.status,
        orderId: t.orderId,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('handleGetWallet error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/wallet/topup
 * Foydalanuvchi summa kiritadi → Top_sxema bot orqali karta + summa + chekni
 * yuborish tugmasi keladi. Foydalanuvchi chek skrinshotini yuboradi (bot-forward
 * tomonida ushlaniladi), admin tasdiqlasa balansga qo'shiladi.
 */
export const handleCreateTopup: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }
    const schema = z.object({
      amount: z.number().int().min(1000, 'Minimal: 1 000 UZS').max(50_000_000, 'Juda katta summa'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }
    const { amount } = parsed.data;

    const card = process.env.ADMIN_PAYMENT_CARD || '9860 0101 0202 0303';
    const name = process.env.ADMIN_PAYMENT_NAME || 'INSTACAP ADMIN';
    const cardSnapshot = `${card} | ${name}`;

    const topup = await prisma.topup.create({
      data: { userId: pgUser.id, amount, status: 'PENDING' as any, cardSnapshot },
    });

    // Top_sxema bot orqali user'ga xabar — karta + summa + "to'lov qildim" tugma
    const buyerTgId = pgUser.telegramId ? Number(pgUser.telegramId) : 0;
    let userMsgId: number | null = null;
    if (buyerTgId) {
      const text =
        `💳 <b>Hisobni to'ldirish</b>\n\n` +
        `🆔 So'rov: <code>#${topup.id}</code>\n` +
        `💰 Summa: <code>${amount.toLocaleString('uz-UZ')}</code> so'm\n\n` +
        `<b>Karta:</b> <code>${card}</code>\n` +
        `<b>Egasi:</b> ${name}\n\n` +
        `Yuqoridagi kartaga aniq <b>${amount.toLocaleString('uz-UZ')}</b> so'm o'tkazing.\n` +
        `So'ng to'lov chekining <b>skrinshotini</b> shu chatga yuboring.\n\n` +
        `<i>Admin tasdiqlasa balansingizga qo'shiladi.</i>`;
      const kb = {
        inline_keyboard: [
          [{ text: '❌ Bekor qilish', callback_data: `mkt:topup:cancel:${topup.id}` }],
        ],
      };
      const r = await phpBot.sendMessage(buyerTgId, text, { replyMarkup: kb })
        .catch((e: any) => { console.warn('topup sendMessage:', e?.message || e); return null; });
      userMsgId = (r as any)?.result?.message_id ?? null;
      if (userMsgId) {
        await prisma.topup.update({ where: { id: topup.id }, data: { userTgMessageId: userMsgId } }).catch(() => {});
      }
    }

    res.status(201).json({
      success: true,
      topup: { id: topup.id, amount, cardSnapshot, status: 'PENDING' },
      message: 'Telegram botingizga qarang — karta va chek yuborish ko\'rsatmasi keldi.',
    });
  } catch (err) {
    console.error('handleCreateTopup error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

// checkout.uz orqali to'lov 10 daqiqa ichida kutiladi — Top_sxema bot (bot.php)
// dagi PAY_WINDOW bilan bir xil qiymat.
const CHECKOUT_PAY_WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/marketplace/wallet/topup/checkout
 * Hamyonni checkout.uz (Click/Payme) orqali AVTOMATIK to'ldirish — Top_sxema
 * bot (server/bot.php) allaqachon ishlatayotgan xuddi shu merchant hisobi
 * orqali (video-analiz limit sotib olishda ishlatiladi). To'lov qilingach
 * (Click/Payme havolasidan), balans avtomatik qo'shiladi — na admin, na
 * skrinshot kerak emas: fon jarayoni (startCheckoutUzTopupPoller) va/yoki
 * klient tomonidan chaqiriladigan /check endpointi kreditlaydi.
 */
export const handleCreateTopupCheckout: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }
    const schema = z.object({
      amount: z.number().int().min(1000, 'Minimal: 1 000 UZS').max(50_000_000, 'Juda katta summa'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }
    const { amount } = parsed.data;

    const payment = await checkoutCreatePayment(
      amount,
      `Hamyon to'ldirish — user #${pgUser.id} (${pgUser.firstName || ''})`,
    );
    if (!payment || Object.keys(payment.payVia).length === 0) {
      res.status(502).json({ success: false, error: 'To\'lov havolasi yaratilmadi. Birozdan so\'ng qayta urinib ko\'ring.' });
      return;
    }

    const topup = await prisma.topup.create({
      data: {
        userId: pgUser.id,
        amount,
        status: 'PENDING' as any,
        provider: 'CHECKOUT_UZ',
        providerPaymentId: payment.id,
        providerUuid: payment.uuid,
        payUrls: payment.payVia as any,
      },
    });

    res.status(201).json({
      success: true,
      topup: {
        id: topup.id,
        amount,
        status: 'PENDING',
        payUrls: payment.payVia,
      },
    });
  } catch (err) {
    console.error('handleCreateTopupCheckout error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * Bitta checkout.uz topup yozuvini atomik kreditlaydi (agar to'langan bo'lsa).
 * `updateMany` bilan status='PENDING' shartini ATOMIK band qilamiz — parallel
 * chaqiruvlar (klient "tekshirish" tugmasi + fon poller bir vaqtda) faqat
 * BITTASI balansni qo'shishini kafolatlaydi (bot.php'dagi flock() bilan bir
 * xil maqsad, Postgres darajasida).
 * Qaytaradi: 'credited' | 'already' | 'pending' | 'expired' | 'not_found'
 */
async function creditCheckoutTopupIfPaid(topupId: number): Promise<
  'credited' | 'already' | 'pending' | 'expired' | 'not_found'
> {
  const topup = await prisma.topup.findUnique({ where: { id: topupId } });
  if (!topup || topup.provider !== 'CHECKOUT_UZ') return 'not_found';
  if (topup.status === 'APPROVED') return 'already';
  if (topup.status !== 'PENDING') return 'expired';

  const paid = await checkoutIsPaid(topup.providerPaymentId, topup.providerUuid);
  if (!paid) {
    // Muddati o'tgan (10 daqiqa) va hali to'lanmagan — bekor qilamiz (bot.php
    // cron'idagi 'expired' bilan bir xil mantiq).
    const age = Date.now() - topup.createdAt.getTime();
    if (age > CHECKOUT_PAY_WINDOW_MS) {
      await prisma.topup.updateMany({
        where: { id: topupId, status: 'PENDING' },
        data: { status: 'CANCELLED', rejectReason: 'Muddati o\'tdi (checkout.uz, 10 daqiqa)', reviewedAt: new Date() },
      });
      return 'expired';
    }
    return 'pending';
  }

  // Atomik "band qilish" — faqat hali PENDING bo'lgan yozuvni ushlaymiz.
  const claimed = await prisma.topup.updateMany({
    where: { id: topupId, status: 'PENDING' },
    data: { status: 'APPROVED', reviewedAt: new Date() },
  });
  if (claimed.count === 0) return 'already'; // boshqa jarayon ulgurib kreditladi

  await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique({ where: { userId: topup.userId } });
    if (!wallet) wallet = await tx.wallet.create({ data: { userId: topup.userId } });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: topup.amount }, depositBalance: { increment: topup.amount }, totalEarned: { increment: topup.amount } },
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amount: topup.amount,
        status: 'COMPLETED',
        note: `Hamyon to'ldirish (checkout.uz) — topup #${topup.id}`,
        meta: { topupId: topup.id, provider: 'CHECKOUT_UZ' },
      },
    });
  });

  // Foydalanuvchiga xabar — best-effort (Top_sxema bot orqali).
  try {
    const user = await prisma.user.findUnique({ where: { id: topup.userId } });
    const buyerTgId = user?.telegramId ? Number(user.telegramId) : 0;
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `✅ <b>To'lov qabul qilindi!</b>\n\n💰 Hamyoningizga <b>+${topup.amount.toLocaleString('uz-UZ')}</b> so'm qo'shildi.`,
      ).catch(() => {});
    }
  } catch { /* jim — bildirishnoma best-effort */ }

  return 'credited';
}

/**
 * POST /api/marketplace/wallet/topup/checkout/:id/check
 * "To'lovni tekshirish" tugmasi — klient darhol natija ko'rishni xohlasa
 * (fon pollerini kutmasdan) shu endpointni chaqiradi.
 */
export const handleCheckTopupCheckout: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }
    const topupId = Number(req.params.id);
    if (!topupId) {
      res.status(400).json({ success: false, error: 'Noto\'g\'ri so\'rov' });
      return;
    }
    const topup = await prisma.topup.findUnique({ where: { id: topupId } });
    if (!topup || topup.userId !== pgUser.id) {
      res.status(404).json({ success: false, error: 'Topup topilmadi' });
      return;
    }

    const result = await creditCheckoutTopupIfPaid(topupId);
    const wallet = result === 'credited' || result === 'already'
      ? await prisma.wallet.findUnique({ where: { userId: pgUser.id } })
      : null;

    res.json({
      success: true,
      status: result,
      balance: wallet ? wallet.balance : undefined,
    });
  } catch (err) {
    console.error('handleCheckTopupCheckout error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

let _checkoutPollerStarted = false;
/**
 * Fon jarayoni — checkout.uz'da PENDING turgan barcha topup'larni davriy
 * tekshiradi (bot.php'dagi `?update=limitpay` cron'iga TENG, lekin bu yerda
 * tashqi cron kerak emas — Node jarayoni doim ishlab turgani uchun oddiy
 * setInterval yetarli). Foydalanuvchi "tekshirish" tugmasini bosmasa ham,
 * pul tushgani zahoti (keyingi tikda) balans avtomatik qo'shiladi.
 */
export function startCheckoutUzTopupPoller(): void {
  if (_checkoutPollerStarted) return;
  _checkoutPollerStarted = true;
  const tick = async () => {
    try {
      const pending = await prisma.topup.findMany({
        where: { provider: 'CHECKOUT_UZ', status: 'PENDING' as any },
        select: { id: true },
        take: 100,
      });
      for (const { id } of pending) {
        await creditCheckoutTopupIfPaid(id).catch((e) =>
          console.warn(`checkout.uz poller topup #${id}:`, e instanceof Error ? e.message : e),
        );
      }
    } catch (e) {
      console.warn('checkout.uz poller tick error:', e instanceof Error ? e.message : e);
    }
  };
  setInterval(tick, 20_000);
  tick();
}

// Stars → so'm kurs — web appda 100 Stars = 16 000 so'm (1 Star = 160 so'm)
// deb belgilangan (2026-09-04, foydalanuvchi so'rovi bo'yicha). Kerak bo'lsa
// .env orqali o'zgartirish mumkin (redeploy shart emas).
const STARS_TO_SOM_RATE = Number(process.env.STARS_TO_SOM_RATE) || 160;

async function getStarsToSomRate(): Promise<number> {
  try {
    const r = await prisma.setting.findUnique({ where: { key: 'stars_to_som_rate' } });
    const v = Number(r?.value);
    if (v > 0) return v;
  } catch {}
  return STARS_TO_SOM_RATE;
}

/**
 * POST /api/marketplace/wallet/topup/stars
 * Hamyonni Telegram Stars orqali to'ldirish. Foydalanuvchi Stars miqdorini
 * kiritadi → server invoice havolasi yaratadi (Top_sxema bot, @Top_sxema_instagrambot,
 * WEBAPP_BOT_TOKEN orqali to'g'ridan-to'g'ri) → klient shu havolani
 * `Telegram.WebApp.openInvoice()` bilan ochadi (Mini App ichida, chatga chiqmasdan).
 * To'lov muvaffaqiyatli bo'lsa, Telegram bot.php webhook'iga `successful_payment`
 * yuboradi — u "mktw:" payload'ni VPS'ga forward qiladi (bot-forward.ts),
 * shu yerda `creditStarsTopupIfPaid` orqali kreditlanadi.
 */
export const handleCreateTopupStars: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }
    const schema = z.object({
      stars: z.number().int().min(5, 'Minimal: 5 Stars').max(100_000, 'Juda katta summa'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }
    const { stars } = parsed.data;
    const amount = Math.round(stars * (await getStarsToSomRate()));

    const topup = await prisma.topup.create({
      data: {
        userId: pgUser.id,
        amount,
        status: 'PENDING' as any,
        provider: 'TELEGRAM_STARS',
      },
    });

    const payload = `mktw:${topup.id}:${pgUser.telegramId}:${Math.random().toString(16).slice(2, 10)}`;
    const invoiceLink = await createStarsInvoiceLink({
      title: "Hamyon to'ldirish",
      description: `${stars} ⭐ Stars — hamyoningizga ${amount.toLocaleString('uz-UZ')} so'm qo'shiladi`,
      payload,
      stars,
    });
    if (!invoiceLink) {
      await prisma.topup.update({ where: { id: topup.id }, data: { status: 'CANCELLED', rejectReason: 'Stars invoice yaratilmadi' } }).catch(() => {});
      res.status(502).json({ success: false, error: "To'lov havolasi yaratilmadi. Birozdan so'ng qayta urinib ko'ring." });
      return;
    }

    await prisma.topup.update({
      where: { id: topup.id },
      data: { payUrls: { invoiceLink, stars } as any },
    });

    res.status(201).json({
      success: true,
      topup: { id: topup.id, stars, amount, status: 'PENDING', invoiceLink },
    });
  } catch (err) {
    console.error('handleCreateTopupStars error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

// Stars invoice cheksiz ochiq turishi mumkin (Telegram tarafdan muddat yo'q),
// lekin UI'da abadiy "kutilmoqda" holatida qolib ketmasligi uchun checkout.uz
// bilan bir xil 10 daqiqalik oyna qo'llanadi — shundan keyin foydalanuvchi
// "qaytadan urinish" bilan yangi invoice so'raydi.
const STARS_PAY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Telegram'dan "mktw:<topupId>:<telegramId>:<rand>" payload'li successful_payment
 * kelganda chaqiriladi (bot-forward.ts). Atomik claim — checkout.uz bilan bir
 * xil `updateMany(status=PENDING)` naqshi, lekin bu yerda tashqi status-tekshirish
 * shart emas: `successful_payment` o'zi Telegram tomonidan TASDIQLANGAN to'lov
 * dalili (pul allaqachon yechilgan).
 */
export async function creditStarsTopupIfPaid(
  topupId: number,
  chargeId: string,
  starsAmount: number,
): Promise<'credited' | 'already' | 'not_found'> {
  const topup = await prisma.topup.findUnique({ where: { id: topupId } });
  if (!topup || topup.provider !== 'TELEGRAM_STARS') return 'not_found';
  if (topup.status !== 'PENDING') return 'already';

  const claimed = await prisma.topup.updateMany({
    where: { id: topupId, status: 'PENDING' },
    data: { status: 'APPROVED', reviewedAt: new Date(), providerPaymentId: chargeId },
  });
  if (claimed.count === 0) return 'already';

  await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique({ where: { userId: topup.userId } });
    if (!wallet) wallet = await tx.wallet.create({ data: { userId: topup.userId } });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: topup.amount }, depositBalance: { increment: topup.amount }, totalEarned: { increment: topup.amount } },
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amount: topup.amount,
        status: 'COMPLETED',
        note: `Hamyon to'ldirish (Telegram Stars, ${starsAmount} ⭐) — topup #${topup.id}`,
        meta: { topupId: topup.id, provider: 'TELEGRAM_STARS', chargeId, stars: starsAmount },
      },
    });
  });

  try {
    const user = await prisma.user.findUnique({ where: { id: topup.userId } });
    const buyerTgId = user?.telegramId ? Number(user.telegramId) : 0;
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `✅ <b>To'lov qabul qilindi!</b>\n\n⭐ ${starsAmount} Stars → 💰 Hamyoningizga <b>+${topup.amount.toLocaleString('uz-UZ')}</b> so'm qo'shildi.`,
      ).catch(() => {});
    }
  } catch { /* jim — bildirishnoma best-effort */ }

  return 'credited';
}

/**
 * POST /api/marketplace/wallet/topup/stars/:id/check
 * Klient `openInvoice()` callback'idan keyin darhol natija ko'rish uchun
 * chaqiradi (webhook forward biroz kech qolishi mumkin, 1-2 soniya).
 */
export const handleCheckTopupStars: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }
    const topupId = Number(req.params.id);
    if (!topupId) {
      res.status(400).json({ success: false, error: 'Noto\'g\'ri so\'rov' });
      return;
    }
    const topup = await prisma.topup.findUnique({ where: { id: topupId } });
    if (!topup || topup.userId !== pgUser.id || topup.provider !== 'TELEGRAM_STARS') {
      res.status(404).json({ success: false, error: 'Topup topilmadi' });
      return;
    }

    let status: 'credited' | 'pending' | 'expired' = 'pending';
    if (topup.status === 'APPROVED') {
      status = 'credited';
    } else if (topup.status === 'PENDING' && Date.now() - topup.createdAt.getTime() > STARS_PAY_WINDOW_MS) {
      await prisma.topup.updateMany({
        where: { id: topupId, status: 'PENDING' },
        data: { status: 'CANCELLED', rejectReason: 'Muddati o\'tdi (Stars, 10 daqiqa)', reviewedAt: new Date() },
      });
      status = 'expired';
    } else if (topup.status !== 'PENDING') {
      status = 'expired';
    }

    const wallet = status === 'credited'
      ? await prisma.wallet.findUnique({ where: { userId: pgUser.id } })
      : null;

    res.json({ success: true, status, balance: wallet ? wallet.balance : undefined });
  } catch (err) {
    console.error('handleCheckTopupStars error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/wallet/payout
 * Pul yechib olish so'rovi
 */
export const handleRequestPayout: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const schema = z.object({
      amount: z.number().int().positive('Summani kiriting'),
      cardNumber: z.string().min(16).max(20),
      cardHolder: z.string().min(2).max(100),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const { amount, cardNumber, cardHolder } = parsed.data;

    const wallet = await prisma.wallet.findUnique({ where: { userId: pgUser.id } });
    if (!wallet) {
      res.status(404).json({ success: false, error: 'Wallet topilmadi' });
      return;
    }

    const { getPayoutLimits } = await import('../../lib/marketplace-config');
    const limits = await getPayoutLimits();
    const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/,/g, ' ');
    if (amount < limits.min) {
      res.status(400).json({ success: false, error: `Minimal yechib olish miqdori ${fmt(limits.min)} so'm` });
      return;
    }
    if (limits.max > 0 && amount > limits.max) {
      res.status(400).json({ success: false, error: `Bir martada ko'pi bilan ${fmt(limits.max)} so'm yechib olish mumkin` });
      return;
    }
    // To'ldirilgan va qaytgan pul (depositBalance) yechib olinmaydi.
    const withdrawable = Math.max(0, wallet.balance - wallet.depositBalance);
    if (amount > withdrawable) {
      res.status(400).json({
        success: false,
        error: withdrawable > 0
          ? `Yechib olish mumkin bo'lgan summa: ${fmt(withdrawable)} so'm. To'ldirilgan pul faqat ilova ichida sarflanadi.`
          : "Yechib olish uchun ishlab topilgan pul yo'q. To'ldirilgan pul faqat ilova ichida sarflanadi.",
      });
      return;
    }

    const payout = await prisma.$transaction(async (tx) => {
      // Shartli yechish — parallel ikki so'rov bir pulni ikki marta yecholmaydi.
      const claimed = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount + wallet.depositBalance } },
        data: { balance: { decrement: amount }, frozenBalance: { increment: amount } },
      });
      if (claimed.count !== 1) throw new Error('INSUFFICIENT_WITHDRAWABLE');
      const newPayout = await tx.payout.create({
        data: {
          userId: pgUser.id,
          amount,
          cardNumber,
          cardHolder,
          status: 'PENDING',
        },
      });


      // PAYOUT tranzaksiya
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'PAYOUT',
          amount: -amount,
          status: 'PENDING',
          payoutId: newPayout.id,
          note: `Yechib olish so'rovi: ${cardNumber.slice(-4)} karta`,
        },
      });

      return newPayout;
    });

    // Tugmalar bilan — handlePayoutCallback (bot-marketplace.ts) shu
    // callback_data'ni allaqachon qabul qilib, wallet/payout holatini
    // to'g'ridan-to'g'ri yangilaydi (admin bosishi bilan yakunlanadi).
    await notifyAdmins(
      'PAYOUT_APPROVED',
      'Yangi payout so\'rovi',
      `Foydalanuvchi ${pgUser.firstName} — ${amount.toLocaleString()} UZS yechib olish so'radi. Karta: ${cardNumber}`,
      {
        payoutId: payout.id,
        userId: pgUser.id,
        inlineKeyboard: {
          inline_keyboard: [
            [
              { text: '✅ To\'lash', callback_data: `mkt:payout:${payout.id}:approve` },
              { text: '❌ Rad etish', callback_data: `mkt:payout:${payout.id}:reject` },
            ],
          ],
        },
      },
    );

    res.status(201).json({
      success: true,
      payout: {
        id: payout.id,
        amount: payout.amount,
        cardNumber: payout.cardNumber,
        cardHolder: payout.cardHolder,
        status: payout.status,
        requestedAt: payout.requestedAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INSUFFICIENT_WITHDRAWABLE') {
      res.status(400).json({ success: false, error: 'Balansingiz yetarli emas' });
      return;
    }
    console.error('handleRequestPayout error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};
