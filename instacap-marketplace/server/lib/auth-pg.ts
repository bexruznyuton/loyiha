import { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';
import { syncUserToPrisma } from './user-sync';
import type { User as PgUser } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      pgUser?: PgUser;
    }
  }
}

/**
 * Marketplace middleware — authMiddleware ishlatilgandan keyin chaqiriladi.
 * req.telegramUser (SQLite) bo'lsa, uni Postgres'ga sinxronlab req.pgUser ga qo'yadi.
 */
export async function pgUserMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.telegramUser) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const pgUser = await syncUserToPrisma(req.telegramUser);
    if (pgUser.bannedUntil && pgUser.bannedUntil > new Date()) {
      const until = pgUser.bannedUntil.toLocaleString('ru-RU', {
        timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      res.status(403).json({
        success: false,
        code: 'banned',
        bannedUntil: pgUser.bannedUntil.toISOString(),
        error: `Hisobingiz ${until} gacha bloklangan${pgUser.banReason ? `: ${pgUser.banReason}` : ''}.`,
      });
      return;
    }
    req.pgUser = pgUser;
    next();
  } catch (err) {
    console.error('pgUserMiddleware error:', err);
    res.status(500).json({ success: false, error: 'User sync failed' });
  }
}

/**
 * Admin middleware — pgUser ADMIN role'da bo'lishi shart.
 */
export async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.pgUser) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => BigInt(s));

    const isAdmin =
      req.pgUser.role === 'ADMIN' ||
      adminIds.includes(req.pgUser.telegramId);

    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    // Birinchi marta admin sifatida belgilash
    if (req.pgUser.role !== 'ADMIN') {
      await prisma.user.update({
        where: { id: req.pgUser.id },
        data: { role: 'ADMIN' },
      });
      req.pgUser.role = 'ADMIN';
    }

    next();
  } catch (err) {
    console.error('adminMiddleware error:', err);
    res.status(500).json({ success: false, error: 'Admin check failed' });
  }
}
