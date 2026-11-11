import TelegramBot from 'node-telegram-bot-api';
import { prisma } from './lib/prisma';
import { createNotification } from './lib/notifications';
import { releaseEscrow, refundEscrow } from './lib/escrow';
import {
  getSubmission,
  getAllSubmissionsForAccount,
  deleteAllSubmissionsForAccount,
  setAwaitingPrice,
  getAwaitingPrice,
  clearAwaitingPrice,
  buildAccountButtons,
  buildAccountCaption,
} from './lib/account-submissions';
import { writeWeeklyHashtag, readWeeklyChannelUrl, writeWeeklyChannelUrl } from './routes/weekly-hashtag';
import { getSellerBot } from './bot';
import { phpBot } from './lib/php-bot-bridge';
import { fetchReelViaApify } from './lib/apify-reel';
import {
  getTagTargetUsername,
  setTagTargetUsername,
  getRewardTiers,
  setRewardTiers,
  getCsgoRewardTiers,
  setCsgoRewardTiers,
  getCsgoTagRewardTiers,
  setCsgoTagRewardTiers,
  parseRewardTiersInput,
  formatRewardTiers,
} from './lib/tag-campaign-config';
import {
  buildStatsPanel,
  parseStatsFilter,
  buildVerifyListPanel,
  buildVerifyAccountPanel,
  buildVerifySearchPanel,
  searchAccounts,
  toggleVerifiedBadge,
  searchUsers,
  buildBalanceSearchPanel,
  buildBalanceUserPanel,
  buildBalanceConfirmPanel,
  applyBalanceOp,
  BALANCE_MAX_AMOUNT,
  type BalanceMode,
  type BalanceOp,
  type Panel,
} from './lib/admin-panels';

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((id) => parseInt(id.trim()))
  .filter((n) => !isNaN(n) && n > 0);

const WEBAPP_URL = process.env.WEBAPP_URL || '';

// /upload kutayotgan userlar — chatId → expiresAt timestamp
const awaitingUpload = new Map<number, number>();
const UPLOAD_WINDOW_MS = 5 * 60 * 1000;

// Eski kutilayotgan yozuvlarni tozalash (har 2 daqiqada)
setInterval(() => {
  const now = Date.now();
  for (const [chatId, expiresAt] of awaitingUpload.entries()) {
    if (expiresAt < now) awaitingUpload.delete(chatId);
  }
}, 2 * 60 * 1000);

// ─────────────── /s_xabar — sotuvchilarga istalgan turdagi xabar ───────────────
// chatId → suhbat holati (xabar mazmuni yig'ilayotgan bosqich).
type BroadcastContent =
  | { kind: 'text'; text: string }
  | { kind: 'photo' | 'video' | 'document' | 'animation'; fileId: string; caption: string };

interface BroadcastFlowState {
  stage: 'awaiting_content' | 'awaiting_button';
  content?: BroadcastContent;
  expiresAt: number;
}

const broadcastFlow = new Map<number, BroadcastFlowState>();
const BROADCAST_WINDOW_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [chatId, flow] of broadcastFlow.entries()) {
    if (flow.expiresAt < now) broadcastFlow.delete(chatId);
  }
}, 2 * 60 * 1000);

// Kelgan xabardan (admin bot chatida) broadcast uchun mazmunni ajratib oladi.
// Boshqa turlar (sticker, ovozli xabar va h.k.) qo'llab-quvvatlanmaydi.
function extractBroadcastContent(msg: TelegramBot.Message): BroadcastContent | null {
  if (msg.photo && msg.photo.length > 0) {
    return { kind: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id, caption: escapeHtml(msg.caption || '') };
  }
  if (msg.video) {
    return { kind: 'video', fileId: msg.video.file_id, caption: escapeHtml(msg.caption || '') };
  }
  if (msg.document) {
    return { kind: 'document', fileId: msg.document.file_id, caption: escapeHtml(msg.caption || '') };
  }
  if (msg.animation) {
    return { kind: 'animation', fileId: msg.animation.file_id, caption: escapeHtml(msg.caption || '') };
  }
  if (msg.text) {
    return { kind: 'text', text: escapeHtml(msg.text) };
  }
  return null;
}

// Media file_id'lar admin bot (TELEGRAM_BOT_TOKEN) tomonida yaratilgan —
// Top_sxema bot (boshqa token) ularni qabul qila olmaydi (file_id botlararo
// o'tkazilmaydi). Avval /api/files/:fileId proksi havolasi berilardi, lekin
// Cloudflare Telegram'ning yuklab olish so'rovini bloklaydi ("failed to get
// HTTP URL content" — 2026-10-02 real testda tasdiqlangan: video HECH BIR
// sotuvchiga yetib bormagan). Endi faylni Telegram'ning o'z fayl serveridan
// yuklab olib, Top_sxema bot'ga Bot API orqali BIR MARTA to'g'ridan-to'g'ri
// yuklaymiz va qaytgan (Top_sxema'ga tegishli) file_id'ni qolgan
// sotuvchilarga qayta ishlatamiz.
const SELLER_BOT_TOKEN = process.env.WEBAPP_BOT_TOKEN || '';

type MediaKind = 'photo' | 'video' | 'document' | 'animation';
const MEDIA_METHOD: Record<MediaKind, string> = {
  photo: 'sendPhoto',
  video: 'sendVideo',
  document: 'sendDocument',
  animation: 'sendAnimation',
};

async function uploadToSellerBot(
  chatId: number,
  kind: MediaKind,
  file: { buffer: Buffer; name: string },
  caption: string,
  replyMarkup: unknown,
): Promise<string | null> {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (caption) {
    fd.append('caption', caption);
    fd.append('parse_mode', 'HTML');
  }
  if (replyMarkup) fd.append('reply_markup', JSON.stringify(replyMarkup));
  fd.append(kind, new Blob([new Uint8Array(file.buffer)]), file.name);
  const res = await fetch(`https://api.telegram.org/bot${SELLER_BOT_TOKEN}/${MEDIA_METHOD[kind]}`, {
    method: 'POST',
    body: fd,
  });
  const data: any = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(data?.description || `HTTP ${res.status}`);
  const r = data.result;
  return (
    r.video?.file_id ||
    r.animation?.file_id ||
    r.document?.file_id ||
    (Array.isArray(r.photo) ? r.photo[r.photo.length - 1]?.file_id : null) ||
    null
  );
}

// PHP relay Telegram rad etsa ham HTTP 200 qaytaradi — haqiqiy natija
// `result.ok` ichida. Uni tekshirmasak, admin "muvaffaqiyatli" degan yolg'on
// hisobot oladi.
function assertRelayOk(res: any): void {
  if (res?.result && res.result.ok === false) {
    throw new Error(res.result.description || 'Telegram rad etdi');
  }
}

// ACTIVE akkaunt egalari (sotuvchilar) ro'yxatini oladi — har biri bir marta.
async function getActiveSellerTgIds(): Promise<number[]> {
  const owners = await prisma.adAccount.findMany({
    where: { status: 'ACTIVE' },
    select: { owner: { select: { telegramId: true } } },
    distinct: ['ownerId'],
  });
  return Array.from(new Set(owners.map((o) => Number(o.owner.telegramId)).filter((id) => id > 0)));
}

// Berilgan mazmunni (matn/foto/video/fayl/GIF, ixtiyoriy tugma bilan) barcha
// ACTIVE sotuvchilarga Top_sxema bot orqali yuboradi — xuddi "Top_sxema bot
// xabarnoma tizimi" kabi, istalgan turdagi xabar bilan ishlaydi.
async function broadcastToActiveSellers(
  adminBot: TelegramBot,
  adminChatId: number,
  content: BroadcastContent,
  replyMarkup: { inline_keyboard: { text: string; url: string }[][] } | null,
): Promise<void> {
  const tgIds = await getActiveSellerTgIds();
  if (tgIds.length === 0) {
    await adminBot.sendMessage(adminChatId, "Hozircha tasdiqlangan (ACTIVE) akkaunt egasi yo'q.").catch(() => {});
    return;
  }

  await adminBot.sendMessage(adminChatId, `⏳ ${tgIds.length} ta sotuvchiga yuborilmoqda...`).catch(() => {});

  const usePhp = phpBot.isReady();
  const sb = usePhp ? null : (getSellerBot() || adminBot);
  // sb bilan adminBot BOSHQA-BOSHQA bot bo'lsa (turli token), file_id
  // botlararo o'tkazilmaydi — shu holatda ham ommaviy URL kerak.
  const crossBot = usePhp || (!!sb && sb !== adminBot);

  // Botlararo media: faylni admin bot orqali Telegram fayl serveridan bir
  // marta yuklab olamiz (Cloudflare'siz, to'g'ridan-to'g'ri api.telegram.org).
  let mediaFile: { buffer: Buffer; name: string } | null = null;
  if (content.kind !== 'text' && crossBot) {
    if (!SELLER_BOT_TOKEN) {
      await adminBot.sendMessage(
        adminChatId,
        "❌ WEBAPP_BOT_TOKEN sozlanmagan — media faylni Top_sxema botga yuklab bo'lmaydi. Faqat matn yuborishingiz mumkin.",
      ).catch(() => {});
      return;
    }
    try {
      const link = await adminBot.getFileLink(content.fileId);
      const res = await fetch(link);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mediaFile = {
        buffer: Buffer.from(await res.arrayBuffer()),
        name: link.split('/').pop() || content.kind,
      };
    } catch (e: any) {
      const tooBig = /too big/i.test(String(e?.message));
      await adminBot.sendMessage(
        adminChatId,
        tooBig
          ? "❌ Fayl 20 MB dan katta — Telegram bot API bunday faylni yuklab olishga ruxsat bermaydi. Kichikroq fayl yuboring."
          : `❌ Media faylni yuklab bo'lmadi: ${escapeHtml(String(e?.message || e))}`,
      ).catch(() => {});
      return;
    }
  }

  // Top_sxema bot'ga birinchi muvaffaqiyatli yuklashdan keyin olingan file_id —
  // qolgan sotuvchilarga faylni qayta yuklamasdan shu orqali yuboramiz.
  let sellerFileId: string | null = null;

  let ok = 0;
  let fail = 0;
  let lastError = '';
  for (const tgId of tgIds) {
    try {
      if (content.kind === 'text') {
        if (usePhp) assertRelayOk(await phpBot.sendMessage(tgId, content.text, { replyMarkup: replyMarkup || undefined }));
        else await sb!.sendMessage(tgId, content.text, { parse_mode: 'HTML', reply_markup: replyMarkup || undefined });
      } else if (crossBot && !sellerFileId) {
        sellerFileId = await uploadToSellerBot(tgId, content.kind, mediaFile!, content.caption, replyMarkup);
      } else {
        const media = crossBot ? sellerFileId! : content.fileId;
        if (usePhp) {
          const opts = { caption: content.caption, replyMarkup: replyMarkup || undefined };
          let res: any;
          if (content.kind === 'photo') res = await phpBot.sendPhoto(tgId, media, opts);
          else if (content.kind === 'video') res = await phpBot.sendVideo(tgId, media, opts);
          else if (content.kind === 'document') res = await phpBot.sendDocument(tgId, media, opts);
          else res = await phpBot.sendAnimation(tgId, media, opts);
          assertRelayOk(res);
        } else {
          const sendOpts: any = { caption: content.caption, parse_mode: 'HTML', reply_markup: replyMarkup || undefined };
          if (content.kind === 'photo') await sb!.sendPhoto(tgId, media, sendOpts);
          else if (content.kind === 'video') await sb!.sendVideo(tgId, media, sendOpts);
          else if (content.kind === 'document') await sb!.sendDocument(tgId, media, sendOpts);
          else await sb!.sendAnimation(tgId, media, sendOpts);
        }
      }
      ok++;
    } catch (e: any) {
      fail++;
      lastError = String(e?.message || e);
    }
    // Telegram Bot API global limiti (~30 xabar/soniya) — sekinlashtiramiz.
    await new Promise((r) => setTimeout(r, 60));
  }

  await adminBot.sendMessage(
    adminChatId,
    `✅ <b>Xabar yuborish yakunlandi</b>\n\n✔️ Muvaffaqiyatli: <b>${ok}</b>\n❌ Xato: <b>${fail}</b>` +
      (fail > 0 && lastError ? `\n\n<i>Oxirgi xato: ${escapeHtml(lastError)}</i>` : ''),
    { parse_mode: 'HTML' },
  ).catch(() => {});
}

function isAdminChat(chatId: number): boolean {
  return ADMIN_IDS.includes(chatId);
}

async function isAdminUserId(telegramId: number): Promise<boolean> {
  if (isAdminChat(telegramId)) return true;
  try {
    const u = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      select: { role: true },
    });
    return u?.role === 'ADMIN';
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n);
}

function accountAdminCard(acc: any): string {
  const frozen = acc.frozenUntil ? new Date(acc.frozenUntil) : null;
  const isFrozen = frozen && frozen > new Date();
  const statusEmoji =
    acc.status === 'ACTIVE' && !isFrozen ? '✅' :
    acc.status === 'PENDING' ? '⏳' :
    acc.status === 'BANNED' ? '⛔️' : '🧊';
  return (
    `${statusEmoji} <b>@${escapeHtml(acc.igUsername)}</b>\n` +
    `🆔 <code>#${acc.id}</code> · 👤 owner ${acc.ownerId}\n` +
    `👥 Obunachilar: <code>${fmtNumber(acc.followers || 0)}</code>\n` +
    `💰 Reels: <code>${fmtNumber(acc.priceReels || 0)}</code> so'm\n` +
    `📊 Status: <b>${acc.status}</b>${isFrozen ? ` (muzlatilgan, tugaydi ${frozen!.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''}\n` +
    `📅 Qo'shilgan: ${new Date(acc.createdAt).toISOString().slice(0, 10)}`
  );
}

// ─────────────── Admin sozlamalari — YAGONA step tizimi ───────────────
// Barcha "qiymat kiriting" turidagi admin sozlamalari (atmetka, komissiya,
// qidiruv, haftalik xeshteg) shu bitta Map orqali ishlaydi: tugma bosiladi →
// bot nima kiritish kerakligini so'raydi (+ inline "❌ Bekor qilish") →
// keyingi oddiy matn xabar qiymat sifatida qabul qilinadi. Hech qanday
// slash-komanda kerak emas — Top_sxema bot'dagi step tizimiga o'xshab.
type AdminFlowKind =
  | 'atmetka_user'
  | 'atmetka_budget'
  | 'atmetka_tiers'
  | 'atmetka_csgo_tiers'
  | 'atmetka_csgo_tag_tiers'
  | 'commission'
  | 'search'
  | 'weekly_hashtag'
  | 'weekly_channel'
  | 'payout_min'
  | 'payout_max'
  | 'tag_reject_reason'
  | 'balance_search'
  | 'balance_amount'
  | 'balance_reason'
  | 'verify_search';
interface AdminFlowState {
  kind: AdminFlowKind;
  expiresAt: number;
  // Qo'shimcha kontekst (masalan rad etilayotgan topshiruv va admin xabari).
  submissionId?: number;
  messageId?: number;
  // 💼 Atmetka budjeti oqimi — qaysi usul uchun (TAG_ONLY / CSGO / CSGO_TAG)
  method?: string;
  // 💳 Balans oqimi
  balanceUserId?: number;
  balanceMode?: BalanceMode;
  balanceAmount?: number;
}
const adminFlow = new Map<number, AdminFlowState>();
const ADMIN_FLOW_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [chatId, flow] of adminFlow.entries()) {
    if (flow.expiresAt < now) adminFlow.delete(chatId);
  }
}, 2 * 60 * 1000);

// Har qanday step-flow (adminFlow, broadcastFlow, awaitingUpload) uchun
// ishlatiladigan yagona "❌ Bekor qilish" inline tugmasi.
// Nakrutka aniqlanganda foydalanuvchi shuncha vaqt marketplace/atmetkadan foydalana olmaydi.
const NAKRUTKA_BAN_MS = 7 * 24 * 60 * 60 * 1000;

const CANCEL_BUTTON = { inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'flow:cancel' }]] };

// ─────────────── Atmetka kampaniyasi budjeti ───────────────
// Admin har bir usul uchun ajratilgan pul limitini belgilaydi. Cron to'lov
// qilganda `spent`ni oshiradi; limit tugasa yangi videolar qabul qilinmaydi.
const TAG_BUDGET_KEY = 'tag_campaign_budget_v1';
const BUDGET_KEYS: Record<string, string> = {
  TAG_ONLY: TAG_BUDGET_KEY,
  CSGO: 'tag_campaign_budget_csgo_v1',
  CSGO_TAG: 'tag_campaign_budget_csgo_tag_v1',
};
const BUDGET_LABELS: Record<string, string> = {
  TAG_ONLY: 'Oddiy atmetka',
  CSGO: 'CS GO',
  CSGO_TAG: 'CS GO + Atmetka',
};

interface TagBudgetView {
  enabled: boolean;
  total: number;
  spent: number;
  remaining: number;
}

async function readTagBudget(method: string = 'TAG_ONLY'): Promise<TagBudgetView> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: BUDGET_KEYS[method] || TAG_BUDGET_KEY } });
    const v = row ? JSON.parse(row.value) : null;
    const total = Math.max(0, Math.floor(Number(v?.total) || 0));
    const spent = Math.min(total, Math.max(0, Math.floor(Number(v?.spent) || 0)));
    return { enabled: total > 0, total, spent, remaining: Math.max(0, total - spent) };
  } catch {
    return { enabled: false, total: 0, spent: 0, remaining: 0 };
  }
}

async function writeTagBudget(total: number, method: string = 'TAG_ONLY'): Promise<void> {
  const key = BUDGET_KEYS[method] || TAG_BUDGET_KEY;
  const value = JSON.stringify({
    total: Math.max(0, Math.floor(total)),
    spent: 0,
    setAt: new Date().toISOString(),
  });
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

function formatTagBudget(b: TagBudgetView): string {
  const f = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
  if (!b.enabled) return '💼 Ajratilgan pul: cheklanmagan';
  return `💼 Ajratilgan: <b>${f(b.total)}</b> · to'langan: <b>${f(b.spent)}</b> · qolgan: <b>${f(b.remaining)}</b> so'm${b.remaining <= 0 ? ' — ⛔ tugagan' : ''}`;
}

// Admin pastki menyusi tugmalari (bot.ts ADMIN_REPLY_KEYBOARD bilan bir xil).
const ADMIN_MENU_TEXTS = new Set([
  '🏠 Bosh panel', '🏷 Atmetka', '🔖 Heshteg', '💰 Komissiya', '🔍 Qidirish',
  '📊 Statistika', '☑️ Verify', '💳 Balans', '📨 Xabar yuborish', '📤 Media yuklash',
]);

async function renderAtmetkaPanel(bot: TelegramBot, chatId: number, messageId?: number): Promise<void> {
  const [username, tiers, csgoTiers, csgoTagTiers, activeCount, csgoPendingCount, totalPaidAgg] = await Promise.all([
    getTagTargetUsername(),
    getRewardTiers(),
    getCsgoRewardTiers(),
    getCsgoTagRewardTiers(),
    prisma.tagSubmission.count({ where: { status: 'ACTIVE' } }),
    prisma.tagSubmission.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.tagSubmission.aggregate({ _sum: { totalPaid: true } }),
  ]);
  const [budgetTag] = await Promise.all([readTagBudget('TAG_ONLY')]);
  const totalPaid = totalPaidAgg._sum.totalPaid || 0;
  const text =
    `🏷 <b>Atmetka qilish kampaniyasi</b>\n\n` +
    `🎯 Maqsad: <code>@${username}</code>\n\n` +
    `1️⃣ <b>Oddiy atmetka — bosqichlar:</b>\n${formatRewardTiers(tiers)}\n` +
    `${formatTagBudget(budgetTag)}\n\n` +
    `📊 Aktiv postlar: <b>${activeCount}</b>\n` +
    `🕓 Tasdiq kutayotgan videolar: <b>${csgoPendingCount}</b>\n` +
    `💵 Jami to'langan: <b>${fmtNumber(totalPaid)}</b> so'm`;
  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🎯 Maqsad username', callback_data: 'atmetka:set_user' }],
      [
        { text: '1️⃣ Oddiy: ✏️ prosmotr/narx', callback_data: 'atmetka:set_tiers' },
        { text: '💼 Pul', callback_data: 'atmetka:set_budget:TAG_ONLY' },
      ],
      [{ text: '🔄 Yangilash', callback_data: 'atmetka:refresh' }],
    ],
  };
  if (messageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    }).catch(() => {
      // Matn o'zgarmagan bo'lsa Telegram xato beradi — yangi xabar yuboramiz.
      bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: replyMarkup }).catch(() => {});
    });
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: replyMarkup }).catch(() => {});
  }
}

function accountAdminButtons(acc: any) {
  const id = acc.id;
  return {
    inline_keyboard: [
      [
        { text: '🧊 1 kun', callback_data: `mkt:admin:freeze:${id}:1` },
        { text: '🧊 7 kun', callback_data: `mkt:admin:freeze:${id}:7` },
        { text: '🧊 30 kun', callback_data: `mkt:admin:freeze:${id}:30` },
      ],
      [
        { text: '▶️ Faollashtirish', callback_data: `mkt:admin:unfreeze:${id}:0` },
        { text: '🗑 O\'chirish', callback_data: `mkt:admin:delete:${id}:0` },
      ],
    ],
  };
}

/**
 * Marketplace bot handler'lari. Ikki bot ishlatamiz:
 *  - adminBot (insaybbot): admin xabarlari va tugmalari (mkt:verify, mkt:admin),
 *    🔍 Qidirish, 📝 Haftalik xeshteg, 📤 Media yuklash, narx kiritish.
 *  - sellerBot (Top_sxema_instagrambot): seller/buyer xabarlari va tugmalari
 *    (mkt:owner — narx rozilik, kelajakda order ham). sellerBot null bo'lsa
 *    fallback qilib adminBot ishlatiladi (yagona bot rejimi).
 */
export function initMarketplaceBot(bot: TelegramBot, sellerBot: TelegramBot | null = null): void {
  // Owner-tomon callback handler'ni qaysi bot'da ishlatish kerakligini aniqlaymiz.
  // Agar sellerBot ulangan bo'lsa — undagi callback'ni tinglaymiz.
  const ownerBot = sellerBot || bot;
  ownerBot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('mkt:owner:')) return;
    const fromTgId = query.from.id;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId || !messageId) {
      try { await ownerBot.answerCallbackQuery(query.id, { text: '❌ Xato kontekst' }); } catch {}
      return;
    }
    try {
      const parts = data.split(':');
      const action = parts[2];
      const accountId = Number(parts[3]);
      await handleOwnerConsentCallback(ownerBot, query, action, accountId, chatId, messageId, fromTgId);
    } catch (err) {
      console.error('mkt:owner callback error:', err);
    }
  });
  // ─────────────── 📤 Media yuklash — reply-tugma orqali ───────────────
  bot.on('message', async (msg) => {
    if (msg.text !== '📤 Media yuklash') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    awaitingUpload.set(chatId, Date.now() + UPLOAD_WINDOW_MS);
    try {
      await bot.sendMessage(
        chatId,
        'Iltimos, hozir foto yoki video yuboring. Men sizga file_id qaytaraman.\n\n_5 daqiqa ichida yuboring._',
        { parse_mode: 'Markdown', reply_markup: CANCEL_BUTTON },
      );
    } catch (err) {
      console.warn('upload reply failed:', err instanceof Error ? err.message : err);
    }
  });

  // Photo / video / document — faqat awaitingUpload da bo'lsa javob beramiz
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const expiresAt = awaitingUpload.get(chatId);
    if (!expiresAt) return;
    if (expiresAt < Date.now()) {
      awaitingUpload.delete(chatId);
      return;
    }

    let fileId: string | null = null;
    let mediaKind = '';

    if (msg.photo && msg.photo.length > 0) {
      // Eng katta o'lchamdagini olamiz
      fileId = msg.photo[msg.photo.length - 1].file_id;
      mediaKind = 'Foto';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      mediaKind = 'Video';
    } else if (msg.document) {
      fileId = msg.document.file_id;
      mediaKind = 'Hujjat';
    } else if (msg.animation) {
      fileId = msg.animation.file_id;
      mediaKind = 'GIF';
    }

    if (!fileId) return; // Boshqa turdagi xabarni qabul qilmaymiz (matn, sticker va h.k.)

    awaitingUpload.delete(chatId);

    try {
      await bot.sendMessage(
        chatId,
        `📎 <b>File ID</b> (${escapeHtml(mediaKind)})\n\n<code>${escapeHtml(fileId)}</code>\n\nWebApp'ga ko'chiring.`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      console.warn('/upload result reply failed:', err instanceof Error ? err.message : err);
    }
  });

  // ─────────────── /200uzs — "o'ylayapti" uslubidagi animatsion loader ───────────────
  // Telegram'dagi AI botlar kabi: tepada "yozmoqda...", animatsion premium emoji +
  // har soniyada o'sadigan taymer, so'ng javob harfma-harf "oqib" chiqadi.
  // Asosiy yo'l — sendMessageDraft (Telegram yangi bo'laklarni xira paydo bo'lish
  // effekti bilan o'zi chizadi). Telegram rad etsa — editMessageText bilan zaxira
  // (soniyasiga ~1 tahrir cheklovi sababli so'zma-so'z, effektsiz).
  bot.onText(/^\/200uzs(?:@\w+)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    const EMOJI = '<tg-emoji emoji-id="5451636889717062286">✨</tg-emoji>';
    // Instagram logosi + "Tayyorlanmoqda..." animatsion yozuvi (t.me/addemoji/topsxema200,
    // so'z 6 ta emojiga bo'lingan — tartibi muhim).
    const IG = '<tg-emoji emoji-id="5319160079465857105">📱</tg-emoji>';
    const PREPARING = [
      '5398078480032245269', '5395469910170185023', '5397776672680357814',
      '5398050614284429370', '5397977539710855081', '5398005572962396047',
    ].map((id) => `<tg-emoji emoji-id="${id}">⏳</tg-emoji>`).join('');
    const TOTAL_SEC = 5;
    const loaderText = (sec: number) => `${IG} ${PREPARING}
<i>${sec}s</i>`;
    const ANSWER = `Tayyor! Hammasi professional ishlamoqda — so'rovingiz ${TOTAL_SEC} soniyada bajarildi.`;
    const finalText = `${EMOJI} <b>${ANSWER}</b>`;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const token = (bot as any).token as string;
    const draftId = Date.now() % 2_000_000_000 || 1;
    const sendDraft = async (text: string): Promise<boolean> => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessageDraft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, draft_id: draftId, text, parse_mode: 'HTML' }),
          signal: AbortSignal.timeout(5000),
        });
        const j: any = await res.json().catch(() => null);
        if (!j?.ok) console.warn('/200uzs sendMessageDraft:', j?.description || res.status);
        return !!j?.ok;
      } catch {
        return false;
      }
    };

    try {
      bot.sendChatAction(chatId, 'typing').catch(() => {});

      if (await sendDraft(loaderText(0))) {
        for (let sec = 1; sec <= TOTAL_SEC; sec++) {
          await sleep(1000);
          await sendDraft(loaderText(sec));
        }
        // Javobni bo'lak-bo'lak oqizamiz (har ~90 ms da 3 belgi).
        for (let i = 3; i < ANSWER.length; i += 3) {
          await sendDraft(`${EMOJI} <b>${escapeHtml(ANSWER.slice(0, i))}</b>`);
          await sleep(90);
        }
        await bot.sendMessage(chatId, finalText, { parse_mode: 'HTML' });
        return;
      }

      // Zaxira: oddiy xabar + tahrirlash.
      const sent = await bot.sendMessage(chatId, loaderText(0), { parse_mode: 'HTML' });
      const edit = (text: string) =>
        bot
          .editMessageText(text, { chat_id: chatId, message_id: sent.message_id, parse_mode: 'HTML' })
          .catch(() => {}); // 429 yoki "not modified" — keyingi qadamda davom etadi
      for (let sec = 1; sec <= TOTAL_SEC; sec++) {
        await sleep(1000);
        // "yozmoqda" holati ~5 s yashaydi — taymer davomida yangilab turamiz.
        if (sec % 4 === 0) bot.sendChatAction(chatId, 'typing').catch(() => {});
        await edit(loaderText(sec));
      }
      const words = ANSWER.split(' ');
      for (let i = 2; i < words.length; i += 2) {
        await edit(`${EMOJI} <b>${escapeHtml(words.slice(0, i).join(' '))}</b>`);
        await sleep(1000);
      }
      await edit(finalText);
    } catch (err) {
      console.warn('/200uzs failed:', err instanceof Error ? err.message : err);
    }
  });

  // ─────────────── /triggertest — interaktiv marketplace cycle boshlash ───────────────
  bot.onText(/^\/triggertest(?:@\w+)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    try {
      const owner = await prisma.user.upsert({
        where: { telegramId: BigInt(chatId) },
        update: {},
        create: { telegramId: BigInt(chatId), firstName: 'CycleTest', username: 'admin' },
      });
      const igUsername = `cycle_test_${Date.now().toString().slice(-6)}`;
      const account = await prisma.adAccount.create({
        data: {
          ownerId: owner.id,
          igUsername,
          niche: 'LIFESTYLE',
          region: 'Toshkent',
          description: 'E2E test akkaunti',
          followers: 50000,
          avgReelsViews: 25000,
          storyViews: 10000,
          avatarFileId: 'https://picsum.photos/seed/cycleavatar/400/400',
          verificationScreenshots: [
            'https://picsum.photos/seed/cycle1/440/780',
            'https://picsum.photos/seed/cycle2/440/780',
            'https://picsum.photos/seed/cycle3/440/780',
          ],
          status: 'PENDING',
        },
      });
      // Real notifyAdminsOfNewAccount() — sub state saqlanadi, narx oqimi ishlaydi
      const { notifyAdminsOfNewAccount } = await import('./routes/marketplace/accounts');
      await notifyAdminsOfNewAccount(account, '@admin (cycle test)');
      await bot.sendMessage(
        chatId,
        `🎬 <b>Interaktiv cycle boshlandi (#${account.id} @${igUsername})</b>\n\n` +
          `<b>Qadamlar:</b>\n` +
          `1️⃣ Yuqoridagi tugmalardan 💰 <b>Narx belgilash</b> → raqam yuboring → ✅ <b>Tasdiqlash</b>\n` +
          `2️⃣ @Top_sxema_instagrambot ga "narx belgilandi" xabari keladi → ✅ <b>Roziman</b>\n` +
          `3️⃣ Marketplace WebApp'da @${igUsername} ga REELS buyurtma bering va to'lang\n` +
          `4️⃣ @Top_sxema_instagrambot ga "Yangi buyurtma" + 📸 tugma keladi → 📸 bosing\n` +
          `5️⃣ Istalgan rasm yuboring (skrinshot)\n` +
          `6️⃣ Buyer'ga (siz) rasm + ✅/❌ keladi → ✅ <b>Tasdiqlayman</b>\n` +
          `7️⃣ Order COMPLETED, wallet kredit\n\n` +
          `<i>Tozalash: "🔍 Qidirish" tugmasi → ${igUsername} → 🗑</i>`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      console.error('/triggertest error:', err);
      await bot.sendMessage(chatId, '❌ Cycle boshlanmadi: ' + (err instanceof Error ? err.message : 'noma\'lum'));
    }
  });

  // ─────────────── Yagona "❌ Bekor qilish" callback — barcha step-flow'lar uchun ───────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'flow:cancel') return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    adminFlow.delete(chatId);
    broadcastFlow.delete(chatId);
    awaitingUpload.delete(chatId);
    if (messageId) {
      await bot.editMessageText('🚫 Bekor qilindi', { chat_id: chatId, message_id: messageId }).catch(() => {});
    }
    await bot.answerCallbackQuery(query.id, { text: 'Bekor qilindi' }).catch(() => {});
  });

  // ─────────────── 🏷 Atmetka — inline-tugma/step tizimida sozlash paneli ───────────────
  bot.on('message', async (msg) => {
    if (msg.text !== '🏷 Atmetka') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    adminFlow.delete(chatId);
    await renderAtmetkaPanel(bot, chatId);
  });

  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('atmetka:')) return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!(await isAdminUserId(chatId))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    const action = data.slice('atmetka:'.length);
    try {
      if (action === 'refresh') {
        adminFlow.delete(chatId);
        await renderAtmetkaPanel(bot, chatId, messageId);
        await bot.answerCallbackQuery(query.id).catch(() => {});
        return;
      }
      if (action === 'set_user') {
        adminFlow.set(chatId, { kind: 'atmetka_user', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        const current = await getTagTargetUsername();
        await bot.editMessageText(
          `🎯 <b>Maqsad username'ni o'zgartirish</b>\n\n` +
          `Hozirgi: <code>@${current}</code>\n\n` +
          `Yangi username'ni (@ belgisi shart emas) shu chatga yozib yuboring.\n\n` +
          `<i>Bu FAQAT yangi topshiriladigan postlarga ta'sir qiladi — allaqachon faol postlar eski maqsad bilan tekshirilishda davom etadi.</i>`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
        await bot.answerCallbackQuery(query.id).catch(() => {});
        return;
      }
      if (action === 'set_budget' || action.startsWith('set_budget:')) {
        const bMethod = BUDGET_KEYS[action.split(':')[1]] ? action.split(':')[1] : 'TAG_ONLY';
        adminFlow.set(chatId, { kind: 'atmetka_budget', method: bMethod, expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        const cur = await readTagBudget(bMethod);
        await bot.editMessageText(
          `💼 <b>${BUDGET_LABELS[bMethod]} uchun ajratilgan pul</b>\n\n` +
          `Hozirgi holat:\n${formatTagBudget(cur)}\n\n` +
          `Yangi summani so'mda yuboring, masalan: <code>1000000</code>\n\n` +
          `<i>Yangi summa kiritilganda hisob qaytadan boshlanadi (to'langan = 0). Pul tugaganda yangi videolar qabul qilinmaydi.</i>\n` +
          `<i>Cheklovni o'chirish uchun <code>0</code> yuboring.</i>`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
        await bot.answerCallbackQuery(query.id).catch(() => {});
        return;
      }
      if (action === 'set_tiers') {
        adminFlow.set(chatId, { kind: 'atmetka_tiers', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        const current = await getRewardTiers();
        await bot.editMessageText(
          `💰 <b>Prosmotr bosqichlarini sozlash</b>\n\n` +
          `Hozirgi:\n${formatRewardTiers(current)}\n\n` +
          `Yangi jadvalni shu formatda yuboring:\n<code>1000:5000,5000:20000,10000:50000</code>\n` +
          `<i>(prosmotr:so'm, vergul bilan ajratib, bir nechta bosqich)</i>\n\n` +
          `<i>Bu FAQAT yangi topshiriladigan postlarga ta'sir qiladi — allaqachon faol postlar topshirilgan paytdagi eski jadval bilan davom etadi.</i>`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
        await bot.answerCallbackQuery(query.id).catch(() => {});
        return;
      }
      if (action === 'set_csgo_tiers') {
        adminFlow.set(chatId, { kind: 'atmetka_csgo_tiers', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        const current = await getCsgoRewardTiers();
        await bot.editMessageText(
          `🎮 <b>CS GO bosqichlarini sozlash</b>\n\n` +
          `Hozirgi:\n${formatRewardTiers(current)}\n\n` +
          `Yangi jadvalni shu formatda yuboring:\n<code>1000:5000,5000:20000,10000:50000</code>\n` +
          `<i>(prosmotr:so'm, vergul bilan ajratib, bir nechta bosqich)</i>\n\n` +
          `<i>Bu FAQAT yangi topshiriladigan videolarga ta'sir qiladi.</i>`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
        await bot.answerCallbackQuery(query.id).catch(() => {});
        return;
      }
      if (action === 'set_csgo_tag_tiers') {
        adminFlow.set(chatId, { kind: 'atmetka_csgo_tag_tiers', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        const current = await getCsgoTagRewardTiers();
        await bot.editMessageText(
          `🎮🏷 <b>CS GO + Atmetka bosqichlarini sozlash</b>\n\n` +
          `Hozirgi:\n${formatRewardTiers(current)}\n\n` +
          `Yangi jadvalni shu formatda yuboring:\n<code>1000:8000,5000:30000,10000:70000</code>\n` +
          `<i>(prosmotr:so'm, vergul bilan ajratib, bir nechta bosqich)</i>\n\n` +
          `<i>Bu FAQAT yangi topshiriladigan videolarga ta'sir qiladi.</i>`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
        await bot.answerCallbackQuery(query.id).catch(() => {});
        return;
      }
      await bot.answerCallbackQuery(query.id).catch(() => {});
    } catch (e) {
      await bot.answerCallbackQuery(query.id, { text: '❌ Xato' }).catch(() => {});
    }
  });

  // ─────────────── 🚩 Shubhali prosmotr (nakrutka filtri) — admin qarori ───────────────
  // tag-campaign-cron layk/izoh juda kam bo'lgan videoning to'lovini ushlab,
  // shu tugmalar bilan adminga yuboradi.
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('tagrev:')) return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!(await isAdminUserId(query.from.id))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    const [, action, idStr] = data.split(':');
    const submissionId = Number(idStr);
    try {
      const submission = await prisma.tagSubmission.findUnique({ where: { id: submissionId }, include: { user: true } });
      if (!submission || submission.status !== 'ACTIVE') {
        await bot.answerCallbackQuery(query.id, { text: "Allaqachon ko'rib chiqilgan", show_alert: true }).catch(() => {});
        return;
      }
      const original = query.message?.text || '';
      if (action === 'pay') {
        await prisma.tagSubmission.update({
          where: { id: submissionId },
          data: { viewsTrusted: true, reviewHeldAt: null },
        });
        if (messageId) {
          await bot.editMessageText(`${escapeHtml(original)}\n\n✅ <b>Haqiqiy deb tasdiqlandi — to'lanmoqda</b>`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', disable_web_page_preview: true,
          }).catch(() => {});
        }
        // Darhol qayta tekshirib, ushlangan bosqichlarni to'laymiz.
        const { checkOneSubmission } = await import('./lib/tag-campaign-cron');
        await checkOneSubmission(submissionId);
        await bot.answerCallbackQuery(query.id, { text: "✅ To'landi" }).catch(() => {});
        return;
      }
      if (action === 'reject') {
        const bannedUntil = new Date(Date.now() + NAKRUTKA_BAN_MS);
        const res = await prisma.$transaction(async (tx) => {
          const r = await tx.tagSubmission.updateMany({
            where: { id: submissionId, status: 'ACTIVE' },
            data: { status: 'REJECTED', reviewHeldAt: null },
          });
          // Nakrutka — 1 hafta foydalanish taqiqi.
          if (r.count > 0) {
            await tx.user.update({
              where: { id: submission.userId },
              data: { bannedUntil, banReason: "nakrutka (sun'iy prosmotr)" },
            });
          }
          return r;
        });
        if (res.count === 0) {
          await bot.answerCallbackQuery(query.id, { text: "Allaqachon ko'rib chiqilgan", show_alert: true }).catch(() => {});
          return;
        }
        if (messageId) {
          await bot.editMessageText(`${escapeHtml(original)}\n\n🚫 <b>Rad etildi (nakrutka) — foydalanuvchi 1 haftaga bloklandi</b>`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', disable_web_page_preview: true,
          }).catch(() => {});
        }
        const notifyText =
          `❌ <b>Videongiz tekshiruvdan o'tmadi</b>\n\n` +
          `Prosmotrlar soni layk va izohlarga mos kelmadi (sun'iy prosmotr belgilari aniqlandi), shu sabab to'lov amalga oshirilmaydi.\n\n` +
          `⛔ Nakrutka uchun hisobingiz <b>1 haftaga</b> bloklandi.\n\n` +
          `🔗 ${escapeHtml(submission.videoUrl)}`;
        const chat = Number(submission.user.telegramId);
        if (phpBot.isReady()) await phpBot.sendMessage(chat, notifyText).catch(() => {});
        else await (getSellerBot() || bot).sendMessage(chat, notifyText, { parse_mode: 'HTML' }).catch(() => {});
        await bot.answerCallbackQuery(query.id, { text: '🚫 Rad etildi' }).catch(() => {});
        return;
      }
      await bot.answerCallbackQuery(query.id).catch(() => {});
    } catch (e) {
      console.error('tagrev callback error:', e);
      await bot.answerCallbackQuery(query.id, { text: '❌ Xato' }).catch(() => {});
    }
  });

  // Atmetka topshiruvini rad etadi; reason berilsa video egasiga aynan shu
  // sabab yuboriladi, aks holda umumiy matn. Holat shart bilan almashtiriladi —
  // ikki admin bir vaqtda bossa ham foydalanuvchi bitta xabar oladi.
  async function rejectTagSubmission(
    submissionId: number,
    reason: string | null,
    adminChatId: number,
    adminMessageId?: number,
  ): Promise<boolean> {
    const submission = await prisma.tagSubmission.findUnique({ where: { id: submissionId }, include: { user: true } });
    if (!submission) return false;
    const flip = await prisma.tagSubmission.updateMany({
      where: { id: submissionId, status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED' },
    });
    if (flip.count !== 1) return false;
    const label =
      submission.method === 'CSGO_TAG' ? 'CS GO + Atmetka' : submission.method === 'CSGO' ? 'CS GO' : 'Oddiy atmetka';
    if (adminMessageId) {
      await bot.editMessageText(
        `❌ <b>${label} rad etildi</b> (#${submissionId})` +
          (reason ? `\n\n📝 Sabab: <i>${escapeHtml(reason)}</i>` : `\n\n<i>Izohsiz rad etildi</i>`) +
          `\n\n🔗 ${escapeHtml(submission.videoUrl)}`,
        { chat_id: adminChatId, message_id: adminMessageId, parse_mode: 'HTML', disable_web_page_preview: true },
      ).catch(() => {});
    }
    const notifyText =
      `❌ <b>${label}</b> videongiz rad etildi.\n\n` +
      (reason
        ? `📝 <b>Sabab:</b> ${escapeHtml(reason)}`
        : submission.method === 'TAG_ONLY'
          ? `Video talablarga javob bermadi (masalan, video sizga tegishli emas yoki atmetka noto'g'ri).`
          : `Reklama roligi talablarga javob bermagan bo'lishi mumkin.`) +
      `\n\n🔗 ${escapeHtml(submission.videoUrl)}`;
    const chat = Number(submission.user.telegramId);
    if (phpBot.isReady()) {
      await phpBot.sendMessage(chat, notifyText).catch(() => {});
    } else {
      const targetBot = getSellerBot() || bot;
      await targetBot.sendMessage(chat, notifyText, { parse_mode: 'HTML' } as any).catch(() => {});
    }
    return true;
  }

  // ─────────────── 🏷 Atmetka topshiruvlarini (Oddiy / CS GO / CS GO+Atmetka) admin tasdiqlash/rad etish ───────────────
  // Callback prefiksi tarixiy sabab bilan `csgo_review:` (allaqachon yuborilgan
  // tugmalar ishlashda davom etishi uchun o'zgartirilmadi) — uchala usul uchun.
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('csgo_review:')) return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!(await isAdminUserId(chatId))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    const [, action, idStr] = data.split(':');
    const submissionId = Number(idStr);
    try {
      const submission = await prisma.tagSubmission.findUnique({ where: { id: submissionId }, include: { user: true } });
      if (!submission || submission.status !== 'PENDING_REVIEW') {
        await bot.answerCallbackQuery(query.id, { text: 'Bu topshiruv allaqachon ko\'rib chiqilgan' }).catch(() => {});
        return;
      }
      const label =
        submission.method === 'CSGO_TAG' ? 'CS GO + Atmetka' : submission.method === 'CSGO' ? 'CS GO' : 'Oddiy atmetka';
      if (action === 'approve') {
        // Tasdiqlashdan oldin atmetkani QAYTA tekshiramiz: foydalanuvchi
        // atmetka qo'yib yuborib, keyin o'chirib qo'yishi mumkin (tasdiq
        // kutayotgan videolar cron tomonidan tekshirilmaydi). Apify 30 s
        // gacha olishi mumkin — callback'ga darhol javob beramiz.
        if (submission.method !== 'CSGO') {
          await bot.answerCallbackQuery(query.id, { text: '⏳ Atmetka qayta tekshirilmoqda...' }).catch(() => {});
          const reel = await fetchReelViaApify(submission.videoUrl);
          let problem = '';
          if (!reel.success) {
            const err = (reel as any).error;
            problem = err === 'not_found'
              ? "Video topilmadi — o'chirilgan yoki yopiq akkauntda."
              : "Instagram hozir javob bermadi — birozdan so'ng qayta ✅ bosing.";
          } else if (!reel.taggedUsernames.includes(submission.targetUsername)) {
            problem = `Videoda hozir <b>@${escapeHtml(submission.targetUsername)}</b> atmetkasi yo'q — foydalanuvchi uni olib tashlagan.`;
          }
          if (problem) {
            if (messageId) {
              await bot.editMessageText(
                `⚠️ <b>${label} tasdiqlanmadi</b> (#${submissionId})\n\n${problem}\n\n🔗 ${escapeHtml(submission.videoUrl)}`,
                {
                  chat_id: chatId,
                  message_id: messageId,
                  parse_mode: 'HTML',
                  reply_markup: { inline_keyboard: [[
                    { text: '🔄 Qayta tekshirish', callback_data: `csgo_review:approve:${submissionId}` },
                    { text: '❌ Bekor qilish', callback_data: `csgo_review:reject:${submissionId}` },
                  ]] },
                },
              ).catch(() => {});
            }
            return;
          }
        }
        await prisma.tagSubmission.update({ where: { id: submissionId }, data: { status: 'ACTIVE', approvedAt: new Date() } });
        if (messageId) {
          await bot.editMessageText(
            `✅ <b>${label} tasdiqlandi</b> (#${submissionId})\n\nAtmetka qayta tekshirildi. Endi prosmotr kuzatuviga qo'shildi.`,
            { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
          ).catch(() => {});
        }
        const chat = Number(submission.user.telegramId);
        // Topshiruv paytidagi bosqichlar (snapshot) — keyin admin narxni
        // o'zgartirsa ham foydalanuvchiga AYNAN unga va'da qilingan jadval.
        const tiers = (Array.isArray(submission.rewardTiers) ? submission.rewardTiers : []) as any[];
        const notifyText =
          `✅ <b>Videongiz tasdiqlandi!</b>\n\n` +
          `🏷 Usul: <b>${label}</b>\n` +
          `🔗 ${escapeHtml(submission.videoUrl)}\n\n` +
          `💰 <b>To'lov bosqichlari:</b>\n${formatRewardTiers(tiers)}\n\n` +
          `Prosmotrlar 30 kun davomida kuzatiladi (dastlabki kunlarda tez-tez, keyin har 3 kunda) — har bir bosqichga yetganda pul hisobingizga avtomatik tushadi.` +
          (submission.method === 'CSGO' ? '' : `\n\n⚠️ Atmetkani olib tashlamang — aks holda keyingi to'lovlar to'xtaydi.`);
        if (phpBot.isReady()) {
          await phpBot.sendMessage(chat, notifyText).catch(() => {});
        } else {
          const targetBot = getSellerBot() || bot;
          await targetBot.sendMessage(chat, notifyText, { parse_mode: 'HTML' } as any).catch(() => {});
        }
      } else if (action === 'reject') {
        // Avval tanlov: sabab yozish yoki izohsiz rad etish.
        if (messageId) {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [
              [
                { text: '✍️ Izoh yozish', callback_data: `csgo_review:reject_note:${submissionId}` },
                { text: '🚫 Izohsiz rad etish', callback_data: `csgo_review:reject_plain:${submissionId}` },
              ],
              [{ text: '↩️ Orqaga', callback_data: `csgo_review:back:${submissionId}` }],
            ] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});
        }
      } else if (action === 'back') {
        adminFlow.delete(chatId);
        if (messageId) {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [[
              { text: '✅ Tasdiqlash', callback_data: `csgo_review:approve:${submissionId}` },
              { text: '❌ Bekor qilish', callback_data: `csgo_review:reject:${submissionId}` },
            ]] },
            { chat_id: chatId, message_id: messageId },
          ).catch(() => {});
        }
      } else if (action === 'reject_plain') {
        await rejectTagSubmission(submissionId, null, chatId, messageId);
      } else if (action === 'reject_note') {
        adminFlow.set(chatId, {
          kind: 'tag_reject_reason',
          expiresAt: Date.now() + ADMIN_FLOW_TTL_MS,
          submissionId,
          messageId,
        });
        await bot.sendMessage(
          chatId,
          `✍️ <b>#${submissionId}</b> — rad etish sababini yozing.\n\n<i>Matn video egasiga aynan shunday yuboriladi.</i>`,
          { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
      }
      await bot.answerCallbackQuery(query.id).catch(() => {});
    } catch (e) {
      console.error('csgo_review callback error:', e);
      await bot.answerCallbackQuery(query.id, { text: '❌ Xato' }).catch(() => {});
    }
  });

  // ─────────────── 🔖 Heshteg boshqaruv — reply-tugma orqali ochish ───────────────
  bot.on('message', async (msg) => {
    if (msg.text !== '🔖 Heshteg') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    const { isHeshtegEnabled } = await import('./lib/marketplace-config');
    const enabled = await isHeshtegEnabled();
    const statusText = enabled ? '🟢 Yoqilgan' : '🔴 O\'chirilgan';
    const text =
      `🔖 <b>Heshteg olish xizmati</b>\n\n` +
      `Hozirgi holati: <b>${statusText}</b>\n\n` +
      `Boshqarish uchun pastdagi tugmalardan foydalaning.`;
    const kb = {
      inline_keyboard: [
        [
          { text: '🟢 Yoqish', callback_data: 'heshteg_on' },
          { text: '🔴 O\'chirish', callback_data: 'heshteg_off' },
        ],
        [{ text: '📊 Heshteg statistikasi', callback_data: 'heshteg_stats' }],
        [{ text: '📝 Haftalik xeshteg', callback_data: 'heshteg_weekly' }],
        [{ text: '📢 Hamma xeshteglar kanali', callback_data: 'heshteg_channel' }],
      ],
    };
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  });

  // ─────────────── 💰 Komissiya — inline-tugma/step tizimida sozlash ───────────────
  async function renderCommissionPanel(chatId: number, messageId?: number): Promise<void> {
    const { getCommissionRate, getPayoutLimits } = await import('./lib/marketplace-config');
    const current = await getCommissionRate();
    const limits = await getPayoutLimits();
    const text =
      `💰 <b>Marketplace komissiya foizi</b>\n\n` +
      `Hozirgi: <code>${current}%</code>\n\n` +
      `<i>escrow = narx − (narx × foiz / 100), har bir yangi order'da hisoblanadi.</i>\n\n` +
      `💸 <b>Pul yechish chegaralari</b>\n` +
      `Minimal: <code>${fmtNumber(limits.min)}</code> so'm\n` +
      `Maksimal: <code>${limits.max > 0 ? fmtNumber(limits.max) + " so'm" : 'cheklanmagan'}</code>`;
    const kb = { inline_keyboard: [
      [{ text: "✏️ O'zgartirish", callback_data: 'commission:edit' }],
      [
        { text: '💸 Minimal yechish', callback_data: 'commission:payout_min' },
        { text: '💸 Maksimal yechish', callback_data: 'commission:payout_max' },
      ],
      [{ text: '🔄 Yangilash', callback_data: 'commission:refresh' }],
    ]};
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: kb })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {}));
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
    }
  }

  bot.on('message', async (msg) => {
    if (msg.text !== '💰 Komissiya') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    adminFlow.delete(chatId);
    await renderCommissionPanel(chatId);
  });

  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('commission:')) return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!(await isAdminUserId(chatId))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    const action = data.slice('commission:'.length);
    if (action === 'refresh') {
      adminFlow.delete(chatId);
      await renderCommissionPanel(chatId, messageId);
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }
    if (action === 'payout_min' || action === 'payout_max') {
      adminFlow.set(chatId, { kind: action, expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
      const { getPayoutLimits } = await import('./lib/marketplace-config');
      const limits = await getPayoutLimits();
      await bot.editMessageText(
        action === 'payout_min'
          ? `💸 <b>Minimal yechish summasi</b>\n\nHozirgi: <code>${fmtNumber(limits.min)}</code> so'm\n\nYangi summani so'mda yuboring (kamida 1 000). Misol: <code>50000</code>`
          : `💸 <b>Maksimal yechish summasi</b>\n\nHozirgi: <code>${limits.max > 0 ? fmtNumber(limits.max) + " so'm" : 'cheklanmagan'}</code>\n\nBir martada yechish mumkin bo'lgan eng katta summani yuboring. Cheklovni olib tashlash uchun <code>0</code> yuboring.`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
      ).catch(() => {});
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }
    if (action === 'edit') {
      adminFlow.set(chatId, { kind: 'commission', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
      const { getCommissionRate } = await import('./lib/marketplace-config');
      const current = await getCommissionRate();
      await bot.editMessageText(
        `✏️ <b>Komissiya foizini o'zgartirish</b>\n\nHozirgi: <code>${current}%</code>\n\nYangi foizni (0-100) yozib yuboring.`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
      ).catch(() => {});
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }
    await bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // ─────────────── 📊 Statistika va ☑️ Verify — reply-tugma → inline panel ───────────────
  // Oxirgi Verify qidiruvi (natijaga qaytish tugmasi uchun) — chatId → so'rov va natija id'lari.
  const lastVerifySearch = new Map<number, { query: string; ids: number[] }>();

  async function showPanel(chatId: number, panel: Panel, messageId?: number): Promise<void> {
    const opts = { parse_mode: 'HTML' as const, reply_markup: panel.replyMarkup, disable_web_page_preview: true };
    if (messageId) {
      try {
        await bot.editMessageText(panel.text, { chat_id: chatId, message_id: messageId, ...opts });
        return;
      } catch (e: any) {
        // Matn o'zgarmagan bo'lsa — hech narsa qilmaymiz; boshqa xatoda yangi xabar.
        if (String(e?.message || '').includes('message is not modified')) return;
      }
    }
    await bot.sendMessage(chatId, panel.text, opts).catch(() => {});
  }

  bot.on('message', async (msg) => {
    if (msg.text !== '📊 Statistika' && msg.text !== '☑️ Verify') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    adminFlow.delete(chatId);
    try {
      await showPanel(chatId, msg.text === '📊 Statistika' ? await buildStatsPanel('linked', 0) : await buildVerifyListPanel(0));
    } catch (e) {
      console.error('admin panel error:', e);
      await bot.sendMessage(chatId, "❌ Panelni ochib bo'lmadi").catch(() => {});
    }
  });

  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('mstat:') && !data.startsWith('mver:') && data !== 'adm:noop') return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (data === 'adm:noop') {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }
    if (!(await isAdminUserId(chatId))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    try {
      const [scope, a, b, c] = data.split(':');
      let toast: string | undefined;

      if (scope === 'mstat') {
        await showPanel(chatId, await buildStatsPanel(parseStatsFilter(a), Number(b) || 0), messageId);
      } else if (a === 'l') {
        await showPanel(chatId, await buildVerifyListPanel(Number(b) || 0), messageId);
      } else if (a === 'a' || a === 't') {
        const accountId = Number(b);
        if (a === 't') {
          const next = await toggleVerifiedBadge(accountId);
          if (next !== null) toast = next ? '✅ Nishon berildi' : '✖️ Nishon olib tashlandi';
        }
        const panel = await buildVerifyAccountPanel(accountId, c || 'l0');
        if (panel) await showPanel(chatId, panel, messageId);
        else toast = 'Akkaunt topilmadi';
      } else if (a === 's') {
        const last = lastVerifySearch.get(chatId);
        await showPanel(chatId, last ? await buildVerifySearchPanel(last.query, last.ids) : await buildVerifyListPanel(0), messageId);
      } else if (a === 'q') {
        adminFlow.set(chatId, { kind: 'verify_search', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        await bot.sendMessage(
          chatId,
          "🔍 Qidiruv so'rovini yuboring:\n\n" +
            '• Instagram username — <code>@akkaunt</code>\n' +
            '• Telegram username — <code>@user</code>\n' +
            '• Telegram ID — <code>123456789</code>\n\n' +
            "<i>Eng yaqin 8 ta natija ko'rsatiladi.</i>",
          { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
      }
      await bot.answerCallbackQuery(query.id, toast ? { text: toast } : undefined).catch(() => {});
    } catch (e) {
      console.error('admin panel callback error:', e);
      await bot.answerCallbackQuery(query.id, { text: '❌ Xato' }).catch(() => {});
    }
  });

  // ─────────────── 💳 Balans — foydalanuvchini topib, hisobiga pul qo'shish/ayirish ───────────────
  const lastBalanceSearch = new Map<number, { query: string; ids: number[] }>();
  // Tasdiqlash kutayotgan amal (admin chat bo'yicha) — 5 daqiqadan keyin bekor.
  const balancePending = new Map<number, BalanceOp & { expiresAt: number }>();

  const BALANCE_SEARCH_PROMPT =
    "💳 <b>Balans</b>\n\nFoydalanuvchini topish uchun yuboring:\n\n" +
    '• Telegram ID — <code>123456789</code>\n' +
    '• Telegram username — <code>@user</code>\n' +
    '• yoki ismi\n\n' +
    "<i>Eng yaqin 5 ta natija ko'rsatiladi.</i>";

  bot.on('message', async (msg) => {
    if (msg.text !== '💳 Balans') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    adminFlow.set(chatId, { kind: 'balance_search', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
    await bot.sendMessage(chatId, BALANCE_SEARCH_PROMPT, { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON }).catch(() => {});
  });

  // Foydalanuvchiga hisobi o'zgargani haqida xabar (adminning tanlovi bilan).
  async function notifyBalanceChange(telegramId: bigint, op: BalanceOp, after: number): Promise<void> {
    const text =
      (op.mode === 'sub'
        ? `➖ <b>Hisobingizdan ${fmtNumber(op.amount)} so'm ayirildi</b>`
        : `💰 <b>Hisobingizga ${fmtNumber(op.amount)} so'm qo'shildi</b>`) +
      (op.reason ? `\n\n📝 ${escapeHtml(op.reason)}` : '') +
      `\n\nHozirgi balans: <b>${fmtNumber(after)}</b> so'm`;
    const chat = Number(telegramId);
    if (phpBot.isReady()) await phpBot.sendMessage(chat, text).catch(() => {});
    else await (getSellerBot() || bot).sendMessage(chat, text, { parse_mode: 'HTML' } as any).catch(() => {});
  }

  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('mbal:')) return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!(await isAdminUserId(chatId))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    try {
      const [, action, arg] = data.split(':');
      let toast: string | undefined;

      if (action === 'q') {
        adminFlow.set(chatId, { kind: 'balance_search', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        await bot.sendMessage(chatId, BALANCE_SEARCH_PROMPT, { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON }).catch(() => {});
      } else if (action === 's') {
        const last = lastBalanceSearch.get(chatId);
        if (last) await showPanel(chatId, await buildBalanceSearchPanel(last.query, last.ids), messageId);
        else toast = 'Avval qidiring';
      } else if (action === 'u') {
        const panel = await buildBalanceUserPanel(Number(arg));
        if (panel) await showPanel(chatId, panel, messageId);
        else toast = 'Foydalanuvchi topilmadi';
      } else if (action === 'add_w' || action === 'add_d' || action === 'sub') {
        adminFlow.set(chatId, {
          kind: 'balance_amount',
          expiresAt: Date.now() + ADMIN_FLOW_TTL_MS,
          balanceUserId: Number(arg),
          balanceMode: action as BalanceMode,
        });
        await bot.sendMessage(
          chatId,
          (action === 'sub' ? '➖ <b>Ayirish</b>' : action === 'add_d' ? "➕ <b>Qo'shish — faqat ilova ichida</b>" : "➕ <b>Qo'shish</b>") +
            `\n\nSummani so'mda yuboring. Misol: <code>50000</code>\n<i>Eng ko'pi: ${fmtNumber(BALANCE_MAX_AMOUNT)} so'm</i>`,
          { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
      } else if (action === 'noreason') {
        const flow = adminFlow.get(chatId);
        if (flow?.kind !== 'balance_reason' || !flow.balanceUserId || !flow.balanceMode || !flow.balanceAmount) {
          toast = 'Amal muddati tugagan, qaytadan boshlang';
        } else {
          const op: BalanceOp = { userId: flow.balanceUserId, mode: flow.balanceMode, amount: flow.balanceAmount, reason: '' };
          balancePending.set(chatId, { ...op, expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
          adminFlow.delete(chatId);
          const panel = await buildBalanceConfirmPanel(op);
          if (panel) await showPanel(chatId, panel, messageId);
        }
      } else if (action === 'go') {
        const op = balancePending.get(chatId);
        if (!op || op.expiresAt < Date.now()) {
          balancePending.delete(chatId);
          toast = 'Amal muddati tugagan, qaytadan boshlang';
        } else {
          balancePending.delete(chatId); // ikki marta bosilsa ikki marta bajarilmaydi
          const res = await applyBalanceOp(op, query.from.id);
          if (!res.ok) {
            if (messageId) await bot.editMessageText(`❌ <b>Bajarilmadi:</b> ${escapeHtml((res as { error: string }).error)}`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
          } else {
            if (messageId) {
              await bot.editMessageText(
                `✅ <b>Bajarildi</b>\n\n` +
                  `${op.mode === 'sub' ? '➖ Ayirildi' : "➕ Qo'shildi"}: <b>${fmtNumber(op.amount)}</b> so'm\n` +
                  `Balans: ${fmtNumber(res.before)} → <b>${fmtNumber(res.after)}</b> so'm\n` +
                  `ID: <code>${res.telegramId}</code>` +
                  (arg === '1' ? '\n📨 Foydalanuvchiga xabar yuborildi' : ''),
                { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
              ).catch(() => {});
            }
            console.log(`[balance] admin ${query.from.id}: user#${op.userId} ${op.mode} ${op.amount} (${res.before} → ${res.after}) "${op.reason}"`);
            if (arg === '1') await notifyBalanceChange(res.telegramId, op, res.after);
          }
        }
      } else if (action === 'cancel') {
        balancePending.delete(chatId);
        adminFlow.delete(chatId);
        if (messageId) await bot.editMessageText('🚫 Bekor qilindi', { chat_id: chatId, message_id: messageId }).catch(() => {});
      }
      await bot.answerCallbackQuery(query.id, toast ? { text: toast } : undefined).catch(() => {});
    } catch (e) {
      console.error('balance callback error:', e);
      await bot.answerCallbackQuery(query.id, { text: '❌ Xato' }).catch(() => {});
    }
  });

  // ─────────────── 🔍 Qidirish — reply-tugma → step ───────────────
  bot.on('message', async (msg) => {
    if (msg.text !== '🔍 Qidirish') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    adminFlow.set(chatId, { kind: 'search', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
    await bot.sendMessage(chatId,
      "🔍 Qidirmoqchi bo'lgan Instagram username'ni (kamida 2 belgi) yozib yuboring.",
      { reply_markup: CANCEL_BUTTON },
    ).catch(() => {});
  });

  // ─────────────── 📝 Haftalik xeshteg — Heshteg panelidagi tugma → step ───────────────
  async function currentWeeklyHashtag(): Promise<{ current: string; updatedAt: string }> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const storePath = path.join(process.cwd(), 'server', 'data', 'weekly-hashtag.json');
      const raw = fs.readFileSync(storePath, 'utf8');
      const j = JSON.parse(raw);
      return {
        current: j.hashtag ? (j.hashtag.length > 400 ? j.hashtag.slice(0, 400) + '…' : j.hashtag) : '— (sozlanmagan)',
        updatedAt: j.updatedAt ? String(j.updatedAt).slice(0, 16).replace('T', ' ') : '—',
      };
    } catch {
      return { current: '— (sozlanmagan)', updatedAt: '—' };
    }
  }

  bot.on('callback_query', async (query) => {
    if (query.data !== 'heshteg_weekly_edit') return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!(await isAdminUserId(chatId))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    adminFlow.set(chatId, { kind: 'weekly_hashtag', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
    const { current } = await currentWeeklyHashtag();
    await bot.editMessageText(
      `📝 <b>Haftalik xeshtegni o'zgartirish</b>\n\n<b>Hozirgi:</b>\n<code>${escapeHtml(current)}</code>\n\nYangi xeshteg matnini (3+ belgi) yozib yuboring.`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
    ).catch(() => {});
    await bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // ─────────────── 📢 "Hamma xeshteglar" kanali — web app'dagi tugma havolasi ───────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'heshteg_channel') return;
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    if (!(await isAdminUserId(chatId))) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Faqat admin uchun', show_alert: true }).catch(() => {});
      return;
    }
    adminFlow.set(chatId, { kind: 'weekly_channel', expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
    const current = readWeeklyChannelUrl();
    await bot.sendMessage(
      chatId,
      `📢 <b>Hamma xeshteglar kanali</b>\n\n` +
        `Web app'dagi haftalik xeshteg oynasida "Hamma xeshteglar" tugmasi shu kanalga olib boradi.\n\n` +
        `<b>Hozirgi:</b> ${current ? escapeHtml(current) : "— (sozlanmagan, tugma ko'rinmaydi)"}\n\n` +
        `Kanal havolasini yuboring: <code>https://t.me/kanal</code> yoki <code>@kanal</code>.\n` +
        `Tugmani o'chirish uchun <code>-</code> yuboring.`,
      { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON, disable_web_page_preview: true },
    ).catch(() => {});
    await bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // ─────────────── Yagona qiymat-qabul qiluvchi — barcha adminFlow turlari ───────────────
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const flow = adminFlow.get(chatId);
    if (!flow) return;
    if (flow.expiresAt < Date.now()) {
      adminFlow.delete(chatId);
      return;
    }
    if (!msg.text) return;

    if (flow.kind === 'atmetka_user') {
      try {
        await setTagTargetUsername(msg.text);
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, `✅ Maqsad username <b>@${msg.text.replace(/^@/, '').trim().toLowerCase()}</b> ga o'rnatildi.`, { parse_mode: 'HTML' }).catch(() => {});
        await renderAtmetkaPanel(bot, chatId);
      } catch (e: any) {
        await bot.sendMessage(chatId, `⚠️ ${e?.message || 'Xato'}. Qaytadan yozing.`, { reply_markup: CANCEL_BUTTON }).catch(() => {});
      }
      return;
    }

    if (flow.kind === 'atmetka_budget') {
      const amount = parseInt(String(msg.text).replace(/[\s.,'_]/g, ''), 10);
      if (!Number.isFinite(amount) || amount < 0) {
        await bot.sendMessage(chatId, '⚠️ Faqat raqam yuboring. Misol: <code>1000000</code>', { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON }).catch(() => {});
        return;
      }
      await writeTagBudget(amount, flow.method || 'TAG_ONLY');
      adminFlow.delete(chatId);
      await bot.sendMessage(
        chatId,
        amount > 0
          ? `✅ ${BUDGET_LABELS[flow.method || 'TAG_ONLY']} uchun <b>${new Intl.NumberFormat('uz-UZ').format(amount)}</b> so'm ajratildi.`
          : "✅ Ajratilgan pul cheklovi o'chirildi.",
        { parse_mode: 'HTML' },
      ).catch(() => {});
      await renderAtmetkaPanel(bot, chatId);
      return;
    }

    if (flow.kind === 'atmetka_tiers') {
      try {
        const tiers = parseRewardTiersInput(msg.text);
        await setRewardTiers(tiers);
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, `✅ Bosqichlar yangilandi:\n${formatRewardTiers(tiers)}`, { parse_mode: 'HTML' }).catch(() => {});
        await renderAtmetkaPanel(bot, chatId);
      } catch (e: any) {
        await bot.sendMessage(chatId,
          `⚠️ ${e?.message || "Format xato"}. Misol: <code>1000:5000,5000:20000</code>. Qaytadan yozing.`,
          { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
      }
      return;
    }

    if (flow.kind === 'atmetka_csgo_tiers') {
      try {
        const tiers = parseRewardTiersInput(msg.text);
        await setCsgoRewardTiers(tiers);
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, `✅ CS GO bosqichlari yangilandi:\n${formatRewardTiers(tiers)}`, { parse_mode: 'HTML' }).catch(() => {});
        await renderAtmetkaPanel(bot, chatId);
      } catch (e: any) {
        await bot.sendMessage(chatId,
          `⚠️ ${e?.message || "Format xato"}. Misol: <code>1000:5000,5000:20000</code>. Qaytadan yozing.`,
          { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
      }
      return;
    }

    if (flow.kind === 'atmetka_csgo_tag_tiers') {
      try {
        const tiers = parseRewardTiersInput(msg.text);
        await setCsgoTagRewardTiers(tiers);
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, `✅ CS GO + Atmetka bosqichlari yangilandi:\n${formatRewardTiers(tiers)}`, { parse_mode: 'HTML' }).catch(() => {});
        await renderAtmetkaPanel(bot, chatId);
      } catch (e: any) {
        await bot.sendMessage(chatId,
          `⚠️ ${e?.message || "Format xato"}. Misol: <code>1000:8000,5000:30000</code>. Qaytadan yozing.`,
          { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
      }
      return;
    }

    if (flow.kind === 'commission') {
      const { setCommissionRate } = await import('./lib/marketplace-config');
      const value = Number(msg.text.replace(',', '.').trim());
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        await bot.sendMessage(chatId, "⚠️ 0..100 oralig'idagi raqam yuboring. Qaytadan yozing.", { reply_markup: CANCEL_BUTTON }).catch(() => {});
        return;
      }
      await setCommissionRate(value);
      adminFlow.delete(chatId);
      await bot.sendMessage(chatId, `✅ Komissiya foizi <b>${value}%</b> ga o'rnatildi.`, { parse_mode: 'HTML' }).catch(() => {});
      await renderCommissionPanel(chatId);
      return;
    }

    if (flow.kind === 'balance_search' || flow.kind === 'balance_amount' || flow.kind === 'balance_reason') {
      // Pastki menyu tugmasi bosilgan bo'lsa — bu javob emas.
      if (ADMIN_MENU_TEXTS.has(msg.text)) {
        adminFlow.delete(chatId);
        return;
      }
      try {
        if (flow.kind === 'balance_search') {
          const query = msg.text.trim().slice(0, 64);
          if (query.replace(/^@/, '').length < 2) {
            await bot.sendMessage(chatId, '⚠️ Kamida 2 ta belgi kiriting. Qaytadan yozing.', { reply_markup: CANCEL_BUTTON }).catch(() => {});
            return;
          }
          adminFlow.delete(chatId);
          const ids = await searchUsers(query);
          lastBalanceSearch.set(chatId, { query, ids });
          await showPanel(chatId, await buildBalanceSearchPanel(query, ids));
          return;
        }

        if (flow.kind === 'balance_amount') {
          const amount = Number(msg.text.replace(/[\s,._]/g, ''));
          if (!Number.isInteger(amount) || amount <= 0 || amount > BALANCE_MAX_AMOUNT) {
            await bot.sendMessage(
              chatId,
              `⚠️ 1 dan ${fmtNumber(BALANCE_MAX_AMOUNT)} gacha butun son yuboring. Qaytadan yozing.`,
              { reply_markup: CANCEL_BUTTON },
            ).catch(() => {});
            return;
          }
          adminFlow.set(chatId, { ...flow, kind: 'balance_reason', balanceAmount: amount, expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
          await bot.sendMessage(
            chatId,
            `📝 <b>Sababini yozing</b> (masalan: <i>kompensatsiya</i>, <i>bonus</i>).\n\nU tranzaksiya tarixida saqlanadi va xohlasangiz foydalanuvchiga ham yuboriladi.`,
            {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '➡️ Izohsiz', callback_data: 'mbal:noreason' }],
                [{ text: '❌ Bekor qilish', callback_data: 'mbal:cancel' }],
              ] },
            },
          ).catch(() => {});
          return;
        }

        // balance_reason
        if (!flow.balanceUserId || !flow.balanceMode || !flow.balanceAmount) {
          adminFlow.delete(chatId);
          return;
        }
        const op: BalanceOp = {
          userId: flow.balanceUserId,
          mode: flow.balanceMode,
          amount: flow.balanceAmount,
          reason: msg.text.trim().slice(0, 150),
        };
        balancePending.set(chatId, { ...op, expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        adminFlow.delete(chatId);
        const panel = await buildBalanceConfirmPanel(op);
        if (panel) await showPanel(chatId, panel);
        else await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi').catch(() => {});
      } catch (err) {
        console.error('balance flow error:', err);
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi, qaytadan urinib ko\'ring').catch(() => {});
      }
      return;
    }

    if (flow.kind === 'tag_reject_reason') {
      if (ADMIN_MENU_TEXTS.has(msg.text)) {
        adminFlow.delete(chatId);
        return;
      }
      const reason = msg.text.trim().slice(0, 500);
      if (reason.length < 2) {
        await bot.sendMessage(chatId, '⚠️ Sababni yozing (kamida 2 belgi).', { reply_markup: CANCEL_BUTTON }).catch(() => {});
        return;
      }
      adminFlow.delete(chatId);
      const ok = await rejectTagSubmission(flow.submissionId!, reason, chatId, flow.messageId);
      await bot.sendMessage(
        chatId,
        ok ? `✅ #${flow.submissionId} rad etildi — sabab video egasiga yuborildi.` : `ℹ️ #${flow.submissionId} allaqachon ko'rib chiqilgan.`,
      ).catch(() => {});
      return;
    }

    if (flow.kind === 'payout_min' || flow.kind === 'payout_max') {
      const value = Number(msg.text.replace(/[\s,._]/g, ''));
      const { getPayoutLimits, setPayoutLimits } = await import('./lib/marketplace-config');
      const limits = await getPayoutLimits();
      const isMin = flow.kind === 'payout_min';
      const invalid = !Number.isInteger(value) || value < 0
        || (isMin && value < 1000)
        || (isMin && limits.max > 0 && value > limits.max)
        || (!isMin && value > 0 && value < limits.min);
      if (invalid) {
        await bot.sendMessage(
          chatId,
          isMin
            ? `⚠️ Kamida 1 000 so'm${limits.max > 0 ? ` va maksimaldan (${fmtNumber(limits.max)}) oshmaydigan` : ''} butun son yuboring.`
            : `⚠️ 0 (cheklanmagan) yoki minimaldan (${fmtNumber(limits.min)}) katta butun son yuboring.`,
          { reply_markup: CANCEL_BUTTON },
        ).catch(() => {});
        return;
      }
      await setPayoutLimits(isMin ? { min: value } : { max: value });
      adminFlow.delete(chatId);
      await bot.sendMessage(
        chatId,
        isMin
          ? `✅ Minimal yechish summasi: <b>${fmtNumber(value)}</b> so'm`
          : `✅ Maksimal yechish summasi: <b>${value > 0 ? fmtNumber(value) + " so'm" : 'cheklanmagan'}</b>`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
      await renderCommissionPanel(chatId);
      return;
    }

    if (flow.kind === 'weekly_channel') {
      const raw = msg.text.trim();
      if (raw === '-') {
        writeWeeklyChannelUrl('');
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, "✅ Kanal havolasi o'chirildi — \"Hamma xeshteglar\" tugmasi endi ko'rinmaydi.").catch(() => {});
        return;
      }
      const handle = raw.match(/^@([A-Za-z0-9_]{4,})$/);
      const url = handle ? `https://t.me/${handle[1]}` : raw;
      if (!/^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+$/i.test(url)) {
        await bot.sendMessage(chatId, "⚠️ Havola noto'g'ri. Misol: https://t.me/kanal yoki @kanal. Qaytadan yuboring.", { reply_markup: CANCEL_BUTTON }).catch(() => {});
        return;
      }
      writeWeeklyChannelUrl(url);
      adminFlow.delete(chatId);
      await bot.sendMessage(chatId, `✅ Saqlandi: ${escapeHtml(url)}\n\nWeb app'da "Hamma xeshteglar" tugmasi shu kanalni ochadi.`, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
      return;
    }

    if (flow.kind === 'verify_search') {
      // Pastki menyu tugmasi bosilgan bo'lsa — bu qidiruv so'rovi emas.
      if (ADMIN_MENU_TEXTS.has(msg.text)) {
        adminFlow.delete(chatId);
        return;
      }
      if (msg.text.trim().replace(/^@/, '').length < 2) {
        await bot.sendMessage(chatId, "⚠️ Kamida 2 ta belgi kiriting. Qaytadan yozing.", { reply_markup: CANCEL_BUTTON }).catch(() => {});
        return;
      }
      adminFlow.delete(chatId);
      try {
        const query = msg.text.trim().slice(0, 64);
        const ids = await searchAccounts(query);
        lastVerifySearch.set(chatId, { query, ids });
        await showPanel(chatId, await buildVerifySearchPanel(query, ids));
      } catch (err) {
        console.error('verify search error:', err);
        await bot.sendMessage(chatId, '❌ Qidiruv xatosi').catch(() => {});
      }
      return;
    }

    if (flow.kind === 'search') {
      const q = msg.text.trim().replace(/^@/, '');
      if (q.length < 2) {
        await bot.sendMessage(chatId, "⚠️ Kamida 2 ta belgi kiriting. Qaytadan yozing.", { reply_markup: CANCEL_BUTTON }).catch(() => {});
        return;
      }
      adminFlow.delete(chatId);
      try {
        const list = await prisma.adAccount.findMany({
          where: { igUsername: { contains: q, mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        if (list.length === 0) {
          await bot.sendMessage(chatId, `❌ <b>${escapeHtml(q)}</b> bo'yicha akkaunt topilmadi`, { parse_mode: 'HTML' }).catch(() => {});
          return;
        }
        for (const acc of list) {
          await bot.sendMessage(chatId, accountAdminCard(acc), {
            parse_mode: 'HTML',
            reply_markup: accountAdminButtons(acc) as any,
          }).catch(() => {});
        }
      } catch (err) {
        console.error('search error:', err);
        await bot.sendMessage(chatId, '❌ Qidiruv xatosi').catch(() => {});
      }
      return;
    }

    if (flow.kind === 'weekly_hashtag') {
      const text = msg.text.trim();
      if (text.length < 3) {
        await bot.sendMessage(chatId, "⚠️ Xeshteg matni 3+ belgi bo'lishi kerak. Qaytadan yozing.", { reply_markup: CANCEL_BUTTON }).catch(() => {});
        return;
      }
      adminFlow.delete(chatId);
      try {
        const saved = writeWeeklyHashtag(text);
        await bot.sendMessage(
          chatId,
          `✅ <b>Haftalik xeshteg yangilandi</b>\n\n<code>${escapeHtml(saved.hashtag)}</code>\n\nYangilangan: ${saved.updatedAt.slice(0, 16).replace('T', ' ')}`,
          { parse_mode: 'HTML' },
        ).catch(() => {});
      } catch (err) {
        console.error('weekly hashtag save error:', err);
        await bot.sendMessage(chatId, '❌ Saqlashda xato').catch(() => {});
      }
      return;
    }
  });

  // ─────────────── 📨 Xabar yuborish — istalgan turdagi xabarni (matn, video+
  // caption, foto+caption, fayl+caption, GIF, ixtiyoriy havola-tugma bilan)
  // barcha TASDIQLANGAN (ACTIVE) sotuvchilarga Top_sxema bot orqali yuboradi.
  // 3 bosqichli suhbat: 1) tugma → xabarni so'raymiz  2) admin xohlagan
  // turdagi xabarni yuboradi  3) tugma qo'shish/o'tkazib yuborishni so'raymiz.
  // ─────────────────────────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (msg.text !== '📨 Xabar yuborish') return;
    const chatId = msg.chat.id;
    if (!(await isAdminUserId(chatId))) return;
    broadcastFlow.set(chatId, { stage: 'awaiting_content', expiresAt: Date.now() + BROADCAST_WINDOW_MS });
    await bot.sendMessage(
      chatId,
      `📨 <b>Sotuvchilarga xabar yuborish</b>\n\n` +
      `Istalgan turdagi xabaringizni shu chatga yuboring:\n` +
      `• Oddiy matn\n` +
      `• Video + caption\n` +
      `• Foto + caption\n` +
      `• Fayl (hujjat) + caption\n` +
      `• GIF\n\n` +
      `Xabar akkaunti TASDIQLANGAN (ACTIVE) barcha sotuvchilarga aynan shu ko'rinishda yuboriladi.`,
      { parse_mode: 'HTML', reply_markup: CANCEL_BUTTON },
    ).catch(() => {});
  });

  // Bosqich 2: xabar mazmunini qabul qilamiz, keyin tugma so'raymiz.
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const flow = broadcastFlow.get(chatId);
    if (!flow || flow.stage !== 'awaiting_content') return;
    if (flow.expiresAt < Date.now()) {
      broadcastFlow.delete(chatId);
      return;
    }

    const content = extractBroadcastContent(msg);
    if (!content) {
      await bot.sendMessage(
        chatId,
        "❌ Bu turdagi xabar qo'llab-quvvatlanmaydi. Matn, foto, video, fayl yoki GIF yuboring.",
        { reply_markup: CANCEL_BUTTON },
      ).catch(() => {});
      return;
    }

    broadcastFlow.set(chatId, { stage: 'awaiting_button', content, expiresAt: Date.now() + BROADCAST_WINDOW_MS });
    await bot.sendMessage(
      chatId,
      `🔘 Xabar ostiga havola-tugma qo'shmoqchimisiz?\n\n` +
      `Qo'shish uchun: <code>Tugma matni | https://havola.uz</code>\n` +
      `Kerak bo'lmasa — pastdagi tugmani bosing.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Yuborish (tugmasiz)", callback_data: 'broadcast:send_now' }],
            [{ text: '❌ Bekor qilish', callback_data: 'flow:cancel' }],
          ],
        },
      },
    ).catch(() => {});
  });

  // Bosqich 3a: tugmasiz — darhol yuborish (inline tugma orqali)
  bot.on('callback_query', async (query) => {
    if (query.data !== 'broadcast:send_now') return;
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    const flow = broadcastFlow.get(chatId);
    if (!flow || flow.stage !== 'awaiting_button' || !flow.content) {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }
    broadcastFlow.delete(chatId);
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await broadcastToActiveSellers(bot, chatId, flow.content, null);
  });

  // Bosqich 3b: "Matn | havola" formatida tugma bilan yuborish
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const flow = broadcastFlow.get(chatId);
    if (!flow || flow.stage !== 'awaiting_button' || !flow.content) return;
    if (flow.expiresAt < Date.now()) {
      broadcastFlow.delete(chatId);
      return;
    }
    if (!msg.text) return;

    const parts = msg.text.split('|').map((s) => s.trim());
    if (parts.length !== 2 || !parts[0] || !/^https?:\/\//i.test(parts[1])) {
      await bot.sendMessage(
        chatId,
        "❌ Format noto'g'ri. Masalan: <code>Kanalga o'tish | https://t.me/kanal</code>",
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Yuborish (tugmasiz)", callback_data: 'broadcast:send_now' }],
              [{ text: '❌ Bekor qilish', callback_data: 'flow:cancel' }],
            ],
          },
        },
      ).catch(() => {});
      return;
    }

    const content = flow.content;
    broadcastFlow.delete(chatId);
    const replyMarkup = { inline_keyboard: [[{ text: parts[0], url: parts[1] }]] };
    await broadcastToActiveSellers(bot, chatId, content, replyMarkup);
  });

  // ─────────────── Narx kiritish (admin javobi) ───────────────
  // Admin "💰 Narx belgilash" tugmasini bosgan bo'lsa, keyingi yuborgan
  // raqamini narx sifatida qabul qilamiz, tugmali xabarni yangilab tasdiqlash tugmasini ochamiz.
  bot.on('message', async (msg) => {
    try {
      if (!msg?.chat || !msg.text || msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const accountId = getAwaitingPrice(chatId);
      if (!accountId) return;
      const sub = getSubmission(accountId, chatId);
      if (!sub) {
        clearAwaitingPrice(chatId);
        return;
      }
      const cleaned = msg.text.replace(/[\s,_]/g, '').trim();
      const n = Number(cleaned);
      if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) {
        await bot
          .sendMessage(chatId, "❌ To'g'ri raqam emas. Faqat raqam (so'm) yuboring.")
          .catch(() => {});
        return;
      }
      sub.price = n;
      clearAwaitingPrice(chatId);
      // tugmali xabarni yangilash — endi Tasdiqlash tugmasi paydo bo'ladi
      await bot
        .editMessageText(buildAccountCaption(sub), {
          chat_id: chatId,
          message_id: sub.buttonsMsgId,
          parse_mode: 'HTML',
          reply_markup: buildAccountButtons(accountId, true) as any,
        })
        .catch(() => {});
      // narx so'rash xabari + admin yuborgan raqamni o'chiramiz (ixchamroq)
      if (sub.priceAskMsgId) {
        await bot.deleteMessage(chatId, sub.priceAskMsgId).catch(() => {});
        sub.priceAskMsgId = undefined;
      }
      await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    } catch (e) {
      console.error('mkt price-listener error:', e instanceof Error ? e.message : e);
    }
  });

  // "❌ Bekor qilish" — Egasiga xabar yozishni bekor qilish
  bot.on('callback_query', async (query) => {
    if (query.data !== 'admchat:cancel') return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    const { getAwaitingAdminMessage, clearAwaitingAdminMessage } = await import('./lib/account-submissions');
    const pending = getAwaitingAdminMessage(chatId);
    if (pending) clearAwaitingAdminMessage(chatId);
    if (messageId) {
      await bot.editMessageText('🚫 Yozish bekor qilindi', { chat_id: chatId, message_id: messageId }).catch(() => {});
    }
    await bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // ─────────────── Admin → Owner anonim xabar (verify chat) ───────────────
  // Admin "💬 Egasiga yozish" bosgan bo'lsa, keyingi yuborgan matn xabarini
  // Top_sxema bot orqali ownerga jo'natamiz.
  bot.on('message', async (msg) => {
    try {
      if (!msg?.chat || !msg.text || msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const { getAwaitingAdminMessage, clearAwaitingAdminMessage } = await import('./lib/account-submissions');
      const pending = getAwaitingAdminMessage(chatId);
      if (!pending) return;

      // Top_sxema bot orqali ownerga yuborish (phpBot bridge)
      const { phpBot } = await import('./lib/php-bot-bridge');
      const text =
        `💬 <b>Admindan xabar</b>\n\n` +
        `Akkauntingiz <code>#${pending.accountId}</code> bo'yicha so'rov:\n\n` +
        `<blockquote>${escapeHtml(msg.text)}</blockquote>\n\n` +
        `<i>Javob yozish uchun pastdagi tugmani bosing.</i>`;
      const replyMarkup = {
        inline_keyboard: [[
          { text: '✍️ Javob yozish', callback_data: `mkt:vchat:reply:${pending.accountId}` },
        ]],
      };
      try {
        await phpBot.sendMessage(pending.ownerTgId, text, { replyMarkup });
        clearAwaitingAdminMessage(chatId);
        await bot.sendMessage(chatId,
          `✅ Xabar ${pending.ownerTgId.toString().slice(-4)} dagi egasiga yuborildi.\n\n<i>Egasi javob yozsa shu chatga keladi.</i>`,
          { parse_mode: 'HTML' },
        ).catch(() => {});
      } catch (e) {
        await bot.sendMessage(chatId, '❌ Yuborib bo\'lmadi: ' + (e instanceof Error ? e.message : 'noma\'lum')).catch(() => {});
      }
    } catch (e) {
      console.error('mkt admin-chat error:', e instanceof Error ? e.message : e);
    }
  });

  // ─────────────── Callback queries (mkt:*) ───────────────
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('mkt:')) return; // Boshqa handlerlar uchun qoldiramiz

    const fromTgId = query.from.id;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;

    if (!chatId || !messageId) {
      try { await bot.answerCallbackQuery(query.id, { text: '❌ Xato kontekst' }); } catch {}
      return;
    }

    const parts = data.split(':');
    // mkt:<kind>:<...args>
    const kind = parts[1];

    // mkt:owner:* — endi sellerBot'da tinglandi (ownerBot.on('callback_query') yuqorida).
    // Agar adminBot'ga kelsa (ya'ni sellerBot=adminBot rejimida) — to'g'ridan-to'g'ri o'tkazib yuboramiz.
    if (kind === 'owner') return;

    if (!(await isAdminUserId(fromTgId))) {
      try { await bot.answerCallbackQuery(query.id, { text: '❌ Faqat adminlar uchun', show_alert: true }); } catch {}
      return;
    }

    try {
      if (kind === 'admin') {
        // Maxsus: mkt:admin:pay:approve|reject:<orderId> — to'lov skrinshoti tasdiqlash
        if (parts[2] === 'pay') {
          const action = parts[3];
          const orderId = Number(parts[4] || 0);
          await handleAdminPaymentCallback(bot, query, action, orderId, chatId, messageId, fromTgId);
          return;
        }
        // mkt:admin:<action>:<accountId>:<arg>
        const action = parts[2];
        const accountId = Number(parts[3]);
        const arg = Number(parts[4] || 0);
        await handleAdminAccountCallback(bot, query, action, accountId, arg, chatId, messageId);
        return;
      }
      // mkt:<kind>:<id>:<action> (legacy: verify/payout/dispute)
      const id = Number(parts[2]);
      const action = parts[3];
      if (kind === 'verify') {
        await handleVerifyCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === 'payout') {
        await handlePayoutCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === 'dispute') {
        await handleDisputeCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === 'editreq') {
        await handleEditReviewCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === 'vchat' && parts[2] === 'block') {
        // mkt:vchat:block:<accountId>:<ownerTgId> — admin akkaunt egasining
        // javobi ostidagi "🚫 Bloklash" tugmasini bosdi (adminBot/insaybbot
        // O'ZIDA ko'rsatiladi — bot.php orqali kelmaydi, shuning uchun
        // bot-forward.ts'da EMAS, shu yerda ushlanadi).
        const accountId = Number(parts[3] || 0);
        const ownerTgId = Number(parts[4] || 0);
        await handleVchatBlockCallback(bot, query, accountId, ownerTgId, chatId, messageId);
      } else {
        try { await bot.answerCallbackQuery(query.id, { text: 'Noma\'lum amal' }); } catch {}
      }
    } catch (err) {
      console.error('mkt callback error:', err);
      try {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Xatolik: ' + (err instanceof Error ? err.message.slice(0, 100) : 'noma\'lum'),
          show_alert: true,
        });
      } catch {}
    }
  });
}

// ─────────────── Egasining narxga rozilik javobi (mkt:owner:*) ───────────────
async function handleOwnerConsentCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  action: string,
  accountId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Akkaunt topilmadi', show_alert: true }); } catch {}
    return;
  }
  // Faqat egasi qaror qilishi mumkin
  const owner = await prisma.user.findUnique({
    where: { id: account.ownerId },
    select: { telegramId: true },
  });
  const ownerTgId = owner?.telegramId ? Number(owner.telegramId) : null;
  if (!ownerTgId || ownerTgId !== fromTgId) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov sizga emas', show_alert: true }); } catch {}
    return;
  }

  if (action === 'agree') {
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: 'ACTIVE', isVerified: true, frozenUntil: null },
    });
    try {
      await bot.editMessageText(
        `✅ <b>Rozilik qabul qilindi</b>\n\n` +
          `👤 @${escapeHtml(account.igUsername)}\n` +
          `💰 Reels: ${updated.priceReels.toLocaleString('uz-UZ')} so'm\n\n` +
          `<i>Akkauntingiz marketplace'da faol holatda.</i>`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {}
    try { await bot.answerCallbackQuery(query.id, { text: '✅ Tasdiqlandi' }); } catch {}
    // Qo'llanma video bu yo'lda (ENABLE_SELLER_BOT — hozir o'chiq) yuborilmaydi;
    // production'da bot-forward.ts'dagi 'agree' handleri bir marta yuboradi.
    // Adminlarga ham xabar
    for (const adminId of ADMIN_IDS) {
      bot.sendMessage(
        adminId,
        `✅ Egasi rozilik berdi: @${account.igUsername} (#${accountId}) → ACTIVE`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
    }
  } else if (action === 'cancel') {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: 'PENDING', isVerified: false, priceFeed: 0, priceReels: 0, priceStory: 0 },
    });
    try {
      await bot.editMessageText(
        `❌ <b>Bekor qilindi</b>\n\n` +
          `👤 @${escapeHtml(account.igUsername)}\n\n` +
          `<i>Admin yana ko'rib chiqadi va yangi narx taklif qilishi mumkin.</i>`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {}
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Bekor qilindi' }); } catch {}
    for (const adminId of ADMIN_IDS) {
      bot.sendMessage(
        adminId,
        `❌ Egasi narxni rad etdi: @${account.igUsername} (#${accountId}) → PENDING (yangi ko'rib chiqish kerak)`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
    }
  } else {
    try { await bot.answerCallbackQuery(query.id, { text: 'Noma\'lum amal' }); } catch {}
  }
}

// ─────────────── Admin to'lov skrinshotini tasdiqlash/rad etish ───────────────
async function handleAdminPaymentCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  action: string,
  orderId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
) {
  if (!orderId) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Order ID xato' }); } catch {}
    return;
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } },
  });
  if (!order) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Buyurtma topilmadi', show_alert: true }); } catch {}
    return;
  }
  if (order.status !== 'AWAITING_PAYMENT_APPROVAL') {
    try { await bot.answerCallbackQuery(query.id, { text: `Allaqachon ishlangan (${order.status})`, show_alert: true }); } catch {}
    return;
  }

  if (action === 'approve') {
    // Status → AWAITING_BUYER_MATERIAL: buyer endi video yuborishi kerak.
    // (paymentApprovedBy INT4 — TG id sig'maydi, shu sababli faqat payload'da.)
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'AWAITING_BUYER_MATERIAL' as any,
        paymentApprovedAt: new Date(),
      },
    });
    await prisma.orderEvent.create({
      data: { orderId, type: 'payment_approved', actorId: null, payload: { adminTgId: String(fromTgId) } },
    }).catch(() => {});
    try {
      await bot.editMessageCaption(
        `✅ <b>To'lov tasdiqlandi</b>\n\nOrder <code>#${orderId}</code>. Mijozdan video so'raldi.`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {
      try {
        await bot.editMessageText(
          `✅ <b>To'lov tasdiqlandi</b>\n\nOrder <code>#${orderId}</code>. Mijozdan video so'raldi.`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
        );
      } catch {}
    }
    try { await bot.answerCallbackQuery(query.id, { text: '✅ Tasdiqlandi' }); } catch {}
    const { notifyBuyerForMaterial } = await import('./routes/marketplace/orders');
    notifyBuyerForMaterial(orderId).catch(() => {});
  } else if (action === 'reject') {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'AWAITING_PAYMENT' }, // qaytadan to'lov skrinshoti so'raymiz
    });
    await prisma.orderEvent.create({
      data: { orderId, type: 'payment_rejected', actorId: null, payload: { adminTgId: fromTgId } },
    }).catch(() => {});
    try {
      await bot.editMessageCaption(
        `❌ <b>To'lov rad etildi</b>\n\nOrder <code>#${orderId}</code>. Mijozdan qaytadan skrinshot so'raldi.`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {
      try {
        await bot.editMessageText(
          `❌ <b>To'lov rad etildi</b>\n\nOrder <code>#${orderId}</code>.`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
        );
      } catch {}
    }
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Rad etildi' }); } catch {}
    const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
    if (buyerTgId) {
      const text =
        `❌ <b>To'lov tasdiqlanmadi</b>\n\n` +
        `Order <code>#${orderId}</code>. Iltimos, to'lovni qaytadan amalga oshiring va skrinshotni qayta yuboring.`;
      try {
        const phpBotMod = await import('./lib/php-bot-bridge');
        if (phpBotMod.phpBot.isReady()) {
          await phpBotMod.phpBot.sendMessage(buyerTgId, text);
        }
      } catch {}
    }
  } else {
    try { await bot.answerCallbackQuery(query.id, { text: 'Noma\'lum amal' }); } catch {}
  }
}

// ─────────────── Admin account boshqaruvi (freeze / unfreeze / delete) ───────────────
async function handleAdminAccountCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  action: string,
  accountId: number,
  arg: number,
  chatId: number,
  messageId: number,
) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Akkaunt topilmadi', show_alert: true }); } catch {}
    try { await bot.editMessageText('❌ Akkaunt topilmadi yoki o\'chirilgan', { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }

  if (action === 'freeze') {
    const days = Math.max(1, Math.min(365, arg || 1));
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: 'SUSPENDED', frozenUntil: until },
    });
    try {
      await bot.editMessageText(accountAdminCard(updated), {
        chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
        reply_markup: accountAdminButtons(updated) as any,
      });
    } catch {}
    await createNotification(
      account.ownerId,
      'ACCOUNT_REJECTED',
      'Akkaunt muzlatildi 🧊',
      `@${account.igUsername} akkauntingiz ${days} kunga muzlatildi. Tugaydi: ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    ).catch(() => {});
    try { await bot.answerCallbackQuery(query.id, { text: `🧊 ${days} kunga muzlatildi` }); } catch {}
  } else if (action === 'unfreeze') {
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: 'ACTIVE', frozenUntil: null, isVerified: true },
    });
    try {
      await bot.editMessageText(accountAdminCard(updated), {
        chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
        reply_markup: accountAdminButtons(updated) as any,
      });
    } catch {}
    await createNotification(
      account.ownerId,
      'ACCOUNT_VERIFIED',
      'Akkaunt qayta faollashtirildi ▶️',
      `@${account.igUsername} akkauntingiz marketplace'da yana faol holatda.`,
    ).catch(() => {});
    try { await bot.answerCallbackQuery(query.id, { text: '▶️ Faollashtirildi' }); } catch {}
  } else if (action === 'delete') {
    try {
      await prisma.adAccount.delete({ where: { id: accountId } });
    } catch (e: any) {
      // Agar bog'langan order'lar mavjud bo'lsa — soft delete: BANNED
      await prisma.adAccount.update({ where: { id: accountId }, data: { status: 'BANNED' } });
      try {
        await bot.editMessageText(
          `⛔️ <b>@${escapeHtml(account.igUsername)}</b> (#${accountId})\n\n` +
            `Akkauntda buyurtmalar bor — to'liq o'chirib bo'lmadi.\n` +
            `Status: <b>BANNED</b> (marketplaceda ko'rinmaydi).`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
        );
      } catch {}
      try { await bot.answerCallbackQuery(query.id, { text: '⛔️ Soft delete: BANNED' }); } catch {}
      return;
    }
    try {
      await bot.editMessageText(
        `🗑 <b>@${escapeHtml(account.igUsername)}</b> (#${accountId}) o'chirildi`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {}
    try { await bot.answerCallbackQuery(query.id, { text: '🗑 O\'chirildi' }); } catch {}
  } else {
    try { await bot.answerCallbackQuery(query.id, { text: 'Noma\'lum amal' }); } catch {}
  }
}

// ─────────────── Verify (account) ───────────────
async function handleVerifyCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  accountId: number,
  action: string,
  chatId: number,
  messageId: number,
  adminTgId: number,
) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Akkaunt topilmadi', show_alert: true }); } catch {}
    return;
  }

  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });

  const sub = getSubmission(accountId, chatId);

  if (action === 'price') {
    // Admin "💰 Narx belgilash" tugmasini bosdi → force_reply bilan raqam so'raymiz
    setAwaitingPrice(chatId, accountId);
    try {
      const ask = (await bot.sendMessage(
        chatId,
        `💰 <b>Narxni so'mda yuboring</b> (raqam, masalan: <code>250000</code>)\n\n👤 @${account.igUsername}`,
        { parse_mode: 'HTML', reply_markup: { force_reply: true } as any },
      )) as any;
      if (sub) sub.priceAskMsgId = ask?.message_id;
    } catch {}
    try { await bot.answerCallbackQuery(query.id); } catch {}
    return;
  }

  if (action === 'chat') {
    // Admin "💬 Egasiga yozish" bosdi → ownerni tekshiramiz, awaitingAdminMessage set qilamiz
    const acc = await prisma.adAccount.findUnique({
      where: { id: accountId },
      include: { owner: true },
    });
    const ownerTgIdBig = acc?.owner?.telegramId;
    if (!ownerTgIdBig) {
      try { await bot.answerCallbackQuery(query.id, { text: 'Egasi topilmadi', show_alert: true }); } catch {}
      return;
    }
    const ownerTgId = Number(ownerTgIdBig);
    const { setAwaitingAdminMessage, setLastChatAdmin } = await import('./lib/account-submissions');
    setAwaitingAdminMessage(chatId, accountId, ownerTgId);
    // Owner javob bersa ANIQ SHU admin'ga qaytishi uchun — ADMIN_IDS[0]ga
    // hardcode qilingan eski xatoni to'g'rilaydi (bir nechta admin bo'lganda
    // javob noto'g'ri odamga ketardi).
    setLastChatAdmin(accountId, chatId);
    try {
      await bot.sendMessage(
        chatId,
        `💬 <b>Egasiga xabar yozish</b>\n\n` +
        `👤 Akkaunt: <code>#${accountId}</code> · @${account.igUsername}\n\n` +
        `Keyingi yuboradigan xabaringiz <b>anonim tarzda</b> egasiga (Top_sxema bot orqali) yetkaziladi.\n\n` +
        `<i>10 daqiqa ichida yuboring.</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'admchat:cancel' }]] } },
      );
    } catch {}
    try { await bot.answerCallbackQuery(query.id, { text: '✍️ Xabar yozing' }); } catch {}
    return;
  }

  if (action === 'approve') {
    // Stars_bazar uslubi: narx belgilanmagan bo'lsa tasdiqlashga ruxsat yo'q
    if (sub && !sub.price) {
      try { await bot.answerCallbackQuery(query.id, { text: 'Avval narx belgilang!', show_alert: true }); } catch {}
      return;
    }
    const price = sub?.price ?? 0;
    // Marketplace faqat REELS uchun ishlaydi — Story/Feed narxi nolda qoladi.
    const priceReels = price;

    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        reviewedAt: new Date(),
        reviewedBy: admin?.id ?? null,
        priceReels,
        priceFeed: 0,
        priceStory: 0,
        // status: PENDING (o'zgarmaydi)
      },
    });

    // Egasining Telegram ID'sini olamiz va rozilik so'rovi yuboramiz
    const owner = await prisma.user.findUnique({
      where: { id: account.ownerId },
      select: { telegramId: true },
    });
    const ownerTgId = owner?.telegramId ? Number(owner.telegramId) : null;
    let ownerSent = false;
    if (ownerTgId) {
      // Narx rozilik so'rovi: PHP bridge (Top_sxema_instagrambot eski xostingda) bor bo'lsa
      // shu orqali yuboramiz — VPS polling qilmasdan ishlatadi. Aks holda asosiy bot.
      const consentText =
        `🆕 <b>Akkauntingiz Reels narxi belgilandi</b>\n\n` +
        `👤 <b>@${escapeHtml(account.igUsername)}</b>\n` +
        `🎬 Format: <b>REELS</b>\n` +
        `💰 Narx: <code>${priceReels.toLocaleString('uz-UZ')}</code> so'm\n\n` +
        `<i>Roziman bossangiz — akkaunt marketplaceda Reels video ulash buyurtmalarini qabul qila boshlaydi.\n` +
        `Bekor qilsangiz — admin yana ko'rib chiqadi.</i>`;
      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '✅ Roziman', callback_data: `mkt:owner:agree:${accountId}:0` },
            { text: '❌ Bekor qilish', callback_data: `mkt:owner:cancel:${accountId}:0` },
          ],
        ],
      };
      try {
        if (phpBot.isReady()) {
          await phpBot.sendMessage(ownerTgId, consentText, { replyMarkup });
        } else {
          const targetBot = getSellerBot() || bot;
          await targetBot.sendMessage(ownerTgId, consentText, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup as any,
          });
        }
        ownerSent = true;
      } catch (e) {
        console.warn('owner price-consent send failed:', e instanceof Error ? e.message : e);
      }

      // Qo'llanma video bu yerda YUBORILMAYDI — sotuvchi rozilik berib akkaunti
      // e'longa qo'yilganda bir marta boradi (bot-forward.ts, owner 'agree').
      // Avval shu yerda ham yuborilib, sotuvchi bir videoni 3 marta olardi.
    }

    // Admin xabarini yangilaymiz
    try {
      await bot.editMessageText(
        `🕓 <b>Egasi qarorini kutmoqda</b>\n\n` +
          `👤 @${escapeHtml(account.igUsername)}\n` +
          `💰 ${price.toLocaleString('uz-UZ')} so'm\n` +
          `🆔 <code>#${accountId}</code>\n\n` +
          (ownerSent
            ? `<i>Egasiga rozilik so'rovi yuborildi.</i>`
            : `⚠️ <i>Egaga xabar yuborib bo'lmadi (bot bilan suhbat ochmagan bo'lishi mumkin).</i>`),
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {}
    try { await bot.answerCallbackQuery(query.id, { text: ownerSent ? '✅ Egasiga yuborildi' : '⚠️ Egaga yetkazib bo\'lmadi' }); } catch {}

    // Boshqa adminlarga ham yuborilgan bo'lsa — ularning xabarlarini ham
    // yangilaymiz (aks holda ularning tugmalari faol qolib, ikkinchi marta
    // narx belgilashga/tasdiqlashga urinishlari mumkin edi — aynan shu
    // "bir admin uchun ishlaydi, ikkinchisi uchun yo'q" nosozlik shu yerdan
    // kelib chiqardi).
    for (const other of getAllSubmissionsForAccount(accountId)) {
      if (other.adminChatId === chatId) continue;
      await bot.editMessageText(
        `🕓 <b>Egasi qarorini kutmoqda</b>\n\n` +
          `👤 @${escapeHtml(account.igUsername)}\n` +
          `💰 ${price.toLocaleString('uz-UZ')} so'm\n` +
          `🆔 <code>#${accountId}</code>\n\n` +
          `<i>Boshqa admin tomonidan narx belgilandi va yuborildi.</i>`,
        { chat_id: other.adminChatId, message_id: other.buttonsMsgId, parse_mode: 'HTML' },
      ).catch(() => {});
      if (other.priceAskMsgId) {
        await bot.deleteMessage(other.adminChatId, other.priceAskMsgId).catch(() => {});
      }
    }
    deleteAllSubmissionsForAccount(accountId);
  } else if (action === 'reject') {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        status: 'SUSPENDED',
        isVerified: false,
        reviewedAt: new Date(),
        reviewedBy: admin?.id ?? null,
      },
    });

    await createNotification(
      account.ownerId,
      'ACCOUNT_REJECTED',
      'Akkaunt rad etildi ❌',
      `@${account.igUsername} akkauntingiz tekshiruvdan o'tmadi. Iltimos, ma'lumotlarni qayta yuboring.`,
    );

    // Albom + tugmali xabar + narx so'rovi xabarini butunlay o'chiramiz —
    // BARCHA adminlar uchun (kim ko'rgan bo'lsa ham), har biri O'Z chatida.
    if (sub) {
      for (const other of getAllSubmissionsForAccount(accountId)) {
        for (const mid of other.mediaGroupMsgIds) {
          await bot.deleteMessage(other.adminChatId, mid).catch(() => {});
        }
        if (other.priceAskMsgId) {
          await bot.deleteMessage(other.adminChatId, other.priceAskMsgId).catch(() => {});
        }
        await bot.deleteMessage(other.adminChatId, other.buttonsMsgId).catch(() => {});
      }
      deleteAllSubmissionsForAccount(accountId);
    } else {
      // Fallback (eski xabar) — faqat tugmali xabarni tahrirlaymiz
      try {
        await bot.editMessageText(
          `❌ <b>Rad etildi</b>\n\n👤 @${account.igUsername}\n🆔 <code>#${accountId}</code>`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
        );
      } catch {}
    }
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Rad etildi' }); } catch {}
  }
}

// ACTIVE akkaunt uchun rasm/skrinshot YANGILANISH so'rovini ko'rib chiqish
// (mkt:editreq:<id>:approve|reject). handleVerifyCallback'dan farqi: narx
// belgilash bosqichi YO'Q (akkaunt allaqachon narxga ega, faqat rasm/skrinshot
// o'zgaradi) va tasdiqlansa DARHOL live maydonlarga yoziladi — owner rozilik
// berishi shart emas (bu yerda faqat rasm sifatini admin tekshiradi, narx
// o'zgarmagani uchun yangi kelishuv shart emas).
async function handleEditReviewCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  accountId: number,
  action: string,
  chatId: number,
  messageId: number,
  adminTgId: number,
) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Akkaunt topilmadi', show_alert: true }); } catch {}
    return;
  }
  const pendingEdit = account.pendingEdit as { avatarFileId: string; screenshots: string[] } | null;
  if (!pendingEdit) {
    // Boshqa admin allaqachon hal qilgan bo'lishi mumkin — shu xabarni tozalab qo'yamiz.
    try { await bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov allaqachon ko\'rib chiqilgan', show_alert: true }); } catch {}
    for (const mid of getSubmission(accountId, chatId)?.mediaGroupMsgIds ?? []) {
      await bot.deleteMessage(chatId, mid).catch(() => {});
    }
    await bot.deleteMessage(chatId, messageId).catch(() => {});
    return;
  }

  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });

  if (action === 'approve') {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        avatarFileId: pendingEdit.avatarFileId,
        verificationScreenshots: pendingEdit.screenshots,
        pendingEdit: null,
        reviewedAt: new Date(),
        reviewedBy: admin?.id ?? null,
      },
    });

    await createNotification(
      account.ownerId,
      'ACCOUNT_VERIFIED',
      "Akkaunt yangilandi ✅",
      `@${account.igUsername} akkauntingizning yangi rasm/skrinshotlari tasdiqlandi.`,
    );

    try {
      await bot.editMessageText(
        `✅ <b>Tasdiqlandi</b>\n\n👤 @${escapeHtml(account.igUsername)}\n🆔 <code>#${accountId}</code>`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {}
    try { await bot.answerCallbackQuery(query.id, { text: '✅ Tasdiqlandi' }); } catch {}
  } else if (action === 'reject') {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: { pendingEdit: null },
    });

    await createNotification(
      account.ownerId,
      'ACCOUNT_REJECTED',
      "Akkaunt yangilanish so'rovi rad etildi ❌",
      `@${account.igUsername} akkauntingiz uchun so'ralgan rasm/skrinshot o'zgarishi rad etildi. Eski ma'lumotlar o'zgarishsiz qoladi.`,
    );

    try {
      await bot.editMessageText(
        `❌ <b>Rad etildi</b>\n\n👤 @${escapeHtml(account.igUsername)}\n🆔 <code>#${accountId}</code>`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
      );
    } catch {}
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Rad etildi' }); } catch {}
  }

  // Boshqa adminlarga ham yuborilgan bo'lsa — ularning albom + tugmali
  // xabarlarini ham tozalaymiz (bir admin hal qilgach, qolganlar eskirgan
  // tugmani bosib qolmasin).
  for (const other of getAllSubmissionsForAccount(accountId)) {
    if (other.adminChatId === chatId) continue;
    for (const mid of other.mediaGroupMsgIds) {
      await bot.deleteMessage(other.adminChatId, mid).catch(() => {});
    }
    await bot.deleteMessage(other.adminChatId, other.buttonsMsgId).catch(() => {});
  }
  deleteAllSubmissionsForAccount(accountId);
}

// Admin akkaunt egasining javobi ostidagi "🚫 Bloklash" tugmasini bosdi —
// bazaga yoziladi (server restart bo'lsa ham yo'qolmaydi), shundan keyin
// owner "✍️ Javob yozish" tugmasini bossa ham rad etiladi.
async function handleVchatBlockCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  accountId: number,
  ownerTgId: number,
  chatId: number,
  messageId: number,
) {
  if (!ownerTgId) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Foydalanuvchi topilmadi', show_alert: true }); } catch {}
    return;
  }
  const { getAwaitingOwnerReply, clearAwaitingOwnerReply } = await import('./lib/account-submissions');
  await prisma.user.updateMany({
    where: { telegramId: BigInt(ownerTgId) },
    data: { blockedFromAdminChat: true },
  }).catch((e) => console.error('handleVchatBlockCallback update error:', e));
  // Agar hozir "javob yozmoqchi" holatida bo'lsa — shu holatni ham tozalaymiz.
  if (getAwaitingOwnerReply(ownerTgId)) clearAwaitingOwnerReply(ownerTgId);

  try {
    await bot.editMessageText(
      `🚫 <b>Bloklandi</b>\n\n` +
      `Akkaunt <code>#${accountId}</code> egasi endi bu anonim chat orqali xabar yoza olmaydi.`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' },
    );
  } catch {}
  try { await bot.answerCallbackQuery(query.id, { text: '🚫 Bloklandi' }); } catch {}
}

// ─────────────── Payout ───────────────
async function handlePayoutCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  payoutId: number,
  action: string,
  chatId: number,
  messageId: number,
  adminTgId: number,
) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Payout topilmadi', show_alert: true }); } catch {}
    return;
  }
  if (payout.status !== 'PENDING') {
    try { await bot.answerCallbackQuery(query.id, { text: 'Payout allaqachon ko\'rib chiqilgan', show_alert: true }); } catch {}
    return;
  }

  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });

  if (action === 'approve') {
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: { status: 'PAID', processedAt: new Date(), processedBy: admin?.id ?? null },
      });

      // Wallet: frozenBalance -> 0 va PAYOUT tranzaksiya
      const wallet = await tx.wallet.findUnique({ where: { userId: payout.userId } });
      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { frozenBalance: { decrement: payout.amount } },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'PAYOUT',
            amount: -payout.amount,
            status: 'COMPLETED',
            payoutId: payout.id,
            note: 'Payout to\'landi',
          },
        });
      }
    });

    await createNotification(
      payout.userId,
      'PAYOUT_APPROVED',
      'Payout tasdiqlandi ✅',
      `${formatUZS(payout.amount)} miqdoridagi pulingiz ${payout.cardNumber.slice(-4)} bilan tugovchi kartaga o'tkazildi.`,
    );

    await editAdminMessage(bot, chatId, messageId, query.message?.text || '', '✅ To\'landi');
    try { await bot.answerCallbackQuery(query.id, { text: '✅ To\'landi' }); } catch {}
  } else if (action === 'reject') {
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: 'REJECTED',
          processedAt: new Date(),
          processedBy: admin?.id ?? null,
          rejectReason: 'Admin tomonidan rad etildi',
        },
      });

      // Frozen -> balance qaytarish
      const wallet = await tx.wallet.findUnique({ where: { userId: payout.userId } });
      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            frozenBalance: { decrement: payout.amount },
            balance: { increment: payout.amount },
          },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'ADJUSTMENT',
            amount: payout.amount,
            status: 'COMPLETED',
            payoutId: payout.id,
            note: 'Payout rad etildi — pul qaytarildi',
          },
        });
      }
    });

    await createNotification(
      payout.userId,
      'PAYOUT_REJECTED',
      'Payout rad etildi ❌',
      `${formatUZS(payout.amount)} miqdoridagi yechib olish so'rovingiz rad etildi. Pul balansingizga qaytarildi.`,
    );

    await editAdminMessage(bot, chatId, messageId, query.message?.text || '', '❌ Rad etildi');
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Rad etildi' }); } catch {}
  }
}

// ─────────────── Dispute ───────────────
async function handleDisputeCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  disputeId: number,
  action: string,
  chatId: number,
  messageId: number,
  adminTgId: number,
) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { order: true },
  });
  if (!dispute) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Dispute topilmadi', show_alert: true }); } catch {}
    return;
  }
  if (dispute.status !== 'OPEN') {
    try { await bot.answerCallbackQuery(query.id, { text: 'Dispute allaqachon yopilgan', show_alert: true }); } catch {}
    return;
  }

  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });
  const order = dispute.order;

  if (action === 'resolve_adv') {
    // Mijoz foydasiga — to'liq refund
    await refundEscrow(order.id);
    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED_ADVERTISER',
        refundAmount: order.price,
        resolvedAt: new Date(),
        resolvedBy: admin?.id ?? null,
        resolution: 'Mijoz foydasiga hal qilindi — to\'liq refund',
      },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'REFUNDED' },
    });

    await createNotification(
      order.advertiserId,
      'ORDER_DISPUTED',
      'Shikoyat hal qilindi ✅',
      `Buyurtma #${order.id} bo'yicha to'liq pul qaytarildi (${formatUZS(order.price)}).`,
    );

    await editAdminMessage(bot, chatId, messageId, query.message?.text || '', '✅ Mijoz foydasiga');
    try { await bot.answerCallbackQuery(query.id, { text: '✅ Mijoz foydasiga' }); } catch {}
  } else if (action === 'resolve_own') {
    // Akkaunt egasi foydasiga — escrow release
    await releaseEscrow(order.id);
    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED_OWNER',
        refundAmount: 0,
        resolvedAt: new Date(),
        resolvedBy: admin?.id ?? null,
        resolution: 'Akkaunt egasi foydasiga hal qilindi',
      },
    });

    const owner = await prisma.adAccount.findUnique({
      where: { id: order.adAccountId },
      select: { ownerId: true },
    });
    if (owner) {
      await createNotification(
        owner.ownerId,
        'ORDER_COMPLETED',
        'Shikoyat hal qilindi ✅',
        `Buyurtma #${order.id} bo'yicha pul sizga ozod qilindi (${formatUZS(order.escrowAmount)}).`,
      );
    }

    await editAdminMessage(bot, chatId, messageId, query.message?.text || '', '✅ Egasi foydasiga');
    try { await bot.answerCallbackQuery(query.id, { text: '✅ Egasi foydasiga' }); } catch {}
  } else if (action === 'partial') {
    // 50/50 oddiy variant
    const partialRefund = Math.round(order.price / 2);
    await refundEscrow(order.id, partialRefund);
    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED_PARTIAL',
        refundAmount: partialRefund,
        resolvedAt: new Date(),
        resolvedBy: admin?.id ?? null,
        resolution: `Qisman refund: ${formatUZS(partialRefund)}`,
      },
    });

    await createNotification(
      order.advertiserId,
      'ORDER_DISPUTED',
      'Shikoyat qisman hal qilindi',
      `Buyurtma #${order.id} bo'yicha ${formatUZS(partialRefund)} qaytarildi.`,
    );

    await editAdminMessage(bot, chatId, messageId, query.message?.text || '', '✅ Qisman refund');
    try { await bot.answerCallbackQuery(query.id, { text: '✅ Qisman refund' }); } catch {}
  }
}

// ─────────────── Helpers ───────────────
async function editAdminMessage(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  originalText: string,
  suffix: string,
) {
  try {
    await bot.editMessageText(`${originalText}\n\n— ${suffix}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (err) {
    // Xabar parse modedan tashqarida bo'lishi mumkin — keyboard'ni alohida olib tashlashga harakat
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: messageId },
      );
    } catch {}
  }
}

function formatUZS(amount: number): string {
  return new Intl.NumberFormat('uz-UZ').format(amount) + ' UZS';
}
