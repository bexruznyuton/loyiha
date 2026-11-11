import { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { CaptionHistory } from '../models/CaptionHistory';
import { CaptionHistoryResponse } from '@shared/types';
import { cleanInstagramCaption } from '../lib/instagram-caption-cleaner';

/**
 * GET /api/user/profile
 * Autentifikatsiya qilingan user profilini qaytaradi.
 */
export const handleGetProfile: RequestHandler = (req, res) => {
  const user = req.telegramUser;
  if (!user) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
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
  });
};

/**
 * GET /api/user/history
 * User ning caption tarixini qaytaradi (paginatsiya bilan).
 * Query: ?page=1&limit=50
 */
export const handleGetHistory: RequestHandler = async (req, res) => {
  try {
    const user = req.telegramUser;
    if (!user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const [history, total] = await Promise.all([
      CaptionHistory.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CaptionHistory.countDocuments({ userId: user._id }),
    ]);

    res.json({
      success: true,
      history: history.map((item) => ({
        _id: item._id.toString(),
        userId: item.userId.toString(),
        url: item.url,
        caption: cleanInstagramCaption(item.caption),
        createdAt: item.createdAt.toISOString(),
      })),
      total,
    } as CaptionHistoryResponse);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
};

/**
 * DELETE /api/user/history/:id
 * Bitta caption tarix elementini o'chiradi (faqat o'z elementlarini).
 */
export const handleDeleteHistory: RequestHandler = async (req, res) => {
  try {
    const user = req.telegramUser;
    if (!user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    // Noto'g'ri formatdagi id mongoose'da CastError → 500 bergan; bu aslida
    // "topilmadi" holati.
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, error: 'History entry not found' });
      return;
    }
    const result = await CaptionHistory.findOneAndDelete({
      _id: id,
      userId: user._id, // Faqat o'z elementlarini o'chira oladi
    });

    if (!result) {
      res.status(404).json({ success: false, error: 'History entry not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting history:', error);
    res.status(500).json({ success: false, error: 'Failed to delete history entry' });
  }
};
