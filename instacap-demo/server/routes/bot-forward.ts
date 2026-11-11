/**
 * POST /api/bot-forward
 *
 * Eski xostingdagi bot.php Top_sxema_instagrambot uchun Telegram'dan
 * keladigan callback_query (mkt:owner:* va boshqalar) larni shu yerga
 * forward qiladi. VPS shu callback'larni ishlatadi va PHP relay orqali
 * Telegram'ga javob beradi (answerCallbackQuery + editMessageText).
 *
 * Auth: header `X-Forward-Secret` PHP'dagi INSTACAP_FORWARD_SECRET bilan
 * bir xil bo'lishi shart.
 */

import { RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { createNotification } from '../lib/notifications';
import { phpBot, telegramFailure, isUnreachable } from '../lib/php-bot-bridge';
import { handleSellerUnreachable } from '../lib/order-auto-cancel';
import { SUPPORT_USERNAME } from '../lib/support';

const FORWARD_SECRET = process.env.BOT_FORWARD_SECRET || '';
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((s) => parseInt(s.trim()))
  .filter(Boolean);

// In-memory state: seller'lar postni tasdiqlash uchun skrinshot kutmoqda.
// sellerTgId → orderId
const awaitingPostProof = new Map<number, number>();
// Buyer'lar to'lov skrinshoti yuborishi kutilmoqda.
// buyerTgId → orderId
const awaitingPaymentProof = new Map<number, number>();
// Buyer'lar ulanadigan video / rasm yuborishi kutilmoqda (admin to'lov tasdiqlagach).
// Bu DB statusi orqali bilinadi (AWAITING_BUYER_MATERIAL) — in-memory map shart emas.
// Eski yozuvlarni 30 daqiqada tozalash
setInterval(() => {
  // 30 min'dan eski state'lar (currently no expiry tracking — keeping simple)
}, 30 * 60 * 1000);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtUZS(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n);
}

// Foydalanuvchilar havolani har xil ko'rinishda yuboradi: `https://`siz,
// `www.`siz, Instagram'ning yangi `/share/reel/...` formatida yoki
// `instagram.com/<username>/reel/...` ko'rinishida. Avvalgi qat'iy qoida
// bularni tanimasdi — havola xeshteg so'rovi deb tushunilib, buyurtma
// qotib qolardi (mijoz sinovi, 2026-10-05).
const IG_LINK_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:share\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i;
const normalizeIgLink = (raw: string) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
const SELLER_SETTINGS_VIDEO = 'https://t.me/kodlarphp/471';

// Sotuvchi bir nechta to'langan buyurtmasi bor paytda havola yuborsa — havola
// qaysi buyurtmaga tegishli ekanini tanlatamiz; tanlov kelguncha shu yerda.
// sellerTgId → { url, expiresAt }
const pendingSellerLinks = new Map<number, { url: string; expiresAt: number }>();

// Akkaunt egasi admin bilan anonim chatda javob yozayotgan bo'lsa — javobni
// admin'ga (insy bot orqali) yetkazadi. Yetkazilgan bo'lsa true.
async function forwardOwnerReplyToAdmin(fromTgId: number, text: string): Promise<boolean> {
  const { getAwaitingOwnerReply, clearAwaitingOwnerReply } = await import('../lib/account-submissions');
  const pending = getAwaitingOwnerReply(fromTgId);
  if (!pending) return false;
  clearAwaitingOwnerReply(fromTgId);
  try {
    const { getBot } = await import('../bot');
    const adminBot = getBot();
    if (adminBot) {
      await adminBot.sendMessage(pending.adminChatId,
        `💬 <b>Akkaunt egasidan javob</b>\n\n` +
        `Akkaunt <code>#${pending.accountId}</code>:\n\n` +
        `<blockquote>${escapeHtml(text)}</blockquote>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✍️ Yana yozish', callback_data: `mkt:verify:${pending.accountId}:chat` }],
              [{ text: '🚫 Bloklash', callback_data: `mkt:vchat:block:${pending.accountId}:${fromTgId}` }],
            ],
          },
        } as any,
      );
    }
  } catch (e) {
    console.warn('vchat owner→admin send fail:', e instanceof Error ? e.message : e);
  }
  await phpBot.sendMessage(fromTgId, '✅ Javobingiz adminga yetkazildi.').catch(() => {});
  return true;
}

/**
 * POST /api/bot-forward/text — SINXRON.
 *
 * bot.php oddiy matnli xabarni (asosiy /api/bot-forward'dan farqli o'laroq)
 * shu yerga yuborib, javobni KUTADI: xabar marketplace oqimiga tegishli
 * bo'lsa VPS uni o'zi qayta ishlaydi va `handled: true` qaytaradi — bot.php
 * shunda o'zining javobini (masalan xeshteg) yubormaydi.
 *
 * Nega kerak: xaridor to'lovdan keyin Instagram havolasini MATN sifatida
 * yuboradi, bot.php esa avval faqat media/callback'larni forward qilardi —
 * havola hech qachon yetib kelmay, 17 ta to'langan buyurtma qotib qolgan
 * (2026-10-02). Xuddi shu sabab bilan sotuvchining adminga matnli javobi ham
 * yetib bormasdi.
 */
export const handleBotForwardText: RequestHandler = async (req, res) => {
  const secret = req.header('x-forward-secret') ?? '';
  if (!FORWARD_SECRET || secret !== FORWARD_SECRET) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }
  let handled = false;
  try {
    const msg = (req.body as any)?.message;
    const fromTgId = Number(msg?.from?.id || 0);
    const text = String(msg?.text || '').trim();
    if (fromTgId && text && !text.startsWith('/')) {
      if (await forwardOwnerReplyToAdmin(fromTgId, text)) {
        handled = true;
      } else {
        const ig = text.match(IG_LINK_RE);
        if (ig) {
          handled = await handleMarketplaceLink(fromTgId, normalizeIgLink(ig[0]));
          console.log(`[bot-forward/text] IG havola tg=${fromTgId} handled=${handled} url=${ig[0]}`);
        }
      }
    }
  } catch (e) {
    console.error('handleBotForwardText error:', e);
  }
  res.json({ ok: true, handled });
};

export const handleBotForward: RequestHandler = async (req, res) => {
  const secret = (req.header('x-forward-secret') || req.header('X-Forward-Secret')) ?? '';
  if (!FORWARD_SECRET || secret !== FORWARD_SECRET) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }
  // Telegram javobini darhol qaytaramiz, ishni fonda davom ettiramiz.
  res.json({ ok: true });

  try {
    const update = req.body as any;

    const msg = update?.message;

    // 0) Hamyon (marketplace) Telegram Stars to'lovi — bot.php webhook'i
    //    "mktw:" prefiksli invoice_payload'ni shu yerga forward qiladi
    //    (video-analiz uchun "instacap:"/"instacappid:" payload'lar hamon
    //    bot.php'ning O'ZIDA qoladi, bu yerga kelmaydi).
    const sp = msg?.successful_payment;
    if (sp) {
      const payload = String(sp.invoice_payload || '');
      const m = payload.match(/^mktw:(\d+):(\d+):[a-f0-9]+$/i);
      if (m) {
        const topupId = Number(m[1]);
        const chargeId = String(sp.telegram_payment_charge_id || '');
        const starsAmount = Number(sp.total_amount || 0);
        const { creditStarsTopupIfPaid } = await import('./marketplace/wallet');
        await creditStarsTopupIfPaid(topupId, chargeId, starsAmount).catch((e) =>
          console.error('creditStarsTopupIfPaid error:', e),
        );
      }
      return;
    }

    // 1a) Photo xabar: post-proof / payment-proof state'lariga qarab yo'naltirish
    if (msg?.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      const fromTgId = Number(msg.from?.id || 0);
      const fileId = msg.photo[msg.photo.length - 1]?.file_id;
      if (!fileId) return;

      const postOrderId = awaitingPostProof.get(fromTgId);
      if (postOrderId) {
        awaitingPostProof.delete(fromTgId);
        await processPostProofUpload(postOrderId, fileId, fromTgId).catch((e) =>
          console.error('processPostProofUpload error:', e),
        );
        return;
      }

      const payOrderId = awaitingPaymentProof.get(fromTgId);
      if (payOrderId) {
        awaitingPaymentProof.delete(fromTgId);
        await processPaymentProofUpload(payOrderId, fileId, fromTgId).catch((e) =>
          console.error('processPaymentProofUpload error:', e),
        );
        return;
      }

      // Topup chek skrinshoti: status PENDING bo'lgan oxirgi topup'ni qidiramiz
      const pendingTopup = await prisma.topup.findFirst({
        where: {
          user: { telegramId: BigInt(fromTgId) },
          status: 'PENDING' as any,
        },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      }).catch(() => null);
      if (pendingTopup) {
        await processTopupScreenshot(pendingTopup, fileId, fromTgId).catch((e) =>
          console.error('processTopupScreenshot error:', e),
        );
        return;
      }
      // Photo, lekin pay-proof emas — material sifatida tekshiramiz (pastda)
    }

    // 1a-bis) Owner anonim chat'da admin'ga javob yozyaptimi? (caption orqali —
    // oddiy matn esa /api/bot-forward/text orqali sinxron keladi)
    if (msg?.from?.id && (msg.text || msg.caption)) {
      const text = (msg.text || msg.caption || '').trim();
      if (text && !text.startsWith('/') && (await forwardOwnerReplyToAdmin(Number(msg.from.id), text))) return;
    }

    // 1b) Media caption'ida Instagram havolasi bo'lsa — sotuvchi/xaridor havola
    //     oqimi (oddiy matn esa /api/bot-forward/text orqali sinxron keladi).
    if (msg?.from?.id) {
      const ig = String(msg.text || msg.caption || '').match(IG_LINK_RE);
      if (ig && (await handleMarketplaceLink(Number(msg.from.id), normalizeIgLink(ig[0])).catch((e) => {
        console.error('handleMarketplaceLink error:', e);
        return false;
      }))) return;
    }

    // 2) Callback query
    const cq = update?.callback_query;
    if (!cq) return;
    const data = String(cq.data || '');
    if (!data.startsWith('mkt:')) return;

    const parts = data.split(':');
    const kind = parts[1];
    const fromTgId = Number(cq.from?.id || 0);
    const chatId = Number(cq.message?.chat?.id || 0);
    const messageId = Number(cq.message?.message_id || 0);

    if (kind === 'owner') {
      const action = parts[2];
      const accountId = Number(parts[3] || 0);
      await processOwnerConsent(cq.id, action, accountId, chatId, messageId, fromTgId);
    } else if (kind === 'seller') {
      // mkt:seller:accept|reject:<orderId> — yangi order so'roviga seller javobi
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      await processSellerConsent(cq.id, action, orderId, chatId, messageId, fromTgId)
        .catch((e) => console.error('processSellerConsent error:', e));
    } else if (kind === 'buyer') {
      // mkt:buyer:pay:upload:<orderId> | mkt:buyer:cancel:<orderId>
      const sub = parts[2];
      if (sub === 'pay' && parts[3] === 'upload') {
        const orderId = Number(parts[4] || 0);
        awaitingPaymentProof.set(fromTgId, orderId);
        await phpBot.sendMessage(
          chatId,
          `📸 <b>To'lov skrinshotini yuboring</b>\n\n` +
            `To'lov amalga oshirilganlik haqidagi cheq skrinshotini shu chatga rasm sifatida yuboring.\n` +
            `Admin tekshirib tasdiqlaydi.`,
        ).catch(() => {});
        await phpBot.answerCallbackQuery(cq.id, { text: '📸 Skrinshot kutilmoqda' }).catch(() => {});
      } else if (sub === 'cancel') {
        const orderId = Number(parts[3] || 0);
        await processBuyerCancel(cq.id, orderId, chatId, messageId, fromTgId)
          .catch((e) => console.error('processBuyerCancel error:', e));
      }
    } else if (kind === 'post') {
      // mkt:post:upload:<orderId> — seller "Skrinshot bilan tasdiqlash" bosgan
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      if (action === 'upload') {
        awaitingPostProof.set(fromTgId, orderId);
        await phpBot.sendMessage(
          chatId,
          `📸 <b>Skrinshot yuboring</b>\n\n` +
            `Post chiqarilgan ekran skrinshotini shu chatga rasm sifatida yuboring.\n` +
            `Buyurtmachi uni ko'rib tasdiqlaydi.`,
        ).catch(() => {});
        await phpBot.answerCallbackQuery(cq.id, { text: '📸 Skrinshot kutilmoqda' }).catch(() => {});
      }
    } else if (kind === 'proof') {
      // mkt:proof:approve|reject:<orderId> — buyer tasdiqlash/rad etish (eski oqim)
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      await processProofVerification(cq.id, action, orderId, chatId, messageId, fromTgId)
        .catch((e) => console.error('processProofVerification error:', e));
    } else if (kind === 'slink') {
      // mkt:slink:<orderId> — bir nechta to'langan buyurtmasi bor sotuvchi
      // yuborgan havola qaysi buyurtmaga tegishli ekanini tanladi.
      await processSellerLinkChoice(cq.id, Number(parts[2] || 0), chatId, messageId, fromTgId)
        .catch((e) => console.error('processSellerLinkChoice error:', e));
    } else if (kind === 'collab') {
      // mkt:collab:approve|reject:<orderId> — eski oqim: seller IG'da collab tasdiqladimi?
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      await processSellerCollabConfirmation(cq.id, action, orderId, chatId, messageId, fromTgId)
        .catch((e) => console.error('processSellerCollabConfirmation error:', e));
    } else if (kind === 'topup') {
      // mkt:topup:approve|reject|cancel:<topupId>
      const action = parts[2];
      const topupId = Number(parts[3] || 0);
      await processTopupCallback(cq.id, action, topupId, chatId, messageId, fromTgId)
        .catch((e) => console.error('processTopupCallback error:', e));
    } else if (kind === 'vchat') {
      // mkt:vchat:reply:<accountId> — owner anonim chat'da javob yozish.
      // ESLATMA: "🚫 Bloklash" tugmasi (mkt:vchat:block:...) ADMIN'ga
      // ko'rsatiladi (adminBot/insaybbot orqali) — bu yerga (bot.php dan
      // forward qilingan owner-tomon callbacklar) hech qachon kelmaydi, uni
      // bot-marketplace.ts'ning O'Z callback_query dispatcher'i ushlaydi.
      const sub = parts[2];
      const accountId = Number(parts[3] || 0);
      if (sub === 'reply') {
        await processOwnerChatReplyStart(cq.id, accountId, chatId, messageId, fromTgId)
          .catch((e) => console.error('processOwnerChatReplyStart error:', e));
      }
    }
  } catch (err) {
    console.error('bot-forward error:', err);
  }
};

// ─────────────── Havola oqimi (mijoz talabi, 2026-10-03) ───────────────
// Xaridor videoni o'zi joylab, sotuvchini collab'ga qo'shadi → SOTUVCHI
// collab'ni qabul qilib havolani botga yuboradi → xaridorga "Video ulandi,
// tasdiqlaysizmi?" → xaridor tasdiqlasa 24 soatdan keyin pul sotuvchiga.

const awaitingMaterialInclude = { adAccount: { include: { owner: true } }, advertiser: true } as const;

// Instagram havolasi kimdan kelganiga qarab yo'naltiradi. Xabar marketplace
// oqimiga tegishli bo'lsa true (bot.php shunda o'z javobini yubormaydi).
// Havola shu foydalanuvchining shu buyurtmadagi roliga qarab ishlanadi:
// sotuvchi bo'lsa — buyurtma xaridor tasdig'iga o'tadi; xaridor bo'lsa —
// havola sotuvchiga yetkaziladi.
async function routeLink(order: any, igUrl: string, fromTgId: number): Promise<void> {
  if (Number(order.adAccount?.owner?.telegramId || 0) === fromTgId) await processSellerLink(order, igUrl, fromTgId);
  else await relayBuyerLinkToSeller(order, igUrl, fromTgId);
}

// Instagram havolasini yuborgan odamning havola kutayotgan buyurtmasiga
// yo'naltiradi. Xabar marketplace oqimiga tegishli bo'lsa true.
// MUHIM: bir nechta mos buyurtma bo'lsa (ikkala rolda ham hisoblanadi) —
// TAXMIN QILINMAYDI, foydalanuvchi tanlaydi. Aks holda havola begona
// sotuvchiga ketardi yoki xaridor havolasi o'sha odamning sotuvchi
// buyurtmasiga yozilib, boshqa xaridorga noto'g'ri "Video ulandi" borardi.
async function handleMarketplaceLink(fromTgId: number, igUrl: string): Promise<boolean> {
  const tg = BigInt(fromTgId);
  const orders = await prisma.order.findMany({
    where: {
      status: 'AWAITING_BUYER_MATERIAL' as any,
      OR: [{ adAccount: { owner: { telegramId: tg } } }, { advertiser: { telegramId: tg } }],
    },
    orderBy: { createdAt: 'asc' },
    include: awaitingMaterialInclude,
  });
  if (orders.length === 0) return false;
  if (orders.length === 1) {
    await routeLink(orders[0], igUrl, fromTgId);
    return true;
  }
  pendingSellerLinks.set(fromTgId, { url: igUrl, expiresAt: Date.now() + 30 * 60 * 1000 });
  await phpBot.sendMessage(fromTgId,
    `🔗 Sizda bir nechta faol buyurtma bor. <b>Bu havola qaysi buyurtma uchun?</b>\n\n${escapeHtml(igUrl)}`,
    {
      replyMarkup: {
        inline_keyboard: orders.slice(0, 10).map((o: any) => {
          const isSeller = Number(o.adAccount.owner?.telegramId || 0) === fromTgId;
          return [{
            text: isSeller
              ? `#${o.id} — siz sotuvchi, xaridor @${o.targetIgUsername || '—'}`
              : `#${o.id} — siz xaridor, sotuvchi @${o.adAccount.igUsername}`,
            callback_data: `mkt:slink:${o.id}`,
          }];
        }),
      },
    },
  ).catch(() => {});
  return true;
}

async function processSellerLink(order: any, igUrl: string, sellerTgId: number): Promise<void> {
  const buyerTgId = Number(order.advertiser?.telegramId || 0);
  // Shartli yangilash: shu orada xaridor buyurtmani bekor qilgan bo'lsa (pul
  // qaytarilgan), bekor qilingan buyurtma qayta tirilmasin.
  const flip = await prisma.order.updateMany({
    where: { id: order.id, status: 'AWAITING_BUYER_MATERIAL' as any },
    data: {
      materialFileId: igUrl, // havolani shu maydonga saqlaymiz
      materialType: 'VIDEO',
      status: 'AWAITING_BUYER_VERIFY' as any,
      postedAt: new Date(),
    },
  });
  if (flip.count !== 1) {
    await phpBot.sendMessage(sellerTgId, `⚠️ Buyurtma <code>#${order.id}</code> endi havola kutmayapti (bekor qilingan bo'lishi mumkin).`).catch(() => {});
    return;
  }
  await prisma.orderEvent.create({
    data: { orderId: order.id, type: 'seller_link_uploaded', actorId: order.adAccount.ownerId, payload: { url: igUrl } },
  }).catch(() => {});

  await phpBot.sendMessage(sellerTgId,
    `✅ <b>Havola qabul qilindi</b> (<code>#${order.id}</code>)\n\n` +
    `⏳ Endi xaridor videoni tekshirib tasdiqlaydi — tasdiqlashi bilan pul hisobingizga o'tadi (24 soatdan keyin).`,
  ).catch(() => {});

  if (buyerTgId) {
    await phpBot.sendMessage(buyerTgId,
      `🎬 <b>Video ulandi!</b>\n\n` +
      `Sotuvchi <b>@${escapeHtml(order.adAccount.igUsername)}</b> videoni ulab, havolasini yubordi:\n` +
      `🔗 ${escapeHtml(igUrl)}\n\n` +
      `Instagram'da tekshirib ko'ring. Hammasi joyida bo'lsa — <b>tasdiqlang</b>.\n\n` +
      `Muammo bo'lsa ${SUPPORT_USERNAME} ga murojaat qiling.`,
      {
        replyMarkup: {
          inline_keyboard: [[
            { text: '✅ Tasdiqlayman', callback_data: `mkt:proof:approve:${order.id}` },
            { text: '❌ Muammo bor', callback_data: `mkt:proof:reject:${order.id}` },
          ]],
        },
      },
    ).catch((e: any) => console.warn('buyer verify request failed:', e?.message || e));
  }
}

const MAX_BUYER_RELAYS = 3;

async function relayBuyerLinkToSeller(order: any, igUrl: string, buyerTgId: number): Promise<void> {
  // Sotuvchini bir xil xabar bilan qayta-qayta bezovta qilmaymiz: xaridor
  // havolani takror yuborsa — faqat unga javob; tuzatilgan (boshqa) havola
  // esa ko'pi bilan MAX_BUYER_RELAYS marta yetkaziladi.
  const prev = await prisma.orderEvent.findMany({
    where: { orderId: order.id, type: 'buyer_link_relayed' },
    select: { payload: true },
  });
  if (prev.some((e) => (e.payload as any)?.url === igUrl)) {
    await phpBot.sendMessage(buyerTgId,
      `ℹ️ Bu havola sotuvchiga allaqachon yetkazilgan. ⏳ Sotuvchi collab'ni qabul qilishini kuting — shundan keyin sizdan tasdiq so'raymiz.`,
    ).catch(() => {});
    return;
  }
  if (prev.length >= MAX_BUYER_RELAYS) {
    await phpBot.sendMessage(buyerTgId,
      `ℹ️ Bu buyurtma uchun havola bir necha marta yuborildi. Agar havolani o'zgartirish kerak bo'lsa, ${SUPPORT_USERNAME} ga yozing.`,
    ).catch(() => {});
    return;
  }
  // Eslatma cron'i sotuvchiga qachondan beri navbat kelganini shu yozuvdan biladi.
  await prisma.orderEvent.create({
    data: { orderId: order.id, type: 'buyer_link_relayed', actorId: order.advertiserId, payload: { url: igUrl } },
  }).catch(() => {});
  const sellerTgId = Number(order.adAccount?.owner?.telegramId || 0);
  if (sellerTgId) {
    const res = await phpBot.sendMessage(sellerTgId,
      `🎬 <b>Xaridor videoni joyladi</b> (<code>#${order.id}</code>)\n\n` +
      `🔗 ${escapeHtml(igUrl)}\n\n` +
      `👉 <b>Endi navbat sizda:</b>\n` +
      `1️⃣ Instagram bildirishnomalaridan collab taklifini qabul qiling\n` +
      `2️⃣ Shu havolani <b>bu chatga yuboring</b> — xaridorga tasdiqlash uchun jo'natamiz`,
    ).catch(() => null);
    const failure = telegramFailure(res);
    if (isUnreachable(failure)) {
      // Havola sotuvchiga yetmaydi — buyurtma bekor qilinib, xaridorga xabar
      // handleSellerUnreachable ichida boradi; "yetkazildi" javobi yuborilmaydi.
      await handleSellerUnreachable(order.adAccount.ownerId, failure!.description);
      return;
    }
  }
  await phpBot.sendMessage(buyerTgId,
    `✅ <b>Rahmat, havolangiz sotuvchiga yetkazildi.</b>\n\n` +
    `⏳ Endi sotuvchi collab taklifingizni qabul qiladi — shundan keyin sizdan tasdiq so'raymiz.\n\n` +
    `Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`,
  ).catch(() => {});
}

// Sotuvchi "bu havola qaysi buyurtmaniki" savoliga javob berdi.
async function processSellerLinkChoice(
  callbackQueryId: string,
  orderId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
): Promise<void> {
  const pending = pendingSellerLinks.get(fromTgId);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingSellerLinks.delete(fromTgId);
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Havola eskirgan — iltimos, havolani qaytadan yuboring', showAlert: true }).catch(() => {});
    return;
  }
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: awaitingMaterialInclude });
  // Faqat shu buyurtmaning sotuvchisi yoki xaridori tanlay oladi.
  const isParty =
    !!order &&
    (Number(order.adAccount.owner?.telegramId || 0) === fromTgId || Number(order.advertiser?.telegramId || 0) === fromTgId);
  if (!order || order.status !== ('AWAITING_BUYER_MATERIAL' as any) || !isParty) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu buyurtma havola kutmayapti', showAlert: true }).catch(() => {});
    return;
  }
  pendingSellerLinks.delete(fromTgId);
  await phpBot.answerCallbackQuery(callbackQueryId, { text: '✅ Biriktirildi' }).catch(() => {});
  await phpBot.editMessageText(chatId, messageId,
    `🔗 Havola <code>#${orderId}</code> buyurtmaga biriktirildi.`,
    { replyMarkup: { inline_keyboard: [] } },
  ).catch(() => {});
  await routeLink(order, pending.url, fromTgId);
}

// Seller yangi order so'roviga javob beradi (qabul/rad).
async function processSellerConsent(
  callbackQueryId: string,
  action: string,
  orderId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { adAccount: { include: { owner: true } }, advertiser: true },
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Buyurtma topilmadi', showAlert: true }).catch(() => {});
    return;
  }
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;
  if (fromTgId !== sellerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu so\'rov sizga emas', showAlert: true }).catch(() => {});
    return;
  }
  if (order.status !== 'AWAITING_SELLER_CONSENT') {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu buyurtma allaqachon ishlangan', showAlert: true }).catch(() => {});
    return;
  }

  if (action === 'accept') {
    // Pul ENDI order YARATILGANDA muzlatiladi (handleCreateOrder, orders.ts) —
    // bu yerda faqat status o'zgaradi, qayta tekshirish/ushlash shart emas
    // (ilgari shu yerda qayta tekshirilardi, bu esa buyer bir xil balans bilan
    // bir nechta so'rov yuborishiga yo'l qo'yardi — 2026-09-23 tuzatildi).
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'AWAITING_BUYER_MATERIAL' as any,
          acceptedAt: new Date(),
          paymentApprovedAt: new Date(),
        },
      });
      await tx.orderEvent.create({
        data: { orderId, type: 'seller_accepted', actorId: order.adAccount.ownerId },
      });
    });

    await phpBot.editMessageText(chatId, messageId,
      `✅ <b>Buyurtma qabul qilindi</b>\n\n` +
      `Order <code>#${orderId}</code> — mijoz hisobidan to'lov muzlatildi.`,
    ).catch(() => {});
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '✅ Qabul qilindi' }).catch(() => {});

    // Xaridorga: qo'llanma video + "joylab, collab'ga qo'shing";
    // sotuvchiga: "collab'ni qabul qilib, havolani yuboring".
    const { notifyBuyerForMaterial } = await import('./marketplace/orders');
    notifyBuyerForMaterial(orderId).catch(() => {});
  } else if (action === 'reject') {
    // Pul order yaratilganda muzlatilgan edi — rad etilganda ALBATTA
    // buyer'ga qaytarilishi kerak (avval bu yerda wallet umuman
    // ishlatilmagan edi, chunki o'sha vaqtda pul hali ushlanmagan bo'lardi).
    // Order-update + refund + event bitta tranzaksiyada — birontasi
    // muvaffaqiyatsiz bo'lsa hammasi qaytariladi (avval orderEvent.create()
    // sukut bilan yutilardi (.catch(()=>{})), shuning uchun ba'zi bekor
    // qilingan orderlarda audit-iz umuman qolmagan edi — masalan #75).
    await prisma.$transaction(async (tx) => {
      const buyerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.advertiserId } });
      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: {
          balance: { increment: order.price },
          depositBalance: { increment: order.price }, // qaytgan pul yechib olinmaydi
          frozenBalance: { decrement: order.price },
          totalSpent: { decrement: order.price },
        },
      });
      await tx.transaction.create({
        data: {
          walletId: buyerWallet.id,
          type: 'ESCROW_REFUND',
          amount: order.price,
          status: 'COMPLETED',
          orderId,
          note: `Order #${orderId} — sotuvchi rad etdi, pul qaytarildi`,
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });
      await tx.orderEvent.create({
        data: { orderId, type: 'seller_rejected', actorId: order.adAccount.ownerId },
      });
    });
    await phpBot.editMessageText(chatId, messageId,
      `❌ <b>Buyurtma rad etildi</b>\n\nOrder <code>#${orderId}</code> bekor qilindi.`,
    ).catch(() => {});
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '❌ Rad etildi' }).catch(() => {});
    const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
    if (buyerTgId) {
      await phpBot.sendMessage(buyerTgId,
        `❌ <b>Sotuvchi buyurtmani rad etdi</b>\n\n` +
        `Order <code>#${orderId}</code> bekor qilindi. To'langan <b>${order.price.toLocaleString('uz-UZ')}</b> so'm hamyoningizga qaytarildi.`,
      ).catch(() => {});
    }
  }
}

// Buyer to'lov skrinshoti yubordi — adminga (insy bot orqali) yuboramiz.
async function processPaymentProofUpload(orderId: number, photoFileId: string, buyerTgId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } },
  });
  if (!order) return;
  if (order.status !== 'AWAITING_PAYMENT') {
    await phpBot.sendMessage(buyerTgId,
      `⚠️ Bu buyurtma to'lov kutish holatida emas (hozirgi status: <code>${order.status}</code>).`,
    ).catch(() => {});
    return;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentProofFileId: photoFileId,
      status: 'AWAITING_PAYMENT_APPROVAL',
    },
  });
  await prisma.orderEvent.create({
    data: { orderId, type: 'payment_proof_uploaded', actorId: order.advertiserId, payload: { fileId: photoFileId } },
  }).catch(() => {});

  // Buyer'ga tasdiq
  await phpBot.sendMessage(buyerTgId,
    `✅ <b>Skrinshot qabul qilindi</b>\n\n` +
    `Admin tekshirib tasdiqlagach, sotuvchi videoni joylaydi. Sizga xabar boradi.`,
  ).catch(() => {});

  // Admin'larga insy bot orqali skrinshot + ✅/❌ tugmalar yuboramiz.
  // MUHIM: file_id TopSxema bot tomonidan saqlangan, insy bot uni tan olmaydi.
  // Shu sababli TopSxema bot orqali getFile qilib URL hosil qilamiz, va shu
  // URL'ni insy bot'ga sendPhoto qilamiz (Telegram URL'ni o'zi yuklab oladi).
  const buyerName = order.advertiser.username
    ? `@${order.advertiser.username}`
    : (order.advertiser.firstName || `id:${order.advertiserId}`);
  const caption =
    `💸 <b>To'lov skrinshoti tasdiqlash kerak</b>\n\n` +
    `🛍 Mijoz: ${buyerName}\n` +
    `📲 Akkaunt: <b>@${order.adAccount.igUsername}</b>\n` +
    `🎯 Maqsad: <b>@${order.targetIgUsername || '—'}</b>\n` +
    `💰 Summa: <code>${fmtUZS(order.price)}</code> so'm\n` +
    `🆔 Order: <code>#${orderId}</code>`;
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ To\'lov tasdiqlandi', callback_data: `mkt:admin:pay:approve:${orderId}` },
        { text: '❌ Rad etish', callback_data: `mkt:admin:pay:reject:${orderId}` },
      ],
    ],
  };

  // 1) File'ni TopSxema bot orqali yuklab olamiz va Buffer'ga aylantiramiz.
  //    file_id bot-specific, URL ham boshqa bot uchun ochilmaydi (HTTP 401).
  //    Shu sababli file'ni o'zimiz download qilamiz va insy bot orqali
  //    InputFile sifatida yuboramiz (kafolatlangan).
  const sellerToken = process.env.WEBAPP_BOT_TOKEN || '';
  let photoBuffer: Buffer | null = null;
  if (sellerToken) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${sellerToken}/getFile?file_id=${encodeURIComponent(photoFileId)}`);
      const j = await r.json() as { ok: boolean; result?: { file_path: string }; description?: string };
      if (j.ok && j.result?.file_path) {
        const fileUrl = `https://api.telegram.org/file/bot${sellerToken}/${j.result.file_path}`;
        const fileRes = await fetch(fileUrl);
        if (fileRes.ok) {
          const ab = await fileRes.arrayBuffer();
          photoBuffer = Buffer.from(ab);
        } else {
          console.warn('admin pay proof file download failed:', fileRes.status);
        }
      } else {
        console.warn('admin pay proof getFile failed:', j.description);
      }
    } catch (e) {
      console.warn('admin pay proof file fetch failed:', e instanceof Error ? e.message : e);
    }
  }

  // 2) Insy bot orqali admin'larga Buffer bilan yuboramiz.
  try {
    const { getBot } = await import('../bot');
    const bot = getBot();
    if (!bot) return;
    for (const adminId of ADMIN_IDS) {
      if (photoBuffer) {
        try {
          await bot.sendPhoto(
            adminId,
            photoBuffer,
            { caption, parse_mode: 'HTML', reply_markup: replyMarkup },
            { filename: `pay-proof-${orderId}.jpg`, contentType: 'image/jpeg' },
          );
          continue;
        } catch (e: any) {
          console.warn('admin pay proof Buffer send failed:', e?.message || e);
        }
      }
      // Fallback: photo'siz oddiy xabar
      await bot.sendMessage(adminId,
        `${caption}\n\n<i>⚠️ Skrinshot rasm sifatida yuborilmadi — Top_sxema chatida ko'ring.</i>`,
        { parse_mode: 'HTML', reply_markup: replyMarkup },
      ).catch((e: any) => console.warn('admin pay proof text fallback failed:', e?.message || e));
    }
  } catch (e) {
    console.warn('admin pay proof error:', e instanceof Error ? e.message : e);
  }
}

// Buyer yangi orderdan voz kechdi (to'lovgacha)
async function processBuyerCancel(
  callbackQueryId: string,
  orderId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } },
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Buyurtma topilmadi', showAlert: true }).catch(() => {});
    return;
  }
  const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
  if (fromTgId !== buyerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu sizning buyurtmangiz emas', showAlert: true }).catch(() => {});
    return;
  }
  // AWAITING_BUYER_MATERIAL — xaridor hali havola yubormagan bo'lsa, 1 soatlik
  // oxirgi eslatmadagi "Bekor qilish" tugmasi orqali (pul shu paytda muzlab turadi).
  const CANCELLABLE = ['AWAITING_SELLER_CONSENT', 'AWAITING_PAYMENT', 'AWAITING_BUYER_MATERIAL'];
  if (!CANCELLABLE.includes(order.status)) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu bosqichda bekor qilib bo\'lmaydi', showAlert: true }).catch(() => {});
    return;
  }
  // Pul order yaratilganda muzlatiladi — AWAITING_SELLER_CONSENT va
  // AWAITING_BUYER_MATERIAL'da bekor qilinsa xaridorga qaytariladi.
  // MUHIM: holat shart bilan (updateMany + eski status) almashtiriladi va
  // pul FAQAT shu almashtirish muvaffaqiyatli bo'lsa qaytadi — tugma bir
  // vaqtda ikki marta bosilsa ham pul ikki marta qaytmaydi.
  const cancelled = await prisma.$transaction(async (tx) => {
    const flip = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: 'CANCELLED' },
    });
    if (flip.count !== 1) return false;
    if (order.status === 'AWAITING_SELLER_CONSENT' || order.status === 'AWAITING_BUYER_MATERIAL') {
      const buyerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.advertiserId } });
      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: {
          balance: { increment: order.price },
          depositBalance: { increment: order.price }, // qaytgan pul yechib olinmaydi
          frozenBalance: { decrement: order.price },
          totalSpent: { decrement: order.price },
        },
      });
      await tx.transaction.create({
        data: {
          walletId: buyerWallet.id,
          type: 'ESCROW_REFUND',
          amount: order.price,
          status: 'COMPLETED',
          orderId,
          note: `Order #${orderId} — mijoz bekor qildi, pul qaytarildi`,
        },
      });
    }
    await tx.orderEvent.create({
      data: { orderId, type: 'buyer_cancelled', actorId: order.advertiserId },
    });
    return true;
  });
  if (!cancelled) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu buyurtma allaqachon o'zgargan", showAlert: true }).catch(() => {});
    return;
  }
  await phpBot.editMessageText(chatId, messageId,
    `❌ <b>Buyurtma bekor qilindi</b> (<code>#${orderId}</code>)` +
    (order.status === 'AWAITING_PAYMENT' ? '' : `\n\n💰 ${fmtUZS(order.price)} so'm hamyoningizga qaytarildi.`),
  ).catch(() => {});
  await phpBot.answerCallbackQuery(callbackQueryId, { text: '❌ Bekor qilindi' }).catch(() => {});
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;
  if (sellerTgId) {
    await phpBot.sendMessage(sellerTgId,
      `❌ Mijoz <code>#${orderId}</code> buyurtmasini bekor qildi.`,
    ).catch(() => {});
  }
}

// Seller IG'da collab'ni qabul qilib bot'da tasdiqladi (yoki rad etdi).
// approve: status → BUYER_VERIFIED + releaseAt+24h (release-cron pulni o'tkazadi)
// reject: status → DISPUTED, admin ko'rib chiqadi
async function processSellerCollabConfirmation(
  callbackQueryId: string,
  action: string,
  orderId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } },
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Buyurtma topilmadi', showAlert: true }).catch(() => {});
    return;
  }
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;
  if (fromTgId !== sellerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu sizning buyurtmangiz emas', showAlert: true }).catch(() => {});
    return;
  }
  if (order.status !== 'AWAITING_BUYER_VERIFY') {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: `Allaqachon ishlangan (${order.status})`, showAlert: true }).catch(() => {});
    return;
  }
  const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;

  if (action === 'approve') {
    const releaseAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'BUYER_VERIFIED', verifiedAt: new Date(), releaseAt },
    });
    await prisma.orderEvent.create({
      data: { orderId, type: 'collab_confirmed', actorId: order.adAccount.ownerId },
    }).catch(() => {});

    // Seller xabaridagi tugmalarni olib tashlash + tasdiq matni
    await phpBot.editMessageText(chatId, messageId,
      `✅ <b>Collab tasdiqlandi</b>\n\n` +
      `Order <code>#${orderId}</code>. Pul <b>24 soatdan keyin</b> wallet'ingizga +${fmtUZS(order.escrowAmount)} so'm tushadi.`,
      { replyMarkup: { inline_keyboard: [] } },
    ).catch(async () => {
      // Fallback: editMessageReplyMarkup yo'q bo'lsa, yangi xabar
      await phpBot.sendMessage(chatId,
        `✅ <b>Collab tasdiqlandi</b>\n\n24 soat ichida +${fmtUZS(order.escrowAmount)} so'm tushadi.`,
      ).catch(() => {});
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '✅ Tasdiqlandi' }).catch(() => {});

    // Buyer'ga xabar
    if (buyerTgId) {
      await phpBot.sendMessage(buyerTgId,
        `🎉 <b>Sotuvchi collab'ni tasdiqladi!</b>\n\n` +
        `Order <code>#${orderId}</code> muvaffaqiyatli yakunlandi.\n` +
        `Sotuvchi to'lovni 24 soatdan keyin oladi.`,
      ).catch(() => {});
    }
  } else if (action === 'reject') {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'DISPUTED' as any },
    }).catch(() => {});
    await prisma.orderEvent.create({
      data: { orderId, type: 'collab_rejected', actorId: order.adAccount.ownerId },
    }).catch(() => {});
    await phpBot.editMessageText(chatId, messageId,
      `❌ <b>Rad etildi</b>\n\nOrder <code>#${orderId}</code> tortishuvga jo'natildi. Admin ko'rib chiqadi.`,
      { replyMarkup: { inline_keyboard: [] } },
    ).catch(() => {});
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '❌ Tortishuvga' }).catch(() => {});

    if (buyerTgId) {
      await phpBot.sendMessage(buyerTgId,
        `⚠️ <b>Sotuvchi collab'ni rad etdi</b>\n\n` +
        `Order <code>#${orderId}</code> tortishuv (dispute) holatida. Admin ko'rib chiqadi.`,
      ).catch(() => {});
    }
    // Adminlarga xabar
    try {
      const { getBot } = await import('../bot');
      const adminBot = getBot();
      if (adminBot) {
        for (const adminId of ADMIN_IDS) {
          adminBot.sendMessage(adminId, `⚠️ Order #${orderId} seller tomonidan collab rad etildi (DISPUTE).`)
            .catch(() => {});
        }
      }
    } catch {}
  }
}

// Seller skrinshot yukladi — buyer'ga yuborib tasdiqlash so'rovi (ESKI oqim — endi
// foydalanilmaydi, lekin saqlaymiz xavfsizlik uchun).
async function processPostProofUpload(orderId: number, photoFileId: string, sellerTgId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: true },
  });
  if (!order || !order.advertiser) return;
  // Faqat PAYMENT_APPROVED holatda seller post skrinshot yubora oladi
  if (!['PAYMENT_APPROVED', 'PAID', 'ACCEPTED'].includes(order.status)) {
    await phpBot.sendMessage(sellerTgId,
      `⚠️ Bu buyurtma post yuklash holatida emas (status: <code>${order.status}</code>).`,
    ).catch(() => {});
    return;
  }
  const buyerTgId = order.advertiser.telegramId ? Number(order.advertiser.telegramId) : null;
  if (!buyerTgId) return;

  // DB ga proof saqlash — yangi cycle: AWAITING_BUYER_VERIFY
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'AWAITING_BUYER_VERIFY',
      postedAt: new Date(),
      postProofFileId: photoFileId,
      guaranteeProof: photoFileId,
    },
  });
  await prisma.orderEvent.create({
    data: { orderId, type: 'posted', actorId: order.adAccount.ownerId, payload: { fileId: photoFileId } },
  }).catch(() => {});

  // Sellerga tasdiq
  await phpBot.sendMessage(sellerTgId,
    `✅ <b>Skrinshot qabul qilindi!</b>\n\n` +
    `Buyurtmachi ko'rib chiqib tasdiqlashini kuting. Tasdiqlangach pul wallet'ingizga o'tadi.`,
  ).catch(() => {});

  // Buyer'ga skrinshot + tasdiqlash tugmalari
  await phpBot.sendPhoto(buyerTgId, photoFileId, {
    caption:
      `📸 <b>Post chiqarildi</b>\n\n` +
      `Order: <code>#${orderId}</code>\n` +
      `Sotuvchi post skrinshotini yubordi.\n\n` +
      `<i>Skrinshotni ko'rib chiqing va tasdiqlang yoki rad eting.</i>`,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '✅ Tasdiqlayman', callback_data: `mkt:proof:approve:${orderId}` },
          { text: '❌ Rad etaman', callback_data: `mkt:proof:reject:${orderId}` },
        ],
      ],
    },
  }).catch((e) => console.warn('proof photo to buyer failed:', e?.message || e));
}

// Buyer tasdiqladi yoki rad etdi
async function processProofVerification(
  callbackQueryId: string,
  action: string,
  orderId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } },
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Buyurtma topilmadi', showAlert: true }).catch(() => {});
    return;
  }
  // Faqat buyer qaror qila oladi
  const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
  if (fromTgId !== buyerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu sizning buyurtmangiz emas', showAlert: true }).catch(() => {});
    return;
  }
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;

  // Ikki marta bosish yoki tortishuvdan keyin qayta bosishdan himoya.
  if (order.status !== 'AWAITING_BUYER_VERIFY') {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu buyurtma allaqachon ko'rib chiqilgan", showAlert: true }).catch(() => {});
    return;
  }

  // Tasdiq so'rovi eski oqimda RASM (caption), yangisida MATN xabar. Relay
  // xatoni throw qilmaydi (HTTP 200 + result.ok=false), shuning uchun natijani
  // tekshirib, keyingi usulga o'tamiz — aks holda tugmalar o'chmay qolardi.
  const replaceDecisionMessage = async (text: string) => {
    const noButtons = { replyMarkup: { inline_keyboard: [] } };
    const r1: any = await phpBot.editMessageCaption(chatId, messageId, text, noButtons).catch(() => null);
    if (r1?.result?.ok) return;
    const r2: any = await phpBot.editMessageText(chatId, messageId, text, noButtons).catch(() => null);
    if (!r2?.result?.ok) await phpBot.sendMessage(chatId, text).catch(() => {});
  };

  if (action === 'approve') {
    // BUYER_VERIFIED + releaseAt: now + 24h. Pul cron orqali tushadi.
    const releaseAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'BUYER_VERIFIED', verifiedAt: new Date(), releaseAt },
    });
    await prisma.orderEvent.create({
      data: { orderId, type: 'buyer_verified', actorId: order.advertiser.id },
    }).catch(() => {});
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '✅ Tasdiqlandi' }).catch(() => {});
    await replaceDecisionMessage(
      `✅ <b>Tasdiqlandi</b>\n\n` +
      `Buyurtma <code>#${orderId}</code>. Rahmat! Pul sotuvchining hisobiga <b>24 soatdan keyin</b> tushadi.`,
    );
    // Sellerga
    if (sellerTgId) {
      await phpBot.sendMessage(sellerTgId,
        `🎉 <b>Buyurtmachi tasdiqladi!</b>\n\n` +
          `Order <code>#${orderId}</code>.\n` +
          `💰 24 soat ichida wallet'ingizga +${fmtUZS(order.escrowAmount)} so'm tushadi.`,
      ).catch((e: any) => console.warn('seller notify failed:', e?.message || e));
    }
  } else if (action === 'reject') {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'DISPUTED' as any },
    }).catch(() => {});
    await replaceDecisionMessage(
      `❌ <b>Muammo qayd etildi</b>\n\n` +
      `Buyurtma <code>#${orderId}</code> admin ko'rib chiqishiga yuborildi. Pulingiz saqlanib turibdi.\n\n` +
      `Muammo bo'lsa ${SUPPORT_USERNAME} ga murojaat qiling.`,
    );
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '❌ Admin ko\'rib chiqadi' }).catch(() => {});
    if (sellerTgId) {
      await phpBot.sendMessage(sellerTgId,
        `⚠️ <b>Xaridor natijani qabul qilmadi</b>\n\n` +
          `Buyurtma <code>#${orderId}</code> tortishuv holatida — admin ko'rib chiqadi.`,
      ).catch(() => {});
    }
    // Adminlarga xabar
    try {
      const { getBot } = await import('../bot');
      const bot = getBot();
      if (bot) {
        for (const adminId of ADMIN_IDS) {
          bot.sendMessage(adminId,
            `⚠️ Buyurtma #${orderId} xaridor tomonidan rad etildi (DISPUTE).\n` +
              `Akkaunt: @${order.adAccount.igUsername}\nHavola: ${order.materialFileId || '—'}`,
          ).catch(() => {});
        }
      }
    } catch {}
  }
}

async function processOwnerConsent(
  callbackQueryId: string,
  action: string,
  accountId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
): Promise<void> {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Akkaunt topilmadi', showAlert: true }).catch(() => {});
    return;
  }
  const owner = await prisma.user.findUnique({
    where: { id: account.ownerId },
    select: { telegramId: true },
  });
  const ownerTgId = owner?.telegramId ? Number(owner.telegramId) : null;
  if (!ownerTgId || ownerTgId !== fromTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu so\'rov sizga emas', showAlert: true }).catch(() => {});
    return;
  }

  if (action === 'agree') {
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: 'ACTIVE', isVerified: true, frozenUntil: null },
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `✅ <b>Rozilik qabul qilindi</b>\n\n` +
        `👤 @${escapeHtml(account.igUsername)}\n` +
        `💰 ${fmtUZS(updated.priceFeed)} so'm\n\n` +
        `<i>Akkauntingiz marketplace'da faol holatda.</i>`,
    ).catch(() => {});
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '✅ Tasdiqlandi' }).catch(() => {});
    // Akkaunt TO'LIQ tasdiqlanib marketplace'da ko'ringanda — egasiga
    // qo'llanma videosi (Top_sxema bot orqali). MUHIM: bu haqiqiy production
    // yo'li — bot-marketplace.ts'dagi shu nomdagi handler ENABLE_SELLER_BOT
    // yoqilmagani uchun HECH QACHON ishga tushmaydi (owner rozilik so'rovi
    // har doim phpBot/bot.php orqali yuboriladi, shu sabab callback ham shu
    // yerga — /api/bot-forward'ga — qaytadi, admin botning o'ziga emas).
    // Sotuvchi qo'llanmasi FAQAT SHU YERDA, bir marta yuboriladi. Avval narx
    // tasdiqlanganda (kodlarphp/470) va shu yerda yana 2 ta (eski 451 nusxa +
    // 471) ketardi — uchalasi ham aynan bir video (file_unique_id bir xil),
    // sotuvchi uni ketma-ket 3 marta olardi (mijoz shikoyati, 2026-10-04).
    phpBot.sendVideo(ownerTgId, SELLER_SETTINGS_VIDEO, {
      caption:
        `📖 <b>Qo'llanma video — albatta ko'ring!</b>\n\n` +
        `Akkauntingiz marketplace'ga qo'yildi. Videoda ikkita muhim narsa ko'rsatilgan:\n` +
        `1️⃣ Akkauntni marketplace'da qanday boshqarish\n` +
        `2️⃣ Instagram'da qaysi <b>sozlamalarni yoqish</b> kerakligi — ularsiz xaridorlarning collab so'rovlari sizga kelmaydi va buyurtma bajarilmaydi.\n\n` +
        `Muammo bo'lsa ${SUPPORT_USERNAME} ga murojaat qiling.`,
    }).catch(() => {});
    // Adminlarga insaybbot (asosiy bot) orqali xabar
    try {
      const { getBot } = await import('../bot');
      const bot = getBot();
      if (bot) {
        for (const adminId of ADMIN_IDS) {
          bot.sendMessage(
            adminId,
            `✅ Egasi rozilik berdi: @${account.igUsername} (#${accountId}) → ACTIVE`,
            { parse_mode: 'HTML' },
          ).catch(() => {});
        }
      }
    } catch {}
  } else if (action === 'cancel') {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: 'PENDING', isVerified: false, priceFeed: 0, priceReels: 0, priceStory: 0 },
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `❌ <b>Bekor qilindi</b>\n\n` +
        `👤 @${escapeHtml(account.igUsername)}\n\n` +
        `<i>Admin yana ko'rib chiqadi va yangi narx taklif qilishi mumkin.</i>`,
    ).catch(() => {});
    await phpBot.answerCallbackQuery(callbackQueryId, { text: '❌ Bekor qilindi' }).catch(() => {});
    try {
      const { getBot } = await import('../bot');
      const bot = getBot();
      if (bot) {
        for (const adminId of ADMIN_IDS) {
          bot.sendMessage(
            adminId,
            `❌ Egasi narxni rad etdi: @${account.igUsername} (#${accountId}) → PENDING (yangi ko'rib chiqish kerak)`,
            { parse_mode: 'HTML' },
          ).catch(() => {});
        }
      }
    } catch {}
  } else {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Noma\'lum amal' }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPUP — wallet to'ldirish skrinshoti va admin callbacklari
// ─────────────────────────────────────────────────────────────────────────────

async function processTopupScreenshot(topup: any, fileId: string, fromTgId: number) {
  try {
    await prisma.topup.update({
      where: { id: topup.id },
      data: { screenshotFileId: fileId, status: 'AWAITING_REVIEW' as any },
    });
    await phpBot.sendMessage(fromTgId,
      `✅ <b>Chek qabul qilindi</b>\n\n` +
      `So\'rov #${topup.id} adminga yuborildi. Admin tasdiqlasa balansingiz <b>${topup.amount.toLocaleString('uz-UZ')}</b> so\'mga ko\'payadi.`,
    ).catch(() => {});

    const { getBot } = await import('../bot');
    const adminBot = getBot();
    if (!adminBot) return;

    // Top_sxema bot file_id'sini admin bot orqali yuborish uchun: yuklab → qaytadan upload
    const TOP_SXEMA_TOKEN = process.env.WEBAPP_BOT_TOKEN || '';
    let photoBuffer: Buffer | null = null;
    if (TOP_SXEMA_TOKEN) {
      try {
        const fileRes = await fetch(`https://api.telegram.org/bot${TOP_SXEMA_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
        const fileJson: any = await fileRes.json();
        const filePath = fileJson?.result?.file_path;
        if (filePath) {
          const dl = await fetch(`https://api.telegram.org/file/bot${TOP_SXEMA_TOKEN}/${filePath}`);
          const arr = new Uint8Array(await dl.arrayBuffer());
          photoBuffer = Buffer.from(arr);
        }
      } catch (e) {
        console.warn('topup download failed:', e instanceof Error ? e.message : e);
      }
    }

    const caption =
      `💳 <b>Yangi hisob to\'ldirish so\'rovi</b>\n\n` +
      `🆔 So\'rov: <code>#${topup.id}</code>\n` +
      `👤 User ID: <code>${topup.user?.id}</code>\n` +
      `📱 TG: <code>${fromTgId}</code>\n` +
      `💰 Summa: <code>${topup.amount.toLocaleString('uz-UZ')}</code> so\'m\n\n` +
      `Chekni tekshiring va tasdiqlang/rad eting.`;
    const kb = {
      inline_keyboard: [
        [
          { text: '✅ Tasdiqlash', callback_data: `mkt:topup:approve:${topup.id}` },
          { text: '❌ Rad etish', callback_data: `mkt:topup:reject:${topup.id}` },
        ],
      ],
    };

    for (const adminId of ADMIN_IDS) {
      try {
        let sent: any;
        if (photoBuffer) {
          sent = await adminBot.sendPhoto(adminId, photoBuffer, {
            caption,
            parse_mode: 'HTML',
            reply_markup: kb,
          } as any, { filename: 'topup.jpg', contentType: 'image/jpeg' });
        } else {
          sent = await adminBot.sendMessage(adminId, caption, { parse_mode: 'HTML', reply_markup: kb });
        }
        const messageId = sent?.message_id;
        if (messageId) {
          await prisma.topup.update({
            where: { id: topup.id },
            data: { adminTgChatId: String(adminId), adminTgMessageId: messageId },
          }).catch(() => {});
        }
        break;
      } catch (e) {
        console.warn('topup admin send failed for', adminId, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error('processTopupScreenshot fatal:', e);
  }
}

async function processTopupCallback(
  callbackQueryId: string,
  action: string,
  topupId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
) {
  const topup = await prisma.topup.findUnique({ where: { id: topupId }, include: { user: true } });
  if (!topup) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'So\'rov topilmadi', showAlert: true }).catch(() => {});
    return;
  }

  // CANCEL — userning o'zi bekor qilyapti
  if (action === 'cancel') {
    if (Number(topup.user?.telegramId) !== fromTgId) {
      await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Faqat egasi bekor qila oladi', showAlert: true }).catch(() => {});
      return;
    }
    if (topup.status !== 'PENDING') {
      await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Allaqachon ishlangan', showAlert: true }).catch(() => {});
      return;
    }
    await prisma.topup.update({ where: { id: topupId }, data: { status: 'CANCELLED' as any } });
    await phpBot.editMessageText(chatId, messageId,
      `🚫 <b>So\'rov #${topupId} bekor qilindi</b>`,
      { replyMarkup: { inline_keyboard: [] } },
    ).catch(() => {});
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bekor qilindi' }).catch(() => {});
    return;
  }

  // APPROVE / REJECT — faqat admin (admin bot orqali)
  if (!ADMIN_IDS.includes(fromTgId)) {
    const { getBot } = await import('../bot');
    const adminBot = getBot();
    if (adminBot) {
      await adminBot.answerCallbackQuery(callbackQueryId, { text: '⛔ Faqat admin', show_alert: true } as any).catch(() => {});
    }
    return;
  }

  const { getBot } = await import('../bot');
  const adminBot = getBot();
  if (!adminBot) return;

  if (topup.status !== 'AWAITING_REVIEW' && topup.status !== 'PENDING') {
    await adminBot.answerCallbackQuery(callbackQueryId, { text: `Allaqachon: ${topup.status}`, show_alert: true } as any).catch(() => {});
    return;
  }

  const buyerTgId = topup.user?.telegramId ? Number(topup.user.telegramId) : 0;

  if (action === 'approve') {
    await prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId: topup.userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({ data: { userId: topup.userId } });
      }
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: topup.amount }, depositBalance: { increment: topup.amount } },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEPOSIT',
          amount: topup.amount,
          status: 'COMPLETED',
          note: `Topup #${topup.id} tasdiqlandi (admin: ${fromTgId})`,
        },
      });
      await tx.topup.update({
        where: { id: topup.id },
        data: { status: 'APPROVED' as any, reviewedAt: new Date() },
      });
    });

    try {
      await adminBot.editMessageCaption(
        `✅ TASDIQLANDI · #${topup.id} · +${topup.amount.toLocaleString('uz-UZ')} so\'m balansga qo\'shildi`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } } as any,
      );
    } catch {
      try {
        await adminBot.editMessageText(
          `✅ TASDIQLANDI · #${topup.id} · +${topup.amount.toLocaleString('uz-UZ')} so\'m`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } } as any,
        );
      } catch {}
    }
    await adminBot.answerCallbackQuery(callbackQueryId, { text: '✅ Tasdiqlandi' } as any).catch(() => {});

    if (buyerTgId) {
      await phpBot.sendMessage(buyerTgId,
        `✅ <b>To\'lov tasdiqlandi!</b>\n\nSo\'rov #${topup.id} · <b>+${topup.amount.toLocaleString('uz-UZ')}</b> so\'m balansingizga qo\'shildi.\n\nEndi WebApp\'ga qaytib buyurtma berishingiz mumkin.`,
      ).catch(() => {});
    }
  } else if (action === 'reject') {
    await prisma.topup.update({
      where: { id: topup.id },
      data: { status: 'REJECTED' as any, reviewedAt: new Date(), rejectReason: 'Admin rad etdi' },
    });

    // Admin yuborgan xabarini O'CHIRAMIZ
    try {
      await adminBot.deleteMessage(chatId, messageId);
    } catch {}

    await adminBot.answerCallbackQuery(callbackQueryId, { text: '❌ Rad etildi va o\'chirildi' } as any).catch(() => {});

    if (buyerTgId) {
      await phpBot.sendMessage(buyerTgId,
        `❌ <b>To\'lov tasdiqlanmadi</b>\n\nSo\'rov #${topup.id} · <b>${topup.amount.toLocaleString('uz-UZ')}</b> so\'m — admin rad etdi.\n\n<i>Iltimos, to\'lovni qaytadan amalga oshiring yoki admin bilan bog\'laning.</i>`,
      ).catch(() => {});
    }
  }
}

// Owner "✍️ Javob yozish" tugmasini bosdi → keyingi matn xabarini ushlaymiz.
async function processOwnerChatReplyStart(
  callbackQueryId: string,
  accountId: number,
  chatId: number,
  messageId: number,
  fromTgId: number,
) {
  const account = await prisma.adAccount.findUnique({
    where: { id: accountId },
    include: { owner: true },
  });
  if (!account || Number(account.owner?.telegramId) !== fromTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Sizniki emas', showAlert: true }).catch(() => {});
    return;
  }
  if (account.owner?.blockedFromAdminChat) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Bu funksiyadan foydalanish sizga bloklangan', showAlert: true }).catch(() => {});
    return;
  }
  // Javob ANIQ shu akkaunt bo'yicha OXIRGI yozgan admin'ga qaytishi kerak —
  // avval bu doim ADMIN_IDS[0]ga (ro'yxatdagi birinchi admin) hardcode
  // qilingan edi, qaysi admin aslida yozganidan qat'i nazar — bir nechta
  // admin bo'lganda javob noto'g'ri odamga ketardi.
  const { getLastChatAdmin, setAwaitingOwnerReply } = await import('../lib/account-submissions');
  const adminChatId = getLastChatAdmin(accountId) ?? ADMIN_IDS[0];
  if (!adminChatId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: 'Admin sozlanmagan', showAlert: true }).catch(() => {});
    return;
  }
  setAwaitingOwnerReply(fromTgId, accountId, adminChatId);
  await phpBot.sendMessage(fromTgId,
    `✍️ <b>Javobingizni shu chatga matn sifatida yuboring.</b>\n\n` +
    `<i>10 daqiqa ichida. Bekor qilish: keyingi xabar /cancel.</i>`,
  ).catch(() => {});
  await phpBot.answerCallbackQuery(callbackQueryId, { text: '✍️ Matn yozing' }).catch(() => {});
}
