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

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
const APIFY_ACTOR = 'apify~instagram-reel-scraper';
// nginx'dagi `proxy_read_timeout 30s` dan PAST bo'lishi shart — aks holda
// nginx so'rovni o'zi uzib HTML 504 qaytaradi va klient JSON o'qiy olmay
// umumiy "Xatolik" ko'rsatadi (2026-10-02 audit'da aniqlangan).
const APIFY_TIMEOUT_MS = 27_000;

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

// timeoutMs: foydalanuvchi so'rovlarida nginx limiti tufayli 27 s; fon cron'i uzoqroq
// kuta oladi — o'chirilgan video uchun Apify `not_found` ni ~30 s da qaytaradi.
export async function fetchReelViaApify(url: string, timeoutMs: number = APIFY_TIMEOUT_MS): Promise<ReelData | ReelError> {
  if (!APIFY_TOKEN) return { success: false, error: 'not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: [url] }),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (!res.ok) return { success: false, error: `upstream_${res.status}` as const };

    const data: any = await res.json().catch(() => null);
    const item = Array.isArray(data) ? data[0] : null;
    if (!item || item.error) return { success: false, error: 'not_found' };

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
  } catch (error) {
    clearTimeout(timer);
    console.error('apify-reel error:', error instanceof Error ? error.message : error);
    return { success: false, error: 'fetch_failed' };
  }
}
