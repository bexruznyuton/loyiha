import { prisma } from './prisma';
import type { IUser } from '../models/User';

// Prisma `upsert` atomik emas (avval SELECT, keyin INSERT). WebApp ochilganda
// bir vaqtda bir nechta so'rov keladi — ikkalasi ham qatorni "yo'q" deb ko'rib
// INSERT qiladi va ikkinchisi P2002 (unique) xatosiga uchraydi. Production
// logida 44 marta `pgUserMiddleware ... Unique constraint failed on user_id`
// shu sabab chiqqan (2026-10-02). Poyga yutqazgan tomonda qator allaqachon
// mavjud — shuning uchun bir marta qayta urinish yetarli (endi UPDATE yo'liga
// tushadi).
async function retryOnUniqueRace<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.code === 'P2002') return fn();
    throw e;
  }
}

/**
 * SQLite User'ni Postgres'ga sinxronlaydi.
 * Marketplace endpointlari shu funksiyani chaqirib req.pgUser ni oladi.
 * Wallet ham yaratiladi (yo'q bo'lsa).
 */
export async function syncUserToPrisma(sqliteUser: IUser) {
  const telegramId = BigInt(sqliteUser.telegramId);

  const pgUser = await retryOnUniqueRace(() =>
    prisma.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        firstName: sqliteUser.firstName,
        lastName: sqliteUser.lastName || '',
        username: sqliteUser.username || '',
        photoUrl: sqliteUser.photoUrl || '',
        // Prisma `Language` enum faqat uz/ru/en — Telegram'dan boshqa til
        // kodi (masalan "tr") kelsa upsert ValidationError bilan yiqilib,
        // shu foydalanuvchi uchun barcha marketplace so'rovlari 500 bergan.
        language: (['uz', 'ru', 'en'].includes(sqliteUser.language) ? sqliteUser.language : 'uz') as any,
      },
      update: {
        firstName: sqliteUser.firstName,
        lastName: sqliteUser.lastName || '',
        username: sqliteUser.username || '',
        photoUrl: sqliteUser.photoUrl || '',
        lastSeen: new Date(),
      },
    }),
  );

  // Walletni avtomatik yarat
  await retryOnUniqueRace(() =>
    prisma.wallet.upsert({
      where: { userId: pgUser.id },
      create: { userId: pgUser.id, balance: 0 },
      update: {},
    }),
  );

  return pgUser;
}

/**
 * Telegram ID bo'yicha to'g'ridan-to'g'ri Prisma'dan user oladi.
 * (Boshqa serverdan bot orqali kelgan xabarlar uchun.)
 */
export async function getOrCreatePgUserByTelegramId(
  telegramId: number,
  firstName = 'User',
) {
  const bigId = BigInt(telegramId);
  const pgUser = await retryOnUniqueRace(() =>
    prisma.user.upsert({
      where: { telegramId: bigId },
      create: { telegramId: bigId, firstName },
      update: {},
    }),
  );
  await retryOnUniqueRace(() =>
    prisma.wallet.upsert({
      where: { userId: pgUser.id },
      create: { userId: pgUser.id, balance: 0 },
      update: {},
    }),
  );
  return pgUser;
}
