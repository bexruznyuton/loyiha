import crypto from 'crypto';
import { TelegramUser } from '@shared/types';

interface ValidationResult {
  valid: boolean;
  user?: TelegramUser;
  error?: string;
}

/**
 * Telegram WebApp initData ni HMAC-SHA256 bilan tekshirish.
 *
 * Algoritm (Telegram rasmiy hujjatlaridan):
 * 1. initData ni URLSearchParams ga parse qilish
 * 2. hash ni ajratish
 * 3. Qolgan parametrlarni alifbo tartibida saralash
 * 4. data_check_string = "key=value\nkey=value\n..."
 * 5. secret_key = HMAC-SHA256("WebAppData", bot_token)
 * 6. calculated_hash = HMAC-SHA256(secret_key, data_check_string)
 * 7. Hashlarni solishtirish
 */
export function validateInitData(initData: string, botToken: string): ValidationResult {
  try {
    if (!initData || !botToken) {
      return { valid: false, error: 'Missing initData or botToken' };
    }

    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');

    if (!receivedHash) {
      return { valid: false, error: 'No hash in initData' };
    }

    // Hash ni olib tashlash, qolganlarini saralash
    params.delete('hash');
    const sortedEntries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = sortedEntries.map(([key, value]) => `${key}=${value}`).join('\n');

    // Secret key: HMAC-SHA256("WebAppData", bot_token)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Hash: HMAC-SHA256(secret_key, data_check_string)
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== receivedHash) {
      return { valid: false, error: 'Invalid hash' };
    }

    // auth_date muddatini tekshirish (24 soat)
    const authDate = params.get('auth_date');
    if (authDate) {
      const authTimestamp = parseInt(authDate) * 1000;
      const now = Date.now();
      const MAX_AGE = 24 * 60 * 60 * 1000;
      if (now - authTimestamp > MAX_AGE) {
        return { valid: false, error: 'initData expired' };
      }
    }

    // User ma'lumotlarini olish
    const userParam = params.get('user');
    if (!userParam) {
      return { valid: false, error: 'No user data in initData' };
    }

    const userData = JSON.parse(userParam) as TelegramUser;
    return { valid: true, user: userData };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}
