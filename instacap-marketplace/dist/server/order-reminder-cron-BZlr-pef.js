import { p as prisma, a as phpBot, t as telegramFailure, i as isUnreachable, h as handleSellerUnreachable, S as SUPPORT_USERNAME, b as autoCancelOrder } from "./node-build.mjs";
const TICK_MS = 60 * 1e3;
const STEPS = [3, 30, 60];
const STALE_MS = 3 * 60 * 60 * 1e3;
const HOUR = 60 * 60 * 1e3;
const SELLER_CONSENT_LIMIT_MS = 24 * HOUR;
const BUYER_LINK_LIMIT_MS = 48 * HOUR;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cancelButton = (orderId) => ({
  inline_keyboard: [[{ text: "❌ Buyurtmani bekor qilish", callback_data: `mkt:buyer:cancel:${orderId}` }]]
});
function buyerReminder(step, o) {
  const seller = esc(o.adAccount.igUsername);
  const me = esc(o.targetIgUsername || "—");
  const how = `1️⃣ Videoni o'z Instagramingizga (<b>@${me}</b>) Reels qilib joylang
2️⃣ «Пригласить соавторов» (Collab) bo'limiga <b>@${seller}</b> ni qo'shing
3️⃣ Havolasini <b>shu chatga yuboring</b>`;
  if (step === 3) {
    return { text: `⏰ <b>Eslatma</b> (<code>#${o.id}</code>)

Sotuvchi sizni kutyapti. Videoni joylashni unutmang:

${how}` };
  }
  if (step === 30) {
    return { text: `⏰ <b>Video hali joylanmadi</b> (<code>#${o.id}</code>)

Pulingiz muzlab turibdi, sotuvchi esa sizni kutyapti. Iltimos, videoni joylab, havolasini yuboring:

${how}

Qiyinchilik bo'lsa ${SUPPORT_USERNAME} ga yozing.` };
  }
  return {
    text: `⏰ <b>Oxirgi eslatma</b> (<code>#${o.id}</code>)

Bir soatdan beri video joylanmadi. Hali ham qilmoqchi bo'lsangiz — videoni joylab, havolasini shu chatga yuboring.

Fikringizdan qaytgan bo'lsangiz, buyurtmani bekor qiling — <b>pulingiz to'liq hamyoningizga qaytadi.</b>`,
    replyMarkup: cancelButton(o.id)
  };
}
function sellerReminder(step, o, url) {
  const head = step === 60 ? `⏰ <b>Xaridor bir soatdan beri kutyapti</b>` : `⏰ <b>Eslatma</b>`;
  return `${head} (<code>#${o.id}</code>)

Xaridor videoni joylab, havolasini yubordi:
🔗 ${esc(url)}

1️⃣ Instagram bildirishnomalaridan collab taklifini qabul qiling
2️⃣ Havolani <b>shu chatga yuboring</b>

Shundan keyin xaridor tasdiqlaydi va pul hisobingizga o'tadi.`;
}
async function claim(orderId, type) {
  const exists = await prisma.orderEvent.findFirst({ where: { orderId, type }, select: { id: true } });
  if (exists) return false;
  await prisma.orderEvent.create({ data: { orderId, type } });
  return true;
}
async function runTick() {
  const now = Date.now();
  const orders = await prisma.order.findMany({
    where: { status: "AWAITING_BUYER_MATERIAL", acceptedAt: { gte: new Date(now - STALE_MS - 60 * 60 * 1e3) } },
    include: {
      advertiser: { select: { telegramId: true } },
      adAccount: { select: { igUsername: true, ownerId: true, owner: { select: { telegramId: true } } } },
      events: { where: { type: { in: ["buyer_link_relayed"] } }, orderBy: { createdAt: "asc" }, take: 1 }
    }
  });
  for (const o of orders) {
    try {
      const relayed = o.events[0];
      const base = (relayed ? relayed.createdAt : o.acceptedAt)?.getTime();
      if (!base || now - base > STALE_MS) continue;
      const elapsedMin = (now - base) / 6e4;
      const step = [...STEPS].reverse().find((s) => elapsedMin >= s);
      if (!step) continue;
      const buyerTg = Number(o.advertiser.telegramId || 0);
      const sellerTg = Number(o.adAccount.owner?.telegramId || 0);
      if (!relayed) {
        if (!buyerTg || !await claim(o.id, `reminder_buyer_${step}`)) continue;
        const r = buyerReminder(step, o);
        await phpBot.sendMessage(buyerTg, r.text, r.replyMarkup ? { replyMarkup: r.replyMarkup } : void 0).catch(() => {
        });
      } else {
        if (!sellerTg || !await claim(o.id, `reminder_seller_${step}`)) continue;
        const url = String(relayed.payload?.url || "");
        const res = await phpBot.sendMessage(sellerTg, sellerReminder(step, o, url)).catch(() => null);
        const failure = telegramFailure(res);
        if (isUnreachable(failure)) {
          await handleSellerUnreachable(o.adAccount.ownerId, failure.description);
          continue;
        }
        if (step === 60 && buyerTg) {
          await phpBot.sendMessage(
            buyerTg,
            `⏳ <b>Sotuvchi hali javob bermadi</b> (<code>#${o.id}</code>)

Unga yana eslatdik. Biroz kutishingiz yoki buyurtmani bekor qilishingiz mumkin — <b>pulingiz to'liq qaytadi.</b>

Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`,
            { replyMarkup: cancelButton(o.id) }
          ).catch(() => {
          });
        }
      }
    } catch (e) {
      console.warn(`[order-reminder] #${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
}
async function runDeadlines() {
  const now = Date.now();
  const consent = await prisma.order.findMany({
    where: { status: "AWAITING_SELLER_CONSENT", createdAt: { lte: new Date(now - SELLER_CONSENT_LIMIT_MS / 2) } },
    include: {
      adAccount: { select: { igUsername: true, ownerId: true, owner: { select: { telegramId: true } } } },
      events: { where: { type: "deadline_seller_warned" }, take: 1 }
    }
  });
  for (const o of consent) {
    try {
      const warned = o.events[0];
      if (!warned) {
        if (!await claim(o.id, "deadline_seller_warned")) continue;
        const sellerTg = Number(o.adAccount.owner?.telegramId || 0);
        if (!sellerTg) continue;
        const res = await phpBot.sendMessage(
          sellerTg,
          `⏰ <b>Buyurtma javob kutmoqda</b> (<code>#${o.id}</code>)

@${esc(o.adAccount.igUsername)} akkauntingizga buyurtma kelgan, lekin hali javob bermadingiz.

Yuqoridagi so'rovda <b>✅ Qabul qilaman</b> yoki <b>❌ Rad etish</b> tugmasini bosing. <b>12 soat</b> ichida javob bo'lmasa, buyurtma avtomatik bekor qilinadi.`
        ).catch(() => null);
        const failure = telegramFailure(res);
        if (isUnreachable(failure)) await handleSellerUnreachable(o.adAccount.ownerId, failure.description);
        continue;
      }
      const deadline = Math.max(o.createdAt.getTime() + SELLER_CONSENT_LIMIT_MS, warned.createdAt.getTime() + SELLER_CONSENT_LIMIT_MS / 2);
      if (now >= deadline) await autoCancelOrder(o.id, "seller_timeout");
    } catch (e) {
      console.warn(`[order-deadline] consent #${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
  const material = await prisma.order.findMany({
    where: { status: "AWAITING_BUYER_MATERIAL", acceptedAt: { lte: new Date(now - BUYER_LINK_LIMIT_MS / 2) } },
    include: {
      advertiser: { select: { telegramId: true } },
      adAccount: { select: { igUsername: true } },
      events: { where: { type: { in: ["deadline_buyer_warned", "buyer_link_relayed"] } } }
    }
  });
  for (const o of material) {
    try {
      if (o.events.some((e) => e.type === "buyer_link_relayed")) continue;
      const warned = o.events.find((e) => e.type === "deadline_buyer_warned");
      if (!warned) {
        if (!await claim(o.id, "deadline_buyer_warned")) continue;
        const buyerTg = Number(o.advertiser.telegramId || 0);
        if (!buyerTg) continue;
        await phpBot.sendMessage(
          buyerTg,
          `⏰ <b>Video hali joylanmadi</b> (<code>#${o.id}</code>)

1️⃣ Videoni o'z Instagramingizga (<b>@${esc(o.targetIgUsername || "—")}</b>) Reels qilib joylang
2️⃣ «Пригласить соавторов» (Collab) bo'limiga <b>@${esc(o.adAccount.igUsername)}</b> ni qo'shing
3️⃣ Havolasini <b>shu chatga yuboring</b>

<b>24 soat</b> ichida havola yuborilmasa, buyurtma avtomatik bekor qilinadi va pulingiz hamyoningizga qaytadi.`,
          { replyMarkup: cancelButton(o.id) }
        ).catch(() => {
        });
        continue;
      }
      const base = (o.acceptedAt ?? o.createdAt).getTime();
      const deadline = Math.max(base + BUYER_LINK_LIMIT_MS, warned.createdAt.getTime() + BUYER_LINK_LIMIT_MS / 2);
      if (now >= deadline) await autoCancelOrder(o.id, "buyer_timeout");
    } catch (e) {
      console.warn(`[order-deadline] material #${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
}
let started = false;
let running = false;
function startOrderReminderCron() {
  if (started) return;
  started = true;
  console.log("🔔 Buyurtma eslatmalari: 3 / 30 / 60 daqiqa; muddatlar: sotuvchi 24s, xaridor 48s");
  setInterval(() => {
    if (running) return;
    running = true;
    runTick().then(runDeadlines).catch((e) => console.error("order-reminder tick error:", e)).finally(() => {
      running = false;
    });
  }, TICK_MS);
}
export {
  startOrderReminderCron
};
//# sourceMappingURL=order-reminder-cron-BZlr-pef.js.map
