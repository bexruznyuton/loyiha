import TelegramBot from 'node-telegram-bot-api';
import { getBot } from './bot';

/**
 * Bot xabar yuborish — bot ishlamasa log qiladi, xato ko'tarmaydi.
 */
export async function sendBotMessage(
  chatId: number,
  text: string,
  options?: TelegramBot.SendMessageOptions,
): Promise<TelegramBot.Message | null> {
  const bot = getBot();
  if (!bot) {
    console.log(`[bot-helpers] sendBotMessage skipped (bot not ready) → ${chatId}: ${text.slice(0, 80)}`);
    return null;
  }
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.warn(
      '[bot-helpers] sendBotMessage failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Bot xabarini tahrirlash — xatolarni yutib yuboradi.
 */
export async function editBotMessage(
  chatId: number,
  messageId: number,
  text: string,
  options?: TelegramBot.EditMessageTextOptions,
): Promise<void> {
  const bot = getBot();
  if (!bot) return;
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      ...options,
    });
  } catch (err) {
    console.warn(
      '[bot-helpers] editBotMessage failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Bot foto yuborish — file_id yoki URL qabul qiladi. Xatolarni yutadi.
 */
export async function sendBotPhoto(
  chatId: number,
  photo: string | Buffer,
  options?: TelegramBot.SendPhotoOptions,
): Promise<TelegramBot.Message | null> {
  const bot = getBot();
  if (!bot) {
    console.log(`[bot-helpers] sendBotPhoto skipped (bot not ready) → ${chatId}`);
    return null;
  }
  try {
    return await bot.sendPhoto(chatId, photo as any, options);
  } catch (err) {
    console.warn(
      '[bot-helpers] sendBotPhoto failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Callback querysiga javob — toast ko'rsatadi yoki shunchaki ack qiladi.
 */
export async function answerCallback(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  const bot = getBot();
  if (!bot) return;
  try {
    await bot.answerCallbackQuery(callbackQueryId, { text, show_alert: showAlert });
  } catch (err) {
    console.warn(
      '[bot-helpers] answerCallback failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
