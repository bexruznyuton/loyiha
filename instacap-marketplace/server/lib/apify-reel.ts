/**
 * Instagram reel/post ma'lumotlarini (atmetka qilinganlar ro'yxati, prosmotr
 * soni, caption) Apify'ning `apify/instagram-reel-scraper` actori orqali olish.
 * "Atmetka qilish" kampaniyasi shu yerdan foydalanadi — foydalanuvchi yuborgan
 * video havolasida bizning akkount haqiqatan atmetka qilinganini va necha
 * marta ko'rilganini tekshirish uchun.
 *
 * Input formati: { username: [<reel-url>] } — actor "username" massivi
 * ichida to'g'ridan-to'g'ri reel havolalarini ham qabul qiladi.
 * Narx: ~$2.60 / 1000 natija.
 */

import NodeCache from 'node-cache';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
const APIFY_ACTOR = 'apify~instagram-reel-scraper';
// nginx'dagi `proxy_read_timeout 30s` dan PAST bo'lishi shart — aks holda
// nginx so'rovni o'zi uzib HTML 504 qaytaradi va klient JSON o'qiy olmay
// umumiy "Xatolik" ko'rsatadi (2026-10-02 audit'da aniqlangan).
const APIFY_TIMEOUT_MS = 27_000;
// Bir nechta havolani BITTA Apify run'ida tekshirish — har URL uchun alohida
// run ochishdan ko'ra tezroq va arzonroq. Cron fon rejimida ishlaydi, shuning
// uchun unga uzoqroq timeout beriladi (nginx bu so'rovni kutmaydi).
export const APIFY_BATCH_TIMEOUT_MS = 240_000;
export const APIFY_MAX_BATCH = 10;
// Bir xil havolani qisqa vaqt ichida qayta tekshirmaslik: "Tekshirish"dan
// keyin "Saqlash" bosilsa, Apify'ga ikkinchi marta pul to'lanmaydi.
const reelCache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false });

export function reelCacheKey(url: string): string {
  // Shortcode katta-kichik harfga sezgir — shuning uchun URL'ni lowercase
  // qilmaymiz, faqat query/hash va oxirgi slash'ni olib tashlaymiz.
  return String(url || '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

export function extractShortCodeFromUrl(url: string): string {
  const m = String(url || '').match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : '';
}

export interface ReelData {
  success: true;
  shortCode: string;
  caption: string;
  ownerUsername: string;
  viewCount: number;
  // Layk yashirilgan bo'lsa Instagram 0 yoki manfiy qaytaradi — 0 ga keltiramiz.
  likesCount: number;
  commentsCount: number;
  // Instagram'ga joylangan vaqt (Apify `timestamp`); noma'lum bo'lsa null.
  postedAt: Date | null;
  taggedUsernames: string[];
}
export interface ReelError {
  success: false;
  error: 'not_configured' | 'not_found' | 'fetch_failed' | `upstream_${number}`;
}

export function isApifyReelConfigured(): boolean {
  return !!APIFY_TOKEN;
}

// Apify dataset item'ini bot uchun kerakli ko'rinishga keltiradi.
function mapApifyReelItem(item: any): ReelData | null {
  if (!item || item.error) return null;

  // MUHIM (2026-10-01 tub sababi topilgan): `apify/instagram-reel-scraper`
  // actori ASLO `taggedUsers` maydonini qaytarmaydi (bu post ustiga
  // qo'yiladigan "odamni belgilash" overlay'i uchun alohida, qimmatroq
  // so'rov talab qiladi, bu actor buni taqdim etmaydi). Caption'dagi
  // "@username" atmetkalari `item.mentions` massivida keladi — haqiqiy
  // production javobida to'g'ridan-to'g'ri tekshirilgan (Apify'ga
  // Dd8VSifIcny posti bilan to'g'ridan-to'g'ri so'rov yuborilib,
  // `taggedUsers: undefined`, `mentions: ["Top_sxema_rek12"]` ekani
  // tasdiqlangan). Shu sabab avvalgi kod HAR DOIM "Atmetka topilmadi"
  // qaytargan — hatto foydalanuvchi caption'da to'g'ri belgilagan bo'lsa
  // ham. Ikkala maydonni ham (bo'lsa) birlashtirib tekshiramiz.
  const taggedFromOverlay: string[] = Array.isArray(item.taggedUsers)
    ? item.taggedUsers.map((u: any) => String(u?.username || '').trim().toLowerCase())
    : [];
  const taggedFromMentions: string[] = Array.isArray(item.mentions)
    ? item.mentions.map((u: any) => String(u || '').trim().toLowerCase())
    : [];
  // Birgalikda muallif (Collab) — post ostida "@a va @b" ko'rinadi, u ham atmetka
  // hisoblanadi. Faqat ba'zi postlarda keladi.
  const taggedFromCoauthors: string[] = Array.isArray(item.coauthorProducers)
    ? item.coauthorProducers.map((u: any) => String(u?.username || '').trim().toLowerCase())
    : [];
  // Zaxira: `mentions` bo'sh qolsa ham caption matnidagi @username'larni o'zimiz ajratamiz.
  const taggedFromCaption: string[] = (String(item.caption || '').match(/@([A-Za-z0-9._]{1,30})/g) || []).map((m) =>
    m.slice(1).replace(/\.+$/, '').toLowerCase(),
  );
  const taggedUsernames: string[] = Array.from(
    new Set([...taggedFromOverlay, ...taggedFromMentions, ...taggedFromCoauthors, ...taggedFromCaption].filter(Boolean)),
  );

  return {
    success: true,
    shortCode: String(item.shortCode || item.id || '').trim(),
    caption: String(item.caption || '').trim(),
    ownerUsername: String(item.ownerUsername || '').trim(),
    viewCount: Number(item.videoViewCount ?? item.videoPlayCount ?? 0) || 0,
    likesCount: Math.max(0, Number(item.likesCount) || 0),
    commentsCount: Math.max(0, Number(item.commentsCount) || 0),
    postedAt: item.timestamp && !isNaN(Date.parse(item.timestamp)) ? new Date(item.timestamp) : null,
    taggedUsernames,
  };
}

/**
 * Bir nechta reel havolasini bitta Apify run'ida tekshiradi.
 * @returns {{success: boolean, error?: string, byUrl: Map<string, any>}}
 *  - success=false: butun run muvaffaqiyatsiz (tarmoq / limit / 403) — qayta urinish kerak.
 *  - byUrl'da yo'q URL: o'sha havola uchun natija topilmadi (not_found).
 */
export async function fetchReelsViaApify(
  urls: string | string[],
  timeoutMs: number = APIFY_BATCH_TIMEOUT_MS,
): Promise<{ success: boolean; error?: string; byUrl: Map<string, ReelData | ReelError> }> {
  const raw = (Array.isArray(urls) ? urls : [urls]).map((u) => String(u || '').trim()).filter(Boolean);
  const byUrl = new Map<string, ReelData | ReelError>();
  if (raw.length === 0) return { success: true, byUrl };
  if (!APIFY_TOKEN) return { success: false, error: 'not_configured', byUrl };

  // Bir xil video turli query-string bilan kelishi mumkin — kesh kaliti bo'yicha
  // birlashtiramiz, shunda bitta video uchun ikki marta pul to'lanmaydi.
  const keyToUrls = new Map<string, string[]>();
  for (const url of raw) {
    const key = reelCacheKey(url);
    if (!keyToUrls.has(key)) keyToUrls.set(key, []);
    keyToUrls.get(key)!.push(url);
  }

  const missingKeys: string[] = [];
  for (const [key, urlsForKey] of keyToUrls) {
    const hit = reelCache.get<ReelData>(key);
    if (hit) {
      for (const url of urlsForKey) byUrl.set(url, hit);
    } else {
      missingKeys.push(key);
    }
  }
  if (missingKeys.length === 0) return { success: true, byUrl };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: missingKeys.map((key) => keyToUrls.get(key)![0]) }),
        signal: controller.signal,
      },
    );

    if (!res.ok) return { success: false, error: `upstream_${res.status}`, byUrl };

    const data: any = await res.json().catch(() => null);
    const items: any[] = Array.isArray(data) ? data : [];
    const byShortCode = new Map<string, ReelData>();
    for (const item of items) {
      const reel = mapApifyReelItem(item);
      if (reel && reel.shortCode) byShortCode.set(reel.shortCode, reel);
    }

    for (const key of missingKeys) {
      const urlsForKey = keyToUrls.get(key)!;
      const shortCode = extractShortCodeFromUrl(urlsForKey[0]);
      const reel = shortCode ? byShortCode.get(shortCode) : null;
      if (reel) {
        reelCache.set(key, reel);
        for (const url of urlsForKey) byUrl.set(url, reel);
      } else {
        for (const url of urlsForKey) byUrl.set(url, { success: false, error: 'not_found' });
      }
    }

    return { success: true, byUrl };
  } catch (error) {
    console.error('apify-reel error:', error instanceof Error ? error.message : error);
    return { success: false, error: 'fetch_failed', byUrl };
  } finally {
    clearTimeout(timer);
  }
}

// timeoutMs: foydalanuvchi so'rovlarida nginx limiti tufayli 27 s; fon cron'i uzoqroq
// kuta oladi — o'chirilgan video uchun Apify `not_found` ni ~30 s da qaytaradi.
export async function fetchReelViaApify(url: string, timeoutMs: number = APIFY_TIMEOUT_MS): Promise<ReelData | ReelError> {
  const batch = await fetchReelsViaApify([url], timeoutMs);
  if (!batch.success) return { success: false, error: (batch.error as any) || 'fetch_failed' };
  return (batch.byUrl.get(String(url || '').trim()) as ReelData | ReelError) || { success: false, error: 'not_found' };
}
