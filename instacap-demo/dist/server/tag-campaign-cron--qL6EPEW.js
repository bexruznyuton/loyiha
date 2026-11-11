import { p as prisma, f as fetchReelViaApify, a as phpBot, g as getSellerBot, b as getBot } from "./node-build.mjs";
const TICK_MS = 6 * 60 * 60 * 1e3;
const BATCH_SIZE = 30;
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
  if (!submission || submission.status !== "ACTIVE") return;
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
  if (!stillTagged) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: {
        status: "TAG_REMOVED",
        viewCount: reel.viewCount,
        lastCheckedAt: /* @__PURE__ */ new Date(),
        checksCount: { increment: 1 }
      }
    });
    await notifyUser(
      submission.user.telegramId,
      `⚠️ <b>Atmetka olib tashlandi</b>

Videongizdan atmetka o'chirilgani aniqlandi, shu sabab keyingi to'lovlar to'xtatildi.

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
  const due = await prisma.tagSubmission.findMany({
    where: { status: "ACTIVE" },
    orderBy: { lastCheckedAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true }
  });
  for (const { id } of due) {
    try {
      await checkOneSubmission(id);
    } catch (e) {
      console.warn(`[tag-campaign-cron] submission #${id} fail:`, e instanceof Error ? e.message : e);
    }
  }
}
let started = false;
function startTagCampaignCron() {
  if (started) return;
  started = true;
  console.log("🏷 Atmetka kampaniyasi cron: kuniga 4 marta (har 6 soatda) tekshiriladi");
  setTimeout(() => {
    runTick().catch((e) => console.error("tag-campaign-cron tick error:", e));
  }, 3e4);
  setInterval(() => {
    runTick().catch((e) => console.error("tag-campaign-cron tick error:", e));
  }, TICK_MS);
}
export {
  startTagCampaignCron
};
//# sourceMappingURL=tag-campaign-cron--qL6EPEW.js.map
