import { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { MARKETPLACE_CONFIG } from '../../lib/marketplace-config';
import { getAdminTelegramIds } from '../../lib/notifications';
import { sendBotMessage, sendBotPhoto } from '../../bot-helpers';
import { getBot, getSellerBot } from '../../bot';
import {
  saveSubmission,
  buildAccountButtons,
  buildAccountCaption,
  buildEditAccountButtons,
  buildEditAccountCaption,
  type AdminAccountSubmission,
} from '../../lib/account-submissions';
import type { AdAccountDTO } from '@shared/marketplace';

// AdAccount -> DTO (BigInt xavfsiz)
function toDTO(acc: any): AdAccountDTO {
  return {
    id: acc.id,
    ownerId: acc.ownerId,
    igUsername: acc.igUsername,
    igProfileUrl: acc.igProfileUrl,
    avatarFileId: acc.avatarFileId ?? '',
    niche: acc.niche,
    customNiche: acc.customNiche ?? '',
    region: acc.region,
    description: acc.description,
    verificationScreenshots: Array.isArray(acc.verificationScreenshots)
      ? acc.verificationScreenshots
      : (acc.verificationScreenshots ? Object.values(acc.verificationScreenshots) : []),
    followers: acc.followers,
    avgReelsViews: acc.avgReelsViews,
    storyViews: acc.storyViews,
    engagementRate: acc.engagementRate,
    priceStory: acc.priceStory,
    priceReels: acc.priceReels,
    priceFeed: acc.priceFeed,
    guaranteedViews: acc.guaranteedViews,
    guaranteeHours: acc.guaranteeHours,
    status: acc.status,
    isVerified: acc.isVerified,
    verifiedBadge: acc.verifiedBadge ?? false,
    rating: acc.rating,
    completedOrders: acc.completedOrders,
    successRate: acc.successRate,
    createdAt: acc.createdAt.toISOString(),
    pendingEdit: acc.pendingEdit ?? null,
  };
}

/**
 * GET /api/marketplace/accounts
 * Faol akkauntlar ro'yxati (filtrlash, tartiblash, qidiruv)
 */
export const handleListAccounts: RequestHandler = async (req, res) => {
  try {
    // Auto-unfreeze: muzlatish muddati tugagan akkauntlarni avtomatik ACTIVE ga qaytaramiz
    await prisma.adAccount.updateMany({
      where: { status: 'SUSPENDED', frozenUntil: { lte: new Date() } },
      data: { status: 'ACTIVE', frozenUntil: null },
    }).catch(() => {});

    const { niche, region, sort = 'popular', search, minFollowers } = req.query as Record<string, string>;

    const where: any = { status: 'ACTIVE' };

    if (niche) where.niche = niche;
    if (region) where.region = { contains: region, mode: 'insensitive' };
    if (minFollowers) where.followers = { gte: Number(minFollowers) };
    if (search) {
      where.OR = [
        { igUsername: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    let orderBy: any = {};
    switch (sort) {
      case 'new':
        orderBy = { createdAt: 'desc' };
        break;
      case 'cheap':
        orderBy = { priceReels: 'asc' };
        break;
      case 'rating':
        orderBy = { rating: 'desc' };
        break;
      default: // 'popular'
        orderBy = [{ rating: 'desc' }, { completedOrders: 'desc' }];
    }

    const accounts = await prisma.adAccount.findMany({ where, orderBy });

    res.json({ success: true, accounts: accounts.map(toDTO) });
  } catch (err) {
    console.error('handleListAccounts error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

/**
 * GET /api/marketplace/accounts/:id
 * Bitta akkaunt + oxirgi case studylar + bajarilgan buyurtmalar soni
 */
export const handleGetAccount: RequestHandler = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Noto\'g\'ri ID' });
      return;
    }

    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: 'Akkaunt topilmadi' });
      return;
    }

    const cases = await prisma.caseStudy.findMany({
      where: { adAccountId: id, isApproved: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    const completedCount = await prisma.order.count({
      where: { adAccountId: id, status: 'COMPLETED' },
    });

    res.json({ success: true, account: toDTO(account), cases, completedOrdersCount: completedCount });
  } catch (err) {
    console.error('handleGetAccount error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

const createAccountSchema = z.object({
  igUsername: z.string().min(1).max(50),
  igProfileUrl: z.string().url().optional().or(z.literal('')),
  avatarFileId: z.string().min(1, 'Akkaunt rasmini yuklang'),
  niche: z.enum(['EDIT', 'STATUS', 'LIFESTYLE', 'BEAUTY', 'FOOD', 'SPORT', 'AUTO', 'BUSINESS', 'EDUCATION', 'ENTERTAINMENT', 'TECH', 'OTHER']).optional(),
  // niche === 'OTHER' bo'lganda "o'zingiz kiriting" matni
  customNiche: z.string().max(50).optional(),
  region: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  followers: z.number().int().nonnegative().optional(),
  avgReelsViews: z.number().int().nonnegative().optional(),
  storyViews: z.number().int().nonnegative().optional(),
  engagementRate: z.number().min(0).max(100).optional(),
  priceStory: z.number().int().nonnegative().optional(),
  priceReels: z.number().int().nonnegative().optional(),
  priceFeed: z.number().int().nonnegative().optional(),
  guaranteedViews: z.number().int().nonnegative().optional(),
  screenshots: z.array(z.string()).min(1, 'Kamida bitta skrinshot yuklang').max(10),
});

/**
 * POST /api/marketplace/accounts
 * Yangi akkaunt qo'shish (admin tasdig'i kutadi)
 */
export const handleCreateAccount: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const d = parsed.data;
    const minPrice = MARKETPLACE_CONFIG.minAdPrice;

    if (d.priceStory > 0 && d.priceStory < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }
    if (d.priceReels > 0 && d.priceReels < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }
    if (d.priceFeed > 0 && d.priceFeed < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }

    const account = await prisma.adAccount.create({
      data: {
        ownerId: pgUser.id,
        igUsername: d.igUsername.replace(/^@/, ''),
        igProfileUrl: d.igProfileUrl ?? '',
        avatarFileId: d.avatarFileId,
        niche: d.niche ?? 'OTHER',
        customNiche: d.niche === 'OTHER' ? (d.customNiche?.trim() ?? '') : '',
        region: d.region ?? 'Toshkent',
        description: d.description ?? '',
        followers: d.followers ?? 0,
        avgReelsViews: d.avgReelsViews ?? 0,
        storyViews: d.storyViews ?? 0,
        engagementRate: d.engagementRate ?? 0,
        priceStory: d.priceStory ?? 0,
        priceReels: d.priceReels ?? 0,
        priceFeed: d.priceFeed ?? 0,
        guaranteedViews: d.guaranteedViews ?? 0,
        verificationScreenshots: d.screenshots,
        status: 'PENDING',
      },
    });

    // Adminlarga bot orqali tasdiqlash so'rovi yuborish — best-effort
    const tgUsername = req.pgUser.username ? `@${req.pgUser.username}` : '';
    const firstName = req.pgUser.firstName || '';
    const submitter = [firstName, tgUsername].filter(Boolean).join(' ').trim() || `id:${req.pgUser.id}`;
    notifyAdminsOfNewAccount(account, submitter).catch(
      (e) => console.warn('Admin notify failed:', e?.message ?? e),
    );

    res.status(201).json({ success: true, account: toDTO(account) });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ success: false, error: 'Bu Instagram username allaqachon ro\'yxatdan o\'tgan' });
      return;
    }
    console.error('handleCreateAccount error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

function fmtNum(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n);
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Yangi akkaunt PENDING holatda yaratilgach — stars_bazar uslubidagi oqim:
 *   1) sendMediaGroup: Avatar + 3 skrinshot (har biri caption bilan)
 *   2) sendMessage: ariza tafsiloti + tugmalar
 *      - Boshlang'ich: [❌ Rad etish] + [💰 Narx belgilash]
 *      - Narx kelgach: [✅ Tasdiqlash] [❌ Rad etish] + [💰 Narxni o'zgartirish]
 *   3) submission holati account-submissions map'ida saqlanadi (bot callback uchun)
 */
// Yangi akkaunt arizasi haqidagi tekshiruv/narx belgilash oqimi hozircha
// FAQAT bitta admin uchun ishlaydi (2026-09-07, foydalanuvchi so'rovi
// bo'yicha) — bir nechta adminga bir vaqtda yuborilganda ularning
// message_id holati kesishib, ba'zida bittasi uchun ishlab, ikkinchisi
// uchun "qotib qolar" edi (real sabab: bu holat faqat operativ xotirada
// saqlanadi, server qayta ishga tushganda yo'qoladi — to'liq yechim shu
// holatni bazaga saqlash bo'lardi, lekin hozircha soddaroq yo'l tanlandi).
const ACCOUNT_REVIEW_EXCLUDED_ADMIN_ID = Number(process.env.ACCOUNT_REVIEW_EXCLUDED_ADMIN_ID) || 0;

export async function notifyAdminsOfNewAccount(account: any, submittedBy: string): Promise<void> {
  const bot = getBot();
  const adminIds = getAdminTelegramIds().filter((id) => id !== ACCOUNT_REVIEW_EXCLUDED_ADMIN_ID);
  if (!bot || adminIds.length === 0) return;

  const shots = Array.isArray(account.verificationScreenshots)
    ? (account.verificationScreenshots as unknown as string[])
    : [];

  const safeUsername = escapeHtml(account.igUsername);
  const safeBy = escapeHtml(submittedBy);

  // Birinchi rasm caption'iga ariza tafsiloti qo'yamiz — Telegram albomda
  // birinchi rasm caption'i albom ustida ko'rinadi.
  const firstCaption =
    `🆕 <b>Yangi e'lon arizasi</b>\n\n` +
    `👤 <b>@${safeUsername}</b>\n` +
    `🙋 Yuboruvchi: ${safeBy}\n` +
    `🆔 <code>#${account.id}</code>\n\n` +
    `👤 Avatar`;

  const items: Array<{ name: string; fileId?: string }> = [
    { name: firstCaption, fileId: account.avatarFileId },
    { name: "📊 Istori arxivi (1 kunlik ko'rishlar)", fileId: shots[0] },
    { name: '🌍 Qaysi davlatlar kuzatadi', fileId: shots[1] },
    { name: '👥 Obunachilar soni (profil skrini)', fileId: shots[2] },
  ];
  const media = items
    .filter((it) => !!it.fileId)
    .map((it, idx) => ({
      type: 'photo' as const,
      media: it.fileId!,
      caption: it.name,
      ...(idx === 0 ? { parse_mode: 'HTML' as const } : {}),
    }));

  for (const adminId of adminIds) {
    try {
      const mediaGroupMsgIds: number[] = [];
      if (media.length >= 2) {
        const sent = (await bot.sendMediaGroup(adminId, media as any)) as any[];
        for (const m of sent || []) {
          if (m && typeof m.message_id === 'number') mediaGroupMsgIds.push(m.message_id);
        }
      } else if (media.length === 1) {
        const m = (await bot.sendPhoto(adminId, media[0].media, {
          caption: media[0].caption,
        })) as any;
        if (m?.message_id) mediaGroupMsgIds.push(m.message_id);
      }

      const sub: AdminAccountSubmission = {
        accountId: account.id,
        adminChatId: adminId,
        igUsername: safeUsername,
        submittedBy: safeBy,
        mediaGroupMsgIds,
        buttonsMsgId: 0,
      };
      const btnMsg = (await bot.sendMessage(adminId, buildAccountCaption(sub), {
        parse_mode: 'HTML',
        reply_markup: buildAccountButtons(account.id, false) as any,
      })) as any;
      sub.buttonsMsgId = btnMsg?.message_id || 0;
      saveSubmission(sub);
    } catch (e) {
      console.warn(
        '[notifyAdminsOfNewAccount] admin notify fail:',
        e instanceof Error ? e.message : e,
      );
    }
  }
}

/**
 * ACTIVE akkaunt egasi rasm/skrinshotlarni yangilashni so'raganda — admin
 * chatiga xuddi yangi ariza kabi (avatar + 3 skrinshot albom + tugmali xabar)
 * yuboriladi, lekin narx belgilash bosqichisiz (akkaunt allaqachon narxga ega).
 */
export async function notifyAdminsOfAccountEdit(
  account: any,
  submittedBy: string,
  pendingEdit: { avatarFileId: string; screenshots: string[] },
): Promise<void> {
  const bot = getBot();
  const adminIds = getAdminTelegramIds().filter((id) => id !== ACCOUNT_REVIEW_EXCLUDED_ADMIN_ID);
  if (!bot || adminIds.length === 0) return;

  const shots = pendingEdit.screenshots;
  const safeUsername = escapeHtml(account.igUsername);
  const safeBy = escapeHtml(submittedBy);

  const firstCaption =
    `✏️ <b>Akkaunt yangilanish so'rovi</b>\n\n` +
    `👤 <b>@${safeUsername}</b>\n` +
    `🙋 Yuboruvchi: ${safeBy}\n` +
    `🆔 <code>#${account.id}</code>\n\n` +
    `👤 Yangi avatar`;

  const items: Array<{ name: string; fileId?: string }> = [
    { name: firstCaption, fileId: pendingEdit.avatarFileId },
    { name: "📊 Istori arxivi (1 kunlik ko'rishlar)", fileId: shots[0] },
    { name: '🌍 Qaysi davlatlar kuzatadi', fileId: shots[1] },
    { name: '👥 Obunachilar soni (profil skrini)', fileId: shots[2] },
  ];
  const media = items
    .filter((it) => !!it.fileId)
    .map((it, idx) => ({
      type: 'photo' as const,
      media: it.fileId!,
      caption: it.name,
      ...(idx === 0 ? { parse_mode: 'HTML' as const } : {}),
    }));

  for (const adminId of adminIds) {
    try {
      const mediaGroupMsgIds: number[] = [];
      if (media.length >= 2) {
        const sent = (await bot.sendMediaGroup(adminId, media as any)) as any[];
        for (const m of sent || []) {
          if (m && typeof m.message_id === 'number') mediaGroupMsgIds.push(m.message_id);
        }
      } else if (media.length === 1) {
        const m = (await bot.sendPhoto(adminId, media[0].media, { caption: media[0].caption })) as any;
        if (m?.message_id) mediaGroupMsgIds.push(m.message_id);
      }

      const sub: AdminAccountSubmission = {
        accountId: account.id,
        adminChatId: adminId,
        igUsername: safeUsername,
        submittedBy: safeBy,
        mediaGroupMsgIds,
        buttonsMsgId: 0,
        kind: 'edit',
      };
      const btnMsg = (await bot.sendMessage(adminId, buildEditAccountCaption(sub), {
        parse_mode: 'HTML',
        reply_markup: buildEditAccountButtons(account.id) as any,
      })) as any;
      sub.buttonsMsgId = btnMsg?.message_id || 0;
      saveSubmission(sub);
    } catch (e) {
      console.warn(
        '[notifyAdminsOfAccountEdit] admin notify fail:',
        e instanceof Error ? e.message : e,
      );
    }
  }
}

/**
 * GET /api/marketplace/my-accounts
 * Foydalanuvchi o'z akkauntlari (PENDING/ACTIVE/SUSPENDED)
 */
export const handleListMyAccounts: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const accounts = await prisma.adAccount.findMany({
      where: { ownerId: pgUser.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, accounts: accounts.map(toDTO) });
  } catch (err) {
    console.error('handleListMyAccounts error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

const updateAccountSchema = z.object({
  description: z.string().max(1000).optional(),
  priceStory: z.number().int().nonnegative().optional(),
  priceReels: z.number().int().nonnegative().optional(),
  priceFeed: z.number().int().nonnegative().optional(),
  guaranteedViews: z.number().int().nonnegative().optional(),
});

/**
 * PATCH /api/marketplace/accounts/:id
 * Narx, tavsif, kafolatli ko'rishlarni yangilash (faqat egasi)
 */
export const handleUpdateMyAccount: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Noto\'g\'ri ID' });
      return;
    }

    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: 'Akkaunt topilmadi' });
      return;
    }
    if (account.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: 'Faqat akkaunt egasi tahrirlashi mumkin' });
      return;
    }

    const parsed = updateAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }

    const d = parsed.data;
    const minPrice = MARKETPLACE_CONFIG.minAdPrice;

    if (d.priceStory !== undefined && d.priceStory > 0 && d.priceStory < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }
    if (d.priceReels !== undefined && d.priceReels > 0 && d.priceReels < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }
    if (d.priceFeed !== undefined && d.priceFeed > 0 && d.priceFeed < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }

    const updated = await prisma.adAccount.update({
      where: { id },
      data: {
        ...(d.description !== undefined && { description: d.description }),
        ...(d.priceStory !== undefined && { priceStory: d.priceStory }),
        ...(d.priceReels !== undefined && { priceReels: d.priceReels }),
        ...(d.priceFeed !== undefined && { priceFeed: d.priceFeed }),
        ...(d.guaranteedViews !== undefined && { guaranteedViews: d.guaranteedViews }),
      },
    });

    res.json({ success: true, account: toDTO(updated) });
  } catch (err) {
    console.error('handleUpdateMyAccount error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};

const editRequestSchema = z.object({
  avatarFileId: z.string().min(1, 'Akkaunt rasmini yuklang'),
  screenshots: z.array(z.string()).length(3, "Barcha 3 ta skrinshot bo'lishi shart"),
});

/**
 * POST /api/marketplace/my/accounts/:id/edit-request
 * ACTIVE akkaunt egasi rasm/skrinshotlarni yangilashni so'raydi — LIVE
 * maydonlarga darhol yozilmaydi, admin tasdiqlagunicha `pendingEdit`da turadi
 * (xuddi yangi akkaunt arizasi kabi ko'rib chiqiladi, lekin narxsiz bosqich).
 */
export const handleRequestAccountEdit: RequestHandler = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' });
      return;
    }

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Noto'g'ri ID" });
      return;
    }

    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: 'Akkaunt topilmadi' });
      return;
    }
    if (account.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: 'Faqat akkaunt egasi tahrirlashi mumkin' });
      return;
    }
    if (account.status !== 'ACTIVE') {
      res.status(400).json({ success: false, error: 'Faqat faol akkauntlar uchun yangilanish so\'ralishi mumkin' });
      return;
    }
    if (account.pendingEdit) {
      res.status(409).json({ success: false, error: 'Sizda allaqachon ko\'rib chiqilayotgan so\'rov bor' });
      return;
    }

    const parsed = editRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Validatsiya xatosi' });
      return;
    }
    const { avatarFileId, screenshots } = parsed.data;

    // Faqat profil rasmi o'zgarishi YETARLI EMAS — kamida bitta skrinshot
    // ham o'zgargan bo'lishi shart (foydalanuvchi so'rovi: "faqatgina profile
    // rasmini o'zgartirib yuborishni qabul qilmasin").
    const currentShots: string[] = Array.isArray(account.verificationScreenshots)
      ? (account.verificationScreenshots as unknown as string[])
      : [];
    const anyScreenshotChanged = screenshots.some((s, i) => s !== (currentShots[i] ?? ''));
    if (!anyScreenshotChanged) {
      res.status(400).json({
        success: false,
        error: 'Kamida bitta skrinshotni ham yangilashingiz kerak',
      });
      return;
    }

    const pendingEdit = {
      avatarFileId,
      screenshots,
      submittedAt: new Date().toISOString(),
    };

    const updated = await prisma.adAccount.update({
      where: { id },
      data: { pendingEdit },
    });

    const tgUsername = pgUser.username ? `@${pgUser.username}` : '';
    const firstName = pgUser.firstName || '';
    const submitter = [firstName, tgUsername].filter(Boolean).join(' ').trim() || `id:${pgUser.id}`;
    notifyAdminsOfAccountEdit(updated, submitter, pendingEdit).catch(
      (e) => console.warn('Admin edit-notify failed:', e?.message ?? e),
    );

    res.json({ success: true, account: toDTO(updated) });
  } catch (err) {
    console.error('handleRequestAccountEdit error:', err);
    res.status(500).json({ success: false, error: 'Serverda xato yuz berdi' });
  }
};
