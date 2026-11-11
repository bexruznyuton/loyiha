import { prisma } from './prisma';
import { MARKETPLACE_CONFIG } from './marketplace-config';

/**
 * To'lov qabul qilindi — escrow muzlatiladi.
 * Advertiser walletiga: +price (DEPOSIT mock), keyin -price (ESCROW_HOLD).
 */
export async function holdEscrow(orderId: number) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  const payment = order.payments[0];
  if (!payment) throw new Error('Payment topilmadi');

  const deadlinePostBy = new Date(
    Date.now() + MARKETPLACE_CONFIG.deadlinePostHours * 60 * 60 * 1000,
  );

  await prisma.$transaction(async (tx) => {
    // Payment PAID
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    // Order PAID + deadline
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'PAID', deadlinePostBy },
    });

    // Advertiser wallet: mock DEPOSIT
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.advertiserId } });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amount: order.price,
        status: 'COMPLETED',
        orderId,
        paymentId: payment.id,
        note: 'Mock to\'lov (test)',
      },
    });

    // ESCROW_HOLD (manfiy)
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'ESCROW_HOLD',
        amount: -order.price,
        status: 'COMPLETED',
        orderId,
        note: 'Escrow muzlatildi',
      },
    });

    // Wallet balansini yangilash
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        frozenBalance: { increment: order.price },
        totalSpent: { increment: order.price },
      },
    });
  });
}

/**
 * Buyurtma yakunlandi — escrow akkaunt egasiga ozod qilinadi.
 */
export async function releaseEscrow(orderId: number) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { adAccount: { include: { owner: { include: { wallet: true } } } } },
  });

  const ownerWallet = order.adAccount.owner.wallet;
  if (!ownerWallet) throw new Error('Akkaunt egasining walletı topilmadi');

  const advertiserWallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: order.advertiserId },
  });

  await prisma.$transaction(async (tx) => {
    // Advertiser: frozen -> spent
    await tx.wallet.update({
      where: { id: advertiserWallet.id },
      data: { frozenBalance: { decrement: order.price } },
    });

    // Owner walletga escrowAmount kirim
    await tx.transaction.create({
      data: {
        walletId: ownerWallet.id,
        type: 'ESCROW_RELEASE',
        amount: order.escrowAmount,
        status: 'COMPLETED',
        orderId,
        note: 'Buyurtma yakunlandi, pul ozod qilindi',
      },
    });

    await tx.wallet.update({
      where: { id: ownerWallet.id },
      data: {
        balance: { increment: order.escrowAmount },
        totalEarned: { increment: order.escrowAmount },
      },
    });

    // Komissiya tranzaksiya (platform uchun)
    await tx.transaction.create({
      data: {
        walletId: advertiserWallet.id,
        type: 'COMMISSION',
        amount: -order.commissionAmount,
        status: 'COMPLETED',
        orderId,
        note: `Platforma komissiyasi (${order.commissionRate}%)`,
      },
    });

    // Order COMPLETED
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  });
}

/**
 * Buyurtma bekor qilindi — escrow advertisorga qaytariladi.
 * amount berilmasa — to'liq narx qaytariladi.
 */
export async function refundEscrow(orderId: number, amount?: number) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const refundAmount = amount ?? order.price;

  const advertiserWallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: order.advertiserId },
  });

  await prisma.$transaction(async (tx) => {
    // ESCROW_REFUND tranzaksiya
    await tx.transaction.create({
      data: {
        walletId: advertiserWallet.id,
        type: 'ESCROW_REFUND',
        amount: refundAmount,
        status: 'COMPLETED',
        orderId,
        note: 'Escrow qaytarildi',
      },
    });

    // Wallet yangilash
    await tx.wallet.update({
      where: { id: advertiserWallet.id },
      data: {
        balance: { increment: refundAmount },
        depositBalance: { increment: refundAmount }, // qaytgan pul yechib olinmaydi
        frozenBalance: { decrement: refundAmount },
        totalSpent: { decrement: refundAmount },
      },
    });
  });
}
