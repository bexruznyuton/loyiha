// End-to-end marketplace cycle test.
// Birinchi bo'lim har bir bosqichda admin chatga narrator xabar yuboradi,
// keyin DB ga yozadi va natijani ko'rsatadi. Admin (=ham seller, ham buyer)
// kuzatib turadi.
//
// Ishlatish (VPS'da):
//   cd /var/www/instacap-marketplace
//   node scripts/cycle-test.mjs

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((s) => parseInt(s.trim()))
  .filter(Boolean);
if (!BOT_TOKEN || ADMIN_IDS.length === 0) {
  console.error('TELEGRAM_BOT_TOKEN va ADMIN_TELEGRAM_IDS o\'rnatilishi kerak');
  process.exit(1);
}
const ADMIN_TG_ID = ADMIN_IDS[0];

// PHP bridge — Top_sxema_instagrambot orqali xabar yuborish.
const PHP_BOT_URL = process.env.PHP_BOT_URL || '';
const FORWARD_SECRET = process.env.BOT_FORWARD_SECRET || '';
async function sendViaPhpBridge(chatId, text, opts = {}) {
  if (!PHP_BOT_URL || !FORWARD_SECRET) return null;
  try {
    const sep = PHP_BOT_URL.includes('?') ? '&' : '?';
    const res = await fetch(`${PHP_BOT_URL}${sep}relay=send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forward-Secret': FORWARD_SECRET },
      body: JSON.stringify({ chatId, text, parseMode: opts.parseMode || 'HTML', replyMarkup: opts.replyMarkup }),
    });
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('PHP bridge send failed:', e?.message || e);
    return null;
  }
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const prisma = new PrismaClient();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAUSE = 5000;
const fmt = (n) => new Intl.NumberFormat('uz-UZ').format(n);

async function narrate(text) {
  await bot.sendMessage(ADMIN_TG_ID, `🎬 <b>CYCLE TEST</b>\n\n${text}`, { parse_mode: 'HTML' });
}
async function note(text) {
  await bot.sendMessage(ADMIN_TG_ID, text, { parse_mode: 'HTML' });
}

async function main() {
  await narrate(
    `End-to-end marketplace cycle boshlandi.\n\n` +
      `<b>Bosqichlar:</b>\n` +
      `1️⃣ Seller akkaunt qo'shadi (PENDING)\n` +
      `2️⃣ Admin narx belgilaydi\n` +
      `3️⃣ Egasi narxga rozilik beradi (ACTIVE)\n` +
      `4️⃣ Mijoz REELS buyurtma beradi\n` +
      `5️⃣ Mijoz to'laydi (escrow)\n` +
      `6️⃣ Egasi qabul qiladi\n` +
      `7️⃣ Egasi Instagram'ga joylaydi\n` +
      `8️⃣ Mijoz tasdiqlaydi (COMPLETED)\n` +
      `9️⃣ Escrow ozod qilinadi → seller wallet kredit\n\n` +
      `Har bosqich orasida ~5 sekund.\n` +
      `<i>WebApp'ni ochib qo'ying — yangi akkaunt va order bosqichlarda paydo bo'ladi.</i>`,
  );
  await sleep(PAUSE);

  // 0. User (test seller + buyer — bitta hisob)
  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(ADMIN_TG_ID) },
    update: {},
    create: {
      telegramId: BigInt(ADMIN_TG_ID),
      firstName: 'CycleTest',
      username: 'admin',
    },
  });

  // ─── 1. AdAccount yaratish ───
  await narrate(`1️⃣ <b>Seller akkaunt qo'shmoqda...</b>`);
  await sleep(2000);

  const igUsername = `cycle_test_${Date.now().toString().slice(-6)}`;
  const account = await prisma.adAccount.create({
    data: {
      ownerId: user.id,
      igUsername,
      niche: 'LIFESTYLE',
      region: 'Toshkent',
      description: 'E2E test akkaunti (avtomatik yaratilgan)',
      followers: 50000,
      avgReelsViews: 25000,
      storyViews: 10000,
      avatarFileId: 'https://picsum.photos/seed/cycleavatar/400/400',
      verificationScreenshots: [
        'https://picsum.photos/seed/cycle1/440/780',
        'https://picsum.photos/seed/cycle2/440/780',
        'https://picsum.photos/seed/cycle3/440/780',
      ],
      status: 'PENDING',
    },
  });
  await note(
    `✅ <b>AdAccount #${account.id}</b> yaratildi\n` +
      `• @${igUsername}\n` +
      `• Niche: LIFESTYLE · Toshkent\n` +
      `• Status: <b>PENDING</b>\n\n` +
      `<i>(Real flowda admin chatga albom + tugmalar keladi)</i>`,
  );
  await sleep(PAUSE);

  // ─── 2. Admin narx belgilaydi ───
  const price = 150000;
  const priceReels = Math.round(price * 0.9);
  const priceStory = Math.round(price * 0.4);
  await narrate(`2️⃣ <b>Admin narx belgilamoqda:</b> ${fmt(price)} so'm`);
  await sleep(2000);

  await prisma.adAccount.update({
    where: { id: account.id },
    data: {
      priceFeed: price,
      priceReels,
      priceStory,
      reviewedAt: new Date(),
      reviewedBy: user.id,
    },
  });
  await note(
    `💰 <b>Narx yozildi (status hali PENDING)</b>\n` +
      `• Feed: <code>${fmt(price)}</code>\n` +
      `• Reels: <code>${fmt(priceReels)}</code>\n` +
      `• Story: <code>${fmt(priceStory)}</code>\n\n` +
      `<i>Real flowda egasiga bot rozilik so'rovi yuborardi</i>`,
  );
  await sleep(PAUSE);

  // ─── 3. Owner consent ───
  // Real flowda: admin tasdiqlash bossa → Top_sxema_instagrambot ga
  // egasiga "narxni tasdiqlang/bekor qiling" xabari ketadi.
  await narrate(`3️⃣ <b>Egasiga narx rozilik so'rovi yuborilmoqda</b> (@Top_sxema_instagrambot orqali)`);
  await sleep(2000);
  const consentRes = await sendViaPhpBridge(ADMIN_TG_ID,
    `🆕 <b>Akkauntingiz narxi belgilandi</b>\n\n` +
      `👤 <b>@${igUsername}</b>\n` +
      `💰 <b>${fmt(price)} so'm</b>\n\n` +
      `Quyidagi taqsimot taklif qilinmoqda:\n` +
      `· Feed: <code>${fmt(price)}</code>\n` +
      `· Reels: <code>${fmt(priceReels)}</code>\n` +
      `· Story: <code>${fmt(priceStory)}</code>\n\n` +
      `<i>Roziman bossangiz — akkaunt marketplaceda faol bo'ladi.\n` +
      `Bekor qilsangiz — admin yana ko'rib chiqadi.</i>`,
    {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '✅ Roziman', callback_data: `mkt:owner:agree:${account.id}:0` },
            { text: '❌ Bekor qilish', callback_data: `mkt:owner:cancel:${account.id}:0` },
          ],
        ],
      },
    },
  );
  await sleep(1500);

  await prisma.adAccount.update({
    where: { id: account.id },
    data: { status: 'ACTIVE', isVerified: true },
  });
  await note(
    `✅ <b>Akkaunt ACTIVE bo'ldi</b>\n` +
      (consentRes?.result?.ok ? `📨 Top_sxema_instagrambot ga rozilik so'rovi yuborildi ✓` : `⚠️ PHP bridge sozlanmagan — xabar @insaybbot bo'lib qoldi`) + `\n\n` +
      `🛒 <i>WebApp marketplace'ni ochsangiz — <b>@${igUsername}</b> ro'yxatda paydo bo'ldi!</i>`,
  );
  await sleep(PAUSE + 3000);

  // ─── 4. Buyer order yaratadi ───
  const orderPrice = priceReels;
  const commissionRate = 15;
  const commissionAmount = Math.round((orderPrice * commissionRate) / 100);
  const escrowAmount = orderPrice - commissionAmount;
  await narrate(`4️⃣ <b>Mijoz REELS buyurtma berdi</b>\nFormat: REELS · ${fmt(orderPrice)} so'm`);
  await sleep(2000);

  const order = await prisma.order.create({
    data: {
      advertiserId: user.id,
      adAccountId: account.id,
      format: 'REELS',
      price: orderPrice,
      commissionRate,
      commissionAmount,
      escrowAmount,
      materialType: 'VIDEO',
      materialFileId: 'BAACAgIAAxkBAAEXTESTVIDEOFILEIDxxx',
      materialCaption: 'E2E test reklama videosi 🎬',
      guaranteedViews: 12000,
      status: 'PENDING_PAYMENT',
    },
  });
  await prisma.orderEvent.create({
    data: { orderId: order.id, actorId: user.id, type: 'created' },
  });
  await note(
    `📋 <b>Order #${order.id}</b> yaratildi\n` +
      `• Status: <b>PENDING_PAYMENT</b>\n` +
      `• Format: REELS\n` +
      `• Narx: <code>${fmt(orderPrice)}</code> so'm\n` +
      `• Komissiya (15%): <code>${fmt(commissionAmount)}</code>\n` +
      `• Escrow (egasiga): <code>${fmt(escrowAmount)}</code>\n` +
      `• Kafolat: 12 000 ko'rishlar`,
  );
  await sleep(PAUSE);

  // ─── 5. Mock to'lov ───
  await narrate(`5️⃣ <b>Mijoz to'laydi (mock payment)</b>`);
  await sleep(2000);

  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'PAID' },
  });
  await prisma.orderEvent.create({
    data: { orderId: order.id, actorId: user.id, type: 'paid' },
  });
  await note(
    `💸 <b>Order #${order.id} → PAID</b>\n` +
      `Escrow <code>${fmt(escrowAmount)}</code> so'm muzlatildi.`,
  );
  // Sellerga (akkaunt egasiga) Top_sxema_instagrambot orqali yangi buyurtma xabari
  // + [📸 Skrinshot bilan tasdiqlash] inline tugmasi
  const orderRes = await sendViaPhpBridge(ADMIN_TG_ID,
    `🆕 <b>Yangi buyurtma!</b>\n\n` +
      `🛍 Buyurtmachi: CycleTest (test)\n` +
      `🎯 Format: <b>REELS</b>\n` +
      `💰 Narx: <code>${fmt(orderPrice)}</code> so'm\n` +
      `📥 Sizga: <code>${fmt(escrowAmount)}</code> so'm (komissiyadan keyin)\n` +
      `📊 Kafolat: <code>12 000</code> ko'rishlar\n\n` +
      `<i>Mijoz to'lov amalga oshirdi. Buyurtmani qabul qiling.\n` +
      `Postni Instagramda chiqargach, skrinshotni yuboring.</i>`,
    {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '📸 Skrinshot bilan tasdiqlash', callback_data: `mkt:post:upload:${order.id}` },
          ],
        ],
      },
    },
  );
  if (orderRes?.result?.ok) {
    await note(`📨 @Top_sxema_instagrambot ga "Yangi buyurtma!" + 📸 tugma yuborildi ✓\n\n<i>Botda «📸 Skrinshot bilan tasdiqlash» tugmasini bosib, har qanday skrinshot rasmni yuborib ko'ring — buyer'ga (siz) tasdiqlash uchun yuboriladi.</i>`);
  }
  await sleep(PAUSE);

  // ─── 6. Egasi qabul qiladi (DB only) ───
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'ACCEPTED',
      acceptedAt: new Date(),
      deadlinePostBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  await prisma.orderEvent.create({
    data: { orderId: order.id, actorId: user.id, type: 'accepted' },
  });

  // ─── 7-8. Egasi joyladi (POSTED) + buyer tasdig'i ───
  // E'tibor: bu interaktiv qism (📸 tugma bosish, skrinshot yuborish, buyer tasdiqlash)
  // odatda real-time foydalanuvchi tomonidan amalga oshiriladi. Bu yerda esa
  // tezroq cycle yakunlash uchun DB ni qo'lda yangilab qo'yamiz.
  // Real interaktiv testni Top_sxema_instagrambot'da yuqoridagi tugmadan boshlang.
  await narrate(`7️⃣ <b>Egasi joyladi (avto-DB yangilanish — real flowda 📸 tugma orqali)</b>`);
  await sleep(2000);

  const postedUrl = 'https://instagram.com/reel/CYCLETEST_LINK_xyz/';
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'POSTED',
      postedAt: new Date(),
      guaranteeProof: postedUrl,
      deadlineKeepUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.orderEvent.create({
    data: { orderId: order.id, actorId: user.id, type: 'posted' },
  });
  await note(
    `📤 <b>Order #${order.id} → POSTED</b> (DB)\n` +
      `🔗 Link: <code>${postedUrl}</code>`,
  );
  await sleep(PAUSE);

  // ─── 8. Mijoz tasdiqlaydi + Escrow release (DB) ───
  await narrate(`8️⃣ <b>Mijoz tasdiqladi (avto-DB)</b>`);
  await sleep(2000);

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      achievedViews: 15000,
    },
  });
  await prisma.orderEvent.create({
    data: { orderId: order.id, actorId: user.id, type: 'completed' },
  });
  await prisma.adAccount.update({
    where: { id: account.id },
    data: { completedOrders: { increment: 1 } },
  });

  // Wallet kredit (escrow ozodlash)
  let wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId: user.id, balance: 0, frozenBalance: 0, totalEarned: 0 },
    });
  }
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: {
      balance: { increment: escrowAmount },
      totalEarned: { increment: escrowAmount },
    },
  });
  await prisma.transaction.create({
    data: {
      walletId: wallet.id,
      type: 'ESCROW_RELEASE',
      amount: escrowAmount,
      status: 'COMPLETED',
      orderId: order.id,
      note: 'Order yakunlandi — escrow ozod qilindi',
    },
  });
  await prisma.transaction.create({
    data: {
      walletId: wallet.id,
      type: 'COMMISSION',
      amount: -commissionAmount,
      status: 'COMPLETED',
      orderId: order.id,
      note: `Platform komissiyasi (${commissionRate}%)`,
    },
  });

  await note(
    `🎉 <b>Order #${order.id} → COMPLETED</b>\n\n` +
      `💰 Seller wallet:\n` +
      `   + <code>${fmt(escrowAmount)}</code> so'm (escrow release)\n` +
      `📊 Akkaunt completedOrders +1\n` +
      `💎 Platform komissiyasi: <code>${fmt(commissionAmount)}</code> so'm`,
  );
  await sleep(PAUSE);

  // ─── Yakuniy ───
  const finalWallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  const finalAccount = await prisma.adAccount.findUnique({ where: { id: account.id } });
  const txCount = await prisma.transaction.count({ where: { walletId: wallet.id } });

  await narrate(
    `✅ <b>CYCLE TAMOM!</b>\n\n` +
      `<b>Yakuniy holat:</b>\n` +
      `• AdAccount #${account.id} (@${igUsername})\n` +
      `   status: <b>${finalAccount.status}</b>\n` +
      `   completedOrders: ${finalAccount.completedOrders}\n\n` +
      `• Order #${order.id} → <b>COMPLETED</b>\n\n` +
      `• Wallet balance: <code>${fmt(finalWallet.balance)}</code> so'm\n` +
      `• Total earned: <code>${fmt(finalWallet.totalEarned)}</code> so'm\n` +
      `• Tranzaksiyalar: ${txCount} ta\n\n` +
      `<i>Test akkauntini olib tashlash: /search ${igUsername} → 🗑 O'chirish</i>`,
  );

  await prisma.$disconnect();
  console.log('CYCLE DONE');
}

main().catch(async (e) => {
  console.error('CYCLE ERROR:', e);
  try {
    await bot.sendMessage(ADMIN_TG_ID, `❌ Cycle xatosi: ${e?.message || e}`);
  } catch {}
  await prisma.$disconnect();
  process.exit(1);
});
