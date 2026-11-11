/**
 * Telegram Stars (XTR) invoice yaratish — Top_sxema bot (@Top_sxema_instagrambot)
 * orqali. MUHIM: bu bot.php (eski shared hosting) bilan BIR XIL bot — token
 * `WEBAPP_BOT_TOKEN` sifatida VPS .env'da ham mavjud (server/bot.ts allaqachon
 * shu tokendan setChatMenuButton uchun to'g'ridan-to'g'ri foydalanadi). Shuning
 * uchun invoice YARATISH uchun PHP relay orqali o'tish shart emas — bevosita
 * Telegram Bot API'ga chaqiriladi.
 *
 * Webhook (pre_checkout_query / successful_payment qabul qilish) hamon
 * bot.php'da qoladi — u yerdan "mktw:" prefiksli to'lovlar VPS'ga forward
 * qilinadi (server/routes/bot-forward.ts) va shu yerda kreditlanadi.
 */

const STARS_BOT_TOKEN = process.env.WEBAPP_BOT_TOKEN || '';
const API_BASE = STARS_BOT_TOKEN ? `https://api.telegram.org/bot${STARS_BOT_TOKEN}` : '';

export interface CreateStarsInvoiceParams {
  title: string;
  description: string;
  payload: string;
  stars: number;
}

/** Telegram Stars invoice havolasini yaratadi (createInvoiceLink). */
export async function createStarsInvoiceLink(params: CreateStarsInvoiceParams): Promise<string | null> {
  if (!API_BASE) {
    console.warn('[telegram-stars] WEBAPP_BOT_TOKEN sozlanmagan');
    return null;
  }
  try {
    const res = await fetch(`${API_BASE}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        description: params.description,
        payload: params.payload,
        provider_token: '', // Stars uchun bo'sh — Telegram XTR valyutasini shunday belgilaydi
        currency: 'XTR',
        prices: [{ label: params.title, amount: params.stars }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const decoded = await res.json().catch(() => null);
    if (!res.ok || !decoded?.ok || typeof decoded.result !== 'string') {
      console.warn(`[telegram-stars] createInvoiceLink failed: HTTP:${res.status} RESP:${JSON.stringify(decoded).slice(0, 300)}`);
      return null;
    }
    return decoded.result;
  } catch (e) {
    console.warn('[telegram-stars] createInvoiceLink error:', e instanceof Error ? e.message : e);
    return null;
  }
}
