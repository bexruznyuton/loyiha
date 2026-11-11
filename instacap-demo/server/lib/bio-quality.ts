/**
 * Bio yuklash rasmi sifati (Insy bot → Bio yuklash statistikasi'dan sozlanadi).
 *
 *  - "Sifatli" — 1080×1080 rasm (qo'shimcha Apify actor, har yangi so'rovga ~$0.0023–0.0025)
 *  - "Oddiy"   — 320×320 rasm (qo'shimcha xarajatsiz)
 *
 * Yoqish/o'chirishda adminga qo'shimcha xarajat HAQIQIY Apify so'rovlari
 * tarixidagi o'rtacha yuklashlar soni bo'yicha aniq raqamlarda ko'rsatiladi.
 */

import { prisma } from './prisma';

const KEY = 'bio_hd_enabled';
const TTL_MS = 30_000;
let cached: { value: boolean; at: number } | null = null;

// Standart — YOQILGAN (rasm tiniq bo'lsin degan talab bo'yicha).
export async function isBioHdEnabled(): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value = true;
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    value = !row || row.value !== '0';
  } catch {
    value = true;
  }
  cached = { value, at: Date.now() };
  return value;
}

export async function setBioHdEnabled(value: boolean): Promise<void> {
  const v = value ? '1' : '0';
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: v }, create: { key: KEY, value: v } });
  cached = { value, at: Date.now() };
}

// Taxminiy kurs (faqat ko'rsatish uchun; so'mda "taxminan" deb yoziladi).
export const USD_UZS_APPROX = 12_700;

export interface BioCostEstimate {
  windowDays: number;
  /** Oxirgi N kunda haqiqatan to'langan Apify bio so'rovlari (keshdagilari kirmaydi) */
  paidRuns: number;
  runsPerDay: number;
  /** Hozirgi (oddiy) bio xarajati: bitta so'rov narxi, kuniga, oyiga */
  basePerRunUsd: number;
  basePerDayUsd: number;
  /** Sifatli rasm qo'shadigan xarajat */
  hdPerRunUsd: number;
  hdExtraPerDayUsd: number;
  hdExtraPerMonthUsd: number;
  /** Sifatli rasm yoqilganda JAMI bio xarajati */
  totalHdPerDayUsd: number;
  totalHdPerMonthUsd: number;
  tier: string;
}

const BASE_ACTOR = 'apify~instagram-profile-scraper';
const HD_ACTOR = 'instagram-scraper~instagram-profile-scraper';
const WINDOW_DAYS = 7;

async function apify(path: string, token: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.apify.com/v2${path}${sep}token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Apify ${path} → HTTP ${res.status}`);
  return res.json();
}

// Actor'ning BITTA so'rov uchun to'liq narxi: natija narxi (tarif darajasi bo'yicha)
// + har ishga tushirishda olinadigan `apify-actor-start` (haqiqiy to'lov bilan
// solishtirilgan: $0.00083 + $0.0005 = $0.00133, 2026-10-22).
function pricePerRun(actor: any, tier: string): number | null {
  const result = pricePerResult(actor, tier);
  if (result == null) return null;
  const events = actor?.data?.pricingInfos?.slice(-1)[0]?.pricingPerEvent?.actorChargeEvents || {};
  const start = events['apify-actor-start'];
  const startFee = typeof start?.eventPriceUsd === 'number' ? start.eventPriceUsd : 0;
  return result + startFee;
}

function pricePerResult(actor: any, tier: string): number | null {
  const infos: any[] = actor?.data?.pricingInfos || [];
  const info = infos[infos.length - 1];
  const events = info?.pricingPerEvent?.actorChargeEvents;
  if (!events) return typeof info?.pricePerUnitUsd === 'number' ? info.pricePerUnitUsd : null;
  const ev = events['apify-default-dataset-item'] || Object.values<any>(events).find((e) => e?.eventTieredPricingUsd || e?.eventPriceUsd);
  if (!ev) return null;
  const tiered = ev.eventTieredPricingUsd;
  if (tiered) return tiered[tier]?.tieredEventPriceUsd ?? tiered.FREE?.tieredEventPriceUsd ?? null;
  return typeof ev.eventPriceUsd === 'number' ? ev.eventPriceUsd : null;
}

export async function estimateBioCosts(): Promise<BioCostEstimate | null> {
  const token = process.env.APIFY_API_TOKEN || '';
  if (!token) return null;
  try {
    const [me, hdActor, runs] = await Promise.all([
      apify('/users/me', token),
      apify(`/acts/${HD_ACTOR}`, token),
      apify(`/acts/${BASE_ACTOR}/runs?desc=1&limit=1000`, token),
    ]);
    const plan = String(me?.data?.plan?.id || 'FREE').toUpperCase();
    const tier = plan === 'FREE' ? 'FREE' : plan === 'SCALE' ? 'SILVER' : plan === 'BUSINESS' ? 'GOLD' : 'BRONZE';

    // To'liq o'tgan oxirgi 7 sutka (bugungi to'liq bo'lmagan kun hisobga olinmaydi).
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const from = startOfToday.getTime() - WINDOW_DAYS * 86_400_000;
    const items: any[] = (runs?.data?.items || []).filter((r: any) => {
      const t = Date.parse(r.startedAt);
      return t >= from && t < startOfToday.getTime();
    });
    const paid = items.filter((r) => Number(r.usageTotalUsd) > 0);
    const paidRuns = paid.length;
    const basePerRunUsd = paidRuns ? paid.reduce((s, r) => s + Number(r.usageTotalUsd), 0) / paidRuns : 0.0023;
    const hdPerRunUsd = pricePerRun({ data: hdActor?.data }, tier) ?? 0.003;
    const runsPerDay = paidRuns / WINDOW_DAYS;

    return {
      windowDays: WINDOW_DAYS,
      paidRuns,
      runsPerDay,
      basePerRunUsd,
      basePerDayUsd: runsPerDay * basePerRunUsd,
      hdPerRunUsd,
      hdExtraPerDayUsd: runsPerDay * hdPerRunUsd,
      hdExtraPerMonthUsd: runsPerDay * hdPerRunUsd * 30,
      totalHdPerDayUsd: runsPerDay * (basePerRunUsd + hdPerRunUsd),
      totalHdPerMonthUsd: runsPerDay * (basePerRunUsd + hdPerRunUsd) * 30,
      tier,
    };
  } catch (e) {
    console.warn('estimateBioCosts error:', e instanceof Error ? e.message : e);
    return null;
  }
}

const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : n < 1 ? 3 : 2)}`;
const som = (usdAmount: number) =>
  new Intl.NumberFormat('uz-UZ').format(Math.round((usdAmount * USD_UZS_APPROX) / 1000) * 1000);

// Insy botga yuboriladigan tushuntirish (HTML). enabled — YANGI holat.
export function formatBioCostMessage(enabled: boolean, e: BioCostEstimate | null): string {
  const head = enabled
    ? '🖼 <b>Sifatli bio rasmi yoqildi</b> (1080×1080)'
    : '🖼 <b>Oddiy bio rasmi yoqildi</b> (320×320)';
  if (!e) {
    return `${head}\n\n<i>Xarajat hisobini hozir olib bo'lmadi (Apify javob bermadi). Sifatli rasm har yangi so'rovga taxminan $0.0025 qo'shadi.</i>`;
  }
  const basis =
    `📊 <b>Hisob asosi:</b> oxirgi ${e.windowDays} kunda ${e.paidRuns.toLocaleString('uz-UZ')} ta pullik bio so'rovi ` +
    `(kuniga o'rtacha <b>${Math.round(e.runsPerDay)}</b> ta; keshdagi takroriy so'rovlar kirmaydi).`;
  if (enabled) {
    return (
      `${head}\n\n${basis}\n\n` +
      `💸 <b>Endi qo'shimcha xarajat:</b>\n` +
      `• har bir so'rovga: <b>+${usd(e.hdPerRunUsd)}</b> (rasm uchun alohida actor)\n` +
      `• kuniga: <b>+${usd(e.hdExtraPerDayUsd)}</b> ≈ ${som(e.hdExtraPerDayUsd)} so'm\n` +
      `• oyiga: <b>+${usd(e.hdExtraPerMonthUsd)}</b> ≈ ${som(e.hdExtraPerMonthUsd)} so'm\n\n` +
      `📈 <b>Bio yuklash jami:</b>\n` +
      `• oldin: ${usd(e.basePerDayUsd)}/kun (${usd(e.basePerDayUsd * 30)}/oy)\n` +
      `• endi: <b>${usd(e.totalHdPerDayUsd)}/kun</b> (<b>${usd(e.totalHdPerMonthUsd)}/oy</b>)\n\n` +
      `<i>Yuklashlar ko'paysa, xarajat ham mutanosib oshadi. Kurs taxminiy: 1$ ≈ ${USD_UZS_APPROX.toLocaleString('uz-UZ')} so'm. ` +
      `Daraja: ${e.tier}.</i>`
    );
  }
  return (
    `${head}\n\n${basis}\n\n` +
    `💰 <b>Tejaladi:</b>\n` +
    `• kuniga: <b>−${usd(e.hdExtraPerDayUsd)}</b> ≈ ${som(e.hdExtraPerDayUsd)} so'm\n` +
    `• oyiga: <b>−${usd(e.hdExtraPerMonthUsd)}</b> ≈ ${som(e.hdExtraPerMonthUsd)} so'm\n\n` +
    `📉 Bio yuklash jami: ${usd(e.totalHdPerDayUsd)}/kun → <b>${usd(e.basePerDayUsd)}/kun</b> ` +
    `(${usd(e.totalHdPerMonthUsd)} → <b>${usd(e.basePerDayUsd * 30)}/oy</b>)\n\n` +
    `<i>Rasm xiraroq (320×320) bo'ladi. Kurs taxminiy: 1$ ≈ ${USD_UZS_APPROX.toLocaleString('uz-UZ')} so'm.</i>`
  );
}
