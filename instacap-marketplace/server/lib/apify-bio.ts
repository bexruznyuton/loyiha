/**
 * Instagram bio/profil ma'lumotlarini Apify'ning rasmiy `apify/instagram-profile-scraper`
 * actori orqali olish — bio-yuklash uchun ASOSIY va yagona manba.
 *
 * Narx: ~$1.60 / 1000 so'rov (Apify hisobidan yechiladi — $5/oy bepul limit bilan).
 * Token `APIFY_API_TOKEN` env o'zgaruvchisida saqlanadi (VPS'dagi `.env` faylida,
 * repoga commit qilinmaydi, clientga hech qachon yuborilmaydi).
 */

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
const APIFY_ACTOR = 'apify~instagram-profile-scraper';
// nginx `proxy_read_timeout 30s` dan PAST — aks holda WebApp'ning "Bio yuklash"
// so'rovi nginx HTML 504 bilan uziladi va foydalanuvchi umumiy xato ko'radi.
const APIFY_TIMEOUT_MS = 55_000;

export interface ApifyBioResult {
  success: true;
  username: string;
  fullName: string;
  biography: string;
  externalUrl: string;
  followers: number;
  following: number;
  posts: number;
  isPrivate: boolean;
  isVerified: boolean;
  profilePicUrl: string;
}
export interface ApifyBioError {
  success: false;
  error: 'not_configured' | 'not_found' | 'fetch_failed' | `upstream_${number}`;
}

export function isApifyConfigured(): boolean {
  return !!APIFY_TOKEN;
}

export async function fetchBioViaApify(username: string): Promise<ApifyBioResult | ApifyBioError> {
  if (!APIFY_TOKEN) return { success: false, error: 'not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username] }),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (!res.ok) return { success: false, error: `upstream_${res.status}` as const };

    const data: any = await res.json().catch(() => null);
    const user = Array.isArray(data) ? data[0] : null;
    if (!user || user.error || !user.username) {
      return { success: false, error: 'not_found' };
    }

    return {
      success: true,
      username: user.username,
      fullName: user.fullName || '',
      biography: user.biography || '',
      externalUrl: user.externalUrl || '',
      followers: user.followersCount ?? 0,
      following: user.followsCount ?? 0,
      posts: user.postsCount ?? 0,
      isPrivate: !!user.private,
      isVerified: !!user.verified,
      profilePicUrl: user.profilePicUrlHD || user.profilePicUrl || '',
    };
  } catch (error) {
    clearTimeout(timer);
    console.error('apify-bio error:', error instanceof Error ? error.message : error);
    return { success: false, error: 'fetch_failed' };
  }
}

// ───────────────────────── HD profil rasmi ─────────────────────────
// `apify/instagram-profile-scraper` rasmni FAQAT 320×320 beradi (o'lchangan,
// 2026-10-22) — Telegram'da xira ko'rinadi. `instagram-scraper/instagram-profile-scraper`
// esa `profile_pic_url_hd` ni 1080×1080 qaytaradi, lekin sekin (10–40 s) va
// obunachilar sonini bermaydi. Shu sabab ASOSIY ma'lumot eski actor'dan, rasm
// esa shu actor'dan PARALLEL olinadi; kechiksa — 320 px ishlatiladi, HD esa
// keshga tushib, keyingi so'rovda tayyor bo'ladi. Narx: ~$0.0025 / so'rov.
const HD_ACTOR = 'instagram-scraper~instagram-profile-scraper';
const HD_TIMEOUT_MS = 60_000;
const HD_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // Instagram CDN havolalari kunlar davomida yaroqli
const hdCache = new Map<string, { url: string; exp: number }>();
const hdInflight = new Map<string, Promise<string>>();

export function getCachedHdPic(username: string): string {
  const hit = hdCache.get(username);
  if (!hit) return '';
  if (hit.exp < Date.now()) {
    hdCache.delete(username);
    return '';
  }
  return hit.url;
}

// Xatoda '' qaytaradi (hech qachon throw qilmaydi). Bir xil username uchun
// parallel so'rovlar bitta Apify chaqiruviga birlashtiriladi.
export function fetchHdPicViaApify(username: string): Promise<string> {
  const cached = getCachedHdPic(username);
  if (cached) return Promise.resolve(cached);
  if (!APIFY_TOKEN) return Promise.resolve('');
  const running = hdInflight.get(username);
  if (running) return running;

  const p = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HD_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${HD_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instagramUsernames: [username] }),
          signal: controller.signal,
        },
      );
      if (!res.ok) return '';
      const data: any = await res.json().catch(() => null);
      const item = Array.isArray(data) ? data[0] : null;
      const url = String(item?.profile_pic_url_hd || '');
      if (!/^https?:\/\//.test(url)) return '';
      hdCache.set(username, { url, exp: Date.now() + HD_CACHE_TTL_MS });
      return url;
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
      hdInflight.delete(username);
    }
  })();
  hdInflight.set(username, p);
  return p;
}
