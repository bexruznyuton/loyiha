import { RequestHandler } from 'express';
import { getBot, getAdminIds } from '../bot';

/**
 * Vaqtinchalik yuklangan rasmni admin chatidan o'chirishga urinadi — 3 marta,
 * orada kutish bilan. MUHIM: avvalgi kodda bu chaqiruv `await`lanmagan va
 * xatosi `.catch(() => {})` bilan jimgina yutilgan edi — tarmoq muammosi
 * yoki Telegram rate-limit tufayli o'chirish BA'ZIDA muvaffaqiyatsiz bo'lganda,
 * akkaunt hali yuborilmasidan turib olingan rasm adminning shaxsiy chatida
 * ABADIY qolib ketardi (foydalanuvchi shikoyati aynan shu edi). Endi
 * qayta urinish bilan bu holat deyarli yo'qoladi, va agar baribir muvaffaqiyatsiz
 * bo'lsa — kamida serverga log yoziladi (jim yutilmaydi).
 */
async function deleteTempPhotoWithRetry(
  bot: NonNullable<ReturnType<typeof getBot>>,
  chatId: number,
  messageId: number,
  attempts = 3,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await bot.deleteMessage(chatId, messageId);
      return true;
    } catch (e) {
      if (i === attempts - 1) {
        console.error(
          `[upload-image] Vaqtinchalik rasmni o'chirib bo'lmadi (chat=${chatId}, msg=${messageId}, ${attempts} urinishdan keyin):`,
          e instanceof Error ? e.message : e,
        );
        return false;
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  return false;
}

/**
 * POST /api/upload-image
 *
 * Body: { data: string (base64), mime: string }
 *
 * Foydalanuvchi rasmni yuboradi, server uni bot orqali admin chat'iga
 * sendPhoto qiladi va Telegram qaytargan file_id'ni clientga qaytaradi.
 *
 * Shu yo'l bilan foydalanuvchi WebApp'dan chiqmasdan rasm yuklay oladi —
 * keyin bu file_id /api/files/:fileId orqali ko'rsatiladi.
 */
export const handleUploadImage: RequestHandler = async (req, res) => {
  try {
    if (!req.pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya kerak' });
      return;
    }

    const { data, mime } = req.body as { data?: string; mime?: string };
    if (!data || typeof data !== 'string') {
      res.status(400).json({ success: false, error: 'Rasm ma\'lumotlari yetarli emas' });
      return;
    }

    // base64 → Buffer (data URI prefiksini ham qabul qilamiz)
    const clean = data.replace(/^data:[^;]+;base64,/, '');
    let buf: Buffer;
    try {
      buf = Buffer.from(clean, 'base64');
    } catch {
      res.status(400).json({ success: false, error: 'Rasmni o\'qib bo\'lmadi' });
      return;
    }

    // Cheklov: 15 MB
    if (buf.length > 15 * 1024 * 1024) {
      res.status(413).json({ success: false, error: 'Rasm 15 MB dan oshmasligi kerak' });
      return;
    }
    if (buf.length < 100) {
      res.status(400).json({ success: false, error: 'Rasm juda kichik yoki noto\'g\'ri' });
      return;
    }

    const bot = getBot();
    if (!bot) {
      res.status(503).json({ success: false, error: 'Bot tayyor emas' });
      return;
    }

    const adminIds = getAdminIds();
    if (adminIds.length === 0) {
      res.status(503).json({ success: false, error: 'Admin sozlanmagan' });
      return;
    }

    // Telegram'ga rasmni vaqtinchalik yuklaymiz — file_id olamiz, so'ng xabarni
    // darhol o'chiramiz. Admin chati shovqindan toza qoladi; rasm Telegram
    // serverida file_id orqali saqlanib qolaveradi (mediaGroup'da qayta ishlatamiz).
    const photo = (await bot.sendPhoto(adminIds[0], buf, {
      disable_notification: true,
    } as any, {
      contentType: mime || 'image/jpeg',
      filename: 'upload.jpg',
    } as any)) as any;

    // Eng katta o'lchamdagi file_id'ni olamiz
    const photos = photo?.photo as Array<{ file_id: string }> | undefined;
    const fileId = photos && photos.length > 0 ? photos[photos.length - 1].file_id : '';

    // Yuborilgan xabarni o'chiramiz (file_id baribir amal qiladi) — javob
    // qaytarilishidan OLDIN kutamiz, qayta urinish bilan (yuqoridagi izohga
    // qarang: akkaunt hali yuborilmasidan turib adminga rasm "qolib
    // ketmasligi" shart).
    if (photo?.message_id) {
      await deleteTempPhotoWithRetry(bot, adminIds[0], photo.message_id);
    }

    if (!fileId) {
      res.status(502).json({ success: false, error: 'Telegram javob bermadi' });
      return;
    }

    res.json({ success: true, fileId });
  } catch (err: any) {
    console.error('upload-image error:', err);
    res.status(500).json({
      success: false,
      error: err?.message || 'Yuklashda xato',
    });
  }
};
