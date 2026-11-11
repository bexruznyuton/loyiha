import { p as prisma, c as getTagTargetUsername, d as getRewardTiers, e as formatRewardTiers, s as setTagTargetUsername, h as parseRewardTiersInput, i as setRewardTiers, w as writeWeeklyHashtag, j as getAwaitingPrice, k as getSubmission, l as clearAwaitingPrice, m as buildAccountCaption, n as buildAccountButtons, a as phpBot, g as getSellerBot, o as createNotification, q as setAwaitingPrice, r as getAllSubmissionsForAccount, t as deleteAllSubmissionsForAccount, u as refundEscrow, v as releaseEscrow } from "./node-build.mjs";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => parseInt(id.trim())).filter((n) => !isNaN(n) && n > 0);
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const awaitingUpload = /* @__PURE__ */ new Map();
const UPLOAD_WINDOW_MS = 5 * 60 * 1e3;
setInterval(() => {
  const now = Date.now();
  for (const [chatId, expiresAt] of awaitingUpload.entries()) {
    if (expiresAt < now) awaitingUpload.delete(chatId);
  }
}, 2 * 60 * 1e3);
const broadcastFlow = /* @__PURE__ */ new Map();
const BROADCAST_WINDOW_MS = 5 * 60 * 1e3;
setInterval(() => {
  const now = Date.now();
  for (const [chatId, flow] of broadcastFlow.entries()) {
    if (flow.expiresAt < now) broadcastFlow.delete(chatId);
  }
}, 2 * 60 * 1e3);
function extractBroadcastContent(msg) {
  if (msg.photo && msg.photo.length > 0) {
    return { kind: "photo", fileId: msg.photo[msg.photo.length - 1].file_id, caption: escapeHtml(msg.caption || "") };
  }
  if (msg.video) {
    return { kind: "video", fileId: msg.video.file_id, caption: escapeHtml(msg.caption || "") };
  }
  if (msg.document) {
    return { kind: "document", fileId: msg.document.file_id, caption: escapeHtml(msg.caption || "") };
  }
  if (msg.animation) {
    return { kind: "animation", fileId: msg.animation.file_id, caption: escapeHtml(msg.caption || "") };
  }
  if (msg.text) {
    return { kind: "text", text: escapeHtml(msg.text) };
  }
  return null;
}
function toPublicFileUrl(fileId) {
  if (!WEBAPP_URL) return null;
  try {
    const base = new URL(WEBAPP_URL).origin;
    return `${base}/api/files/${encodeURIComponent(fileId)}`;
  } catch {
    return null;
  }
}
async function getActiveSellerTgIds() {
  const owners = await prisma.adAccount.findMany({
    where: { status: "ACTIVE" },
    select: { owner: { select: { telegramId: true } } },
    distinct: ["ownerId"]
  });
  return Array.from(new Set(owners.map((o) => Number(o.owner.telegramId)).filter((id) => id > 0)));
}
async function broadcastToActiveSellers(adminBot, adminChatId, content, replyMarkup) {
  const tgIds = await getActiveSellerTgIds();
  if (tgIds.length === 0) {
    await adminBot.sendMessage(adminChatId, "Hozircha tasdiqlangan (ACTIVE) akkaunt egasi yo'q.").catch(() => {
    });
    return;
  }
  await adminBot.sendMessage(adminChatId, `⏳ ${tgIds.length} ta sotuvchiga yuborilmoqda...`).catch(() => {
  });
  const usePhp = phpBot.isReady();
  const sb = usePhp ? null : getSellerBot() || adminBot;
  const crossBot = usePhp || !!sb && sb !== adminBot;
  let mediaSource = null;
  if (content.kind !== "text") {
    mediaSource = crossBot ? toPublicFileUrl(content.fileId) : content.fileId;
    if (crossBot && !mediaSource) {
      await adminBot.sendMessage(
        adminChatId,
        "❌ WEBAPP_URL sozlanmagan — media faylni Top_sxema botga proksilab bo'lmadi. Faqat matn yuborishingiz mumkin."
      ).catch(() => {
      });
      return;
    }
  }
  let ok = 0;
  let fail = 0;
  for (const tgId of tgIds) {
    try {
      if (content.kind === "text") {
        if (usePhp) await phpBot.sendMessage(tgId, content.text, { replyMarkup: replyMarkup || void 0 });
        else await sb.sendMessage(tgId, content.text, { parse_mode: "HTML", reply_markup: replyMarkup || void 0 });
      } else if (usePhp) {
        const opts = { caption: content.caption, replyMarkup: replyMarkup || void 0 };
        if (content.kind === "photo") await phpBot.sendPhoto(tgId, mediaSource, opts);
        else if (content.kind === "video") await phpBot.sendVideo(tgId, mediaSource, opts);
        else if (content.kind === "document") await phpBot.sendDocument(tgId, mediaSource, opts);
        else await phpBot.sendAnimation(tgId, mediaSource, opts);
      } else {
        const sendOpts = { caption: content.caption, parse_mode: "HTML", reply_markup: replyMarkup || void 0 };
        if (content.kind === "photo") await sb.sendPhoto(tgId, mediaSource, sendOpts);
        else if (content.kind === "video") await sb.sendVideo(tgId, mediaSource, sendOpts);
        else if (content.kind === "document") await sb.sendDocument(tgId, mediaSource, sendOpts);
        else await sb.sendAnimation(tgId, mediaSource, sendOpts);
      }
      ok++;
    } catch {
      fail++;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  await adminBot.sendMessage(
    adminChatId,
    `✅ <b>Xabar yuborish yakunlandi</b>

✔️ Muvaffaqiyatli: <b>${ok}</b>
❌ Xato: <b>${fail}</b>`,
    { parse_mode: "HTML" }
  ).catch(() => {
  });
}
function isAdminChat(chatId) {
  return ADMIN_IDS.includes(chatId);
}
async function isAdminUserId(telegramId) {
  if (isAdminChat(telegramId)) return true;
  try {
    const u = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      select: { role: true }
    });
    return u?.role === "ADMIN";
  } catch {
    return false;
  }
}
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtNumber(n) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}
function accountAdminCard(acc) {
  const frozen = acc.frozenUntil ? new Date(acc.frozenUntil) : null;
  const isFrozen = frozen && frozen > /* @__PURE__ */ new Date();
  const statusEmoji = acc.status === "ACTIVE" && !isFrozen ? "✅" : acc.status === "PENDING" ? "⏳" : acc.status === "BANNED" ? "⛔️" : "🧊";
  return `${statusEmoji} <b>@${escapeHtml(acc.igUsername)}</b>
🆔 <code>#${acc.id}</code> · 👤 owner ${acc.ownerId}
👥 Obunachilar: <code>${fmtNumber(acc.followers || 0)}</code>
💰 Reels: <code>${fmtNumber(acc.priceReels || 0)}</code> so'm
📊 Status: <b>${acc.status}</b>${isFrozen ? ` (muzlatilgan, tugaydi ${frozen.toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}
📅 Qo'shilgan: ${new Date(acc.createdAt).toISOString().slice(0, 10)}`;
}
const adminFlow = /* @__PURE__ */ new Map();
const ADMIN_FLOW_TTL_MS = 5 * 60 * 1e3;
setInterval(() => {
  const now = Date.now();
  for (const [chatId, flow] of adminFlow.entries()) {
    if (flow.expiresAt < now) adminFlow.delete(chatId);
  }
}, 2 * 60 * 1e3);
const CANCEL_BUTTON = { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "flow:cancel" }]] };
async function renderAtmetkaPanel(bot, chatId, messageId) {
  const [username, tiers, activeCount, totalPaidAgg] = await Promise.all([
    getTagTargetUsername(),
    getRewardTiers(),
    prisma.tagSubmission.count({ where: { status: "ACTIVE" } }),
    prisma.tagSubmission.aggregate({ _sum: { totalPaid: true } })
  ]);
  const totalPaid = totalPaidAgg._sum.totalPaid || 0;
  const text = `🏷 <b>Atmetka qilish kampaniyasi</b>

🎯 Maqsad: <code>@${username}</code>

💰 <b>Bosqichlar:</b>
${formatRewardTiers(tiers)}

📊 Aktiv postlar: <b>${activeCount}</b>
💵 Jami to'langan: <b>${fmtNumber(totalPaid)}</b> so'm`;
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🎯 Maqsad username", callback_data: "atmetka:set_user" }],
      [{ text: "💰 Bosqichlarni sozlash", callback_data: "atmetka:set_tiers" }],
      [{ text: "🔄 Yangilash", callback_data: "atmetka:refresh" }]
    ]
  };
  if (messageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: replyMarkup
    }).catch(() => {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: replyMarkup }).catch(() => {
      });
    });
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: replyMarkup }).catch(() => {
    });
  }
}
function accountAdminButtons(acc) {
  const id = acc.id;
  return {
    inline_keyboard: [
      [
        { text: "🧊 1 kun", callback_data: `mkt:admin:freeze:${id}:1` },
        { text: "🧊 7 kun", callback_data: `mkt:admin:freeze:${id}:7` },
        { text: "🧊 30 kun", callback_data: `mkt:admin:freeze:${id}:30` }
      ],
      [
        { text: "▶️ Faollashtirish", callback_data: `mkt:admin:unfreeze:${id}:0` },
        { text: "🗑 O'chirish", callback_data: `mkt:admin:delete:${id}:0` }
      ]
    ]
  };
}
function initMarketplaceBot(bot, sellerBot = null) {
  const ownerBot = sellerBot || bot;
  ownerBot.on("callback_query", async (query) => {
    const data = query.data || "";
    if (!data.startsWith("mkt:owner:")) return;
    const fromTgId = query.from.id;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId || !messageId) {
      try {
        await ownerBot.answerCallbackQuery(query.id, { text: "❌ Xato kontekst" });
      } catch {
      }
      return;
    }
    try {
      const parts = data.split(":");
      const action = parts[2];
      const accountId = Number(parts[3]);
      await handleOwnerConsentCallback(ownerBot, query, action, accountId, chatId, messageId, fromTgId);
    } catch (err) {
      console.error("mkt:owner callback error:", err);
    }
  });
  bot.on("message", async (msg) => {
    if (msg.text !== "📤 Media yuklash") return;
    const chatId = msg.chat.id;
    if (!await isAdminUserId(chatId)) return;
    awaitingUpload.set(chatId, Date.now() + UPLOAD_WINDOW_MS);
    try {
      await bot.sendMessage(
        chatId,
        "Iltimos, hozir foto yoki video yuboring. Men sizga file_id qaytaraman.\n\n_5 daqiqa ichida yuboring._",
        { parse_mode: "Markdown", reply_markup: CANCEL_BUTTON }
      );
    } catch (err) {
      console.warn("upload reply failed:", err instanceof Error ? err.message : err);
    }
  });
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const expiresAt = awaitingUpload.get(chatId);
    if (!expiresAt) return;
    if (expiresAt < Date.now()) {
      awaitingUpload.delete(chatId);
      return;
    }
    let fileId = null;
    let mediaKind = "";
    if (msg.photo && msg.photo.length > 0) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      mediaKind = "Foto";
    } else if (msg.video) {
      fileId = msg.video.file_id;
      mediaKind = "Video";
    } else if (msg.document) {
      fileId = msg.document.file_id;
      mediaKind = "Hujjat";
    } else if (msg.animation) {
      fileId = msg.animation.file_id;
      mediaKind = "GIF";
    }
    if (!fileId) return;
    awaitingUpload.delete(chatId);
    try {
      await bot.sendMessage(
        chatId,
        `📎 <b>File ID</b> (${escapeHtml(mediaKind)})

<code>${escapeHtml(fileId)}</code>

WebApp'ga ko'chiring.`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.warn("/upload result reply failed:", err instanceof Error ? err.message : err);
    }
  });
  bot.onText(/^\/triggertest(?:@\w+)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    if (!await isAdminUserId(chatId)) return;
    try {
      const owner = await prisma.user.upsert({
        where: { telegramId: BigInt(chatId) },
        update: {},
        create: { telegramId: BigInt(chatId), firstName: "CycleTest", username: "admin" }
      });
      const igUsername = `cycle_test_${Date.now().toString().slice(-6)}`;
      const account = await prisma.adAccount.create({
        data: {
          ownerId: owner.id,
          igUsername,
          niche: "LIFESTYLE",
          region: "Toshkent",
          description: "E2E test akkaunti",
          followers: 5e4,
          avgReelsViews: 25e3,
          storyViews: 1e4,
          avatarFileId: "https://picsum.photos/seed/cycleavatar/400/400",
          verificationScreenshots: [
            "https://picsum.photos/seed/cycle1/440/780",
            "https://picsum.photos/seed/cycle2/440/780",
            "https://picsum.photos/seed/cycle3/440/780"
          ],
          status: "PENDING"
        }
      });
      const { notifyAdminsOfNewAccount } = await import("./node-build.mjs").then((n) => n.z);
      await notifyAdminsOfNewAccount(account, "@admin (cycle test)");
      await bot.sendMessage(
        chatId,
        `🎬 <b>Interaktiv cycle boshlandi (#${account.id} @${igUsername})</b>

<b>Qadamlar:</b>
1️⃣ Yuqoridagi tugmalardan 💰 <b>Narx belgilash</b> → raqam yuboring → ✅ <b>Tasdiqlash</b>
2️⃣ @Top_sxema_instagrambot ga "narx belgilandi" xabari keladi → ✅ <b>Roziman</b>
3️⃣ Marketplace WebApp'da @${igUsername} ga REELS buyurtma bering va to'lang
4️⃣ @Top_sxema_instagrambot ga "Yangi buyurtma" + 📸 tugma keladi → 📸 bosing
5️⃣ Istalgan rasm yuboring (skrinshot)
6️⃣ Buyer'ga (siz) rasm + ✅/❌ keladi → ✅ <b>Tasdiqlayman</b>
7️⃣ Order COMPLETED, wallet kredit

<i>Tozalash: "🔍 Qidirish" tugmasi → ${igUsername} → 🗑</i>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("/triggertest error:", err);
      await bot.sendMessage(chatId, "❌ Cycle boshlanmadi: " + (err instanceof Error ? err.message : "noma'lum"));
    }
  });
  bot.on("callback_query", async (query) => {
    if (query.data !== "flow:cancel") return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    adminFlow.delete(chatId);
    broadcastFlow.delete(chatId);
    awaitingUpload.delete(chatId);
    if (messageId) {
      await bot.editMessageText("🚫 Bekor qilindi", { chat_id: chatId, message_id: messageId }).catch(() => {
      });
    }
    await bot.answerCallbackQuery(query.id, { text: "Bekor qilindi" }).catch(() => {
    });
  });
  bot.on("message", async (msg) => {
    if (msg.text !== "🏷 Atmetka") return;
    const chatId = msg.chat.id;
    if (!await isAdminUserId(chatId)) return;
    adminFlow.delete(chatId);
    await renderAtmetkaPanel(bot, chatId);
  });
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    if (!data.startsWith("atmetka:")) return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!await isAdminUserId(chatId)) {
      await bot.answerCallbackQuery(query.id, { text: "⛔ Faqat admin uchun", show_alert: true }).catch(() => {
      });
      return;
    }
    const action = data.slice("atmetka:".length);
    try {
      if (action === "refresh") {
        adminFlow.delete(chatId);
        await renderAtmetkaPanel(bot, chatId, messageId);
        await bot.answerCallbackQuery(query.id).catch(() => {
        });
        return;
      }
      if (action === "set_user") {
        adminFlow.set(chatId, { kind: "atmetka_user", expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        const current = await getTagTargetUsername();
        await bot.editMessageText(
          `🎯 <b>Maqsad username'ni o'zgartirish</b>

Hozirgi: <code>@${current}</code>

Yangi username'ni (@ belgisi shart emas) shu chatga yozib yuboring.

<i>Bu FAQAT yangi topshiriladigan postlarga ta'sir qiladi — allaqachon faol postlar eski maqsad bilan tekshirilishda davom etadi.</i>`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: CANCEL_BUTTON }
        ).catch(() => {
        });
        await bot.answerCallbackQuery(query.id).catch(() => {
        });
        return;
      }
      if (action === "set_tiers") {
        adminFlow.set(chatId, { kind: "atmetka_tiers", expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
        const current = await getRewardTiers();
        await bot.editMessageText(
          `💰 <b>Prosmotr bosqichlarini sozlash</b>

Hozirgi:
${formatRewardTiers(current)}

Yangi jadvalni shu formatda yuboring:
<code>1000:5000,5000:20000,10000:50000</code>
<i>(prosmotr:so'm, vergul bilan ajratib, bir nechta bosqich)</i>

<i>Bu FAQAT yangi topshiriladigan postlarga ta'sir qiladi — allaqachon faol postlar topshirilgan paytdagi eski jadval bilan davom etadi.</i>`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: CANCEL_BUTTON }
        ).catch(() => {
        });
        await bot.answerCallbackQuery(query.id).catch(() => {
        });
        return;
      }
      await bot.answerCallbackQuery(query.id).catch(() => {
      });
    } catch (e) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Xato" }).catch(() => {
      });
    }
  });
  bot.on("message", async (msg) => {
    if (msg.text !== "🔖 Heshteg") return;
    const chatId = msg.chat.id;
    if (!await isAdminUserId(chatId)) return;
    const { isHeshtegEnabled } = await import("./node-build.mjs").then((n) => n.x);
    const enabled = await isHeshtegEnabled();
    const statusText = enabled ? "🟢 Yoqilgan" : "🔴 O'chirilgan";
    const text = `🔖 <b>Heshteg olish xizmati</b>

Hozirgi holati: <b>${statusText}</b>

Boshqarish uchun pastdagi tugmalardan foydalaning.`;
    const kb = {
      inline_keyboard: [
        [
          { text: "🟢 Yoqish", callback_data: "heshteg_on" },
          { text: "🔴 O'chirish", callback_data: "heshteg_off" }
        ],
        [{ text: "📊 Heshteg statistikasi", callback_data: "heshteg_stats" }],
        [{ text: "📝 Haftalik xeshteg", callback_data: "heshteg_weekly" }]
      ]
    };
    await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {
    });
  });
  async function renderCommissionPanel(chatId, messageId) {
    const { getCommissionRate } = await import("./node-build.mjs").then((n) => n.x);
    const current = await getCommissionRate();
    const text = `💰 <b>Marketplace komissiya foizi</b>

Hozirgi: <code>${current}%</code>

<i>escrow = narx − (narx × foiz / 100), har bir yangi order'da hisoblanadi.</i>`;
    const kb = { inline_keyboard: [
      [{ text: "✏️ O'zgartirish", callback_data: "commission:edit" }],
      [{ text: "🔄 Yangilash", callback_data: "commission:refresh" }]
    ] };
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: kb }).catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {
      }));
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {
      });
    }
  }
  bot.on("message", async (msg) => {
    if (msg.text !== "💰 Komissiya") return;
    const chatId = msg.chat.id;
    if (!await isAdminUserId(chatId)) return;
    adminFlow.delete(chatId);
    await renderCommissionPanel(chatId);
  });
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    if (!data.startsWith("commission:")) return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!await isAdminUserId(chatId)) {
      await bot.answerCallbackQuery(query.id, { text: "⛔ Faqat admin uchun", show_alert: true }).catch(() => {
      });
      return;
    }
    const action = data.slice("commission:".length);
    if (action === "refresh") {
      adminFlow.delete(chatId);
      await renderCommissionPanel(chatId, messageId);
      await bot.answerCallbackQuery(query.id).catch(() => {
      });
      return;
    }
    if (action === "edit") {
      adminFlow.set(chatId, { kind: "commission", expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
      const { getCommissionRate } = await import("./node-build.mjs").then((n) => n.x);
      const current = await getCommissionRate();
      await bot.editMessageText(
        `✏️ <b>Komissiya foizini o'zgartirish</b>

Hozirgi: <code>${current}%</code>

Yangi foizni (0-100) yozib yuboring.`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: CANCEL_BUTTON }
      ).catch(() => {
      });
      await bot.answerCallbackQuery(query.id).catch(() => {
      });
      return;
    }
    await bot.answerCallbackQuery(query.id).catch(() => {
    });
  });
  bot.on("message", async (msg) => {
    if (msg.text !== "🔍 Qidirish") return;
    const chatId = msg.chat.id;
    if (!await isAdminUserId(chatId)) return;
    adminFlow.set(chatId, { kind: "search", expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
    await bot.sendMessage(
      chatId,
      "🔍 Qidirmoqchi bo'lgan Instagram username'ni (kamida 2 belgi) yozib yuboring.",
      { reply_markup: CANCEL_BUTTON }
    ).catch(() => {
    });
  });
  async function currentWeeklyHashtag() {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const storePath = path.join(process.cwd(), "server", "data", "weekly-hashtag.json");
      const raw = fs.readFileSync(storePath, "utf8");
      const j = JSON.parse(raw);
      return {
        current: j.hashtag ? j.hashtag.length > 400 ? j.hashtag.slice(0, 400) + "…" : j.hashtag : "— (sozlanmagan)",
        updatedAt: j.updatedAt ? String(j.updatedAt).slice(0, 16).replace("T", " ") : "—"
      };
    } catch {
      return { current: "— (sozlanmagan)", updatedAt: "—" };
    }
  }
  bot.on("callback_query", async (query) => {
    if (query.data !== "heshteg_weekly_edit") return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    if (!await isAdminUserId(chatId)) {
      await bot.answerCallbackQuery(query.id, { text: "⛔ Faqat admin uchun", show_alert: true }).catch(() => {
      });
      return;
    }
    adminFlow.set(chatId, { kind: "weekly_hashtag", expiresAt: Date.now() + ADMIN_FLOW_TTL_MS });
    const { current } = await currentWeeklyHashtag();
    await bot.editMessageText(
      `📝 <b>Haftalik xeshtegni o'zgartirish</b>

<b>Hozirgi:</b>
<code>${escapeHtml(current)}</code>

Yangi xeshteg matnini (3+ belgi) yozib yuboring.`,
      { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: CANCEL_BUTTON }
    ).catch(() => {
    });
    await bot.answerCallbackQuery(query.id).catch(() => {
    });
  });
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const flow = adminFlow.get(chatId);
    if (!flow) return;
    if (flow.expiresAt < Date.now()) {
      adminFlow.delete(chatId);
      return;
    }
    if (!msg.text) return;
    if (flow.kind === "atmetka_user") {
      try {
        await setTagTargetUsername(msg.text);
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, `✅ Maqsad username <b>@${msg.text.replace(/^@/, "").trim().toLowerCase()}</b> ga o'rnatildi.`, { parse_mode: "HTML" }).catch(() => {
        });
        await renderAtmetkaPanel(bot, chatId);
      } catch (e) {
        await bot.sendMessage(chatId, `⚠️ ${e?.message || "Xato"}. Qaytadan yozing.`, { reply_markup: CANCEL_BUTTON }).catch(() => {
        });
      }
      return;
    }
    if (flow.kind === "atmetka_tiers") {
      try {
        const tiers = parseRewardTiersInput(msg.text);
        await setRewardTiers(tiers);
        adminFlow.delete(chatId);
        await bot.sendMessage(chatId, `✅ Bosqichlar yangilandi:
${formatRewardTiers(tiers)}`, { parse_mode: "HTML" }).catch(() => {
        });
        await renderAtmetkaPanel(bot, chatId);
      } catch (e) {
        await bot.sendMessage(
          chatId,
          `⚠️ ${e?.message || "Format xato"}. Misol: <code>1000:5000,5000:20000</code>. Qaytadan yozing.`,
          { parse_mode: "HTML", reply_markup: CANCEL_BUTTON }
        ).catch(() => {
        });
      }
      return;
    }
    if (flow.kind === "commission") {
      const { setCommissionRate } = await import("./node-build.mjs").then((n) => n.x);
      const value = Number(msg.text.replace(",", ".").trim());
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        await bot.sendMessage(chatId, "⚠️ 0..100 oralig'idagi raqam yuboring. Qaytadan yozing.", { reply_markup: CANCEL_BUTTON }).catch(() => {
        });
        return;
      }
      await setCommissionRate(value);
      adminFlow.delete(chatId);
      await bot.sendMessage(chatId, `✅ Komissiya foizi <b>${value}%</b> ga o'rnatildi.`, { parse_mode: "HTML" }).catch(() => {
      });
      await renderCommissionPanel(chatId);
      return;
    }
    if (flow.kind === "search") {
      const q = msg.text.trim().replace(/^@/, "");
      if (q.length < 2) {
        await bot.sendMessage(chatId, "⚠️ Kamida 2 ta belgi kiriting. Qaytadan yozing.", { reply_markup: CANCEL_BUTTON }).catch(() => {
        });
        return;
      }
      adminFlow.delete(chatId);
      try {
        const list = await prisma.adAccount.findMany({
          where: { igUsername: { contains: q, mode: "insensitive" } },
          orderBy: { createdAt: "desc" },
          take: 10
        });
        if (list.length === 0) {
          await bot.sendMessage(chatId, `❌ <b>${escapeHtml(q)}</b> bo'yicha akkaunt topilmadi`, { parse_mode: "HTML" }).catch(() => {
          });
          return;
        }
        for (const acc of list) {
          await bot.sendMessage(chatId, accountAdminCard(acc), {
            parse_mode: "HTML",
            reply_markup: accountAdminButtons(acc)
          }).catch(() => {
          });
        }
      } catch (err) {
        console.error("search error:", err);
        await bot.sendMessage(chatId, "❌ Qidiruv xatosi").catch(() => {
        });
      }
      return;
    }
    if (flow.kind === "weekly_hashtag") {
      const text = msg.text.trim();
      if (text.length < 3) {
        await bot.sendMessage(chatId, "⚠️ Xeshteg matni 3+ belgi bo'lishi kerak. Qaytadan yozing.", { reply_markup: CANCEL_BUTTON }).catch(() => {
        });
        return;
      }
      adminFlow.delete(chatId);
      try {
        const saved = writeWeeklyHashtag(text);
        await bot.sendMessage(
          chatId,
          `✅ <b>Haftalik xeshteg yangilandi</b>

<code>${escapeHtml(saved.hashtag)}</code>

Yangilangan: ${saved.updatedAt.slice(0, 16).replace("T", " ")}`,
          { parse_mode: "HTML" }
        ).catch(() => {
        });
      } catch (err) {
        console.error("weekly hashtag save error:", err);
        await bot.sendMessage(chatId, "❌ Saqlashda xato").catch(() => {
        });
      }
      return;
    }
  });
  bot.on("message", async (msg) => {
    if (msg.text !== "📨 Xabar yuborish") return;
    const chatId = msg.chat.id;
    if (!await isAdminUserId(chatId)) return;
    broadcastFlow.set(chatId, { stage: "awaiting_content", expiresAt: Date.now() + BROADCAST_WINDOW_MS });
    await bot.sendMessage(
      chatId,
      `📨 <b>Sotuvchilarga xabar yuborish</b>

Istalgan turdagi xabaringizni shu chatga yuboring:
• Oddiy matn
• Video + caption
• Foto + caption
• Fayl (hujjat) + caption
• GIF

Xabar akkaunti TASDIQLANGAN (ACTIVE) barcha sotuvchilarga aynan shu ko'rinishda yuboriladi.`,
      { parse_mode: "HTML", reply_markup: CANCEL_BUTTON }
    ).catch(() => {
    });
  });
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const flow = broadcastFlow.get(chatId);
    if (!flow || flow.stage !== "awaiting_content") return;
    if (flow.expiresAt < Date.now()) {
      broadcastFlow.delete(chatId);
      return;
    }
    const content = extractBroadcastContent(msg);
    if (!content) {
      await bot.sendMessage(
        chatId,
        "❌ Bu turdagi xabar qo'llab-quvvatlanmaydi. Matn, foto, video, fayl yoki GIF yuboring.",
        { reply_markup: CANCEL_BUTTON }
      ).catch(() => {
      });
      return;
    }
    broadcastFlow.set(chatId, { stage: "awaiting_button", content, expiresAt: Date.now() + BROADCAST_WINDOW_MS });
    await bot.sendMessage(
      chatId,
      `🔘 Xabar ostiga havola-tugma qo'shmoqchimisiz?

Qo'shish uchun: <code>Tugma matni | https://havola.uz</code>
Kerak bo'lmasa — pastdagi tugmani bosing.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Yuborish (tugmasiz)", callback_data: "broadcast:send_now" }],
            [{ text: "❌ Bekor qilish", callback_data: "flow:cancel" }]
          ]
        }
      }
    ).catch(() => {
    });
  });
  bot.on("callback_query", async (query) => {
    if (query.data !== "broadcast:send_now") return;
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    const flow = broadcastFlow.get(chatId);
    if (!flow || flow.stage !== "awaiting_button" || !flow.content) {
      await bot.answerCallbackQuery(query.id).catch(() => {
      });
      return;
    }
    broadcastFlow.delete(chatId);
    await bot.answerCallbackQuery(query.id).catch(() => {
    });
    await broadcastToActiveSellers(bot, chatId, flow.content, null);
  });
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const flow = broadcastFlow.get(chatId);
    if (!flow || flow.stage !== "awaiting_button" || !flow.content) return;
    if (flow.expiresAt < Date.now()) {
      broadcastFlow.delete(chatId);
      return;
    }
    if (!msg.text) return;
    const parts = msg.text.split("|").map((s) => s.trim());
    if (parts.length !== 2 || !parts[0] || !/^https?:\/\//i.test(parts[1])) {
      await bot.sendMessage(
        chatId,
        "❌ Format noto'g'ri. Masalan: <code>Kanalga o'tish | https://t.me/kanal</code>",
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Yuborish (tugmasiz)", callback_data: "broadcast:send_now" }],
              [{ text: "❌ Bekor qilish", callback_data: "flow:cancel" }]
            ]
          }
        }
      ).catch(() => {
      });
      return;
    }
    const content = flow.content;
    broadcastFlow.delete(chatId);
    const replyMarkup = { inline_keyboard: [[{ text: parts[0], url: parts[1] }]] };
    await broadcastToActiveSellers(bot, chatId, content, replyMarkup);
  });
  bot.on("message", async (msg) => {
    try {
      if (!msg?.chat || !msg.text || msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const accountId = getAwaitingPrice(chatId);
      if (!accountId) return;
      const sub = getSubmission(accountId, chatId);
      if (!sub) {
        clearAwaitingPrice(chatId);
        return;
      }
      const cleaned = msg.text.replace(/[\s,_]/g, "").trim();
      const n = Number(cleaned);
      if (!Number.isFinite(n) || n <= 0 || n > 1e9) {
        await bot.sendMessage(chatId, "❌ To'g'ri raqam emas. Faqat raqam (so'm) yuboring.").catch(() => {
        });
        return;
      }
      sub.price = n;
      clearAwaitingPrice(chatId);
      await bot.editMessageText(buildAccountCaption(sub), {
        chat_id: chatId,
        message_id: sub.buttonsMsgId,
        parse_mode: "HTML",
        reply_markup: buildAccountButtons(accountId, true)
      }).catch(() => {
      });
      if (sub.priceAskMsgId) {
        await bot.deleteMessage(chatId, sub.priceAskMsgId).catch(() => {
        });
        sub.priceAskMsgId = void 0;
      }
      await bot.deleteMessage(chatId, msg.message_id).catch(() => {
      });
    } catch (e) {
      console.error("mkt price-listener error:", e instanceof Error ? e.message : e);
    }
  });
  bot.on("callback_query", async (query) => {
    if (query.data !== "admchat:cancel") return;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    const { getAwaitingAdminMessage, clearAwaitingAdminMessage } = await import("./node-build.mjs").then((n) => n.y);
    const pending = getAwaitingAdminMessage(chatId);
    if (pending) clearAwaitingAdminMessage(chatId);
    if (messageId) {
      await bot.editMessageText("🚫 Yozish bekor qilindi", { chat_id: chatId, message_id: messageId }).catch(() => {
      });
    }
    await bot.answerCallbackQuery(query.id).catch(() => {
    });
  });
  bot.on("message", async (msg) => {
    try {
      if (!msg?.chat || !msg.text || msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const { getAwaitingAdminMessage, clearAwaitingAdminMessage } = await import("./node-build.mjs").then((n) => n.y);
      const pending = getAwaitingAdminMessage(chatId);
      if (!pending) return;
      const { phpBot: phpBot2 } = await import("./node-build.mjs").then((n) => n.A);
      const text = `💬 <b>Admindan xabar</b>

Akkauntingiz <code>#${pending.accountId}</code> bo'yicha so'rov:

<blockquote>${escapeHtml(msg.text)}</blockquote>

<i>Javob yozish uchun pastdagi tugmani bosing.</i>`;
      const replyMarkup = {
        inline_keyboard: [[
          { text: "✍️ Javob yozish", callback_data: `mkt:vchat:reply:${pending.accountId}` }
        ]]
      };
      try {
        await phpBot2.sendMessage(pending.ownerTgId, text, { replyMarkup });
        clearAwaitingAdminMessage(chatId);
        await bot.sendMessage(
          chatId,
          `✅ Xabar ${pending.ownerTgId.toString().slice(-4)} dagi egasiga yuborildi.

<i>Egasi javob yozsa shu chatga keladi.</i>`,
          { parse_mode: "HTML" }
        ).catch(() => {
        });
      } catch (e) {
        await bot.sendMessage(chatId, "❌ Yuborib bo'lmadi: " + (e instanceof Error ? e.message : "noma'lum")).catch(() => {
        });
      }
    } catch (e) {
      console.error("mkt admin-chat error:", e instanceof Error ? e.message : e);
    }
  });
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    if (!data.startsWith("mkt:")) return;
    const fromTgId = query.from.id;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    if (!chatId || !messageId) {
      try {
        await bot.answerCallbackQuery(query.id, { text: "❌ Xato kontekst" });
      } catch {
      }
      return;
    }
    const parts = data.split(":");
    const kind = parts[1];
    if (kind === "owner") return;
    if (!await isAdminUserId(fromTgId)) {
      try {
        await bot.answerCallbackQuery(query.id, { text: "❌ Faqat adminlar uchun", show_alert: true });
      } catch {
      }
      return;
    }
    try {
      if (kind === "admin") {
        if (parts[2] === "pay") {
          const action3 = parts[3];
          const orderId = Number(parts[4] || 0);
          await handleAdminPaymentCallback(bot, query, action3, orderId, chatId, messageId, fromTgId);
          return;
        }
        const action2 = parts[2];
        const accountId = Number(parts[3]);
        const arg = Number(parts[4] || 0);
        await handleAdminAccountCallback(bot, query, action2, accountId, arg, chatId, messageId);
        return;
      }
      const id = Number(parts[2]);
      const action = parts[3];
      if (kind === "verify") {
        await handleVerifyCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === "payout") {
        await handlePayoutCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === "dispute") {
        await handleDisputeCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === "editreq") {
        await handleEditReviewCallback(bot, query, id, action, chatId, messageId, fromTgId);
      } else if (kind === "vchat" && parts[2] === "block") {
        const accountId = Number(parts[3] || 0);
        const ownerTgId = Number(parts[4] || 0);
        await handleVchatBlockCallback(bot, query, accountId, ownerTgId, chatId, messageId);
      } else {
        try {
          await bot.answerCallbackQuery(query.id, { text: "Noma'lum amal" });
        } catch {
        }
      }
    } catch (err) {
      console.error("mkt callback error:", err);
      try {
        await bot.answerCallbackQuery(query.id, {
          text: "❌ Xatolik: " + (err instanceof Error ? err.message.slice(0, 100) : "noma'lum"),
          show_alert: true
        });
      } catch {
      }
    }
  });
}
async function handleOwnerConsentCallback(bot, query, action, accountId, chatId, messageId, fromTgId) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Akkaunt topilmadi", show_alert: true });
    } catch {
    }
    return;
  }
  const owner = await prisma.user.findUnique({
    where: { id: account.ownerId },
    select: { telegramId: true }
  });
  const ownerTgId = owner?.telegramId ? Number(owner.telegramId) : null;
  if (!ownerTgId || ownerTgId !== fromTgId) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Bu so'rov sizga emas", show_alert: true });
    } catch {
    }
    return;
  }
  if (action === "agree") {
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: "ACTIVE", isVerified: true, frozenUntil: null }
    });
    try {
      await bot.editMessageText(
        `✅ <b>Rozilik qabul qilindi</b>

👤 @${escapeHtml(account.igUsername)}
💰 Reels: ${updated.priceReels.toLocaleString("uz-UZ")} so'm

<i>Akkauntingiz marketplace'da faol holatda.</i>`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "✅ Tasdiqlandi" });
    } catch {
    }
    phpBot.sendVideo(
      ownerTgId,
      "BAACAgIAAxkDAAGdf4dqpXbcKowuD9rU57XfUnt5SHSpCQAC9akAAtULKUlvI0YF0kBsZT0E"
    ).catch(() => {
    });
    for (const adminId of ADMIN_IDS) {
      bot.sendMessage(
        adminId,
        `✅ Egasi rozilik berdi: @${account.igUsername} (#${accountId}) → ACTIVE`,
        { parse_mode: "HTML" }
      ).catch(() => {
      });
    }
  } else if (action === "cancel") {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: "PENDING", isVerified: false, priceFeed: 0, priceReels: 0, priceStory: 0 }
    });
    try {
      await bot.editMessageText(
        `❌ <b>Bekor qilindi</b>

👤 @${escapeHtml(account.igUsername)}

<i>Admin yana ko'rib chiqadi va yangi narx taklif qilishi mumkin.</i>`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ Bekor qilindi" });
    } catch {
    }
    for (const adminId of ADMIN_IDS) {
      bot.sendMessage(
        adminId,
        `❌ Egasi narxni rad etdi: @${account.igUsername} (#${accountId}) → PENDING (yangi ko'rib chiqish kerak)`,
        { parse_mode: "HTML" }
      ).catch(() => {
      });
    }
  } else {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Noma'lum amal" });
    } catch {
    }
  }
}
async function handleAdminPaymentCallback(bot, query, action, orderId, chatId, messageId, fromTgId) {
  if (!orderId) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Order ID xato" });
    } catch {
    }
    return;
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } }
  });
  if (!order) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Buyurtma topilmadi", show_alert: true });
    } catch {
    }
    return;
  }
  if (order.status !== "AWAITING_PAYMENT_APPROVAL") {
    try {
      await bot.answerCallbackQuery(query.id, { text: `Allaqachon ishlangan (${order.status})`, show_alert: true });
    } catch {
    }
    return;
  }
  if (action === "approve") {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "AWAITING_BUYER_MATERIAL",
        paymentApprovedAt: /* @__PURE__ */ new Date()
      }
    });
    await prisma.orderEvent.create({
      data: { orderId, type: "payment_approved", actorId: null, payload: { adminTgId: String(fromTgId) } }
    }).catch(() => {
    });
    try {
      await bot.editMessageCaption(
        `✅ <b>To'lov tasdiqlandi</b>

Order <code>#${orderId}</code>. Mijozdan video so'raldi.`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
      try {
        await bot.editMessageText(
          `✅ <b>To'lov tasdiqlandi</b>

Order <code>#${orderId}</code>. Mijozdan video so'raldi.`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
        );
      } catch {
      }
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "✅ Tasdiqlandi" });
    } catch {
    }
    const { notifyBuyerForMaterial } = await import("./node-build.mjs").then((n) => n.B);
    notifyBuyerForMaterial(orderId).catch(() => {
    });
  } else if (action === "reject") {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "AWAITING_PAYMENT" }
      // qaytadan to'lov skrinshoti so'raymiz
    });
    await prisma.orderEvent.create({
      data: { orderId, type: "payment_rejected", actorId: null, payload: { adminTgId: fromTgId } }
    }).catch(() => {
    });
    try {
      await bot.editMessageCaption(
        `❌ <b>To'lov rad etildi</b>

Order <code>#${orderId}</code>. Mijozdan qaytadan skrinshot so'raldi.`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
      try {
        await bot.editMessageText(
          `❌ <b>To'lov rad etildi</b>

Order <code>#${orderId}</code>.`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
        );
      } catch {
      }
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ Rad etildi" });
    } catch {
    }
    const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
    if (buyerTgId) {
      const text = `❌ <b>To'lov tasdiqlanmadi</b>

Order <code>#${orderId}</code>. Iltimos, to'lovni qaytadan amalga oshiring va skrinshotni qayta yuboring.`;
      try {
        const phpBotMod = await import("./node-build.mjs").then((n) => n.A);
        if (phpBotMod.phpBot.isReady()) {
          await phpBotMod.phpBot.sendMessage(buyerTgId, text);
        }
      } catch {
      }
    }
  } else {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Noma'lum amal" });
    } catch {
    }
  }
}
async function handleAdminAccountCallback(bot, query, action, accountId, arg, chatId, messageId) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Akkaunt topilmadi", show_alert: true });
    } catch {
    }
    try {
      await bot.editMessageText("❌ Akkaunt topilmadi yoki o'chirilgan", { chat_id: chatId, message_id: messageId });
    } catch {
    }
    return;
  }
  if (action === "freeze") {
    const days = Math.max(1, Math.min(365, arg || 1));
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1e3);
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: "SUSPENDED", frozenUntil: until }
    });
    try {
      await bot.editMessageText(accountAdminCard(updated), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: accountAdminButtons(updated)
      });
    } catch {
    }
    await createNotification(
      account.ownerId,
      "ACCOUNT_REJECTED",
      "Akkaunt muzlatildi 🧊",
      `@${account.igUsername} akkauntingiz ${days} kunga muzlatildi. Tugaydi: ${until.toISOString().slice(0, 16).replace("T", " ")} UTC.`
    ).catch(() => {
    });
    try {
      await bot.answerCallbackQuery(query.id, { text: `🧊 ${days} kunga muzlatildi` });
    } catch {
    }
  } else if (action === "unfreeze") {
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: "ACTIVE", frozenUntil: null, isVerified: true }
    });
    try {
      await bot.editMessageText(accountAdminCard(updated), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: accountAdminButtons(updated)
      });
    } catch {
    }
    await createNotification(
      account.ownerId,
      "ACCOUNT_VERIFIED",
      "Akkaunt qayta faollashtirildi ▶️",
      `@${account.igUsername} akkauntingiz marketplace'da yana faol holatda.`
    ).catch(() => {
    });
    try {
      await bot.answerCallbackQuery(query.id, { text: "▶️ Faollashtirildi" });
    } catch {
    }
  } else if (action === "delete") {
    try {
      await prisma.adAccount.delete({ where: { id: accountId } });
    } catch (e) {
      await prisma.adAccount.update({ where: { id: accountId }, data: { status: "BANNED" } });
      try {
        await bot.editMessageText(
          `⛔️ <b>@${escapeHtml(account.igUsername)}</b> (#${accountId})

Akkauntda buyurtmalar bor — to'liq o'chirib bo'lmadi.
Status: <b>BANNED</b> (marketplaceda ko'rinmaydi).`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
        );
      } catch {
      }
      try {
        await bot.answerCallbackQuery(query.id, { text: "⛔️ Soft delete: BANNED" });
      } catch {
      }
      return;
    }
    try {
      await bot.editMessageText(
        `🗑 <b>@${escapeHtml(account.igUsername)}</b> (#${accountId}) o'chirildi`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "🗑 O'chirildi" });
    } catch {
    }
  } else {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Noma'lum amal" });
    } catch {
    }
  }
}
async function handleVerifyCallback(bot, query, accountId, action, chatId, messageId, adminTgId) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Akkaunt topilmadi", show_alert: true });
    } catch {
    }
    return;
  }
  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });
  const sub = getSubmission(accountId, chatId);
  if (action === "price") {
    setAwaitingPrice(chatId, accountId);
    try {
      const ask = await bot.sendMessage(
        chatId,
        `💰 <b>Narxni so'mda yuboring</b> (raqam, masalan: <code>250000</code>)

👤 @${account.igUsername}`,
        { parse_mode: "HTML", reply_markup: { force_reply: true } }
      );
      if (sub) sub.priceAskMsgId = ask?.message_id;
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id);
    } catch {
    }
    return;
  }
  if (action === "chat") {
    const acc = await prisma.adAccount.findUnique({
      where: { id: accountId },
      include: { owner: true }
    });
    const ownerTgIdBig = acc?.owner?.telegramId;
    if (!ownerTgIdBig) {
      try {
        await bot.answerCallbackQuery(query.id, { text: "Egasi topilmadi", show_alert: true });
      } catch {
      }
      return;
    }
    const ownerTgId = Number(ownerTgIdBig);
    const { setAwaitingAdminMessage, setLastChatAdmin } = await import("./node-build.mjs").then((n) => n.y);
    setAwaitingAdminMessage(chatId, accountId, ownerTgId);
    setLastChatAdmin(accountId, chatId);
    try {
      await bot.sendMessage(
        chatId,
        `💬 <b>Egasiga xabar yozish</b>

👤 Akkaunt: <code>#${accountId}</code> · @${account.igUsername}

Keyingi yuboradigan xabaringiz <b>anonim tarzda</b> egasiga (Top_sxema bot orqali) yetkaziladi.

<i>10 daqiqa ichida yuboring.</i>`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "admchat:cancel" }]] } }
      );
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "✍️ Xabar yozing" });
    } catch {
    }
    return;
  }
  if (action === "approve") {
    if (sub && !sub.price) {
      try {
        await bot.answerCallbackQuery(query.id, { text: "Avval narx belgilang!", show_alert: true });
      } catch {
      }
      return;
    }
    const price = sub?.price ?? 0;
    const priceReels = price;
    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        reviewedAt: /* @__PURE__ */ new Date(),
        reviewedBy: admin?.id ?? null,
        priceReels,
        priceFeed: 0,
        priceStory: 0
        // status: PENDING (o'zgarmaydi)
      }
    });
    const owner = await prisma.user.findUnique({
      where: { id: account.ownerId },
      select: { telegramId: true }
    });
    const ownerTgId = owner?.telegramId ? Number(owner.telegramId) : null;
    let ownerSent = false;
    if (ownerTgId) {
      const consentText = `🆕 <b>Akkauntingiz Reels narxi belgilandi</b>

👤 <b>@${escapeHtml(account.igUsername)}</b>
🎬 Format: <b>REELS</b>
💰 Narx: <code>${priceReels.toLocaleString("uz-UZ")}</code> so'm

<i>Roziman bossangiz — akkaunt marketplaceda Reels video ulash buyurtmalarini qabul qila boshlaydi.
Bekor qilsangiz — admin yana ko'rib chiqadi.</i>`;
      const replyMarkup = {
        inline_keyboard: [
          [
            { text: "✅ Roziman", callback_data: `mkt:owner:agree:${accountId}:0` },
            { text: "❌ Bekor qilish", callback_data: `mkt:owner:cancel:${accountId}:0` }
          ]
        ]
      };
      try {
        if (phpBot.isReady()) {
          await phpBot.sendMessage(ownerTgId, consentText, { replyMarkup });
        } else {
          const targetBot = getSellerBot() || bot;
          await targetBot.sendMessage(ownerTgId, consentText, {
            parse_mode: "HTML",
            reply_markup: replyMarkup
          });
        }
        ownerSent = true;
      } catch (e) {
        console.warn("owner price-consent send failed:", e instanceof Error ? e.message : e);
      }
    }
    try {
      await bot.editMessageText(
        `🕓 <b>Egasi qarorini kutmoqda</b>

👤 @${escapeHtml(account.igUsername)}
💰 ${price.toLocaleString("uz-UZ")} so'm
🆔 <code>#${accountId}</code>

` + (ownerSent ? `<i>Egasiga rozilik so'rovi yuborildi.</i>` : `⚠️ <i>Egaga xabar yuborib bo'lmadi (bot bilan suhbat ochmagan bo'lishi mumkin).</i>`),
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: ownerSent ? "✅ Egasiga yuborildi" : "⚠️ Egaga yetkazib bo'lmadi" });
    } catch {
    }
    for (const other of getAllSubmissionsForAccount(accountId)) {
      if (other.adminChatId === chatId) continue;
      await bot.editMessageText(
        `🕓 <b>Egasi qarorini kutmoqda</b>

👤 @${escapeHtml(account.igUsername)}
💰 ${price.toLocaleString("uz-UZ")} so'm
🆔 <code>#${accountId}</code>

<i>Boshqa admin tomonidan narx belgilandi va yuborildi.</i>`,
        { chat_id: other.adminChatId, message_id: other.buttonsMsgId, parse_mode: "HTML" }
      ).catch(() => {
      });
      if (other.priceAskMsgId) {
        await bot.deleteMessage(other.adminChatId, other.priceAskMsgId).catch(() => {
        });
      }
    }
    deleteAllSubmissionsForAccount(accountId);
  } else if (action === "reject") {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        status: "SUSPENDED",
        isVerified: false,
        reviewedAt: /* @__PURE__ */ new Date(),
        reviewedBy: admin?.id ?? null
      }
    });
    await createNotification(
      account.ownerId,
      "ACCOUNT_REJECTED",
      "Akkaunt rad etildi ❌",
      `@${account.igUsername} akkauntingiz tekshiruvdan o'tmadi. Iltimos, ma'lumotlarni qayta yuboring.`
    );
    if (sub) {
      for (const other of getAllSubmissionsForAccount(accountId)) {
        for (const mid of other.mediaGroupMsgIds) {
          await bot.deleteMessage(other.adminChatId, mid).catch(() => {
          });
        }
        if (other.priceAskMsgId) {
          await bot.deleteMessage(other.adminChatId, other.priceAskMsgId).catch(() => {
          });
        }
        await bot.deleteMessage(other.adminChatId, other.buttonsMsgId).catch(() => {
        });
      }
      deleteAllSubmissionsForAccount(accountId);
    } else {
      try {
        await bot.editMessageText(
          `❌ <b>Rad etildi</b>

👤 @${account.igUsername}
🆔 <code>#${accountId}</code>`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
        );
      } catch {
      }
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ Rad etildi" });
    } catch {
    }
  }
}
async function handleEditReviewCallback(bot, query, accountId, action, chatId, messageId, adminTgId) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Akkaunt topilmadi", show_alert: true });
    } catch {
    }
    return;
  }
  const pendingEdit = account.pendingEdit;
  if (!pendingEdit) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Bu so'rov allaqachon ko'rib chiqilgan", show_alert: true });
    } catch {
    }
    for (const mid of getSubmission(accountId, chatId)?.mediaGroupMsgIds ?? []) {
      await bot.deleteMessage(chatId, mid).catch(() => {
      });
    }
    await bot.deleteMessage(chatId, messageId).catch(() => {
    });
    return;
  }
  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });
  if (action === "approve") {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: {
        avatarFileId: pendingEdit.avatarFileId,
        verificationScreenshots: pendingEdit.screenshots,
        pendingEdit: null,
        reviewedAt: /* @__PURE__ */ new Date(),
        reviewedBy: admin?.id ?? null
      }
    });
    await createNotification(
      account.ownerId,
      "ACCOUNT_VERIFIED",
      "Akkaunt yangilandi ✅",
      `@${account.igUsername} akkauntingizning yangi rasm/skrinshotlari tasdiqlandi.`
    );
    try {
      await bot.editMessageText(
        `✅ <b>Tasdiqlandi</b>

👤 @${escapeHtml(account.igUsername)}
🆔 <code>#${accountId}</code>`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "✅ Tasdiqlandi" });
    } catch {
    }
  } else if (action === "reject") {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: { pendingEdit: null }
    });
    await createNotification(
      account.ownerId,
      "ACCOUNT_REJECTED",
      "Akkaunt yangilanish so'rovi rad etildi ❌",
      `@${account.igUsername} akkauntingiz uchun so'ralgan rasm/skrinshot o'zgarishi rad etildi. Eski ma'lumotlar o'zgarishsiz qoladi.`
    );
    try {
      await bot.editMessageText(
        `❌ <b>Rad etildi</b>

👤 @${escapeHtml(account.igUsername)}
🆔 <code>#${accountId}</code>`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
      );
    } catch {
    }
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ Rad etildi" });
    } catch {
    }
  }
  for (const other of getAllSubmissionsForAccount(accountId)) {
    if (other.adminChatId === chatId) continue;
    for (const mid of other.mediaGroupMsgIds) {
      await bot.deleteMessage(other.adminChatId, mid).catch(() => {
      });
    }
    await bot.deleteMessage(other.adminChatId, other.buttonsMsgId).catch(() => {
    });
  }
  deleteAllSubmissionsForAccount(accountId);
}
async function handleVchatBlockCallback(bot, query, accountId, ownerTgId, chatId, messageId) {
  if (!ownerTgId) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Foydalanuvchi topilmadi", show_alert: true });
    } catch {
    }
    return;
  }
  const { getAwaitingOwnerReply, clearAwaitingOwnerReply } = await import("./node-build.mjs").then((n) => n.y);
  await prisma.user.updateMany({
    where: { telegramId: BigInt(ownerTgId) },
    data: { blockedFromAdminChat: true }
  }).catch((e) => console.error("handleVchatBlockCallback update error:", e));
  if (getAwaitingOwnerReply(ownerTgId)) clearAwaitingOwnerReply(ownerTgId);
  try {
    await bot.editMessageText(
      `🚫 <b>Bloklandi</b>

Akkaunt <code>#${accountId}</code> egasi endi bu anonim chat orqali xabar yoza olmaydi.`,
      { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
    );
  } catch {
  }
  try {
    await bot.answerCallbackQuery(query.id, { text: "🚫 Bloklandi" });
  } catch {
  }
}
async function handlePayoutCallback(bot, query, payoutId, action, chatId, messageId, adminTgId) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Payout topilmadi", show_alert: true });
    } catch {
    }
    return;
  }
  if (payout.status !== "PENDING") {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Payout allaqachon ko'rib chiqilgan", show_alert: true });
    } catch {
    }
    return;
  }
  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });
  if (action === "approve") {
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: { status: "PAID", processedAt: /* @__PURE__ */ new Date(), processedBy: admin?.id ?? null }
      });
      const wallet = await tx.wallet.findUnique({ where: { userId: payout.userId } });
      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { frozenBalance: { decrement: payout.amount } }
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: "PAYOUT",
            amount: -payout.amount,
            status: "COMPLETED",
            payoutId: payout.id,
            note: "Payout to'landi"
          }
        });
      }
    });
    await createNotification(
      payout.userId,
      "PAYOUT_APPROVED",
      "Payout tasdiqlandi ✅",
      `${formatUZS(payout.amount)} miqdoridagi pulingiz ${payout.cardNumber.slice(-4)} bilan tugovchi kartaga o'tkazildi.`
    );
    await editAdminMessage(bot, chatId, messageId, query.message?.text || "", "✅ To'landi");
    try {
      await bot.answerCallbackQuery(query.id, { text: "✅ To'landi" });
    } catch {
    }
  } else if (action === "reject") {
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: "REJECTED",
          processedAt: /* @__PURE__ */ new Date(),
          processedBy: admin?.id ?? null,
          rejectReason: "Admin tomonidan rad etildi"
        }
      });
      const wallet = await tx.wallet.findUnique({ where: { userId: payout.userId } });
      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            frozenBalance: { decrement: payout.amount },
            balance: { increment: payout.amount }
          }
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: "ADJUSTMENT",
            amount: payout.amount,
            status: "COMPLETED",
            payoutId: payout.id,
            note: "Payout rad etildi — pul qaytarildi"
          }
        });
      }
    });
    await createNotification(
      payout.userId,
      "PAYOUT_REJECTED",
      "Payout rad etildi ❌",
      `${formatUZS(payout.amount)} miqdoridagi yechib olish so'rovingiz rad etildi. Pul balansingizga qaytarildi.`
    );
    await editAdminMessage(bot, chatId, messageId, query.message?.text || "", "❌ Rad etildi");
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ Rad etildi" });
    } catch {
    }
  }
}
async function handleDisputeCallback(bot, query, disputeId, action, chatId, messageId, adminTgId) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { order: true }
  });
  if (!dispute) {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Dispute topilmadi", show_alert: true });
    } catch {
    }
    return;
  }
  if (dispute.status !== "OPEN") {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Dispute allaqachon yopilgan", show_alert: true });
    } catch {
    }
    return;
  }
  const admin = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTgId) }, select: { id: true } });
  const order = dispute.order;
  if (action === "resolve_adv") {
    await refundEscrow(order.id);
    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: "RESOLVED_ADVERTISER",
        refundAmount: order.price,
        resolvedAt: /* @__PURE__ */ new Date(),
        resolvedBy: admin?.id ?? null,
        resolution: "Mijoz foydasiga hal qilindi — to'liq refund"
      }
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "REFUNDED" }
    });
    await createNotification(
      order.advertiserId,
      "ORDER_DISPUTED",
      "Shikoyat hal qilindi ✅",
      `Buyurtma #${order.id} bo'yicha to'liq pul qaytarildi (${formatUZS(order.price)}).`
    );
    await editAdminMessage(bot, chatId, messageId, query.message?.text || "", "✅ Mijoz foydasiga");
    try {
      await bot.answerCallbackQuery(query.id, { text: "✅ Mijoz foydasiga" });
    } catch {
    }
  } else if (action === "resolve_own") {
    await releaseEscrow(order.id);
    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: "RESOLVED_OWNER",
        refundAmount: 0,
        resolvedAt: /* @__PURE__ */ new Date(),
        resolvedBy: admin?.id ?? null,
        resolution: "Akkaunt egasi foydasiga hal qilindi"
      }
    });
    const owner = await prisma.adAccount.findUnique({
      where: { id: order.adAccountId },
      select: { ownerId: true }
    });
    if (owner) {
      await createNotification(
        owner.ownerId,
        "ORDER_COMPLETED",
        "Shikoyat hal qilindi ✅",
        `Buyurtma #${order.id} bo'yicha pul sizga ozod qilindi (${formatUZS(order.escrowAmount)}).`
      );
    }
    await editAdminMessage(bot, chatId, messageId, query.message?.text || "", "✅ Egasi foydasiga");
    try {
      await bot.answerCallbackQuery(query.id, { text: "✅ Egasi foydasiga" });
    } catch {
    }
  } else if (action === "partial") {
    const partialRefund = Math.round(order.price / 2);
    await refundEscrow(order.id, partialRefund);
    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: "RESOLVED_PARTIAL",
        refundAmount: partialRefund,
        resolvedAt: /* @__PURE__ */ new Date(),
        resolvedBy: admin?.id ?? null,
        resolution: `Qisman refund: ${formatUZS(partialRefund)}`
      }
    });
    await createNotification(
      order.advertiserId,
      "ORDER_DISPUTED",
      "Shikoyat qisman hal qilindi",
      `Buyurtma #${order.id} bo'yicha ${formatUZS(partialRefund)} qaytarildi.`
    );
    await editAdminMessage(bot, chatId, messageId, query.message?.text || "", "✅ Qisman refund");
    try {
      await bot.answerCallbackQuery(query.id, { text: "✅ Qisman refund" });
    } catch {
    }
  }
}
async function editAdminMessage(bot, chatId, messageId, originalText, suffix) {
  try {
    await bot.editMessageText(`${originalText}

— ${suffix}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    });
  } catch (err) {
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: messageId }
      );
    } catch {
    }
  }
}
function formatUZS(amount) {
  return new Intl.NumberFormat("uz-UZ").format(amount) + " UZS";
}
export {
  initMarketplaceBot
};
//# sourceMappingURL=bot-marketplace-CqbIvtVZ.js.map
