import { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { MARKETPLACE_CONFIG } from '../../lib/marketplace-config';
import { createNotification } from '../../lib/notifications';
import { refundEscrow, releaseEscrow } from '../../lib/escrow';

/**
 * GET /api/marketplace/admin/accounts/pending
 * Tasdiqlash kutayotgan akkauntlar
 */
export const handleAdminListPendingAccounts: RequestHandler = async (req, res) => {
  try {
    const accounts = await prisma.adAccount.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { owner: { select: { id: true, firstName: true, lastName: true, username: true } } },
    });

    res.json({ success: true, accounts });
  } catch (err) {
    console.error('handleAdminListPendingAccounts error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/admin/accounts/:id/verify
 * Akkauntni tasdiqlash yoki rad etish
 */
export const handleAdminVerifyAccount: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser!;
    const id = Number(req.params.id);

    const schema = z.object({
      approve: z.boolean(),
      note: z.string().max(500).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: 'Akkaunt topilmadi' });
      return;
    }

    if (parsed.data.approve) {
      await prisma.adAccount.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          isVerified: true,
          reviewedAt: new Date(),
          reviewedBy: pgUser.id,
        },
      });

      await createNotification(
        account.ownerId,
        'ACCOUNT_VERIFIED',
        'Akkauntingiz tasdiqlandi',
        `@${account.igUsername} akkauntingiz muvaffaqiyatli tasdiqlandi va endi ko'rinmoqda!`,
        { accountId: id },
      );
    } else {
      // Rad etildi — status PENDING qoladi, lekin note saqlanadi
      await prisma.adAccount.update({
        where: { id },
        data: {
          reviewedAt: new Date(),
          reviewedBy: pgUser.id,
        },
      });

      await createNotification(
        account.ownerId,
        'ACCOUNT_REJECTED',
        'Akkauntingiz rad etildi',
        `@${account.igUsername} akkauntingiz rad etildi. ${parsed.data.note ? `Sabab: ${parsed.data.note}` : ''}`,
        { accountId: id, note: parsed.data.note },
      );
    }

    res.json({ success: true, approved: parsed.data.approve });
  } catch (err) {
    console.error('handleAdminVerifyAccount error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * GET /api/marketplace/admin/payouts?status=
 * Payout so'rovlar ro'yxati
 */
export const handleAdminListPayouts: RequestHandler = async (req, res) => {
  try {
    const { status } = req.query as Record<string, string>;
    const where: any = {};
    if (status) where.status = status;

    const payouts = await prisma.payout.findMany({
      where,
      orderBy: { requestedAt: 'asc' },
      include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
    });

    res.json({ success: true, payouts });
  } catch (err) {
    console.error('handleAdminListPayouts error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/admin/payouts/:id/approve
 * Payoutni tasdiqlash
 */
export const handleAdminApprovePayout: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser!;
    const id = Number(req.params.id);

    const payout = await prisma.payout.findUnique({ where: { id } });
    if (!payout) {
      res.status(404).json({ success: false, error: 'Payout topilmadi' });
      return;
    }
    if (payout.status !== 'PENDING') {
      res.status(400).json({ success: false, error: 'Payout kutish holatida emas' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id },
        data: { status: 'PAID', processedAt: new Date(), processedBy: pgUser.id },
      });

      // Muzlatilgan balansdan olib tashlash
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: payout.userId } });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { frozenBalance: { decrement: payout.amount } },
      });

      // Tranzaksiyani COMPLETED qilish
      await tx.transaction.updateMany({
        where: { payoutId: id, type: 'PAYOUT', status: 'PENDING' },
        data: { status: 'COMPLETED' },
      });
    });

    await createNotification(
      payout.userId,
      'PAYOUT_APPROVED',
      'Pul yechib olish tasdiqlandi',
      `${payout.amount.toLocaleString()} UZS kartangizga yuborildi.`,
      { payoutId: id },
    );

    res.json({ success: true, message: 'Payout tasdiqlandi' });
  } catch (err) {
    console.error('handleAdminApprovePayout error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/admin/payouts/:id/reject
 * Payoutni rad etish — pul qaytariladi
 */
export const handleAdminRejectPayout: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser!;
    const id = Number(req.params.id);

    const schema = z.object({ reason: z.string().min(5).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const payout = await prisma.payout.findUnique({ where: { id } });
    if (!payout) {
      res.status(404).json({ success: false, error: 'Payout topilmadi' });
      return;
    }
    if (payout.status !== 'PENDING') {
      res.status(400).json({ success: false, error: 'Payout kutish holatida emas' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id },
        data: {
          status: 'REJECTED',
          processedAt: new Date(),
          processedBy: pgUser.id,
          rejectReason: parsed.data.reason,
        },
      });

      // Muzlatilgan balansni qaytarish
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: payout.userId } });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: payout.amount },
          frozenBalance: { decrement: payout.amount },
        },
      });

      // Tranzaksiyani FAILED qilish
      await tx.transaction.updateMany({
        where: { payoutId: id, type: 'PAYOUT', status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    });

    await createNotification(
      payout.userId,
      'PAYOUT_REJECTED',
      'Pul yechib olish rad etildi',
      `${payout.amount.toLocaleString()} UZS yechib olish so'rovi rad etildi. Sabab: ${parsed.data.reason}`,
      { payoutId: id },
    );

    res.json({ success: true, message: 'Payout rad etildi' });
  } catch (err) {
    console.error('handleAdminRejectPayout error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * GET /api/marketplace/admin/disputes
 * Barcha shikoyatlar
 */
export const handleAdminListDisputes: RequestHandler = async (req, res) => {
  try {
    const disputes = await prisma.dispute.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      include: {
        order: {
          include: {
            adAccount: { select: { igUsername: true, ownerId: true } },
            advertiser: { select: { id: true, firstName: true, username: true } },
          },
        },
      },
    });

    res.json({ success: true, disputes });
  } catch (err) {
    console.error('handleAdminListDisputes error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * POST /api/marketplace/admin/disputes/:id/resolve
 * Shikoyatni hal qilish
 */
export const handleAdminResolveDispute: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser!;
    const id = Number(req.params.id);

    const schema = z.object({
      resolution: z.enum(['advertiser', 'owner', 'partial']),
      refundAmount: z.number().int().nonnegative().optional(),
      note: z.string().min(5).max(1000),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            adAccount: { include: { owner: true } },
          },
        },
      },
    });

    if (!dispute) {
      res.status(404).json({ success: false, error: 'Shikoyat topilmadi' });
      return;
    }
    if (dispute.status !== 'OPEN') {
      res.status(400).json({ success: false, error: 'Shikoyat allaqachon hal qilingan' });
      return;
    }

    const order = dispute.order;
    const { resolution, note } = parsed.data;

    if (resolution === 'advertiser') {
      // Advertiser foydasiga — to'liq refund, owner'ga strike
      await refundEscrow(order.id, order.price);

      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
        await tx.dispute.update({
          where: { id },
          data: {
            status: 'RESOLVED_ADVERTISER',
            resolution: note,
            refundAmount: order.price,
            resolvedAt: new Date(),
            resolvedBy: pgUser.id,
          },
        });

        // Strike akkaunt egasiga
        const expiresAt = new Date(
          Date.now() + MARKETPLACE_CONFIG.strikeExpiryDays * 24 * 60 * 60 * 1000,
        );
        await tx.strike.create({
          data: {
            userId: order.adAccount.ownerId,
            orderId: order.id,
            reason: `Shikoyat #${id} bo'yicha: ${note}`,
            expiresAt,
          },
        });

        // 3+ strike bo'lsa akkauntni ban qilish
        const activeStrikes = await tx.strike.count({
          where: {
            userId: order.adAccount.ownerId,
            expiresAt: { gt: new Date() },
          },
        });

        if (activeStrikes >= MARKETPLACE_CONFIG.maxStrikesBeforeBan) {
          await tx.adAccount.updateMany({
            where: { ownerId: order.adAccount.ownerId },
            data: { status: 'BANNED' },
          });
        }
      });

      await createNotification(
        order.advertiserId,
        'ORDER_COMPLETED',
        'Shikoyat hal qilindi — sizning foydasiga',
        `Buyurtma #${order.id} bo'yicha shikoyat hal qilindi. Pul qaytarildi.`,
        { orderId: order.id, disputeId: id },
      );
      await createNotification(
        order.adAccount.ownerId,
        'STRIKE_ISSUED',
        'Strike olindi',
        `Buyurtma #${order.id} bo'yicha shikoyat natijasida strike berildi.`,
        { orderId: order.id, disputeId: id },
      );
    } else if (resolution === 'owner') {
      // Akkaunt egasi foydasiga — escrow chiqariladi
      await releaseEscrow(order.id);

      await prisma.dispute.update({
        where: { id },
        data: {
          status: 'RESOLVED_OWNER',
          resolution: note,
          resolvedAt: new Date(),
          resolvedBy: pgUser.id,
        },
      });

      await createNotification(
        order.adAccount.ownerId,
        'ORDER_COMPLETED',
        'Shikoyat hal qilindi — sizning foydasiga',
        `Buyurtma #${order.id} bo'yicha shikoyat hal qilindi. Pul chiqarildi.`,
        { orderId: order.id, disputeId: id },
      );
      await createNotification(
        order.advertiserId,
        'ORDER_COMPLETED',
        'Shikoyat hal qilindi',
        `Buyurtma #${order.id} bo'yicha shikoyat akkaunt egasi foydasiga hal qilindi.`,
        { orderId: order.id, disputeId: id },
      );
    } else {
      // Qisman — refundAmount advertiserga, qolgan escrowAmount'ga yaqin egasiga
      const refundAmt = parsed.data.refundAmount ?? 0;
      const ownerAmt = Math.max(0, order.escrowAmount - refundAmt);

      if (refundAmt > 0) {
        await refundEscrow(order.id, refundAmt);
      }

      if (ownerAmt > 0) {
        // Egasiga qolgan qismni chiqarish
        const ownerWallet = await prisma.wallet.findUniqueOrThrow({
          where: { userId: order.adAccount.ownerId },
        });
        const advertiserWallet = await prisma.wallet.findUniqueOrThrow({
          where: { userId: order.advertiserId },
        });

        await prisma.$transaction(async (tx) => {
          await tx.transaction.create({
            data: {
              walletId: ownerWallet.id,
              type: 'ESCROW_RELEASE',
              amount: ownerAmt,
              status: 'COMPLETED',
              orderId: order.id,
              note: 'Qisman hal — egasiga',
            },
          });
          await tx.wallet.update({
            where: { id: ownerWallet.id },
            data: { balance: { increment: ownerAmt }, totalEarned: { increment: ownerAmt } },
          });

          // Muzlatilgan balansdan qolganini olib tashlash
          const remaining = order.price - refundAmt - ownerAmt;
          if (remaining < 0) {
            await tx.wallet.update({
              where: { id: advertiserWallet.id },
              data: { frozenBalance: { decrement: remaining } },
            });
          }
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
        await tx.dispute.update({
          where: { id },
          data: {
            status: 'RESOLVED_PARTIAL',
            resolution: note,
            refundAmount: refundAmt,
            resolvedAt: new Date(),
            resolvedBy: pgUser.id,
          },
        });
      });
    }

    res.json({ success: true, message: 'Shikoyat hal qilindi' });
  } catch (err) {
    console.error('handleAdminResolveDispute error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * GET /api/marketplace/admin/stats
 * Umumiy statistika
 */
export const handleAdminStats: RequestHandler = async (req, res) => {
  try {
    const [
      totalAccounts,
      activeAccounts,
      pendingAccounts,
      totalOrders,
      completedOrders,
      pendingPayouts,
      openDisputes,
      revenueResult,
    ] = await Promise.all([
      prisma.adAccount.count(),
      prisma.adAccount.count({ where: { status: 'ACTIVE' } }),
      prisma.adAccount.count({ where: { status: 'PENDING' } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'COMPLETED' } }),
      prisma.payout.count({ where: { status: 'PENDING' } }),
      prisma.dispute.count({ where: { status: 'OPEN' } }),
      prisma.order.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { price: true, commissionAmount: true },
      }),
    ]);

    res.json({
      success: true,
      stats: {
        totalAccounts,
        activeAccounts,
        pendingAccounts,
        totalOrders,
        completedOrders,
        pendingPayouts,
        openDisputes,
        totalRevenue: revenueResult._sum.price ?? 0,
        totalCommission: revenueResult._sum.commissionAmount ?? 0,
      },
    });
  } catch (err) {
    console.error('handleAdminStats error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};
