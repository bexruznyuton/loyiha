/**
 * GET /api/instagram-bio?username=...
 *
 * Instagram profilining ochiq (public) ma'lumotlarini — bio, ism, statistika,
 * profil rasmi — Apify'ning `apify/instagram-profile-scraper` actori orqali
 * qaytaradi.
 *
 * Auth: header `X-Forward-Secret` — bot.php'dagi INSTACAP_FORWARD_SECRET bilan
 * bir xil (mavjud bot.php↔VPS bridge sirini qayta ishlatadi — yangi sir shart
 * emas). Himoya sabab: bu endpoint ochiq bo'lsa, kim bo'lsa ham bizning
 * Apify hisobimizni tekin ishlatib, hisobni tezda tugatib qo'yishi mumkin.
 */

import { RequestHandler } from 'express';
import { fetchBioViaApify, fetchHdPicViaApify } from '../lib/apify-bio';
import { isBioHdEnabled } from '../lib/bio-quality';
import { getCachedBio, setCachedBio } from '../cache';
import { trackEvent } from '../analytics';

const FORWARD_SECRET = process.env.BOT_FORWARD_SECRET || '';

// "https://instagram.com/username", "@username", "  username  " — hammasidan
// toza username'ni ajratib oladi.
function normalizeUsername(raw: string): string | null {
  let s = raw.trim();
  const urlMatch = s.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (urlMatch) s = urlMatch[1];
  s = s.replace(/^@/, '').trim();
  s = s.split(/[/?#\s]/)[0];
  if (!/^[A-Za-z0-9_.]{1,30}$/.test(s)) return null;
  // Instagram'ning o'zi ishlatadigan ba'zi statik yo'llar username emas
  if (['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts'].includes(s.toLowerCase())) return null;
  return s;
}

export interface InstagramBioResult {
  success: true;
  username: string;
  fullName: string;
  biography: string;
  bioLinks: { title: string; url: string }[];
  externalUrl: string;
  followers: number;
  following: number;
  posts: number;
  isPrivate: boolean;
  isVerified: boolean;
  profilePicUrl: string;
}
export interface InstagramBioError {
  success: false;
  error: 'invalid_username' | 'not_found' | 'fetch_failed' | `upstream_${number}`;
}

// bot.php (X-Forward-Secret) VA to'g'ridan-to'g'ri Node route'lar (masalan
// WebApp'dan "Bio yuklash" tugmasi) ikkalasi ham shu funksiyani ishlatadi —
// haqiqiy Instagram ma'lumotini olish mantig'i bitta joyda qoladi.
// Bir soatlik keshdan foydalanadi — Apify actori har so'rovda ~10-15s va
// pul sarflaydi, shuning uchun bir xil username qayta so'ralganda darhol
// (~0ms, bepul) javob qaytadi. "not_found" ham qisqaroq muddatga keshlanadi
// (typo tuzatib qayta urinishga tez fursat qoldirish uchun).
const NOT_FOUND_TTL = 600; // 10 daqiqa

export async function fetchInstagramBioData(
  rawUsername: string,
  callerUserId?: string,
): Promise<InstagramBioResult | InstagramBioError> {
  const username = normalizeUsername(rawUsername);
  if (!username) {
    return { success: false, error: 'invalid_username' };
  }

  const cached = getCachedBio<InstagramBioResult | InstagramBioError>(username);
  if (cached) {
    if (cached.success) trackEvent({ timestamp: Date.now(), type: 'bio_downloaded', userId: callerUserId });
    return cached;
  }

  // HD rasm asosiy so'rov bilan PARALLEL olinadi (qarang: apify-bio.ts).
  const startedAt = Date.now();
  // Admin Insy botdan "Oddiy" rejimni tanlagan bo'lsa — HD actor umuman chaqirilmaydi.
  const hdEnabled = await isBioHdEnabled();
  const hdPromise: Promise<string> = hdEnabled ? fetchHdPicViaApify(username) : Promise.resolve('');
  const viaApify = await fetchBioViaApify(username);
  if (!viaApify.success) {
    // strictNullChecks o'chirilgan — discriminated union avtomatik narrow bo'lmaydi.
    const err = viaApify as { success: false; error: string };
    if (err.error === 'not_found') {
      const result: InstagramBioError = { success: false, error: 'not_found' };
      setCachedBio(username, result, NOT_FOUND_TTL);
      return result;
    }
    if (err.error === 'not_configured') return { success: false, error: 'fetch_failed' };
    // Boshqa xatolar (Apify vaqtincha band/xato) keshlanmaydi — keyingi
    // so'rov qayta urinib ko'rsin.
    return { success: false, error: err.error as InstagramBioError['error'] };
  }

  // nginx 30 s dan oshmaslik uchun HD'ni qolgan vaqtgacha kutamiz; ulgurmasa —
  // 320 px bilan javob beramiz, HD esa keyinroq keshdagi natijani yangilaydi.
  const waitMs = Math.max(0, 25_000 - (Date.now() - startedAt));
  const hdPic = await Promise.race([hdPromise, new Promise<string>((r) => setTimeout(() => r(''), waitMs))]);

  const result: InstagramBioResult = {
    success: true,
    username: viaApify.username,
    fullName: viaApify.fullName,
    biography: viaApify.biography,
    bioLinks: [],
    externalUrl: viaApify.externalUrl,
    followers: viaApify.followers,
    following: viaApify.following,
    posts: viaApify.posts,
    isPrivate: viaApify.isPrivate,
    isVerified: viaApify.isVerified,
    profilePicUrl: hdPic || viaApify.profilePicUrl,
  };
  setCachedBio(username, result);
  if (!hdPic) {
    hdPromise.then((url) => {
      const cur = getCachedBio<InstagramBioResult | InstagramBioError>(username);
      if (url && cur && cur.success) setCachedBio(username, { ...(cur as InstagramBioResult), profilePicUrl: url });
    });
  }
  trackEvent({ timestamp: Date.now(), type: 'bio_downloaded', userId: callerUserId });
  return result;
}

export const handleInstagramBio: RequestHandler = async (req, res) => {
  const secret = (req.header('x-forward-secret') || req.header('X-Forward-Secret')) ?? '';
  if (!FORWARD_SECRET || secret !== FORWARD_SECRET) {
    res.status(403).json({ success: false, error: 'forbidden' });
    return;
  }

  const rawUsername = (req.query.username as string) || '';
  const result = await fetchInstagramBioData(rawUsername);
  if (!result.success) {
    // strictNullChecks o'chirilgan (loyihada global sozlama) — shu sabab TS
    // discriminated union'ni bu yerda avtomatik narrow qilmaydi, aniq cast kerak.
    const err = result as InstagramBioError;
    if (err.error === 'invalid_username') {
      res.status(400).json(err);
      return;
    }
    if (err.error === 'fetch_failed') {
      res.status(500).json(err);
      return;
    }
    res.json(err);
    return;
  }
  res.json(result);
};
