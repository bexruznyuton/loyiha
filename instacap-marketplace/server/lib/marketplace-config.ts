import { prisma } from './prisma';

export const MARKETPLACE_CONFIG = {
  commissionRate: Number(process.env.PLATFORM_COMMISSION_RATE ?? 15), // fallback
  minAdPrice: Number(process.env.MIN_AD_PRICE ?? 20_000),
  strikeExpiryDays: Number(process.env.STRIKE_EXPIRY_DAYS ?? 180),
  deadlinePostHours: Number(process.env.DEADLINE_POST_HOURS ?? 12),
  deadlineKeepHours: Number(process.env.DEADLINE_KEEP_HOURS ?? 24),
  maxStrikesBeforeBan: 3,
};

// Foiz uchun in-memory cache (5 daqiqa) — DB so'rovi har order'da chaqirilmasligi uchun.
const COMMISSION_SETTING_KEY = 'commission_rate';
let _cachedRate: number | null = null;
let _cachedAt = 0;
const RATE_TTL_MS = 5 * 60 * 1000;

export async function getCommissionRate(): Promise<number> {
  const now = Date.now();
  if (_cachedRate !== null && now - _cachedAt < RATE_TTL_MS) return _cachedRate;
  try {
    const row = await prisma.setting.findUnique({ where: { key: COMMISSION_SETTING_KEY } });
    const fromDb = row ? Number(row.value) : NaN;
    _cachedRate = Number.isFinite(fromDb) && fromDb >= 0 && fromDb <= 100
      ? fromDb
      : MARKETPLACE_CONFIG.commissionRate;
  } catch {
    _cachedRate = MARKETPLACE_CONFIG.commissionRate;
  }
  _cachedAt = now;
  return _cachedRate;
}

// Heshteg yuklash xizmati — yoqilgan/o'chirilganmi (admin tomonidan /heshteg orqali)
const HESHTEG_SETTING_KEY = 'heshteg_enabled';
let _heshtegCache: boolean | null = null;
let _heshtegCachedAt = 0;
const HESHTEG_TTL_MS = 60 * 1000; // 1 daqiqa

export async function isHeshtegEnabled(): Promise<boolean> {
  const now = Date.now();
  if (_heshtegCache !== null && now - _heshtegCachedAt < HESHTEG_TTL_MS) return _heshtegCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: HESHTEG_SETTING_KEY } });
    _heshtegCache = !row || row.value !== '0'; // default ON, faqat '0' bo'lsa OFF
  } catch {
    _heshtegCache = true;
  }
  _heshtegCachedAt = now;
  return _heshtegCache;
}

export async function setHeshtegEnabled(value: boolean): Promise<void> {
  const v = value ? '1' : '0';
  await prisma.setting.upsert({
    where: { key: HESHTEG_SETTING_KEY },
    update: { value: v },
    create: { key: HESHTEG_SETTING_KEY, value: v },
  });
  _heshtegCache = value;
  _heshtegCachedAt = Date.now();
}

export async function setCommissionRate(value: number): Promise<void> {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('Foiz 0..100 oralig\'ida bo\'lishi kerak');
  }
  await prisma.setting.upsert({
    where: { key: COMMISSION_SETTING_KEY },
    update: { value: String(value) },
    create: { key: COMMISSION_SETTING_KEY, value: String(value) },
  });
  _cachedRate = value;
  _cachedAt = Date.now();
}

export async function calcEscrowAsync(price: number) {
  const rate = await getCommissionRate();
  const commissionAmount = Math.round((price * rate) / 100);
  const escrowAmount = price - commissionAmount;
  return { commissionRate: rate, commissionAmount, escrowAmount };
}

// Sinxron versiya — sukut bo'yicha env foizdan foydalanadi (eski kod uchun).
export function calcEscrow(price: number, commissionRate = MARKETPLACE_CONFIG.commissionRate) {
  const commissionAmount = Math.round((price * commissionRate) / 100);
  const escrowAmount = price - commissionAmount;
  return { commissionAmount, escrowAmount };
}

export function formatUZS(amount: number): string {
  return new Intl.NumberFormat('uz-UZ').format(amount) + ' UZS';
}

// Pul yechish chegaralari (Insy bot → 💰 Komissiya paneli). max = 0 — cheklanmagan.
const PAYOUT_LIMITS_KEY = 'payout_limits';
const DEFAULT_PAYOUT_LIMITS = { min: 50_000, max: 0 };
export type PayoutLimits = { min: number; max: number };

export async function getPayoutLimits(): Promise<PayoutLimits> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: PAYOUT_LIMITS_KEY } });
    if (!row) return { ...DEFAULT_PAYOUT_LIMITS };
    const parsed = JSON.parse(row.value);
    const min = Number(parsed?.min);
    const max = Number(parsed?.max);
    return {
      min: Number.isFinite(min) && min >= 1000 ? Math.floor(min) : DEFAULT_PAYOUT_LIMITS.min,
      max: Number.isFinite(max) && max >= 0 ? Math.floor(max) : DEFAULT_PAYOUT_LIMITS.max,
    };
  } catch {
    return { ...DEFAULT_PAYOUT_LIMITS };
  }
}

export async function setPayoutLimits(patch: Partial<PayoutLimits>): Promise<PayoutLimits> {
  const next = { ...(await getPayoutLimits()), ...patch };
  await prisma.setting.upsert({
    where: { key: PAYOUT_LIMITS_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: PAYOUT_LIMITS_KEY, value: JSON.stringify(next) },
  });
  return next;
}
