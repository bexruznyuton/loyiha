/**
 * 24 soatlik release cron — buyer tasdiqlangandan keyin sotuvchining
 * wallet'iga pul tushishi shu vazifa orqali kechiktiriladi.
 *
 * Har daqiqada `releaseAt <= now` va `status === BUYER_VERIFIED` bo'lgan
 * order'larni topib, sotuvchi wallet'ini kreditlaydi va status'ni COMPLETED
 * ga o'tkazadi.
 */

import { prisma } from './prisma';
import { phpBot } from './php-bot-bridge';
import { getSellerBot } from '../bot';

const TICK_MS = 60 * 1000;
const fmtUZS = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);

async function releaseDueOrders(): Promise<void> {
  const now = new Date();
  const due = await prisma.order.findMany({
    where: {
      status: 'BUYER_VERIFIED',
      releaseAt: { not: null, lte: now },
    },
    include: { adAccount: { include: { owner: true } } },
    take: 50,
  });
  if (due.length === 0) return;

  for (const order of due) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id, status: 'BUYER_VERIFIED' },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await tx.orderEvent.create({
          data: { orderId: order.id, type: 'completed', actorId: null },
        }).catch(() => {});
        await tx.adAccount.update({
          where: { id: order.adAccountId },
          data: { completedOrders: { increment: 1 } },
        }).catch(() => {});
        // Buyer'ning muzlatilgan puli endi haqiqatan sarflandi — frozenBalance'dan
        // ayiriladi (ilgari bu qadam yo'q edi: pul order yaratilganda/qabul
        // qilinganda frozenBalance'ga qo'shilgandan keyin, shu yerda hech qachon
        // chiqarilmasdi — buyer hamyonida "muzlatilgan" summa abadiy osilib
        // qolardi, garchi pul allaqachon sotuvchiga o'tgan bo'lsa ham).
        await tx.wallet.updateMany({
          where: { userId: order.advertiserId },
          data: { frozenBalance: { decrement: order.price } },
        });
        // Seller wallet
        const sellerId = order.adAccount.ownerId;
        let wallet = await tx.wallet.findUnique({ where: { userId: sellerId } });
        if (!wallet) {
          wallet = await tx.wallet.create({
            data: { userId: sellerId, balance: 0, frozenBalance: 0, totalEarned: 0 },
          });
        }
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { increment: order.escrowAmount },
            totalEarned: { increment: order.escrowAmount },
          },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'ESCROW_RELEASE',
            amount: order.escrowAmount,
            status: 'COMPLETED',
            orderId: order.id,
            note: '24 soatlik release',
          },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'COMMISSION',
            amount: -order.commissionAmount,
            status: 'COMPLETED',
            orderId: order.id,
            note: `Platform ${order.commissionRate}%`,
          },
        });
      });

      // Sellerga xabar (best-effort)
      const sellerTgId = order.adAccount.owner?.telegramId
        ? Number(order.adAccount.owner.telegramId)
        : 0;
      if (sellerTgId) {
        const text =
          `💰 <b>Pul wallet'ingizga tushdi</b>\n\n` +
          `Order <code>#${order.id}</code>\n` +
          `📥 +${fmtUZS(order.escrowAmount)} so'm`;
        if (phpBot.isReady()) {
          await phpBot.sendMessage(sellerTgId, text).catch(() => {});
        } else {
          const b = getSellerBot();
          if (b) await b.sendMessage(sellerTgId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn(`[release-cron] order #${order.id} fail:`, e instanceof Error ? e.message : e);
    }
  }
}

let started = false;
export function startOrderReleaseCron(): void {
  if (started) return;
  started = true;
  console.log('🕐 Order release cron: har daqiqada releaseAt tekshiriladi');
  // Birinchi tick'ni kichik kechikish bilan ishga tushiramiz
  setTimeout(() => {
    releaseDueOrders().catch((e) => console.error('release-cron tick error:', e));
  }, 10_000);
  setInterval(() => {
    releaseDueOrders().catch((e) => console.error('release-cron tick error:', e));
  }, TICK_MS);
}
