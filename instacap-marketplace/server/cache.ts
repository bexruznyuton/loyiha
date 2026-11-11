import NodeCache from 'node-cache';

// Cache for Instagram captions
// TTL: 1 soat (3600 soniya)
// Bir xil URL uchun qayta-qayta so'rov yubormaslik
export const captionCache = new NodeCache({
  stdTTL: 3600, // 1 soat
  checkperiod: 600, // Har 10 daqiqada eski ma'lumotlarni tozalash
  useClones: false
});

// Cache'dan caption olish
export function getCachedCaption(url: string): string | undefined {
  return captionCache.get<string>(url);
}

// Cache'ga caption saqlash
export function setCachedCaption(url: string, caption: string): void {
  captionCache.set(url, caption);
}

// Cache statistikasi
export function getCacheStats() {
  return captionCache.getStats();
}

// Cache'ni tozalash
export function clearCache() {
  captionCache.flushAll();
}

// Instagram bio/profil ma'lumotlari uchun alohida cache — Apify actori har
// so'rovda ~10-15s va pul sarflaydi, shuning uchun bir xil username qayta
// so'ralganda (masalan bir nechta foydalanuvchi bitta mashhur akkountni
// so'rasa) darhol (~0ms, bepul) javob qaytariladi.
export const bioCache = new NodeCache({
  stdTTL: 3600, // 1 soat
  checkperiod: 600,
  useClones: false,
});

export function getCachedBio<T>(username: string): T | undefined {
  return bioCache.get<T>(username.toLowerCase());
}

export function setCachedBio<T>(username: string, data: T, ttlSeconds?: number): void {
  if (ttlSeconds !== undefined) {
    bioCache.set(username.toLowerCase(), data, ttlSeconds);
  } else {
    bioCache.set(username.toLowerCase(), data);
  }
}
