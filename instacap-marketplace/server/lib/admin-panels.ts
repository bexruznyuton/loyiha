/**
 * Insy (admin) bot panellari — faqat matn + inline klaviatura yasaydi, bot'ga
 * yuborish bot-marketplace.ts da.
 *
 *  - 📊 Statistika: kim kim bilan video ulagani (buyurtmalar ro'yxati, filtr
 *    va sahifalash bilan).
 *  - ☑️ Verify: marketplace akkauntlariga ko'k nishon berish / olib tashlash;
 *    akkaunt, Telegram ID yoki Telegram username bo'yicha eng yaqin 8 natija.
 */

import { prisma } from './prisma';

type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> };
export interface Panel {
  text: string;
  replyMarkup: InlineKeyboard;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtNum = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
const fmtCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n);
const fmtDate = (d: Date) =>
  d.toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');

type TgUser = { firstName: string; lastName: string; username: string; telegramId: bigint };
function tgUserLabel(u: TgUser): string {
  const name = esc(`${u.firstName} ${u.lastName}`.trim() || 'Nomsiz');
  return u.username ? `${name} (@${esc(u.username)})` : `${name} (<code>${u.telegramId}</code>)`;
}

// Sahifadagi joriy holatda turgan tugma uchun — bosilsa hech narsa qilmaydi.
const NOOP = 'adm:noop';

function navRow(page: number, totalPages: number, cb: (p: number) => string) {
  return [
    page > 0 ? { text: '◀️', callback_data: cb(page - 1) } : { text: '·', callback_data: NOOP },
    { text: `${page + 1} / ${totalPages}`, callback_data: NOOP },
    page < totalPages - 1 ? { text: '▶️', callback_data: cb(page + 1) } : { text: '·', callback_data: NOOP },
  ];
}

// ─────────────────────────────── 📊 Statistika ───────────────────────────────

export type StatsFilter = 'linked' | 'progress' | 'cancel' | 'all';
const STATS_PAGE_SIZE = 5;

// "Ulangan" — sotuvchi collab'ni qabul qilib havolani yuborgan buyurtmalar.
const LINKED_STATUSES = ['AWAITING_BUYER_VERIFY', 'BUYER_VERIFIED', 'COMPLETED'];
const PROGRESS_STATUSES = [
  'AWAITING_SELLER_CONSENT',
  'AWAITING_PAYMENT',
  'AWAITING_PAYMENT_APPROVAL',
  'AWAITING_BUYER_MATERIAL',
  'PAYMENT_APPROVED',
  'DISPUTED',
];
const CANCEL_STATUSES = ['CANCELLED', 'REFUNDED', 'EXPIRED'];
const CONFIRMED_STATUSES = ['BUYER_VERIFIED', 'COMPLETED'];

const STATUS_LABEL: Record<string, string> = {
  AWAITING_SELLER_CONSENT: '🕓 Sotuvchi roziligi kutilmoqda',
  AWAITING_PAYMENT: "🕓 To'lov kutilmoqda",
  AWAITING_PAYMENT_APPROVAL: "🕓 To'lov tekshirilmoqda",
  AWAITING_BUYER_MATERIAL: '🕓 Video joylanishi kutilmoqda',
  PAYMENT_APPROVED: '🕓 Sotuvchi havolasi kutilmoqda',
  AWAITING_BUYER_VERIFY: '🔗 Ulandi, xaridor tasdiqlashi kutilmoqda',
  BUYER_VERIFIED: '✅ Tasdiqlandi, pul 24 soatda o\'tadi',
  COMPLETED: '✅ Yakunlangan',
  DISPUTED: '⚠️ Nizo',
  CANCELLED: '❌ Bekor qilingan',
  REFUNDED: '↩️ Pul qaytarilgan',
  EXPIRED: '⌛ Muddati o\'tgan',
};

const FILTER_STATUSES: Record<StatsFilter, string[] | null> = {
  linked: LINKED_STATUSES,
  progress: PROGRESS_STATUSES,
  cancel: CANCEL_STATUSES,
  all: null,
};
const FILTER_LABEL: Record<StatsFilter, string> = {
  linked: '🔗 Ulangan',
  progress: '⏳ Jarayonda',
  cancel: '❌ Bekor',
  all: '📋 Hammasi',
};

export function parseStatsFilter(v: string): StatsFilter {
  return (['linked', 'progress', 'cancel', 'all'] as const).includes(v as StatsFilter) ? (v as StatsFilter) : 'linked';
}

export async function buildStatsPanel(filter: StatsFilter, page: number): Promise<Panel> {
  const statusWhere = (list: string[] | null) => (list ? { status: { in: list as any } } : {});
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const [linked, progress, cancel, all, linkedToday, linked7d, confirmedAgg] = await Promise.all([
    prisma.order.count({ where: statusWhere(LINKED_STATUSES) }),
    prisma.order.count({ where: statusWhere(PROGRESS_STATUSES) }),
    prisma.order.count({ where: statusWhere(CANCEL_STATUSES) }),
    prisma.order.count(),
    prisma.orderEvent.count({ where: { type: 'seller_link_uploaded', createdAt: { gte: new Date(now - DAY) } } }),
    prisma.orderEvent.count({ where: { type: 'seller_link_uploaded', createdAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.order.aggregate({ where: statusWhere(CONFIRMED_STATUSES), _sum: { price: true, commissionAmount: true } }),
  ]);
  const counts: Record<StatsFilter, number> = { linked, progress, cancel, all };

  const total = counts[filter];
  const totalPages = Math.max(1, Math.ceil(total / STATS_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const orders = await prisma.order.findMany({
    where: statusWhere(FILTER_STATUSES[filter]),
    orderBy: { updatedAt: 'desc' },
    skip: safePage * STATS_PAGE_SIZE,
    take: STATS_PAGE_SIZE,
    include: {
      advertiser: { select: { firstName: true, lastName: true, username: true, telegramId: true } },
      adAccount: {
        select: {
          igUsername: true,
          owner: { select: { firstName: true, lastName: true, username: true, telegramId: true } },
        },
      },
      events: {
        where: { type: { in: ['seller_link_uploaded', 'buyer_link_relayed'] } },
        orderBy: { createdAt: 'desc' },
        select: { type: true, payload: true },
      },
    },
  });

  const header =
    `📊 <b>Marketplace statistikasi</b>\n\n` +
    `🔗 Ulangan videolar: <b>${fmtNum(linked)}</b>  <i>(24 soat: ${linkedToday} · 7 kun: ${linked7d})</i>\n` +
    `⏳ Jarayonda: <b>${fmtNum(progress)}</b>\n` +
    `❌ Bekor / qaytarilgan: <b>${fmtNum(cancel)}</b>\n` +
    `💰 Tasdiqlangan aylanma: <b>${fmtNum(confirmedAgg._sum.price || 0)}</b> so'm\n` +
    `🏦 Komissiya: <b>${fmtNum(confirmedAgg._sum.commissionAmount || 0)}</b> so'm`;

  const items = orders.map((o) => {
    // Sotuvchi yuborgan havola — asosiy (collab qabul qilingan post); bo'lmasa xaridornikini ko'rsatamiz.
    const sellerLink = o.events.find((e) => e.type === 'seller_link_uploaded');
    const anyLink = sellerLink || o.events[0];
    const url = String((anyLink?.payload as any)?.url || '');
    const owner = o.adAccount.owner;
    return (
      `<b>#${o.id}</b> · ${STATUS_LABEL[o.status] || o.status}\n` +
      `🛒 ${tgUserLabel(o.advertiser)}` +
      (o.targetIgUsername ? ` → IG <b>@${esc(o.targetIgUsername)}</b>` : '') +
      `\n🤝 <b>@${esc(o.adAccount.igUsername)}</b>` +
      (owner ? ` — ${tgUserLabel(owner)}` : '') +
      `\n💵 ${fmtNum(o.price)} so'm · 🗓 ${fmtDate(o.updatedAt)}` +
      (url ? ` · <a href="${esc(url)}">${sellerLink ? 'Video' : 'Xaridor havolasi'}</a>` : '')
    );
  });

  const body = items.length
    ? `<b>${FILTER_LABEL[filter]}</b> — ${fmtNum(total)} ta\n\n${items.join('\n\n')}`
    : `<b>${FILTER_LABEL[filter]}</b>\n\n<i>Bu bo'limda hozircha buyurtma yo'q.</i>`;

  const filterBtn = (f: StatsFilter) => ({
    text: `${f === filter ? '• ' : ''}${FILTER_LABEL[f]} (${counts[f]})`,
    callback_data: `mstat:${f}:0`,
  });

  return {
    text: `${header}\n\n━━━━━━━━━━━━━━\n${body}`,
    replyMarkup: {
      inline_keyboard: [
        [filterBtn('linked'), filterBtn('progress')],
        [filterBtn('cancel'), filterBtn('all')],
        ...(totalPages > 1 ? [navRow(safePage, totalPages, (p) => `mstat:${filter}:${p}`)] : []),
        [{ text: '🔄 Yangilash', callback_data: `mstat:${filter}:${safePage}` }],
      ],
    },
  };
}

// ─────────────────────────────── ☑️ Verify ───────────────────────────────

const VERIFY_PAGE_SIZE = 8;
export const VERIFY_SEARCH_LIMIT = 8;
const SEARCH_MIN_SCORE = 0.45;

const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Faol',
  PENDING: 'Tasdiq kutilmoqda',
  SUSPENDED: "To'xtatilgan",
  BANNED: 'Bloklangan',
};

const accountButton = (a: { id: number; igUsername: string; verifiedBadge: boolean; followers: number }, back: string) => ({
  text: `${a.verifiedBadge ? '✅' : '▫️'} @${a.igUsername} · ${fmtCompact(a.followers)}`,
  callback_data: `mver:a:${a.id}:${back}`,
});

// back: "l<page>" — ro'yxat sahifasi, "s" — oxirgi qidiruv natijalari.
export async function buildVerifyListPanel(page: number): Promise<Panel> {
  const where = { status: { not: 'BANNED' as const } };
  const [total, badged] = await Promise.all([
    prisma.adAccount.count({ where }),
    prisma.adAccount.count({ where: { ...where, verifiedBadge: true } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / VERIFY_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const accounts = await prisma.adAccount.findMany({
    where,
    // Nishonlilar tepada, keyin eng yiriklari.
    orderBy: [{ verifiedBadge: 'desc' }, { followers: 'desc' }, { id: 'asc' }],
    skip: safePage * VERIFY_PAGE_SIZE,
    take: VERIFY_PAGE_SIZE,
    select: { id: true, igUsername: true, verifiedBadge: true, followers: true },
  });

  const text =
    `☑️ <b>Verify nishoni</b>\n\n` +
    `Marketplace akkauntlariga ko'k nishon berish yoki olib tashlash.\n\n` +
    `✅ Nishonli: <b>${badged}</b> / ${total}\n\n` +
    (accounts.length
      ? `<i>Akkauntni tanlang yoki 🔍 qidiring: Instagram username, Telegram ID yoki Telegram username.</i>`
      : `<i>Hozircha akkaunt yo'q.</i>`);

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        ...accounts.map((a) => [accountButton(a, `l${safePage}`)]),
        ...(totalPages > 1 ? [navRow(safePage, totalPages, (p) => `mver:l:${p}`)] : []),
        [{ text: '🔍 Qidirish', callback_data: 'mver:q' }],
      ],
    },
  };
}

export async function buildVerifyAccountPanel(accountId: number, back: string): Promise<Panel | null> {
  const acc = await prisma.adAccount.findUnique({
    where: { id: accountId },
    include: { owner: { select: { firstName: true, lastName: true, username: true, telegramId: true } } },
  });
  if (!acc) return null;

  const text =
    `☑️ <b>Verify nishoni</b>\n\n` +
    `📸 <b>@${esc(acc.igUsername)}</b>\n` +
    `${acc.verifiedBadge ? '✅ Nishon berilgan' : "▫️ Nishon yo'q"}\n\n` +
    `👤 Egasi: ${acc.owner ? tgUserLabel(acc.owner) : '—'}\n` +
    (acc.owner ? `🆔 Telegram ID: <code>${acc.owner.telegramId}</code>\n` : '') +
    `👥 Obunachilar: <b>${fmtCompact(acc.followers)}</b>\n` +
    `💰 Reels narxi: <b>${fmtNum(acc.priceReels)}</b> so'm\n` +
    `📦 Yakunlangan buyurtmalar: <b>${acc.completedOrders}</b>\n` +
    `📍 Holati: ${ACCOUNT_STATUS_LABEL[acc.status] || acc.status}`;

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          acc.verifiedBadge
            ? { text: '✖️ Nishonni olib tashlash', callback_data: `mver:t:${acc.id}:${back}` }
            : { text: '✅ Verify nishonini berish', callback_data: `mver:t:${acc.id}:${back}` },
        ],
        [{ text: back === 's' ? '◀️ Qidiruv natijalari' : "◀️ Ro'yxatga qaytish", callback_data: back === 's' ? 'mver:s' : `mver:l:${back.slice(1) || 0}` }],
      ],
    },
  };
}

export async function toggleVerifiedBadge(accountId: number): Promise<boolean | null> {
  const acc = await prisma.adAccount.findUnique({ where: { id: accountId }, select: { verifiedBadge: true } });
  if (!acc) return null;
  const next = !acc.verifiedBadge;
  await prisma.adAccount.update({ where: { id: accountId }, data: { verifiedBadge: next } });
  return next;
}

// ── Qidiruv: eng yaqin 8 ta natija ──

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 0..1 — maydon so'rovga qanchalik yaqin.
export function matchScore(field: string, q: string): number {
  if (!field || !q) return 0;
  if (field === q) return 1;
  if (field.startsWith(q)) return 0.92;
  if (field.includes(q)) return 0.8;
  const similarity = (x: string, y: string) => 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  // Butun so'z bo'yicha va boshlanishi bo'yicha (xato yozilgan qisqa so'rov) — kattasini olamiz.
  return Math.max(similarity(field, q), similarity(field.slice(0, q.length), q) * 0.85) * 0.75;
}

export function normalizeQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?(instagram\.com|t\.me)\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
}

export async function searchAccounts(rawQuery: string): Promise<number[]> {
  const q = normalizeQuery(rawQuery);
  if (q.length < 2) return [];
  const accounts = await prisma.adAccount.findMany({
    where: { status: { not: 'BANNED' } },
    select: {
      id: true,
      igUsername: true,
      followers: true,
      owner: { select: { firstName: true, lastName: true, username: true, telegramId: true } },
    },
  });
  const isNumeric = /^\d+$/.test(q);
  return accounts
    .map((a) => {
      const tgId = a.owner ? String(a.owner.telegramId) : '';
      const scores = [
        matchScore(a.igUsername.toLowerCase(), q),
        matchScore((a.owner?.username || '').toLowerCase(), q),
        matchScore(`${a.owner?.firstName || ''} ${a.owner?.lastName || ''}`.trim().toLowerCase(), q) * 0.85,
        // Telegram ID — faqat aniq yoki boshidan mos kelsa (raqamlarda "o'xshashlik" ma'nosiz).
        isNumeric && tgId ? (tgId === q ? 1 : tgId.startsWith(q) ? 0.9 : 0) : 0,
      ];
      return { id: a.id, followers: a.followers, score: Math.max(...scores) };
    })
    .filter((r) => r.score >= SEARCH_MIN_SCORE)
    .sort((x, y) => y.score - x.score || y.followers - x.followers)
    .slice(0, VERIFY_SEARCH_LIMIT)
    .map((r) => r.id);
}

export async function buildVerifySearchPanel(query: string, ids: number[]): Promise<Panel> {
  const rows = ids.length
    ? await prisma.adAccount.findMany({
        where: { id: { in: ids } },
        select: { id: true, igUsername: true, verifiedBadge: true, followers: true },
      })
    : [];
  // findMany tartibni saqlamaydi — yaqinlik tartibini tiklaymiz.
  const ordered = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as typeof rows;

  const text =
    `🔍 <b>Qidiruv:</b> <code>${esc(query)}</code>\n\n` +
    (ordered.length
      ? `Eng yaqin <b>${ordered.length}</b> ta natija (yaqinlik bo'yicha). Akkauntni tanlang.`
      : `<i>Mos akkaunt topilmadi. Boshqa username yoki Telegram ID bilan urinib ko'ring.</i>`);

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        ...ordered.map((a) => [accountButton(a, 's')]),
        [
          { text: '🔍 Yangi qidiruv', callback_data: 'mver:q' },
          { text: "◀️ Ro'yxat", callback_data: 'mver:l:0' },
        ],
      ],
    },
  };
}

// ─────────────────────────────── 💳 Balans ───────────────────────────────

export const BALANCE_SEARCH_LIMIT = 5;
export const BALANCE_MAX_AMOUNT = 50_000_000;

type BalUser = {
  id: number;
  telegramId: bigint;
  username: string;
  firstName: string;
  lastName: string;
  wallet: { balance: number; frozenBalance: number; depositBalance: number } | null;
};

const walletSelect = { select: { balance: true, frozenBalance: true, depositBalance: true } } as const;

// Telegram username, ID yoki ism bo'yicha eng yaqin 5 ta foydalanuvchi.
export async function searchUsers(rawQuery: string): Promise<number[]> {
  const q = normalizeQuery(rawQuery);
  if (q.length < 2) return [];
  const isNumeric = /^\d+$/.test(q);

  // Avval DB'da toraytiramiz (butun jadvalni xotiraga olmaslik uchun), keyin yaqinlik bo'yicha saralaymiz.
  const prefix = q.slice(0, 2);
  let candidates: Array<{ id: number; telegramId: bigint; username: string; firstName: string; lastName: string }>;
  if (isNumeric) {
    candidates = await prisma.$queryRaw`
      SELECT id, telegram_id AS "telegramId", username, first_name AS "firstName", last_name AS "lastName"
      FROM users WHERE telegram_id::text LIKE ${q + '%'} OR id::text = ${q} LIMIT 500`;
  } else {
    candidates = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: prefix, mode: 'insensitive' } },
          { firstName: { contains: prefix, mode: 'insensitive' } },
          { lastName: { contains: prefix, mode: 'insensitive' } },
        ],
      },
      select: { id: true, telegramId: true, username: true, firstName: true, lastName: true },
      take: 2000,
    });
  }

  return candidates
    .map((u) => {
      const tgId = String(u.telegramId);
      const scores = [
        matchScore((u.username || '').toLowerCase(), q),
        matchScore(`${u.firstName} ${u.lastName}`.trim().toLowerCase(), q) * 0.85,
        isNumeric ? (tgId === q ? 1 : tgId.startsWith(q) ? 0.9 : 0) : 0,
      ];
      return { id: u.id, score: Math.max(...scores) };
    })
    .filter((r) => r.score >= SEARCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, BALANCE_SEARCH_LIMIT)
    .map((r) => r.id);
}

const userTitle = (u: { username: string; firstName: string; lastName: string }) => {
  const name = `${u.firstName} ${u.lastName}`.trim() || 'Nomsiz';
  return u.username ? `${name} (@${u.username})` : name;
};

export async function buildBalanceSearchPanel(query: string, ids: number[]): Promise<Panel> {
  const rows: BalUser[] = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, telegramId: true, username: true, firstName: true, lastName: true, wallet: walletSelect },
      })
    : [];
  const ordered = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as BalUser[];

  const text =
    `💳 <b>Balans</b> — qidiruv: <code>${esc(query)}</code>\n\n` +
    (ordered.length
      ? `Eng yaqin <b>${ordered.length}</b> ta foydalanuvchi. Tanlang:`
      : `<i>Hech kim topilmadi. Telegram ID, @username yoki ism bilan qayta urinib ko'ring.</i>`);
  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        ...ordered.map((u) => [
          {
            text: `${userTitle(u).slice(0, 34)} · ${fmtNum(u.wallet?.balance ?? 0)}`,
            callback_data: `mbal:u:${u.id}`,
          },
        ]),
        [{ text: '🔍 Yangi qidiruv', callback_data: 'mbal:q' }],
      ],
    },
  };
}

export async function buildBalanceUserPanel(userId: number): Promise<Panel | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, telegramId: true, username: true, firstName: true, lastName: true, wallet: walletSelect },
  });
  if (!u) return null;
  const w = u.wallet ?? { balance: 0, frozenBalance: 0, depositBalance: 0 };
  const withdrawable = Math.max(0, w.balance - w.depositBalance);
  const recent = u.wallet
    ? await prisma.transaction.findMany({
        where: { wallet: { userId } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { type: true, amount: true, note: true, createdAt: true },
      })
    : [];

  const text =
    `💳 <b>${esc(userTitle(u))}</b>\n` +
    `🆔 Telegram ID: <code>${u.telegramId}</code>\n\n` +
    `💰 Balans: <b>${fmtNum(w.balance)}</b> so'm\n` +
    `   ├ yechib olish mumkin: ${fmtNum(withdrawable)}\n` +
    `   └ faqat ilova ichida: ${fmtNum(Math.min(w.depositBalance, w.balance))}\n` +
    `🧊 Muzlatilgan: ${fmtNum(w.frozenBalance)} so'm` +
    (recent.length
      ? `\n\n<b>Oxirgi amallar:</b>\n` +
        recent
          .map((t) => `• ${fmtDate(t.createdAt)} · ${t.amount > 0 ? '+' : ''}${fmtNum(t.amount)} · ${esc((t.note || t.type).slice(0, 40))}`)
          .join('\n')
      : '');

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "➕ Qo'shish", callback_data: `mbal:add_w:${u.id}` },
          { text: '➖ Ayirish', callback_data: `mbal:sub:${u.id}` },
        ],
        [{ text: '➕ Faqat ilova ichida (yechilmaydi)', callback_data: `mbal:add_d:${u.id}` }],
        [
          { text: '◀️ Natijalar', callback_data: 'mbal:s' },
          { text: '🔍 Yangi qidiruv', callback_data: 'mbal:q' },
        ],
      ],
    },
  };
}

export type BalanceMode = 'add_w' | 'add_d' | 'sub';
export interface BalanceOp {
  userId: number;
  mode: BalanceMode;
  amount: number;
  reason: string;
}

export const BALANCE_MODE_LABEL: Record<BalanceMode, string> = {
  add_w: "➕ Qo'shish (yechib olish mumkin)",
  add_d: "➕ Qo'shish (faqat ilova ichida)",
  sub: '➖ Ayirish',
};

export async function buildBalanceConfirmPanel(op: BalanceOp): Promise<Panel | null> {
  const u = await prisma.user.findUnique({
    where: { id: op.userId },
    select: { id: true, telegramId: true, username: true, firstName: true, lastName: true, wallet: walletSelect },
  });
  if (!u) return null;
  const before = u.wallet?.balance ?? 0;
  const after = op.mode === 'sub' ? before - op.amount : before + op.amount;
  const insufficient = op.mode === 'sub' && after < 0;
  const text =
    `❓ <b>Tasdiqlaysizmi?</b>\n\n` +
    `👤 ${esc(userTitle(u))} · <code>${u.telegramId}</code>\n` +
    `${BALANCE_MODE_LABEL[op.mode]}: <b>${op.mode === 'sub' ? '−' : '+'}${fmtNum(op.amount)}</b> so'm\n` +
    `📝 Sabab: ${op.reason ? esc(op.reason) : '<i>kiritilmagan</i>'}\n\n` +
    `Balans: ${fmtNum(before)} → <b>${fmtNum(after)}</b> so'm` +
    (insufficient ? `\n\n⚠️ <b>Balans yetarli emas</b> — ayirib bo'lmaydi.` : '');
  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        ...(insufficient
          ? []
          : [
              [
                { text: '✅ Xabar bilan', callback_data: 'mbal:go:1' },
                { text: '🔕 Xabarsiz', callback_data: 'mbal:go:0' },
              ],
            ]),
        [{ text: '❌ Bekor qilish', callback_data: 'mbal:cancel' }],
      ],
    },
  };
}

export type ApplyResult =
  | { ok: true; before: number; after: number; telegramId: bigint }
  | { ok: false; error: string };

// Balansni o'zgartiradi — hammasi bitta tranzaksiyada, qoldiq yetmasa rad etadi.
export async function applyBalanceOp(op: BalanceOp, adminTgId: number): Promise<ApplyResult> {
  const user = await prisma.user.findUnique({ where: { id: op.userId }, select: { telegramId: true } });
  if (!user) return { ok: false, error: 'Foydalanuvchi topilmadi' };
  const signed = op.mode === 'sub' ? -op.amount : op.amount;
  try {
    return await prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId: op.userId } });
      if (!wallet) wallet = await tx.wallet.create({ data: { userId: op.userId } });
      const before = wallet.balance;
      if (op.mode === 'sub') {
        // Shartli ayirish — parallel amallar balansni manfiyga tushira olmaydi.
        const claimed = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: op.amount } },
          data: { balance: { decrement: op.amount } },
        });
        if (claimed.count !== 1) throw new Error('INSUFFICIENT');
        // Yechib bo'lmaydigan qism balansdan oshib ketmasin.
        if (wallet.depositBalance > before - op.amount) {
          await tx.wallet.update({ where: { id: wallet.id }, data: { depositBalance: Math.max(0, before - op.amount) } });
        }
      } else {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { increment: op.amount },
            ...(op.mode === 'add_d' ? { depositBalance: { increment: op.amount } } : {}),
          },
        });
      }
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          amount: signed,
          status: 'COMPLETED',
          note: `Admin: ${op.reason || (signed > 0 ? "qo'lda qo'shildi" : "qo'lda ayirildi")}`.slice(0, 200),
          meta: { adminTelegramId: adminTgId, reason: op.reason, mode: op.mode },
        },
      });
      return { ok: true as const, before, after: before + signed, telegramId: user.telegramId };
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'INSUFFICIENT') return { ok: false, error: 'Balans yetarli emas' };
    throw e;
  }
}
