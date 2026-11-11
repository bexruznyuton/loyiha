import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export async function connectPrisma() {
  await prisma.$connect();
  console.log('✅ PostgreSQL (Prisma) connected');
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
  console.log('🛑 PostgreSQL (Prisma) disconnected');
}
