import { prisma } from './prisma';
import { NotificationType } from '@prisma/client';
import { sendBotMessage } from '../bot-helpers';
import type TelegramBot from 'node-telegram-bot-api';

// Backwards compat — eski kodlar uchun (no-op)
let _legacyBotSend: ((chatId: number, text: string) => Promise<void>) | null = null;
export function setBotSendMessage(fn: (chatId: number, text: string) => Promise<void>) {
  _legacyBotSend = fn;
}

type NotificationPayload = {
  inlineKeyboard?: TelegramBot.InlineKeyboardMarkup;
  [key: string]: unknown;
};

/**
 * Foydalanuvchiga bildirishnoma yaratadi va Telegram orqali xabar yuboradi.
 * Telegram yuborish — best-effort, xatolar yutiladi.
 */
export async function createNotification(
  userId: number,
  type: NotificationType,
  title: string,
  body: string,
  payload: NotificationPayload = {},
) {
  // 1. DB ga saqlash
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      payload: payload as any,
    },
  });

  // 2. Telegram orqali yuborishga harakat (best-effort)
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    if (user) {
      const chatId = Number(user.telegramId);
      const text = `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(body)}`;
      const opts: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
      };
      if (payload.inlineKeyboard) {
        opts.reply_markup = payload.inlineKeyboard;
      }
      await sendBotMessage(chatId, text, opts);

      // Eski legacy callback ham chaqiramiz (agar kimdir ulagan bo'lsa)
      if (_legacyBotSend) {
        try {
          await _legacyBotSend(chatId, text);
        } catch (e) {
          // ignore
        }
      }
    }
  } catch (e) {
    console.warn('Telegram notif delivery failed:', e instanceof Error ? e.message : e);
  }

  return notification;
}

/**
 * Admin telegram ID larini qaytaradi.
 */
export function getAdminTelegramIds(): number[] {
  return (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

/**
 * Admin userlariga bildirishnoma yuboradi (DB + Telegram).
 */
export async function notifyAdmins(
  type: NotificationType,
  title: string,
  body: string,
  payload: NotificationPayload = {},
) {
  const adminTgIds = getAdminTelegramIds();
  if (adminTgIds.length === 0) return;

  const admins = await prisma.user.findMany({
    where: { telegramId: { in: adminTgIds.map(BigInt) } },
    select: { id: true },
  });

  for (const admin of admins) {
    await createNotification(admin.id, type, title, body, payload);
  }
}

// Markdown'da maxsus belgilarni eskeyplash (oddiy v1 Markdown uchun)
function escapeMarkdown(text: string): string {
  // Markdown v1 da faqat _ * ` [ ekanlar muhim — boshqa simvollarga teginmaymiz
  return text.replace(/([_*`\[])/g, '\\$1');
}
