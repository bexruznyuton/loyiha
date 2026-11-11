/**
 * "Atmetka qilish" kampaniyasi — TagSubmission'larni qayta tekshiradi:
 * prosmotr sonini yangilaydi, atmetka hali ham borligini tasdiqlaydi va yangi
 * bosqichga (tier) yetgan bo'lsa wallet'ga pul qo'shadi.
 *
 * Tekshiruv oralig'i video yoshiga qarab asta-sekin oshadi (CHECK_SCHEDULE).
 * Atmetka olib tashlansa — TAG_REMOVED ("Noaktiv"): kuniga 1 marta tekshiriladi,
 * qaytsa yana ACTIVE; 2 kun ichida qaytmasa yozuv o'chiriladi.
 */

import { prisma } from './prisma';
import { fetchReelViaApify, fetchReelsViaApify, reelCacheKey, APIFY_BATCH_TIMEOUT_MS, APIFY_MAX_BATCH } from './apify-reel';
import { getTagBudget, addTagBudgetSpent, budgetKeyFor } from './tag-campaign-config';
import { phpBot } from './php-bot-bridge';
import { getSellerBot, getBot } from '../bot';
import type { RewardTier } from './tag-campaign-config';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TICK_MS = 30 * 60 * 1000; // har 30 daqiqada qaysi videolar navbatda ekanini ko'ramiz
const TICK_SLACK_MS = 15 * 60 * 1000; // tick oralig'i tufayli jadval surilib ketmasligi uchun
const BATCH_SIZE = 200; // bir tsiklda hammasi sig'sin (Apify xato bersa tsikl to'xtaydi)
// Apify javob bermasa (limit, tarmoq) — shuncha vaqt hech narsa chaqirilmaydi;
// muvaffaqiyatsiz urinish videoning navbatini "yemaydi" (lastCheckedAt o'zgarmaydi).
const UPSTREAM_PAUSE_MS = 60 * 60 * 1000;
const CRON_APIFY_TIMEOUT_MS = 75_000; // o'chirilgan video ~30 s da not_found qaytaradi
// Bitta sekin/xato javob tsiklni to'xtatmaydi — faqat ketma-ket shuncha xatodan keyin.
const UPSTREAM_MAX_CONSECUTIVE_FAILS = 5;
let upstreamPausedUntil = 0;

// Xato bo'lgan submission'ni har 30 daqiqada qayta urinish o'rniga eksponensial
// backoff bilan kechiktiramiz — Apify limiti/uzilishi paytida pul va vaqt tejaydi.
const FAILURE_BACKOFF_BASE_MS = 15 * 60 * 1000;
const FAILURE_BACKOFF_MAX_MS = 6 * HOUR;
const failureBackoff = new Map<number, { fails: number; until: number }>();

function inFailureBackoff(id: number): boolean {
  const entry = failureBackoff.get(id);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    failureBackoff.delete(id);
    return false;
  }
  return true;
}

function noteSubmissionFailure(id: number): void {
  const entry = failureBackoff.get(id) || { fails: 0, until: 0 };
  entry.fails += 1;
  entry.until = Date.now() + Math.min(FAILURE_BACKOFF_MAX_MS, FAILURE_BACKOFF_BASE_MS * 2 ** Math.min(entry.fails - 1, 6));
  failureBackoff.set(id, entry);
}

// [video yoshi (dan), tekshiruv oralig'i]. Xarajatni cheklash uchun
// (2026-10-16): prosmotr asosan dastlabki kunlarda yig'iladi — keyin
// siyrak tekshiramiz, TRACKING_DAYS dan keyin kuzatuv butunlay to'xtaydi.
const CHECK_SCHEDULE: Array<[number, number]> = [
  [0, 6 * HOUR], //       1-kun: 4 marta
  [1 * DAY, 8 * HOUR], //  2-kun: 3 marta
  [2 * DAY, 12 * HOUR], // 3-kun: 2 marta
  [3 * DAY, 24 * HOUR], // 4-kun: 1 marta
  [4 * DAY, 72 * HOUR], // 5–30-kun: har 3 kunda 1 marta
];
// Shundan keyin oxirgi marta tekshirib (yetgan bosqich to'lanadi) EXPIRED.
const TRACKING_DAYS = 30;
const REMOVED_CHECK_MS = DAY; // Noaktiv video — kuniga 1 marta
const REMOVED_GRACE_MS = 2 * DAY; // shuncha vaqtda atmetka qaytmasa — o'chiriladi

// Jadval admin tasdiqlagan vaqtdan boshlanadi (eski yozuvlarda — yuborilgan vaqtdan).
const trackingStart = (s: { createdAt: Date; approvedAt?: Date | null }) => (s.approvedAt ?? s.createdAt).getTime();

export function checkIntervalMs(s: { status: string; createdAt: Date; approvedAt?: Date | null }): number {
  if (s.status === 'TAG_REMOVED') return REMOVED_CHECK_MS;
  const age = Date.now() - trackingStart(s);
  return [...CHECK_SCHEDULE].reverse().find(([from]) => age >= from)![1];
}
const fmtUZS = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Nakrutka filtri: haqiqiy auditoriyali videoda (layk + izoh) odatda prosmotrning
// 1–5% i bo'ladi. 0.3% dan kam bo'lsa — prosmotr sotib olingan bo'lishi ehtimoli
// yuqori, to'lov admin tekshiruviga ushlanadi (2026-10-08: 151K prosmotr, 0 layk,
// 0 izohli video 396 000 so'm olib, darhol yechib olishga uringan).
const MIN_ENGAGEMENT_RATE = 0.003;
const ENGAGEMENT_MIN_VIEWS = 2000; // juda kam prosmotrda nisbat ishonchsiz
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((id) => parseInt(id.trim()))
  .filter((n) => !isNaN(n) && n > 0);

async function notifyAdminsOfSuspiciousViews(
  submission: { id: number; videoUrl: string; user: { firstName: string; username: string; telegramId: bigint } },
  reel: { ownerUsername: string; viewCount: number; likesCount: number; commentsCount: number },
  heldReward: number,
): Promise<void> {
  const bot = getBot();
  if (!bot) return;
  const u = submission.user;
  const rate = ((reel.likesCount + reel.commentsCount) / Math.max(1, reel.viewCount)) * 100;
  const text =
    `🚩 <b>Shubhali prosmotr — to'lov ushlab turildi</b> (#${submission.id})\n\n` +
    `👤 Foydalanuvchi: ${esc(u.firstName || 'Nomsiz')}${u.username ? ` (@${esc(u.username)})` : ''} · <code>${u.telegramId}</code>\n` +
    `🎬 Video egasi: @${esc(reel.ownerUsername || '—')}\n` +
    `👁 ${fmtUZS(reel.viewCount)} prosmotr · ❤️ ${fmtUZS(reel.likesCount)} layk · 💬 ${fmtUZS(reel.commentsCount)} izoh\n` +
    `📉 Faollik: <b>${rate.toFixed(2)}%</b> (me'yor ≥ ${MIN_ENGAGEMENT_RATE * 100}%)\n` +
    `💰 Ushlangan to'lov: <b>${fmtUZS(heldReward)}</b> so'm\n\n` +
    `🔗 ${esc(submission.videoUrl)}\n\n` +
    `<i>Videoni ko'rib chiqing: haqiqiy bo'lsa — to'lang, nakrutka bo'lsa — rad eting.</i>`;
  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ To'lash", callback_data: `tagrev:pay:${submission.id}` },
      { text: '🚫 Rad etish (nakrutka)', callback_data: `tagrev:reject:${submission.id}` },
    ]],
  };
  for (const adminId of ADMIN_IDS) {
    await bot.sendMessage(adminId, text, { parse_mode: 'HTML', reply_markup, disable_web_page_preview: true }).catch(() => {});
  }
}

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  const chatId = Number(telegramId);
  if (!chatId) return;
  if (phpBot.isReady()) {
    await phpBot.sendMessage(chatId, text).catch(() => {});
  } else {
    const b = getSellerBot() || getBot();
    if (b) await b.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
  }
}

export type CheckResult = 'ok' | 'skipped' | 'upstream_failed';

export async function checkOneSubmission(
  submissionId: number,
  presetReel?: Awaited<ReturnType<typeof fetchReelViaApify>>,
): Promise<CheckResult> {
  const submission = await prisma.tagSubmission.findUnique({
    where: { id: submissionId },
    include: { user: true },
  });
  if (!submission || (submission.status !== 'ACTIVE' && submission.status !== 'TAG_REMOVED')) return 'skipped';

  const reel = presetReel || (await fetchReelViaApify(submission.videoUrl, CRON_APIFY_TIMEOUT_MS));
  if (!reel.success) {
    if ((reel as { error: string }).error !== 'not_found') {
      // Apify/tarmoq xatosi — videoning navbatini YEMAYMIZ (lastCheckedAt
      // o'zgarmaydi), keyinroq qayta uriniladi.
      console.warn(`[tag-campaign-cron] #${submission.id} Apify xatosi: ${(reel as { error: string }).error}`);
      return 'upstream_failed';
    }
    // Video topilmadi (o'chirilgan/yopiq) — qayta-qayta so'ramaymiz, navbat yangilanadi.
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { lastCheckedAt: new Date(), checksCount: { increment: 1 } },
    });
    return 'skipped';
  }

  // CSGO (atmetkasiz) usulda tag tekshiruvi umuman kerak emas — faqat prosmotr.
  const requiresTag = submission.method !== 'CSGO';
  const stillTagged = !requiresTag || reel.taggedUsernames.includes(submission.targetUsername);

  if (submission.status === 'TAG_REMOVED') {
    if (!stillTagged) {
      const removedAt = (submission.tagRemovedAt ?? submission.lastCheckedAt).getTime();
      if (Date.now() - removedAt >= REMOVED_GRACE_MS - TICK_SLACK_MS) {
        await prisma.tagSubmission.delete({ where: { id: submission.id } });
        await notifyUser(
          submission.user.telegramId,
          `🗑 <b>Video ro'yxatdan o'chirildi</b>

Atmetka 2 kun ichida qaytarilmadi, shu sabab video kuzatuvdan olib tashlandi.

${submission.videoUrl}`,
        );
      } else {
        await prisma.tagSubmission.update({
          where: { id: submission.id },
          data: { viewCount: reel.viewCount, lastCheckedAt: new Date(), checksCount: { increment: 1 } },
        });
      }
      return;
    }
    // Atmetka qaytdi — yana faol, quyida odatdagidek bosqichlar tekshiriladi.
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { status: 'ACTIVE', tagRemovedAt: null },
    });
    await notifyUser(
      submission.user.telegramId,
      `✅ <b>Atmetka qaytdi</b>

Videongiz yana faol, prosmotr kuzatuvi davom etadi.

${submission.videoUrl}`,
    );
  } else if (!stillTagged) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'TAG_REMOVED',
        tagRemovedAt: new Date(),
        viewCount: reel.viewCount,
        lastCheckedAt: new Date(),
        checksCount: { increment: 1 },
      },
    });
    await notifyUser(
      submission.user.telegramId,
      `⚠️ <b>Atmetka olib tashlandi</b>

Videongizdan atmetka o'chirilgani aniqlandi — video <b>Noaktiv</b> holatiga o'tdi va to'lovlar to'xtatildi.

2 kun ichida atmetkani qaytarsangiz, kuzatuv davom etadi. Aks holda video ro'yxatdan o'chiriladi.

${submission.videoUrl}`,
    );
    return;
  }

  const tiers = (Array.isArray(submission.rewardTiers) ? submission.rewardTiers : []) as unknown as RewardTier[];
  const paidTiers = (Array.isArray(submission.paidTiers) ? submission.paidTiers : []) as number[];
  const newlyReached = tiers.filter(
    (t) => reel.viewCount >= t.views && !paidTiers.includes(t.views),
  );

  if (newlyReached.length === 0) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { viewCount: reel.viewCount, lastCheckedAt: new Date(), checksCount: { increment: 1 } },
    });
    return;
  }

  const totalReward = newlyReached.reduce((sum, t) => sum + t.reward, 0);

  const engagement = (reel.likesCount + reel.commentsCount) / Math.max(1, reel.viewCount);
  if (!submission.viewsTrusted && reel.viewCount >= ENGAGEMENT_MIN_VIEWS && engagement < MIN_ENGAGEMENT_RATE) {
    // Adminga faqat birinchi marta xabar beramiz; qaror chiqquncha to'lov to'xtab turadi.
    const firstHold = !submission.reviewHeldAt;
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: {
        viewCount: reel.viewCount,
        lastCheckedAt: new Date(),
        checksCount: { increment: 1 },
        ...(firstHold ? { reviewHeldAt: new Date() } : {}),
      },
    });
    if (firstHold) await notifyAdminsOfSuspiciousViews(submission, reel, totalReward);
    return;
  }

  let payAmount = totalReward;
  const usesBudget = true;
  const budgetKey = budgetKeyFor(submission.method);
  if (usesBudget) {
    const budget = await getTagBudget(prisma, budgetKey);
    if (budget.enabled) {
      if (budget.remaining <= 0) {
        await prisma.tagSubmission.update({ where: { id: submission.id }, data: { viewCount: reel.viewCount, lastCheckedAt: new Date(), checksCount: { increment: 1 } } });
        return;
      }
      payAmount = Math.min(totalReward, budget.remaining);
    }
  }

  const allPaidNow = [...paidTiers, ...newlyReached.map((t) => t.views)];
  const isCompleted = tiers.every((t) => allPaidNow.includes(t.views));

  await prisma.$transaction(async (tx) => {
    if (usesBudget && payAmount > 0) await addTagBudgetSpent(tx, payAmount, budgetKey);
    let wallet = await tx.wallet.findUnique({ where: { userId: submission.userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: { userId: submission.userId, balance: 0, frozenBalance: 0, totalEarned: 0 },
      });
    }
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: payAmount }, totalEarned: { increment: payAmount } },
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'TAG_REWARD',
        amount: payAmount,
        status: 'COMPLETED',
        note: `Atmetka: ${newlyReached.map((t) => `${fmtUZS(t.views)} prosmotr`).join(', ')}`,
      },
    });
    await tx.tagSubmission.update({
      where: { id: submission.id },
      data: {
        viewCount: reel.viewCount,
        lastCheckedAt: new Date(),
        checksCount: { increment: 1 },
        paidTiers: allPaidNow as any,
        totalPaid: { increment: payAmount },
        status: isCompleted ? 'COMPLETED' : 'ACTIVE',
      },
    });
  });

  await notifyUser(
    submission.user.telegramId,
    `💰 <b>Atmetka mukofoti!</b>\n\n` +
      `Videongiz ${fmtUZS(reel.viewCount)} prosmotrga yetdi.\n` +
      `📥 +${fmtUZS(payAmount)} so'm hisobingizga qo'shildi.\n\n` +
      (isCompleted ? '✅ Barcha bosqichlar tugallandi.' : '_Tekshiruv davom etadi._'),
  );
}

async function runTick(): Promise<void> {
  const now = Date.now();
  if (now < upstreamPausedUntil) return;
  const candidates = await prisma.tagSubmission.findMany({
    where: { status: { in: ['ACTIVE', 'TAG_REMOVED'] } },
    orderBy: { lastCheckedAt: 'asc' },
    select: { id: true, status: true, createdAt: true, approvedAt: true, lastCheckedAt: true, videoUrl: true },
  });
  const isExpired = (s: { status: string; createdAt: Date; approvedAt: Date | null }) =>
    s.status === 'ACTIVE' && now - trackingStart(s) >= TRACKING_DAYS * DAY;

  // 30 kunlik kuzatuv tugagan videolarni Apify'ga yubormasdan yopamiz — bu eng
  // katta tejam: ularni qayta-qayta tekshirish faqat pul yoqardi.
  const expiredIds = candidates.filter(isExpired).map((s) => s.id);
  if (expiredIds.length > 0) {
    await prisma.tagSubmission
      .updateMany({ where: { id: { in: expiredIds }, status: 'ACTIVE' }, data: { status: 'EXPIRED' } })
      .catch((e) => {
        console.warn('[tag-campaign-cron] expired update fail:', e instanceof Error ? e.message : e);
      });
  }

  const due = candidates
    .filter(
      (s) =>
        !isExpired(s) &&
        now - s.lastCheckedAt.getTime() >= checkIntervalMs(s) - TICK_SLACK_MS &&
        !inFailureBackoff(s.id),
    )
    .slice(0, BATCH_SIZE);
  if (due.length === 0) return;

  // Bitta havola bir necha marta yuborilgan bo'lsa — faqat bir marta tekshiramiz.
  const uniqueUrls: string[] = [];
  const seenUrlKeys = new Set<string>();
  for (const s of due) {
    if (!s.videoUrl) continue;
    const key = reelCacheKey(s.videoUrl);
    if (seenUrlKeys.has(key)) continue;
    seenUrlKeys.add(key);
    uniqueUrls.push(s.videoUrl);
  }

  const reelsByKey = new Map<string, Awaited<ReturnType<typeof fetchReelViaApify>>>();
  let batchFailures = 0;
  console.log(
    `[tag-campaign-cron] ${due.length} ta submission navbatda, ${uniqueUrls.length} ta noyob havola — ${Math.ceil(uniqueUrls.length / APIFY_MAX_BATCH)} ta Apify run`,
  );

  for (let i = 0; i < uniqueUrls.length; i += APIFY_MAX_BATCH) {
    const chunk = uniqueUrls.slice(i, i + APIFY_MAX_BATCH);
    const batch = await fetchReelsViaApify(chunk, APIFY_BATCH_TIMEOUT_MS);
    if (!batch.success) {
      batchFailures += 1;
      console.warn(`[tag-campaign-cron] Apify batch xatosi (${chunk.length} ta havola): ${batch.error}`);
      if (batch.error === 'upstream_403' || batch.error === 'upstream_429') {
        upstreamPausedUntil = Date.now() + UPSTREAM_PAUSE_MS;
        console.warn(`[tag-campaign-cron] Apify limiti (${batch.error}) — 1 soatdan keyin qayta uriniladi`);
        break;
      }
      if (batchFailures >= UPSTREAM_MAX_CONSECUTIVE_FAILS) {
        upstreamPausedUntil = Date.now() + UPSTREAM_PAUSE_MS;
        console.warn(`[tag-campaign-cron] ketma-ket ${batchFailures} ta Apify batch xatosi — tsikl to'xtatildi, 1 soatdan keyin qayta uriniladi`);
        break;
      }
    } else {
      batchFailures = 0;
    }
    for (const url of chunk) {
      const reel = batch.byUrl.get(url);
      if (reel) reelsByKey.set(reelCacheKey(url), reel);
    }
  }

  for (const s of due) {
    const reel = s.videoUrl ? reelsByKey.get(reelCacheKey(s.videoUrl)) : undefined;
    if (!reel) {
      // Batch umuman ishlamadi — bu submission'ni backoff bilan kechiktiramiz,
      // har 30 daqiqada qayta urinmaymiz.
      noteSubmissionFailure(s.id);
      continue;
    }
    try {
      const result = await checkOneSubmission(s.id, reel);
      if (result === 'upstream_failed') {
        noteSubmissionFailure(s.id);
        continue;
      }
      failureBackoff.delete(s.id);
    } catch (e) {
      noteSubmissionFailure(s.id);
      console.warn(`[tag-campaign-cron] submission #${s.id} fail:`, e instanceof Error ? e.message : e);
    }
  }
}

let started = false;
// Oldingi aylanish tugamaguncha yangisi boshlanmaydi (bir video ikki marta tekshirilmasin).
let running = false;
function tick(): void {
  if (running) return;
  running = true;
  runTick()
    .catch((e) => console.error('tag-campaign-cron tick error:', e))
    .finally(() => { running = false; });
}

export function startTagCampaignCron(): void {
  if (started) return;
  started = true;
  console.log('🏷 Atmetka kampaniyasi cron: 1-kun 4×, 2-kun 3×, 3-kun 2×, 4-kun 1×, keyin har 3 kunda; 30 kunda tugaydi');
  setTimeout(tick, 30_000);
  setInterval(tick, TICK_MS);
}
