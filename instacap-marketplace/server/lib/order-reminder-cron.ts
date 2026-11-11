/**
 * Havola kutayotgan buyurtmalar uchun eslatmalar (har daqiqada tekshiriladi).
 *
 * 1-bosqich — xaridor hali video havolasini yubormagan: xaridorga 3, 30, 60
 *   daqiqada eslatma; 60-daqiqadagisida "Bekor qilish" tugmasi.
 * 2-bosqich — xaridor havolani yubordi, sotuvchi hali collab'ni qabul qilib
 *   havolani yubormagan: sotuvchiga 3, 30, 60 daqiqada eslatma; 60-daqiqada
 *   xaridorga kutish yoki bekor qilish taklifi.
 *
 * Har yuborilgan eslatma orderEvent sifatida OLDINDAN yoziladi — server qayta
 * ishga tushsa ham takrorlanmaydi. Faqat eng oxirgi muddati kelgan eslatma
 * yuboriladi (o'tkazib yuborilganlari ketma-ket yog'ilmaydi). 3 soatdan eski
 * buyurtmalarga tegilmaydi.
 *
 * Muddatlar (runDeadlines) — javobsiz buyurtma abadiy qotib, pul muzlab
 * qolmasligi uchun:
 *  - sotuvchi so'rovga 24 soatda javob bermasa — bekor, pul qaytadi
 *    (12 soatda ogohlantirish);
 *  - xaridor havolani 48 soatda yubormasa — bekor, pul qaytadi
 *    (24 soatda ogohlantirish).
 * Bekor qilishdan oldin ogohlantirish albatta yuboriladi va undan keyin
 * kamida yana yarim muddat kutiladi — muddat o'tib ketgan eski buyurtmalar
 * ham birdaniga emas, ogohlantirishdan keyin yopiladi.
 */

import { prisma } from './prisma';
import { phpBot } from './php-bot-bridge';
import { SUPPORT_USERNAME } from './support';
import { telegramFailure, isUnreachable } from './php-bot-bridge';
import { autoCancelOrder, handleSellerUnreachable } from './order-auto-cancel';

const TICK_MS = 60 * 1000;
const STEPS = [3, 30, 60]; // daqiqa
const STALE_MS = 3 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const SELLER_CONSENT_LIMIT_MS = 24 * HOUR;
const BUYER_LINK_LIMIT_MS = 48 * HOUR;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cancelButton = (orderId: number) => ({
  inline_keyboard: [[{ text: '❌ Buyurtmani bekor qilish', callback_data: `mkt:buyer:cancel:${orderId}` }]],
});

function buyerReminder(step: number, o: any): { text: string; replyMarkup?: any } {
  const seller = esc(o.adAccount.igUsername);
  const me = esc(o.targetIgUsername || '—');
  const how =
    `1️⃣ Videoni o'z Instagramingizga (<b>@${me}</b>) Reels qilib joylang\n` +
    `2️⃣ «Пригласить соавторов» (Collab) bo'limiga <b>@${seller}</b> ni qo'shing\n` +
    `3️⃣ Havolasini <b>shu chatga yuboring</b>`;
  if (step === 3) {
    return { text: `⏰ <b>Eslatma</b> (<code>#${o.id}</code>)\n\nSotuvchi sizni kutyapti. Videoni joylashni unutmang:\n\n${how}` };
  }
  if (step === 30) {
    return { text: `⏰ <b>Video hali joylanmadi</b> (<code>#${o.id}</code>)\n\nPulingiz muzlab turibdi, sotuvchi esa sizni kutyapti. Iltimos, videoni joylab, havolasini yuboring:\n\n${how}\n\nQiyinchilik bo'lsa ${SUPPORT_USERNAME} ga yozing.` };
  }
  return {
    text:
      `⏰ <b>Oxirgi eslatma</b> (<code>#${o.id}</code>)\n\n` +
      `Bir soatdan beri video joylanmadi. Hali ham qilmoqchi bo'lsangiz — videoni joylab, havolasini shu chatga yuboring.\n\n` +
      `Fikringizdan qaytgan bo'lsangiz, buyurtmani bekor qiling — <b>pulingiz to'liq hamyoningizga qaytadi.</b>`,
    replyMarkup: cancelButton(o.id),
  };
}

function sellerReminder(step: number, o: any, url: string): string {
  const head = step === 60 ? `⏰ <b>Xaridor bir soatdan beri kutyapti</b>` : `⏰ <b>Eslatma</b>`;
  return (
    `${head} (<code>#${o.id}</code>)\n\n` +
    `Xaridor videoni joylab, havolasini yubordi:\n🔗 ${esc(url)}\n\n` +
    `1️⃣ Instagram bildirishnomalaridan collab taklifini qabul qiling\n` +
    `2️⃣ Havolani <b>shu chatga yuboring</b>\n\n` +
    `Shundan keyin xaridor tasdiqlaydi va pul hisobingizga o'tadi.`
  );
}

async function claim(orderId: number, type: string): Promise<boolean> {
  // Avval yozamiz, keyin yuboramiz: yozish muvaffaqiyatli bo'lsa — bu eslatma
  // hali yuborilmagan va endi boshqa hech kim uni yubormaydi.
  const exists = await prisma.orderEvent.findFirst({ where: { orderId, type }, select: { id: true } });
  if (exists) return false;
  await prisma.orderEvent.create({ data: { orderId, type } });
  return true;
}

async function runTick(): Promise<void> {
  const now = Date.now();
  const orders = await prisma.order.findMany({
    where: { status: 'AWAITING_BUYER_MATERIAL' as any, acceptedAt: { gte: new Date(now - STALE_MS - 60 * 60 * 1000) } },
    include: {
      advertiser: { select: { telegramId: true } },
      adAccount: { select: { igUsername: true, ownerId: true, owner: { select: { telegramId: true } } } },
      events: { where: { type: { in: ['buyer_link_relayed'] } }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  });

  for (const o of orders) {
    try {
      const relayed = o.events[0];
      const base = (relayed ? relayed.createdAt : o.acceptedAt)?.getTime();
      if (!base || now - base > STALE_MS) continue;
      const elapsedMin = (now - base) / 60000;
      const step = [...STEPS].reverse().find((s) => elapsedMin >= s);
      if (!step) continue;

      const buyerTg = Number(o.advertiser.telegramId || 0);
      const sellerTg = Number(o.adAccount.owner?.telegramId || 0);

      if (!relayed) {
        if (!buyerTg || !(await claim(o.id, `reminder_buyer_${step}`))) continue;
        const r = buyerReminder(step, o);
        await phpBot.sendMessage(buyerTg, r.text, r.replyMarkup ? { replyMarkup: r.replyMarkup } : undefined).catch(() => {});
      } else {
        if (!sellerTg || !(await claim(o.id, `reminder_seller_${step}`))) continue;
        const url = String((relayed.payload as any)?.url || '');
        const res = await phpBot.sendMessage(sellerTg, sellerReminder(step, o, url)).catch(() => null);
        const failure = telegramFailure(res);
        if (isUnreachable(failure)) {
          await handleSellerUnreachable(o.adAccount.ownerId, failure!.description);
          continue;
        }
        if (step === 60 && buyerTg) {
          await phpBot.sendMessage(
            buyerTg,
            `⏳ <b>Sotuvchi hali javob bermadi</b> (<code>#${o.id}</code>)\n\n` +
              `Unga yana eslatdik. Biroz kutishingiz yoki buyurtmani bekor qilishingiz mumkin — <b>pulingiz to'liq qaytadi.</b>\n\n` +
              `Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`,
            { replyMarkup: cancelButton(o.id) },
          ).catch(() => {});
        }
      }
    } catch (e) {
      console.warn(`[order-reminder] #${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
}

// Ogohlantirish (bir marta) va muddat tugagach bekor qilish.
async function runDeadlines(): Promise<void> {
  const now = Date.now();

  const consent = await prisma.order.findMany({
    where: { status: 'AWAITING_SELLER_CONSENT' as any, createdAt: { lte: new Date(now - SELLER_CONSENT_LIMIT_MS / 2) } },
    include: {
      adAccount: { select: { igUsername: true, ownerId: true, owner: { select: { telegramId: true } } } },
      events: { where: { type: 'deadline_seller_warned' }, take: 1 },
    },
  });
  for (const o of consent) {
    try {
      const warned = o.events[0];
      if (!warned) {
        if (!(await claim(o.id, 'deadline_seller_warned'))) continue;
        const sellerTg = Number(o.adAccount.owner?.telegramId || 0);
        if (!sellerTg) continue;
        const res = await phpBot.sendMessage(
          sellerTg,
          `⏰ <b>Buyurtma javob kutmoqda</b> (<code>#${o.id}</code>)\n\n` +
            `@${esc(o.adAccount.igUsername)} akkauntingizga buyurtma kelgan, lekin hali javob bermadingiz.\n\n` +
            `Yuqoridagi so'rovda <b>✅ Qabul qilaman</b> yoki <b>❌ Rad etish</b> tugmasini bosing. ` +
            `<b>12 soat</b> ichida javob bo'lmasa, buyurtma avtomatik bekor qilinadi.`,
        ).catch(() => null);
        const failure = telegramFailure(res);
        if (isUnreachable(failure)) await handleSellerUnreachable(o.adAccount.ownerId, failure!.description);
        continue;
      }
      const deadline = Math.max(o.createdAt.getTime() + SELLER_CONSENT_LIMIT_MS, warned.createdAt.getTime() + SELLER_CONSENT_LIMIT_MS / 2);
      if (now >= deadline) await autoCancelOrder(o.id, 'seller_timeout');
    } catch (e) {
      console.warn(`[order-deadline] consent #${o.id}:`, e instanceof Error ? e.message : e);
    }
  }

  const material = await prisma.order.findMany({
    where: { status: 'AWAITING_BUYER_MATERIAL' as any, acceptedAt: { lte: new Date(now - BUYER_LINK_LIMIT_MS / 2) } },
    include: {
      advertiser: { select: { telegramId: true } },
      adAccount: { select: { igUsername: true } },
      events: { where: { type: { in: ['deadline_buyer_warned', 'buyer_link_relayed'] } } },
    },
  });
  for (const o of material) {
    try {
      // Havola yuborilgan bo'lsa navbat sotuvchida — xaridor muddati qo'llanilmaydi.
      if (o.events.some((e) => e.type === 'buyer_link_relayed')) continue;
      const warned = o.events.find((e) => e.type === 'deadline_buyer_warned');
      if (!warned) {
        if (!(await claim(o.id, 'deadline_buyer_warned'))) continue;
        const buyerTg = Number(o.advertiser.telegramId || 0);
        if (!buyerTg) continue;
        await phpBot.sendMessage(
          buyerTg,
          `⏰ <b>Video hali joylanmadi</b> (<code>#${o.id}</code>)\n\n` +
            `1️⃣ Videoni o'z Instagramingizga (<b>@${esc(o.targetIgUsername || '—')}</b>) Reels qilib joylang\n` +
            `2️⃣ «Пригласить соавторов» (Collab) bo'limiga <b>@${esc(o.adAccount.igUsername)}</b> ni qo'shing\n` +
            `3️⃣ Havolasini <b>shu chatga yuboring</b>\n\n` +
            `<b>24 soat</b> ichida havola yuborilmasa, buyurtma avtomatik bekor qilinadi va pulingiz hamyoningizga qaytadi.`,
          { replyMarkup: cancelButton(o.id) },
        ).catch(() => {});
        continue;
      }
      const base = (o.acceptedAt ?? o.createdAt).getTime();
      const deadline = Math.max(base + BUYER_LINK_LIMIT_MS, warned.createdAt.getTime() + BUYER_LINK_LIMIT_MS / 2);
      if (now >= deadline) await autoCancelOrder(o.id, 'buyer_timeout');
    } catch (e) {
      console.warn(`[order-deadline] material #${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
}

let started = false;
// Oldingi aylanish tugamaguncha yangisi boshlanmaydi — aks holda ikkalasi bir
// xil eslatmani "hali yuborilmagan" deb ko'rib, ikki marta yuborardi.
let running = false;
export function startOrderReminderCron(): void {
  if (started) return;
  started = true;
  console.log('🔔 Buyurtma eslatmalari: 3 / 30 / 60 daqiqa; muddatlar: sotuvchi 24s, xaridor 48s');
  setInterval(() => {
    if (running) return;
    running = true;
    runTick()
      .then(runDeadlines)
      .catch((e) => console.error('order-reminder tick error:', e))
      .finally(() => { running = false; });
  }, TICK_MS);
}
