import { RequestHandler } from 'express';
import { fetchInstagramBioData, InstagramBioResult, InstagramBioError } from './instagram-bio';
import { buildBioCaption } from '../lib/bio-caption';
import { phpBot } from '../lib/php-bot-bridge';
import { getSellerBot, getBot } from '../bot';

function mapBioError(error: string): string {
  if (error === 'invalid_username' || error === 'not_found') return error;
  return 'fetch_failed';
}

/**
 * POST /api/bio/send-telegram
 * WebApp'dagi "Bio yuklash" tugmasi — kiritilgan Instagram username'ining
 * profil rasmi + bio'sini (bot.php'dagi bio_olish bilan BIR XIL formatda)
 * so'rov yuborgan foydalanuvchining O'ZIGA, Top_sxema bot orqali yuboradi.
 */
export const handleSendBioToTelegram: RequestHandler = async (req, res) => {
  try {
    const user = req.telegramUser;
    if (!user) {
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }
    const chatId = Number(user.telegramId);
    if (!chatId) {
      res.status(400).json({ success: false, error: 'no_telegram_id' });
      return;
    }

    const rawUsername = (req.body?.username as string) || '';
    if (!rawUsername.trim()) {
      res.status(400).json({ success: false, error: 'invalid_username' });
      return;
    }

    const bioResult = await fetchInstagramBioData(rawUsername, String(user.telegramId));
    if (!bioResult.success) {
      // strictNullChecks o'chirilgan (loyihada global sozlama) — TS bu yerda
      // discriminated union'ni avtomatik narrow qilmaydi, aniq cast kerak.
      const err = bioResult as InstagramBioError;
      res.status(err.error === 'invalid_username' ? 400 : 200).json({
        success: false,
        error: mapBioError(err.error),
      });
      return;
    }
    const bio = bioResult as InstagramBioResult;

    const caption = buildBioCaption(bio, user.language || 'uz');
    const usePhp = phpBot.isReady();

    let delivered = false;
    if (bio.profilePicUrl) {
      if (usePhp) {
        const r = await phpBot.sendPhoto(chatId, bio.profilePicUrl, { caption }).catch(() => null);
        delivered = !!r;
      } else {
        const b = getSellerBot() || getBot();
        if (b) {
          delivered = await b
            .sendPhoto(chatId, bio.profilePicUrl, { caption, parse_mode: 'HTML' } as any)
            .then(() => true)
            .catch(() => false);
        }
      }
    }
    // Profil rasmi yo'q/yuborilmadi — matn sifatida yuboramiz, foydalanuvchi
    // bo'sh javob olib qolmasin.
    if (!delivered) {
      if (usePhp) {
        await phpBot.sendMessage(chatId, caption).catch(() => {});
      } else {
        const b = getSellerBot() || getBot();
        if (b) await b.sendMessage(chatId, caption, { parse_mode: 'HTML' }).catch(() => {});
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('handleSendBioToTelegram error:', error);
    res.status(500).json({ success: false, error: 'server_error' });
  }
};
