import { RequestHandler } from 'express';
import NodeCache from 'node-cache';
import { prisma } from '../lib/prisma';
import { fetchReelViaApify, isApifyReelConfigured, type ReelData, type ReelError } from '../lib/apify-reel';
import {
  getTagTargetUsername,
  getRewardTiers,
  getCsgoRewardTiers,
  getCsgoTagRewardTiers,
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

    const targetUsername = await getTagTargetUsername();

    let reel = checkCache.get<ReelData | ReelError>(url);
    if (!reel) {
      reel = await fetchReelViaApify(url);
      // Atmetka TOPILGAN natija 2 daqiqa keshlanadi (yuborishda qayta pul sarflanmasin).
      // Topilmagan natija esa atigi 15 soniya: mijoz atmetkani tuzatib qayta bossa,
      // eski "topilmadi" javobi qaytib qolmasin (avval ikkalasi ham 2 daqiqa keshlanardi).
      if (reel.success) checkCache.set(url, reel, reel.taggedUsernames.includes(targetUsername) ? 120 : 15);
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

    const tagged = reel.taggedUsernames.includes(targetUsername);
    if (!tagged) {
      // Keyingi shikoyatlarni logdan aniqlash uchun (qaysi atmetkalar topildi).
      console.log(`[tag-check] topilmadi ${reel.shortCode} owner=@${reel.ownerUsername} kerak=@${targetUsername} topilgan=${JSON.stringify(reel.taggedUsernames)}`);
    }

    const existing = await prisma.tagSubmission.findUnique({ where: { shortCode: reel.shortCode } });

    res.json({
      success: true,
      videoName: reel.caption ? reel.caption.slice(0, 140) : reel.shortCode,
      viewCount: reel.viewCount,
      ownerUsername: reel.ownerUsername,
      tagged,
      targetUsername,
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

    const targetUsername = await getTagTargetUsername();
    const rewardTiers = await getRewardTiers();
    if (rewardTiers.length === 0) {
      res.status(400).json({ success: false, error: 'not_configured' });
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

    if (!reel.taggedUsernames.includes(targetUsername)) {
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
        method: 'TAG_ONLY',
        // Oddiy atmetka ham endi admin tasdig'idan keyingina kuzatuvga tushadi.
        status: 'PENDING_REVIEW',
        rewardTiers: rewardTiers as any,
        viewCount: reel.viewCount,
      },
    });

    notifyAdminsOfTagSubmission(submission.id, 'TAG_ONLY', reel, url, pgUser).catch((e) =>
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
    res.json({ success: true, targetUsername, rewardTiers, enabled: rewardTiers.length > 0 });
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
    res.json({
      success: true,
      csgoTiers,
      csgoTagTiers,
      csgoEnabled: csgoTiers.length > 0,
      csgoTagEnabled: csgoTagTiers.length > 0,
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

  const label = method === 'CSGO_TAG' ? 'CS GO + Atmetka' : method === 'CSGO' ? 'CS GO' : 'Oddiy atmetka';
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
    try {
      await bot.sendMessage(adminId, text, { parse_mode: 'HTML', reply_markup });
    } catch {}
  }
}
