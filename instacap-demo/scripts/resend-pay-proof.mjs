// Yopilib qolgan AWAITING_PAYMENT_APPROVAL order uchun admin'ga to'lov
// skrinshotini qaytadan yuborish.
// Foydalanish: node scripts/resend-pay-proof.mjs <orderId>

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';

const fmt = (n) => new Intl.NumberFormat('uz-UZ').format(n);
const orderId = Number(process.argv[2]);
if (!orderId) {
  console.error('Usage: node scripts/resend-pay-proof.mjs <orderId>');
  process.exit(1);
}

const prisma = new PrismaClient();
const o = await prisma.order.findUnique({
  where: { id: orderId },
  include: { advertiser: true, adAccount: true },
});
if (!o) { console.error('order not found'); process.exit(1); }
if (!o.paymentProofFileId) { console.error('no payment proof file'); process.exit(1); }

const sellerToken = process.env.WEBAPP_BOT_TOKEN;
const insyToken = process.env.TELEGRAM_BOT_TOKEN;
const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',').map(s => parseInt(s.trim())).filter(Boolean);

const r = await fetch(`https://api.telegram.org/bot${sellerToken}/getFile?file_id=${encodeURIComponent(o.paymentProofFileId)}`);
const j = await r.json();
if (!j.ok) { console.error('getFile fail:', j.description); process.exit(1); }
const fileUrl = `https://api.telegram.org/file/bot${sellerToken}/${j.result.file_path}`;
const fileRes = await fetch(fileUrl);
if (!fileRes.ok) { console.error('file download fail:', fileRes.status); process.exit(1); }
const buffer = Buffer.from(await fileRes.arrayBuffer());
console.log('Downloaded', buffer.length, 'bytes');

const buyerName = o.advertiser.username
  ? `@${o.advertiser.username}`
  : (o.advertiser.firstName || `id:${o.advertiserId}`);
const caption =
  `💸 <b>To'lov skrinshoti tasdiqlash kerak</b>\n\n` +
  `🛍 Mijoz: ${buyerName}\n` +
  `📲 Akkaunt: <b>@${o.adAccount.igUsername}</b>\n` +
  `🎯 Maqsad: <b>@${o.targetIgUsername || '—'}</b>\n` +
  `💰 Summa: <code>${fmt(o.price)}</code> so'm\n` +
  `🆔 Order: <code>#${o.id}</code>`;
const replyMarkup = {
  inline_keyboard: [[
    { text: '✅ To\'lov tasdiqlandi', callback_data: `mkt:admin:pay:approve:${o.id}` },
    { text: '❌ Rad etish', callback_data: `mkt:admin:pay:reject:${o.id}` },
  ]],
};

const bot = new TelegramBot(insyToken, { polling: false });
for (const id of adminIds) {
  try {
    await bot.sendPhoto(
      id,
      buffer,
      { caption, parse_mode: 'HTML', reply_markup: replyMarkup },
      { filename: `pay-proof-${o.id}.jpg`, contentType: 'image/jpeg' },
    );
    console.log('sent to', id);
  } catch (e) {
    console.log('fail', id, e.message);
  }
}
await prisma.$disconnect();
