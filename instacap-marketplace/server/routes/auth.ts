import { RequestHandler } from 'express';
import { AuthResponse } from '@shared/types';

/**
 * POST /api/auth/validate
 * initData tekshirish va user profilini qaytarish.
 * authMiddleware allaqachon tekshirgan va user ni yaratgan,
 * shuning uchun bu handler faqat natijani qaytaradi.
 */
export const handleAuthValidate: RequestHandler = (req, res) => {
  const user = req.telegramUser;

  if (!user) {
    res.status(401).json({ success: false, error: 'Not authenticated' } as AuthResponse);
    return;
  }

  res.json({
    success: true,
    user: {
      _id: user._id.toString(),
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      language: user.language,
      createdAt: user.createdAt.toISOString(),
      lastSeen: user.lastSeen.toISOString(),
    },
  } as AuthResponse);
};
