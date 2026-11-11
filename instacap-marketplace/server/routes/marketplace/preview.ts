import { RequestHandler } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import TelegramBot from "node-telegram-bot-api";
import { getBot, getAdminIds } from "../../bot";

/**
 * POST /api/marketplace/preview-submit
 *
 * Preview/demo AddAccount oqimi:
 *  • Adminga albom (sendMediaGroup) + alohida xabar inline tugmalar bilan.
 *  • Tasdiq/Rad/Narx tugmalari real ishlaydi (chunki preview-bot.ts handler bor).
 *  • Rad bosilsa — albom + tugmali xabar O'CHIRILADI.
 *  • Narx belgilangach — Tasdiq tugmasi ishga tushadi.
 */

// ===== Submission holati (in-memory) =====
interface PreviewSubmission {
  id: string;
  adminChatId: number;
  username: string;
  mediaGroupMsgIds: number[];
  buttonsMsgId: number;
  priceMsgId?: number;
  price?: number;
}
const submissions = new Map<string, PreviewSubmission>();
const awaitingPrice = new Map<number, string>(); // adminChatId → submissionId

// ===== Utillar =====
function bufToTmpSync(buf: Buffer, ext: string): string {
  const p = path.join(
    os.tmpdir(),
    `mkt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
  );
  fs.writeFileSync(p, buf);
  return p;
}
function pickExt(mime: string): string {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}
function buildButtons(id: string, hasPrice: boolean) {
  const row1 = hasPrice
    ? [
        { text: "✅ Tasdiqlash", callback_data: `mkt:preview:approve:${id}` },
        { text: "❌ Rad etish", callback_data: `mkt:preview:reject:${id}` },
      ]
    : [{ text: "❌ Rad etish", callback_data: `mkt:preview:reject:${id}` }];
  const row2 = [
    {
      text: hasPrice ? "💰 Narxni o'zgartirish" : "💰 Narx belgilash",
      callback_data: `mkt:preview:price:${id}`,
    },
  ];
  return { inline_keyboard: [row1, row2] };
}
function captionFor(sub: PreviewSubmission): string {
  const priceLine = sub.price
    ? `\n💰 <b>${sub.price.toLocaleString("uz-UZ")} so'm</b>`
    : "";
  const hint = sub.price
    ? "\n\n<i>Narx belgilangan. Tasdiqlang yoki rad eting.</i>"
    : "\n\n<i>Avval narx belgilang, keyin tasdiqlash mumkin.</i>";
  return (
    `🆕 <b>Yangi e'lon arizasi</b>\n\n👤 <b>@${sub.username}</b>${priceLine}` +
    hint
  );
}

// ===== HTTP handler =====
export const handlePreviewSubmitAccount: RequestHandler = async (req, res) => {
  const tmpFiles: string[] = [];
  try {
    const {
      igUsername,
      avatarFileId,
      storyViewsScreenshot,
      audienceCountriesScreenshot,
      followersScreenshot,
    } = (req.body || {}) as Record<string, string>;

    console.log(
      `📨 preview-submit: @${igUsername} | body ~${JSON.stringify(req.body || {}).length} bayt`,
    );

    if (!igUsername || igUsername.trim().length < 2) {
      res.status(400).json({ success: false, error: "igUsername talab qilinadi" });
      return;
    }

    const bot = getBot();
    const admins = getAdminIds();
    if (!bot || admins.length === 0) {
      res.status(503).json({ success: false, error: "Bot sozlanmagan" });
      return;
    }

    const uname = String(igUsername).replace(/^@/, "");
    const items: Array<{ name: string; url?: string }> = [
      { name: "Avatar", url: avatarFileId },
      { name: "Istori arxivi (1 kunlik ko'rishlar)", url: storyViewsScreenshot },
      { name: "Qaysi davlatlar kuzatadi", url: audienceCountriesScreenshot },
      { name: "Obunachilar soni (profil skrini)", url: followersScreenshot },
    ];

    const media: any[] = [];
    for (const it of items) {
      const u = it.url;
      if (!u) continue;
      try {
        if (u.startsWith("data:")) {
          const m = /^data:([^;]+);base64,(.+)$/.exec(u);
          if (m) {
            const buf = Buffer.from(m[2], "base64");
            const tmp = bufToTmpSync(buf, pickExt(m[1]));
            tmpFiles.push(tmp);
            media.push({
              type: "photo",
              media: fs.createReadStream(tmp),
              caption: it.name,
            });
          }
        } else if (/^https?:/.test(u)) {
          media.push({ type: "photo", media: u, caption: it.name });
        }
      } catch (e) {
        console.warn(
          `   ⚠️ ${it.name}: tayyorlash xato:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // submission id — har bir ariza uchun yagona
    const subId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    for (const adminId of admins) {
      try {
        const mediaGroupMsgIds: number[] = [];
        if (media.length >= 2) {
          const sent = (await bot.sendMediaGroup(adminId, media)) as any[];
          for (const m of sent || []) {
            if (m && typeof m.message_id === "number") mediaGroupMsgIds.push(m.message_id);
          }
          console.log(
            `   🖼  sendMediaGroup(${media.length}) → ${adminId} OK [${mediaGroupMsgIds.join(",")}]`,
          );
        } else if (media.length === 1) {
          const m = (await bot.sendPhoto(adminId, media[0].media, {
            caption: media[0].caption,
          })) as any;
          if (m?.message_id) mediaGroupMsgIds.push(m.message_id);
        }

        const sub: PreviewSubmission = {
          id: subId,
          adminChatId: adminId,
          username: uname,
          mediaGroupMsgIds,
          buttonsMsgId: 0,
        };
        const btnMsg = (await bot.sendMessage(adminId, captionFor(sub), {
          parse_mode: "HTML",
          reply_markup: buildButtons(subId, false) as any,
        })) as any;
        sub.buttonsMsgId = btnMsg?.message_id || 0;
        submissions.set(subId, sub);
        console.log(`   ✉️  buttons msg=${sub.buttonsMsgId} → ${adminId} OK (id=${subId})`);
      } catch (e) {
        console.error(
          "preview admin notify fail:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    res.json({ success: true, id: subId });
  } catch (err: any) {
    console.error("preview-submit fatal:", err?.message);
    res
      .status(500)
      .json({ success: false, error: err?.message || "Server xato" });
  } finally {
    // tmp fayllarni bir oz keyin tozalash (sendMediaGroup stream'lari oqishi mumkin)
    setTimeout(() => {
      for (const p of tmpFiles) fs.promises.unlink(p).catch(() => {});
    }, 30_000);
  }
};

// ===== Bot handler'larini ulash =====
export function initPreviewBot(bot: TelegramBot): void {
  // Callback query — mkt:preview:* prefixi
  bot.on("callback_query", async (q) => {
    try {
      const data = q.data || "";
      if (!data.startsWith("mkt:preview:")) return; // boshqa handler'larga tegmaymiz
      const parts = data.split(":");
      const action = parts[2];
      const id = parts.slice(3).join(":");
      const sub = submissions.get(id);
      const chatId = q.message?.chat.id;

      if (!sub || !chatId) {
        await bot
          .answerCallbackQuery(q.id, {
            text: "Bu ariza muddati o'tdi yoki bekor qilingan.",
            show_alert: false,
          })
          .catch(() => {});
        return;
      }

      if (action === "approve") {
        if (!sub.price) {
          await bot
            .answerCallbackQuery(q.id, {
              text: "Avval narx belgilang!",
              show_alert: true,
            })
            .catch(() => {});
          return;
        }
        // Tugmali xabarni "Tasdiqlandi"ga yangilaymiz (inline tugmalar olib tashlanadi)
        await bot
          .editMessageText(
            `✅ <b>Tasdiqlandi</b>\n\n👤 @${sub.username}\n💰 ${sub.price.toLocaleString("uz-UZ")} so'm\n\n<i>E'lon foydalanuvchiga yuboriladi (real oqimda).</i>`,
            {
              chat_id: chatId,
              message_id: sub.buttonsMsgId,
              parse_mode: "HTML",
            },
          )
          .catch(() => {});
        await bot.answerCallbackQuery(q.id, { text: "✅ Tasdiqlandi" }).catch(() => {});
        submissions.delete(id);
      } else if (action === "reject") {
        // Albom + tugmali xabarni butunlay o'chiramiz
        for (const mid of sub.mediaGroupMsgIds) {
          await bot.deleteMessage(chatId, mid).catch(() => {});
        }
        await bot.deleteMessage(chatId, sub.buttonsMsgId).catch(() => {});
        if (sub.priceMsgId) {
          await bot.deleteMessage(chatId, sub.priceMsgId).catch(() => {});
        }
        await bot
          .answerCallbackQuery(q.id, { text: "❌ Rad etildi va o'chirildi" })
          .catch(() => {});
        submissions.delete(id);
        awaitingPrice.delete(chatId);
      } else if (action === "price") {
        awaitingPrice.set(chatId, id);
        const ask = (await bot.sendMessage(
          chatId,
          `💰 <b>Narxni so'mda yuboring</b> (raqam, masalan: <code>250000</code>)\n\n👤 @${sub.username}`,
          {
            parse_mode: "HTML",
            reply_markup: { force_reply: true } as any,
          },
        )) as any;
        sub.priceMsgId = ask?.message_id;
        await bot.answerCallbackQuery(q.id).catch(() => {});
      } else {
        await bot.answerCallbackQuery(q.id).catch(() => {});
      }
    } catch (e) {
      console.error(
        "preview callback handler error:",
        e instanceof Error ? e.message : e,
      );
    }
  });

  // Message — narx kutilayotgan admin yuborgan raqam
  bot.on("message", async (msg) => {
    try {
      if (!msg?.chat || !msg.text || msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const subId = awaitingPrice.get(chatId);
      if (!subId) return;
      const sub = submissions.get(subId);
      if (!sub) {
        awaitingPrice.delete(chatId);
        return;
      }
      const cleaned = msg.text.replace(/[\s,_]/g, "").trim();
      const n = Number(cleaned);
      if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) {
        await bot
          .sendMessage(chatId, "❌ To'g'ri raqam emas. Faqat raqam (so'm) yuboring.")
          .catch(() => {});
        return;
      }
      sub.price = n;
      awaitingPrice.delete(chatId);
      // tugmali xabarni yangilaymiz (price + Tasdiqlash tugmasi qo'shiladi)
      await bot
        .editMessageText(captionFor(sub), {
          chat_id: chatId,
          message_id: sub.buttonsMsgId,
          parse_mode: "HTML",
          reply_markup: buildButtons(subId, true) as any,
        })
        .catch(() => {});
      // "narx so'rovi" xabarini tozalaymiz (ixchamroq ko'rinish)
      if (sub.priceMsgId) {
        await bot.deleteMessage(chatId, sub.priceMsgId).catch(() => {});
        sub.priceMsgId = undefined;
      }
      // admin yuborgan raqam xabarni ham olib tashlaymiz
      await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
      console.log(`   💰 narx o'rnatildi: ${sub.username} = ${n} so'm (id=${subId})`);
    } catch (e) {
      console.error(
        "preview price-listener error:",
        e instanceof Error ? e.message : e,
      );
    }
  });

  console.log("✅ Preview bot handlers registered (mkt:preview:*)");
}
