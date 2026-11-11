import { Request, Response, NextFunction } from 'express';
import { validateInitData } from '../telegram-auth';
import { User, IUser } from '../models/User';

// Express Request ga telegramUser ni qo'shish
declare global {
  namespace Express {
    interface Request {
      telegramUser?: IUser;
    }
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
// Qo'shimcha bot (masalan PHP bot) uchun — WebApp shu bot orqali ochilsa ham ishlaydi
const WEBAPP_BOT_TOKEN = process.env.WEBAPP_BOT_TOKEN || '';

/**
 * initData ni bir yoki ikki token bilan tekshiradi.
 * Birinchi token ishlamasa ikkinchisini sinaydi.
 */
function tryValidate(initData: string) {
  const r1 = validateInitData(initData, BOT_TOKEN);
  if (r1.valid) return r1;
  if (WEBAPP_BOT_TOKEN && WEBAPP_BOT_TOKEN !== BOT_TOKEN) {
    const r2 = validateInitData(initData, WEBAPP_BOT_TOKEN);
    if (r2.valid) return r2;
  }
  return r1; // xato qaytarish
}

/**
 * Auth middleware: Authorization headerdan initData oladi,
 * HMAC tekshiradi, MongoDB da user ni topadi yoki yaratadi.
 *
 * Header formati: Authorization: tma <initData>
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('tma ')) {
      res.status(401).json({ success: false, error: 'Missing authorization header' });
      return;
    }

    const initData = authHeader.slice(4); // "tma " prefiksni olib tashlash
    const result = tryValidate(initData);

    if (!result.valid || !result.user) {
      res.status(401).json({ success: false, error: result.error || 'Invalid initData' });
      return;
    }

    // User ni topish yoki yaratish (upsert)
    const user = await User.findOneAndUpdate(
      { telegramId: result.user.id },
      {
        $set: {
          firstName: result.user.first_name,
          lastName: result.user.last_name || '',
          username: result.user.username || '',
          photoUrl: result.user.photo_url || '',
          language: result.user.language_code || 'uz',
          lastSeen: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    req.telegramUser = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

/**
 * Optional auth middleware: auth header bo'lmasa ham o'tkazib yuboradi.
 * instagram-caption uchun — auth bor bo'lsa tarixga saqlaydi, yo'q bo'lsa ham ishlaydi.
 */
export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('tma ')) {
    return next(); // Auth yo'q, davom etsin
  }

  // Auth bor — tekshirib ko'rish
  try {
    const initData = authHeader.slice(4);
    const result = tryValidate(initData);

    if (result.valid && result.user) {
      const user = await User.findOneAndUpdate(
        { telegramId: result.user.id },
        {
          $set: {
            firstName: result.user.first_name,
            lastName: result.user.last_name || '',
            username: result.user.username || '',
            photoUrl: result.user.photo_url || '',
            lastSeen: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );
      req.telegramUser = user;
    }
  } catch (error) {
    // Optional auth — xato bo'lsa ham davom etsin
    console.warn('Optional auth failed:', error);
  }

  next();
}
