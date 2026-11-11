// @SaveAsBot session pool — instagram-single zanjirining oxirgi fallback'i.
// 5 ta Telegram sessioniga doim ulanib turadi (persistent connection), round-robin tarzda
// URL yuborib caption qaytarib oladi.

import fs from "fs";
import path from "path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

const API_ID = Number(process.env.TG_API_ID || 2040);
const API_HASH = process.env.TG_API_HASH || "b18441a1ff607e10a989891a5462e627";
const TARGET_BOT = process.env.SAVEASBOT_USERNAME || "SaveAsBot";
const SESSIONS_DIR = path.join(process.cwd(), "server", "saveasbot-sessions");

// Akkaunt eng ko'pi bilan shuncha vaqt band tura oladi. Undan oshsa — tarmoq chaqiruvi
// osilib qolgan deb hisoblab, qulfni majburan bo'shatamiz (stuck-lock reclaim).
const MAX_LOCK_MS = 35000;

// Promise'ga qat'iy timeout — GramJS tarmoq chaqiruvlari (getMessages/invoke) uzilgan
// ulanishda cheksiz osilib qolishi mumkin; shuni oldini olamiz.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

// SaveAsBot post'ga kirish iloji bo'lmaganda (private/restricted/age-gated/deleted)
// shu xatoni ko'taramiz. Upstream uni Uzbekcha foydalanuvchi xabariga aylantiradi.
export class InaccessiblePostError extends Error {
  constructor(public readonly originalText: string) {
    super('Post inaccessible');
    this.name = 'InaccessiblePostError';
  }
}

const CAPTION_BUTTON_RE = /получить текст поста|текст поста|get text|post text/i;
const PROMPT_RE = /нажмите.*получить|click.*to get|tap.*to get/i;
// Bot'ning ishlov xabarlari — "Yuklanmoqda... Kuting!", "Processing..." va h.k.
const LOADING_RE = /выгружается|ожидайте|обрабатываем|загружаем|подождите|загрузка|processing|please wait|loading\.\.\.|uploading/i;
const BOT_SIG_RE = /рад был помочь|спасибо.*saveasbot|your.*saveasbot/i;
const PROMO_RE = /поддержать автора|донат|бонусная подписка|семейка ботов|отключение рекламы|нравится бот|присоединяйтесь/i;
// SaveAsBot'ning xato/diagnostika xabarlari — caption emas, foydalanuvchiga ko'rsatmaymiz.
const ERROR_RE = /не удалось получить|не удалось загрузить|закрытый.*аккаунт|приватный аккаунт|возрастные ограничения|как исправить|ошибка в получении|account is private|private account|age.restrict|failed to fetch|could not (?:fetch|get|find)|sorry,? .*(can'?t|unable)/i;
// Rate limit: "Вы очень часто отправляете ссылки..." — bot bizdan ko'p so'rov olganini aytyapti
const RATE_LIMIT_RE = /очень часто отправляете|не более \d+ ссылк|каждые \d+ секунд|too many requests|rate limit|подождите.*секунд|повторите.*через/i;

export class RateLimitedError extends Error {
  constructor(public retryAfterMs: number = 5000) {
    super('SaveAsBot rate limit');
    this.name = 'RateLimitedError';
  }
}

function looksLikeCaption(text: string, hasMedia: boolean, hasButtons: boolean): boolean {
  if (!text || !text.trim()) return false;
  if (hasMedia) return false;
  if (PROMPT_RE.test(text)) return false;
  if (LOADING_RE.test(text)) return false;
  if (BOT_SIG_RE.test(text)) return false;
  if (PROMO_RE.test(text)) return false;
  if (ERROR_RE.test(text)) return false;
  if (RATE_LIMIT_RE.test(text)) return false;
  return true;
}

interface PooledAccount {
  name: string;
  client: TelegramClient;
  bot: any;
  inUse: boolean;
  lastUsed: number;
}

class SaveAsBotPool {
  private accounts: PooledAccount[] = [];
  private rrIndex = 0;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (!fs.existsSync(SESSIONS_DIR)) {
      console.warn(`⚠️  SaveAsBot: ${SESSIONS_DIR} topilmadi`);
      return;
    }
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".session"));
    if (files.length === 0) {
      console.warn(`⚠️  SaveAsBot: ${SESSIONS_DIR} ichida session fayllari yo'q`);
      return;
    }

    for (const file of files) {
      const name = path.basename(file, ".session");
      try {
        const sessionStr = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf8").trim();
        const client = new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH, {
          connectionRetries: 3,
        });
        // @ts-ignore — GramJS log level
        client.setLogLevel?.("none");
        await client.connect();
        const bot = await client.getEntity(TARGET_BOT);
        this.accounts.push({ name, client, bot, inUse: false, lastUsed: 0 });
        console.log(`🤖 SaveAsBot: ${name} ulandi`);
      } catch (err: any) {
        console.error(`❌ SaveAsBot ${name}:`, err?.message || err);
      }
    }
    console.log(`🤖 SaveAsBot pool: ${this.accounts.length}/${files.length} sessiya tayyor`);
  }

  isReady(): boolean {
    return this.accounts.length > 0;
  }

  private acquire(): PooledAccount | null {
    if (this.accounts.length === 0) return null;
    // Stuck-lock reclaim: juda uzoq band turgan akkauntni majburan bo'shatamiz.
    // (osilib qolgan tarmoq chaqiruvi tufayli inUse abadiy true qolib ketishining oldini oladi)
    const now = Date.now();
    for (const acc of this.accounts) {
      if (acc.inUse && now - acc.lastUsed > MAX_LOCK_MS) {
        console.warn(`🤖 SaveAsBot: ${acc.name} qulfi ${((now - acc.lastUsed) / 1000).toFixed(0)}s dan oshdi — majburan bo'shatildi`);
        acc.inUse = false;
      }
    }
    // Bo'sh akkauntni round-robin tarzda izlash
    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.rrIndex + i) % this.accounts.length;
      const acc = this.accounts[idx];
      if (!acc.inUse) {
        this.rrIndex = (idx + 1) % this.accounts.length;
        acc.inUse = true;
        acc.lastUsed = Date.now();
        return acc;
      }
    }
    // Hammasi band — eng kam ishlatilganni tanlash (kutuv navbati o'rniga)
    return null;
  }

  // Akkaunt ulanishini tekshirib, uzilgan bo'lsa qayta ulaymiz (qat'iy timeout bilan).
  private async ensureConnected(acc: PooledAccount): Promise<void> {
    try {
      if (acc.client.connected) return;
      console.warn(`🤖 SaveAsBot: ${acc.name} uzilgan — qayta ulanmoqda`);
      await withTimeout(acc.client.connect(), 8000, "connect");
      acc.bot = await withTimeout(acc.client.getEntity(TARGET_BOT), 8000, "getEntity");
    } catch (err: any) {
      console.error(`🤖 SaveAsBot: ${acc.name} qayta ulanish xatosi — ${err?.message || err}`);
    }
  }

  async fetchCaption(url: string, timeoutMs = 20000): Promise<string | null> {
    await this.init();
    if (this.accounts.length === 0) return null;

    // Bo'sh akkaunt kutish (max 8s)
    const acquireDeadline = Date.now() + 8000;
    let acc: PooledAccount | null = null;
    while (Date.now() < acquireDeadline) {
      acc = this.acquire();
      if (acc) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!acc) {
      console.log("🤖 SaveAsBot: barcha akkauntlar band, navbat to'ldi");
      return null;
    }

    const t0 = Date.now();
    try {
      // Ulanishni tekshirib, kerak bo'lsa tiklaymiz
      await this.ensureConnected(acc);
      // Qat'iy timeout: doFetch ichidagi tarmoq chaqiruvi osilib qolsa ham, akkaunt
      // MAJBURAN bo'shaydi (finally). Aks holda bitta osilgan so'rov butun poolni bloklaydi.
      const result = await withTimeout(
        this.doFetch(acc, url, timeoutMs),
        timeoutMs + 6000,
        "doFetch",
      );
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (result) {
        console.log(`🤖 SaveAsBot: caption olindi (${acc.name}, ${elapsed}s, ${result.length}b)`);
      } else {
        console.log(`🤖 SaveAsBot: caption olinmadi (${acc.name}, ${elapsed}s)`);
      }
      return result;
    } catch (err: any) {
      if (err instanceof InaccessiblePostError) {
        console.log(`🤖 SaveAsBot: post-ga kirish iloji yo'q (${acc.name})`);
        throw err;
      }
      console.error(`🤖 SaveAsBot xato (${acc.name}):`, err?.message || err);
      return null;
    } finally {
      acc.inUse = false;
    }
  }

  private async doFetch(acc: PooledAccount, url: string, timeoutMs: number): Promise<string | null> {
    const { client, bot } = acc;
    const overallDeadline = Date.now() + timeoutMs;

    // 1. URL yuborish (MSGID_DECREASE_RETRY ga 1 marta retry)
    let sentMsg: any;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        sentMsg = await client.sendMessage(bot, { message: url });
        break;
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (attempt < 2 && /MSGID_DECREASE_RETRY|MSG_ID_TOO_LOW/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw err;
      }
    }
    if (!sentMsg) return null;
    const sentMsgId = sentMsg.id;

    // 2. Bot javobini event handler orqali kutish (push, polling emas)
    let buttonMsg: { msg: any; data: Buffer } | null = null;
    let directCaption: string | null = null;
    let inaccessibleText: string | null = null;
    let rateLimited = false;
    let resolveListener: () => void = () => {};
    const listenerPromise = new Promise<void>((r) => (resolveListener = r));

    const handler = async (event: any) => {
      const m = event.message;
      if (!m || m.out) return;
      if (m.peerId?.userId?.toString() !== bot.id.toString()) return;
      if (m.id <= sentMsgId) return;
      const text = m.message || "";
      const hasMedia = !!m.media;
      const hasButtons = !!m.replyMarkup;

      if (hasButtons && !hasMedia && m.replyMarkup?.rows) {
        const buttons = m.replyMarkup.rows.flatMap((r: any) => r.buttons || []);
        const captionBtn = buttons.find((b: any) => CAPTION_BUTTON_RE.test(b.text || ""));
        if (captionBtn && captionBtn.data) {
          buttonMsg = { msg: m, data: captionBtn.data };
          resolveListener();
          return;
        }
      }
      // Rate limit — bot bizni juda ko'p so'rov bilan jo'natyapti deydi.
      // Bu vaqtinchalik, upstream'ga retry signali yuboramiz.
      if (RATE_LIMIT_RE.test(text)) {
        rateLimited = true;
        resolveListener();
        return;
      }
      // Post'ga kirish iloji yo'qligi haqida xato xabari — Puppeteer ham yordam bermaydi,
      // shuning uchun darhol upstream'ga signal yuboramiz.
      if (ERROR_RE.test(text) && !looksLikeCaption(text, hasMedia, hasButtons)) {
        inaccessibleText = text;
        resolveListener();
        return;
      }
      if (looksLikeCaption(text, hasMedia, hasButtons)) {
        directCaption = text;
        resolveListener();
      }
    };

    const event = new NewMessage({ chats: [bot.id] });
    client.addEventHandler(handler, event);

    const tWait = Math.min(15000, Math.max(2000, overallDeadline - Date.now() - 5000));
    const waitTimeout = setTimeout(() => resolveListener(), tWait);
    await listenerPromise;
    clearTimeout(waitTimeout);
    client.removeEventHandler(handler, event);

    if (directCaption) return directCaption;
    if (rateLimited) throw new RateLimitedError(5000);
    if (inaccessibleText) throw new InaccessiblePostError(inaccessibleText);
    if (!buttonMsg) return null;

    // 3. Tugmani bosish (CallbackQuery)
    try {
      await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: bot,
          msgId: buttonMsg.msg.id,
          data: buttonMsg.data,
        }),
      );
    } catch (err: any) {
      console.log(`🤖 SaveAsBot: callback xato — ${err?.message}`);
    }

    // 4. Bot xabarni edit qilishini kutish (poll, ~600ms interval)
    const editDeadline = Math.min(Date.now() + 10000, overallDeadline);
    const origText = buttonMsg.msg.message || "";
    while (Date.now() < editDeadline) {
      try {
        const messages = await client.getMessages(bot, { ids: [buttonMsg.msg.id] });
        const m: any = messages[0];
        if (m && m.message && m.message !== origText) {
          if (RATE_LIMIT_RE.test(m.message)) throw new RateLimitedError(5000);
          if (looksLikeCaption(m.message, !!m.media, !!m.replyMarkup)) {
            return m.message;
          }
        }
      } catch (e) {
        if (e instanceof RateLimitedError) throw e;
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  }

  async shutdown(): Promise<void> {
    for (const acc of this.accounts) {
      try {
        await acc.client.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.accounts = [];
  }
}

export const saveAsBotPool = new SaveAsBotPool();
