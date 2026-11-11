/**
 * PHP bot bridge — eski xostingdagi bot.php orqali Top_sxema_instagrambot ga
 * xabar yuborish (PHP relay endpointi orqali). Bunda VPS hech qachon shu bot
 * uchun polling qilmaydi — konflikt yo'q.
 *
 * Konfig:
 *   PHP_BOT_URL=https://eski-xosting.uz/path/bot.php  (PHP endpoint full URL)
 *   BOT_FORWARD_SECRET=...  (PHP'dagi INSTACAP_FORWARD_SECRET bilan bir xil)
 */

const PHP_BOT_URL = process.env.PHP_BOT_URL || '';
const FORWARD_SECRET = process.env.BOT_FORWARD_SECRET || '';

function isReady(): boolean {
  return !!PHP_BOT_URL && !!FORWARD_SECRET;
}

async function relay(
  action: 'send' | 'edit' | 'editCaption' | 'answer' | 'delete' | 'photo' | 'video' | 'animation' | 'document',
  body: unknown,
): Promise<any> {
  if (!isReady()) {
    throw new Error('PHP bot bridge not configured (PHP_BOT_URL + BOT_FORWARD_SECRET)');
  }
  const sep = PHP_BOT_URL.includes('?') ? '&' : '?';
  const url = `${PHP_BOT_URL}${sep}relay=${action}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forward-Secret': FORWARD_SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PHP relay ${action} failed: HTTP ${res.status}`);
  }
  return res.json();
}

export const phpBot = {
  isReady,
  sendMessage(
    chatId: number,
    text: string,
    opts?: { parseMode?: string; replyMarkup?: any; disableNotification?: boolean },
  ) {
    return relay('send', {
      chatId,
      text,
      parseMode: opts?.parseMode || 'HTML',
      replyMarkup: opts?.replyMarkup,
      disableNotification: opts?.disableNotification,
    });
  },
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: { parseMode?: string; replyMarkup?: any },
  ) {
    return relay('edit', {
      chatId,
      messageId,
      text,
      parseMode: opts?.parseMode || 'HTML',
      replyMarkup: opts?.replyMarkup,
    });
  },
  editMessageCaption(
    chatId: number,
    messageId: number,
    caption: string,
    opts?: { parseMode?: string; replyMarkup?: any },
  ) {
    return relay('editCaption', {
      chatId,
      messageId,
      caption,
      parseMode: opts?.parseMode || 'HTML',
      replyMarkup: opts?.replyMarkup,
    });
  },
  answerCallbackQuery(callbackQueryId: string, opts?: { text?: string; showAlert?: boolean }) {
    return relay('answer', {
      callbackQueryId,
      text: opts?.text || '',
      showAlert: !!opts?.showAlert,
    });
  },
  deleteMessage(chatId: number, messageId: number) {
    return relay('delete', { chatId, messageId });
  },
  sendPhoto(
    chatId: number,
    photo: string, // Telegram file_id yoki public URL
    opts?: { caption?: string; parseMode?: string; replyMarkup?: any },
  ) {
    return relay('photo', {
      chatId,
      photo,
      caption: opts?.caption || '',
      parseMode: opts?.parseMode || 'HTML',
      replyMarkup: opts?.replyMarkup,
    });
  },
  sendVideo(
    chatId: number,
    video: string,
    opts?: { caption?: string; parseMode?: string; replyMarkup?: any },
  ) {
    return relay('video', {
      chatId,
      video,
      caption: opts?.caption || '',
      parseMode: opts?.parseMode || 'HTML',
      replyMarkup: opts?.replyMarkup,
    });
  },
  sendAnimation(
    chatId: number,
    animation: string,
    opts?: { caption?: string; parseMode?: string; replyMarkup?: any },
  ) {
    return relay('animation', {
      chatId,
      animation,
      caption: opts?.caption || '',
      parseMode: opts?.parseMode || 'HTML',
      replyMarkup: opts?.replyMarkup,
    });
  },
  sendDocument(
    chatId: number,
    document: string,
    opts?: { caption?: string; parseMode?: string; replyMarkup?: any },
  ) {
    return relay('document', {
      chatId,
      document,
      caption: opts?.caption || '',
      parseMode: opts?.parseMode || 'HTML',
      replyMarkup: opts?.replyMarkup,
    });
  },
};

// Relay HTTP 200 qaytarsa ham Telegram'ning o'z javobi ichkarida bo'ladi:
// {"ok":true,"result":{"ok":false,"error_code":403,"description":"..."}}.
// Avval bu tekshirilmagan — botni bloklagan sotuvchiga xabar "yuborildi"
// deb hisoblanib, buyurtmalar haftalab qotib qolgan (2026-10-09).
export interface TelegramFailure {
  code: number;
  description: string;
}

export function telegramFailure(res: any): TelegramFailure | null {
  if (res?.result && res.result.ok === false) {
    return { code: Number(res.result.error_code) || 0, description: String(res.result.description || '') };
  }
  return null;
}

// Foydalanuvchiga bu bot orqali umuman yozib bo'lmaydi (bloklagan, akkaunt
// o'chirilgan yoki botni hech qachon ishga tushirmagan).
export function isUnreachable(f: TelegramFailure | null): boolean {
  if (!f) return false;
  return f.code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(f.description);
}
