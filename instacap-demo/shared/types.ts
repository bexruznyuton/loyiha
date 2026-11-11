/**
 * Umumiy (server + client) tiplar.
 *
 * ESLATMA: serverda asl `shared/` papkasi saqlanmagan — bu fayl faqat
 * server kodidagi ishlatilishiga qarab tiklangan (build vaqtida tiplar
 * o'chiriladi, runtime xatti-harakatiga ta'sir qilmaydi).
 */

// Telegram WebApp `initData.user` dan keladigan xom obyekt.
export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

// /api/auth/validate javobidagi user profili.
export interface AuthUser {
  _id: string;
  telegramId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  language?: string;
  createdAt: string;
  lastSeen: string;
}

export interface AuthResponse {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

export interface CaptionHistoryItem {
  _id: string;
  userId: string;
  url: string;
  caption: string;
  createdAt: string;
}

export interface CaptionHistoryResponse {
  success: boolean;
  history?: CaptionHistoryItem[];
  total?: number;
  error?: string;
}
