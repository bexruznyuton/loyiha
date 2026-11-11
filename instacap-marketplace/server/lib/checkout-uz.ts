/**
 * checkout.uz — Click/Payme agregator API.
 *
 * MUHIM: bu XUDDI SHU merchant hisobi Top_sxema bot (server/bot.php) tomonidan
 * allaqachon ishlatiladi (video-analiz limit sotib olish uchun, `checkoutApi()`
 * funksiyasiga qarang). Hamyon to'ldirish shu hisobga ulanadi — yangi merchant
 * kerak emas. Token .env orqali sozlanadi (CHECKOUT_UZ_TOKEN); topilmasa
 * bot.php'dagi bilan bir xil qiymatga tushadi (bir xil hisob — ikkalasi ham
 * ishlaydi, faqat production'da o'z env'iga ko'chirish tavsiya etiladi).
 */

const CHECKOUT_API = process.env.CHECKOUT_UZ_API || 'https://checkout.uz/api/v1';
const CHECKOUT_TOKEN = process.env.CHECKOUT_UZ_TOKEN || 'ZGI1NDMwYzJjMjY1Zjk1MTc2NGI';

export type CheckoutPayVia = { click?: string; payme?: string };

export type CheckoutCreatePaymentResult = {
  id: string;
  uuid: string;
  payVia: CheckoutPayVia;
};

async function checkoutApi(endpoint: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${CHECKOUT_API}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECKOUT_TOKEN}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const decoded = await res.json().catch(() => null);
  if (!res.ok || !decoded || decoded.status !== 'success') {
    console.warn(`[checkout.uz] ${endpoint} HTTP:${res.status} RESP:${JSON.stringify(decoded).slice(0, 500)}`);
  }
  return decoded;
}

/** POST /create_payment — yangi to'lov yaratadi, Click/Payme havolalarini qaytaradi. */
export async function checkoutCreatePayment(
  amount: number,
  description: string,
): Promise<CheckoutCreatePaymentResult | null> {
  const resp = await checkoutApi('/create_payment', { amount, description });
  const pay = resp?.payment;
  if (resp?.status !== 'success' || !pay?._id) return null;
  return {
    id: String(pay._id),
    uuid: String(pay._uuid || ''),
    payVia: {
      // checkout.uz ulagan barcha usullar (Click, Payme, Xazna, Oson, ...)
      ...Object.fromEntries(
        Object.entries(pay._pay_via || {}).filter(
          ([, u]) => typeof u === 'string' && /^https:\/\//.test(u as string),
        ),
      ),
    },
  };
}

/** POST /status_payment — to'lov holatini so'raydi. `true` = to'langan (paid). */
export async function checkoutIsPaid(paymentId: string, uuid: string): Promise<boolean> {
  // MUHIM: checkout.uz `id`ni HAQIQIY JSON integer deb kutadi — string
  // yuborilsa ("id":"123") "ID must be an integer" bilan 400 qaytaradi.
  // Bizda providerPaymentId Prisma'da String saqlanadi (Json/String maydon
  // mos kelishi uchun), shuning uchun bu yerda Number() bilan aylantiramiz.
  const resp = await checkoutApi('/status_payment', { id: Number(paymentId), uuid });
  return resp?.status === 'success' && resp?.data?.status === 'paid';
}
