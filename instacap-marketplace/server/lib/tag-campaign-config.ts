import { prisma } from './prisma';

// "Atmetka qilish" kampaniyasi sozlamalari — admin (asosiy Telegram bot orqali
// /atmetka* komandalari bilan) o'zgartiradi, mavjud `Setting` (key/value)
// jadvalida saqlanadi — marketplace-config.ts'dagi komissiya foizi bilan BIR
// XIL naqsh.

export interface RewardTier {
  views: number;
  reward: number; // UZS
}

const TARGET_USERNAME_KEY = 'tag_campaign_target_username';
const REWARD_TIERS_KEY = 'tag_campaign_reward_tiers';
const DEFAULT_TARGET_USERNAME = 'top_sxema_rek67';

let _usernameCache: string | null = null;
let _usernameCachedAt = 0;
let _tiersCache: RewardTier[] | null = null;
let _tiersCachedAt = 0;
const TTL_MS = 60 * 1000; // 1 daqiqa

export async function getTagTargetUsername(): Promise<string> {
  const now = Date.now();
  if (_usernameCache !== null && now - _usernameCachedAt < TTL_MS) return _usernameCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: TARGET_USERNAME_KEY } });
    _usernameCache = (row?.value || DEFAULT_TARGET_USERNAME).replace(/^@/, '').trim().toLowerCase();
  } catch {
    _usernameCache = DEFAULT_TARGET_USERNAME;
  }
  _usernameCachedAt = now;
  return _usernameCache;
}

export async function setTagTargetUsername(username: string): Promise<void> {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(clean)) {
    throw new Error('Noto\'g\'ri username formati');
  }
  await prisma.setting.upsert({
    where: { key: TARGET_USERNAME_KEY },
    update: { value: clean },
    create: { key: TARGET_USERNAME_KEY, value: clean },
  });
  _usernameCache = clean;
  _usernameCachedAt = Date.now();
}

export async function getRewardTiers(): Promise<RewardTier[]> {
  const now = Date.now();
  if (_tiersCache !== null && now - _tiersCachedAt < TTL_MS) return _tiersCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: REWARD_TIERS_KEY } });
    const parsed = row ? JSON.parse(row.value) : [];
    _tiersCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    _tiersCache = [];
  }
  _tiersCachedAt = now;
  return _tiersCache;
}

// Masalan: "1000:5000,5000:20000,10000:50000" — "1000 ta prosmotrga 5000 so'm"
export function parseRewardTiersInput(raw: string): RewardTier[] {
  const tiers = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [viewsStr, rewardStr] = part.split(':').map((s) => s.trim());
      const views = parseInt(viewsStr, 10);
      const reward = parseInt(rewardStr, 10);
      if (!Number.isFinite(views) || views <= 0 || !Number.isFinite(reward) || reward <= 0) {
        throw new Error(`Noto'g'ri format: "${part}" (kutilgan: views:reward)`);
      }
      return { views, reward };
    });
  tiers.sort((a, b) => a.views - b.views);
  return tiers;
}

export async function setRewardTiers(tiers: RewardTier[]): Promise<void> {
  const value = JSON.stringify(tiers);
  await prisma.setting.upsert({
    where: { key: REWARD_TIERS_KEY },
    update: { value },
    create: { key: REWARD_TIERS_KEY, value },
  });
  _tiersCache = tiers;
  _tiersCachedAt = Date.now();
}

export function formatRewardTiers(tiers: RewardTier[]): string {
  if (tiers.length === 0) return '(sozlanmagan)';
  const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
  return tiers.map((t) => `• ${fmt(t.views)} prosmotr → ${fmt(t.reward)} so'm`).join('\n');
}

// ─────────────── CS GO / CS GO + Atmetka bosqichlari ───────────────
// Xuddi shu Setting (key/value) naqshi, faqat alohida kalitlar bilan — chunki
// bu 2 usulning narxlari "Oddiy atmetka"dan mustaqil sozlanishi kerak.

function makeTierStore(settingKey: string) {
  let cache: RewardTier[] | null = null;
  let cachedAt = 0;
  return {
    async get(): Promise<RewardTier[]> {
      const now = Date.now();
      if (cache !== null && now - cachedAt < TTL_MS) return cache;
      try {
        const row = await prisma.setting.findUnique({ where: { key: settingKey } });
        const parsed = row ? JSON.parse(row.value) : [];
        cache = Array.isArray(parsed) ? parsed : [];
      } catch {
        cache = [];
      }
      cachedAt = now;
      return cache;
    },
    async set(tiers: RewardTier[]): Promise<void> {
      const value = JSON.stringify(tiers);
      await prisma.setting.upsert({
        where: { key: settingKey },
        update: { value },
        create: { key: settingKey, value },
      });
      cache = tiers;
      cachedAt = Date.now();
    },
  };
}

const csgoStore = makeTierStore('tag_campaign_csgo_reward_tiers');
const csgoTagStore = makeTierStore('tag_campaign_csgo_tag_reward_tiers');

export const getCsgoRewardTiers = csgoStore.get;
export const setCsgoRewardTiers = csgoStore.set;
export const getCsgoTagRewardTiers = csgoTagStore.get;
export const setCsgoTagRewardTiers = csgoTagStore.set;

// ─────────────── Kampaniya budjeti (sarflangan pul limiti) ───────────────
// Admin umumiy budjet belgilaydi; cron har to'lovda `spent`ni oshiradi va
// limit tugasa to'lovni to'xtatadi. `total` 0 bo'lsa — budjet cheklanmagan.

export const TAG_BUDGET_KEY = 'tag_campaign_budget_v1';
export function budgetKeyFor(method: string): string {
  // oddiy va qimmat atmetka — bitta umumiy pul
  return method === 'CSGO' ? 'tag_campaign_budget_csgo_v1' : TAG_BUDGET_KEY;
}

export interface TagBudget {
  enabled: boolean;
  total: number;
  spent: number;
  remaining: number;
}

export async function getTagBudget(client: any = prisma, key: string = TAG_BUDGET_KEY): Promise<TagBudget> {
  try {
    const row = await client.setting.findUnique({ where: { key } });
    const v = row ? JSON.parse(row.value) : null;
    const total = Math.max(0, Math.floor(Number(v?.total) || 0));
    const spent = Math.max(0, Math.floor(Number(v?.spent) || 0));
    if (total > 0) return { enabled: true, total, spent: Math.min(spent, total), remaining: Math.max(0, total - spent) };
  } catch {}
  return { enabled: false, total: 0, spent: 0, remaining: 0 };
}

export async function addTagBudgetSpent(tx: any, amount: number, key: string = TAG_BUDGET_KEY): Promise<void> {
  const row = await tx.setting.findUnique({ where: { key } });
  if (!row) return;
  let v: any = {};
  try {
    v = JSON.parse(row.value) || {};
  } catch {
    v = {};
  }
  if (!(Number(v.total) > 0)) return;
  v.spent = Math.max(0, Math.floor(Number(v.spent) || 0)) + Math.max(0, Math.floor(amount));
  await tx.setting.update({ where: { key }, data: { value: JSON.stringify(v) } });
}
