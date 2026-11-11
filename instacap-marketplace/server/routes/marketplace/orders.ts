import { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { MARKETPLACE_CONFIG, calcEscrow, calcEscrowAsync } from '../../lib/marketplace-config';
import { holdEscrow, releaseEscrow, refundEscrow } from '../../lib/escrow';
import { createNotification, notifyAdmins } from '../../lib/notifications';
import { getSellerBot } from '../../bot';
import { phpBot, telegramFailure, isUnreachable } from '../../lib/php-bot-bridge';
import { handleSellerUnreachable } from '../../lib/order-auto-cancel';
import { SUPPORT_USERNAME } from '../../lib/support';

const BUYER_TUTORIAL_VIDEO = 'BAACAgIAAxkDAAGdf5FqpXb2h_D0dVTl3X6cWjAxO4C2vwAC9qkAAtULKUmH8nT5EYnc9T0E';
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fmtUZS(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n);
}

/**
 * To'lov amalga oshirilganda sellerga 📸 tugmali "Skrinshot bilan tasdiqlash"
 * xabarini yuborish. Bu cycle'ning oldindan yetishmagan zvenosi — endi
 * mock-pay'dan keyin chaqiriladi.
 */
async function notifySellerOfPaidOrder(orderId: number): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: { include: { owner: true } }, advertiser: true },
    });
    if (!order || !order.adAccount?.owner) return;
    const sellerTgId = Number(order.adAccount.owner.telegramId);
    if (!sellerTgId) return;
    const buyerName = order.advertiser.username
      ? `@${order.advertiser.username}`
      : (order.advertiser.firstName || `id:${order.advertiser.id}`);
    const text =
      `💸 <b>Mijoz to'lov amalga oshirdi</b>\n\n` +
      `🛍 Buyurtmachi: ${buyerName}\n` +
      `🎯 Format: <b>${order.format}</b>\n` +
      `💰 Sizga: <code>${fmtUZS(order.escrowAmount)}</code> so'm (komissiyadan keyin)\n\n` +
      `<i>Postni Instagramda chiqarib, pastdagi tugma orqali skrinshot yuboring.</i>`;
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '📸 Skrinshot bilan tasdiqlash', callback_data: `mkt:post:upload:${order.id}` }],
      ],
    };
    if (phpBot.isReady()) {
      await phpBot.sendMessage(sellerTgId, text, { replyMarkup }).catch((e) =>
        console.warn('notifySellerOfPaidOrder php failed:', e instanceof Error ? e.message : e),
      );
    } else {
      const bot = getSellerBot();
      if (!bot) return;
      await bot.sendMessage(sellerTgId, text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }).catch((e) =>
        console.warn('notifySellerOfPaidOrder send failed:', e instanceof Error ? e.message : e),
      );
    }
  } catch (e) {
    console.warn('notifySellerOfPaidOrder error:', e instanceof Error ? e.message : e);
  }
}

/**
 * Yangi cycle: order yaratilganda sotuvchiga (@Top_sxema_instagrambot orqali)
 * "qabul qilamanmi" so'rovi — ✅ Qabul / ❌ Rad tugmalari bilan.
 */
export async function notifySellerOfConsentRequest(orderId: number): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: { include: { owner: true } }, advertiser: true },
    });
    if (!order || !order.adAccount?.owner) return;
    const sellerTgId = Number(order.adAccount.owner.telegramId);
    if (!sellerTgId) return;
    const buyerName = order.advertiser.username
      ? `@${order.advertiser.username}`
      : (order.advertiser.firstName || `id:${order.advertiser.id}`);
    const target = order.targetIgUsername
      ? `@${order.targetIgUsername.replace(/^@/, '')}`
      : '—';
    const text =
      `🆕 <b>Yangi buyurtma so'rovi</b>\n\n` +
      `🛍 Buyurtmachi: ${buyerName}\n` +
      `📲 Sizning akkauntingiz: <b>@${order.adAccount.igUsername}</b>\n` +
      `🎯 Mijoz <b>${target}</b> akkauntiga video ulashmoqchi\n` +
      `💰 Narx: <code>${fmtUZS(order.price)}</code> so'm\n` +
      `📥 Sizga (komissiyadan keyin): <code>${fmtUZS(order.escrowAmount)}</code> so'm\n\n` +
      `<i>Qabul qilsangiz — mijozdan to'lov so'raladi.</i>`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Qabul qilaman', callback_data: `mkt:seller:accept:${order.id}` },
          { text: '❌ Rad etish', callback_data: `mkt:seller:reject:${order.id}` },
        ],
      ],
    };
    if (phpBot.isReady()) {
      const res = await phpBot.sendMessage(sellerTgId, text, { replyMarkup }).catch((e) => {
        console.warn('notifySellerConsent php failed:', e instanceof Error ? e.message : e);
        return null;
      });
      // Sotuvchi botni bloklagan bo'lsa buyurtma hech qachon bajarilmaydi —
      // darhol bekor qilib, pulni xaridorga qaytaramiz.
      const failure = telegramFailure(res);
      if (isUnreachable(failure)) {
        console.warn(`notifySellerConsent #${orderId}: seller unreachable — ${failure!.description}`);
        await handleSellerUnreachable(order.adAccount.ownerId, failure!.description);
      }
    } else {
      const bot = getSellerBot();
      if (!bot) return;
      await bot.sendMessage(sellerTgId, text, { parse_mode: 'HTML', reply_markup: replyMarkup }).catch((e) =>
        console.warn('notifySellerConsent send failed:', e instanceof Error ? e.message : e),
      );
    }
  } catch (e) {
    console.warn('notifySellerOfConsentRequest error:', e instanceof Error ? e.message : e);
  }
}

/**
 * POST /api/marketplace/orders
 * Yangi buyurtma yaratish
 */
export const handleCreateOrder: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    // Yangi cycle: faqat REELS, material yo'q (admin tasdiqlagandan keyin video
    // ulash sotuvchi qo'lida), buyer "qaysi Instagram akkauntiga ulashmoqchi"
    // bo'lsa o'sha username ni kiritadi.
    const schema = z.object({
      adAccountId: z.number().int().positive(),
      targetIgUsername: z.string().trim().min(2).max(64),
      materialCaption: z.string().max(2200).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const { adAccountId, targetIgUsername, materialCaption } = parsed.data;
    const cleanTarget = targetIgUsername.replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9._]{2,64}$/.test(cleanTarget)) {
      res.status(400).json({ success: false, error: 'Instagram username noto\'g\'ri' });
      return;
    }

    const account = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
    if (!account) {
      res.status(404).json({ success: false, error: 'Akkaunt topilmadi' });
      return;
    }
    if (account.status !== 'ACTIVE') {
      res.status(400).json({ success: false, error: 'Bu akkaunt hozir buyurtma qabul qilmayapti' });
      return;
    }
    if (account.ownerId === pgUser.id) {
      res.status(400).json({ success: false, error: 'O\'z akkauntingizga buyurtma bera olmaysiz' });
      return;
    }

    const price = account.priceReels;
    if (!price || price === 0) {
      res.status(400).json({ success: false, error: 'Bu akkaunt uchun Reels narxi belgilanmagan' });
      return;
    }

    // Balans tekshiruvi — buyer'ning wallet'ida narx miqdoricha pul bo'lishi
    // shart. Yetishmasa, frontend topup modalini ko'rsatadi.
    const buyerWalletPre = await prisma.wallet.findUnique({ where: { userId: pgUser.id } });
    const preBalance = buyerWalletPre?.balance ?? 0;
    if (preBalance < price) {
      res.status(400).json({
        success: false,
        error: 'INSUFFICIENT_BALANCE',
        balance: preBalance,
        required: price,
        shortage: price - preBalance,
      });
      return;
    }

    // Foiz hozir DB Setting'dan o'qiladi (admin insy bot orqali o'zgartiradi).
    const { commissionRate, commissionAmount, escrowAmount } = await calcEscrowAsync(price);
    const guaranteedViews = account.guaranteedViews;

    // MUHIM: pul shu yerda, order yaratilishi bilan DARHOL muzlatiladi
    // (balance -= price, frozenBalance += price) — faqat TEKSHIRISH emas.
    // Ilgari bu yerda faqat balans tekshirilib, pul hech qayerda ushlanmasdi —
    // shu bo'shliq orqali bitta buyer bir xil balans bilan bir nechta
    // sotuvchiga PARALLEL so'rov yubora olardi (har biri alohida-alohida
    // tekshiruvdan "muvaffaqiyatli" o'tardi, chunki hech biri pulni hali
    // band qilmagan edi). Natijada ikkinchi/uchinchi so'rov sotuvchi tomonidan
    // qabul qilingandan KEYIN, "mijoz balansi yetarli emas" bilan kutilmaganda
    // bekor bo'lardi — bu "balansi yetmaydigan odam ham so'rov yubora oldi"
    // muammosining sababi edi (2026-09-19/20/22 order #57/#59/#63/#66/#75 shu
    // holatni tasdiqladi). `updateMany` + `balance: { gte: price }` sharti bilan
    // band qilish ATOMIK — parallel so'rovlarning faqat BITTASI pulni ushlab
    // qola oladi, qolganlari darhol INSUFFICIENT_BALANCE bilan rad etiladi
    // (endi so'rov umuman yaratilmaydi, keyinroq "sirli" bekor bo'lmaydi).
    const newOrder = await prisma.$transaction(async (tx) => {
      const claimed = await tx.wallet.updateMany({
        where: { userId: pgUser.id, balance: { gte: price } },
        data: {
          balance: { decrement: price },
          frozenBalance: { increment: price },
          totalSpent: { increment: price },
        },
      });
      if (claimed.count === 0) {
        throw new Error('INSUFFICIENT_BALANCE');
      }
      const buyerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: pgUser.id } });
      // Buyurtma avval yechib bo'lmaydigan (to'ldirilgan/qaytgan) puldan
      // to'lanadi — ishlab topilgan pul yechib olish uchun qoladi.
      if (buyerWallet.depositBalance > 0) {
        await tx.wallet.update({
          where: { id: buyerWallet.id },
          data: { depositBalance: Math.max(0, buyerWallet.depositBalance - price) },
        });
      }

      const order = await tx.order.create({
        data: {
          advertiserId: pgUser.id,
          adAccountId,
          format: 'REELS',
          price,
          commissionRate,
          commissionAmount,
          escrowAmount,
          materialType: 'VIDEO', // sotuvchi qo'lida (admin tasdiqlagandan keyin)
          materialFileId: '',
          materialCaption: materialCaption ?? '',
          targetIgUsername: cleanTarget,
          guaranteedViews,
          status: 'AWAITING_SELLER_CONSENT',
        },
      });
      await tx.transaction.create({
        data: {
          walletId: buyerWallet.id,
          type: 'ESCROW_HOLD',
          amount: -price,
          status: 'COMPLETED',
          orderId: order.id,
          note: `Order #${order.id} — so'rov yuborilganda pul muzlatildi`,
        },
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, actorId: pgUser.id, type: 'created' },
      });
      return order;
    }).catch((e) => {
      if (e instanceof Error && e.message === 'INSUFFICIENT_BALANCE') return null;
      throw e;
    });

    if (!newOrder) {
      res.status(400).json({
        success: false,
        error: 'INSUFFICIENT_BALANCE',
        message: 'Balansingiz boshqa so\'rov(lar) uchun band qilingan bo\'lishi mumkin',
      });
      return;
    }

    // Sotuvchiga "qabul qilamanmi" so'rovi (PHP bridge orqali)
    notifySellerOfConsentRequest(newOrder.id).catch(() => {});
    // Buyer'ga ham Top_sxema botda tasdiq: "@X ga @Y bilan so'rov yuborildi, kutib turing"
    notifyBuyerOfRequestSent(newOrder.id).catch(() => {});

    res.status(201).json({
      success: true,
      order: serializeOrder(newOrder),
    });
  } catch (err) {
    console.error('handleCreateOrder error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * Buyer order yaratganidan so'ng @Top_sxema_instagrambot orqali tasdiq xabari:
 * "@X akkauntiga @Y bilan so'rov yuborildi, kutib turing".
 */
export async function notifyBuyerOfRequestSent(orderId: number): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true, advertiser: true },
    });
    if (!order) return;
    const buyerTgId = Number(order.advertiser.telegramId);
    if (!buyerTgId) return;
    const target = order.targetIgUsername
      ? `@${order.targetIgUsername.replace(/^@/, '')}`
      : '—';
    const text =
      `📨 <b>So'rov yuborildi</b>\n\n` +
      `📲 Akkaunt: <b>@${order.adAccount.igUsername}</b>\n` +
      `🎯 Sizning akkauntingiz: <b>${target}</b>\n` +
      `💰 Narx: <code>${fmtUZS(order.price)}</code> so'm\n\n` +
      `<i>Sotuvchi javobini kutib turing. Qabul qilsa, to'lov ma'lumotlari shu chatga keladi.</i>`;
    if (phpBot.isReady()) {
      await phpBot.sendMessage(buyerTgId, text).catch((e) =>
        console.warn('notifyBuyerOfRequestSent php failed:', e instanceof Error ? e.message : e),
      );
    } else {
      const bot = getSellerBot();
      if (!bot) return;
      await bot.sendMessage(buyerTgId, text, { parse_mode: 'HTML' }).catch((e) =>
        console.warn('notifyBuyerOfRequestSent send failed:', e instanceof Error ? e.message : e),
      );
    }
  } catch (e) {
    console.warn('notifyBuyerOfRequestSent error:', e instanceof Error ? e.message : e);
  }
}

/**
 * Sotuvchi ✅ qabul qilgandan keyin buyer'ga karta + ism + summa + 📸 tugma
 * yuborish (@Top_sxema_instagrambot orqali). releaseHours muhim emas — pul
 * admin'ga keladi, keyin admin tasdiqlasa marketplace cycle davom etadi.
 */
export async function notifyBuyerForPayment(orderId: number): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: { include: { owner: true } }, advertiser: true },
    });
    if (!order) return;
    const buyerTgId = Number(order.advertiser.telegramId);
    if (!buyerTgId) return;
    const card = process.env.ADMIN_PAYMENT_CARD || '9860 0101 0202 0303';
    const name = process.env.ADMIN_PAYMENT_NAME || 'INSTACAP ADMIN';
    const cardSnapshot = `${card} | ${name}`;
    await prisma.order.update({
      where: { id: orderId },
      data: { paymentCardSnapshot: cardSnapshot },
    });
    const text =
      `✅ <b>Sotuvchi qabul qildi!</b>\n\n` +
      `📲 Akkaunt: <b>@${order.adAccount.igUsername}</b>\n` +
      `🎯 Sizning akkauntingiz: <b>@${order.targetIgUsername || '—'}</b>\n` +
      `💰 To'lov summasi: <code>${fmtUZS(order.price)}</code> so'm\n\n` +
      `💳 <b>Karta:</b> <code>${card}</code>\n` +
      `👤 <b>Egasi:</b> ${name}\n\n` +
      `<i>Yuqoridagi kartaga to'lov qiling va pastdagi tugma orqali to'lov chekining skrinshotini yuboring. Admin tasdiqlagach, sotuvchi videoni joylaydi.</i>`;
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '📸 To\'lov skrinshotini yuborish', callback_data: `mkt:buyer:pay:upload:${order.id}` }],
        [{ text: '❌ Bekor qilish', callback_data: `mkt:buyer:cancel:${order.id}` }],
      ],
    };
    if (phpBot.isReady()) {
      await phpBot.sendMessage(buyerTgId, text, { replyMarkup });
    } else {
      const bot = getSellerBot();
      if (!bot) return;
      await bot.sendMessage(buyerTgId, text, { parse_mode: 'HTML', reply_markup: replyMarkup });
    }
  } catch (e) {
    console.warn('notifyBuyerForPayment error:', e instanceof Error ? e.message : e);
  }
}

/**
 * Buyer to'lov skrinshoti yuborgach — admin'ga (insy bot orqali) tasdiqlash
 * uchun yuboriladi. Telegram-native bo'lgani uchun bu yerda emas, balki
 * bot-forward.ts'da photo handler ichida ishlatiladi.
 */

/**
 * Admin to'lovni tasdiqlagach buyer'ga "endi video yuboring" xabari.
 * Buyer @Top_sxema chatga video/photo/animation/document yuboradi —
 * u sellerga forward bo'ladi (bot-forward.ts ichida).
 */
export async function notifyBuyerForMaterial(orderId: number): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { advertiser: true, adAccount: { include: { owner: true } } },
    });
    if (!order) return;
    const buyerTgId = Number(order.advertiser.telegramId);
    const sellerTgId = Number(order.adAccount.owner?.telegramId || 0);
    const sellerIg = escapeHtml(order.adAccount.igUsername);
    const targetIg = escapeHtml(order.targetIgUsername || '—');

    // Yangi oqim (mijoz talabi, 2026-10-03): xaridor faqat videoni joylab,
    // sotuvchini collab'ga qo'shadi. Havolani SOTUVCHI yuboradi, xaridor
    // oxirida faqat tasdiqlaydi. Avval xaridordan havola so'ralar edi —
    // 17 ta to'langan buyurtmaning birortasi ham shu qadamdan o'tmagan.
    //
    // Qo'llanma video va ko'rsatma BITTA xabarda (video + caption): alohida
    // yuborilganda xaridorlar matnni o'qib, videoni o'tkazib yuborishardi.
    if (buyerTgId) {
      const caption =
        `✅ <b>To'lovingiz tasdiqlandi!</b>\n\n` +
        `👉 <b>Endi navbat sizda</b> — sotuvchi videoni joylashingizni kutyapti.\n\n` +
        `Avval shu videoni ko'ring, keyin xuddi shunday qiling:\n\n` +
        `1️⃣ Reklama videongizni o'z Instagramingizga (<b>@${targetIg}</b>) Reels qilib joylang\n` +
        `2️⃣ Joylayotganda <b>«Пригласить соавторов» (Collab)</b> bo'limiga <b>@${sellerIg}</b> ni qo'shing\n` +
        `3️⃣ Joylangan videoning havolasini <b>shu chatga yuboring</b>\n\n` +
        `Keyin sotuvchi collab'ni qabul qiladi, sizdan esa faqat tasdiq so'raymiz.\n\n` +
        `Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`;
      // file_id https://t.me/kodlarphp/450 dan olib, Telegram'ga qayta
      // yuklangan (2026-09-12) — kanalga bog'liqlik yo'q.
      const res: any = await phpBot
        .sendVideo(buyerTgId, BUYER_TUTORIAL_VIDEO, { caption })
        .catch(() => null);
      // Video yetib bormasa ham ko'rsatma albatta yetsin.
      if (!res?.result?.ok) await phpBot.sendMessage(buyerTgId, caption).catch(() => {});
    }

    if (sellerTgId) {
      await phpBot.sendMessage(sellerTgId,
        `💳 <b>Buyurtma to'landi</b> (<code>#${order.id}</code>)\n\n` +
        `📲 Akkauntingiz: <b>@${sellerIg}</b>\n` +
        `🎯 Xaridor akkaunti: <b>@${targetIg}</b>\n` +
        `💰 Sizga (komissiyadan keyin): <b>${new Intl.NumberFormat('uz-UZ').format(order.escrowAmount)}</b> so'm\n\n` +
        `⏳ <b>Hozircha siz kutasiz.</b> Xaridor videoni o'z Instagramiga joylab, sizni collab'ga taklif qiladi va havolasini shu botga yuboradi — havola kelishi bilan sizga xabar beramiz.\n\n` +
        `Taklif kelgach:\n` +
        `1️⃣ Instagram bildirishnomalaridan collab taklifini <b>qabul qiling</b>\n` +
        `2️⃣ Video havolasini <b>shu chatga yuboring</b>\n\n` +
        `Xaridor tasdiqlagach pul hisobingizga o'tadi.\n\n` +
        `Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`,
      ).catch(() => {});
    }
  } catch (e) {
    console.warn('notifyBuyerForMaterial error:', e instanceof Error ? e.message : e);
  }
}

/**
 * @deprecated Admin to'lovni tasdiqlagach: buyer'ga "tasdiqlandi" xabari va sellerga
 * "endi video joylab skrinshot bilan tasdiqlang" xabari + 📸 tugma.
 *
 * Hozir bu funksiya buyer material yuborgandan keyin chaqiriladi
 * (bot-forward.ts da). Buyer'ga xabar yuborish o'rniga faqat sellerga
 * video forward qilamiz.
 */
export async function notifyParticipantsOfPaymentApproved(orderId: number): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: { include: { owner: true } }, advertiser: true },
    });
    if (!order) return;
    const sellerTgId = Number(order.adAccount.owner.telegramId);
    const buyerTgId = Number(order.advertiser.telegramId);

    if (buyerTgId) {
      const text =
        `✅ <b>To'lovingiz tasdiqlandi!</b>\n\n` +
        `📲 Akkaunt: <b>@${order.adAccount.igUsername}</b>\n` +
        `🎯 Maqsad: <b>@${order.targetIgUsername || '—'}</b>\n\n` +
        `<i>Endi sotuvchi videoni joylab, joylanganlik skrinshotini yuboradi. Sizga xabar boradi.</i>`;
      if (phpBot.isReady()) {
        await phpBot.sendMessage(buyerTgId, text).catch(() => {});
      } else {
        const b = getSellerBot();
        if (b) await b.sendMessage(buyerTgId, text, { parse_mode: 'HTML' }).catch(() => {});
      }
    }

    if (sellerTgId) {
      const sellerText =
        `💸 <b>Mijoz to'lov amalga oshirdi</b>\n\n` +
        `📲 Akkauntingiz: <b>@${order.adAccount.igUsername}</b>\n` +
        `🎯 Mijoz akkaunti: <b>@${order.targetIgUsername || '—'}</b>\n` +
        `💰 Sizga (komissiyadan keyin): <code>${fmtUZS(order.escrowAmount)}</code> so'm\n\n` +
        `<i>Postni Instagramda joylang va pastdagi tugma orqali joylanganlik skrinshotini yuboring.</i>`;
      const replyMarkup = {
        inline_keyboard: [
          [{ text: '📸 Joylanganlik skrinshoti', callback_data: `mkt:post:upload:${order.id}` }],
        ],
      };
      if (phpBot.isReady()) {
        await phpBot.sendMessage(sellerTgId, sellerText, { replyMarkup }).catch(() => {});
      } else {
        const b = getSellerBot();
        if (b) await b.sendMessage(sellerTgId, sellerText, { parse_mode: 'HTML', reply_markup: replyMarkup }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('notifyParticipantsOfPaymentApproved error:', e instanceof Error ? e.message : e);
  }
}

/**
 * POST /api/marketplace/orders/:id/mock-pay — eski avto-to'lov endpointi.
 * Yangi cycle haqiqiy karta to'lovini ishlatadi (admin tasdiqlaydi), shu sababli
 * bu endpoint endi 410 GONE qaytaradi.
 */
export const handleMockPayOrder: RequestHandler = async (_req, res) => {
  res.status(410).json({
    success: false,
    error: 'Avto-to\'lov o\'chirilgan. To\'lov endi karta orqali amalga oshiriladi (admin tasdiqlaydi).',
  });
};

/**
 * POST /api/marketplace/orders/:id/accept
 * Akkaunt egasi buyurtmani qabul qiladi
 */
export const handleAcceptOrder: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const orderId = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true },
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
      return;
    }
    if (order.adAccount.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: 'Faqat akkaunt egasi qabul qila oladi' });
      return;
    }
    if (order.status !== 'PAID') {
      res.status(400).json({ success: false, error: 'Buyurtma to\'langan holatda emas' });
      return;
    }

    const deadlinePostBy = new Date(
      Date.now() + MARKETPLACE_CONFIG.deadlinePostHours * 60 * 60 * 1000,
    );

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), deadlinePostBy },
    });

    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: 'accepted' },
    });

    await createNotification(
      order.advertiserId,
      'ORDER_ACCEPTED',
      'Buyurtmangiz qabul qilindi',
      `${order.format} formati uchun buyurtmangiz akkaunt egasi tomonidan qabul qilindi.`,
      { orderId },
    );

    res.json({ success: true, order: serializeOrder(updated) });
  } catch (err) {
    console.error('handleAcceptOrder error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/orders/:id/posted
 * Akkaunt egasi postni e'lon qilganini bildiradi
 */
export const handleMarkPosted: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const orderId = Number(req.params.id);
    const schema = z.object({ proofFileId: z.string().optional() });
    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Validatsiya xatosi' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true },
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
      return;
    }
    if (order.adAccount.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: 'Faqat akkaunt egasi belgilashi mumkin' });
      return;
    }
    if (order.status !== 'ACCEPTED') {
      res.status(400).json({ success: false, error: 'Buyurtma qabul qilingan holatda emas' });
      return;
    }

    const deadlineKeepUntil = new Date(
      Date.now() + MARKETPLACE_CONFIG.deadlineKeepHours * 60 * 60 * 1000,
    );

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'POSTED',
        postedAt: new Date(),
        deadlineKeepUntil,
        ...(parsed.data.proofFileId && { guaranteeProof: parsed.data.proofFileId }),
      },
    });

    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: 'posted', payload: { proofFileId: parsed.data.proofFileId } },
    });

    await createNotification(
      order.advertiserId,
      'ORDER_POSTED',
      'Post e\'lon qilindi',
      `Sizning videongiz ulandi. Iltimos ${MARKETPLACE_CONFIG.deadlineKeepHours} soat ichida tasdiqlang.`,
      { orderId },
    );

    res.json({ success: true, order: serializeOrder(updated) });
  } catch (err) {
    console.error('handleMarkPosted error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/orders/:id/complete
 * Advertiser buyurtmani yakunlaydi, escrow ozod qilinadi
 */
export const handleCompleteOrder: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const orderId = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true },
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
      return;
    }
    if (order.advertiserId !== pgUser.id) {
      res.status(403).json({ success: false, error: 'Faqat buyurtmachi yakunlay oladi' });
      return;
    }
    if (order.status !== 'POSTED') {
      res.status(400).json({ success: false, error: 'Buyurtma post qilingan holatda emas' });
      return;
    }

    await releaseEscrow(orderId);

    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: 'completed' },
    });

    // completedOrders va successRate yangilash
    const totalOrders = await prisma.order.count({
      where: { adAccountId: order.adAccountId, status: { in: ['COMPLETED', 'DISPUTED', 'REFUNDED'] } },
    });
    const completedOrders = await prisma.order.count({
      where: { adAccountId: order.adAccountId, status: 'COMPLETED' },
    });
    const successRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 100;

    await prisma.adAccount.update({
      where: { id: order.adAccountId },
      data: { completedOrders, successRate },
    });

    await createNotification(
      order.adAccount.ownerId,
      'ORDER_COMPLETED',
      'Buyurtma yakunlandi',
      `Buyurtma muvaffaqiyatli yakunlandi. ${order.escrowAmount.toLocaleString()} UZS walletingizga o\'tkazildi.`,
      { orderId },
    );

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    res.json({ success: true, order: serializeOrder(updated) });
  } catch (err) {
    console.error('handleCompleteOrder error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/orders/:id/dispute
 * Shikoyat ochish
 */
export const handleDisputeOrder: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const orderId = Number(req.params.id);
    const schema = z.object({
      reason: z.string().min(10).max(1000),
      evidence: z.array(z.string()).max(5),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true },
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
      return;
    }

    const isAdvertiser = order.advertiserId === pgUser.id;
    const isOwner = order.adAccount.ownerId === pgUser.id;

    if (!isAdvertiser && !isOwner) {
      res.status(403).json({ success: false, error: 'Siz bu buyurtmaga aloqador emassiz' });
      return;
    }
    if (!['PAID', 'ACCEPTED', 'POSTED'].includes(order.status)) {
      res.status(400).json({ success: false, error: 'Bu holatda shikoyat ochib bo\'lmaydi' });
      return;
    }

    const dispute = await prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          orderId,
          openedBy: pgUser.id,
          reason: parsed.data.reason,
          evidence: parsed.data.evidence,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'DISPUTED' },
      });

      await tx.orderEvent.create({
        data: { orderId, actorId: pgUser.id, type: 'disputed', payload: { reason: parsed.data.reason } },
      });

      return created;
    });

    // Adminga hal qilish tugmalari bilan yuboriladi — handleDisputeCallback
    // (bot-marketplace.ts) shu callback_data'larni allaqachon qabul qiladi.
    await notifyAdmins(
      'ORDER_DISPUTED',
      'Yangi shikoyat',
      `Buyurtma #${orderId} bo'yicha shikoyat ochildi. Sabab: ${parsed.data.reason}`,
      {
        orderId,
        inlineKeyboard: {
          inline_keyboard: [
            [
              { text: '✅ Mijoz foydasiga', callback_data: `mkt:dispute:${dispute.id}:resolve_adv` },
              { text: '✅ Egasi foydasiga', callback_data: `mkt:dispute:${dispute.id}:resolve_own` },
            ],
            [{ text: '⚖️ 50/50 bo\'lish', callback_data: `mkt:dispute:${dispute.id}:partial` }],
          ],
        },
      },
    );

    res.json({ success: true, message: 'Shikoyat muvaffaqiyatli yuborildi' });
  } catch (err) {
    console.error('handleDisputeOrder error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/orders/:id/cancel
 * Buyurtmani bekor qilish (faqat PENDING_PAYMENT yoki PAID holatda)
 */
export const handleCancelOrder: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const orderId = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true },
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
      return;
    }
    if (order.advertiserId !== pgUser.id) {
      res.status(403).json({ success: false, error: 'Faqat buyurtmachi bekor qila oladi' });
      return;
    }
    if (!['PENDING_PAYMENT', 'PAID'].includes(order.status)) {
      res.status(400).json({ success: false, error: 'Bu holatda buyurtmani bekor qilib bo\'lmaydi' });
      return;
    }

    // Escrowni qaytarish (PAID holatda)
    if (order.status === 'PAID') {
      await refundEscrow(orderId);
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: 'cancelled' },
    });

    await createNotification(
      order.adAccount.ownerId,
      'ORDER_CANCELLED',
      'Buyurtma bekor qilindi',
      `Buyurtma #${orderId} advertiser tomonidan bekor qilindi.`,
      { orderId },
    );

    res.json({ success: true, message: 'Buyurtma bekor qilindi' });
  } catch (err) {
    console.error('handleCancelOrder error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * GET /api/marketplace/orders/my?role=buyer|owner&status=
 * Mening buyurtmalarim
 */
export const handleListMyOrders: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const { role = 'buyer', status } = req.query as Record<string, string>;

    let where: any = {};

    if (role === 'owner') {
      // Foydalanuvchi egasi bo'lgan akkauntlar orqali buyurtmalar
      const myAccounts = await prisma.adAccount.findMany({
        where: { ownerId: pgUser.id },
        select: { id: true },
      });
      const accountIds = myAccounts.map((a) => a.id);
      where.adAccountId = { in: accountIds };
    } else {
      where.advertiserId = pgUser.id;
    }

    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { adAccount: true },
    });

    res.json({ success: true, orders: orders.map(serializeOrderWithAccount) });
  } catch (err) {
    console.error('handleListMyOrders error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

// JSON serializatsiya yordamchilari
function serializeOrder(order: any) {
  return {
    id: order.id,
    advertiserId: order.advertiserId,
    adAccountId: order.adAccountId,
    format: order.format,
    price: order.price,
    commissionAmount: order.commissionAmount,
    escrowAmount: order.escrowAmount,
    materialType: order.materialType,
    materialFileId: order.materialFileId,
    materialCaption: order.materialCaption,
    guaranteedViews: order.guaranteedViews,
    achievedViews: order.achievedViews,
    status: order.status,
    acceptedAt: order.acceptedAt?.toISOString() ?? null,
    postedAt: order.postedAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    deadlinePostBy: order.deadlinePostBy?.toISOString() ?? null,
    deadlineKeepUntil: order.deadlineKeepUntil?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

function serializeOrderWithAccount(order: any) {
  const base = serializeOrder(order);
  if (!order.adAccount) return base;
  return {
    ...base,
    adAccount: {
      id: order.adAccount.id,
      igUsername: order.adAccount.igUsername,
      niche: order.adAccount.niche,
      region: order.adAccount.region,
      priceStory: order.adAccount.priceStory,
      priceReels: order.adAccount.priceReels,
      priceFeed: order.adAccount.priceFeed,
      isVerified: order.adAccount.isVerified,
      rating: order.adAccount.rating,
    },
  };
}
