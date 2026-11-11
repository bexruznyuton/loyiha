/**
 * Buyurtmani tizim tomonidan bekor qilish (xaridorga pul qaytariladi).
 *
 *  - seller_unreachable — sotuvchi Top_sxema botni bloklagan: unga hech qanday
 *    xabar yetmaydi, buyurtma hech qachon bajarilmaydi. Sotuvchining barcha
 *    akkauntlari marketplace'dan yashiriladi (SUSPENDED) va ochiq buyurtmalari
 *    bekor qilinadi.
 *  - seller_timeout — sotuvchi buyurtma so'roviga muddatida javob bermadi.
 *  - buyer_timeout — xaridor video havolasini muddatida yubormadi.
 *
 * Holat shart bilan (updateMany + eski status) almashtiriladi — bir buyurtma
 * ikki marta bekor qilinib, pul ikki marta qaytmaydi.
 */

import { prisma } from './prisma';
import { phpBot } from './php-bot-bridge';
import { SUPPORT_USERNAME } from './support';
import { getBot } from '../bot';

export type AutoCancelReason = 'seller_unreachable' | 'seller_timeout' | 'buyer_timeout';

const OPEN_STATUSES = ['AWAITING_SELLER_CONSENT', 'AWAITING_BUYER_MATERIAL'];
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((id) => parseInt(id.trim()))
  .filter((n) => !isNaN(n) && n > 0);

const fmtUZS = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const BUYER_REASON: Record<AutoCancelReason, (ig: string) => string> = {
  seller_unreachable: (ig) => `Sotuvchi (@${ig}) bilan bot orqali bog'lanib bo'lmayapti, shu sabab buyurtma bajarilmaydi.`,
  seller_timeout: (ig) => `Sotuvchi (@${ig}) buyurtmangizga 24 soat ichida javob bermadi.`,
  buyer_timeout: () => `Video havolasi belgilangan muddatda yuborilmadi.`,
};

export async function notifyAdmins(text: string): Promise<void> {
  const bot = getBot();
  if (!bot) return;
  for (const id of ADMIN_IDS) {
    await bot.sendMessage(id, text, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
  }
}

export async function autoCancelOrder(orderId: number, reason: AutoCancelReason): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } },
  });
  if (!order || !OPEN_STATUSES.includes(order.status)) return false;

  const refunded = await prisma.$transaction(async (tx) => {
    const flip = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: 'CANCELLED' },
    });
    if (flip.count !== 1) return null;
    // Aynan shu buyurtma uchun muzlatilgan (va hali qaytarilmagan) summa.
    const [held, back] = await Promise.all([
      tx.transaction.aggregate({ where: { orderId, type: 'ESCROW_HOLD', status: 'COMPLETED' }, _sum: { amount: true } }),
      tx.transaction.aggregate({ where: { orderId, type: 'ESCROW_REFUND', status: 'COMPLETED' }, _sum: { amount: true } }),
    ]);
    const refund = Math.max(0, -(held._sum.amount || 0) - (back._sum.amount || 0));
    if (refund > 0) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.advertiserId } });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: refund },
          depositBalance: { increment: refund }, // qaytgan pul yechib olinmaydi
          frozenBalance: { decrement: refund },
          totalSpent: { decrement: refund },
        },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'ESCROW_REFUND',
          amount: refund,
          status: 'COMPLETED',
          orderId,
          note: `Order #${orderId} — tizim bekor qildi (${reason}), pul qaytarildi`,
        },
      });
    }
    await tx.orderEvent.create({ data: { orderId, type: 'auto_cancelled', payload: { reason, refund } } });
    return refund;
  });
  if (refunded === null) return false;

  const ig = order.adAccount.igUsername;
  const buyerTg = Number(order.advertiser.telegramId || 0);
  if (buyerTg) {
    await phpBot.sendMessage(
      buyerTg,
      `❌ <b>Buyurtma bekor qilindi</b> (<code>#${orderId}</code>)\n\n` +
        `${BUYER_REASON[reason](esc(ig))}\n\n` +
        (refunded > 0 ? `💰 <b>${fmtUZS(refunded)} so'm</b> hamyoningizga qaytarildi.\n\n` : '') +
        `Savollar bo'lsa ${SUPPORT_USERNAME} ga yozing.`,
    ).catch(() => {});
  }
  const sellerTg = Number(order.adAccount.owner?.telegramId || 0);
  if (sellerTg && reason !== 'seller_unreachable') {
    await phpBot.sendMessage(
      sellerTg,
      reason === 'seller_timeout'
        ? `❌ <code>#${orderId}</code> buyurtmaga 24 soat ichida javob bermadingiz — buyurtma bekor qilindi.`
        : `ℹ️ Xaridor video havolasini yubormadi — <code>#${orderId}</code> buyurtma bekor qilindi.`,
    ).catch(() => {});
  }
  return true;
}

// Sotuvchi botni bloklagan: akkauntlari yashiriladi, ochiq buyurtmalari bekor
// qilinadi va pul xaridorlarga qaytadi. Qayta chaqirilsa zarari yo'q.
export async function handleSellerUnreachable(ownerUserId: number, description: string): Promise<void> {
  const accounts = await prisma.adAccount.findMany({
    where: { ownerId: ownerUserId },
    select: { id: true, igUsername: true, status: true },
  });
  if (accounts.length === 0) return;
  const suspended = await prisma.adAccount.updateMany({
    where: { ownerId: ownerUserId, status: 'ACTIVE' },
    data: { status: 'SUSPENDED' },
  });
  const openOrders = await prisma.order.findMany({
    where: { adAccountId: { in: accounts.map((a) => a.id) }, status: { in: OPEN_STATUSES as any } },
    select: { id: true, price: true },
    orderBy: { id: 'asc' },
  });
  const cancelled: number[] = [];
  let total = 0;
  for (const o of openOrders) {
    if (await autoCancelOrder(o.id, 'seller_unreachable')) {
      cancelled.push(o.id);
      total += o.price;
    }
  }
  if (suspended.count === 0 && cancelled.length === 0) return;
  const owner = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { telegramId: true, username: true } });
  await notifyAdmins(
    `🚫 <b>Sotuvchiga bot orqali yozib bo'lmaydi</b>\n\n` +
      `👤 ${owner?.username ? `@${esc(owner.username)} · ` : ''}<code>${owner?.telegramId ?? '—'}</code>\n` +
      `📸 ${accounts.map((a) => '@' + esc(a.igUsername)).join(', ')}\n` +
      `⚠️ Telegram: <i>${esc(description)}</i>\n\n` +
      `🙈 Marketplace'dan yashirildi: <b>${suspended.count}</b> ta akkaunt\n` +
      `❌ Bekor qilingan buyurtmalar: <b>${cancelled.length}</b> ta` +
      (cancelled.length ? ` (${cancelled.map((id) => '#' + id).join(', ')})` : '') +
      `\n💰 Xaridorlarga qaytarildi: <b>${fmtUZS(total)}</b> so'm`,
  );
}
