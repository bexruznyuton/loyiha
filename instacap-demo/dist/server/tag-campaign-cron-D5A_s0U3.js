import { p as prisma, f as fetchReelViaApify, a as phpBot, g as getSellerBot, b as getBot } from "./node-build.mjs";
const HOUR = 60 * 60 * 1e3;
const DAY = 24 * HOUR;
const TICK_MS = 30 * 60 * 1e3;
const TICK_SLACK_MS = 15 * 60 * 1e3;
const BATCH_SIZE = 60;
const CHECK_SCHEDULE = [
  [0, 6 * HOUR],
  //      0–7 kun: kuniga 4 marta
  [7 * DAY, 8 * HOUR],
  // 7–10 kun: kuniga 3 marta
  [10 * DAY, 12 * HOUR]
  // 10+ kun: kuniga 2 marta
];
const REMOVED_CHECK_MS = DAY;
const REMOVED_GRACE_MS = 2 * DAY;
function checkIntervalMs(s) {
  if (s.status === "TAG_REMOVED") return REMOVED_CHECK_MS;
  const age = Date.now() - s.createdAt.getTime();
  return [...CHECK_SCHEDULE].reverse().find(([from]) => age >= from)[1];
}
const fmtUZS = (n) => new Intl.NumberFormat("uz-UZ").format(n);
async function notifyUser(telegramId, text) {
  const chatId = Number(telegramId);
  if (!chatId) return;
  if (phpBot.isReady()) {
    await phpBot.sendMessage(chatId, text).catch(() => {
    });
  } else {
    const b = getSellerBot() || getBot();
    if (b) await b.sendMessage(chatId, text, { parse_mode: "HTML" }).catch(() => {
    });
  }
}
async function checkOneSubmission(submissionId) {
  const submission = await prisma.tagSubmission.findUnique({
    where: { id: submissionId },
    include: { user: true }
  });
  if (!submission || submission.status !== "ACTIVE" && submission.status !== "TAG_REMOVED") return;
  const reel = await fetchReelViaApify(submission.videoUrl);
  if (!reel.success) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { lastCheckedAt: /* @__PURE__ */ new Date(), checksCount: { increment: 1 } }
    });
    return;
  }
  const requiresTag = submission.method !== "CSGO";
  const stillTagged = !requiresTag || reel.taggedUsernames.includes(submission.targetUsername);
  if (submission.status === "TAG_REMOVED") {
    if (!stillTagged) {
      const removedAt = (submission.tagRemovedAt ?? submission.lastCheckedAt).getTime();
      if (Date.now() - removedAt >= REMOVED_GRACE_MS - TICK_SLACK_MS) {
        await prisma.tagSubmission.delete({ where: { id: submission.id } });
        await notifyUser(
          submission.user.telegramId,
          `🗑 <b>Video ro'yxatdan o'chirildi</b>

Atmetka 2 kun ichida qaytarilmadi, shu sabab video kuzatuvdan olib tashlandi.

${submission.videoUrl}`
        );
      } else {
        await prisma.tagSubmission.update({
          where: { id: submission.id },
          data: { viewCount: reel.viewCount, lastCheckedAt: /* @__PURE__ */ new Date(), checksCount: { increment: 1 } }
        });
      }
      return;
    }
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { status: "ACTIVE", tagRemovedAt: null }
    });
    await notifyUser(
      submission.user.telegramId,
      `✅ <b>Atmetka qaytdi</b>

Videongiz yana faol, prosmotr kuzatuvi davom etadi.

${submission.videoUrl}`
    );
  } else if (!stillTagged) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: {
        status: "TAG_REMOVED",
        tagRemovedAt: /* @__PURE__ */ new Date(),
        viewCount: reel.viewCount,
        lastCheckedAt: /* @__PURE__ */ new Date(),
        checksCount: { increment: 1 }
      }
    });
    await notifyUser(
      submission.user.telegramId,
      `⚠️ <b>Atmetka olib tashlandi</b>

Videongizdan atmetka o'chirilgani aniqlandi — video <b>Noaktiv</b> holatiga o'tdi va to'lovlar to'xtatildi.

2 kun ichida atmetkani qaytarsangiz, kuzatuv davom etadi. Aks holda video ro'yxatdan o'chiriladi.

${submission.videoUrl}`
    );
    return;
  }
  const tiers = Array.isArray(submission.rewardTiers) ? submission.rewardTiers : [];
  const paidTiers = Array.isArray(submission.paidTiers) ? submission.paidTiers : [];
  const newlyReached = tiers.filter(
    (t) => reel.viewCount >= t.views && !paidTiers.includes(t.views)
  );
  if (newlyReached.length === 0) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { viewCount: reel.viewCount, lastCheckedAt: /* @__PURE__ */ new Date(), checksCount: { increment: 1 } }
    });
    return;
  }
  const totalReward = newlyReached.reduce((sum, t) => sum + t.reward, 0);
  const allPaidNow = [...paidTiers, ...newlyReached.map((t) => t.views)];
  const isCompleted = tiers.every((t) => allPaidNow.includes(t.views));
  await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique({ where: { userId: submission.userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: { userId: submission.userId, balance: 0, frozenBalance: 0, totalEarned: 0 }
      });
    }
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: totalReward }, totalEarned: { increment: totalReward } }
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "TAG_REWARD",
        amount: totalReward,
        status: "COMPLETED",
        note: `Atmetka: ${newlyReached.map((t) => `${fmtUZS(t.views)} prosmotr`).join(", ")}`
      }
    });
    await tx.tagSubmission.update({
      where: { id: submission.id },
      data: {
        viewCount: reel.viewCount,
        lastCheckedAt: /* @__PURE__ */ new Date(),
        checksCount: { increment: 1 },
        paidTiers: allPaidNow,
        totalPaid: { increment: totalReward },
        status: isCompleted ? "COMPLETED" : "ACTIVE"
      }
    });
  });
  await notifyUser(
    submission.user.telegramId,
    `💰 <b>Atmetka mukofoti!</b>

Videongiz ${fmtUZS(reel.viewCount)} prosmotrga yetdi.
📥 +${fmtUZS(totalReward)} so'm hisobingizga qo'shildi.

` + (isCompleted ? "✅ Barcha bosqichlar tugallandi." : "_Tekshiruv davom etadi._")
  );
}
async function runTick() {
  const candidates = await prisma.tagSubmission.findMany({
    where: { status: { in: ["ACTIVE", "TAG_REMOVED"] } },
    orderBy: { lastCheckedAt: "asc" },
    select: { id: true, status: true, createdAt: true, lastCheckedAt: true }
  });
  const now = Date.now();
  const due = candidates.filter((s) => now - s.lastCheckedAt.getTime() >= checkIntervalMs(s) - TICK_SLACK_MS).slice(0, BATCH_SIZE);
  for (const { id } of due) {
    try {
      await checkOneSubmission(id);
    } catch (e) {
      console.warn(`[tag-campaign-cron] submission #${id} fail:`, e instanceof Error ? e.message : e);
    }
  }
}
let started = false;
let running = false;
function tick() {
  if (running) return;
  running = true;
  runTick().catch((e) => console.error("tag-campaign-cron tick error:", e)).finally(() => {
    running = false;
  });
}
function startTagCampaignCron() {
  if (started) return;
  started = true;
  console.log("🏷 Atmetka kampaniyasi cron: 6s → 8s → 12s oraliq, Noaktiv — kuniga 1 marta");
  setTimeout(tick, 3e4);
  setInterval(tick, TICK_MS);
}
export {
  startTagCampaignCron
};
//# sourceMappingURL=tag-campaign-cron-D5A_s0U3.js.map
