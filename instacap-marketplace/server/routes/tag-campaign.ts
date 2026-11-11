import { RequestHandler } from 'express';
import NodeCache from 'node-cache';
import { prisma } from '../lib/prisma';
import { fetchReelViaApify, isApifyReelConfigured, type ReelData, type ReelError } from '../lib/apify-reel';
import {
  getTagTargetUsername,
  getRewardTiers,
  getCsgoRewardTiers,
  getCsgoTagRewardTiers,
  getTagBudget,
  budgetKeyFor,
} from '../lib/tag-campaign-config';
import { getAdminTelegramIds } from '../lib/notifications';
import { getBot } from '../bot';
import { checkIntervalMs } from '../lib/tag-campaign-cron';

function isInstagramVideoUrl(raw: string): boolean {
  return /instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/i.test(raw.trim());
}

// Tekshirish natijasini qisqa muddat (2 daqiqa) keshlab qo'yamiz — foydalanuvchi
// "Tekshirish"dan keyin "Saqlash"ni bossa, Apify'ga ikkinchi marta pul
// to'lamasdan xuddi shu natijadan foydalanamiz.
const checkCache = new NodeCache({ stdTTL: 120, checkperiod: 60, useClones: false });

// Foydalanuvchining bitta videosi admin tasdig'ini kutayotgan bo'lsa, yangisini
// yubora olmaydi (2026-10-11: bir kishi har ~20 soniyada 9 ta video yuborib,
// admin chatini to'ldirgan). Apify'dan OLDIN tekshiriladi — bekorga pul ketmaydi.
async function hasPendingSubmission(userId: number): Promise<boolean> {
  const row = await prisma.tagSubmission.findFirst({ where: { userId, status: 'PENDING_REVIEW' }, select: { id: true } });
  return !!row;
}

// Faqat yangi joylangan videoni qabul qilamiz: Instagram'ga joylanganidan
// keyin shuncha vaqt o'tgan bo'lsa — rad etiladi (eski, allaqachon prosmotr
// yig'gan videolar bilan mukofot olishning oldini oladi).
const MAX_VIDEO_AGE_MS = 30 * 60 * 1000;
function isTooOld(reel: ReelData): boolean {
  // Vaqt noma'lum bo'lsa (kamdan-kam) — halol foydalanuvchini bloklamaymiz.
  return !!reel.postedAt && Date.now() - reel.postedAt.getTime() > MAX_VIDEO_AGE_MS;
}

// Bir vaqtda yuborilgan ikki so'rov ikkalasi ham "kutayotgani yo'q" deb o'tib
// ketmasligi uchun — foydalanuvchi bo'yicha jarayon ichidagi qulf.
const submittingUsers = new Set<number>();
function withSingleSubmission(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    const userId = req.pgUser!.id;
    if (submittingUsers.has(userId) || (await hasPendingSubmission(userId))) {
      res.status(409).json({ success: false, error: 'pending_review' });
      return;
    }
    submittingUsers.add(userId);
    try {
      await handler(req, res, next);
    } finally {
      submittingUsers.delete(userId);
    }
  };
}

// Premium (CSGO_TAG) uchun talab matni admin panelda belgilanadi:
// `premium_tag_rules` Setting'ida { prem_copy, simple_copy } ko'rinishida.
async function getTagRequirement(isPrem: boolean): Promise<{ targetUsername: string; expectedText: string }> {
  let targetUsername = await getTagTargetUsername();
  let expectedText = '';
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'premium_tag_rules' } });
    if (row && row.value) {
      const o = JSON.parse(row.value);
      if (isPrem) {
        expectedText = (o.prem_copy || o.prem || '').trim();
      } else {
        const sc = (o.simple_copy || '').replace(/^@/, '').trim().toLowerCase();
        if (sc && /^[a-z0-9._]{1,30}$/.test(sc)) {
          targetUsername = sc;
        }
      }
    }
  } catch (e) {}
  return { targetUsername, expectedText };
}

function verifyReelTask(
  reel: { caption?: string; taggedUsernames: string[] },
  isPrem: boolean,
  targetUsername: string,
  expectedText: string,
): boolean {
  if (isPrem && expectedText) {
    const cap = String(reel.caption || '').toLowerCase().replace(/\s+/g, ' ');
    const exp = expectedText.toLowerCase().replace(/\s+/g, ' ');
    if (cap.includes(exp)) return true;
    const lines = expectedText.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l.length >= 5);
    if (lines.length > 0 && lines.some((l) => cap.includes(l))) return true;
    const cleanCap = cap.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    const cleanExp = exp.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    if (cleanExp && cleanCap.includes(cleanExp)) return true;
    if (expectedText.startsWith('@')) {
      const u = expectedText.replace(/^@/, '').toLowerCase();
      if (reel.taggedUsernames.includes(u)) return true;
    }
    if (reel.taggedUsernames.includes(targetUsername)) return true;
    return false;
  }
  return reel.taggedUsernames.includes(targetUsername);
}

export const handleCheckTagVideo: RequestHandler = async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url || !isInstagramVideoUrl(url)) {
      res.status(400).json({ success: false, error: 'invalid_url' });
      return;
    }
    if (req.pgUser && (await hasPendingSubmission(req.pgUser.id))) {
      res.status(409).json({ success: false, error: 'pending_review' });
      return;
    }
    if (!isApifyReelConfigured()) {
      res.status(500).json({ success: false, error: 'not_configured' });
      return;
    }

    const isPrem = !!req.body?.premium;
    const tagBudgetC = await getTagBudget(prisma, budgetKeyFor(isPrem ? 'CSGO_TAG' : 'TAG_ONLY'));
    if (tagBudgetC.enabled && tagBudgetC.remaining <= 0) {
      res.json({ success: false, error: 'budget_exhausted' });
      return;
    }

    const { targetUsername, expectedText } = await getTagRequirement(isPrem);

    let reel = checkCache.get<ReelData | ReelError>(url);
    if (!reel) {
      reel = await fetchReelViaApify(url);
      // Atmetka TOPILGAN natija 2 daqiqa keshlanadi (yuborishda qayta pul sarflanmasin).
      if (reel.success) checkCache.set(url, reel, 60);
    }

    if (!reel.success) {
      // strictNullChecks o'chirilgan — discriminated union avtomatik narrow bo'lmaydi.
      res.json({ success: false, error: (reel as ReelError).error });
      return;
    }
    if (isTooOld(reel as ReelData)) {
      res.status(400).json({ success: false, error: 'too_old' });
      return;
    }

    const tagged = verifyReelTask(reel as ReelData, isPrem, targetUsername, expectedText);
    if (!tagged) {
      // Keyingi shikoyatlarni logdan aniqlash uchun (qaysi atmetkalar topildi).
      console.log(`[tag-check] vazifa topilmadi isPrem=${isPrem} shortcode=${reel.shortCode} owner=@${reel.ownerUsername}`);
    }

    const existing = await prisma.tagSubmission.findUnique({ where: { shortCode: reel.shortCode } });

    res.json({
      success: true,
      videoName: reel.caption ? reel.caption.slice(0, 140) : reel.shortCode,
      viewCount: reel.viewCount,
      ownerUsername: reel.ownerUsername,
      tagged,
      targetUsername: isPrem ? (expectedText || targetUsername) : targetUsername,
      // Videoda topilgan atmetkalar — mijoz imloviy xatoni (masalan rek25) o'zi ko'rsin.
      foundTags: reel.taggedUsernames.slice(0, 6),
      alreadySubmitted: !!existing,
    });
  } catch (error) {
    console.error('handleCheckTagVideo error:', error);
    res.status(500).json({ success: false, error: 'server_error' });
  }
};

export const handleSubmitTagVideo = withSingleSubmission(async (req, res) => {
  try {
    const pgUser = req.pgUser!;
    const url = String(req.body?.url || '').trim();
    if (!url || !isInstagramVideoUrl(url)) {
      res.status(400).json({ success: false, error: 'invalid_url' });
      return;
    }

    const isPrem = !!req.body?.premium;
    const { targetUsername, expectedText } = await getTagRequirement(isPrem);
    let rewardTiers = await getRewardTiers();
    if (isPrem) {
      const pt = await getCsgoTagRewardTiers();
      if (Array.isArray(pt) && pt.length > 0) rewardTiers = pt;
    }
    if (rewardTiers.length === 0) {
      res.status(400).json({ success: false, error: 'not_configured' });
      return;
    }
    const tagBudget = await getTagBudget(prisma, budgetKeyFor(isPrem ? 'CSGO_TAG' : 'TAG_ONLY'));
    if (tagBudget.enabled && tagBudget.remaining <= 0) {
      res.status(400).json({ success: false, error: 'budget_exhausted' });
      return;
    }

    // Kesh'dan (yaqinda /check chaqirilgan bo'lsa) yoki qayta Apify'dan.
    let reel = checkCache.get<ReelData | ReelError>(url);
    if (!reel) {
      reel = await fetchReelViaApify(url);
    }
    if (!reel.success) {
      res.json({ success: false, error: (reel as ReelError).error });
      return;
    }
    if (isTooOld(reel as ReelData)) {
      res.status(400).json({ success: false, error: 'too_old' });
      return;
    }

    const tagged = verifyReelTask(reel as ReelData, isPrem, targetUsername, expectedText);
    if (!tagged) {
      res.status(400).json({ success: false, error: 'not_tagged' });
      return;
    }

    const existing = await prisma.tagSubmission.findUnique({ where: { shortCode: reel.shortCode } });
    if (existing) {
      res.status(409).json({ success: false, error: 'already_submitted' });
      return;
    }

    const submission = await prisma.tagSubmission.create({
      data: {
        userId: pgUser.id,
        videoUrl: url,
        shortCode: reel.shortCode,
        caption: reel.caption.slice(0, 500),
        targetUsername: isPrem ? (expectedText ? expectedText.slice(0, 100) : targetUsername) : targetUsername,
        method: isPrem ? 'CSGO_TAG' : 'TAG_ONLY',
        // Oddiy atmetka ham endi admin tasdig'idan keyingina kuzatuvga tushadi.
        status: 'PENDING_REVIEW',
        rewardTiers: rewardTiers as any,
        viewCount: reel.viewCount,
      },
    });

    notifyAdminsOfTagSubmission(submission.id, submission.method as any, reel, url, pgUser).catch((e) =>
      console.warn('notifyAdminsOfTagSubmission failed:', e instanceof Error ? e.message : e),
    );

    res.json({ success: true, id: submission.id });
  } catch (error) {
    console.error('handleSubmitTagVideo error:', error);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

export const handleListMyTagSubmissions: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser!;
    const submissions = await prisma.tagSubmission.findMany({
      where: { userId: pgUser.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      success: true,
      submissions: submissions.map((s) => ({
        id: s.id,
        videoUrl: s.videoUrl,
        caption: s.caption,
        viewCount: s.viewCount,
        status: s.status,
        totalPaid: s.totalPaid,
        rewardTiers: s.rewardTiers,
        paidTiers: s.paidTiers,
        createdAt: s.createdAt,
        // Keyingi prosmotr tekshiruvi (faqat kuzatuvdagi videolar uchun).
        nextCheckAt:
          s.status === 'ACTIVE' || s.status === 'TAG_REMOVED'
            ? new Date(s.lastCheckedAt.getTime() + checkIntervalMs(s)).toISOString()
            : null,
      })),
    });
  } catch (error) {
    console.error('handleListMyTagSubmissions error:', error);
    res.status(500).json({ success: false, error: 'server_error' });
  }
};

export const handleGetTagCampaignConfig: RequestHandler = async (_req, res) => {
  try {
    const targetUsername = await getTagTargetUsername();
    const rewardTiers = await getRewardTiers();
    const budget = await getTagBudget();
    const premiumBudget = await getTagBudget(prisma, budgetKeyFor('CSGO_TAG'));
    res.json({ success: true, targetUsername, rewardTiers, enabled: rewardTiers.length > 0, budget, premiumBudget });
  } catch (error) {
    console.error('handleGetTagCampaignConfig error:', error);
    res.status(500).json({ success: false, error: 'server_error' });
  }
};

// ─────────────── CS GO / CS GO + Atmetka ───────────────
// Maxsus reklama roligi bilan tayyorlangan video — atmetka shart emas (CSGO)
// yoki atmetka ham qilingan (CSGO_TAG, ko'proq to'lanadi). Ikkalasi ham
// avtomatik tekshirilmaydi (reklama rolikini aniqlashning ishonchli avtomatik
// usuli yo'q) — admin har bir topshiruvni qo'lda ko'rib, tasdiqlaydi yoki
// rad etadi. Tasdiqlangach umumiy prosmotr-kuzatuv cron'iga qo'shiladi.

export const handleGetCsgoConfig: RequestHandler = async (_req, res) => {
  try {
    const [csgoTiers, csgoTagTiers] = await Promise.all([getCsgoRewardTiers(), getCsgoTagRewardTiers()]);
    const [csgoBudget, csgoTagBudget] = await Promise.all([
      getTagBudget(prisma, budgetKeyFor('CSGO')),
      getTagBudget(prisma, budgetKeyFor('CSGO_TAG')),
    ]);
    res.json({
      success: true,
      csgoTiers,
      csgoTagTiers,
      csgoEnabled: csgoTiers.length > 0,
      csgoTagEnabled: csgoTagTiers.length > 0,
      csgoBudget,
      csgoTagBudget,
    });
  } catch (error) {
    console.error('handleGetCsgoConfig error:', error);
    res.status(500).json({ success: false, error: 'server_error' });
  }
};

export const handleCsgoSubmit = withSingleSubmission(async (req, res) => {
  try {
    const pgUser = req.pgUser!;
    const url = String(req.body?.url || '').trim();
    const method = req.body?.method === 'CSGO_TAG' ? 'CSGO_TAG' : req.body?.method === 'CSGO' ? 'CSGO' : null;
    if (!method) {
      res.status(400).json({ success: false, error: 'invalid_method' });
      return;
    }
    if (!url || !isInstagramVideoUrl(url)) {
      res.status(400).json({ success: false, error: 'invalid_url' });
      return;
    }

    const tiers = method === 'CSGO_TAG' ? await getCsgoTagRewardTiers() : await getCsgoRewardTiers();
    if (tiers.length === 0) {
      res.status(400).json({ success: false, error: 'not_configured' });
      return;
    }
    const csBudget = await getTagBudget(prisma, budgetKeyFor(method));
    if (csBudget.enabled && csBudget.remaining <= 0) {
      res.status(400).json({ success: false, error: 'budget_exhausted' });
      return;
    }

    let reel = checkCache.get<ReelData | ReelError>(url);
    if (!reel) reel = await fetchReelViaApify(url);
    if (!reel.success) {
      res.json({ success: false, error: (reel as ReelError).error });
      return;
    }
    if (isTooOld(reel as ReelData)) {
      res.status(400).json({ success: false, error: 'too_old' });
      return;
    }

    const targetUsername = await getTagTargetUsername();
    if (method === 'CSGO_TAG' && !reel.taggedUsernames.includes(targetUsername)) {
      res.status(400).json({ success: false, error: 'not_tagged' });
      return;
    }

    const existing = await prisma.tagSubmission.findUnique({ where: { shortCode: reel.shortCode } });
    if (existing) {
      res.status(409).json({ success: false, error: 'already_submitted' });
      return;
    }

    const submission = await prisma.tagSubmission.create({
      data: {
        userId: pgUser.id,
        videoUrl: url,
        shortCode: reel.shortCode,
        caption: reel.caption.slice(0, 500),
        targetUsername,
        method,
        status: 'PENDING_REVIEW',
        rewardTiers: tiers as any,
        viewCount: reel.viewCount,
      },
    });

    notifyAdminsOfTagSubmission(submission.id, method, reel, url, pgUser).catch((e) =>
      console.warn('notifyAdminsOfTagSubmission failed:', e instanceof Error ? e.message : e),
    );

    res.json({ success: true, id: submission.id });
  } catch (error) {
    console.error('handleCsgoSubmit error:', error);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtNum = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);

// Har qanday atmetka topshiruvini (Oddiy / CS GO / CS GO+Atmetka) adminlarga
// ✅/❌ tugmalari bilan yuboradi. Video egasining Instagram username'i ham
// ko'rsatiladi — tizim foydalanuvchining IG akkauntini bilmaydi, shuning
// uchun "video haqiqatan shu odamnikimi" degan savolni admin tekshiradi.
async function notifyAdminsOfTagSubmission(
  submissionId: number,
  method: 'TAG_ONLY' | 'CSGO' | 'CSGO_TAG',
  reel: { caption: string; ownerUsername: string; viewCount: number; taggedUsernames: string[] },
  url: string,
  pgUser: { id: number; telegramId: bigint; username?: string | null; firstName?: string | null },
): Promise<void> {
  const bot = getBot();
  const adminIds = getAdminTelegramIds();
  if (!bot || adminIds.length === 0) return;

  // Apify faqat caption'dagi @eslatmani ko'radi (videoga "odam belgilash"
  // overlay'ini qaytarmaydi) — admin buni bilishi uchun manbasi yoziladi.
  const target = await getTagTargetUsername();
  const tagLine =
    method === 'CSGO'
      ? `🏷 Atmetka: shart emas (CS GO)`
      : reel.taggedUsernames.includes(target)
        ? `🏷 Atmetka: ✅ topildi — caption'da @${escapeHtml(target)} yozilgan`
        : `🏷 Atmetka: ❌ topilmadi`;

  const label = method === 'CSGO_TAG' ? "Text qo'shish" : method === 'CSGO' ? 'CS GO' : 'Oddiy atmetka';
  const who = pgUser.username ? `@${pgUser.username}` : pgUser.firstName || String(pgUser.telegramId);
  // MUHIM: caption/username escape qilinmasa, ichida `<`/`&` bo'lganda Telegram
  // xabarni rad etadi va admin topshiruvni umuman ko'rmay qolardi.
  const text =
    `🏷 <b>Yangi topshiruv: ${label}</b>\n\n` +
    `👤 Telegram: ${escapeHtml(who)} (<code>${pgUser.telegramId}</code>)\n` +
    `🎬 Video egasi (Instagram): <b>@${escapeHtml(reel.ownerUsername || '—')}</b>\n` +
    `👁 Hozirgi prosmotr: ${fmtNum(reel.viewCount)}\n` +
    `${tagLine}\n` +
    `🆔 <code>#${submissionId}</code>\n\n` +
    `${reel.caption ? escapeHtml(reel.caption.slice(0, 200)) + '\n\n' : ''}${escapeHtml(url)}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '✅ Tasdiqlash', callback_data: `csgo_review:approve:${submissionId}` },
        { text: '❌ Bekor qilish', callback_data: `csgo_review:reject:${submissionId}` },
      ],
    ],
  };
  for (const adminId of adminIds) {
    let delivered = false;
    try {
      await bot.sendMessage(adminId, text, { parse_mode: 'HTML', reply_markup });
      delivered = true;
    } catch {}
    if (!delivered) {
      const webappToken = process.env.WEBAPP_BOT_TOKEN || '';
      if (webappToken) {
        try {
          await fetch(`https://api.telegram.org/bot${webappToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: adminId, text, parse_mode: 'HTML' }),
          });
        } catch {}
      }
    }
  }
}
