import { setupAuctionAndDemoRoutes } from "./auction_routes.mjs";
import path from "path";
import "dotenv/config";
import * as express from "express";
import express__default from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import fs from "fs";
import PQueue from "p-queue";
import NodeCache from "node-cache";
import mongoose, { Schema } from "mongoose";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import TelegramBot from "node-telegram-bot-api";
import { z } from "zod";
import os from "os";
const handleDemo = (req, res) => {
  const response = {
    message: "Hello from Express server"
  };
  res.status(200).json(response);
};
const ANALYTICS_FILE = path.join(process.cwd(), "analytics.json");
const COUNTER_FILE = path.join(process.cwd(), "analytics-counter.json");
function readCounter() {
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, "utf-8"));
  } catch {
    let totalEvents = 0;
    let totalExtractions = 0;
    let firstEventAt = Date.now();
    let approximate = false;
    try {
      const d = JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8"));
      const evs = Array.isArray(d.events) ? d.events : [];
      totalEvents = evs.length;
      totalExtractions = evs.filter((e) => e.type === "caption_extracted").length;
      if (evs.length > 0) firstEventAt = evs[0].timestamp;
      if (evs.length >= 1e4) approximate = true;
    } catch {
    }
    const init = { totalEvents, totalExtractions, firstEventAt, approximate };
    try {
      fs.writeFileSync(COUNTER_FILE, JSON.stringify(init, null, 2));
    } catch {
    }
    return init;
  }
}
function writeCounter(c) {
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(c, null, 2));
  } catch (e) {
    console.error("counter write fail:", e);
  }
}
function initAnalyticsFile() {
  if (!fs.existsSync(ANALYTICS_FILE)) {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify({ events: [] }, null, 2));
  }
}
function trackEvent(event) {
  try {
    initAnalyticsFile();
    const data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8"));
    data.events.push(event);
    if (data.events.length > 1e4) {
      data.events = data.events.slice(-1e4);
    }
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2));
    const counter = readCounter();
    counter.totalEvents += 1;
    if (event.type === "caption_extracted") counter.totalExtractions += 1;
    if (event.type === "bio_downloaded") counter.totalBioDownloads = (counter.totalBioDownloads || 0) + 1;
    writeCounter(counter);
  } catch (error) {
    console.error("Error tracking event:", error);
  }
}
function getAnalytics() {
  try {
    initAnalyticsFile();
    const data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8"));
    return data.events;
  } catch (error) {
    console.error("Error reading analytics:", error);
    return [];
  }
}
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1e3;
function startOfTashkentDayMs(daysAgo = 0) {
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const d = nowTashkent.getUTCDate() - daysAgo;
  return Date.UTC(y, m, d) - TASHKENT_OFFSET_MS;
}
function getDailyStats() {
  const events = getAnalytics();
  const todayStart = startOfTashkentDayMs(0);
  const todayEvents = events.filter((e) => e.timestamp >= todayStart);
  const captionExtractions = todayEvents.filter((e) => e.type === "caption_extracted");
  return {
    totalExtractions: captionExtractions.length,
    totalVisits: todayEvents.length
  };
}
function getAllTimeStats() {
  const counter = readCounter();
  return {
    totalExtractions: counter.totalExtractions,
    totalVisits: counter.totalEvents,
    firstEventAt: counter.firstEventAt,
    approximate: !!counter.approximate
  };
}
function getWeeklyStats() {
  const events = getAnalytics();
  const weekStart = startOfTashkentDayMs(7);
  const weekEvents = events.filter((e) => e.timestamp >= weekStart);
  const captionExtractions = weekEvents.filter((e) => e.type === "caption_extracted");
  return {
    totalExtractions: captionExtractions.length,
    totalVisits: weekEvents.length
  };
}
function getBioStats() {
  const events = getAnalytics().filter((e) => e.type === "bio_downloaded");
  const counter = readCounter();
  const todayStart = startOfTashkentDayMs(0);
  const weekStart = startOfTashkentDayMs(7);
  const today = events.filter((e) => e.timestamp >= todayStart);
  const week = events.filter((e) => e.timestamp >= weekStart);
  const uniq = (list) => new Set(list.map((e) => e.userId).filter(Boolean)).size;
  return {
    today: today.length,
    todayUsers: uniq(today),
    week: week.length,
    weekUsers: uniq(week),
    allTime: counter.totalBioDownloads || 0
  };
}
function getHourlyDistribution() {
  const events = getAnalytics();
  const todayStart = startOfTashkentDayMs(0);
  const todayEvents = events.filter(
    (e) => e.timestamp >= todayStart && e.type === "caption_extracted"
  );
  const hourlyData = {};
  for (let i = 0; i < 24; i++) hourlyData[i] = 0;
  todayEvents.forEach((event) => {
    const hour = new Date(event.timestamp + TASHKENT_OFFSET_MS).getUTCHours();
    hourlyData[hour]++;
  });
  return hourlyData;
}
function getPeakHour() {
  const hourlyData = getHourlyDistribution();
  let maxHour = 0;
  let maxCount = 0;
  Object.entries(hourlyData).forEach(([hour, count]) => {
    if (count > maxCount) {
      maxCount = count;
      maxHour = parseInt(hour);
    }
  });
  return { hour: maxHour, count: maxCount };
}
const VIDEO_ANALYTICS_FILE = process.env.VIDEO_ANALYTICS_FILE || "/var/www/vidoctorai/video_analytics.json";
function getVideoEvents() {
  try {
    if (!fs.existsSync(VIDEO_ANALYTICS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(VIDEO_ANALYTICS_FILE, "utf-8"));
    return data.events || [];
  } catch (error) {
    console.error("Error reading video analytics:", error);
    return [];
  }
}
function getVideoStats() {
  const events = getVideoEvents().filter((e) => e.type === "video_analyzed");
  const todayStart = startOfTashkentDayMs(0);
  const weekStart = startOfTashkentDayMs(7);
  const monthStart = startOfTashkentDayMs(30);
  const hourAgo = Date.now() - 60 * 60 * 1e3;
  const today = events.filter((e) => e.timestamp >= todayStart);
  const week = events.filter((e) => e.timestamp >= weekStart);
  const month = events.filter((e) => e.timestamp >= monthStart);
  const lastHour = events.filter((e) => e.timestamp >= hourAgo);
  const uniq = (list) => new Set(list.map((e) => e.userId).filter(Boolean)).size;
  const avgViral = (list) => {
    const vals = list.map((e) => e.viral).filter((v) => typeof v === "number");
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  return {
    total: events.length,
    totalUsers: uniq(events),
    lastHour: lastHour.length,
    today: today.length,
    todayUsers: uniq(today),
    week: week.length,
    weekUsers: uniq(week),
    month: month.length,
    monthUsers: uniq(month),
    avgViralToday: avgViral(today),
    avgViralAll: avgViral(events)
  };
}
function getVideoHourlyDistribution() {
  const events = getVideoEvents().filter((e) => e.type === "video_analyzed");
  const todayStart = startOfTashkentDayMs(0);
  const hourlyData = {};
  for (let i = 0; i < 24; i++) hourlyData[i] = 0;
  events.filter((e) => e.timestamp >= todayStart).forEach((e) => {
    const hour = new Date(e.timestamp + TASHKENT_OFFSET_MS).getUTCHours();
    hourlyData[hour]++;
  });
  return hourlyData;
}
const captionQueue = new PQueue({
  concurrency: 8,
  timeout: 6e4
  // 60 soniya timeout (barqarorroq ishlashi uchun)
});
const captionCache = new NodeCache({
  stdTTL: 3600,
  // 1 soat
  checkperiod: 600,
  // Har 10 daqiqada eski ma'lumotlarni tozalash
  useClones: false
});
function getCachedCaption(url) {
  return captionCache.get(url);
}
function setCachedCaption(url, caption) {
  captionCache.set(url, caption);
}
const bioCache = new NodeCache({
  stdTTL: 3600,
  // 1 soat
  checkperiod: 600,
  useClones: false
});
function getCachedBio(username) {
  return bioCache.get(username.toLowerCase());
}
function setCachedBio(username, data, ttlSeconds) {
  if (ttlSeconds !== void 0) {
    bioCache.set(username.toLowerCase(), data, ttlSeconds);
  } else {
    bioCache.set(username.toLowerCase(), data);
  }
}
const MAX_BROWSERS = 2;
const MAX_PAGES_PER_BROWSER = 5;
const IDLE_TIMEOUT = 5 * 60 * 1e3;
const CLEANUP_INTERVAL = 60 * 1e3;
const PAGE_WAIT_TIMEOUT = 15e3;
const PAGE_WAIT_INTERVAL = 200;
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
  "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];
const BLOCKED_RESOURCE_TYPES = /* @__PURE__ */ new Set([
  "image",
  "stylesheet",
  "font",
  "media",
  "texttrack",
  "manifest"
]);
class BrowserPool {
  browsers = /* @__PURE__ */ new Map();
  puppeteerModule = null;
  initPromise = null;
  cleanupTimer = null;
  shuttingDown = false;
  constructor() {
    this.startCleanupTimer();
  }
  async init() {
    if (this.puppeteerModule) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const mod = await import("puppeteer").catch(() => null);
      if (!mod) {
        throw new Error("Puppeteer is not installed. Run: pnpm add puppeteer");
      }
      this.puppeteerModule = mod;
    })();
    return this.initPromise;
  }
  async launchBrowser() {
    await this.init();
    const browser = await this.puppeteerModule.launch({
      headless: true,
      args: LAUNCH_ARGS
    });
    const id = Math.random().toString(36).substring(2, 8);
    const pooled = {
      browser,
      pageCount: 0,
      lastUsed: Date.now(),
      id
    };
    this.browsers.set(id, pooled);
    console.log(`🌐 Browser pool: launched new browser (id: ${id}, total: ${this.browsers.size})`);
    return pooled;
  }
  // Jami ochiq pagelar sonini hisoblash
  getTotalPageCount() {
    let total = 0;
    for (const [, pooled] of this.browsers) {
      total += pooled.pageCount;
    }
    return total;
  }
  // Sig'imi bor brauzerni topish
  findAvailableBrowser() {
    for (const [, pooled] of this.browsers) {
      if (pooled.pageCount < MAX_PAGES_PER_BROWSER) {
        return pooled;
      }
    }
    return null;
  }
  async acquirePage() {
    if (this.shuttingDown) {
      throw new Error("Browser pool is shutting down");
    }
    const available = this.findAvailableBrowser();
    if (available) {
      available.pageCount++;
      available.lastUsed = Date.now();
      const page = await available.browser.newPage();
      await this.configureResourceBlocking(page);
      return { page, browserId: available.id };
    }
    if (this.browsers.size < MAX_BROWSERS) {
      const pooled = await this.launchBrowser();
      pooled.pageCount++;
      pooled.lastUsed = Date.now();
      const page = await pooled.browser.newPage();
      await this.configureResourceBlocking(page);
      return { page, browserId: pooled.id };
    }
    console.log(`⏳ Browser pool: all browsers full (${this.getTotalPageCount()} pages), waiting...`);
    const maxPages = MAX_BROWSERS * MAX_PAGES_PER_BROWSER;
    const startTime = Date.now();
    while (Date.now() - startTime < PAGE_WAIT_TIMEOUT) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_WAIT_INTERVAL));
      if (this.getTotalPageCount() < maxPages) {
        const freed = this.findAvailableBrowser();
        if (freed) {
          freed.pageCount++;
          freed.lastUsed = Date.now();
          const page = await freed.browser.newPage();
          await this.configureResourceBlocking(page);
          console.log(`✅ Browser pool: page acquired after ${Date.now() - startTime}ms wait`);
          return { page, browserId: freed.id };
        }
      }
    }
    throw new Error(`Browser pool: timeout waiting for available page (waited ${PAGE_WAIT_TIMEOUT}ms)`);
  }
  async releasePage(page, browserId) {
    try {
      await page.close();
    } catch {
    }
    const pooled = this.browsers.get(browserId);
    if (pooled) {
      pooled.pageCount = Math.max(0, pooled.pageCount - 1);
      pooled.lastUsed = Date.now();
    }
  }
  async configureResourceBlocking(page) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }
  startCleanupTimer() {
    this.cleanupTimer = setInterval(async () => {
      const now = Date.now();
      for (const [id, pooled] of this.browsers) {
        if (pooled.pageCount === 0 && now - pooled.lastUsed > IDLE_TIMEOUT) {
          console.log(`🧹 Browser pool: closing idle browser (id: ${id})`);
          try {
            await pooled.browser.close();
          } catch {
          }
          this.browsers.delete(id);
        }
      }
    }, CLEANUP_INTERVAL);
  }
  async shutdown() {
    this.shuttingDown = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    const closePromises = Array.from(this.browsers.values()).map(async (pooled) => {
      try {
        await pooled.browser.close();
      } catch {
      }
    });
    await Promise.all(closePromises);
    this.browsers.clear();
    console.log("🛑 Browser pool: all browsers closed");
  }
}
const browserPool = new BrowserPool();
async function tryOEmbed(url) {
  try {
    const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5e3);
    const response = await fetch(oembedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return { success: false, error: `oEmbed returned ${response.status}` };
    }
    const data = await response.json();
    if (data.title && data.title.trim().length > 0) {
      return { success: true, caption: data.title.trim() };
    }
    return { success: false, error: "No caption in oEmbed response" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "oEmbed failed"
    };
  }
}
const CaptionHistorySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  telegramId: { type: Number, required: true, index: true },
  url: { type: String, required: true },
  caption: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
CaptionHistorySchema.index({ userId: 1, createdAt: -1 });
const CaptionHistory = mongoose.model("CaptionHistory", CaptionHistorySchema);
const API_ID = Number(process.env.TG_API_ID || 2040);
const API_HASH = process.env.TG_API_HASH || "b18441a1ff607e10a989891a5462e627";
const TARGET_BOT = process.env.SAVEASBOT_USERNAME || "SaveAsBot";
const SESSIONS_DIR = path.join(process.cwd(), "server", "saveasbot-sessions");
const MAX_LOCK_MS = 35e3;
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms))
  ]);
}
class InaccessiblePostError extends Error {
  constructor(originalText) {
    super("Post inaccessible");
    this.originalText = originalText;
    this.name = "InaccessiblePostError";
  }
}
const CAPTION_BUTTON_RE = /получить текст поста|текст поста|get text|post text/i;
const PROMPT_RE = /нажмите.*получить|click.*to get|tap.*to get/i;
const LOADING_RE = /выгружается|ожидайте|обрабатываем|загружаем|подождите|загрузка|processing|please wait|loading\.\.\.|uploading/i;
const BOT_SIG_RE = /рад был помочь|спасибо.*saveasbot|your.*saveasbot/i;
const PROMO_RE = /поддержать автора|донат|бонусная подписка|семейка ботов|отключение рекламы|нравится бот|присоединяйтесь/i;
const ERROR_RE = /не удалось получить|не удалось загрузить|закрытый.*аккаунт|приватный аккаунт|возрастные ограничения|как исправить|ошибка в получении|account is private|private account|age.restrict|failed to fetch|could not (?:fetch|get|find)|sorry,? .*(can'?t|unable)/i;
const RATE_LIMIT_RE = /очень часто отправляете|не более \d+ ссылк|каждые \d+ секунд|too many requests|rate limit|подождите.*секунд|повторите.*через/i;
class RateLimitedError extends Error {
  constructor(retryAfterMs = 5e3) {
    super("SaveAsBot rate limit");
    this.retryAfterMs = retryAfterMs;
    this.name = "RateLimitedError";
  }
}
function looksLikeCaption(text, hasMedia, hasButtons) {
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
class SaveAsBotPool {
  accounts = [];
  rrIndex = 0;
  initPromise = null;
  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }
  async doInit() {
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
          connectionRetries: 3
        });
        client.setLogLevel?.("none");
        await client.connect();
        const bot2 = await client.getEntity(TARGET_BOT);
        this.accounts.push({ name, client, bot: bot2, inUse: false, lastUsed: 0 });
        console.log(`🤖 SaveAsBot: ${name} ulandi`);
      } catch (err) {
        console.error(`❌ SaveAsBot ${name}:`, err?.message || err);
      }
    }
    console.log(`🤖 SaveAsBot pool: ${this.accounts.length}/${files.length} sessiya tayyor`);
  }
  isReady() {
    return this.accounts.length > 0;
  }
  acquire() {
    if (this.accounts.length === 0) return null;
    const now = Date.now();
    for (const acc of this.accounts) {
      if (acc.inUse && now - acc.lastUsed > MAX_LOCK_MS) {
        console.warn(`🤖 SaveAsBot: ${acc.name} qulfi ${((now - acc.lastUsed) / 1e3).toFixed(0)}s dan oshdi — majburan bo'shatildi`);
        acc.inUse = false;
      }
    }
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
    return null;
  }
  // Akkaunt ulanishini tekshirib, uzilgan bo'lsa qayta ulaymiz (qat'iy timeout bilan).
  async ensureConnected(acc) {
    try {
      if (acc.client.connected) return;
      console.warn(`🤖 SaveAsBot: ${acc.name} uzilgan — qayta ulanmoqda`);
      await withTimeout(acc.client.connect(), 8e3, "connect");
      acc.bot = await withTimeout(acc.client.getEntity(TARGET_BOT), 8e3, "getEntity");
    } catch (err) {
      console.error(`🤖 SaveAsBot: ${acc.name} qayta ulanish xatosi — ${err?.message || err}`);
    }
  }
  async fetchCaption(url, timeoutMs = 2e4) {
    await this.init();
    if (this.accounts.length === 0) return null;
    const acquireDeadline = Date.now() + 8e3;
    let acc = null;
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
      await this.ensureConnected(acc);
      const result = await withTimeout(
        this.doFetch(acc, url, timeoutMs),
        timeoutMs + 6e3,
        "doFetch"
      );
      const elapsed = ((Date.now() - t0) / 1e3).toFixed(1);
      if (result) {
        console.log(`🤖 SaveAsBot: caption olindi (${acc.name}, ${elapsed}s, ${result.length}b)`);
      } else {
        console.log(`🤖 SaveAsBot: caption olinmadi (${acc.name}, ${elapsed}s)`);
      }
      return result;
    } catch (err) {
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
  async doFetch(acc, url, timeoutMs) {
    const { client, bot: bot2 } = acc;
    const overallDeadline = Date.now() + timeoutMs;
    let sentMsg;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        sentMsg = await client.sendMessage(bot2, { message: url });
        break;
      } catch (err) {
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
    let buttonMsg = null;
    let directCaption = null;
    let inaccessibleText = null;
    let rateLimited = false;
    let resolveListener = () => {
    };
    const listenerPromise = new Promise((r) => resolveListener = r);
    const handler = async (event2) => {
      const m = event2.message;
      if (!m || m.out) return;
      if (m.peerId?.userId?.toString() !== bot2.id.toString()) return;
      if (m.id <= sentMsgId) return;
      const text = m.message || "";
      const hasMedia = !!m.media;
      const hasButtons = !!m.replyMarkup;
      if (hasButtons && !hasMedia && m.replyMarkup?.rows) {
        const buttons = m.replyMarkup.rows.flatMap((r) => r.buttons || []);
        const captionBtn = buttons.find((b) => CAPTION_BUTTON_RE.test(b.text || ""));
        if (captionBtn && captionBtn.data) {
          buttonMsg = { msg: m, data: captionBtn.data };
          resolveListener();
          return;
        }
      }
      if (RATE_LIMIT_RE.test(text)) {
        rateLimited = true;
        resolveListener();
        return;
      }
      if (ERROR_RE.test(text) && !looksLikeCaption(text, hasMedia)) {
        inaccessibleText = text;
        resolveListener();
        return;
      }
      if (looksLikeCaption(text, hasMedia)) {
        directCaption = text;
        resolveListener();
      }
    };
    const event = new NewMessage({ chats: [bot2.id] });
    client.addEventHandler(handler, event);
    const tWait = Math.min(15e3, Math.max(2e3, overallDeadline - Date.now() - 5e3));
    const waitTimeout = setTimeout(() => resolveListener(), tWait);
    await listenerPromise;
    clearTimeout(waitTimeout);
    client.removeEventHandler(handler, event);
    if (directCaption) return directCaption;
    if (rateLimited) throw new RateLimitedError(5e3);
    if (inaccessibleText) throw new InaccessiblePostError(inaccessibleText);
    if (!buttonMsg) return null;
    try {
      await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: bot2,
          msgId: buttonMsg.msg.id,
          data: buttonMsg.data
        })
      );
    } catch (err) {
      console.log(`🤖 SaveAsBot: callback xato — ${err?.message}`);
    }
    const editDeadline = Math.min(Date.now() + 1e4, overallDeadline);
    const origText = buttonMsg.msg.message || "";
    while (Date.now() < editDeadline) {
      try {
        const messages = await client.getMessages(bot2, { ids: [buttonMsg.msg.id] });
        const m = messages[0];
        if (m && m.message && m.message !== origText) {
          if (RATE_LIMIT_RE.test(m.message)) throw new RateLimitedError(5e3);
          if (looksLikeCaption(m.message, !!m.media, !!m.replyMarkup)) {
            return m.message;
          }
        }
      } catch (e) {
        if (e instanceof RateLimitedError) throw e;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  }
  async shutdown() {
    for (const acc of this.accounts) {
      try {
        await acc.client.disconnect();
      } catch {
      }
    }
    this.accounts = [];
  }
}
const saveAsBotPool = new SaveAsBotPool();
const prisma = global.__prisma ?? new PrismaClient({
  log: ["error"]
});
const MARKETPLACE_CONFIG = {
  commissionRate: Number(process.env.PLATFORM_COMMISSION_RATE ?? 15),
  // fallback
  minAdPrice: Number(process.env.MIN_AD_PRICE ?? 2e4),
  strikeExpiryDays: Number(process.env.STRIKE_EXPIRY_DAYS ?? 180),
  deadlinePostHours: Number(process.env.DEADLINE_POST_HOURS ?? 12),
  deadlineKeepHours: Number(process.env.DEADLINE_KEEP_HOURS ?? 24),
  maxStrikesBeforeBan: 3
};
const COMMISSION_SETTING_KEY = "commission_rate";
let _cachedRate = null;
let _cachedAt = 0;
const RATE_TTL_MS = 5 * 60 * 1e3;
async function getCommissionRate() {
  const now = Date.now();
  if (_cachedRate !== null && now - _cachedAt < RATE_TTL_MS) return _cachedRate;
  try {
    const row = await prisma.setting.findUnique({ where: { key: COMMISSION_SETTING_KEY } });
    const fromDb = row ? Number(row.value) : NaN;
    _cachedRate = Number.isFinite(fromDb) && fromDb >= 0 && fromDb <= 100 ? fromDb : MARKETPLACE_CONFIG.commissionRate;
  } catch {
    _cachedRate = MARKETPLACE_CONFIG.commissionRate;
  }
  _cachedAt = now;
  return _cachedRate;
}
const HESHTEG_SETTING_KEY = "heshteg_enabled";
let _heshtegCache = null;
let _heshtegCachedAt = 0;
const HESHTEG_TTL_MS = 60 * 1e3;
async function isHeshtegEnabled() {
  const now = Date.now();
  if (_heshtegCache !== null && now - _heshtegCachedAt < HESHTEG_TTL_MS) return _heshtegCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: HESHTEG_SETTING_KEY } });
    _heshtegCache = !row || row.value !== "0";
  } catch {
    _heshtegCache = true;
  }
  _heshtegCachedAt = now;
  return _heshtegCache;
}
async function setHeshtegEnabled(value) {
  const v = value ? "1" : "0";
  await prisma.setting.upsert({
    where: { key: HESHTEG_SETTING_KEY },
    update: { value: v },
    create: { key: HESHTEG_SETTING_KEY, value: v }
  });
  _heshtegCache = value;
  _heshtegCachedAt = Date.now();
}
async function setCommissionRate(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Foiz 0..100 oralig'ida bo'lishi kerak");
  }
  await prisma.setting.upsert({
    where: { key: COMMISSION_SETTING_KEY },
    update: { value: String(value) },
    create: { key: COMMISSION_SETTING_KEY, value: String(value) }
  });
  _cachedRate = value;
  _cachedAt = Date.now();
}
async function calcEscrowAsync(price) {
  const rate = await getCommissionRate();
  const commissionAmount = Math.round(price * rate / 100);
  const escrowAmount = price - commissionAmount;
  return { commissionRate: rate, commissionAmount, escrowAmount };
}
const PAYOUT_LIMITS_KEY = "payout_limits";
const DEFAULT_PAYOUT_LIMITS = { min: 5e4, max: 0 };
async function getPayoutLimits() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: PAYOUT_LIMITS_KEY } });
    if (!row) return { ...DEFAULT_PAYOUT_LIMITS };
    const parsed = JSON.parse(row.value);
    const min = Number(parsed?.min);
    const max = Number(parsed?.max);
    return {
      min: Number.isFinite(min) && min >= 1e3 ? Math.floor(min) : DEFAULT_PAYOUT_LIMITS.min,
      max: Number.isFinite(max) && max >= 0 ? Math.floor(max) : DEFAULT_PAYOUT_LIMITS.max
    };
  } catch {
    return { ...DEFAULT_PAYOUT_LIMITS };
  }
}
async function setPayoutLimits(patch) {
  const next = { ...await getPayoutLimits(), ...patch };
  await prisma.setting.upsert({
    where: { key: PAYOUT_LIMITS_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: PAYOUT_LIMITS_KEY, value: JSON.stringify(next) }
  });
  return next;
}
const marketplaceConfig = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  MARKETPLACE_CONFIG,
  calcEscrowAsync,
  getCommissionRate,
  getPayoutLimits,
  isHeshtegEnabled,
  setCommissionRate,
  setHeshtegEnabled,
  setPayoutLimits
}, Symbol.toStringTag, { value: "Module" }));
function cleanInstagramCaption(raw) {
  if (!raw) return "";
  let text = raw.replace(/\r\n?/g, "\n").trim();
  text = text.replace(
    /^[\d.,\s\u00a0]+\s+likes?,\s*[\d.,\s\u00a0]+\s+comments?\s*[-\u2013\u2014]\s*[^:\n]{1,120}:\s*["\u201c]?\s*/iu,
    ""
  );
  text = text.replace(
    /^(?:["\u201c]\s*)?@?[a-z0-9._]{1,30}(?:'s|\u2019s)\s+/iu,
    ""
  );
  text = text.replace(
    /^(?:["\u201c]\s*)?@?[a-z0-9._]{2,30}(?=[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])/iu,
    ""
  );
  text = text.replace(
    /^[^:\n]{1,120}\s+on Instagram:\s*["\u201c]?\s*/iu,
    ""
  );
  const trailingUiPatterns = [
    /\s*View all\s+[\d.,\s\u00a0]+\s+comments?\s*["\u201d]?\s*$/iu,
    /\s*View\s+[\d.,\s\u00a0]+\s+comments?\s*["\u201d]?\s*$/iu,
    /(?:\n|\s{2,})[\d.,\s\u00a0]+\s+likes?\s*["\u201d]?\s*$/iu,
    /(?:\n|\s{2,})Liked by\s+.+?\s+and\s+(?:[\d.,\s\u00a0]+\s+)?others\s*["\u201d]?\s*$/iu,
    /(?:\n|\s{2,})See translation\s*["\u201d]?\s*$/iu
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of trailingUiPatterns) {
      const cleaned = text.replace(pattern, "").trim();
      if (cleaned !== text) {
        text = cleaned;
        changed = true;
      }
    }
  }
  if (text.startsWith('"') && text.endsWith('"') || text.startsWith("“") && text.endsWith("”")) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
class PostInaccessibleUz extends Error {
  constructor() {
    super("Post yopiq akkauntda, yosh chegarasi bor yoki o'chirib yuborilgan. Bu video uchun xeshteg olib bo'lmaydi.");
    this.name = "PostInaccessibleUz";
  }
}
function extractShortcode(url) {
  const m = url.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
const inflightRequests = /* @__PURE__ */ new Map();
async function extractCaption(url) {
  const oembedResult = await tryOEmbed(url);
  if (oembedResult.success && oembedResult.caption) {
    const caption = cleanInstagramCaption(oembedResult.caption);
    if (caption) {
      console.log("⚡ Caption found via oEmbed API (fast path)");
      return { caption, source: "oembed" };
    }
  }
  console.log("oEmbed failed, falling back to Telegram Bot / Puppeteer embed:", oembedResult.error);
  if (saveAsBotPool.isReady()) {
    console.log("🤖 API usullari muvaffaqiyatsiz bo'ldi — Puppeteer-dan oldin SaveAsBot-ni sinab ko'ramiz");
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const botCaption = await saveAsBotPool.fetchCaption(url, 2e4);
        if (botCaption) {
          const caption = cleanInstagramCaption(botCaption);
          if (caption) return { caption, source: "saveasbot" };
        }
        console.log("🤖 SaveAsBot caption qaytarmadi, Puppeteer-ga o'tilmoqda");
        break;
      } catch (err) {
        if (err instanceof InaccessiblePostError) {
          throw new PostInaccessibleUz();
        }
        if (err instanceof RateLimitedError && attempt === 1) {
          const waitMs = err.retryAfterMs || 5500;
          console.warn(`🤖 SaveAsBot rate limit — ${waitMs}ms kutib retry qilamiz`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (err instanceof RateLimitedError) {
          console.warn("🤖 SaveAsBot rate limit (retry ham fail) — Puppeteer-ga o'tilmoqda");
          break;
        }
        console.error("🤖 SaveAsBot xatoligi, Puppeteer-ga o'tilmoqda:", err);
        break;
      }
    }
  } else {
    console.log(`🤖 SaveAsBot pool tayyor emas, to'g'ridan-to'g'ri Puppeteer-ga o'tilmoqda`);
  }
  const shortcode = extractShortcode(url);
  const embedUrl = shortcode ? `https://www.instagram.com/p/${shortcode}/embed/captioned/` : url;
  const { page, browserId } = await browserPool.acquirePage();
  try {
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });
    console.log(`Navigating to embed URL: ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: "networkidle2", timeout: 15e3 });
    try {
      await page.waitForSelector(
        '.Caption, [class*="Caption"], [data-testid*="caption"], span[dir="auto"]',
        { timeout: 5e3 }
      );
    } catch {
      console.log("Caption selector timed out, trying extraction anyway");
    }
    console.log("Extracting caption from embed page...");
    const caption = await page.evaluate(() => {
      const embedSelectors = [
        ".Caption",
        '[class*="Caption"]',
        '[data-testid="post-comment-root"] span',
        'article span[dir="auto"]',
        "h1",
        'span[dir="auto"]'
      ];
      const JUNK = /* @__PURE__ */ new Set([
        "meta",
        "instagram",
        "about",
        "help",
        "press",
        "api",
        "jobs",
        "privacy",
        "terms",
        "locations",
        "contact uploading & non-users",
        "report",
        "embed",
        "watch on instagram",
        "more posts from",
        "open instagram"
      ]);
      const isNavOrButton = (t) => {
        const low = t.trim().toLowerCase();
        if (JUNK.has(low)) return true;
        if (low.length <= 4 && !new RegExp("\\p{Emoji}", "u").test(t)) return true;
        return /^(Follow|Log in|Sign up|Like|Comment|Share|View profile|See more|Open Instagram|More|Reels|Posts|Followers|Following|Verified|Loading|Meta|Instagram|©)\b/i.test(t);
      };
      for (const sel of embedSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of Array.from(els)) {
          const text = el.textContent?.trim();
          if (text && text.length > 0 && !isNavOrButton(text)) {
            return text;
          }
        }
      }
      const body = document.body?.innerText || "";
      const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      for (const line of lines) {
        if (!isNavOrButton(line) && !/^\d+$/.test(line)) {
          return line;
        }
      }
      return null;
    });
    const INSTAGRAM_ERROR_PHRASES = [
      "link to this photo or video may be broken",
      "post may have been removed",
      "page isn't available",
      "something went wrong"
    ];
    const cleanedCaption = cleanInstagramCaption(caption || "");
    if (cleanedCaption && !INSTAGRAM_ERROR_PHRASES.some((p) => cleanedCaption.toLowerCase().includes(p))) {
      console.log("Caption found via Puppeteer embed");
      return { caption: cleanedCaption, source: "puppeteer-embed" };
    }
    if (caption) {
      throw new Error("This post is not available. It may be private or deleted.");
    }
    const allText = await page.evaluate(() => document.body?.innerText || "");
    console.log("Page text length:", allText.length);
    throw new Error("Caption not found on page. Instagram may require login or page structure changed.");
  } catch (error) {
    console.error("Puppeteer extraction error details:", error);
    throw error;
  } finally {
    await browserPool.releasePage(page, browserId);
  }
}
const handleInstagramCaption = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({
        success: false,
        caption: "",
        error: "URL is required"
      });
      return;
    }
    const enabled = await isHeshtegEnabled().catch(() => true);
    if (!enabled) {
      res.status(503).json({
        success: false,
        caption: "",
        error: "service_disabled"
      });
      return;
    }
    if (!url.includes("instagram.com")) {
      res.status(400).json({
        success: false,
        caption: "",
        error: "Invalid Instagram URL"
      });
      return;
    }
    const cleanUrl = url.split("?")[0];
    const cachedCaption = getCachedCaption(cleanUrl);
    const cleanedCachedCaption = cleanInstagramCaption(cachedCaption || "");
    if (cleanedCachedCaption) {
      if (cleanedCachedCaption !== cachedCaption) {
        setCachedCaption(cleanUrl, cleanedCachedCaption);
      }
      console.log(`✅ Cache hit for ${cleanUrl}`);
      trackEvent({
        timestamp: Date.now(),
        type: "caption_extracted",
        data: { url: cleanUrl, cached: true }
      });
      res.json({
        success: true,
        caption: cleanedCachedCaption
      });
      return;
    }
    const inflight = inflightRequests.get(cleanUrl);
    if (inflight) {
      console.log(`🔗 Dedup: ${cleanUrl} already in-flight, waiting for result`);
      const { caption: caption2, source: source2 } = await inflight;
      trackEvent({
        timestamp: Date.now(),
        type: "caption_extracted",
        data: { url: cleanUrl, cached: true, source: source2 }
      });
      res.json({
        success: true,
        caption: caption2,
        source: source2
      });
      return;
    }
    console.log(`📥 Queue: Adding ${cleanUrl} to queue`);
    console.log(`📊 Queue stats: ${captionQueue.size} waiting, ${captionQueue.pending} processing`);
    const extractionPromise = captionQueue.add(async () => {
      console.log(`🔄 Processing ${cleanUrl}...`);
      const result = await extractCaption(cleanUrl);
      console.log(`✅ Completed ${cleanUrl} (source=${result.source})`);
      return result;
    });
    inflightRequests.set(cleanUrl, extractionPromise);
    let caption;
    let source;
    try {
      const result = await extractionPromise;
      caption = result.caption;
      source = result.source;
    } finally {
      inflightRequests.delete(cleanUrl);
    }
    setCachedCaption(cleanUrl, caption);
    trackEvent({
      timestamp: Date.now(),
      type: "caption_extracted",
      data: { url: cleanUrl, cached: false, source }
    });
    if (req.telegramUser) {
      CaptionHistory.create({
        userId: req.telegramUser._id,
        telegramId: req.telegramUser.telegramId,
        url: cleanUrl,
        caption
      }).catch((err) => console.error("Failed to save caption history:", err));
    }
    res.json({
      success: true,
      caption,
      source
    });
  } catch (error) {
    console.error("Caption extraction error:", error);
    if (error instanceof PostInaccessibleUz) {
      res.status(200).json({
        success: false,
        caption: "",
        error: error.message
      });
      return;
    }
    const errMsg = error instanceof Error ? error.message.toLowerCase() : "";
    const isTimeout = errMsg.includes("timeout") || errMsg.includes("timed out");
    const friendly = isTimeout ? "Server javob bermadi. Iltimos, qaytadan urinib ko'ring." : "Hozir xeshtegni olib bo'lmadi. Boshqa havola bilan urinib ko'ring yoki video havolasini adminga yuboring.";
    res.status(isTimeout ? 408 : 200).json({
      success: false,
      caption: "",
      error: friendly
    });
  }
};
async function getLinks(url) {
  const links = [];
  const puppeteer = await import("puppeteer").catch(() => null);
  if (!puppeteer) {
    throw new Error("Puppeteer is not installed. Run: pnpm add puppeteer");
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 3e4 });
    let lastHeight = await page.evaluate("document.body.scrollHeight");
    let scrollAttempts = 0;
    const maxScrollAttempts = 50;
    while (scrollAttempts < maxScrollAttempts) {
      const pageLinks = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a"));
        return anchors.map((a) => a.href).filter((href) => href.includes("/p/"));
      });
      pageLinks.forEach((link) => {
        if (!links.includes(link)) {
          links.push(link);
        }
      });
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await new Promise((resolve) => setTimeout(resolve, 3e3));
      const newHeight = await page.evaluate("document.body.scrollHeight");
      if (newHeight === lastHeight) {
        break;
      }
      lastHeight = newHeight;
      scrollAttempts++;
    }
    return links;
  } finally {
    await browser.close();
  }
}
async function filterCaptions(links, searchString) {
  const filteredLinks = [];
  const puppeteer = await import("puppeteer").catch(() => null);
  if (!puppeteer) {
    throw new Error("Puppeteer is not installed. Run: pnpm add puppeteer");
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    for (const link of links) {
      try {
        await page.goto(link, { waitUntil: "networkidle2", timeout: 3e4 });
        const pageText = await page.evaluate(() => document.body.innerText);
        if (pageText.toLowerCase().includes(searchString.toLowerCase())) {
          filteredLinks.push(link);
        }
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      } catch (error) {
        console.error(`Error processing link ${link}:`, error);
      }
    }
    return filteredLinks;
  } finally {
    await browser.close();
  }
}
const handleInstagramScrape = async (req, res) => {
  try {
    const { username, searchString } = req.body;
    if (!username || !searchString) {
      res.status(400).json({
        success: false,
        error: "Username and searchString are required"
      });
      return;
    }
    const url = `https://www.instagram.com/${username}`;
    console.log(`Fetching posts from ${url}...`);
    const allLinks = await getLinks(url);
    console.log(`Found ${allLinks.length} posts`);
    console.log(`Filtering posts containing "${searchString}"...`);
    const filteredLinks = await filterCaptions(allLinks, searchString);
    console.log(`Found ${filteredLinks.length} matching posts`);
    res.json({
      success: true,
      totalPosts: allLinks.length,
      matchedPosts: filteredLinks.length,
      links: filteredLinks
    });
  } catch (error) {
    console.error("Scraping error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "An unexpected error occurred"
    });
  }
};
const handleTrackEvent = (req, res) => {
  try {
    const { type, data } = req.body;
    if (!type) {
      res.status(400).json({ success: false, error: "Event type is required" });
      return;
    }
    trackEvent({
      timestamp: Date.now(),
      type,
      data
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Error tracking event:", error);
    res.status(500).json({
      success: false,
      error: "Failed to track event"
    });
  }
};
const handleAuthValidate = (req, res) => {
  const user = req.telegramUser;
  if (!user) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }
  res.json({
    success: true,
    user: {
      _id: user._id.toString(),
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      language: user.language,
      createdAt: user.createdAt.toISOString(),
      lastSeen: user.lastSeen.toISOString()
    }
  });
};
const handleGetProfile = (req, res) => {
  const user = req.telegramUser;
  if (!user) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }
  res.json({
    success: true,
    user: {
      _id: user._id.toString(),
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      language: user.language,
      createdAt: user.createdAt.toISOString(),
      lastSeen: user.lastSeen.toISOString()
    }
  });
};
const handleGetHistory = async (req, res) => {
  try {
    const user = req.telegramUser;
    if (!user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [history, total] = await Promise.all([
      CaptionHistory.find({ userId: user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CaptionHistory.countDocuments({ userId: user._id })
    ]);
    res.json({
      success: true,
      history: history.map((item) => ({
        _id: item._id.toString(),
        userId: item.userId.toString(),
        url: item.url,
        caption: cleanInstagramCaption(item.caption),
        createdAt: item.createdAt.toISOString()
      })),
      total
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ success: false, error: "Failed to fetch history" });
  }
};
const handleDeleteHistory = async (req, res) => {
  try {
    const user = req.telegramUser;
    if (!user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, error: "History entry not found" });
      return;
    }
    const result = await CaptionHistory.findOneAndDelete({
      _id: id,
      userId: user._id
      // Faqat o'z elementlarini o'chira oladi
    });
    if (!result) {
      res.status(404).json({ success: false, error: "History entry not found" });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting history:", error);
    res.status(500).json({ success: false, error: "Failed to delete history entry" });
  }
};
function validateInitData(initData, botToken) {
  try {
    if (!initData || !botToken) {
      return { valid: false, error: "Missing initData or botToken" };
    }
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");
    if (!receivedHash) {
      return { valid: false, error: "No hash in initData" };
    }
    params.delete("hash");
    const sortedEntries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = sortedEntries.map(([key, value]) => `${key}=${value}`).join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (calculatedHash !== receivedHash) {
      return { valid: false, error: "Invalid hash" };
    }
    const authDate = params.get("auth_date");
    if (authDate) {
      const authTimestamp = parseInt(authDate) * 1e3;
      const now = Date.now();
      const MAX_AGE = 24 * 60 * 60 * 1e3;
      if (now - authTimestamp > MAX_AGE) {
        return { valid: false, error: "initData expired" };
      }
    }
    const userParam = params.get("user");
    if (!userParam) {
      return { valid: false, error: "No user data in initData" };
    }
    const userData = JSON.parse(userParam);
    return { valid: true, user: userData };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Validation failed"
    };
  }
}
const UserSchema = new Schema({
  telegramId: { type: Number, required: true, unique: true, index: true },
  firstName: { type: String, required: true },
  lastName: { type: String, default: "" },
  username: { type: String, default: "" },
  photoUrl: { type: String, default: "" },
  language: { type: String, default: "uz" },
  surveyCompleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);
const BOT_TOKEN$2 = process.env.TELEGRAM_BOT_TOKEN || "";
const WEBAPP_BOT_TOKEN = process.env.WEBAPP_BOT_TOKEN || "";
function tryValidate(initData) {
  const r1 = validateInitData(initData, BOT_TOKEN$2);
  if (r1.valid) return r1;
  if (WEBAPP_BOT_TOKEN && WEBAPP_BOT_TOKEN !== BOT_TOKEN$2) {
    const r2 = validateInitData(initData, WEBAPP_BOT_TOKEN);
    if (r2.valid) return r2;
  }
  return r1;
}
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("tma ")) {
      res.status(401).json({ success: false, error: "Missing authorization header" });
      return;
    }
    const initData = authHeader.slice(4);
    const result = tryValidate(initData);
    if (!result.valid || !result.user) {
      res.status(401).json({ success: false, error: result.error || "Invalid initData" });
      return;
    }
    const user = await User.findOneAndUpdate(
      { telegramId: result.user.id },
      {
        $set: {
          firstName: result.user.first_name,
          lastName: result.user.last_name || "",
          username: result.user.username || "",
          photoUrl: result.user.photo_url || "",
          language: result.user.language_code || "uz",
          lastSeen: /* @__PURE__ */ new Date()
        },
        $setOnInsert: {
          createdAt: /* @__PURE__ */ new Date()
        }
      },
      { upsert: true, new: true, runValidators: true }
    );
    req.telegramUser = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ success: false, error: "Authentication failed" });
  }
}
async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("tma ")) {
    return next();
  }
  try {
    const initData = authHeader.slice(4);
    const result = tryValidate(initData);
    if (result.valid && result.user) {
      const user = await User.findOneAndUpdate(
        { telegramId: result.user.id },
        {
          $set: {
            firstName: result.user.first_name,
            lastName: result.user.last_name || "",
            username: result.user.username || "",
            photoUrl: result.user.photo_url || "",
            lastSeen: /* @__PURE__ */ new Date()
          },
          $setOnInsert: {
            createdAt: /* @__PURE__ */ new Date()
          }
        },
        { upsert: true, new: true }
      );
      req.telegramUser = user;
    }
  } catch (error) {
    console.warn("Optional auth failed:", error);
  }
  next();
}
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/instacap";
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    console.warn("⚠️  Server will run without database");
  }
}
async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log("🛑 MongoDB disconnected");
  } catch (error) {
    console.error("Error disconnecting MongoDB:", error);
  }
}
const SurveyResponseSchema = new Schema({
  telegramId: { type: Number, required: true, index: true },
  firstName: { type: String, default: "" },
  pollIndex: { type: Number, required: true },
  question: { type: String, required: true },
  selectedOption: { type: Number, required: true },
  selectedOptionText: { type: String, required: true },
  pollId: { type: String, required: true, index: true },
  answeredAt: { type: Date, default: Date.now }
});
SurveyResponseSchema.index({ telegramId: 1, pollIndex: 1 }, { unique: true });
const SurveyResponse = mongoose.model(
  "SurveyResponse",
  SurveyResponseSchema
);
const BOT_TOKEN$1 = process.env.TELEGRAM_BOT_TOKEN || "";
const SELLER_BOT_TOKEN = process.env.WEBAPP_BOT_TOKEN || "";
const ADMIN_IDS$3 = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => parseInt(id.trim()));
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const WEBAPP_URL_V = WEBAPP_URL ? `${WEBAPP_URL}?v=4` : "";
const VIDEO_LIMIT_FILE = process.env.VIDEO_LIMIT_CONFIG || "/var/www/vidoctorai/limit_config.json";
function getVideoLimit() {
  try {
    const v = JSON.parse(fs.readFileSync(VIDEO_LIMIT_FILE, "utf-8")).daily_limit;
    return Number.isFinite(v) ? v : 1;
  } catch {
    return 1;
  }
}
function setVideoLimit(n) {
  fs.writeFileSync(VIDEO_LIMIT_FILE, JSON.stringify({ daily_limit: n }));
}
let bot = null;
let sellerBot = null;
const SURVEY_POLLS = [
  {
    question: "Videolaringiz topga chiqarishni qanchalik xohlaysiz?",
    options: ["Unchalik qiziq emas", "O'rtacha", "Juda yam"]
  },
  {
    question: "Videolaringizni topga chiqarish uchun sizga o'xshagan insonlarga yordam bergan bo'larmidingiz?",
    options: ["Ha, farqi yo'q", "Yo'q, qiziq emas"]
  }
];
const activePollMap = /* @__PURE__ */ new Map();
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1e3;
  for (const [pollId, context] of activePollMap.entries()) {
    if (context.createdAt < oneHourAgo) {
      activePollMap.delete(pollId);
    }
  }
}, 30 * 60 * 1e3);
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "📊 Bugun", callback_data: "stats" },
        { text: "📈 7 kun", callback_data: "weekly" },
        { text: "🗂 Umumiy", callback_data: "all_time" }
      ],
      [
        { text: "⏰ Soatlik", callback_data: "hourly" },
        { text: "🔥 Pik soat", callback_data: "peak" }
      ],
      [
        { text: "🎬 Video Analiz", callback_data: "video_stats" }
      ],
      [
        { text: "🏪 Marketplace statistika", callback_data: "mkt_stats_hub" }
      ],
      [
        { text: "🔖 Heshteg boshqaruv", callback_data: "heshteg_back" },
        { text: "📋 So'rovnoma", callback_data: "survey_stats" }
      ],
      [
        { text: "🔄 Yangilash", callback_data: "refresh" }
      ]
    ]
  }
};
const surveyKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "👥 Javoblar ro'yxati", callback_data: "survey_responses" }
      ],
      [
        { text: "⬅️ Orqaga", callback_data: "survey_back" }
      ]
    ]
  }
};
const surveyResponsesKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "📋 Statistika", callback_data: "survey_stats" }
      ],
      [
        { text: "⬅️ Orqaga", callback_data: "survey_back" }
      ]
    ]
  }
};
async function sendSurveyPoll(chatId, pollIndex) {
  const poll = SURVEY_POLLS[pollIndex];
  if (!poll || !bot) return;
  const existing = await SurveyResponse.findOne({ telegramId: chatId, pollIndex });
  if (existing) {
    if (pollIndex === 0) {
      await sendSurveyPoll(chatId, 1);
    } else {
      await User.updateOne({ telegramId: chatId }, { $set: { surveyCompleted: true } });
      await sendWebAppButton(chatId);
    }
    return;
  }
  const sentMessage = await bot.sendPoll(chatId, poll.question, poll.options, {
    is_anonymous: false,
    type: "regular"
  });
  if (sentMessage.poll) {
    activePollMap.set(sentMessage.poll.id, {
      telegramId: chatId,
      chatId,
      pollIndex,
      question: poll.question,
      options: poll.options,
      createdAt: Date.now()
    });
  }
}
async function sendWebAppButton(chatId) {
  if (!WEBAPP_URL) {
    bot?.sendMessage(chatId, "⚠️ Dastur hozircha mavjud emas. Keyinroq qayta urinib ko'ring.");
    return;
  }
  bot?.sendMessage(
    chatId,
    "So'rovnomaga javob berganingiz uchun rahmat! Bot tomonidan sizga xabar yuboramiz.",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔖 Heshteg yuklash", web_app: { url: WEBAPP_URL_V } }]
        ]
      }
    }
  );
}
function initBot() {
  if (!BOT_TOKEN$1) {
    console.warn("⚠️  TELEGRAM_BOT_TOKEN not set. Bot will not start.");
    return;
  }
  if (ADMIN_IDS$3.length === 0 || !ADMIN_IDS$3[0]) {
    console.warn("⚠️  ADMIN_TELEGRAM_IDS not set. Bot will not start.");
    return;
  }
  try {
    bot = new TelegramBot(BOT_TOKEN$1, {
      polling: {
        interval: 1e3,
        autoStart: true,
        params: {
          timeout: 10
        }
      },
      // MUHIM: Telegram'ning uzoq-so'rov (`params.timeout=10s`) javob
      // bermay, ulanish "osilib" qolishi mumkin — bunda kutubxona HECH
      // QANDAY xato bermay ABADIY kutadi (haqiqiy production'da tasdiqlangan:
      // 44 soat process "online" turgan, lekin botga hech qanday xabar
      // javob bermagan). `request.timeout` shu HTTP so'rovning o'zini
      // majburan uzadi — shundan keyingina 'polling_error' chiqadi va
      // pastdagi self-heal (5 marta ketma-ket xato → majburiy qayta
      // ulanish) ishga tushadi.
      // @types/node-telegram-bot-api'dagi `request` turi `request` kutubxonasining
      // to'liq Options interfeysini talab qiladi (masalan `uri` majburiy) —
      // amalda esa kutubxona buni faqat qisman merge qiladi, shuning uchun
      // `as any` xavfsiz.
      request: {
        timeout: 2e4
      }
    });
    console.log("✅ Telegram bot started successfully");
    if (WEBAPP_URL) {
      const setMenuViaApi = async (token, label, text) => {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ menu_button: { type: "web_app", text, web_app: { url: WEBAPP_URL } } })
          });
          const json = await res.json();
          if (json.ok) console.log(`✅ ${label}: chat menu button → ${text}`);
          else console.warn(`${label} setChatMenuButton: ${json.description}`);
        } catch (e) {
          console.warn(`${label} setChatMenuButton failed:`, e instanceof Error ? e.message : e);
        }
      };
      setMenuViaApi(BOT_TOKEN$1, "@insaybbot", "🔖 Heshteg yuklash");
      if (SELLER_BOT_TOKEN && SELLER_BOT_TOKEN !== BOT_TOKEN$1) {
        setMenuViaApi(SELLER_BOT_TOKEN, "@Top_sxema_instagrambot", "Heshteg yuklash");
      }
    }
    if (process.env.ENABLE_SELLER_BOT === "1" && SELLER_BOT_TOKEN && SELLER_BOT_TOKEN !== BOT_TOKEN$1) {
      try {
        sellerBot = new TelegramBot(SELLER_BOT_TOKEN, {
          polling: { interval: 1e3, autoStart: true, params: { timeout: 10 } },
          request: { timeout: 2e4 }
        });
        console.log("✅ Seller bot (Top_sxema_instagrambot) started");
      } catch (err) {
        console.warn("⚠️  Seller bot start failed:", err instanceof Error ? err.message : err);
        sellerBot = null;
      }
    } else {
      console.log("ℹ️  Seller bot disabled (ENABLE_SELLER_BOT != 1) — owner xabarlari asosiy bot orqali yuboriladi");
    }
    import("./bot-marketplace-D87G95g9.js").then(({ initMarketplaceBot }) => {
      if (bot) {
        try {
          initMarketplaceBot(bot, sellerBot);
          console.log("✅ Marketplace bot handlers registered");
        } catch (err) {
          console.warn("⚠️  initMarketplaceBot failed:", err instanceof Error ? err.message : err);
        }
      }
    }).catch((err) => {
      console.warn("⚠️  bot-marketplace yuklanmadi (prisma?):", err instanceof Error ? err.message : err);
    });
    Promise.resolve().then(() => preview).then(({ initPreviewBot: initPreviewBot2 }) => {
      if (bot) {
        try {
          initPreviewBot2(bot);
        } catch (err) {
          console.warn("⚠️  initPreviewBot failed:", err instanceof Error ? err.message : err);
        }
      }
    }).catch((err) => {
      console.warn("⚠️  preview bot yuklanmadi:", err instanceof Error ? err.message : err);
    });
    let pollingErrorCount = 0;
    let lastPollingErrorAt = 0;
    bot.on("polling_error", (error) => {
      console.error("❌ Polling error:", error.message);
      const now = Date.now();
      if (now - lastPollingErrorAt > 6e4) pollingErrorCount = 0;
      lastPollingErrorAt = now;
      pollingErrorCount++;
      if (pollingErrorCount >= 5) {
        pollingErrorCount = 0;
        console.warn("⚠️  Polling 5+ marta ketma-ket xato berdi — majburan qayta ishga tushirilmoqda...");
        bot.stopPolling().then(() => bot.startPolling()).then(() => console.log("✅ Polling qayta tiklandi")).catch((e) => console.error("❌ Pollingni qayta ishga tushirib bo'lmadi:", e instanceof Error ? e.message : e));
      }
    });
    bot.on("error", (error) => {
      console.error("❌ Bot error:", error.message);
    });
    const ADMIN_REPLY_KEYBOARD = {
      keyboard: [
        [{ text: "🏆 Collab Auksioni", web_app: { url: "https://topsxema.duckdns.org/marketplace?tab=auction" } }],
        [{ text: "🏠 Bosh panel" }, { text: "📱 Mini App", web_app: { url: "https://topsxema.duckdns.org" } }],
        [{ text: "🏷 Atmetka" }, { text: "🔖 Heshteg" }],
        [{ text: "💰 Komissiya" }, { text: "🔍 Qidirish" }],
        [{ text: "📊 Statistika" }, { text: "☑️ Verify" }],
        [{ text: "💳 Balans" }],
        [{ text: "📨 Xabar yuborish" }, { text: "📤 Media yuklash" }]
      ],
      resize_keyboard: true,
      is_persistent: true
    };

    const USER_REPLY_KEYBOARD = {
      keyboard: [
        [{ text: "🏆 Collab Auksioni", web_app: { url: "https://topsxema.duckdns.org/marketplace?tab=auction" } }],
        [{ text: "📱 Mini Appni ochish", web_app: { url: "https://topsxema.duckdns.org" } }]
      ],
      resize_keyboard: true,
      is_persistent: true
    };
    async function sendAdminDashboard(chatId) {
      const daily = getDailyStats();
      const weekly = getWeeklyStats();
      const all = getAllTimeStats();
      const adminKeyboard = {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            // 2026-10-01: CS GO / CS GO+Atmetka tizimi ICHKI SINOVDAN O'TIB
            // productionga ko'chirildi — endi "Atmetka qilish" tugmasi
            // orqali BARCHA foydalanuvchilarga ochiq, shu sabab alohida
            // sinov-tugmasi endi kerak emas (o'chirildi).
            ...WEBAPP_URL ? [[{ text: "🏆 Collab Auksioni (Stavka)", web_app: { url: `${WEBAPP_URL}/marketplace?tab=auction` } }, { text: "🔖 WebApp ochish", web_app: { url: WEBAPP_URL_V } }]] : [],
            [
              { text: "📊 Bugun", callback_data: "stats" },
              { text: "📈 7 kun", callback_data: "weekly" },
              { text: "🗂 Umumiy", callback_data: "all_time" }
            ],
            [
              { text: "⏰ Soatlik", callback_data: "hourly" },
              { text: "🔥 Pik soat", callback_data: "peak" }
            ],
            [
              { text: "🎬 Video Analiz", callback_data: "video_stats" }
            ],
            [
              { text: "🏪 Marketplace statistika", callback_data: "mkt_stats_hub" }
            ],
            [
              { text: "🔖 Heshteg boshqaruv", callback_data: "heshteg_back" },
              { text: "📋 So'rovnoma", callback_data: "survey_stats" }
            ],
            [
              { text: "🔄 Yangilash", callback_data: "refresh" }
            ]
          ]
        }
      };
      const welcomeMessage = `🤖 *ADMIN PANEL*
━━━━━━━━━━━━━━━━━━

📊 *Tezkor ko'rinish*
• Bugun:        *${fmtNum$1(daily.totalExtractions)}* ta
• So'nggi 7 kun: *${fmtNum$1(weekly.totalExtractions)}* ta
• Jami:         *${fmtTotal(all.totalExtractions, all.approximate)}* ta

👇 Boshqaruv uchun pastdagi menyu tugmalaridan foydalaning.

_🕐 ${nowTs()}_`;
      await bot?.sendMessage(chatId, welcomeMessage, adminKeyboard);
    }
        bot.onText(/\/(?:auksion|auction)/i, async (msg) => {
      const chatId = msg.chat.id;
      const webappUrl = process.env.WEBAPP_URL || "https://topsxema.duckdns.org";
      const auctionUrl = `${webappUrl}/marketplace?tab=auction`;

      await bot?.sendMessage(chatId, `🏆 <b>Instagram Collab Auksioni (To'rtburchak Ekran)</b>\n\n🎯 <b>Qoidalar:</b>\n1. Mashhur Instagram akkauntlarga (#topsxema) hammualliflik (Collab) sloti auksionda!\n2. To'rtburchak ekranda barcha ishtirokchilar ulushi 100% maydonni egallaydi.\n3. Eng katta stavka qo'ygan ishtirokchi eng katta zonani egallaydi.\n4. Summani kiritib "Tikish" tugmasini bosing!\n\n👇 <b>Auksion arenasiga kirish:</b>`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔥 Auksionga kirish (Stavka qo'yish)", web_app: { url: auctionUrl } }],
            [{ text: "📱 Bosh sahifa (Mini App)", web_app: { url: webappUrl } }]
          ]
        }
      }).catch(() => {});
    });

    bot.on("message", async (msg) => {
      const txt = (msg.text || "").trim().toLowerCase();
      if (txt === "auksion" || txt === "/auksion" || txt === "🏆 collab auksioni" || txt.includes("auksion")) {
        const chatId = msg.chat.id;
        const webappUrl = process.env.WEBAPP_URL || "https://topsxema.duckdns.org";
        const auctionUrl = `${webappUrl}/marketplace?tab=auction`;
        await bot?.sendMessage(chatId, `🏆 <b>Instagram Collab Auksioni!</b>\n\nQuyidagi tugma orqali to'g'ridan-to'g'ri Auksion arenasiga kirishingiz mumkin:`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔥 Auksionga kirish (Stavka qo'yish)", web_app: { url: auctionUrl } }]
            ]
          }
        }).catch(() => {});
      }
    });

// ===== TOP SXEMA ASOSIY MENYU (5 ta tugma, custom emoji ikonlar bilan) =====
    const TS_MENU_ICONS = {
      tag: "5987802868734760945",
      video: "6005986106703613755",
      bookmark: "5899757765743615694",
      chart: "5875431869842985304",
      language: "5879585266426973039"
    };
    const TS_MENU_LABELS = {
      uz: { heshteglar: "Heshteglar", video_analiz: "Video analiz", heshteg_olish: "Heshteg yuklash", algoritm: "ALGORITM", til: "Til" },
      ru: { heshteglar: "Хэштеги", video_analiz: "Видео анализ", heshteg_olish: "Загрузить хэштег", algoritm: "АЛГОРИТМ", til: "Язык" },
      en: { heshteglar: "Hashtags", video_analiz: "Video analysis", heshteg_olish: "Download hashtag", algoritm: "ALGORITHM", til: "Language" }
    };
    const TS_MENU_TEXTS = {
      uz: {
        hashtags: "🔖 <b>Heshteglar (Atmetka)</b>\n\nVideongizga akkauntni atmetka qilib, har 500 000 prosmotr uchun pul oling. Atmetka qilish uchun profil sahifasini oching:",
        video: "🎬 <b>Video analiz</b>\n\nVideoyingizni tahlil qilish uchun video analiz botini oching:",
        upload: "📥 <b>Heshteg yuklash</b>\n\nCaption va hashtag yaratish vositasini oching:",
        algorithm: "🧠 <b>ALGORITM</b>\n\n1️⃣ Atmetka faqat 500 000 prosmotr boshidan hisoblanadi.\n2️⃣ Har 500 000 prosmotr uchun belgilangan summa balansga qo'shiladi.\n3️⃣ Video 24 soat davomida o'chirilmasligi shart.\n4️⃣ Videoda majburiy kalit so'z (hashtag) qo'yilishi shart.\n5️⃣ Nakrutka va sun'iy ko'rishlar qat'iyan man etiladi.\n6️⃣ Natijalar har kuni avtomatik tekshiriladi.",
        lang: "🌐 <b>Tilni tanlang</b>:",
        hashtags_prompt: "🔖 <b>Heshteg yuklash</b>\n\nKalit so'zni (hashtag) shu yerga yozib yuboring. Masalan: <code>#topsxema</code>",
        lang_ok: "✅ Til o'zgartirildi. Quyidagi menyudan foydalaning:"
      },
      ru: {
        hashtags: "🔖 <b>Хэштеги (Атметка)</b>\n\nОтмечайте аккаунт в своём видео и получайте оплату за каждые 500 000 просмотров. Откройте страницу профиля:",
        video: "🎬 <b>Видео анализ</b>\n\nОткройте бота для анализа ваших видео:",
        upload: "📥 <b>Загрузить хэштег</b>\n\nИнструмент для создания подписей и хэштегов:",
        algorithm: "🧠 <b>АЛГОРИТМ</b>\n\n1️⃣ Отметка засчитывается с 500 000 просмотров.\n2️⃣ За каждые 500 000 просмотров на баланс начисляется сумма.\n3️⃣ Видео нельзя удалять в течение 24 часов.\n4️⃣ Обязателен ключевой хэштег.\n5️⃣ Накрутка запрещена.\n6️⃣ Проверка результатов — автоматически, каждый день.",
        lang: "🌐 <b>Выберите язык</b>:",
        hashtags_prompt: "🔖 <b>Загрузить хэштег</b>\n\nОтправьте ключевое слово (хэштег). Например: <code>#topsxema</code>",
        lang_ok: "✅ Язык изменён. Пользуйтесь меню:"
      },
      en: {
        hashtags: "🔖 <b>Hashtags (Atmetka)</b>\n\nTag the account in your video and earn money for every 500,000 views. Open your profile page:",
        video: "🎬 <b>Video analysis</b>\n\nOpen the video analyzer bot:",
        upload: "📥 <b>Download hashtag</b>\n\nCaption and hashtag generator tool:",
        algorithm: "🧠 <b>ALGORITHM</b>\n\n1️⃣ Atmetka counts from 500,000 views.\n2️⃣ Every 500,000 views adds the configured reward to your balance.\n3️⃣ The video must stay up for 24 hours.\n4️⃣ The mandatory keyword hashtag is required.\n5️⃣ Artificial views are strictly forbidden.\n6️⃣ Results are checked automatically every day.",
        lang: "🌐 <b>Choose language</b>:",
        hashtags_prompt: "🔖 <b>Download hashtag</b>\n\nSend the keyword hashtag. For example: <code>#topsxema</code>",
        lang_ok: "✅ Language updated. Use the menu below:"
      }
    };
    const TS_LANG_BUTTONS = { "🇺🇿 O'zbekcha": "uz", "🇷🇺 Русский": "ru", "🇬🇧 English": "en" };
    const tsUserLang = new Map();
    const tsAwaitingHashtag = new Set();

    function tsLangOf(chatId) {
      return tsUserLang.get(String(chatId)) || "uz";
    }
    function tsMenuButton(text, iconKey) {
      return { text, icon_custom_emoji_id: TS_MENU_ICONS[iconKey] };
    }
    function tsMainMenuKeyboard(lang) {
      const l = TS_MENU_LABELS[lang] || TS_MENU_LABELS.uz;
      return {
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
        keyboard: [
          [tsMenuButton(l.heshteglar, "tag")],
          [tsMenuButton(l.video_analiz, "video"), tsMenuButton(l.heshteg_olish, "bookmark")],
          [tsMenuButton(l.algoritm, "chart"), tsMenuButton(l.til, "language")]
        ]
      };
    }
    function tsPlainMenuKeyboard(lang) {
      const l = TS_MENU_LABELS[lang] || TS_MENU_LABELS.uz;
      return {
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
        keyboard: [
          [l.heshteglar],
          [l.video_analiz, l.heshteg_olish],
          [l.algoritm, l.til]
        ]
      };
    }
    function tsIsMenuKey(text, key) {
      return Object.keys(TS_MENU_LABELS).some((l) => TS_MENU_LABELS[l][key] === text);
    }
    // Custom emoji ishlamasa — menyuni ikonlarsiz yuborish (zaxira)
    async function tsSendMenu(chatId, text, extra) {
      const opts = { ...(extra || {}) };
      const lang = tsLangOf(chatId);
      try {
        await bot?.sendMessage(chatId, text, { ...opts, reply_markup: tsMainMenuKeyboard(lang) });
        return true;
      } catch (e) {
        try {
          await bot?.sendMessage(chatId, text, { ...opts, reply_markup: tsPlainMenuKeyboard(lang) });
          return true;
        } catch (e2) {
          console.warn("tsSendMenu failed:", e2 instanceof Error ? e2.message : e2);
          return false;
        }
      }
    }

    bot.onText(/\/start(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const webappUrl = process.env.WEBAPP_URL || "https://topsxema.duckdns.org";
      const auctionUrl = `${webappUrl}/marketplace?tab=auction`;

      const rawParam = (match && match[1]) ? match[1].trim() : "";

      // 1. Direct link to Video Ulash (startapp=video_ulash)
      if (rawParam === "video_ulash") {
        await bot?.sendMessage(chatId, `✨ <b>Video Ulash bo'limi!</b>\n\nInstagram akkauntlariga video ulash yoki Collab auksionida ishtirok eting:`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 Video Ulashni ochish", web_app: { url: `${webappUrl}/marketplace` } }],
              [{ text: "📱 Bosh sahifa", web_app: { url: webappUrl } }]
            ]
          }
        }).catch(() => {});
        await tsSendMenu(chatId, "👋 <b>Top Sxema</b> menyusi — quyidagi tugmalardan foydalaning:", { parse_mode: "HTML" });
        return;
      }

      // 2. Direct link to specific account (startapp=account_123 or acc_123)
      const accMatch = rawParam.match(/(?:acc_|account_)?(\d+)/i);
      if (accMatch && accMatch[1]) {
        const accId = accMatch[1];
        const directUrl = `${webappUrl}/marketplace?account=${accId}`;
        await bot?.sendMessage(chatId, `✨ <b>Instagram Akkaunti Tanlandi!</b>\n\nQuyidagi tugma orqali to'g'ridan-to'g'ri ushbu akkauntga o'tishingiz mumkin:`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "👁 Akkauntni ko'rish", web_app: { url: directUrl } }],
              [{ text: "🚀 Video Ulash (Barchasi)", web_app: { url: `${webappUrl}/marketplace` } }]
            ]
          }
        }).catch(() => {});
        await tsSendMenu(chatId, "👋 <b>Top Sxema</b> menyusi — quyidagi tugmalardan foydalaning:", { parse_mode: "HTML" });
        return;
      }

      const startKeyboard = {
        inline_keyboard: [
          [{ text: "🏆 Instagram Collab Auksioni", web_app: { url: auctionUrl } }],
          [{ text: "📱 Ilovani ochish (Mini App)", web_app: { url: webappUrl } }],
          [{ text: "🔖 Atmetka qilish (Profil)", web_app: { url: webappUrl + "/profile" } }]
        ]
      };

      if (isAdmin(chatId)) {
        await tsSendMenu(chatId, "🤖 <b>ADMIN XUSH KELIBSIZ!</b>\n\nTop Sxema boshqaruv paneli va auksion tizimi faol.\nPastdagi tugmalar orqali to'g'ridan-to'g'ri tizimga kirishingiz mumkin:", { parse_mode: "HTML" });
        await bot?.sendMessage(chatId, "⚡ <b>Tezkor tugmalar:</b>", { parse_mode: "HTML", reply_markup: startKeyboard }).catch(() => {});
        await sendAdminDashboard(chatId).catch(() => {});
      } else {
        await tsSendMenu(chatId, "👋 <b>Assalomu alaykum! Top Sxemaga xush kelibsiz!</b>\n\n🔥 <b>Auksion:</b> Mashhur Instagram akkauntlarga o'z videongizni collab qilib ulash slotini yutib oling!\n🔖 <b>Atmetka:</b> Videongizda akkauntni atmetka qilib har 500k prosmotr uchun pul ishlang!\n\n👇 Ishtirok etish uchun quyidagi tugmalardan foydalaning:", { parse_mode: "HTML" });
        await bot?.sendMessage(chatId, "⚡ <b>Tezkor tugmalar:</b>", { parse_mode: "HTML", reply_markup: startKeyboard }).catch(() => {});
      }
    });

    // ----- Asosiy menyu tugmalarini ishlash (Heshteglar / Video analiz / ...) -----
    bot.on("message", async (msg) => {
      try {
      const rawText = (msg.text || "").trim();
      if (!rawText) return;
      const chatId = msg.chat.id;
      const lang = tsLangOf(chatId);
      const t = TS_MENU_TEXTS[lang] || TS_MENU_TEXTS.uz;
      const webappUrl = process.env.WEBAPP_URL || "https://topsxema.duckdns.org";

      if (TS_LANG_BUTTONS[rawText]) {
        const next = TS_LANG_BUTTONS[rawText];
        tsUserLang.set(String(chatId), next);
        const nt = TS_MENU_TEXTS[next] || TS_MENU_TEXTS.uz;
        await tsSendMenu(chatId, nt.lang_ok, { parse_mode: "HTML" });
        return;
      }

      if (tsIsMenuKey(rawText, "heshteglar")) {
        await bot?.sendMessage(chatId, t.hashtags, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🔖 Atmetka qilish", web_app: { url: `${webappUrl}/profile` } }]]
          }
        }).catch(() => {});
        return;
      }

      if (tsIsMenuKey(rawText, "video_analiz")) {
        await bot?.sendMessage(chatId, t.video, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🎬 Video analiz botini ochish", url: "https://t.me/visify_aibot" }]]
          }
        }).catch(() => {});
        return;
      }

      if (tsIsMenuKey(rawText, "heshteg_olish")) {
        tsAwaitingHashtag.add(String(chatId));
        await bot?.sendMessage(chatId, t.hashtags_prompt, { parse_mode: "HTML" }).catch(() => {});
        await tsSendMenu(chatId, "👇 <b>Keyingi qadam:</b> kalit so'zni yuboring.", { parse_mode: "HTML" });
        return;
      }

      if (tsIsMenuKey(rawText, "algoritm")) {
        await bot?.sendMessage(chatId, t.algorithm, { parse_mode: "HTML" }).catch(() => {});
        return;
      }

      if (tsIsMenuKey(rawText, "til")) {
        await bot?.sendMessage(chatId, t.lang, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[
              { text: "🇺🇿 O'zbekcha" },
              { text: "🇷🇺 Русский" },
              { text: "🇬🇧 English" }
            ]]
          }
        }).catch(() => {});
        return;
      }

      // "Heshteg yuklash"dan keyin foydalanuvchi hashtag yuborsa
      if (tsAwaitingHashtag.has(String(chatId)) && rawText.startsWith("#")) {
        tsAwaitingHashtag.delete(String(chatId));
        await bot?.sendMessage(chatId, `✅ <b>${rawText}</b> qabul qilindi.\n\nEndi shu hashtag bilan atmetka qilish uchun profil sahifasini oching:`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🔖 Atmetka qilish", web_app: { url: `${webappUrl}/profile` } }]]
          }
        }).catch(() => {});
      }
    } catch (e) { console.warn("menu handler failed:", e && e.message); }
    });


    bot.on("message", async (msg) => {
      if (msg.text !== "🏠 Bosh panel") return;
      const chatId = msg.chat.id;
      if (!isAdmin(chatId)) return;
      await sendAdminDashboard(chatId);
    });
    bot.on("poll_answer", async (pollAnswer) => {
      const pollId = pollAnswer.poll_id;
      const userId = pollAnswer.user.id;
      const selectedOptionIds = pollAnswer.option_ids;
      const pollContext = activePollMap.get(pollId);
      if (!pollContext) {
        return;
      }
      if (pollContext.telegramId !== userId) {
        return;
      }
      if (selectedOptionIds.length === 0) {
        return;
      }
      const selectedOption = selectedOptionIds[0];
      const selectedOptionText = pollContext.options[selectedOption] || "Noma'lum";
      try {
        await SurveyResponse.findOneAndUpdate(
          { telegramId: userId, pollIndex: pollContext.pollIndex },
          {
            $set: {
              firstName: pollAnswer.user.first_name || "",
              question: pollContext.question,
              selectedOption,
              selectedOptionText,
              pollId,
              answeredAt: /* @__PURE__ */ new Date()
            }
          },
          { upsert: true, new: true }
        );
        activePollMap.delete(pollId);
        if (pollContext.pollIndex === 0) {
          await sendSurveyPoll(pollContext.chatId, 1);
        } else if (pollContext.pollIndex === 1) {
          await User.updateOne(
            { telegramId: userId },
            { $set: { surveyCompleted: true } }
          );
          await sendWebAppButton(pollContext.chatId);
        }
      } catch (error) {
        console.error("Error saving survey response:", error);
      }
    });
    bot.on("callback_query", async (query) => {
      const chatId = query.message?.chat.id;
      const messageId = query.message?.message_id;
      if (!chatId || !isAdmin(chatId)) {
        bot?.answerCallbackQuery(query.id, { text: "❌ Ruxsat yo'q" });
        return;
      }
      const action = query.data;
      try {
        if (action?.startsWith("vlimit_")) {
          const n = parseInt(action.slice(7), 10);
          if (Number.isFinite(n) && n >= 0 && n <= 100) {
            setVideoLimit(n);
          }
          await handleVideoLimit(chatId, messageId);
          bot?.answerCallbackQuery(query.id, { text: "✅ Limit yangilandi" });
          return;
        }
        switch (action) {
          case "stats":
            await handleStats(chatId, messageId);
            break;
          case "weekly":
            await handleWeekly(chatId, messageId);
            break;
          case "all_time":
            await handleAllTime(chatId, messageId);
            break;
          case "hourly":
            await handleHourly(chatId, messageId);
            break;
          case "peak":
            await handlePeak(chatId, messageId);
            break;
          case "video_stats":
            await handleVideoStats(chatId, messageId);
            break;
          case "video_hourly":
            await handleVideoHourly(chatId, messageId);
            break;
          case "video_limit":
            await handleVideoLimit(chatId, messageId);
            break;
          case "refresh":
            await handleRefresh(chatId, messageId);
            break;
          case "mkt_stats_hub":
            await handleMarketplaceStatsHub(chatId, messageId);
            break;
          case "mkt_stats_bio":
            await handleMarketplaceStatsBio(chatId, messageId);
            break;
          case "mkt_bio_hd_on":
          case "mkt_bio_hd_off": {
            const { setBioHdEnabled: setBioHdEnabled2, estimateBioCosts: estimateBioCosts2, formatBioCostMessage: formatBioCostMessage2 } = await Promise.resolve().then(() => bioQuality);
            const enable = action === "mkt_bio_hd_on";
            await setBioHdEnabled2(enable);
            await bot?.answerCallbackQuery(query.id, { text: enable ? "🖼 Sifatli rasm yoqildi" : "🖼 Oddiy rasm yoqildi" }).catch(() => {
            });
            const est = await estimateBioCosts2();
            await bot?.sendMessage(chatId, formatBioCostMessage2(enable, est), { parse_mode: "HTML" }).catch(() => {
            });
            await handleMarketplaceStatsBio(chatId, messageId);
            return;
          }
          case "mkt_stats_orders":
            await handleMarketplaceStatsOrders(chatId, messageId);
            break;
          case "mkt_stats_applications":
            await handleMarketplaceStatsApplications(chatId, messageId);
            break;
          case "survey_stats":
            await handleSurveyStats(chatId, messageId);
            break;
          case "survey_responses":
            await handleSurveyResponses(chatId, messageId);
            break;
          case "survey_back":
            await handleRefresh(chatId, messageId);
            break;
          case "heshteg_on":
          case "heshteg_off": {
            const { setHeshtegEnabled: setHeshtegEnabled2 } = await Promise.resolve().then(() => marketplaceConfig);
            const newState = action === "heshteg_on";
            await setHeshtegEnabled2(newState);
            const statusText = newState ? "🟢 Yoqilgan" : "🔴 O'chirilgan";
            const text = `🔖 *Heshteg olish xizmati*

Hozirgi holati: *${statusText}*

` + (newState ? "_Foydalanuvchilar WebApp orqali Instagram caption va heshteg olishlari mumkin._" : `_Xizmat o'chirilgan. Foydalanuvchilarga "Xizmat vaqtincha yopiq" xabari ko'rsatiladi._`);
            const kb = {
              inline_keyboard: [
                [
                  { text: "🟢 Yoqish", callback_data: "heshteg_on" },
                  { text: "🔴 O'chirish", callback_data: "heshteg_off" }
                ],
                [{ text: "📊 Heshteg statistikasi", callback_data: "heshteg_stats" }],
                [{ text: "📝 Haftalik xeshteg", callback_data: "heshteg_weekly" }],
                [{ text: "📢 Hamma xeshteglar kanali", callback_data: "heshteg_channel" }]
              ]
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "Markdown",
                reply_markup: kb
              }).catch(() => {
              });
            }
            break;
          }
          case "heshteg_stats": {
            const daily = getDailyStats();
            const weekly = getWeeklyStats();
            const all = getAllTimeStats();
            const { isHeshtegEnabled: isHeshtegEnabled2 } = await Promise.resolve().then(() => marketplaceConfig);
            const enabled = await isHeshtegEnabled2();
            const startDate = new Date(all.firstEventAt).toLocaleString("uz-UZ", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric"
            });
            const text = `📊 *Heshteg yuklash statistikasi*

Xizmat holati: ${enabled ? "🟢 Yoqilgan" : "🔴 O'chirilgan"}

🗂 *Umumiy (${startDate} dan beri):*
• Caption olishlar: *${all.totalExtractions}*
• Tashriflar: *${all.totalVisits}*

📅 *Bugun:*
• Caption olishlar: *${daily.totalExtractions}*
• Tashriflar: *${daily.totalVisits}*

📈 *So'nggi 7 kun:*
• Caption olishlar: *${weekly.totalExtractions}*
• Tashriflar: *${weekly.totalVisits}*

_Yangilash: ${(/* @__PURE__ */ new Date()).toLocaleString("uz-UZ", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}_`;
            const kb = {
              inline_keyboard: [
                [{ text: "🔄 Yangilash", callback_data: "heshteg_stats" }],
                [{ text: "⬅️ Orqaga", callback_data: "heshteg_back" }]
              ]
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "Markdown",
                reply_markup: kb
              }).catch(() => {
              });
            }
            break;
          }
          case "heshteg_weekly": {
            const fs2 = await import("fs");
            const path2 = await import("path");
            const storePath = path2.join(process.cwd(), "server", "data", "weekly-hashtag.json");
            let current = "— (sozlanmagan, default ishlatilmoqda)";
            let updatedAt = "—";
            try {
              const raw = fs2.readFileSync(storePath, "utf8");
              const j = JSON.parse(raw);
              if (j.hashtag) current = j.hashtag;
              if (j.updatedAt) updatedAt = String(j.updatedAt).slice(0, 16).replace("T", " ");
            } catch {
            }
            const preview2 = current.length > 600 ? current.slice(0, 600) + "…" : current;
            const text = `📝 *Haftalik xeshteg*

*Hozirgi:*
\`${preview2.replace(/`/g, "")}\`

*Yangilangan:* \`${updatedAt}\``;
            const kb = {
              inline_keyboard: [
                [{ text: "✏️ Yangilash", callback_data: "heshteg_weekly_edit" }],
                [{ text: "⬅️ Orqaga", callback_data: "heshteg_back" }]
              ]
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "Markdown",
                reply_markup: kb
              }).catch(() => {
              });
            }
            break;
          }
          case "heshteg_back": {
            const { isHeshtegEnabled: isHeshtegEnabled2 } = await Promise.resolve().then(() => marketplaceConfig);
            const enabled = await isHeshtegEnabled2();
            const statusText = enabled ? "🟢 Yoqilgan" : "🔴 O'chirilgan";
            const text = `🔖 *Heshteg olish xizmati*

Hozirgi holati: *${statusText}*

Boshqarish uchun pastdagi tugmalardan foydalaning.`;
            const kb = {
              inline_keyboard: [
                [
                  { text: "🟢 Yoqish", callback_data: "heshteg_on" },
                  { text: "🔴 O'chirish", callback_data: "heshteg_off" }
                ],
                [{ text: "📊 Heshteg statistikasi", callback_data: "heshteg_stats" }],
                [{ text: "📝 Haftalik xeshteg", callback_data: "heshteg_weekly" }],
                [{ text: "📢 Hamma xeshteglar kanali", callback_data: "heshteg_channel" }]
              ]
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "Markdown",
                reply_markup: kb
              }).catch(() => {
              });
            }
            break;
          }
        }
        bot?.answerCallbackQuery(query.id, { text: "✅ Yangilandi" });
      } catch (error) {
        console.error("Error handling callback:", error);
        bot?.answerCallbackQuery(query.id, { text: "❌ Xatolik yuz berdi" });
      }
    });
    bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      if (isAdmin(chatId)) {
        const helpMessage = `
📚 *Yordam*

*Komandalar:*
/start - Asosiy menyu
/help - Bu yordam xabari

*Tugmalar:*
🔖 Heshteg yuklash - WebApp ni ochish
📊 Kunlik Statistika - Bugungi ma'lumotlar
📈 Haftalik - So'nggi 7 kun
⏰ Soatlik Taqsimot - Soat bo'yicha taqsimot
🔥 Eng Faol Soat - Eng ko'p foydalanilgan vaqt
📋 So'rovnoma - So'rovnoma statistikasi
🔄 Yangilash - Ma'lumotlarni yangilash
        `;
        bot?.sendMessage(chatId, helpMessage, {
          parse_mode: "Markdown",
          ...mainKeyboard
        });
      } else {
        bot?.sendMessage(chatId, `
📚 *Yordam*

/start - 🔖 Heshteg yuklash tugmasini ko'rish
/help - Bu yordam xabari

🔖 Heshteg yuklash tugmasini bosib, Instagram caption olish dasturidan foydalaning.
        `, { parse_mode: "Markdown" });
      }
    });
  } catch (error) {
    console.error("❌ Error starting Telegram bot:", error);
  }
}
function fmtNum$1(n) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}
function fmtTotal(n, approx) {
  return approx ? `${fmtNum$1(n)}+` : fmtNum$1(n);
}
function nowTs() {
  return (/* @__PURE__ */ new Date()).toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
async function sendOrEdit(chatId, messageId, text) {
  if (messageId) {
    await bot?.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...mainKeyboard
    }).catch(async (e) => {
      const m = String(e?.message || "");
      if (!/not modified/i.test(m)) {
        await bot?.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainKeyboard }).catch(() => {
        });
      }
    });
  } else {
    await bot?.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainKeyboard }).catch(() => {
    });
  }
}
async function handleStats(chatId, messageId) {
  const stats = getDailyStats();
  const weekly = getWeeklyStats();
  const all = getAllTimeStats();
  const startDate = new Date(all.firstEventAt).toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const avgPerDay = all.totalExtractions > 0 && all.firstEventAt ? Math.round(all.totalExtractions / Math.max(1, Math.ceil((Date.now() - all.firstEventAt) / 864e5))) : 0;
  const message = `📊 *BUGUNGI STATISTIKA*
━━━━━━━━━━━━━━━━━━

🪄 Caption olishlar:  *${fmtNum$1(stats.totalExtractions)}*
👥 Tashriflar:        *${fmtNum$1(stats.totalVisits)}*

📈 *Solishtirish*
• So'nggi 7 kun:      ${fmtNum$1(weekly.totalExtractions)}
• Kuniga o'rtacha:    ${fmtNum$1(avgPerDay)}
• Jami (${startDate} dan): *${fmtTotal(all.totalExtractions, all.approximate)}*

_🕐 ${nowTs()}_`;
  await sendOrEdit(chatId, messageId, message);
}
async function handleWeekly(chatId, messageId) {
  const weekly = getWeeklyStats();
  const daily = getDailyStats();
  const all = getAllTimeStats();
  const dailyAvg = Math.round(weekly.totalExtractions / 7);
  const todayShare = weekly.totalExtractions > 0 ? Math.round(daily.totalExtractions / weekly.totalExtractions * 100) : 0;
  const message = `📈 *7 KUNLIK STATISTIKA*
━━━━━━━━━━━━━━━━━━

🪄 Caption olishlar:  *${fmtNum$1(weekly.totalExtractions)}*
👥 Tashriflar:        *${fmtNum$1(weekly.totalVisits)}*

📊 *Tahlil*
• Kuniga o'rtacha:    ${fmtNum$1(dailyAvg)}
• Bugun ulushi:       ${todayShare}%
• Bugun:              ${fmtNum$1(daily.totalExtractions)}
• Jami:               *${fmtTotal(all.totalExtractions, all.approximate)}*

_🕐 ${nowTs()}_`;
  await sendOrEdit(chatId, messageId, message);
}
async function handleAllTime(chatId, messageId) {
  const all = getAllTimeStats();
  const daily = getDailyStats();
  const weekly = getWeeklyStats();
  const daysActive = Math.max(1, Math.ceil((Date.now() - all.firstEventAt) / 864e5));
  const avgPerDay = Math.round(all.totalExtractions / daysActive);
  const startDate = new Date(all.firstEventAt).toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const message = `🗂 *UMUMIY STATISTIKA*
━━━━━━━━━━━━━━━━━━

🪄 Caption olishlar:  *${fmtTotal(all.totalExtractions, all.approximate)}*
👥 Tashriflar:        *${fmtNum$1(all.totalVisits)}*

📅 *Davr*
• Ishga tushgan:      ${startDate}
• Faol kunlar:        ${fmtNum$1(daysActive)} kun
• Kuniga o'rtacha:    ${fmtNum$1(avgPerDay)}

📊 *Hozirgi davr*
• Bugun:              ${fmtNum$1(daily.totalExtractions)}
• So'nggi 7 kun:      ${fmtNum$1(weekly.totalExtractions)}

_🕐 ${nowTs()}_`;
  await sendOrEdit(chatId, messageId, message);
}
async function handleHourly(chatId, messageId) {
  const hourlyData = getHourlyDistribution();
  const entries = Object.entries(hourlyData).map(([h, c]) => [Number(h), c]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const maxCount = Math.max(1, ...entries.map(([, c]) => c));
  let message = `⏰ *SOATLIK TAQSIMOT (Bugun)*
━━━━━━━━━━━━━━━━━━

`;
  if (total === 0) {
    message += `_Bugun hali hech kim foydalanmagan._
`;
  } else {
    const BAR_LEN = 12;
    for (const [h, c] of entries) {
      if (c === 0) continue;
      const filled = Math.round(c / maxCount * BAR_LEN);
      const bar = "█".repeat(filled) + "░".repeat(BAR_LEN - filled);
      const hh = String(h).padStart(2, "0");
      message += `\`${hh}:00\` ${bar} ${fmtNum$1(c)}
`;
    }
    message += `
📊 *Jami:* ${fmtNum$1(total)} ta`;
  }
  message += `

_🕐 ${nowTs()}_`;
  await sendOrEdit(chatId, messageId, message);
}
async function handlePeak(chatId, messageId) {
  const peak = getPeakHour();
  const daily = getDailyStats();
  const share = daily.totalExtractions > 0 ? Math.round(peak.count / daily.totalExtractions * 100) : 0;
  const message = `🔥 *PIK SOAT (Bugun)*
━━━━━━━━━━━━━━━━━━

⏰ *${String(peak.hour).padStart(2, "0")}:00 – ${String((peak.hour + 1) % 24).padStart(2, "0")}:00*
🪄 Caption olishlar: *${fmtNum$1(peak.count)}*
📊 Kunlik ulushi:    ${share}%

_🕐 ${nowTs()}_`;
  await sendOrEdit(chatId, messageId, message);
}
async function handleVideoStats(chatId, messageId) {
  const v = getVideoStats();
  const message = `🎬 *VIDEO ANALIZ STATISTIKASI*
━━━━━━━━━━━━━━━━━━

⚡️ *So'nggi 1 soat:* ${fmtNum$1(v.lastHour)} ta

📊 *Bugun*
• Tahlillar:      *${fmtNum$1(v.today)}* ta
• Foydalanuvchi:  ${fmtNum$1(v.todayUsers)} ta
• O'rtacha viral: ${v.avgViralToday}%

📈 *So'nggi 7 kun*
• Tahlillar:      *${fmtNum$1(v.week)}* ta
• Foydalanuvchi:  ${fmtNum$1(v.weekUsers)} ta

🗓 *So'nggi 30 kun*
• Tahlillar:      *${fmtNum$1(v.month)}* ta
• Foydalanuvchi:  ${fmtNum$1(v.monthUsers)} ta

🗂 *Umumiy*
• Tahlillar:      *${fmtNum$1(v.total)}* ta
• Foydalanuvchi:  ${fmtNum$1(v.totalUsers)} ta
• O'rtacha viral: ${v.avgViralAll}%

_🕐 ${nowTs()}_`;
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⏰ Soatlik taqsimot", callback_data: "video_hourly" },
          { text: "🔄 Yangilash", callback_data: "video_stats" }
        ],
        [
          { text: "⚙️ Kunlik limit", callback_data: "video_limit" }
        ],
        [
          { text: "⬅️ Orqaga", callback_data: "refresh" }
        ]
      ]
    }
  };
  if (messageId) {
    await bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...kb
    }).catch(() => {
    });
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: "Markdown", ...kb });
  }
}
async function handleMarketplaceStatsHub(chatId, messageId) {
  const message = `🏪 *MARKETPLACE STATISTIKA*
━━━━━━━━━━━━━━━━━━

Qaysi bo'lim bo'yicha statistikani ko'rmoqchisiz?

_🕐 ${nowTs()}_`;
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🪪 Bio yuklash", callback_data: "mkt_stats_bio" }],
        [{ text: "🎬 Video ulashlar", callback_data: "mkt_stats_orders" }],
        [{ text: "📝 Yangi arizalar", callback_data: "mkt_stats_applications" }],
        [{ text: "⬅️ Orqaga", callback_data: "refresh" }]
      ]
    }
  };
  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...kb }).catch(() => {
    });
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: "Markdown", ...kb });
  }
}
async function handleMarketplaceStatsBio(chatId, messageId) {
  const b = getBioStats();
  const { isBioHdEnabled: isBioHdEnabled2, estimateBioCosts: estimateBioCosts2 } = await Promise.resolve().then(() => bioQuality);
  const hdOn = await isBioHdEnabled2();
  const est = await Promise.race([estimateBioCosts2(), new Promise((r) => setTimeout(() => r(null), 6e3))]);
  const usd2 = (n) => `$${n.toFixed(2)}`;
  const qualityBlock = `🖼 <b>Rasm sifati:</b> ${hdOn ? "🟢 Sifatli (1080×1080)" : "⚪ Oddiy (320×320)"}
` + (est ? hdOn ? `💸 Sifatli rasm hozir qo'shmoqda: <b>+${usd2(est.hdExtraPerMonthUsd)}/oy</b> (kuniga ~${Math.round(est.runsPerDay)} ta pullik yuklash)

` : `💸 Sifatliga o'tilsa: <b>+${usd2(est.hdExtraPerMonthUsd)}/oy</b> (kuniga ~${Math.round(est.runsPerDay)} ta pullik yuklash)

` : "\n");
  const message = `🪪 <b>BIO YUKLASH STATISTIKASI</b>
━━━━━━━━━━━━━━━━━━

📊 <b>Bugun</b>
• Yuklashlar: <b>${fmtNum$1(b.today)}</b> ta
• Foydalanuvchi: ${fmtNum$1(b.todayUsers)} ta

📈 <b>So'nggi 7 kun</b>
• Yuklashlar: <b>${fmtNum$1(b.week)}</b> ta
• Foydalanuvchi: ${fmtNum$1(b.weekUsers)} ta

🗂 <b>Jami (xizmat boshlanganidan beri)</b>
• Yuklashlar: <b>${fmtNum$1(b.allTime)}</b> ta

` + qualityBlock + `<i>Manba: WebApp "Bio yuklash" tugmasi + bot.php /bio_olish komandasi birgalikda.</i>

<i>🕐 ${nowTs()}</i>`;
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [hdOn ? { text: "⚪ Oddiy rasmga o'tish (arzonroq)", callback_data: "mkt_bio_hd_off" } : { text: "🟢 Sifatli rasmga o'tish", callback_data: "mkt_bio_hd_on" }],
        [{ text: "🔄 Yangilash", callback_data: "mkt_stats_bio" }],
        [{ text: "⬅️ Orqaga", callback_data: "mkt_stats_hub" }]
      ]
    }
  };
  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", ...kb }).catch((e) => console.warn("bio stats edit failed:", e instanceof Error ? e.message : e));
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: "HTML", ...kb });
  }
}
const ORDER_STATUS_LABEL = {
  AWAITING_SELLER_CONSENT: "⏳ Sotuvchi javobini kutmoqda",
  AWAITING_PAYMENT: "💳 To'lov kutilmoqda",
  AWAITING_PAYMENT_APPROVAL: "🔍 Admin tasdiqlashini kutmoqda",
  AWAITING_BUYER_MATERIAL: "🎬 Xaridor video yuborishi kutilmoqda",
  PAYMENT_APPROVED: "📤 Sotuvchi post joylashi kutilmoqda",
  AWAITING_BUYER_VERIFY: "✅ Xaridor tasdiqlashi kutilmoqda",
  BUYER_VERIFIED: "🕐 Pul chiqishi kutilmoqda (24s)",
  COMPLETED: "✅ Yakunlangan",
  CANCELLED: "❌ Bekor qilingan",
  DISPUTED: "⚠️ Nizoli",
  REFUNDED: "↩️ Qaytarilgan",
  EXPIRED: "⏰ Muddati o'tgan",
  PENDING_PAYMENT: "💳 To'lov kutilmoqda (eski)",
  PAID: "💰 To'langan (eski)",
  ACCEPTED: "✅ Qabul qilingan (eski)",
  POSTED: "📤 Joylangan (eski)"
};
async function handleMarketplaceStatsOrders(chatId, messageId) {
  const { getOrderStats } = await import("./marketplace-stats-BCv7ha4l.js");
  const o = await getOrderStats();
  const statusLines = Object.entries(o.byStatus).filter(([, count]) => count > 0).sort(([, a], [, b]) => b - a).map(([status, count]) => `• ${ORDER_STATUS_LABEL[status] || status}: *${fmtNum$1(count)}*`).join("\n") || "_Hozircha buyurtma yo'q._";
  const message = `🎬 *VIDEO ULASHLAR STATISTIKASI*
━━━━━━━━━━━━━━━━━━

📊 *Bugun*
• Yangi buyurtma:  *${fmtNum$1(o.createdToday)}* ta
• Yakunlangan:     *${fmtNum$1(o.completedToday)}* ta
• Noyob xaridor:   ${fmtNum$1(o.uniqueBuyersToday)} ta

📈 *So'nggi 7 kun*
• Yangi buyurtma:  *${fmtNum$1(o.createdWeek)}* ta
• Yakunlangan:     *${fmtNum$1(o.completedWeek)}* ta

🗂 *Jami*
• Yangi buyurtma:  *${fmtNum$1(o.createdAll)}* ta
• Yakunlangan:     *${fmtNum$1(o.completedAll)}* ta
• Noyob xaridor:   ${fmtNum$1(o.uniqueBuyersAll)} ta

🧩 *Hozirgi bosqichlar bo'yicha (barcha buyurtmalar)*
${statusLines}

_🕐 ${nowTs()}_`;
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Yangilash", callback_data: "mkt_stats_orders" }],
        [{ text: "⬅️ Orqaga", callback_data: "mkt_stats_hub" }]
      ]
    }
  };
  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...kb }).catch(() => {
    });
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: "Markdown", ...kb });
  }
}
const ACCOUNT_STATUS_LABEL = {
  PENDING: "⏳ Ko'rib chiqilmoqda",
  ACTIVE: "✅ Faol (marketplace'da)",
  SUSPENDED: "🧊 Muzlatilgan",
  BANNED: "⛔️ Bloklangan"
};
async function handleMarketplaceStatsApplications(chatId, messageId) {
  const { getAccountApplicationStats } = await import("./marketplace-stats-BCv7ha4l.js");
  const a = await getAccountApplicationStats();
  const statusLines = Object.entries(a.byStatus).filter(([, count]) => count > 0).sort(([, x], [, y]) => y - x).map(([status, count]) => `• ${ACCOUNT_STATUS_LABEL[status] || status}: *${fmtNum$1(count)}*`).join("\n") || "_Hozircha ariza yo'q._";
  const message = `📝 *YANGI ARIZALAR STATISTIKASI*
━━━━━━━━━━━━━━━━━━

📊 *Bugun kelgan arizalar:* *${fmtNum$1(a.createdToday)}* ta
📈 *So'nggi 7 kunda:* *${fmtNum$1(a.createdWeek)}* ta
🗂 *Jami (hammasi vaqtidan beri):* *${fmtNum$1(a.createdAll)}* ta

🧩 *Hozirgi holat bo'yicha (barcha akkountlar)*
${statusLines}

_🕐 ${nowTs()}_`;
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Yangilash", callback_data: "mkt_stats_applications" }],
        [{ text: "⬅️ Orqaga", callback_data: "mkt_stats_hub" }]
      ]
    }
  };
  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...kb }).catch(() => {
    });
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: "Markdown", ...kb });
  }
}
async function handleVideoLimit(chatId, messageId) {
  const cur = getVideoLimit();
  const curText = cur === 0 ? "♾ Cheksiz" : `${cur} ta/kun`;
  const message = `⚙️ *VIDEO ANALIZ — KUNLIK LIMIT*
━━━━━━━━━━━━━━━━━━

Oddiy foydalanuvchilar uchun bir kunda ruxsat etilgan tahlillar soni.
_Adminlarga limit ta'sir qilmaydi._

Hozirgi limit: *${curText}*

Yangi limitni tanlang:`;
  const btn = (n) => ({
    text: (n === cur ? "✅ " : "") + (n === 0 ? "♾" : String(n)),
    callback_data: `vlimit_${n}`
  });
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [btn(1), btn(2), btn(3)],
        [btn(5), btn(10), btn(0)],
        [
          { text: "⬅️ Video statistika", callback_data: "video_stats" }
        ]
      ]
    }
  };
  if (messageId) {
    await bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...kb
    }).catch(() => {
    });
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: "Markdown", ...kb });
  }
}
async function handleVideoHourly(chatId, messageId) {
  const hourly = getVideoHourlyDistribution();
  const maxCount = Math.max(...Object.values(hourly), 1);
  let bars = "";
  for (let i = 0; i < 24; i++) {
    const count = hourly[i] || 0;
    if (count === 0) continue;
    const barLen = Math.max(1, Math.round(count / maxCount * 10));
    bars += `${String(i).padStart(2, "0")}:00 ${"▓".repeat(barLen)} ${count}
`;
  }
  if (!bars) bars = "_Bugun hali tahlil bo'lmagan_\n";
  const message = `🎬 *VIDEO ANALIZ — SOATLIK (Bugun)*
━━━━━━━━━━━━━━━━━━

${bars}
_🕐 ${nowTs()}_`;
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⬅️ Video statistika", callback_data: "video_stats" },
          { text: "🔄 Yangilash", callback_data: "video_hourly" }
        ]
      ]
    }
  };
  if (messageId) {
    await bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...kb
    }).catch(() => {
    });
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: "Markdown", ...kb });
  }
}
async function handleRefresh(chatId, messageId) {
  const daily = getDailyStats();
  const weekly = getWeeklyStats();
  const all = getAllTimeStats();
  const message = `🏠 *ADMIN PANEL*
━━━━━━━━━━━━━━━━━━

📊 *Tezkor ko'rinish*
• Bugun:        *${fmtNum$1(daily.totalExtractions)}* ta
• So'nggi 7 kun: *${fmtNum$1(weekly.totalExtractions)}* ta
• Jami:         *${fmtTotal(all.totalExtractions, all.approximate)}* ta

👇 Boshqaruv uchun pastdagi menyu tugmalaridan foydalaning.

_🕐 ${nowTs()}_`;
  await sendOrEdit(chatId, messageId, message);
}
async function handleSurveyStats(chatId, messageId) {
  const totalUsers = await User.countDocuments({});
  const totalCompleted = await User.countDocuments({ surveyCompleted: true });
  const poll1Stats = await SurveyResponse.aggregate([
    { $match: { pollIndex: 0 } },
    { $group: { _id: "$selectedOptionText", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  const poll2Stats = await SurveyResponse.aggregate([
    { $match: { pollIndex: 1 } },
    { $group: { _id: "$selectedOptionText", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  const poll1Total = poll1Stats.reduce((sum, s) => sum + s.count, 0);
  const poll2Total = poll2Stats.reduce((sum, s) => sum + s.count, 0);
  let message = `📋 *So'rovnoma Statistikasi*

`;
  message += `👥 Jami foydalanuvchilar: *${totalUsers}*
`;
  message += `✅ So'rovnomani tugatganlar: *${totalCompleted}*
`;
  message += `📊 Tugatish foizi: *${totalUsers > 0 ? Math.round(totalCompleted / totalUsers * 100) : 0}%*

`;
  message += `*1-savol:* ${SURVEY_POLLS[0].question}
`;
  for (const stat of poll1Stats) {
    const pct = poll1Total > 0 ? Math.round(stat.count / poll1Total * 100) : 0;
    message += `  • ${stat._id}: *${stat.count}* (${pct}%)
`;
  }
  message += `
*2-savol:* ${SURVEY_POLLS[1].question}
`;
  for (const stat of poll2Stats) {
    const pct = poll2Total > 0 ? Math.round(stat.count / poll2Total * 100) : 0;
    message += `  • ${stat._id}: *${stat.count}* (${pct}%)
`;
  }
  if (messageId) {
    bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...surveyKeyboard
    });
  } else {
    bot?.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      ...surveyKeyboard
    });
  }
}
async function handleSurveyResponses(chatId, messageId) {
  const recentResponses = await SurveyResponse.aggregate([
    { $sort: { answeredAt: -1 } },
    { $group: {
      _id: "$telegramId",
      answers: { $push: { pollIndex: "$pollIndex", answer: "$selectedOptionText" } },
      name: { $first: "$firstName" },
      completedAt: { $first: "$answeredAt" }
    } },
    { $sort: { completedAt: -1 } },
    { $limit: 15 }
  ]);
  let message = `👥 *So'nggi Javoblar*

`;
  if (recentResponses.length === 0) {
    message += "_Hali javoblar yo'q_\n";
  } else {
    for (const resp of recentResponses) {
      const answers = resp.answers.sort((a, b) => a.pollIndex - b.pollIndex);
      message += `👤 *${resp.name || "Noma'lum"}* (${resp._id})
`;
      for (const a of answers) {
        message += `  ${a.pollIndex + 1}) ${a.answer}
`;
      }
      const date = new Date(resp.completedAt);
      message += `  _${date.toLocaleDateString("uz-UZ")} ${date.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}_

`;
    }
  }
  if (messageId) {
    bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...surveyResponsesKeyboard
    });
  } else {
    bot?.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      ...surveyResponsesKeyboard
    });
  }
}
function isAdmin(chatId) {
  return ADMIN_IDS$3.includes(chatId);
}
function getBot() {
  return bot;
}
function getSellerBot() {
  return sellerBot || bot;
}
function getAdminIds() {
  return ADMIN_IDS$3.filter((n) => !isNaN(n) && n > 0);
}
const bot$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getAdminIds,
  getBot,
  getSellerBot,
  initBot
}, Symbol.toStringTag, { value: "Module" }));
async function sendBotMessage(chatId, text, options) {
  const bot2 = getBot();
  if (!bot2) {
    console.log(`[bot-helpers] sendBotMessage skipped (bot not ready) → ${chatId}: ${text.slice(0, 80)}`);
    return null;
  }
  try {
    return await bot2.sendMessage(chatId, text, options);
  } catch (err) {
    console.warn(
      "[bot-helpers] sendBotMessage failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
let _legacyBotSend = null;
async function createNotification(userId, type, title, body, payload = {}) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      payload
    }
  });
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true }
    });
    if (user) {
      const chatId = Number(user.telegramId);
      const text = `*${escapeMarkdown(title)}*

${escapeMarkdown(body)}`;
      const opts = {
        parse_mode: "Markdown"
      };
      if (payload.inlineKeyboard) {
        opts.reply_markup = payload.inlineKeyboard;
      }
      await sendBotMessage(chatId, text, opts);
      if (_legacyBotSend) ;
    }
  } catch (e) {
    console.warn("Telegram notif delivery failed:", e instanceof Error ? e.message : e);
  }
  return notification;
}
function getAdminTelegramIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
}
async function notifyAdmins$1(type, title, body, payload = {}) {
  const adminTgIds = getAdminTelegramIds();
  if (adminTgIds.length === 0) return;
  const admins = await prisma.user.findMany({
    where: { telegramId: { in: adminTgIds.map(BigInt) } },
    select: { id: true }
  });
  for (const admin of admins) {
    await createNotification(admin.id, type, title, body, payload);
  }
}
function escapeMarkdown(text) {
  return text.replace(/([_*`\[])/g, "\\$1");
}
const submissionsByAccount = /* @__PURE__ */ new Map();
const awaitingPrice$1 = /* @__PURE__ */ new Map();
function saveSubmission(sub) {
  let byAdmin = submissionsByAccount.get(sub.accountId);
  if (!byAdmin) {
    byAdmin = /* @__PURE__ */ new Map();
    submissionsByAccount.set(sub.accountId, byAdmin);
  }
  byAdmin.set(sub.adminChatId, sub);
}
function getSubmission(accountId, adminChatId) {
  return submissionsByAccount.get(accountId)?.get(adminChatId);
}
function getAllSubmissionsForAccount(accountId) {
  const byAdmin = submissionsByAccount.get(accountId);
  return byAdmin ? Array.from(byAdmin.values()) : [];
}
function deleteAllSubmissionsForAccount(accountId) {
  const byAdmin = submissionsByAccount.get(accountId);
  if (byAdmin) {
    for (const adminChatId of byAdmin.keys()) awaitingPrice$1.delete(adminChatId);
  }
  submissionsByAccount.delete(accountId);
}
function setAwaitingPrice(adminChatId, accountId) {
  awaitingPrice$1.set(adminChatId, accountId);
}
function getAwaitingPrice(adminChatId) {
  return awaitingPrice$1.get(adminChatId);
}
function clearAwaitingPrice(adminChatId) {
  awaitingPrice$1.delete(adminChatId);
}
const CHAT_TTL_MS = 10 * 60 * 1e3;
const awaitingAdminMessage = /* @__PURE__ */ new Map();
const awaitingOwnerReply = /* @__PURE__ */ new Map();
const lastChatAdmin = /* @__PURE__ */ new Map();
function setLastChatAdmin(accountId, adminChatId) {
  lastChatAdmin.set(accountId, adminChatId);
}
function getLastChatAdmin(accountId) {
  return lastChatAdmin.get(accountId);
}
function setAwaitingAdminMessage(adminChatId, accountId, ownerTgId) {
  awaitingAdminMessage.set(adminChatId, { accountId, ownerTgId, expiresAt: Date.now() + CHAT_TTL_MS });
}
function getAwaitingAdminMessage(adminChatId) {
  const v = awaitingAdminMessage.get(adminChatId);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    awaitingAdminMessage.delete(adminChatId);
    return null;
  }
  return { accountId: v.accountId, ownerTgId: v.ownerTgId };
}
function clearAwaitingAdminMessage(adminChatId) {
  awaitingAdminMessage.delete(adminChatId);
}
function setAwaitingOwnerReply(ownerTgId, accountId, adminChatId) {
  awaitingOwnerReply.set(ownerTgId, { accountId, adminChatId, expiresAt: Date.now() + CHAT_TTL_MS });
}
function getAwaitingOwnerReply(ownerTgId) {
  const v = awaitingOwnerReply.get(ownerTgId);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    awaitingOwnerReply.delete(ownerTgId);
    return null;
  }
  return { accountId: v.accountId, adminChatId: v.adminChatId };
}
function clearAwaitingOwnerReply(ownerTgId) {
  awaitingOwnerReply.delete(ownerTgId);
}
function buildAccountButtons(accountId, hasPrice) {
  const row1 = hasPrice ? [
    { text: "✅ Tasdiqlash", callback_data: `mkt:verify:${accountId}:approve` },
    { text: "❌ Rad etish", callback_data: `mkt:verify:${accountId}:reject` }
  ] : [{ text: "❌ Rad etish", callback_data: `mkt:verify:${accountId}:reject` }];
  const row2 = [
    {
      text: hasPrice ? "💰 Narxni o'zgartirish" : "💰 Narx belgilash",
      callback_data: `mkt:verify:${accountId}:price`
    }
  ];
  const row3 = [
    { text: "💬 Egasiga yozish", callback_data: `mkt:verify:${accountId}:chat` }
  ];
  return { inline_keyboard: [row1, row2, row3] };
}
function buildAccountCaption(sub) {
  const priceLine = sub.price ? `
💰 <b>${sub.price.toLocaleString("uz-UZ")} so'm</b>` : "";
  const hint = sub.price ? "\n\n<i>Narx belgilangan. Tasdiqlang yoki rad eting.</i>" : "\n\n<i>Avval narx belgilang, keyin tasdiqlash mumkin.</i>";
  return `🆕 <b>Yangi e'lon arizasi</b>

👤 <b>@${sub.igUsername}</b>
🙋 Yuboruvchi: ${sub.submittedBy}
🆔 Akkaunt: <code>#${sub.accountId}</code>` + priceLine + hint;
}
function buildEditAccountButtons(accountId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Tasdiqlash", callback_data: `mkt:editreq:${accountId}:approve` },
        { text: "❌ Rad etish", callback_data: `mkt:editreq:${accountId}:reject` }
      ]
    ]
  };
}
function buildEditAccountCaption(sub) {
  return `✏️ <b>Akkaunt yangilanish so'rovi</b>

👤 <b>@${sub.igUsername}</b>
🙋 Yuboruvchi: ${sub.submittedBy}
🆔 Akkaunt: <code>#${sub.accountId}</code>

<i>Egasi yangi rasm/skrinshot yubordi. Tasdiqlasangiz akkauntga darhol qo'llaniladi.</i>`;
}
const accountSubmissions = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  buildAccountButtons,
  buildAccountCaption,
  buildEditAccountButtons,
  buildEditAccountCaption,
  clearAwaitingAdminMessage,
  clearAwaitingOwnerReply,
  clearAwaitingPrice,
  deleteAllSubmissionsForAccount,
  getAllSubmissionsForAccount,
  getAwaitingAdminMessage,
  getAwaitingOwnerReply,
  getAwaitingPrice,
  getLastChatAdmin,
  getSubmission,
  saveSubmission,
  setAwaitingAdminMessage,
  setAwaitingOwnerReply,
  setAwaitingPrice,
  setLastChatAdmin
}, Symbol.toStringTag, { value: "Module" }));
function toDTO(acc) {
  return {
    id: acc.id,
    ownerId: acc.ownerId,
    igUsername: acc.igUsername,
    igProfileUrl: acc.igProfileUrl,
    avatarFileId: acc.avatarFileId ?? "",
    niche: acc.niche,
    customNiche: acc.customNiche ?? "",
    region: acc.region,
    description: acc.description,
    verificationScreenshots: Array.isArray(acc.verificationScreenshots) ? acc.verificationScreenshots : acc.verificationScreenshots ? Object.values(acc.verificationScreenshots) : [],
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
    pendingEdit: acc.pendingEdit ?? null
  };
}
const handleListAccounts = async (req, res) => {
  try {
    await prisma.adAccount.updateMany({
      where: { status: "SUSPENDED", frozenUntil: { lte: /* @__PURE__ */ new Date() } },
      data: { status: "ACTIVE", frozenUntil: null }
    }).catch(() => {
    });
    const { niche, region, sort = "popular", search, minFollowers } = req.query;
    const where = { status: "ACTIVE" };
    if (niche) where.niche = niche;
    if (region) where.region = { contains: region, mode: "insensitive" };
    if (minFollowers) where.followers = { gte: Number(minFollowers) };
    if (search) {
      where.OR = [
        { igUsername: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } }
      ];
    }
    let orderBy = {};
    switch (sort) {
      case "new":
        orderBy = { createdAt: "desc" };
        break;
      case "cheap":
        orderBy = { priceReels: "asc" };
        break;
      case "rating":
        orderBy = { rating: "desc" };
        break;
      default:
        orderBy = [{ rating: "desc" }, { completedOrders: "desc" }];
    }
    const accounts2 = await prisma.adAccount.findMany({ where, orderBy });
    res.json({ success: true, accounts: accounts2.map(toDTO) });
  } catch (err) {
    console.error("handleListAccounts error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleGetAccount = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Noto'g'ri ID" });
      return;
    }
    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: "Akkaunt topilmadi" });
      return;
    }
    const cases = await prisma.caseStudy.findMany({
      where: { adAccountId: id, isApproved: true },
      orderBy: { createdAt: "desc" },
      take: 3
    });
    const completedCount = await prisma.order.count({
      where: { adAccountId: id, status: "COMPLETED" }
    });
    res.json({ success: true, account: toDTO(account), cases, completedOrdersCount: completedCount });
  } catch (err) {
    console.error("handleGetAccount error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const createAccountSchema = z.object({
  igUsername: z.string().min(1).max(50),
  igProfileUrl: z.string().url().optional().or(z.literal("")),
  avatarFileId: z.string().min(1, "Akkaunt rasmini yuklang"),
  niche: z.enum(["EDIT", "STATUS", "LIFESTYLE", "BEAUTY", "FOOD", "SPORT", "AUTO", "BUSINESS", "EDUCATION", "ENTERTAINMENT", "TECH", "OTHER"]).optional(),
  // niche === 'OTHER' bo'lganda "o'zingiz kiriting" matni
  customNiche: z.string().max(50).optional(),
  region: z.string().max(100).optional(),
  description: z.string().max(1e3).optional(),
  followers: z.number().int().nonnegative().optional(),
  avgReelsViews: z.number().int().nonnegative().optional(),
  storyViews: z.number().int().nonnegative().optional(),
  engagementRate: z.number().min(0).max(100).optional(),
  priceStory: z.number().int().nonnegative().optional(),
  priceReels: z.number().int().nonnegative().optional(),
  priceFeed: z.number().int().nonnegative().optional(),
  guaranteedViews: z.number().int().nonnegative().optional(),
  screenshots: z.array(z.string()).min(1, "Kamida bitta skrinshot yuklang").max(10)
});
const handleCreateAccount = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
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
        igUsername: d.igUsername.replace(/^@/, ""),
        igProfileUrl: d.igProfileUrl ?? "",
        avatarFileId: d.avatarFileId,
        niche: d.niche ?? "OTHER",
        customNiche: d.niche === "OTHER" ? d.customNiche?.trim() ?? "" : "",
        region: d.region ?? "Toshkent",
        description: d.description ?? "",
        followers: d.followers ?? 0,
        avgReelsViews: d.avgReelsViews ?? 0,
        storyViews: d.storyViews ?? 0,
        engagementRate: d.engagementRate ?? 0,
        priceStory: d.priceStory ?? 0,
        priceReels: d.priceReels ?? 0,
        priceFeed: d.priceFeed ?? 0,
        guaranteedViews: d.guaranteedViews ?? 0,
        verificationScreenshots: d.screenshots,
        status: "PENDING"
      }
    });
    const tgUsername = req.pgUser.username ? `@${req.pgUser.username}` : "";
    const firstName = req.pgUser.firstName || "";
    const submitter = [firstName, tgUsername].filter(Boolean).join(" ").trim() || `id:${req.pgUser.id}`;
    notifyAdminsOfNewAccount(account, submitter).catch(
      (e) => console.warn("Admin notify failed:", e?.message ?? e)
    );
    res.status(201).json({ success: true, account: toDTO(account) });
  } catch (err) {
    if (err?.code === "P2002") {
      res.status(409).json({ success: false, error: "Bu Instagram username allaqachon ro'yxatdan o'tgan" });
      return;
    }
    console.error("handleCreateAccount error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
function escapeHtml$4(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const ACCOUNT_REVIEW_EXCLUDED_ADMIN_ID = 5027595868;
async function notifyAdminsOfNewAccount(account, submittedBy) {
  const bot2 = getBot();
  const adminIds = getAdminTelegramIds().filter((id) => id !== ACCOUNT_REVIEW_EXCLUDED_ADMIN_ID);
  if (!bot2 || adminIds.length === 0) return;
  const shots = Array.isArray(account.verificationScreenshots) ? account.verificationScreenshots : [];
  const safeUsername = escapeHtml$4(account.igUsername);
  const safeBy = escapeHtml$4(submittedBy);
  const firstCaption = `🆕 <b>Yangi e'lon arizasi</b>

👤 <b>@${safeUsername}</b>
🙋 Yuboruvchi: ${safeBy}
🆔 <code>#${account.id}</code>

👤 Avatar`;
  const items = [
    { name: firstCaption, fileId: account.avatarFileId },
    { name: "📊 Istori arxivi (1 kunlik ko'rishlar)", fileId: shots[0] },
    { name: "🌍 Qaysi davlatlar kuzatadi", fileId: shots[1] },
    { name: "👥 Obunachilar soni (profil skrini)", fileId: shots[2] }
  ];
  const media = items.filter((it) => !!it.fileId).map((it, idx) => ({
    type: "photo",
    media: it.fileId,
    caption: it.name,
    ...idx === 0 ? { parse_mode: "HTML" } : {}
  }));
  for (const adminId of adminIds) {
    try {
      const mediaGroupMsgIds = [];
      if (media.length >= 2) {
        const sent = await bot2.sendMediaGroup(adminId, media);
        for (const m of sent || []) {
          if (m && typeof m.message_id === "number") mediaGroupMsgIds.push(m.message_id);
        }
      } else if (media.length === 1) {
        const m = await bot2.sendPhoto(adminId, media[0].media, {
          caption: media[0].caption
        });
        if (m?.message_id) mediaGroupMsgIds.push(m.message_id);
      }
      const sub = {
        accountId: account.id,
        adminChatId: adminId,
        igUsername: safeUsername,
        submittedBy: safeBy,
        mediaGroupMsgIds,
        buttonsMsgId: 0
      };
      const btnMsg = await bot2.sendMessage(adminId, buildAccountCaption(sub), {
        parse_mode: "HTML",
        reply_markup: buildAccountButtons(account.id, false)
      });
      sub.buttonsMsgId = btnMsg?.message_id || 0;
      saveSubmission(sub);
    } catch (e) {
      console.warn(
        "[notifyAdminsOfNewAccount] admin notify fail:",
        e instanceof Error ? e.message : e
      );
    }
  }
}
async function notifyAdminsOfAccountEdit(account, submittedBy, pendingEdit) {
  const bot2 = getBot();
  const adminIds = getAdminTelegramIds().filter((id) => id !== ACCOUNT_REVIEW_EXCLUDED_ADMIN_ID);
  if (!bot2 || adminIds.length === 0) return;
  const shots = pendingEdit.screenshots;
  const safeUsername = escapeHtml$4(account.igUsername);
  const safeBy = escapeHtml$4(submittedBy);
  const firstCaption = `✏️ <b>Akkaunt yangilanish so'rovi</b>

👤 <b>@${safeUsername}</b>
🙋 Yuboruvchi: ${safeBy}
🆔 <code>#${account.id}</code>

👤 Yangi avatar`;
  const items = [
    { name: firstCaption, fileId: pendingEdit.avatarFileId },
    { name: "📊 Istori arxivi (1 kunlik ko'rishlar)", fileId: shots[0] },
    { name: "🌍 Qaysi davlatlar kuzatadi", fileId: shots[1] },
    { name: "👥 Obunachilar soni (profil skrini)", fileId: shots[2] }
  ];
  const media = items.filter((it) => !!it.fileId).map((it, idx) => ({
    type: "photo",
    media: it.fileId,
    caption: it.name,
    ...idx === 0 ? { parse_mode: "HTML" } : {}
  }));
  for (const adminId of adminIds) {
    try {
      const mediaGroupMsgIds = [];
      if (media.length >= 2) {
        const sent = await bot2.sendMediaGroup(adminId, media);
        for (const m of sent || []) {
          if (m && typeof m.message_id === "number") mediaGroupMsgIds.push(m.message_id);
        }
      } else if (media.length === 1) {
        const m = await bot2.sendPhoto(adminId, media[0].media, { caption: media[0].caption });
        if (m?.message_id) mediaGroupMsgIds.push(m.message_id);
      }
      const sub = {
        accountId: account.id,
        adminChatId: adminId,
        igUsername: safeUsername,
        submittedBy: safeBy,
        mediaGroupMsgIds,
        buttonsMsgId: 0,
        kind: "edit"
      };
      const btnMsg = await bot2.sendMessage(adminId, buildEditAccountCaption(sub), {
        parse_mode: "HTML",
        reply_markup: buildEditAccountButtons(account.id)
      });
      sub.buttonsMsgId = btnMsg?.message_id || 0;
      saveSubmission(sub);
    } catch (e) {
      console.warn(
        "[notifyAdminsOfAccountEdit] admin notify fail:",
        e instanceof Error ? e.message : e
      );
    }
  }
}
const handleListMyAccounts = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const accounts2 = await prisma.adAccount.findMany({
      where: { ownerId: pgUser.id },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, accounts: accounts2.map(toDTO) });
  } catch (err) {
    console.error("handleListMyAccounts error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const updateAccountSchema = z.object({
  description: z.string().max(1e3).optional(),
  priceStory: z.number().int().nonnegative().optional(),
  priceReels: z.number().int().nonnegative().optional(),
  priceFeed: z.number().int().nonnegative().optional(),
  guaranteedViews: z.number().int().nonnegative().optional()
});
const handleUpdateMyAccount = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Noto'g'ri ID" });
      return;
    }
    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: "Akkaunt topilmadi" });
      return;
    }
    if (account.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: "Faqat akkaunt egasi tahrirlashi mumkin" });
      return;
    }
    const parsed = updateAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const d = parsed.data;
    const minPrice = MARKETPLACE_CONFIG.minAdPrice;
    if (d.priceStory !== void 0 && d.priceStory > 0 && d.priceStory < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }
    if (d.priceReels !== void 0 && d.priceReels > 0 && d.priceReels < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }
    if (d.priceFeed !== void 0 && d.priceFeed > 0 && d.priceFeed < minPrice) {
      res.status(400).json({ success: false, error: `Minimal narx ${minPrice} UZS` });
      return;
    }
    const updated = await prisma.adAccount.update({
      where: { id },
      data: {
        ...d.description !== void 0 && { description: d.description },
        ...d.priceStory !== void 0 && { priceStory: d.priceStory },
        ...d.priceReels !== void 0 && { priceReels: d.priceReels },
        ...d.priceFeed !== void 0 && { priceFeed: d.priceFeed },
        ...d.guaranteedViews !== void 0 && { guaranteedViews: d.guaranteedViews }
      }
    });
    res.json({ success: true, account: toDTO(updated) });
  } catch (err) {
    console.error("handleUpdateMyAccount error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const editRequestSchema = z.object({
  avatarFileId: z.string().min(1, "Akkaunt rasmini yuklang"),
  screenshots: z.array(z.string()).length(3, "Barcha 3 ta skrinshot bo'lishi shart")
});
const handleRequestAccountEdit = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Noto'g'ri ID" });
      return;
    }
    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: "Akkaunt topilmadi" });
      return;
    }
    if (account.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: "Faqat akkaunt egasi tahrirlashi mumkin" });
      return;
    }
    if (account.status !== "ACTIVE") {
      res.status(400).json({ success: false, error: "Faqat faol akkauntlar uchun yangilanish so'ralishi mumkin" });
      return;
    }
    if (account.pendingEdit) {
      res.status(409).json({ success: false, error: "Sizda allaqachon ko'rib chiqilayotgan so'rov bor" });
      return;
    }
    const parsed = editRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const { avatarFileId, screenshots } = parsed.data;
    const currentShots = Array.isArray(account.verificationScreenshots) ? account.verificationScreenshots : [];
    const anyScreenshotChanged = screenshots.some((s, i) => s !== (currentShots[i] ?? ""));
    if (!anyScreenshotChanged) {
      res.status(400).json({
        success: false,
        error: "Kamida bitta skrinshotni ham yangilashingiz kerak"
      });
      return;
    }
    const pendingEdit = {
      avatarFileId,
      screenshots,
      submittedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const updated = await prisma.adAccount.update({
      where: { id },
      data: { pendingEdit }
    });
    const tgUsername = pgUser.username ? `@${pgUser.username}` : "";
    const firstName = pgUser.firstName || "";
    const submitter = [firstName, tgUsername].filter(Boolean).join(" ").trim() || `id:${pgUser.id}`;
    notifyAdminsOfAccountEdit(updated, submitter, pendingEdit).catch(
      (e) => console.warn("Admin edit-notify failed:", e?.message ?? e)
    );
    res.json({ success: true, account: toDTO(updated) });
  } catch (err) {
    console.error("handleRequestAccountEdit error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const accounts = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  handleCreateAccount,
  handleGetAccount,
  handleListAccounts,
  handleListMyAccounts,
  handleRequestAccountEdit,
  handleUpdateMyAccount,
  notifyAdminsOfAccountEdit,
  notifyAdminsOfNewAccount
}, Symbol.toStringTag, { value: "Module" }));
async function releaseEscrow(orderId) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { adAccount: { include: { owner: { include: { wallet: true } } } } }
  });
  const ownerWallet = order.adAccount.owner.wallet;
  if (!ownerWallet) throw new Error("Akkaunt egasining walletı topilmadi");
  const advertiserWallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: order.advertiserId }
  });
  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: advertiserWallet.id },
      data: { frozenBalance: { decrement: order.price } }
    });
    await tx.transaction.create({
      data: {
        walletId: ownerWallet.id,
        type: "ESCROW_RELEASE",
        amount: order.escrowAmount,
        status: "COMPLETED",
        orderId,
        note: "Buyurtma yakunlandi, pul ozod qilindi"
      }
    });
    await tx.wallet.update({
      where: { id: ownerWallet.id },
      data: {
        balance: { increment: order.escrowAmount },
        totalEarned: { increment: order.escrowAmount }
      }
    });
    await tx.transaction.create({
      data: {
        walletId: advertiserWallet.id,
        type: "COMMISSION",
        amount: -order.commissionAmount,
        status: "COMPLETED",
        orderId,
        note: `Platforma komissiyasi (${order.commissionRate}%)`
      }
    });
    await tx.order.update({
      where: { id: orderId },
      data: { status: "COMPLETED", completedAt: /* @__PURE__ */ new Date() }
    });
  });
}
async function refundEscrow(orderId, amount) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const refundAmount = amount ?? order.price;
  const advertiserWallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: order.advertiserId }
  });
  await prisma.$transaction(async (tx) => {
    await tx.transaction.create({
      data: {
        walletId: advertiserWallet.id,
        type: "ESCROW_REFUND",
        amount: refundAmount,
        status: "COMPLETED",
        orderId,
        note: "Escrow qaytarildi"
      }
    });
    await tx.wallet.update({
      where: { id: advertiserWallet.id },
      data: {
        balance: { increment: refundAmount },
        depositBalance: { increment: refundAmount },
        // qaytgan pul yechib olinmaydi
        frozenBalance: { decrement: refundAmount },
        totalSpent: { decrement: refundAmount }
      }
    });
  });
}
const PHP_BOT_URL = process.env.PHP_BOT_URL || "";
const FORWARD_SECRET$2 = process.env.BOT_FORWARD_SECRET || "";
function isReady() {
  return !!PHP_BOT_URL && !!FORWARD_SECRET$2;
}
async function relay(action, body) {
  if (!isReady()) {
    throw new Error("PHP bot bridge not configured (PHP_BOT_URL + BOT_FORWARD_SECRET)");
  }
  const sep = PHP_BOT_URL.includes("?") ? "&" : "?";
  const url = `${PHP_BOT_URL}${sep}relay=${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forward-Secret": FORWARD_SECRET$2
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`PHP relay ${action} failed: HTTP ${res.status}`);
  }
  return res.json();
}
const phpBot = {
  isReady,
  sendMessage(chatId, text, opts) {
    return relay("send", {
      chatId,
      text,
      parseMode: opts?.parseMode || "HTML",
      replyMarkup: opts?.replyMarkup,
      disableNotification: opts?.disableNotification
    });
  },
  editMessageText(chatId, messageId, text, opts) {
    return relay("edit", {
      chatId,
      messageId,
      text,
      parseMode: opts?.parseMode || "HTML",
      replyMarkup: opts?.replyMarkup
    });
  },
  editMessageCaption(chatId, messageId, caption, opts) {
    return relay("editCaption", {
      chatId,
      messageId,
      caption,
      parseMode: opts?.parseMode || "HTML",
      replyMarkup: opts?.replyMarkup
    });
  },
  answerCallbackQuery(callbackQueryId, opts) {
    return relay("answer", {
      callbackQueryId,
      text: opts?.text || "",
      showAlert: !!opts?.showAlert
    });
  },
  deleteMessage(chatId, messageId) {
    return relay("delete", { chatId, messageId });
  },
  sendPhoto(chatId, photo, opts) {
    return relay("photo", {
      chatId,
      photo,
      caption: opts?.caption || "",
      parseMode: opts?.parseMode || "HTML",
      replyMarkup: opts?.replyMarkup
    });
  },
  sendVideo(chatId, video, opts) {
    return relay("video", {
      chatId,
      video,
      caption: opts?.caption || "",
      parseMode: opts?.parseMode || "HTML",
      replyMarkup: opts?.replyMarkup
    });
  },
  sendAnimation(chatId, animation, opts) {
    return relay("animation", {
      chatId,
      animation,
      caption: opts?.caption || "",
      parseMode: opts?.parseMode || "HTML",
      replyMarkup: opts?.replyMarkup
    });
  },
  sendDocument(chatId, document2, opts) {
    return relay("document", {
      chatId,
      document: document2,
      caption: opts?.caption || "",
      parseMode: opts?.parseMode || "HTML",
      replyMarkup: opts?.replyMarkup
    });
  }
};
function telegramFailure(res) {
  if (res?.result && res.result.ok === false) {
    return { code: Number(res.result.error_code) || 0, description: String(res.result.description || "") };
  }
  return null;
}
function isUnreachable(f) {
  if (!f) return false;
  return f.code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(f.description);
}
const phpBotBridge = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  isUnreachable,
  phpBot,
  telegramFailure
}, Symbol.toStringTag, { value: "Module" }));
const SUPPORT_USERNAME = "@uchra";
const OPEN_STATUSES = ["AWAITING_SELLER_CONSENT", "AWAITING_BUYER_MATERIAL"];
const ADMIN_IDS$2 = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => parseInt(id.trim())).filter((n) => !isNaN(n) && n > 0);
const fmtUZS$3 = (n) => new Intl.NumberFormat("uz-UZ").format(n);
const esc$1 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BUYER_REASON = {
  seller_unreachable: (ig) => `Sotuvchi (@${ig}) bilan bot orqali bog'lanib bo'lmayapti, shu sabab buyurtma bajarilmaydi.`,
  seller_timeout: (ig) => `Sotuvchi (@${ig}) buyurtmangizga 24 soat ichida javob bermadi.`,
  buyer_timeout: () => `Video havolasi belgilangan muddatda yuborilmadi.`
};
async function notifyAdmins(text) {
  const bot2 = getBot();
  if (!bot2) return;
  for (const id of ADMIN_IDS$2) {
    await bot2.sendMessage(id, text, { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {
    });
  }
}
async function autoCancelOrder(orderId, reason) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } }
  });
  if (!order || !OPEN_STATUSES.includes(order.status)) return false;
  const refunded = await prisma.$transaction(async (tx) => {
    const flip = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: "CANCELLED" }
    });
    if (flip.count !== 1) return null;
    const [held, back] = await Promise.all([
      tx.transaction.aggregate({ where: { orderId, type: "ESCROW_HOLD", status: "COMPLETED" }, _sum: { amount: true } }),
      tx.transaction.aggregate({ where: { orderId, type: "ESCROW_REFUND", status: "COMPLETED" }, _sum: { amount: true } })
    ]);
    const refund = Math.max(0, -(held._sum.amount || 0) - (back._sum.amount || 0));
    if (refund > 0) {
      const wallet2 = await tx.wallet.findUniqueOrThrow({ where: { userId: order.advertiserId } });
      await tx.wallet.update({
        where: { id: wallet2.id },
        data: {
          balance: { increment: refund },
          depositBalance: { increment: refund },
          // qaytgan pul yechib olinmaydi
          frozenBalance: { decrement: refund },
          totalSpent: { decrement: refund }
        }
      });
      await tx.transaction.create({
        data: {
          walletId: wallet2.id,
          type: "ESCROW_REFUND",
          amount: refund,
          status: "COMPLETED",
          orderId,
          note: `Order #${orderId} — tizim bekor qildi (${reason}), pul qaytarildi`
        }
      });
    }
    await tx.orderEvent.create({ data: { orderId, type: "auto_cancelled", payload: { reason, refund } } });
    return refund;
  });
  if (refunded === null) return false;
  const ig = order.adAccount.igUsername;
  const buyerTg = Number(order.advertiser.telegramId || 0);
  if (buyerTg) {
    await phpBot.sendMessage(
      buyerTg,
      `❌ <b>Buyurtma bekor qilindi</b> (<code>#${orderId}</code>)

${BUYER_REASON[reason](esc$1(ig))}

` + (refunded > 0 ? `💰 <b>${fmtUZS$3(refunded)} so'm</b> hamyoningizga qaytarildi.

` : "") + `Savollar bo'lsa ${SUPPORT_USERNAME} ga yozing.`
    ).catch(() => {
    });
  }
  const sellerTg = Number(order.adAccount.owner?.telegramId || 0);
  if (sellerTg && reason !== "seller_unreachable") {
    await phpBot.sendMessage(
      sellerTg,
      reason === "seller_timeout" ? `❌ <code>#${orderId}</code> buyurtmaga 24 soat ichida javob bermadingiz — buyurtma bekor qilindi.` : `ℹ️ Xaridor video havolasini yubormadi — <code>#${orderId}</code> buyurtma bekor qilindi.`
    ).catch(() => {
    });
  }
  return true;
}
async function handleSellerUnreachable(ownerUserId, description) {
  const accounts2 = await prisma.adAccount.findMany({
    where: { ownerId: ownerUserId },
    select: { id: true, igUsername: true, status: true }
  });
  if (accounts2.length === 0) return;
  const suspended = await prisma.adAccount.updateMany({
    where: { ownerId: ownerUserId, status: "ACTIVE" },
    data: { status: "SUSPENDED" }
  });
  const openOrders = await prisma.order.findMany({
    where: { adAccountId: { in: accounts2.map((a) => a.id) }, status: { in: OPEN_STATUSES } },
    select: { id: true, price: true },
    orderBy: { id: "asc" }
  });
  const cancelled = [];
  let total = 0;
  for (const o of openOrders) {
    if (await autoCancelOrder(o.id, "seller_unreachable")) {
      cancelled.push(o.id);
      total += o.price;
    }
  }
  if (suspended.count === 0 && cancelled.length === 0) return;
  const owner = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { telegramId: true, username: true } });
  await notifyAdmins(
    `🚫 <b>Sotuvchiga bot orqali yozib bo'lmaydi</b>

👤 ${owner?.username ? `@${esc$1(owner.username)} · ` : ""}<code>${owner?.telegramId ?? "—"}</code>
📸 ${accounts2.map((a) => "@" + esc$1(a.igUsername)).join(", ")}
⚠️ Telegram: <i>${esc$1(description)}</i>

🙈 Marketplace'dan yashirildi: <b>${suspended.count}</b> ta akkaunt
❌ Bekor qilingan buyurtmalar: <b>${cancelled.length}</b> ta` + (cancelled.length ? ` (${cancelled.map((id) => "#" + id).join(", ")})` : "") + `
💰 Xaridorlarga qaytarildi: <b>${fmtUZS$3(total)}</b> so'm`
  );
}
const BUYER_TUTORIAL_VIDEO = "BAACAgIAAxkDAAGdf5FqpXb2h_D0dVTl3X6cWjAxO4C2vwAC9qkAAtULKUmH8nT5EYnc9T0E";
const escapeHtml$3 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function fmtUZS$2(n) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}
async function notifySellerOfConsentRequest(orderId) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: { include: { owner: true } }, advertiser: true }
    });
    if (!order || !order.adAccount?.owner) return;
    const sellerTgId = Number(order.adAccount.owner.telegramId);
    if (!sellerTgId) return;
    const buyerName = order.advertiser.username ? `@${order.advertiser.username}` : order.advertiser.firstName || `id:${order.advertiser.id}`;
    const target = order.targetIgUsername ? `@${order.targetIgUsername.replace(/^@/, "")}` : "—";
    const text = `🆕 <b>Yangi buyurtma so'rovi</b>

🛍 Buyurtmachi: ${buyerName}
📲 Sizning akkauntingiz: <b>@${order.adAccount.igUsername}</b>
🎯 Mijoz <b>${target}</b> akkauntiga video ulashmoqchi
💰 Narx: <code>${fmtUZS$2(order.price)}</code> so'm
📥 Sizga (komissiyadan keyin): <code>${fmtUZS$2(order.escrowAmount)}</code> so'm

<i>Qabul qilsangiz — mijozdan to'lov so'raladi.</i>`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "✅ Qabul qilaman", callback_data: `mkt:seller:accept:${order.id}` },
          { text: "❌ Rad etish", callback_data: `mkt:seller:reject:${order.id}` }
        ]
      ]
    };
    if (phpBot.isReady()) {
      const res = await phpBot.sendMessage(sellerTgId, text, { replyMarkup }).catch((e) => {
        console.warn("notifySellerConsent php failed:", e instanceof Error ? e.message : e);
        return null;
      });
      const failure = telegramFailure(res);
      if (isUnreachable(failure)) {
        console.warn(`notifySellerConsent #${orderId}: seller unreachable — ${failure.description}`);
        await handleSellerUnreachable(order.adAccount.ownerId, failure.description);
      }
    } else {
      const bot2 = getSellerBot();
      if (!bot2) return;
      await bot2.sendMessage(sellerTgId, text, { parse_mode: "HTML", reply_markup: replyMarkup }).catch(
        (e) => console.warn("notifySellerConsent send failed:", e instanceof Error ? e.message : e)
      );
    }
  } catch (e) {
    console.warn("notifySellerOfConsentRequest error:", e instanceof Error ? e.message : e);
  }
}
const handleCreateOrder = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const schema = z.object({
      adAccountId: z.number().int().positive(),
      targetIgUsername: z.string().trim().min(2).max(64),
      materialCaption: z.string().max(2200).optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const { adAccountId, targetIgUsername, materialCaption } = parsed.data;
    const cleanTarget = targetIgUsername.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9._]{2,64}$/.test(cleanTarget)) {
      res.status(400).json({ success: false, error: "Instagram username noto'g'ri" });
      return;
    }
    const account = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
    if (!account) {
      res.status(404).json({ success: false, error: "Akkaunt topilmadi" });
      return;
    }
    if (account.status !== "ACTIVE") {
      res.status(400).json({ success: false, error: "Bu akkaunt hozir buyurtma qabul qilmayapti" });
      return;
    }
    if (account.ownerId === pgUser.id) {
      res.status(400).json({ success: false, error: "O'z akkauntingizga buyurtma bera olmaysiz" });
      return;
    }
    const price = account.priceReels;
    if (!price || price === 0) {
      res.status(400).json({ success: false, error: "Bu akkaunt uchun Reels narxi belgilanmagan" });
      return;
    }
    const buyerWalletPre = await prisma.wallet.findUnique({ where: { userId: pgUser.id } });
    const preBalance = buyerWalletPre?.balance ?? 0;
    if (preBalance < price) {
      res.status(400).json({
        success: false,
        error: "INSUFFICIENT_BALANCE",
        balance: preBalance,
        required: price,
        shortage: price - preBalance
      });
      return;
    }
    const { commissionRate, commissionAmount, escrowAmount } = await calcEscrowAsync(price);
    const guaranteedViews = account.guaranteedViews;
    const newOrder = await prisma.$transaction(async (tx) => {
      const claimed = await tx.wallet.updateMany({
        where: { userId: pgUser.id, balance: { gte: price } },
        data: {
          balance: { decrement: price },
          frozenBalance: { increment: price },
          totalSpent: { increment: price }
        }
      });
      if (claimed.count === 0) {
        throw new Error("INSUFFICIENT_BALANCE");
      }
      const buyerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: pgUser.id } });
      if (buyerWallet.depositBalance > 0) {
        await tx.wallet.update({
          where: { id: buyerWallet.id },
          data: { depositBalance: Math.max(0, buyerWallet.depositBalance - price) }
        });
      }
      const order = await tx.order.create({
        data: {
          advertiserId: pgUser.id,
          adAccountId,
          format: "REELS",
          price,
          commissionRate,
          commissionAmount,
          escrowAmount,
          materialType: "VIDEO",
          // sotuvchi qo'lida (admin tasdiqlagandan keyin)
          materialFileId: "",
          materialCaption: materialCaption ?? "",
          targetIgUsername: cleanTarget,
          guaranteedViews,
          status: "AWAITING_SELLER_CONSENT"
        }
      });
      await tx.transaction.create({
        data: {
          walletId: buyerWallet.id,
          type: "ESCROW_HOLD",
          amount: -price,
          status: "COMPLETED",
          orderId: order.id,
          note: `Order #${order.id} — so'rov yuborilganda pul muzlatildi`
        }
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, actorId: pgUser.id, type: "created" }
      });
      return order;
    }).catch((e) => {
      if (e instanceof Error && e.message === "INSUFFICIENT_BALANCE") return null;
      throw e;
    });
    if (!newOrder) {
      res.status(400).json({
        success: false,
        error: "INSUFFICIENT_BALANCE",
        message: "Balansingiz boshqa so'rov(lar) uchun band qilingan bo'lishi mumkin"
      });
      return;
    }
    notifySellerOfConsentRequest(newOrder.id).catch(() => {
    });
    notifyBuyerOfRequestSent(newOrder.id).catch(() => {
    });
    res.status(201).json({
      success: true,
      order: serializeOrder(newOrder)
    });
  } catch (err) {
    console.error("handleCreateOrder error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
async function notifyBuyerOfRequestSent(orderId) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true, advertiser: true }
    });
    if (!order) return;
    const buyerTgId = Number(order.advertiser.telegramId);
    if (!buyerTgId) return;
    const target = order.targetIgUsername ? `@${order.targetIgUsername.replace(/^@/, "")}` : "—";
    const text = `📨 <b>So'rov yuborildi</b>

📲 Akkaunt: <b>@${order.adAccount.igUsername}</b>
🎯 Sizning akkauntingiz: <b>${target}</b>
💰 Narx: <code>${fmtUZS$2(order.price)}</code> so'm

<i>Sotuvchi javobini kutib turing. Qabul qilsa, to'lov ma'lumotlari shu chatga keladi.</i>`;
    if (phpBot.isReady()) {
      await phpBot.sendMessage(buyerTgId, text).catch(
        (e) => console.warn("notifyBuyerOfRequestSent php failed:", e instanceof Error ? e.message : e)
      );
    } else {
      const bot2 = getSellerBot();
      if (!bot2) return;
      await bot2.sendMessage(buyerTgId, text, { parse_mode: "HTML" }).catch(
        (e) => console.warn("notifyBuyerOfRequestSent send failed:", e instanceof Error ? e.message : e)
      );
    }
  } catch (e) {
    console.warn("notifyBuyerOfRequestSent error:", e instanceof Error ? e.message : e);
  }
}
async function notifyBuyerForMaterial(orderId) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { advertiser: true, adAccount: { include: { owner: true } } }
    });
    if (!order) return;
    const buyerTgId = Number(order.advertiser.telegramId);
    const sellerTgId = Number(order.adAccount.owner?.telegramId || 0);
    const sellerIg = escapeHtml$3(order.adAccount.igUsername);
    const targetIg = escapeHtml$3(order.targetIgUsername || "—");
    if (buyerTgId) {
      const caption = `✅ <b>To'lovingiz tasdiqlandi!</b>

👉 <b>Endi navbat sizda</b> — sotuvchi videoni joylashingizni kutyapti.

Avval shu videoni ko'ring, keyin xuddi shunday qiling:

1️⃣ Reklama videongizni o'z Instagramingizga (<b>@${targetIg}</b>) Reels qilib joylang
2️⃣ Joylayotganda <b>«Пригласить соавторов» (Collab)</b> bo'limiga <b>@${sellerIg}</b> ni qo'shing
3️⃣ Joylangan videoning havolasini <b>shu chatga yuboring</b>

Keyin sotuvchi collab'ni qabul qiladi, sizdan esa faqat tasdiq so'raymiz.

Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`;
      const res = await phpBot.sendVideo(buyerTgId, BUYER_TUTORIAL_VIDEO, { caption }).catch(() => null);
      if (!res?.result?.ok) await phpBot.sendMessage(buyerTgId, caption).catch(() => {
      });
    }
    if (sellerTgId) {
      await phpBot.sendMessage(
        sellerTgId,
        `💳 <b>Buyurtma to'landi</b> (<code>#${order.id}</code>)

📲 Akkauntingiz: <b>@${sellerIg}</b>
🎯 Xaridor akkaunti: <b>@${targetIg}</b>
💰 Sizga (komissiyadan keyin): <b>${new Intl.NumberFormat("uz-UZ").format(order.escrowAmount)}</b> so'm

⏳ <b>Hozircha siz kutasiz.</b> Xaridor videoni o'z Instagramiga joylab, sizni collab'ga taklif qiladi va havolasini shu botga yuboradi — havola kelishi bilan sizga xabar beramiz.

Taklif kelgach:
1️⃣ Instagram bildirishnomalaridan collab taklifini <b>qabul qiling</b>
2️⃣ Video havolasini <b>shu chatga yuboring</b>

Xaridor tasdiqlagach pul hisobingizga o'tadi.

Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`
      ).catch(() => {
      });
    }
  } catch (e) {
    console.warn("notifyBuyerForMaterial error:", e instanceof Error ? e.message : e);
  }
}
const handleMockPayOrder = async (_req, res) => {
  res.status(410).json({
    success: false,
    error: "Avto-to'lov o'chirilgan. To'lov endi karta orqali amalga oshiriladi (admin tasdiqlaydi)."
  });
};
const handleAcceptOrder = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const orderId = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true }
    });
    if (!order) {
      res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
      return;
    }
    if (order.adAccount.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: "Faqat akkaunt egasi qabul qila oladi" });
      return;
    }
    if (order.status !== "PAID") {
      res.status(400).json({ success: false, error: "Buyurtma to'langan holatda emas" });
      return;
    }
    const deadlinePostBy = new Date(
      Date.now() + MARKETPLACE_CONFIG.deadlinePostHours * 60 * 60 * 1e3
    );
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: "ACCEPTED", acceptedAt: /* @__PURE__ */ new Date(), deadlinePostBy }
    });
    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: "accepted" }
    });
    await createNotification(
      order.advertiserId,
      "ORDER_ACCEPTED",
      "Buyurtmangiz qabul qilindi",
      `${order.format} formati uchun buyurtmangiz akkaunt egasi tomonidan qabul qilindi.`,
      { orderId }
    );
    res.json({ success: true, order: serializeOrder(updated) });
  } catch (err) {
    console.error("handleAcceptOrder error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleMarkPosted = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const orderId = Number(req.params.id);
    const schema = z.object({ proofFileId: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Validatsiya xatosi" });
      return;
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true }
    });
    if (!order) {
      res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
      return;
    }
    if (order.adAccount.ownerId !== pgUser.id) {
      res.status(403).json({ success: false, error: "Faqat akkaunt egasi belgilashi mumkin" });
      return;
    }
    if (order.status !== "ACCEPTED") {
      res.status(400).json({ success: false, error: "Buyurtma qabul qilingan holatda emas" });
      return;
    }
    const deadlineKeepUntil = new Date(
      Date.now() + MARKETPLACE_CONFIG.deadlineKeepHours * 60 * 60 * 1e3
    );
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "POSTED",
        postedAt: /* @__PURE__ */ new Date(),
        deadlineKeepUntil,
        ...parsed.data.proofFileId && { guaranteeProof: parsed.data.proofFileId }
      }
    });
    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: "posted", payload: { proofFileId: parsed.data.proofFileId } }
    });
    await createNotification(
      order.advertiserId,
      "ORDER_POSTED",
      "Post e'lon qilindi",
      `Sizning videongiz ulandi. Iltimos ${MARKETPLACE_CONFIG.deadlineKeepHours} soat ichida tasdiqlang.`,
      { orderId }
    );
    res.json({ success: true, order: serializeOrder(updated) });
  } catch (err) {
    console.error("handleMarkPosted error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleCompleteOrder = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const orderId = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true }
    });
    if (!order) {
      res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
      return;
    }
    if (order.advertiserId !== pgUser.id) {
      res.status(403).json({ success: false, error: "Faqat buyurtmachi yakunlay oladi" });
      return;
    }
    if (order.status !== "POSTED") {
      res.status(400).json({ success: false, error: "Buyurtma post qilingan holatda emas" });
      return;
    }
    await releaseEscrow(orderId);
    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: "completed" }
    });
    const totalOrders = await prisma.order.count({
      where: { adAccountId: order.adAccountId, status: { in: ["COMPLETED", "DISPUTED", "REFUNDED"] } }
    });
    const completedOrders = await prisma.order.count({
      where: { adAccountId: order.adAccountId, status: "COMPLETED" }
    });
    const successRate = totalOrders > 0 ? Math.round(completedOrders / totalOrders * 100) : 100;
    await prisma.adAccount.update({
      where: { id: order.adAccountId },
      data: { completedOrders, successRate }
    });
    await createNotification(
      order.adAccount.ownerId,
      "ORDER_COMPLETED",
      "Buyurtma yakunlandi",
      `Buyurtma muvaffaqiyatli yakunlandi. ${order.escrowAmount.toLocaleString()} UZS walletingizga o'tkazildi.`,
      { orderId }
    );
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    res.json({ success: true, order: serializeOrder(updated) });
  } catch (err) {
    console.error("handleCompleteOrder error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleDisputeOrder = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const orderId = Number(req.params.id);
    const schema = z.object({
      reason: z.string().min(10).max(1e3),
      evidence: z.array(z.string()).max(5)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true }
    });
    if (!order) {
      res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
      return;
    }
    const isAdvertiser = order.advertiserId === pgUser.id;
    const isOwner = order.adAccount.ownerId === pgUser.id;
    if (!isAdvertiser && !isOwner) {
      res.status(403).json({ success: false, error: "Siz bu buyurtmaga aloqador emassiz" });
      return;
    }
    if (!["PAID", "ACCEPTED", "POSTED"].includes(order.status)) {
      res.status(400).json({ success: false, error: "Bu holatda shikoyat ochib bo'lmaydi" });
      return;
    }
    const dispute = await prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          orderId,
          openedBy: pgUser.id,
          reason: parsed.data.reason,
          evidence: parsed.data.evidence
        }
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: "DISPUTED" }
      });
      await tx.orderEvent.create({
        data: { orderId, actorId: pgUser.id, type: "disputed", payload: { reason: parsed.data.reason } }
      });
      return created;
    });
    await notifyAdmins$1(
      "ORDER_DISPUTED",
      "Yangi shikoyat",
      `Buyurtma #${orderId} bo'yicha shikoyat ochildi. Sabab: ${parsed.data.reason}`,
      {
        orderId,
        inlineKeyboard: {
          inline_keyboard: [
            [
              { text: "✅ Mijoz foydasiga", callback_data: `mkt:dispute:${dispute.id}:resolve_adv` },
              { text: "✅ Egasi foydasiga", callback_data: `mkt:dispute:${dispute.id}:resolve_own` }
            ],
            [{ text: "⚖️ 50/50 bo'lish", callback_data: `mkt:dispute:${dispute.id}:partial` }]
          ]
        }
      }
    );
    res.json({ success: true, message: "Shikoyat muvaffaqiyatli yuborildi" });
  } catch (err) {
    console.error("handleDisputeOrder error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleCancelOrder = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const orderId = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { adAccount: true }
    });
    if (!order) {
      res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
      return;
    }
    if (order.advertiserId !== pgUser.id) {
      res.status(403).json({ success: false, error: "Faqat buyurtmachi bekor qila oladi" });
      return;
    }
    if (!["PENDING_PAYMENT", "PAID"].includes(order.status)) {
      res.status(400).json({ success: false, error: "Bu holatda buyurtmani bekor qilib bo'lmaydi" });
      return;
    }
    if (order.status === "PAID") {
      await refundEscrow(orderId);
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" }
    });
    await prisma.orderEvent.create({
      data: { orderId, actorId: pgUser.id, type: "cancelled" }
    });
    await createNotification(
      order.adAccount.ownerId,
      "ORDER_CANCELLED",
      "Buyurtma bekor qilindi",
      `Buyurtma #${orderId} advertiser tomonidan bekor qilindi.`,
      { orderId }
    );
    res.json({ success: true, message: "Buyurtma bekor qilindi" });
  } catch (err) {
    console.error("handleCancelOrder error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleListMyOrders = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const { role = "buyer", status } = req.query;
    let where = {};
    if (role === "owner") {
      const myAccounts = await prisma.adAccount.findMany({
        where: { ownerId: pgUser.id },
        select: { id: true }
      });
      const accountIds = myAccounts.map((a) => a.id);
      where.adAccountId = { in: accountIds };
    } else {
      where.advertiserId = pgUser.id;
    }
    if (status) where.status = status;
    const orders2 = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { adAccount: true }
    });
    res.json({ success: true, orders: orders2.map(serializeOrderWithAccount) });
  } catch (err) {
    console.error("handleListMyOrders error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
function serializeOrder(order) {
  return {
    id: order.id,
    advertiserId: order.advertiserId,
    adAccountId: order.adAccountId,
    format: order.format,
    price: order.price,
    commissionAmount: order.commissionAmount,
    escrowAmount: order.escrowAmount,
    materialType: order.materialType,
    materialFileId: order.materialFileId,
    materialCaption: order.materialCaption,
    guaranteedViews: order.guaranteedViews,
    achievedViews: order.achievedViews,
    status: order.status,
    acceptedAt: order.acceptedAt?.toISOString() ?? null,
    postedAt: order.postedAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    deadlinePostBy: order.deadlinePostBy?.toISOString() ?? null,
    deadlineKeepUntil: order.deadlineKeepUntil?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString()
  };
}
function serializeOrderWithAccount(order) {
  const base = serializeOrder(order);
  if (!order.adAccount) return base;
  return {
    ...base,
    adAccount: {
      id: order.adAccount.id,
      igUsername: order.adAccount.igUsername,
      niche: order.adAccount.niche,
      region: order.adAccount.region,
      priceStory: order.adAccount.priceStory,
      priceReels: order.adAccount.priceReels,
      priceFeed: order.adAccount.priceFeed,
      isVerified: order.adAccount.isVerified,
      rating: order.adAccount.rating
    }
  };
}
const orders = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  handleAcceptOrder,
  handleCancelOrder,
  handleCompleteOrder,
  handleCreateOrder,
  handleDisputeOrder,
  handleListMyOrders,
  handleMarkPosted,
  handleMockPayOrder,
  notifyBuyerForMaterial,
  notifyBuyerOfRequestSent,
  notifySellerOfConsentRequest
}, Symbol.toStringTag, { value: "Module" }));
const handleAdminListPendingAccounts = async (req, res) => {
  try {
    const accounts2 = await prisma.adAccount.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { owner: { select: { id: true, firstName: true, lastName: true, username: true } } }
    });
    res.json({ success: true, accounts: accounts2 });
  } catch (err) {
    console.error("handleAdminListPendingAccounts error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleAdminVerifyAccount = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    const id = Number(req.params.id);
    const schema = z.object({
      approve: z.boolean(),
      note: z.string().max(500).optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const account = await prisma.adAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ success: false, error: "Akkaunt topilmadi" });
      return;
    }
    if (parsed.data.approve) {
      await prisma.adAccount.update({
        where: { id },
        data: {
          status: "ACTIVE",
          isVerified: true,
          reviewedAt: /* @__PURE__ */ new Date(),
          reviewedBy: pgUser.id
        }
      });
      await createNotification(
        account.ownerId,
        "ACCOUNT_VERIFIED",
        "Akkauntingiz tasdiqlandi",
        `@${account.igUsername} akkauntingiz muvaffaqiyatli tasdiqlandi va endi ko'rinmoqda!`,
        { accountId: id }
      );
    } else {
      await prisma.adAccount.update({
        where: { id },
        data: {
          reviewedAt: /* @__PURE__ */ new Date(),
          reviewedBy: pgUser.id
        }
      });
      await createNotification(
        account.ownerId,
        "ACCOUNT_REJECTED",
        "Akkauntingiz rad etildi",
        `@${account.igUsername} akkauntingiz rad etildi. ${parsed.data.note ? `Sabab: ${parsed.data.note}` : ""}`,
        { accountId: id, note: parsed.data.note }
      );
    }
    res.json({ success: true, approved: parsed.data.approve });
  } catch (err) {
    console.error("handleAdminVerifyAccount error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleAdminListPayouts = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;
    const payouts = await prisma.payout.findMany({
      where,
      orderBy: { requestedAt: "asc" },
      include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } }
    });
    res.json({ success: true, payouts });
  } catch (err) {
    console.error("handleAdminListPayouts error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleAdminApprovePayout = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    const id = Number(req.params.id);
    const payout = await prisma.payout.findUnique({ where: { id } });
    if (!payout) {
      res.status(404).json({ success: false, error: "Payout topilmadi" });
      return;
    }
    if (payout.status !== "PENDING") {
      res.status(400).json({ success: false, error: "Payout kutish holatida emas" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id },
        data: { status: "PAID", processedAt: /* @__PURE__ */ new Date(), processedBy: pgUser.id }
      });
      const wallet2 = await tx.wallet.findUniqueOrThrow({ where: { userId: payout.userId } });
      await tx.wallet.update({
        where: { id: wallet2.id },
        data: { frozenBalance: { decrement: payout.amount } }
      });
      await tx.transaction.updateMany({
        where: { payoutId: id, type: "PAYOUT", status: "PENDING" },
        data: { status: "COMPLETED" }
      });
    });
    await createNotification(
      payout.userId,
      "PAYOUT_APPROVED",
      "Pul yechib olish tasdiqlandi",
      `${payout.amount.toLocaleString()} UZS kartangizga yuborildi.`,
      { payoutId: id }
    );
    res.json({ success: true, message: "Payout tasdiqlandi" });
  } catch (err) {
    console.error("handleAdminApprovePayout error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleAdminRejectPayout = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    const id = Number(req.params.id);
    const schema = z.object({ reason: z.string().min(5).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const payout = await prisma.payout.findUnique({ where: { id } });
    if (!payout) {
      res.status(404).json({ success: false, error: "Payout topilmadi" });
      return;
    }
    if (payout.status !== "PENDING") {
      res.status(400).json({ success: false, error: "Payout kutish holatida emas" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id },
        data: {
          status: "REJECTED",
          processedAt: /* @__PURE__ */ new Date(),
          processedBy: pgUser.id,
          rejectReason: parsed.data.reason
        }
      });
      const wallet2 = await tx.wallet.findUniqueOrThrow({ where: { userId: payout.userId } });
      await tx.wallet.update({
        where: { id: wallet2.id },
        data: {
          balance: { increment: payout.amount },
          frozenBalance: { decrement: payout.amount }
        }
      });
      await tx.transaction.updateMany({
        where: { payoutId: id, type: "PAYOUT", status: "PENDING" },
        data: { status: "FAILED" }
      });
    });
    await createNotification(
      payout.userId,
      "PAYOUT_REJECTED",
      "Pul yechib olish rad etildi",
      `${payout.amount.toLocaleString()} UZS yechib olish so'rovi rad etildi. Sabab: ${parsed.data.reason}`,
      { payoutId: id }
    );
    res.json({ success: true, message: "Payout rad etildi" });
  } catch (err) {
    console.error("handleAdminRejectPayout error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleAdminListDisputes = async (req, res) => {
  try {
    const disputes = await prisma.dispute.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "asc" },
      include: {
        order: {
          include: {
            adAccount: { select: { igUsername: true, ownerId: true } },
            advertiser: { select: { id: true, firstName: true, username: true } }
          }
        }
      }
    });
    res.json({ success: true, disputes });
  } catch (err) {
    console.error("handleAdminListDisputes error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleAdminResolveDispute = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    const id = Number(req.params.id);
    const schema = z.object({
      resolution: z.enum(["advertiser", "owner", "partial"]),
      refundAmount: z.number().int().nonnegative().optional(),
      note: z.string().min(5).max(1e3)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            adAccount: { include: { owner: true } }
          }
        }
      }
    });
    if (!dispute) {
      res.status(404).json({ success: false, error: "Shikoyat topilmadi" });
      return;
    }
    if (dispute.status !== "OPEN") {
      res.status(400).json({ success: false, error: "Shikoyat allaqachon hal qilingan" });
      return;
    }
    const order = dispute.order;
    const { resolution, note } = parsed.data;
    if (resolution === "advertiser") {
      await refundEscrow(order.id, order.price);
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
        await tx.dispute.update({
          where: { id },
          data: {
            status: "RESOLVED_ADVERTISER",
            resolution: note,
            refundAmount: order.price,
            resolvedAt: /* @__PURE__ */ new Date(),
            resolvedBy: pgUser.id
          }
        });
        const expiresAt = new Date(
          Date.now() + MARKETPLACE_CONFIG.strikeExpiryDays * 24 * 60 * 60 * 1e3
        );
        await tx.strike.create({
          data: {
            userId: order.adAccount.ownerId,
            orderId: order.id,
            reason: `Shikoyat #${id} bo'yicha: ${note}`,
            expiresAt
          }
        });
        const activeStrikes = await tx.strike.count({
          where: {
            userId: order.adAccount.ownerId,
            expiresAt: { gt: /* @__PURE__ */ new Date() }
          }
        });
        if (activeStrikes >= MARKETPLACE_CONFIG.maxStrikesBeforeBan) {
          await tx.adAccount.updateMany({
            where: { ownerId: order.adAccount.ownerId },
            data: { status: "BANNED" }
          });
        }
      });
      await createNotification(
        order.advertiserId,
        "ORDER_COMPLETED",
        "Shikoyat hal qilindi — sizning foydasiga",
        `Buyurtma #${order.id} bo'yicha shikoyat hal qilindi. Pul qaytarildi.`,
        { orderId: order.id, disputeId: id }
      );
      await createNotification(
        order.adAccount.ownerId,
        "STRIKE_ISSUED",
        "Strike olindi",
        `Buyurtma #${order.id} bo'yicha shikoyat natijasida strike berildi.`,
        { orderId: order.id, disputeId: id }
      );
    } else if (resolution === "owner") {
      await releaseEscrow(order.id);
      await prisma.dispute.update({
        where: { id },
        data: {
          status: "RESOLVED_OWNER",
          resolution: note,
          resolvedAt: /* @__PURE__ */ new Date(),
          resolvedBy: pgUser.id
        }
      });
      await createNotification(
        order.adAccount.ownerId,
        "ORDER_COMPLETED",
        "Shikoyat hal qilindi — sizning foydasiga",
        `Buyurtma #${order.id} bo'yicha shikoyat hal qilindi. Pul chiqarildi.`,
        { orderId: order.id, disputeId: id }
      );
      await createNotification(
        order.advertiserId,
        "ORDER_COMPLETED",
        "Shikoyat hal qilindi",
        `Buyurtma #${order.id} bo'yicha shikoyat akkaunt egasi foydasiga hal qilindi.`,
        { orderId: order.id, disputeId: id }
      );
    } else {
      const refundAmt = parsed.data.refundAmount ?? 0;
      const ownerAmt = Math.max(0, order.escrowAmount - refundAmt);
      if (refundAmt > 0) {
        await refundEscrow(order.id, refundAmt);
      }
      if (ownerAmt > 0) {
        const ownerWallet = await prisma.wallet.findUniqueOrThrow({
          where: { userId: order.adAccount.ownerId }
        });
        const advertiserWallet = await prisma.wallet.findUniqueOrThrow({
          where: { userId: order.advertiserId }
        });
        await prisma.$transaction(async (tx) => {
          await tx.transaction.create({
            data: {
              walletId: ownerWallet.id,
              type: "ESCROW_RELEASE",
              amount: ownerAmt,
              status: "COMPLETED",
              orderId: order.id,
              note: "Qisman hal — egasiga"
            }
          });
          await tx.wallet.update({
            where: { id: ownerWallet.id },
            data: { balance: { increment: ownerAmt }, totalEarned: { increment: ownerAmt } }
          });
          const remaining = order.price - refundAmt - ownerAmt;
          if (remaining < 0) {
            await tx.wallet.update({
              where: { id: advertiserWallet.id },
              data: { frozenBalance: { decrement: remaining } }
            });
          }
        });
      }
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
        await tx.dispute.update({
          where: { id },
          data: {
            status: "RESOLVED_PARTIAL",
            resolution: note,
            refundAmount: refundAmt,
            resolvedAt: /* @__PURE__ */ new Date(),
            resolvedBy: pgUser.id
          }
        });
      });
    }
    res.json({ success: true, message: "Shikoyat hal qilindi" });
  } catch (err) {
    console.error("handleAdminResolveDispute error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleAdminStats = async (req, res) => {
  try {
    const [
      totalAccounts,
      activeAccounts,
      pendingAccounts,
      totalOrders,
      completedOrders,
      pendingPayouts,
      openDisputes,
      revenueResult
    ] = await Promise.all([
      prisma.adAccount.count(),
      prisma.adAccount.count({ where: { status: "ACTIVE" } }),
      prisma.adAccount.count({ where: { status: "PENDING" } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: "COMPLETED" } }),
      prisma.payout.count({ where: { status: "PENDING" } }),
      prisma.dispute.count({ where: { status: "OPEN" } }),
      prisma.order.aggregate({
        where: { status: "COMPLETED" },
        _sum: { price: true, commissionAmount: true }
      })
    ]);
    res.json({
      success: true,
      stats: {
        totalAccounts,
        activeAccounts,
        pendingAccounts,
        totalOrders,
        completedOrders,
        pendingPayouts,
        openDisputes,
        totalRevenue: revenueResult._sum.price ?? 0,
        totalCommission: revenueResult._sum.commissionAmount ?? 0
      }
    });
  } catch (err) {
    console.error("handleAdminStats error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const CHECKOUT_API = process.env.CHECKOUT_UZ_API || "https://checkout.uz/api/v1";
const CHECKOUT_TOKEN = process.env.CHECKOUT_UZ_TOKEN || "ZGI1NDMwYzJjMjY1Zjk1MTc2NGI";
async function checkoutApi(endpoint, payload) {
  const res = await fetch(`${CHECKOUT_API}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHECKOUT_TOKEN}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15e3)
  });
  const decoded = await res.json().catch(() => null);
  if (!res.ok || !decoded || decoded.status !== "success") {
    console.warn(`[checkout.uz] ${endpoint} HTTP:${res.status} RESP:${JSON.stringify(decoded).slice(0, 500)}`);
  }
  return decoded;
}
async function checkoutCreatePayment(amount, description) {
  const resp = await checkoutApi("/create_payment", { amount, description });
  const pay = resp?.payment;
  if (resp?.status !== "success" || !pay?._id) return null;
  return {
    id: String(pay._id),
    uuid: String(pay._uuid || ""),
    payVia: {
      click: pay._pay_via?.click || void 0,
      payme: pay._pay_via?.payme || void 0
    }
  };
}
async function checkoutIsPaid(paymentId, uuid) {
  const resp = await checkoutApi("/status_payment", { id: Number(paymentId), uuid });
  return resp?.status === "success" && resp?.data?.status === "paid";
}
const STARS_BOT_TOKEN = process.env.WEBAPP_BOT_TOKEN || "";
const API_BASE = STARS_BOT_TOKEN ? `https://api.telegram.org/bot${STARS_BOT_TOKEN}` : "";
async function createStarsInvoiceLink(params) {
  if (!API_BASE) {
    console.warn("[telegram-stars] WEBAPP_BOT_TOKEN sozlanmagan");
    return null;
  }
  try {
    const res = await fetch(`${API_BASE}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: params.title,
        description: params.description,
        payload: params.payload,
        provider_token: "",
        // Stars uchun bo'sh — Telegram XTR valyutasini shunday belgilaydi
        currency: "XTR",
        prices: [{ label: params.title, amount: params.stars }]
      }),
      signal: AbortSignal.timeout(15e3)
    });
    const decoded = await res.json().catch(() => null);
    if (!res.ok || !decoded?.ok || typeof decoded.result !== "string") {
      console.warn(`[telegram-stars] createInvoiceLink failed: HTTP:${res.status} RESP:${JSON.stringify(decoded).slice(0, 300)}`);
      return null;
    }
    return decoded.result;
  } catch (e) {
    console.warn("[telegram-stars] createInvoiceLink error:", e instanceof Error ? e.message : e);
    return null;
  }
}
const handleGetWallet = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const wallet2 = await prisma.wallet.findUnique({
      where: { userId: pgUser.id },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 30
        }
      }
    });
    if (!wallet2) {
      res.status(404).json({ success: false, error: "Wallet topilmadi" });
      return;
    }
    res.json({
      success: true,
      wallet: {
        balance: wallet2.balance,
        frozenBalance: wallet2.frozenBalance,
        totalEarned: wallet2.totalEarned,
        totalSpent: wallet2.totalSpent,
        withdrawable: Math.max(0, wallet2.balance - wallet2.depositBalance)
      },
      payoutLimits: await (await Promise.resolve().then(() => marketplaceConfig)).getPayoutLimits(),
      transactions: wallet2.transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        status: t.status,
        orderId: t.orderId,
        note: t.note,
        createdAt: t.createdAt.toISOString()
      }))
    });
  } catch (err) {
    console.error("handleGetWallet error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleCreateTopup = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const schema = z.object({
      amount: z.number().int().min(1e3, "Minimal: 1 000 UZS").max(5e7, "Juda katta summa")
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const { amount } = parsed.data;
    const card = process.env.ADMIN_PAYMENT_CARD || "9860 0101 0202 0303";
    const name = process.env.ADMIN_PAYMENT_NAME || "INSTACAP ADMIN";
    const cardSnapshot = `${card} | ${name}`;
    const topup = await prisma.topup.create({
      data: { userId: pgUser.id, amount, status: "PENDING", cardSnapshot }
    });
    const buyerTgId = pgUser.telegramId ? Number(pgUser.telegramId) : 0;
    let userMsgId = null;
    if (buyerTgId) {
      const text = `💳 <b>Hisobni to'ldirish</b>

🆔 So'rov: <code>#${topup.id}</code>
💰 Summa: <code>${amount.toLocaleString("uz-UZ")}</code> so'm

<b>Karta:</b> <code>${card}</code>
<b>Egasi:</b> ${name}

Yuqoridagi kartaga aniq <b>${amount.toLocaleString("uz-UZ")}</b> so'm o'tkazing.
So'ng to'lov chekining <b>skrinshotini</b> shu chatga yuboring.

<i>Admin tasdiqlasa balansingizga qo'shiladi.</i>`;
      const kb = {
        inline_keyboard: [
          [{ text: "❌ Bekor qilish", callback_data: `mkt:topup:cancel:${topup.id}` }]
        ]
      };
      const r = await phpBot.sendMessage(buyerTgId, text, { replyMarkup: kb }).catch((e) => {
        console.warn("topup sendMessage:", e?.message || e);
        return null;
      });
      userMsgId = r?.result?.message_id ?? null;
      if (userMsgId) {
        await prisma.topup.update({ where: { id: topup.id }, data: { userTgMessageId: userMsgId } }).catch(() => {
        });
      }
    }
    res.status(201).json({
      success: true,
      topup: { id: topup.id, amount, cardSnapshot, status: "PENDING" },
      message: "Telegram botingizga qarang — karta va chek yuborish ko'rsatmasi keldi."
    });
  } catch (err) {
    console.error("handleCreateTopup error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const CHECKOUT_PAY_WINDOW_MS = 10 * 60 * 1e3;
const handleCreateTopupCheckout = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const schema = z.object({
      amount: z.number().int().min(1e3, "Minimal: 1 000 UZS").max(5e7, "Juda katta summa")
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const { amount } = parsed.data;
    const payment = await checkoutCreatePayment(
      amount,
      `Hamyon to'ldirish — user #${pgUser.id} (${pgUser.firstName || ""})`
    );
    if (!payment || !payment.payVia.click && !payment.payVia.payme) {
      res.status(502).json({ success: false, error: "To'lov havolasi yaratilmadi. Birozdan so'ng qayta urinib ko'ring." });
      return;
    }
    const topup = await prisma.topup.create({
      data: {
        userId: pgUser.id,
        amount,
        status: "PENDING",
        provider: "CHECKOUT_UZ",
        providerPaymentId: payment.id,
        providerUuid: payment.uuid,
        payUrls: payment.payVia
      }
    });
    res.status(201).json({
      success: true,
      topup: {
        id: topup.id,
        amount,
        status: "PENDING",
        payUrls: payment.payVia
      }
    });
  } catch (err) {
    console.error("handleCreateTopupCheckout error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
async function creditCheckoutTopupIfPaid(topupId) {
  const topup = await prisma.topup.findUnique({ where: { id: topupId } });
  if (!topup || topup.provider !== "CHECKOUT_UZ") return "not_found";
  if (topup.status === "APPROVED") return "already";
  if (topup.status !== "PENDING") return "expired";
  const paid = await checkoutIsPaid(topup.providerPaymentId, topup.providerUuid);
  if (!paid) {
    const age = Date.now() - topup.createdAt.getTime();
    if (age > CHECKOUT_PAY_WINDOW_MS) {
      await prisma.topup.updateMany({
        where: { id: topupId, status: "PENDING" },
        data: { status: "CANCELLED", rejectReason: "Muddati o'tdi (checkout.uz, 10 daqiqa)", reviewedAt: /* @__PURE__ */ new Date() }
      });
      return "expired";
    }
    return "pending";
  }
  const claimed = await prisma.topup.updateMany({
    where: { id: topupId, status: "PENDING" },
    data: { status: "APPROVED", reviewedAt: /* @__PURE__ */ new Date() }
  });
  if (claimed.count === 0) return "already";
  await prisma.$transaction(async (tx) => {
    let wallet2 = await tx.wallet.findUnique({ where: { userId: topup.userId } });
    if (!wallet2) wallet2 = await tx.wallet.create({ data: { userId: topup.userId } });
    await tx.wallet.update({
      where: { id: wallet2.id },
      data: { balance: { increment: topup.amount }, depositBalance: { increment: topup.amount }, totalEarned: { increment: topup.amount } }
    });
    await tx.transaction.create({
      data: {
        walletId: wallet2.id,
        type: "DEPOSIT",
        amount: topup.amount,
        status: "COMPLETED",
        note: `Hamyon to'ldirish (checkout.uz) — topup #${topup.id}`,
        meta: { topupId: topup.id, provider: "CHECKOUT_UZ" }
      }
    });
  });
  try {
    const user = await prisma.user.findUnique({ where: { id: topup.userId } });
    const buyerTgId = user?.telegramId ? Number(user.telegramId) : 0;
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `✅ <b>To'lov qabul qilindi!</b>

💰 Hamyoningizga <b>+${topup.amount.toLocaleString("uz-UZ")}</b> so'm qo'shildi.`
      ).catch(() => {
      });
    }
  } catch {
  }
  return "credited";
}
const handleCheckTopupCheckout = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const topupId = Number(req.params.id);
    if (!topupId) {
      res.status(400).json({ success: false, error: "Noto'g'ri so'rov" });
      return;
    }
    const topup = await prisma.topup.findUnique({ where: { id: topupId } });
    if (!topup || topup.userId !== pgUser.id) {
      res.status(404).json({ success: false, error: "Topup topilmadi" });
      return;
    }
    const result = await creditCheckoutTopupIfPaid(topupId);
    const wallet2 = result === "credited" || result === "already" ? await prisma.wallet.findUnique({ where: { userId: pgUser.id } }) : null;
    res.json({
      success: true,
      status: result,
      balance: wallet2 ? wallet2.balance : void 0
    });
  } catch (err) {
    console.error("handleCheckTopupCheckout error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
let _checkoutPollerStarted = false;
function startCheckoutUzTopupPoller() {
  if (_checkoutPollerStarted) return;
  _checkoutPollerStarted = true;
  const tick2 = async () => {
    try {
      const pending = await prisma.topup.findMany({
        where: { provider: "CHECKOUT_UZ", status: "PENDING" },
        select: { id: true },
        take: 100
      });
      for (const { id } of pending) {
        await creditCheckoutTopupIfPaid(id).catch(
          (e) => console.warn(`checkout.uz poller topup #${id}:`, e instanceof Error ? e.message : e)
        );
      }
    } catch (e) {
      console.warn("checkout.uz poller tick error:", e instanceof Error ? e.message : e);
    }
  };
  setInterval(tick2, 2e4);
  tick2();
}
const STARS_TO_SOM_RATE = Number(process.env.STARS_TO_SOM_RATE) || 160;
const handleCreateTopupStars = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const schema = z.object({
      stars: z.number().int().min(5, "Minimal: 5 Stars").max(1e5, "Juda katta summa")
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const { stars } = parsed.data;
    const amount = Math.round(stars * STARS_TO_SOM_RATE);
    const topup = await prisma.topup.create({
      data: {
        userId: pgUser.id,
        amount,
        status: "PENDING",
        provider: "TELEGRAM_STARS"
      }
    });
    const payload = `mktw:${topup.id}:${pgUser.telegramId}:${Math.random().toString(16).slice(2, 10)}`;
    const invoiceLink = await createStarsInvoiceLink({
      title: "Hamyon to'ldirish",
      description: `${stars} ⭐ Stars — hamyoningizga ${amount.toLocaleString("uz-UZ")} so'm qo'shiladi`,
      payload,
      stars
    });
    if (!invoiceLink) {
      await prisma.topup.update({ where: { id: topup.id }, data: { status: "CANCELLED", rejectReason: "Stars invoice yaratilmadi" } }).catch(() => {
      });
      res.status(502).json({ success: false, error: "To'lov havolasi yaratilmadi. Birozdan so'ng qayta urinib ko'ring." });
      return;
    }
    await prisma.topup.update({
      where: { id: topup.id },
      data: { payUrls: { invoiceLink, stars } }
    });
    res.status(201).json({
      success: true,
      topup: { id: topup.id, stars, amount, status: "PENDING", invoiceLink }
    });
  } catch (err) {
    console.error("handleCreateTopupStars error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const STARS_PAY_WINDOW_MS = 10 * 60 * 1e3;
async function creditStarsTopupIfPaid(topupId, chargeId, starsAmount) {
  const topup = await prisma.topup.findUnique({ where: { id: topupId } });
  if (!topup || topup.provider !== "TELEGRAM_STARS") return "not_found";
  if (topup.status !== "PENDING") return "already";
  const claimed = await prisma.topup.updateMany({
    where: { id: topupId, status: "PENDING" },
    data: { status: "APPROVED", reviewedAt: /* @__PURE__ */ new Date(), providerPaymentId: chargeId }
  });
  if (claimed.count === 0) return "already";
  await prisma.$transaction(async (tx) => {
    let wallet2 = await tx.wallet.findUnique({ where: { userId: topup.userId } });
    if (!wallet2) wallet2 = await tx.wallet.create({ data: { userId: topup.userId } });
    await tx.wallet.update({
      where: { id: wallet2.id },
      data: { balance: { increment: topup.amount }, depositBalance: { increment: topup.amount }, totalEarned: { increment: topup.amount } }
    });
    await tx.transaction.create({
      data: {
        walletId: wallet2.id,
        type: "DEPOSIT",
        amount: topup.amount,
        status: "COMPLETED",
        note: `Hamyon to'ldirish (Telegram Stars, ${starsAmount} ⭐) — topup #${topup.id}`,
        meta: { topupId: topup.id, provider: "TELEGRAM_STARS", chargeId, stars: starsAmount }
      }
    });
  });
  try {
    const user = await prisma.user.findUnique({ where: { id: topup.userId } });
    const buyerTgId = user?.telegramId ? Number(user.telegramId) : 0;
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `✅ <b>To'lov qabul qilindi!</b>

⭐ ${starsAmount} Stars → 💰 Hamyoningizga <b>+${topup.amount.toLocaleString("uz-UZ")}</b> so'm qo'shildi.`
      ).catch(() => {
      });
    }
  } catch {
  }
  return "credited";
}
const handleCheckTopupStars = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const topupId = Number(req.params.id);
    if (!topupId) {
      res.status(400).json({ success: false, error: "Noto'g'ri so'rov" });
      return;
    }
    const topup = await prisma.topup.findUnique({ where: { id: topupId } });
    if (!topup || topup.userId !== pgUser.id || topup.provider !== "TELEGRAM_STARS") {
      res.status(404).json({ success: false, error: "Topup topilmadi" });
      return;
    }
    let status = "pending";
    if (topup.status === "APPROVED") {
      status = "credited";
    } else if (topup.status === "PENDING" && Date.now() - topup.createdAt.getTime() > STARS_PAY_WINDOW_MS) {
      await prisma.topup.updateMany({
        where: { id: topupId, status: "PENDING" },
        data: { status: "CANCELLED", rejectReason: "Muddati o'tdi (Stars, 10 daqiqa)", reviewedAt: /* @__PURE__ */ new Date() }
      });
      status = "expired";
    } else if (topup.status !== "PENDING") {
      status = "expired";
    }
    const wallet2 = status === "credited" ? await prisma.wallet.findUnique({ where: { userId: pgUser.id } }) : null;
    res.json({ success: true, status, balance: wallet2 ? wallet2.balance : void 0 });
  } catch (err) {
    console.error("handleCheckTopupStars error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const handleRequestPayout = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    if (!pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya talab qilinadi" });
      return;
    }
    const schema = z.object({
      amount: z.number().int().positive("Summani kiriting"),
      cardNumber: z.string().min(16).max(20),
      cardHolder: z.string().min(2).max(100)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Validatsiya xatosi" });
      return;
    }
    const { amount, cardNumber, cardHolder } = parsed.data;
    const wallet2 = await prisma.wallet.findUnique({ where: { userId: pgUser.id } });
    if (!wallet2) {
      res.status(404).json({ success: false, error: "Wallet topilmadi" });
      return;
    }
    const { getPayoutLimits: getPayoutLimits2 } = await Promise.resolve().then(() => marketplaceConfig);
    const limits = await getPayoutLimits2();
    const fmt = (n) => n.toLocaleString("ru-RU").replace(/,/g, " ");
    if (amount < limits.min) {
      res.status(400).json({ success: false, error: `Minimal yechib olish miqdori ${fmt(limits.min)} so'm` });
      return;
    }
    if (limits.max > 0 && amount > limits.max) {
      res.status(400).json({ success: false, error: `Bir martada ko'pi bilan ${fmt(limits.max)} so'm yechib olish mumkin` });
      return;
    }
    const withdrawable = Math.max(0, wallet2.balance - wallet2.depositBalance);
    if (amount > withdrawable) {
      res.status(400).json({
        success: false,
        error: withdrawable > 0 ? `Yechib olish mumkin bo'lgan summa: ${fmt(withdrawable)} so'm. To'ldirilgan pul faqat ilova ichida sarflanadi.` : "Yechib olish uchun ishlab topilgan pul yo'q. To'ldirilgan pul faqat ilova ichida sarflanadi."
      });
      return;
    }
    const payout = await prisma.$transaction(async (tx) => {
      const claimed = await tx.wallet.updateMany({
        where: { id: wallet2.id, balance: { gte: amount + wallet2.depositBalance } },
        data: { balance: { decrement: amount }, frozenBalance: { increment: amount } }
      });
      if (claimed.count !== 1) throw new Error("INSUFFICIENT_WITHDRAWABLE");
      const newPayout = await tx.payout.create({
        data: {
          userId: pgUser.id,
          amount,
          cardNumber,
          cardHolder,
          status: "PENDING"
        }
      });
      await tx.transaction.create({
        data: {
          walletId: wallet2.id,
          type: "PAYOUT",
          amount: -amount,
          status: "PENDING",
          payoutId: newPayout.id,
          note: `Yechib olish so'rovi: ${cardNumber.slice(-4)} karta`
        }
      });
      return newPayout;
    });
    await notifyAdmins$1(
      "PAYOUT_APPROVED",
      "Yangi payout so'rovi",
      `Foydalanuvchi ${pgUser.firstName} — ${amount.toLocaleString()} UZS yechib olish so'radi. Karta: ${cardNumber}`,
      {
        payoutId: payout.id,
        userId: pgUser.id,
        inlineKeyboard: {
          inline_keyboard: [
            [
              { text: "✅ To'lash", callback_data: `mkt:payout:${payout.id}:approve` },
              { text: "❌ Rad etish", callback_data: `mkt:payout:${payout.id}:reject` }
            ]
          ]
        }
      }
    );
    res.status(201).json({
      success: true,
      payout: {
        id: payout.id,
        amount: payout.amount,
        cardNumber: payout.cardNumber,
        cardHolder: payout.cardHolder,
        status: payout.status,
        requestedAt: payout.requestedAt.toISOString()
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_WITHDRAWABLE") {
      res.status(400).json({ success: false, error: "Balansingiz yetarli emas" });
      return;
    }
    console.error("handleRequestPayout error:", err);
    res.status(500).json({ success: false, error: "Serverda xato yuz berdi" });
  }
};
const wallet = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  creditStarsTopupIfPaid,
  handleCheckTopupCheckout,
  handleCheckTopupStars,
  handleCreateTopup,
  handleCreateTopupCheckout,
  handleCreateTopupStars,
  handleGetWallet,
  handleRequestPayout,
  startCheckoutUzTopupPoller
}, Symbol.toStringTag, { value: "Module" }));
const submissions = /* @__PURE__ */ new Map();
const awaitingPrice = /* @__PURE__ */ new Map();
function bufToTmpSync(buf, ext) {
  const p = path.join(
    os.tmpdir(),
    `mkt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  );
  fs.writeFileSync(p, buf);
  return p;
}
function pickExt(mime) {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}
function buildButtons(id, hasPrice) {
  const row1 = hasPrice ? [
    { text: "✅ Tasdiqlash", callback_data: `mkt:preview:approve:${id}` },
    { text: "❌ Rad etish", callback_data: `mkt:preview:reject:${id}` }
  ] : [{ text: "❌ Rad etish", callback_data: `mkt:preview:reject:${id}` }];
  const row2 = [
    {
      text: hasPrice ? "💰 Narxni o'zgartirish" : "💰 Narx belgilash",
      callback_data: `mkt:preview:price:${id}`
    }
  ];
  return { inline_keyboard: [row1, row2] };
}
function captionFor(sub) {
  const priceLine = sub.price ? `
💰 <b>${sub.price.toLocaleString("uz-UZ")} so'm</b>` : "";
  const hint = sub.price ? "\n\n<i>Narx belgilangan. Tasdiqlang yoki rad eting.</i>" : "\n\n<i>Avval narx belgilang, keyin tasdiqlash mumkin.</i>";
  return `🆕 <b>Yangi e'lon arizasi</b>

👤 <b>@${sub.username}</b>${priceLine}` + hint;
}
const handlePreviewSubmitAccount = async (req, res) => {
  const tmpFiles = [];
  try {
    const {
      igUsername,
      avatarFileId,
      storyViewsScreenshot,
      audienceCountriesScreenshot,
      followersScreenshot
    } = req.body || {};
    console.log(
      `📨 preview-submit: @${igUsername} | body ~${JSON.stringify(req.body || {}).length} bayt`
    );
    if (!igUsername || igUsername.trim().length < 2) {
      res.status(400).json({ success: false, error: "igUsername talab qilinadi" });
      return;
    }
    const bot2 = getBot();
    const admins = getAdminIds();
    if (!bot2 || admins.length === 0) {
      res.status(503).json({ success: false, error: "Bot sozlanmagan" });
      return;
    }
    const uname = String(igUsername).replace(/^@/, "");
    const items = [
      { name: "Avatar", url: avatarFileId },
      { name: "Istori arxivi (1 kunlik ko'rishlar)", url: storyViewsScreenshot },
      { name: "Qaysi davlatlar kuzatadi", url: audienceCountriesScreenshot },
      { name: "Obunachilar soni (profil skrini)", url: followersScreenshot }
    ];
    const media = [];
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
              caption: it.name
            });
          }
        } else if (/^https?:/.test(u)) {
          media.push({ type: "photo", media: u, caption: it.name });
        }
      } catch (e) {
        console.warn(
          `   ⚠️ ${it.name}: tayyorlash xato:`,
          e instanceof Error ? e.message : e
        );
      }
    }
    const subId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (const adminId of admins) {
      try {
        const mediaGroupMsgIds = [];
        if (media.length >= 2) {
          const sent = await bot2.sendMediaGroup(adminId, media);
          for (const m of sent || []) {
            if (m && typeof m.message_id === "number") mediaGroupMsgIds.push(m.message_id);
          }
          console.log(
            `   🖼  sendMediaGroup(${media.length}) → ${adminId} OK [${mediaGroupMsgIds.join(",")}]`
          );
        } else if (media.length === 1) {
          const m = await bot2.sendPhoto(adminId, media[0].media, {
            caption: media[0].caption
          });
          if (m?.message_id) mediaGroupMsgIds.push(m.message_id);
        }
        const sub = {
          id: subId,
          adminChatId: adminId,
          username: uname,
          mediaGroupMsgIds,
          buttonsMsgId: 0
        };
        const btnMsg = await bot2.sendMessage(adminId, captionFor(sub), {
          parse_mode: "HTML",
          reply_markup: buildButtons(subId, false)
        });
        sub.buttonsMsgId = btnMsg?.message_id || 0;
        submissions.set(subId, sub);
        console.log(`   ✉️  buttons msg=${sub.buttonsMsgId} → ${adminId} OK (id=${subId})`);
      } catch (e) {
        console.error(
          "preview admin notify fail:",
          e instanceof Error ? e.message : e
        );
      }
    }
    res.json({ success: true, id: subId });
  } catch (err) {
    console.error("preview-submit fatal:", err?.message);
    res.status(500).json({ success: false, error: err?.message || "Server xato" });
  } finally {
    setTimeout(() => {
      for (const p of tmpFiles) fs.promises.unlink(p).catch(() => {
      });
    }, 3e4);
  }
};
function initPreviewBot(bot2) {
  bot2.on("callback_query", async (q) => {
    try {
      const data = q.data || "";
      if (!data.startsWith("mkt:preview:")) return;
      const parts = data.split(":");
      const action = parts[2];
      const id = parts.slice(3).join(":");
      const sub = submissions.get(id);
      const chatId = q.message?.chat.id;
      if (!sub || !chatId) {
        await bot2.answerCallbackQuery(q.id, {
          text: "Bu ariza muddati o'tdi yoki bekor qilingan.",
          show_alert: false
        }).catch(() => {
        });
        return;
      }
      if (action === "approve") {
        if (!sub.price) {
          await bot2.answerCallbackQuery(q.id, {
            text: "Avval narx belgilang!",
            show_alert: true
          }).catch(() => {
          });
          return;
        }
        await bot2.editMessageText(
          `✅ <b>Tasdiqlandi</b>

👤 @${sub.username}
💰 ${sub.price.toLocaleString("uz-UZ")} so'm

<i>E'lon foydalanuvchiga yuboriladi (real oqimda).</i>`,
          {
            chat_id: chatId,
            message_id: sub.buttonsMsgId,
            parse_mode: "HTML"
          }
        ).catch(() => {
        });
        await bot2.answerCallbackQuery(q.id, { text: "✅ Tasdiqlandi" }).catch(() => {
        });
        submissions.delete(id);
      } else if (action === "reject") {
        for (const mid of sub.mediaGroupMsgIds) {
          await bot2.deleteMessage(chatId, mid).catch(() => {
          });
        }
        await bot2.deleteMessage(chatId, sub.buttonsMsgId).catch(() => {
        });
        if (sub.priceMsgId) {
          await bot2.deleteMessage(chatId, sub.priceMsgId).catch(() => {
          });
        }
        await bot2.answerCallbackQuery(q.id, { text: "❌ Rad etildi va o'chirildi" }).catch(() => {
        });
        submissions.delete(id);
        awaitingPrice.delete(chatId);
      } else if (action === "price") {
        awaitingPrice.set(chatId, id);
        const ask = await bot2.sendMessage(
          chatId,
          `💰 <b>Narxni so'mda yuboring</b> (raqam, masalan: <code>250000</code>)

👤 @${sub.username}`,
          {
            parse_mode: "HTML",
            reply_markup: { force_reply: true }
          }
        );
        sub.priceMsgId = ask?.message_id;
        await bot2.answerCallbackQuery(q.id).catch(() => {
        });
      } else {
        await bot2.answerCallbackQuery(q.id).catch(() => {
        });
      }
    } catch (e) {
      console.error(
        "preview callback handler error:",
        e instanceof Error ? e.message : e
      );
    }
  });
  bot2.on("message", async (msg) => {
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
      if (!Number.isFinite(n) || n <= 0 || n > 1e9) {
        await bot2.sendMessage(chatId, "❌ To'g'ri raqam emas. Faqat raqam (so'm) yuboring.").catch(() => {
        });
        return;
      }
      sub.price = n;
      awaitingPrice.delete(chatId);
      await bot2.editMessageText(captionFor(sub), {
        chat_id: chatId,
        message_id: sub.buttonsMsgId,
        parse_mode: "HTML",
        reply_markup: buildButtons(subId, true)
      }).catch(() => {
      });
      if (sub.priceMsgId) {
        await bot2.deleteMessage(chatId, sub.priceMsgId).catch(() => {
        });
        sub.priceMsgId = void 0;
      }
      await bot2.deleteMessage(chatId, msg.message_id).catch(() => {
      });
      console.log(`   💰 narx o'rnatildi: ${sub.username} = ${n} so'm (id=${subId})`);
    } catch (e) {
      console.error(
        "preview price-listener error:",
        e instanceof Error ? e.message : e
      );
    }
  });
  console.log("✅ Preview bot handlers registered (mkt:preview:*)");
}
const preview = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  handlePreviewSubmitAccount,
  initPreviewBot
}, Symbol.toStringTag, { value: "Module" }));
async function deleteTempPhotoWithRetry(bot2, chatId, messageId, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      await bot2.deleteMessage(chatId, messageId);
      return true;
    } catch (e) {
      if (i === attempts - 1) {
        console.error(
          `[upload-image] Vaqtinchalik rasmni o'chirib bo'lmadi (chat=${chatId}, msg=${messageId}, ${attempts} urinishdan keyin):`,
          e instanceof Error ? e.message : e
        );
        return false;
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  return false;
}
const handleUploadImage = async (req, res) => {
  try {
    if (!req.pgUser) {
      res.status(401).json({ success: false, error: "Autentifikatsiya kerak" });
      return;
    }
    const { data, mime } = req.body;
    if (!data || typeof data !== "string") {
      res.status(400).json({ success: false, error: "Rasm ma'lumotlari yetarli emas" });
      return;
    }
    const clean = data.replace(/^data:[^;]+;base64,/, "");
    let buf;
    try {
      buf = Buffer.from(clean, "base64");
    } catch {
      res.status(400).json({ success: false, error: "Rasmni o'qib bo'lmadi" });
      return;
    }
    if (buf.length > 15 * 1024 * 1024) {
      res.status(413).json({ success: false, error: "Rasm 15 MB dan oshmasligi kerak" });
      return;
    }
    if (buf.length < 100) {
      res.status(400).json({ success: false, error: "Rasm juda kichik yoki noto'g'ri" });
      return;
    }
    const bot2 = getBot();
    if (!bot2) {
      res.status(503).json({ success: false, error: "Bot tayyor emas" });
      return;
    }
    const adminIds = getAdminIds();
    if (adminIds.length === 0) {
      res.status(503).json({ success: false, error: "Admin sozlanmagan" });
      return;
    }
    const photo = await bot2.sendPhoto(adminIds[0], buf, {
      disable_notification: true
    }, {
      contentType: mime || "image/jpeg",
      filename: "upload.jpg"
    });
    const photos = photo?.photo;
    const fileId = photos && photos.length > 0 ? photos[photos.length - 1].file_id : "";
    if (photo?.message_id) {
      await deleteTempPhotoWithRetry(bot2, adminIds[0], photo.message_id);
    }
    if (!fileId) {
      res.status(502).json({ success: false, error: "Telegram javob bermadi" });
      return;
    }
    res.json({ success: true, fileId });
  } catch (err) {
    console.error("upload-image error:", err);
    res.status(500).json({
      success: false,
      error: err?.message || "Yuklashda xato"
    });
  }
};
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const cache = /* @__PURE__ */ new Map();
const TTL = 50 * 60 * 1e3;
const EXT_CONTENT_TYPE = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif"
};
async function resolveFileUrl(fileId) {
  const cached2 = cache.get(fileId);
  if (cached2 && cached2.expiresAt > Date.now()) return { url: cached2.url, contentType: cached2.contentType };
  const r = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await r.json();
  if (!data.ok || !data.result?.file_path) return null;
  const filePath = String(data.result.file_path);
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const contentType = EXT_CONTENT_TYPE[ext] || "application/octet-stream";
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  cache.set(fileId, { url, contentType, expiresAt: Date.now() + TTL });
  return { url, contentType };
}
const handleGetFile = async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      res.status(503).send("Bot not configured");
      return;
    }
    const fileId = req.params.fileId;
    if (!fileId) {
      res.status(400).send("Missing file id");
      return;
    }
    const resolved = await resolveFileUrl(fileId);
    if (!resolved) {
      res.status(404).send("File not found");
      return;
    }
    const isHead = req.method === "HEAD";
    const upstream = await fetch(resolved.url, {
      method: isHead ? "HEAD" : "GET",
      headers: req.headers.range ? { range: req.headers.range } : void 0
    });
    if (!upstream.ok || !isHead && !upstream.body) {
      res.status(502).send("Upstream error");
      return;
    }
    res.status(upstream.status);
    res.setHeader("Content-Type", resolved.contentType);
    res.setHeader("Cache-Control", "public, max-age=600");
    res.setHeader("Accept-Ranges", "bytes");
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength) res.setHeader("Content-Length", upstreamLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("file proxy error:", err);
    if (!res.headersSent) res.status(500).send("Server error");
  }
};
const DATA_DIR = path.join(process.cwd(), "server", "data");
const STORE_PATH = path.join(DATA_DIR, "weekly-hashtag.json");
const DEFAULT_HASHTAG = "#reels #instagram #viral #trending #explore #fyp #instagood #instadaily #reelsinstagram #viralreels #explorepage #trend #instareel #reelsvideo #foryou #love #photography #photooftheday #beautiful #fashion #style #art #music #travel #motivation #fitness #food #nature #life #happy";
const UNCONFIGURED_UPDATED_AT = "";
function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      hashtag: parsed.hashtag || DEFAULT_HASHTAG,
      updatedAt: parsed.updatedAt || UNCONFIGURED_UPDATED_AT,
      intervalDays: parsed.intervalDays || 7,
      channelUrl: parsed.channelUrl || ""
    };
  } catch {
    return {
      hashtag: DEFAULT_HASHTAG,
      updatedAt: UNCONFIGURED_UPDATED_AT,
      intervalDays: 7,
      channelUrl: ""
    };
  }
}
function saveStore(next) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2));
}
function readWeeklyChannelUrl() {
  return readStore().channelUrl;
}
function writeWeeklyChannelUrl(channelUrl) {
  saveStore({ ...readStore(), channelUrl });
}
function writeWeeklyHashtag(hashtag) {
  const next = {
    ...readStore(),
    hashtag,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    intervalDays: 7
  };
  saveStore(next);
  return next;
}
const handleGetWeeklyHashtag = (_req, res) => {
  const s = readStore();
  res.json({ success: true, ...s });
};
const FORWARD_SECRET$1 = process.env.BOT_FORWARD_SECRET || "";
const ADMIN_IDS$1 = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => parseInt(s.trim())).filter(Boolean);
const awaitingPostProof = /* @__PURE__ */ new Map();
const awaitingPaymentProof = /* @__PURE__ */ new Map();
setInterval(() => {
}, 30 * 60 * 1e3);
function escapeHtml$2(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtUZS$1(n) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}
const IG_LINK_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:share\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i;
const normalizeIgLink = (raw) => /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
const SELLER_SETTINGS_VIDEO = "https://t.me/kodlarphp/471";
const pendingSellerLinks = /* @__PURE__ */ new Map();
async function forwardOwnerReplyToAdmin(fromTgId, text) {
  const { getAwaitingOwnerReply: getAwaitingOwnerReply2, clearAwaitingOwnerReply: clearAwaitingOwnerReply2 } = await Promise.resolve().then(() => accountSubmissions);
  const pending = getAwaitingOwnerReply2(fromTgId);
  if (!pending) return false;
  clearAwaitingOwnerReply2(fromTgId);
  try {
    const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
    const adminBot = getBot2();
    if (adminBot) {
      await adminBot.sendMessage(
        pending.adminChatId,
        `💬 <b>Akkaunt egasidan javob</b>

Akkaunt <code>#${pending.accountId}</code>:

<blockquote>${escapeHtml$2(text)}</blockquote>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✍️ Yana yozish", callback_data: `mkt:verify:${pending.accountId}:chat` }],
              [{ text: "🚫 Bloklash", callback_data: `mkt:vchat:block:${pending.accountId}:${fromTgId}` }]
            ]
          }
        }
      );
    }
  } catch (e) {
    console.warn("vchat owner→admin send fail:", e instanceof Error ? e.message : e);
  }
  await phpBot.sendMessage(fromTgId, "✅ Javobingiz adminga yetkazildi.").catch(() => {
  });
  return true;
}
const handleBotForwardText = async (req, res) => {
  const secret = req.header("x-forward-secret") ?? "";
  if (!FORWARD_SECRET$1 || secret !== FORWARD_SECRET$1) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  let handled = false;
  try {
    const msg = req.body?.message;
    const fromTgId = Number(msg?.from?.id || 0);
    const text = String(msg?.text || "").trim();
    if (fromTgId && text && !text.startsWith("/")) {
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
    console.error("handleBotForwardText error:", e);
  }
  res.json({ ok: true, handled });
};
const handleBotForward = async (req, res) => {
  const secret = (req.header("x-forward-secret") || req.header("X-Forward-Secret")) ?? "";
  if (!FORWARD_SECRET$1 || secret !== FORWARD_SECRET$1) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  res.json({ ok: true });
  try {
    const update = req.body;
    const msg = update?.message;
    const sp = msg?.successful_payment;
    if (sp) {
      const payload = String(sp.invoice_payload || "");
      const m = payload.match(/^mktw:(\d+):(\d+):[a-f0-9]+$/i);
      if (m) {
        const topupId = Number(m[1]);
        const chargeId = String(sp.telegram_payment_charge_id || "");
        const starsAmount = Number(sp.total_amount || 0);
        const { creditStarsTopupIfPaid: creditStarsTopupIfPaid2 } = await Promise.resolve().then(() => wallet);
        await creditStarsTopupIfPaid2(topupId, chargeId, starsAmount).catch(
          (e) => console.error("creditStarsTopupIfPaid error:", e)
        );
      }
      return;
    }
    if (msg?.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      const fromTgId2 = Number(msg.from?.id || 0);
      const fileId = msg.photo[msg.photo.length - 1]?.file_id;
      if (!fileId) return;
      const postOrderId = awaitingPostProof.get(fromTgId2);
      if (postOrderId) {
        awaitingPostProof.delete(fromTgId2);
        await processPostProofUpload(postOrderId, fileId, fromTgId2).catch(
          (e) => console.error("processPostProofUpload error:", e)
        );
        return;
      }
      const payOrderId = awaitingPaymentProof.get(fromTgId2);
      if (payOrderId) {
        awaitingPaymentProof.delete(fromTgId2);
        await processPaymentProofUpload(payOrderId, fileId, fromTgId2).catch(
          (e) => console.error("processPaymentProofUpload error:", e)
        );
        return;
      }
      const pendingTopup = await prisma.topup.findFirst({
        where: {
          user: { telegramId: BigInt(fromTgId2) },
          status: "PENDING"
        },
        orderBy: { createdAt: "desc" },
        include: { user: true }
      }).catch(() => null);
      if (pendingTopup) {
        await processTopupScreenshot(pendingTopup, fileId, fromTgId2).catch(
          (e) => console.error("processTopupScreenshot error:", e)
        );
        return;
      }
    }
    if (msg?.from?.id && (msg.text || msg.caption)) {
      const text = (msg.text || msg.caption || "").trim();
      if (text && !text.startsWith("/") && await forwardOwnerReplyToAdmin(Number(msg.from.id), text)) return;
    }
    if (msg?.from?.id) {
      const ig = String(msg.text || msg.caption || "").match(IG_LINK_RE);
      if (ig && await handleMarketplaceLink(Number(msg.from.id), normalizeIgLink(ig[0])).catch((e) => {
        console.error("handleMarketplaceLink error:", e);
        return false;
      })) return;
    }
    const cq = update?.callback_query;
    if (!cq) return;
    const data = String(cq.data || "");
    if (!data.startsWith("mkt:")) return;
    const parts = data.split(":");
    const kind = parts[1];
    const fromTgId = Number(cq.from?.id || 0);
    const chatId = Number(cq.message?.chat?.id || 0);
    const messageId = Number(cq.message?.message_id || 0);
    if (kind === "owner") {
      const action = parts[2];
      const accountId = Number(parts[3] || 0);
      await processOwnerConsent(cq.id, action, accountId, chatId, messageId, fromTgId);
    } else if (kind === "seller") {
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      await processSellerConsent(cq.id, action, orderId, chatId, messageId, fromTgId).catch((e) => console.error("processSellerConsent error:", e));
    } else if (kind === "buyer") {
      const sub = parts[2];
      if (sub === "pay" && parts[3] === "upload") {
        const orderId = Number(parts[4] || 0);
        awaitingPaymentProof.set(fromTgId, orderId);
        await phpBot.sendMessage(
          chatId,
          `📸 <b>To'lov skrinshotini yuboring</b>

To'lov amalga oshirilganlik haqidagi cheq skrinshotini shu chatga rasm sifatida yuboring.
Admin tekshirib tasdiqlaydi.`
        ).catch(() => {
        });
        await phpBot.answerCallbackQuery(cq.id, { text: "📸 Skrinshot kutilmoqda" }).catch(() => {
        });
      } else if (sub === "cancel") {
        const orderId = Number(parts[3] || 0);
        await processBuyerCancel(cq.id, orderId, chatId, messageId, fromTgId).catch((e) => console.error("processBuyerCancel error:", e));
      }
    } else if (kind === "post") {
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      if (action === "upload") {
        awaitingPostProof.set(fromTgId, orderId);
        await phpBot.sendMessage(
          chatId,
          `📸 <b>Skrinshot yuboring</b>

Post chiqarilgan ekran skrinshotini shu chatga rasm sifatida yuboring.
Buyurtmachi uni ko'rib tasdiqlaydi.`
        ).catch(() => {
        });
        await phpBot.answerCallbackQuery(cq.id, { text: "📸 Skrinshot kutilmoqda" }).catch(() => {
        });
      }
    } else if (kind === "proof") {
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      await processProofVerification(cq.id, action, orderId, chatId, messageId, fromTgId).catch((e) => console.error("processProofVerification error:", e));
    } else if (kind === "slink") {
      await processSellerLinkChoice(cq.id, Number(parts[2] || 0), chatId, messageId, fromTgId).catch((e) => console.error("processSellerLinkChoice error:", e));
    } else if (kind === "collab") {
      const action = parts[2];
      const orderId = Number(parts[3] || 0);
      await processSellerCollabConfirmation(cq.id, action, orderId, chatId, messageId, fromTgId).catch((e) => console.error("processSellerCollabConfirmation error:", e));
    } else if (kind === "topup") {
      const action = parts[2];
      const topupId = Number(parts[3] || 0);
      await processTopupCallback(cq.id, action, topupId, chatId, messageId, fromTgId).catch((e) => console.error("processTopupCallback error:", e));
    } else if (kind === "vchat") {
      const sub = parts[2];
      const accountId = Number(parts[3] || 0);
      if (sub === "reply") {
        await processOwnerChatReplyStart(cq.id, accountId, chatId, messageId, fromTgId).catch((e) => console.error("processOwnerChatReplyStart error:", e));
      }
    }
  } catch (err) {
    console.error("bot-forward error:", err);
  }
};
const awaitingMaterialInclude = { adAccount: { include: { owner: true } }, advertiser: true };
async function routeLink(order, igUrl, fromTgId) {
  if (Number(order.adAccount?.owner?.telegramId || 0) === fromTgId) await processSellerLink(order, igUrl, fromTgId);
  else await relayBuyerLinkToSeller(order, igUrl, fromTgId);
}
async function handleMarketplaceLink(fromTgId, igUrl) {
  const tg = BigInt(fromTgId);
  const orders2 = await prisma.order.findMany({
    where: {
      status: "AWAITING_BUYER_MATERIAL",
      OR: [{ adAccount: { owner: { telegramId: tg } } }, { advertiser: { telegramId: tg } }]
    },
    orderBy: { createdAt: "asc" },
    include: awaitingMaterialInclude
  });
  if (orders2.length === 0) return false;
  if (orders2.length === 1) {
    await routeLink(orders2[0], igUrl, fromTgId);
    return true;
  }
  pendingSellerLinks.set(fromTgId, { url: igUrl, expiresAt: Date.now() + 30 * 60 * 1e3 });
  await phpBot.sendMessage(
    fromTgId,
    `🔗 Sizda bir nechta faol buyurtma bor. <b>Bu havola qaysi buyurtma uchun?</b>

${escapeHtml$2(igUrl)}`,
    {
      replyMarkup: {
        inline_keyboard: orders2.slice(0, 10).map((o) => {
          const isSeller = Number(o.adAccount.owner?.telegramId || 0) === fromTgId;
          return [{
            text: isSeller ? `#${o.id} — siz sotuvchi, xaridor @${o.targetIgUsername || "—"}` : `#${o.id} — siz xaridor, sotuvchi @${o.adAccount.igUsername}`,
            callback_data: `mkt:slink:${o.id}`
          }];
        })
      }
    }
  ).catch(() => {
  });
  return true;
}
async function processSellerLink(order, igUrl, sellerTgId) {
  const buyerTgId = Number(order.advertiser?.telegramId || 0);
  const flip = await prisma.order.updateMany({
    where: { id: order.id, status: "AWAITING_BUYER_MATERIAL" },
    data: {
      materialFileId: igUrl,
      // havolani shu maydonga saqlaymiz
      materialType: "VIDEO",
      status: "AWAITING_BUYER_VERIFY",
      postedAt: /* @__PURE__ */ new Date()
    }
  });
  if (flip.count !== 1) {
    await phpBot.sendMessage(sellerTgId, `⚠️ Buyurtma <code>#${order.id}</code> endi havola kutmayapti (bekor qilingan bo'lishi mumkin).`).catch(() => {
    });
    return;
  }
  await prisma.orderEvent.create({
    data: { orderId: order.id, type: "seller_link_uploaded", actorId: order.adAccount.ownerId, payload: { url: igUrl } }
  }).catch(() => {
  });
  await phpBot.sendMessage(
    sellerTgId,
    `✅ <b>Havola qabul qilindi</b> (<code>#${order.id}</code>)

⏳ Endi xaridor videoni tekshirib tasdiqlaydi — tasdiqlashi bilan pul hisobingizga o'tadi (24 soatdan keyin).`
  ).catch(() => {
  });
  if (buyerTgId) {
    await phpBot.sendMessage(
      buyerTgId,
      `🎬 <b>Video ulandi!</b>

Sotuvchi <b>@${escapeHtml$2(order.adAccount.igUsername)}</b> videoni ulab, havolasini yubordi:
🔗 ${escapeHtml$2(igUrl)}

Instagram'da tekshirib ko'ring. Hammasi joyida bo'lsa — <b>tasdiqlang</b>.

Muammo bo'lsa ${SUPPORT_USERNAME} ga murojaat qiling.`,
      {
        replyMarkup: {
          inline_keyboard: [[
            { text: "✅ Tasdiqlayman", callback_data: `mkt:proof:approve:${order.id}` },
            { text: "❌ Muammo bor", callback_data: `mkt:proof:reject:${order.id}` }
          ]]
        }
      }
    ).catch((e) => console.warn("buyer verify request failed:", e?.message || e));
  }
}
const MAX_BUYER_RELAYS = 3;
async function relayBuyerLinkToSeller(order, igUrl, buyerTgId) {
  const prev = await prisma.orderEvent.findMany({
    where: { orderId: order.id, type: "buyer_link_relayed" },
    select: { payload: true }
  });
  if (prev.some((e) => e.payload?.url === igUrl)) {
    await phpBot.sendMessage(
      buyerTgId,
      `ℹ️ Bu havola sotuvchiga allaqachon yetkazilgan. ⏳ Sotuvchi collab'ni qabul qilishini kuting — shundan keyin sizdan tasdiq so'raymiz.`
    ).catch(() => {
    });
    return;
  }
  if (prev.length >= MAX_BUYER_RELAYS) {
    await phpBot.sendMessage(
      buyerTgId,
      `ℹ️ Bu buyurtma uchun havola bir necha marta yuborildi. Agar havolani o'zgartirish kerak bo'lsa, ${SUPPORT_USERNAME} ga yozing.`
    ).catch(() => {
    });
    return;
  }
  await prisma.orderEvent.create({
    data: { orderId: order.id, type: "buyer_link_relayed", actorId: order.advertiserId, payload: { url: igUrl } }
  }).catch(() => {
  });
  const sellerTgId = Number(order.adAccount?.owner?.telegramId || 0);
  if (sellerTgId) {
    const res = await phpBot.sendMessage(
      sellerTgId,
      `🎬 <b>Xaridor videoni joyladi</b> (<code>#${order.id}</code>)

🔗 ${escapeHtml$2(igUrl)}

👉 <b>Endi navbat sizda:</b>
1️⃣ Instagram bildirishnomalaridan collab taklifini qabul qiling
2️⃣ Shu havolani <b>bu chatga yuboring</b> — xaridorga tasdiqlash uchun jo'natamiz`
    ).catch(() => null);
    const failure = telegramFailure(res);
    if (isUnreachable(failure)) {
      await handleSellerUnreachable(order.adAccount.ownerId, failure.description);
      return;
    }
  }
  await phpBot.sendMessage(
    buyerTgId,
    `✅ <b>Rahmat, havolangiz sotuvchiga yetkazildi.</b>

⏳ Endi sotuvchi collab taklifingizni qabul qiladi — shundan keyin sizdan tasdiq so'raymiz.

Muammo bo'lsa ${SUPPORT_USERNAME} ga yozing.`
  ).catch(() => {
  });
}
async function processSellerLinkChoice(callbackQueryId, orderId, chatId, messageId, fromTgId) {
  const pending = pendingSellerLinks.get(fromTgId);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingSellerLinks.delete(fromTgId);
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Havola eskirgan — iltimos, havolani qaytadan yuboring", showAlert: true }).catch(() => {
    });
    return;
  }
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: awaitingMaterialInclude });
  const isParty = !!order && (Number(order.adAccount.owner?.telegramId || 0) === fromTgId || Number(order.advertiser?.telegramId || 0) === fromTgId);
  if (!order || order.status !== "AWAITING_BUYER_MATERIAL" || !isParty) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu buyurtma havola kutmayapti", showAlert: true }).catch(() => {
    });
    return;
  }
  pendingSellerLinks.delete(fromTgId);
  await phpBot.answerCallbackQuery(callbackQueryId, { text: "✅ Biriktirildi" }).catch(() => {
  });
  await phpBot.editMessageText(
    chatId,
    messageId,
    `🔗 Havola <code>#${orderId}</code> buyurtmaga biriktirildi.`,
    { replyMarkup: { inline_keyboard: [] } }
  ).catch(() => {
  });
  await routeLink(order, pending.url, fromTgId);
}
async function processSellerConsent(callbackQueryId, action, orderId, chatId, messageId, fromTgId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { adAccount: { include: { owner: true } }, advertiser: true }
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Buyurtma topilmadi", showAlert: true }).catch(() => {
    });
    return;
  }
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;
  if (fromTgId !== sellerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu so'rov sizga emas", showAlert: true }).catch(() => {
    });
    return;
  }
  if (order.status !== "AWAITING_SELLER_CONSENT") {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu buyurtma allaqachon ishlangan", showAlert: true }).catch(() => {
    });
    return;
  }
  if (action === "accept") {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "AWAITING_BUYER_MATERIAL",
          acceptedAt: /* @__PURE__ */ new Date(),
          paymentApprovedAt: /* @__PURE__ */ new Date()
        }
      });
      await tx.orderEvent.create({
        data: { orderId, type: "seller_accepted", actorId: order.adAccount.ownerId }
      });
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `✅ <b>Buyurtma qabul qilindi</b>

Order <code>#${orderId}</code> — mijoz hisobidan to'lov muzlatildi.`
    ).catch(() => {
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "✅ Qabul qilindi" }).catch(() => {
    });
    const { notifyBuyerForMaterial: notifyBuyerForMaterial2 } = await Promise.resolve().then(() => orders);
    notifyBuyerForMaterial2(orderId).catch(() => {
    });
  } else if (action === "reject") {
    await prisma.$transaction(async (tx) => {
      const buyerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.advertiserId } });
      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: {
          balance: { increment: order.price },
          depositBalance: { increment: order.price },
          // qaytgan pul yechib olinmaydi
          frozenBalance: { decrement: order.price },
          totalSpent: { decrement: order.price }
        }
      });
      await tx.transaction.create({
        data: {
          walletId: buyerWallet.id,
          type: "ESCROW_REFUND",
          amount: order.price,
          status: "COMPLETED",
          orderId,
          note: `Order #${orderId} — sotuvchi rad etdi, pul qaytarildi`
        }
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED" }
      });
      await tx.orderEvent.create({
        data: { orderId, type: "seller_rejected", actorId: order.adAccount.ownerId }
      });
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `❌ <b>Buyurtma rad etildi</b>

Order <code>#${orderId}</code> bekor qilindi.`
    ).catch(() => {
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "❌ Rad etildi" }).catch(() => {
    });
    const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `❌ <b>Sotuvchi buyurtmani rad etdi</b>

Order <code>#${orderId}</code> bekor qilindi. To'langan <b>${order.price.toLocaleString("uz-UZ")}</b> so'm hamyoningizga qaytarildi.`
      ).catch(() => {
      });
    }
  }
}
async function processPaymentProofUpload(orderId, photoFileId, buyerTgId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } }
  });
  if (!order) return;
  if (order.status !== "AWAITING_PAYMENT") {
    await phpBot.sendMessage(
      buyerTgId,
      `⚠️ Bu buyurtma to'lov kutish holatida emas (hozirgi status: <code>${order.status}</code>).`
    ).catch(() => {
    });
    return;
  }
  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentProofFileId: photoFileId,
      status: "AWAITING_PAYMENT_APPROVAL"
    }
  });
  await prisma.orderEvent.create({
    data: { orderId, type: "payment_proof_uploaded", actorId: order.advertiserId, payload: { fileId: photoFileId } }
  }).catch(() => {
  });
  await phpBot.sendMessage(
    buyerTgId,
    `✅ <b>Skrinshot qabul qilindi</b>

Admin tekshirib tasdiqlagach, sotuvchi videoni joylaydi. Sizga xabar boradi.`
  ).catch(() => {
  });
  const buyerName = order.advertiser.username ? `@${order.advertiser.username}` : order.advertiser.firstName || `id:${order.advertiserId}`;
  const caption = `💸 <b>To'lov skrinshoti tasdiqlash kerak</b>

🛍 Mijoz: ${buyerName}
📲 Akkaunt: <b>@${order.adAccount.igUsername}</b>
🎯 Maqsad: <b>@${order.targetIgUsername || "—"}</b>
💰 Summa: <code>${fmtUZS$1(order.price)}</code> so'm
🆔 Order: <code>#${orderId}</code>`;
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "✅ To'lov tasdiqlandi", callback_data: `mkt:admin:pay:approve:${orderId}` },
        { text: "❌ Rad etish", callback_data: `mkt:admin:pay:reject:${orderId}` }
      ]
    ]
  };
  const sellerToken = process.env.WEBAPP_BOT_TOKEN || "";
  let photoBuffer = null;
  if (sellerToken) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${sellerToken}/getFile?file_id=${encodeURIComponent(photoFileId)}`);
      const j = await r.json();
      if (j.ok && j.result?.file_path) {
        const fileUrl = `https://api.telegram.org/file/bot${sellerToken}/${j.result.file_path}`;
        const fileRes = await fetch(fileUrl);
        if (fileRes.ok) {
          const ab = await fileRes.arrayBuffer();
          photoBuffer = Buffer.from(ab);
        } else {
          console.warn("admin pay proof file download failed:", fileRes.status);
        }
      } else {
        console.warn("admin pay proof getFile failed:", j.description);
      }
    } catch (e) {
      console.warn("admin pay proof file fetch failed:", e instanceof Error ? e.message : e);
    }
  }
  try {
    const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
    const bot2 = getBot2();
    if (!bot2) return;
    for (const adminId of ADMIN_IDS$1) {
      if (photoBuffer) {
        try {
          await bot2.sendPhoto(
            adminId,
            photoBuffer,
            { caption, parse_mode: "HTML", reply_markup: replyMarkup },
            { filename: `pay-proof-${orderId}.jpg`, contentType: "image/jpeg" }
          );
          continue;
        } catch (e) {
          console.warn("admin pay proof Buffer send failed:", e?.message || e);
        }
      }
      await bot2.sendMessage(
        adminId,
        `${caption}

<i>⚠️ Skrinshot rasm sifatida yuborilmadi — Top_sxema chatida ko'ring.</i>`,
        { parse_mode: "HTML", reply_markup: replyMarkup }
      ).catch((e) => console.warn("admin pay proof text fallback failed:", e?.message || e));
    }
  } catch (e) {
    console.warn("admin pay proof error:", e instanceof Error ? e.message : e);
  }
}
async function processBuyerCancel(callbackQueryId, orderId, chatId, messageId, fromTgId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } }
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Buyurtma topilmadi", showAlert: true }).catch(() => {
    });
    return;
  }
  const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
  if (fromTgId !== buyerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu sizning buyurtmangiz emas", showAlert: true }).catch(() => {
    });
    return;
  }
  const CANCELLABLE = ["AWAITING_SELLER_CONSENT", "AWAITING_PAYMENT", "AWAITING_BUYER_MATERIAL"];
  if (!CANCELLABLE.includes(order.status)) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu bosqichda bekor qilib bo'lmaydi", showAlert: true }).catch(() => {
    });
    return;
  }
  const cancelled = await prisma.$transaction(async (tx) => {
    const flip = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: "CANCELLED" }
    });
    if (flip.count !== 1) return false;
    if (order.status === "AWAITING_SELLER_CONSENT" || order.status === "AWAITING_BUYER_MATERIAL") {
      const buyerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.advertiserId } });
      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: {
          balance: { increment: order.price },
          depositBalance: { increment: order.price },
          // qaytgan pul yechib olinmaydi
          frozenBalance: { decrement: order.price },
          totalSpent: { decrement: order.price }
        }
      });
      await tx.transaction.create({
        data: {
          walletId: buyerWallet.id,
          type: "ESCROW_REFUND",
          amount: order.price,
          status: "COMPLETED",
          orderId,
          note: `Order #${orderId} — mijoz bekor qildi, pul qaytarildi`
        }
      });
    }
    await tx.orderEvent.create({
      data: { orderId, type: "buyer_cancelled", actorId: order.advertiserId }
    });
    return true;
  });
  if (!cancelled) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu buyurtma allaqachon o'zgargan", showAlert: true }).catch(() => {
    });
    return;
  }
  await phpBot.editMessageText(
    chatId,
    messageId,
    `❌ <b>Buyurtma bekor qilindi</b> (<code>#${orderId}</code>)` + (order.status === "AWAITING_PAYMENT" ? "" : `

💰 ${fmtUZS$1(order.price)} so'm hamyoningizga qaytarildi.`)
  ).catch(() => {
  });
  await phpBot.answerCallbackQuery(callbackQueryId, { text: "❌ Bekor qilindi" }).catch(() => {
  });
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;
  if (sellerTgId) {
    await phpBot.sendMessage(
      sellerTgId,
      `❌ Mijoz <code>#${orderId}</code> buyurtmasini bekor qildi.`
    ).catch(() => {
    });
  }
}
async function processSellerCollabConfirmation(callbackQueryId, action, orderId, chatId, messageId, fromTgId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } }
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Buyurtma topilmadi", showAlert: true }).catch(() => {
    });
    return;
  }
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;
  if (fromTgId !== sellerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu sizning buyurtmangiz emas", showAlert: true }).catch(() => {
    });
    return;
  }
  if (order.status !== "AWAITING_BUYER_VERIFY") {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: `Allaqachon ishlangan (${order.status})`, showAlert: true }).catch(() => {
    });
    return;
  }
  const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
  if (action === "approve") {
    const releaseAt = new Date(Date.now() + 24 * 60 * 60 * 1e3);
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "BUYER_VERIFIED", verifiedAt: /* @__PURE__ */ new Date(), releaseAt }
    });
    await prisma.orderEvent.create({
      data: { orderId, type: "collab_confirmed", actorId: order.adAccount.ownerId }
    }).catch(() => {
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `✅ <b>Collab tasdiqlandi</b>

Order <code>#${orderId}</code>. Pul <b>24 soatdan keyin</b> wallet'ingizga +${fmtUZS$1(order.escrowAmount)} so'm tushadi.`,
      { replyMarkup: { inline_keyboard: [] } }
    ).catch(async () => {
      await phpBot.sendMessage(
        chatId,
        `✅ <b>Collab tasdiqlandi</b>

24 soat ichida +${fmtUZS$1(order.escrowAmount)} so'm tushadi.`
      ).catch(() => {
      });
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "✅ Tasdiqlandi" }).catch(() => {
    });
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `🎉 <b>Sotuvchi collab'ni tasdiqladi!</b>

Order <code>#${orderId}</code> muvaffaqiyatli yakunlandi.
Sotuvchi to'lovni 24 soatdan keyin oladi.`
      ).catch(() => {
      });
    }
  } else if (action === "reject") {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "DISPUTED" }
    }).catch(() => {
    });
    await prisma.orderEvent.create({
      data: { orderId, type: "collab_rejected", actorId: order.adAccount.ownerId }
    }).catch(() => {
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `❌ <b>Rad etildi</b>

Order <code>#${orderId}</code> tortishuvga jo'natildi. Admin ko'rib chiqadi.`,
      { replyMarkup: { inline_keyboard: [] } }
    ).catch(() => {
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "❌ Tortishuvga" }).catch(() => {
    });
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `⚠️ <b>Sotuvchi collab'ni rad etdi</b>

Order <code>#${orderId}</code> tortishuv (dispute) holatida. Admin ko'rib chiqadi.`
      ).catch(() => {
      });
    }
    try {
      const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
      const adminBot = getBot2();
      if (adminBot) {
        for (const adminId of ADMIN_IDS$1) {
          adminBot.sendMessage(adminId, `⚠️ Order #${orderId} seller tomonidan collab rad etildi (DISPUTE).`).catch(() => {
          });
        }
      }
    } catch {
    }
  }
}
async function processPostProofUpload(orderId, photoFileId, sellerTgId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: true }
  });
  if (!order || !order.advertiser) return;
  if (!["PAYMENT_APPROVED", "PAID", "ACCEPTED"].includes(order.status)) {
    await phpBot.sendMessage(
      sellerTgId,
      `⚠️ Bu buyurtma post yuklash holatida emas (status: <code>${order.status}</code>).`
    ).catch(() => {
    });
    return;
  }
  const buyerTgId = order.advertiser.telegramId ? Number(order.advertiser.telegramId) : null;
  if (!buyerTgId) return;
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "AWAITING_BUYER_VERIFY",
      postedAt: /* @__PURE__ */ new Date(),
      postProofFileId: photoFileId,
      guaranteeProof: photoFileId
    }
  });
  await prisma.orderEvent.create({
    data: { orderId, type: "posted", actorId: order.adAccount.ownerId, payload: { fileId: photoFileId } }
  }).catch(() => {
  });
  await phpBot.sendMessage(
    sellerTgId,
    `✅ <b>Skrinshot qabul qilindi!</b>

Buyurtmachi ko'rib chiqib tasdiqlashini kuting. Tasdiqlangach pul wallet'ingizga o'tadi.`
  ).catch(() => {
  });
  await phpBot.sendPhoto(buyerTgId, photoFileId, {
    caption: `📸 <b>Post chiqarildi</b>

Order: <code>#${orderId}</code>
Sotuvchi post skrinshotini yubordi.

<i>Skrinshotni ko'rib chiqing va tasdiqlang yoki rad eting.</i>`,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlayman", callback_data: `mkt:proof:approve:${orderId}` },
          { text: "❌ Rad etaman", callback_data: `mkt:proof:reject:${orderId}` }
        ]
      ]
    }
  }).catch((e) => console.warn("proof photo to buyer failed:", e?.message || e));
}
async function processProofVerification(callbackQueryId, action, orderId, chatId, messageId, fromTgId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { advertiser: true, adAccount: { include: { owner: true } } }
  });
  if (!order) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Buyurtma topilmadi", showAlert: true }).catch(() => {
    });
    return;
  }
  const buyerTgId = order.advertiser?.telegramId ? Number(order.advertiser.telegramId) : 0;
  if (fromTgId !== buyerTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu sizning buyurtmangiz emas", showAlert: true }).catch(() => {
    });
    return;
  }
  const sellerTgId = order.adAccount?.owner?.telegramId ? Number(order.adAccount.owner.telegramId) : 0;
  if (order.status !== "AWAITING_BUYER_VERIFY") {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu buyurtma allaqachon ko'rib chiqilgan", showAlert: true }).catch(() => {
    });
    return;
  }
  const replaceDecisionMessage = async (text) => {
    const noButtons = { replyMarkup: { inline_keyboard: [] } };
    const r1 = await phpBot.editMessageCaption(chatId, messageId, text, noButtons).catch(() => null);
    if (r1?.result?.ok) return;
    const r2 = await phpBot.editMessageText(chatId, messageId, text, noButtons).catch(() => null);
    if (!r2?.result?.ok) await phpBot.sendMessage(chatId, text).catch(() => {
    });
  };
  if (action === "approve") {
    const releaseAt = new Date(Date.now() + 24 * 60 * 60 * 1e3);
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "BUYER_VERIFIED", verifiedAt: /* @__PURE__ */ new Date(), releaseAt }
    });
    await prisma.orderEvent.create({
      data: { orderId, type: "buyer_verified", actorId: order.advertiser.id }
    }).catch(() => {
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "✅ Tasdiqlandi" }).catch(() => {
    });
    await replaceDecisionMessage(
      `✅ <b>Tasdiqlandi</b>

Buyurtma <code>#${orderId}</code>. Rahmat! Pul sotuvchining hisobiga <b>24 soatdan keyin</b> tushadi.`
    );
    if (sellerTgId) {
      await phpBot.sendMessage(
        sellerTgId,
        `🎉 <b>Buyurtmachi tasdiqladi!</b>

Order <code>#${orderId}</code>.
💰 24 soat ichida wallet'ingizga +${fmtUZS$1(order.escrowAmount)} so'm tushadi.`
      ).catch((e) => console.warn("seller notify failed:", e?.message || e));
    }
  } else if (action === "reject") {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "DISPUTED" }
    }).catch(() => {
    });
    await replaceDecisionMessage(
      `❌ <b>Muammo qayd etildi</b>

Buyurtma <code>#${orderId}</code> admin ko'rib chiqishiga yuborildi. Pulingiz saqlanib turibdi.

Muammo bo'lsa ${SUPPORT_USERNAME} ga murojaat qiling.`
    );
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "❌ Admin ko'rib chiqadi" }).catch(() => {
    });
    if (sellerTgId) {
      await phpBot.sendMessage(
        sellerTgId,
        `⚠️ <b>Xaridor natijani qabul qilmadi</b>

Buyurtma <code>#${orderId}</code> tortishuv holatida — admin ko'rib chiqadi.`
      ).catch(() => {
      });
    }
    try {
      const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
      const bot2 = getBot2();
      if (bot2) {
        for (const adminId of ADMIN_IDS$1) {
          bot2.sendMessage(
            adminId,
            `⚠️ Buyurtma #${orderId} xaridor tomonidan rad etildi (DISPUTE).
Akkaunt: @${order.adAccount.igUsername}
Havola: ${order.materialFileId || "—"}`
          ).catch(() => {
          });
        }
      }
    } catch {
    }
  }
}
async function processOwnerConsent(callbackQueryId, action, accountId, chatId, messageId, fromTgId) {
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Akkaunt topilmadi", showAlert: true }).catch(() => {
    });
    return;
  }
  const owner = await prisma.user.findUnique({
    where: { id: account.ownerId },
    select: { telegramId: true }
  });
  const ownerTgId = owner?.telegramId ? Number(owner.telegramId) : null;
  if (!ownerTgId || ownerTgId !== fromTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu so'rov sizga emas", showAlert: true }).catch(() => {
    });
    return;
  }
  if (action === "agree") {
    const updated = await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: "ACTIVE", isVerified: true, frozenUntil: null }
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `✅ <b>Rozilik qabul qilindi</b>

👤 @${escapeHtml$2(account.igUsername)}
💰 ${fmtUZS$1(updated.priceFeed)} so'm

<i>Akkauntingiz marketplace'da faol holatda.</i>`
    ).catch(() => {
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "✅ Tasdiqlandi" }).catch(() => {
    });
    phpBot.sendVideo(ownerTgId, SELLER_SETTINGS_VIDEO, {
      caption: `📖 <b>Qo'llanma video — albatta ko'ring!</b>

Akkauntingiz marketplace'ga qo'yildi. Videoda ikkita muhim narsa ko'rsatilgan:
1️⃣ Akkauntni marketplace'da qanday boshqarish
2️⃣ Instagram'da qaysi <b>sozlamalarni yoqish</b> kerakligi — ularsiz xaridorlarning collab so'rovlari sizga kelmaydi va buyurtma bajarilmaydi.

Muammo bo'lsa ${SUPPORT_USERNAME} ga murojaat qiling.`
    }).catch(() => {
    });
    try {
      const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
      const bot2 = getBot2();
      if (bot2) {
        for (const adminId of ADMIN_IDS$1) {
          bot2.sendMessage(
            adminId,
            `✅ Egasi rozilik berdi: @${account.igUsername} (#${accountId}) → ACTIVE`,
            { parse_mode: "HTML" }
          ).catch(() => {
          });
        }
      }
    } catch {
    }
  } else if (action === "cancel") {
    await prisma.adAccount.update({
      where: { id: accountId },
      data: { status: "PENDING", isVerified: false, priceFeed: 0, priceReels: 0, priceStory: 0 }
    });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `❌ <b>Bekor qilindi</b>

👤 @${escapeHtml$2(account.igUsername)}

<i>Admin yana ko'rib chiqadi va yangi narx taklif qilishi mumkin.</i>`
    ).catch(() => {
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "❌ Bekor qilindi" }).catch(() => {
    });
    try {
      const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
      const bot2 = getBot2();
      if (bot2) {
        for (const adminId of ADMIN_IDS$1) {
          bot2.sendMessage(
            adminId,
            `❌ Egasi narxni rad etdi: @${account.igUsername} (#${accountId}) → PENDING (yangi ko'rib chiqish kerak)`,
            { parse_mode: "HTML" }
          ).catch(() => {
          });
        }
      }
    } catch {
    }
  } else {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Noma'lum amal" }).catch(() => {
    });
  }
}
async function processTopupScreenshot(topup, fileId, fromTgId) {
  try {
    await prisma.topup.update({
      where: { id: topup.id },
      data: { screenshotFileId: fileId, status: "AWAITING_REVIEW" }
    });
    await phpBot.sendMessage(
      fromTgId,
      `✅ <b>Chek qabul qilindi</b>

So'rov #${topup.id} adminga yuborildi. Admin tasdiqlasa balansingiz <b>${topup.amount.toLocaleString("uz-UZ")}</b> so'mga ko'payadi.`
    ).catch(() => {
    });
    const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
    const adminBot = getBot2();
    if (!adminBot) return;
    const TOP_SXEMA_TOKEN = process.env.WEBAPP_BOT_TOKEN || "";
    let photoBuffer = null;
    if (TOP_SXEMA_TOKEN) {
      try {
        const fileRes = await fetch(`https://api.telegram.org/bot${TOP_SXEMA_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
        const fileJson = await fileRes.json();
        const filePath = fileJson?.result?.file_path;
        if (filePath) {
          const dl = await fetch(`https://api.telegram.org/file/bot${TOP_SXEMA_TOKEN}/${filePath}`);
          const arr = new Uint8Array(await dl.arrayBuffer());
          photoBuffer = Buffer.from(arr);
        }
      } catch (e) {
        console.warn("topup download failed:", e instanceof Error ? e.message : e);
      }
    }
    const caption = `💳 <b>Yangi hisob to'ldirish so'rovi</b>

🆔 So'rov: <code>#${topup.id}</code>
👤 User ID: <code>${topup.user?.id}</code>
📱 TG: <code>${fromTgId}</code>
💰 Summa: <code>${topup.amount.toLocaleString("uz-UZ")}</code> so'm

Chekni tekshiring va tasdiqlang/rad eting.`;
    const kb = {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlash", callback_data: `mkt:topup:approve:${topup.id}` },
          { text: "❌ Rad etish", callback_data: `mkt:topup:reject:${topup.id}` }
        ]
      ]
    };
    for (const adminId of ADMIN_IDS$1) {
      try {
        let sent;
        if (photoBuffer) {
          sent = await adminBot.sendPhoto(adminId, photoBuffer, {
            caption,
            parse_mode: "HTML",
            reply_markup: kb
          }, { filename: "topup.jpg", contentType: "image/jpeg" });
        } else {
          sent = await adminBot.sendMessage(adminId, caption, { parse_mode: "HTML", reply_markup: kb });
        }
        const messageId = sent?.message_id;
        if (messageId) {
          await prisma.topup.update({
            where: { id: topup.id },
            data: { adminTgChatId: String(adminId), adminTgMessageId: messageId }
          }).catch(() => {
          });
        }
        break;
      } catch (e) {
        console.warn("topup admin send failed for", adminId, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error("processTopupScreenshot fatal:", e);
  }
}
async function processTopupCallback(callbackQueryId, action, topupId, chatId, messageId, fromTgId) {
  const topup = await prisma.topup.findUnique({ where: { id: topupId }, include: { user: true } });
  if (!topup) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "So'rov topilmadi", showAlert: true }).catch(() => {
    });
    return;
  }
  if (action === "cancel") {
    if (Number(topup.user?.telegramId) !== fromTgId) {
      await phpBot.answerCallbackQuery(callbackQueryId, { text: "Faqat egasi bekor qila oladi", showAlert: true }).catch(() => {
      });
      return;
    }
    if (topup.status !== "PENDING") {
      await phpBot.answerCallbackQuery(callbackQueryId, { text: "Allaqachon ishlangan", showAlert: true }).catch(() => {
      });
      return;
    }
    await prisma.topup.update({ where: { id: topupId }, data: { status: "CANCELLED" } });
    await phpBot.editMessageText(
      chatId,
      messageId,
      `🚫 <b>So'rov #${topupId} bekor qilindi</b>`,
      { replyMarkup: { inline_keyboard: [] } }
    ).catch(() => {
    });
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bekor qilindi" }).catch(() => {
    });
    return;
  }
  if (!ADMIN_IDS$1.includes(fromTgId)) {
    const { getBot: getBot22 } = await Promise.resolve().then(() => bot$1);
    const adminBot2 = getBot22();
    if (adminBot2) {
      await adminBot2.answerCallbackQuery(callbackQueryId, { text: "⛔ Faqat admin", show_alert: true }).catch(() => {
      });
    }
    return;
  }
  const { getBot: getBot2 } = await Promise.resolve().then(() => bot$1);
  const adminBot = getBot2();
  if (!adminBot) return;
  if (topup.status !== "AWAITING_REVIEW" && topup.status !== "PENDING") {
    await adminBot.answerCallbackQuery(callbackQueryId, { text: `Allaqachon: ${topup.status}`, show_alert: true }).catch(() => {
    });
    return;
  }
  const buyerTgId = topup.user?.telegramId ? Number(topup.user.telegramId) : 0;
  if (action === "approve") {
    await prisma.$transaction(async (tx) => {
      let wallet2 = await tx.wallet.findUnique({ where: { userId: topup.userId } });
      if (!wallet2) {
        wallet2 = await tx.wallet.create({ data: { userId: topup.userId } });
      }
      await tx.wallet.update({
        where: { id: wallet2.id },
        data: { balance: { increment: topup.amount }, depositBalance: { increment: topup.amount } }
      });
      await tx.transaction.create({
        data: {
          walletId: wallet2.id,
          type: "DEPOSIT",
          amount: topup.amount,
          status: "COMPLETED",
          note: `Topup #${topup.id} tasdiqlandi (admin: ${fromTgId})`
        }
      });
      await tx.topup.update({
        where: { id: topup.id },
        data: { status: "APPROVED", reviewedAt: /* @__PURE__ */ new Date() }
      });
    });
    try {
      await adminBot.editMessageCaption(
        `✅ TASDIQLANDI · #${topup.id} · +${topup.amount.toLocaleString("uz-UZ")} so'm balansga qo'shildi`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
      );
    } catch {
      try {
        await adminBot.editMessageText(
          `✅ TASDIQLANDI · #${topup.id} · +${topup.amount.toLocaleString("uz-UZ")} so'm`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
        );
      } catch {
      }
    }
    await adminBot.answerCallbackQuery(callbackQueryId, { text: "✅ Tasdiqlandi" }).catch(() => {
    });
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `✅ <b>To'lov tasdiqlandi!</b>

So'rov #${topup.id} · <b>+${topup.amount.toLocaleString("uz-UZ")}</b> so'm balansingizga qo'shildi.

Endi WebApp'ga qaytib buyurtma berishingiz mumkin.`
      ).catch(() => {
      });
    }
  } else if (action === "reject") {
    await prisma.topup.update({
      where: { id: topup.id },
      data: { status: "REJECTED", reviewedAt: /* @__PURE__ */ new Date(), rejectReason: "Admin rad etdi" }
    });
    try {
      await adminBot.deleteMessage(chatId, messageId);
    } catch {
    }
    await adminBot.answerCallbackQuery(callbackQueryId, { text: "❌ Rad etildi va o'chirildi" }).catch(() => {
    });
    if (buyerTgId) {
      await phpBot.sendMessage(
        buyerTgId,
        `❌ <b>To'lov tasdiqlanmadi</b>

So'rov #${topup.id} · <b>${topup.amount.toLocaleString("uz-UZ")}</b> so'm — admin rad etdi.

<i>Iltimos, to'lovni qaytadan amalga oshiring yoki admin bilan bog'laning.</i>`
      ).catch(() => {
      });
    }
  }
}
async function processOwnerChatReplyStart(callbackQueryId, accountId, chatId, messageId, fromTgId) {
  const account = await prisma.adAccount.findUnique({
    where: { id: accountId },
    include: { owner: true }
  });
  if (!account || Number(account.owner?.telegramId) !== fromTgId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Sizniki emas", showAlert: true }).catch(() => {
    });
    return;
  }
  if (account.owner?.blockedFromAdminChat) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Bu funksiyadan foydalanish sizga bloklangan", showAlert: true }).catch(() => {
    });
    return;
  }
  const { getLastChatAdmin: getLastChatAdmin2, setAwaitingOwnerReply: setAwaitingOwnerReply2 } = await Promise.resolve().then(() => accountSubmissions);
  const adminChatId = getLastChatAdmin2(accountId) ?? ADMIN_IDS$1[0];
  if (!adminChatId) {
    await phpBot.answerCallbackQuery(callbackQueryId, { text: "Admin sozlanmagan", showAlert: true }).catch(() => {
    });
    return;
  }
  setAwaitingOwnerReply2(fromTgId, accountId, adminChatId);
  await phpBot.sendMessage(
    fromTgId,
    `✍️ <b>Javobingizni shu chatga matn sifatida yuboring.</b>

<i>10 daqiqa ichida. Bekor qilish: keyingi xabar /cancel.</i>`
  ).catch(() => {
  });
  await phpBot.answerCallbackQuery(callbackQueryId, { text: "✍️ Matn yozing" }).catch(() => {
  });
}
const APIFY_TOKEN$1 = process.env.APIFY_API_TOKEN || "";
const APIFY_ACTOR$1 = "apify~instagram-profile-scraper";
const APIFY_TIMEOUT_MS$1 = 27e3;
async function fetchBioViaApify(username) {
  if (!APIFY_TOKEN$1) return { success: false, error: "not_configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS$1);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR$1}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN$1)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username] }),
        signal: controller.signal
      }
    );
    clearTimeout(timer);
    if (!res.ok) return { success: false, error: `upstream_${res.status}` };
    const data = await res.json().catch(() => null);
    const user = Array.isArray(data) ? data[0] : null;
    if (!user || user.error || !user.username) {
      return { success: false, error: "not_found" };
    }
    return {
      success: true,
      username: user.username,
      fullName: user.fullName || "",
      biography: user.biography || "",
      externalUrl: user.externalUrl || "",
      followers: user.followersCount ?? 0,
      following: user.followsCount ?? 0,
      posts: user.postsCount ?? 0,
      isPrivate: !!user.private,
      isVerified: !!user.verified,
      profilePicUrl: user.profilePicUrlHD || user.profilePicUrl || ""
    };
  } catch (error) {
    clearTimeout(timer);
    console.error("apify-bio error:", error instanceof Error ? error.message : error);
    return { success: false, error: "fetch_failed" };
  }
}
const HD_ACTOR$1 = "instagram-scraper~instagram-profile-scraper";
const HD_TIMEOUT_MS = 6e4;
const HD_CACHE_TTL_MS = 6 * 60 * 60 * 1e3;
const hdCache = /* @__PURE__ */ new Map();
const hdInflight = /* @__PURE__ */ new Map();
function getCachedHdPic(username) {
  const hit = hdCache.get(username);
  if (!hit) return "";
  if (hit.exp < Date.now()) {
    hdCache.delete(username);
    return "";
  }
  return hit.url;
}
function fetchHdPicViaApify(username) {
  const cached2 = getCachedHdPic(username);
  if (cached2) return Promise.resolve(cached2);
  if (!APIFY_TOKEN$1) return Promise.resolve("");
  const running2 = hdInflight.get(username);
  if (running2) return running2;
  const p = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HD_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${HD_ACTOR$1}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN$1)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instagramUsernames: [username] }),
          signal: controller.signal
        }
      );
      if (!res.ok) return "";
      const data = await res.json().catch(() => null);
      const item = Array.isArray(data) ? data[0] : null;
      const url = String(item?.profile_pic_url_hd || "");
      if (!/^https?:\/\//.test(url)) return "";
      hdCache.set(username, { url, exp: Date.now() + HD_CACHE_TTL_MS });
      return url;
    } catch {
      return "";
    } finally {
      clearTimeout(timer);
      hdInflight.delete(username);
    }
  })();
  hdInflight.set(username, p);
  return p;
}
const KEY = "bio_hd_enabled";
const TTL_MS$1 = 3e4;
let cached = null;
async function isBioHdEnabled() {
  if (cached && Date.now() - cached.at < TTL_MS$1) return cached.value;
  let value = true;
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    value = !row || row.value !== "0";
  } catch {
    value = true;
  }
  cached = { value, at: Date.now() };
  return value;
}
async function setBioHdEnabled(value) {
  const v = value ? "1" : "0";
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: v }, create: { key: KEY, value: v } });
  cached = { value, at: Date.now() };
}
const USD_UZS_APPROX = 12700;
const BASE_ACTOR = "apify~instagram-profile-scraper";
const HD_ACTOR = "instagram-scraper~instagram-profile-scraper";
const WINDOW_DAYS = 7;
async function apify(path2, token) {
  const sep = path2.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.apify.com/v2${path2}${sep}token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(2e4)
  });
  if (!res.ok) throw new Error(`Apify ${path2} → HTTP ${res.status}`);
  return res.json();
}
function pricePerRun(actor, tier) {
  const result = pricePerResult(actor, tier);
  if (result == null) return null;
  const events = actor?.data?.pricingInfos?.slice(-1)[0]?.pricingPerEvent?.actorChargeEvents || {};
  const start = events["apify-actor-start"];
  const startFee = typeof start?.eventPriceUsd === "number" ? start.eventPriceUsd : 0;
  return result + startFee;
}
function pricePerResult(actor, tier) {
  const infos = actor?.data?.pricingInfos || [];
  const info = infos[infos.length - 1];
  const events = info?.pricingPerEvent?.actorChargeEvents;
  if (!events) return typeof info?.pricePerUnitUsd === "number" ? info.pricePerUnitUsd : null;
  const ev = events["apify-default-dataset-item"] || Object.values(events).find((e) => e?.eventTieredPricingUsd || e?.eventPriceUsd);
  if (!ev) return null;
  const tiered = ev.eventTieredPricingUsd;
  if (tiered) return tiered[tier]?.tieredEventPriceUsd ?? tiered.FREE?.tieredEventPriceUsd ?? null;
  return typeof ev.eventPriceUsd === "number" ? ev.eventPriceUsd : null;
}
async function estimateBioCosts() {
  const token = process.env.APIFY_API_TOKEN || "";
  if (!token) return null;
  try {
    const [me, hdActor, runs] = await Promise.all([
      apify("/users/me", token),
      apify(`/acts/${HD_ACTOR}`, token),
      apify(`/acts/${BASE_ACTOR}/runs?desc=1&limit=1000`, token)
    ]);
    const plan = String(me?.data?.plan?.id || "FREE").toUpperCase();
    const tier = plan === "FREE" ? "FREE" : plan === "SCALE" ? "SILVER" : plan === "BUSINESS" ? "GOLD" : "BRONZE";
    const startOfToday = /* @__PURE__ */ new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const from = startOfToday.getTime() - WINDOW_DAYS * 864e5;
    const items = (runs?.data?.items || []).filter((r) => {
      const t = Date.parse(r.startedAt);
      return t >= from && t < startOfToday.getTime();
    });
    const paid = items.filter((r) => Number(r.usageTotalUsd) > 0);
    const paidRuns = paid.length;
    const basePerRunUsd = paidRuns ? paid.reduce((s, r) => s + Number(r.usageTotalUsd), 0) / paidRuns : 23e-4;
    const hdPerRunUsd = pricePerRun({ data: hdActor?.data }, tier) ?? 3e-3;
    const runsPerDay = paidRuns / WINDOW_DAYS;
    return {
      windowDays: WINDOW_DAYS,
      paidRuns,
      runsPerDay,
      basePerRunUsd,
      basePerDayUsd: runsPerDay * basePerRunUsd,
      hdPerRunUsd,
      hdExtraPerDayUsd: runsPerDay * hdPerRunUsd,
      hdExtraPerMonthUsd: runsPerDay * hdPerRunUsd * 30,
      totalHdPerDayUsd: runsPerDay * (basePerRunUsd + hdPerRunUsd),
      totalHdPerMonthUsd: runsPerDay * (basePerRunUsd + hdPerRunUsd) * 30,
      tier
    };
  } catch (e) {
    console.warn("estimateBioCosts error:", e instanceof Error ? e.message : e);
    return null;
  }
}
const usd = (n) => `$${n.toFixed(n < 0.01 ? 5 : n < 1 ? 3 : 2)}`;
const som = (usdAmount) => new Intl.NumberFormat("uz-UZ").format(Math.round(usdAmount * USD_UZS_APPROX / 1e3) * 1e3);
function formatBioCostMessage(enabled, e) {
  const head = enabled ? "🖼 <b>Sifatli bio rasmi yoqildi</b> (1080×1080)" : "🖼 <b>Oddiy bio rasmi yoqildi</b> (320×320)";
  if (!e) {
    return `${head}

<i>Xarajat hisobini hozir olib bo'lmadi (Apify javob bermadi). Sifatli rasm har yangi so'rovga taxminan $0.0025 qo'shadi.</i>`;
  }
  const basis = `📊 <b>Hisob asosi:</b> oxirgi ${e.windowDays} kunda ${e.paidRuns.toLocaleString("uz-UZ")} ta pullik bio so'rovi (kuniga o'rtacha <b>${Math.round(e.runsPerDay)}</b> ta; keshdagi takroriy so'rovlar kirmaydi).`;
  if (enabled) {
    return `${head}

${basis}

💸 <b>Endi qo'shimcha xarajat:</b>
• har bir so'rovga: <b>+${usd(e.hdPerRunUsd)}</b> (rasm uchun alohida actor)
• kuniga: <b>+${usd(e.hdExtraPerDayUsd)}</b> ≈ ${som(e.hdExtraPerDayUsd)} so'm
• oyiga: <b>+${usd(e.hdExtraPerMonthUsd)}</b> ≈ ${som(e.hdExtraPerMonthUsd)} so'm

📈 <b>Bio yuklash jami:</b>
• oldin: ${usd(e.basePerDayUsd)}/kun (${usd(e.basePerDayUsd * 30)}/oy)
• endi: <b>${usd(e.totalHdPerDayUsd)}/kun</b> (<b>${usd(e.totalHdPerMonthUsd)}/oy</b>)

<i>Yuklashlar ko'paysa, xarajat ham mutanosib oshadi. Kurs taxminiy: 1$ ≈ ${USD_UZS_APPROX.toLocaleString("uz-UZ")} so'm. Daraja: ${e.tier}.</i>`;
  }
  return `${head}

${basis}

💰 <b>Tejaladi:</b>
• kuniga: <b>−${usd(e.hdExtraPerDayUsd)}</b> ≈ ${som(e.hdExtraPerDayUsd)} so'm
• oyiga: <b>−${usd(e.hdExtraPerMonthUsd)}</b> ≈ ${som(e.hdExtraPerMonthUsd)} so'm

📉 Bio yuklash jami: ${usd(e.totalHdPerDayUsd)}/kun → <b>${usd(e.basePerDayUsd)}/kun</b> (${usd(e.totalHdPerMonthUsd)} → <b>${usd(e.basePerDayUsd * 30)}/oy</b>)

<i>Rasm xiraroq (320×320) bo'ladi. Kurs taxminiy: 1$ ≈ ${USD_UZS_APPROX.toLocaleString("uz-UZ")} so'm.</i>`;
}
const bioQuality = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  USD_UZS_APPROX,
  estimateBioCosts,
  formatBioCostMessage,
  isBioHdEnabled,
  setBioHdEnabled
}, Symbol.toStringTag, { value: "Module" }));
const FORWARD_SECRET = process.env.BOT_FORWARD_SECRET || "";
function normalizeUsername(raw) {
  let s = raw.trim();
  const urlMatch = s.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (urlMatch) s = urlMatch[1];
  s = s.replace(/^@/, "").trim();
  s = s.split(/[/?#\s]/)[0];
  if (!/^[A-Za-z0-9_.]{1,30}$/.test(s)) return null;
  if (["p", "reel", "reels", "tv", "stories", "explore", "accounts"].includes(s.toLowerCase())) return null;
  return s;
}
const NOT_FOUND_TTL = 600;
async function fetchInstagramBioData(rawUsername, callerUserId) {
  const username = normalizeUsername(rawUsername);
  if (!username) {
    return { success: false, error: "invalid_username" };
  }
  const cached2 = getCachedBio(username);
  if (cached2) {
    if (cached2.success) trackEvent({ timestamp: Date.now(), type: "bio_downloaded", userId: callerUserId });
    return cached2;
  }
  const startedAt = Date.now();
  const hdEnabled = await isBioHdEnabled();
  const hdPromise = hdEnabled ? fetchHdPicViaApify(username) : Promise.resolve("");
  const viaApify = await fetchBioViaApify(username);
  if (!viaApify.success) {
    const err = viaApify;
    if (err.error === "not_found") {
      const result2 = { success: false, error: "not_found" };
      setCachedBio(username, result2, NOT_FOUND_TTL);
      return result2;
    }
    if (err.error === "not_configured") return { success: false, error: "fetch_failed" };
    return { success: false, error: err.error };
  }
  const waitMs = Math.max(0, 25e3 - (Date.now() - startedAt));
  const hdPic = await Promise.race([hdPromise, new Promise((r) => setTimeout(() => r(""), waitMs))]);
  const result = {
    success: true,
    username: viaApify.username,
    fullName: viaApify.fullName,
    biography: viaApify.biography,
    bioLinks: [],
    externalUrl: viaApify.externalUrl,
    followers: viaApify.followers,
    following: viaApify.following,
    posts: viaApify.posts,
    isPrivate: viaApify.isPrivate,
    isVerified: viaApify.isVerified,
    profilePicUrl: hdPic || viaApify.profilePicUrl
  };
  setCachedBio(username, result);
  if (!hdPic) {
    hdPromise.then((url) => {
      const cur = getCachedBio(username);
      if (url && cur && cur.success) setCachedBio(username, { ...cur, profilePicUrl: url });
    });
  }
  trackEvent({ timestamp: Date.now(), type: "bio_downloaded", userId: callerUserId });
  return result;
}
const handleInstagramBio = async (req, res) => {
  const secret = (req.header("x-forward-secret") || req.header("X-Forward-Secret")) ?? "";
  if (!FORWARD_SECRET || secret !== FORWARD_SECRET) {
    res.status(403).json({ success: false, error: "forbidden" });
    return;
  }
  const rawUsername = req.query.username || "";
  const result = await fetchInstagramBioData(rawUsername);
  if (!result.success) {
    const err = result;
    if (err.error === "invalid_username") {
      res.status(400).json(err);
      return;
    }
    if (err.error === "fetch_failed") {
      res.status(500).json(err);
      return;
    }
    res.json(err);
    return;
  }
  res.json(result);
};
const L10N = {
  uz: { noBio: "Bio kiritilmagan", verified: "Tasdiqlangan akkount", private: "Yopiq akkount" },
  ru: { noBio: "Био не указано", verified: "Подтверждённый аккаунт", private: "Закрытый аккаунт" },
  en: { noBio: "No bio set", verified: "Verified account", private: "Private account" }
};
function escapeHtml$1(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildBioCaption(data, lang) {
  const t = L10N[lang] || L10N.uz;
  const bUsername = escapeHtml$1(data.username);
  const bFullName = escapeHtml$1(data.fullName);
  const bBio = data.biography.trim() ? `<blockquote><code>${escapeHtml$1(data.biography.trim())}</code></blockquote>` : `<i>${t.noBio}</i>`;
  const nameLine = bFullName ? ` (${bFullName})` : "";
  let badges = "";
  if (data.isVerified) badges += `
<tg-emoji emoji-id="5454417301220640047">✅</tg-emoji> ${t.verified}`;
  if (data.isPrivate) badges += `
🔒 ${t.private}`;
  let linkLine = "";
  if (data.externalUrl.trim()) {
    linkLine = `

<tg-emoji emoji-id="5271974997521350631">🔗</tg-emoji> ${escapeHtml$1(data.externalUrl.trim())}`;
  }
  return `<tg-emoji emoji-id="5879770735999717115">👤</tg-emoji> <b>@${bUsername}</b>${nameLine}

<tg-emoji emoji-id="5451636889717062286">✨</tg-emoji> ${bBio}` + badges + linkLine;
}
function mapBioError(error) {
  if (error === "invalid_username" || error === "not_found") return error;
  return "fetch_failed";
}
const handleSendBioToTelegram = async (req, res) => {
  try {
    const user = req.telegramUser;
    if (!user) {
      res.status(401).json({ success: false, error: "unauthorized" });
      return;
    }
    const chatId = Number(user.telegramId);
    if (!chatId) {
      res.status(400).json({ success: false, error: "no_telegram_id" });
      return;
    }
    const rawUsername = req.body?.username || "";
    if (!rawUsername.trim()) {
      res.status(400).json({ success: false, error: "invalid_username" });
      return;
    }
    const bioResult = await fetchInstagramBioData(rawUsername, String(user.telegramId));
    if (!bioResult.success) {
      const err = bioResult;
      res.status(err.error === "invalid_username" ? 400 : 200).json({
        success: false,
        error: mapBioError(err.error)
      });
      return;
    }
    const bio = bioResult;
    const caption = buildBioCaption(bio, user.language || "uz");
    const usePhp = phpBot.isReady();
    let delivered = false;
    if (bio.profilePicUrl) {
      if (usePhp) {
        const r = await phpBot.sendPhoto(chatId, bio.profilePicUrl, { caption }).catch(() => null);
        delivered = !!r;
      } else {
        const b = getSellerBot() || getBot();
        if (b) {
          delivered = await b.sendPhoto(chatId, bio.profilePicUrl, { caption, parse_mode: "HTML" }).then(() => true).catch(() => false);
        }
      }
    }
    if (!delivered) {
      if (usePhp) {
        await phpBot.sendMessage(chatId, caption).catch(() => {
        });
      } else {
        const b = getSellerBot() || getBot();
        if (b) await b.sendMessage(chatId, caption, { parse_mode: "HTML" }).catch(() => {
        });
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error("handleSendBioToTelegram error:", error);
    res.status(500).json({ success: false, error: "server_error" });
  }
};
const APIFY_TOKEN = process.env.APIFY_API_TOKEN || "";
const APIFY_ACTOR = "apify~instagram-reel-scraper";
const APIFY_TIMEOUT_MS = 27e3;
function isApifyReelConfigured() {
  return !!APIFY_TOKEN;
}
async function fetchReelViaApify(url, timeoutMs = APIFY_TIMEOUT_MS) {
  if (!APIFY_TOKEN) return { success: false, error: "not_configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: [url] }),
        signal: controller.signal
      }
    );
    clearTimeout(timer);
    if (!res.ok) return { success: false, error: `upstream_${res.status}` };
    const data = await res.json().catch(() => null);
    const item = Array.isArray(data) ? data[0] : null;
    if (!item || item.error) return { success: false, error: "not_found" };
    const taggedFromOverlay = Array.isArray(item.taggedUsers) ? item.taggedUsers.map((u) => String(u?.username || "").trim().toLowerCase()) : [];
    const taggedFromMentions = Array.isArray(item.mentions) ? item.mentions.map((u) => String(u || "").trim().toLowerCase()) : [];
    const taggedFromCoauthors = Array.isArray(item.coauthorProducers) ? item.coauthorProducers.map((u) => String(u?.username || "").trim().toLowerCase()) : [];
    const taggedFromCaption = (String(item.caption || "").match(/@([A-Za-z0-9._]{1,30})/g) || []).map(
      (m) => m.slice(1).replace(/\.+$/, "").toLowerCase()
    );
    const taggedUsernames = Array.from(
      new Set([...taggedFromOverlay, ...taggedFromMentions, ...taggedFromCoauthors, ...taggedFromCaption].filter(Boolean))
    );
    return {
      success: true,
      shortCode: String(item.shortCode || item.id || "").trim(),
      caption: String(item.caption || "").trim(),
      ownerUsername: String(item.ownerUsername || "").trim(),
      viewCount: Number(item.videoViewCount ?? item.videoPlayCount ?? 0) || 0,
      likesCount: Math.max(0, Number(item.likesCount) || 0),
      commentsCount: Math.max(0, Number(item.commentsCount) || 0),
      postedAt: item.timestamp && !isNaN(Date.parse(item.timestamp)) ? new Date(item.timestamp) : null,
      taggedUsernames
    };
  } catch (error) {
    clearTimeout(timer);
    console.error("apify-reel error:", error instanceof Error ? error.message : error);
    return { success: false, error: "fetch_failed" };
  }
}
const TARGET_USERNAME_KEY = "tag_campaign_target_username";
const REWARD_TIERS_KEY = "tag_campaign_reward_tiers";
const DEFAULT_TARGET_USERNAME = "top_sxema_rek67";
let _usernameCache = null;
let _usernameCachedAt = 0;
let _tiersCache = null;
let _tiersCachedAt = 0;
const TTL_MS = 60 * 1e3;
async function getTagTargetUsername() {
  const now = Date.now();
  if (_usernameCache !== null && now - _usernameCachedAt < TTL_MS) return _usernameCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: TARGET_USERNAME_KEY } });
    _usernameCache = (row?.value || DEFAULT_TARGET_USERNAME).replace(/^@/, "").trim().toLowerCase();
  } catch {
    _usernameCache = DEFAULT_TARGET_USERNAME;
  }
  _usernameCachedAt = now;
  return _usernameCache;
}
async function setTagTargetUsername(username) {
  const clean = username.replace(/^@/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(clean)) {
    throw new Error("Noto'g'ri username formati");
  }
  await prisma.setting.upsert({
    where: { key: TARGET_USERNAME_KEY },
    update: { value: clean },
    create: { key: TARGET_USERNAME_KEY, value: clean }
  });
  _usernameCache = clean;
  _usernameCachedAt = Date.now();
}
async function getRewardTiers() {
  const now = Date.now();
  if (_tiersCache !== null && now - _tiersCachedAt < TTL_MS) return _tiersCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: REWARD_TIERS_KEY } });
    const parsed = row ? JSON.parse(row.value) : [];
    _tiersCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    _tiersCache = [];
  }
  _tiersCachedAt = now;
  return _tiersCache;
}
function parseRewardTiersInput(raw) {
  const tiers = raw.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [viewsStr, rewardStr] = part.split(":").map((s) => s.trim());
    const views = parseInt(viewsStr, 10);
    const reward = parseInt(rewardStr, 10);
    if (!Number.isFinite(views) || views <= 0 || !Number.isFinite(reward) || reward <= 0) {
      throw new Error(`Noto'g'ri format: "${part}" (kutilgan: views:reward)`);
    }
    return { views, reward };
  });
  tiers.sort((a, b) => a.views - b.views);
  return tiers;
}
async function setRewardTiers(tiers) {
  const value = JSON.stringify(tiers);
  await prisma.setting.upsert({
    where: { key: REWARD_TIERS_KEY },
    update: { value },
    create: { key: REWARD_TIERS_KEY, value }
  });
  _tiersCache = tiers;
  _tiersCachedAt = Date.now();
}
function formatRewardTiers(tiers) {
  if (tiers.length === 0) return "(sozlanmagan)";
  const fmt = (n) => new Intl.NumberFormat("uz-UZ").format(n);
  return tiers.map((t) => `• ${fmt(t.views)} prosmotr → ${fmt(t.reward)} so'm`).join("\n");
}
function makeTierStore(settingKey) {
  let cache2 = null;
  let cachedAt = 0;
  return {
    async get() {
      const now = Date.now();
      if (cache2 !== null && now - cachedAt < TTL_MS) return cache2;
      try {
        const row = await prisma.setting.findUnique({ where: { key: settingKey } });
        const parsed = row ? JSON.parse(row.value) : [];
        cache2 = Array.isArray(parsed) ? parsed : [];
      } catch {
        cache2 = [];
      }
      cachedAt = now;
      return cache2;
    },
    async set(tiers) {
      const value = JSON.stringify(tiers);
      await prisma.setting.upsert({
        where: { key: settingKey },
        update: { value },
        create: { key: settingKey, value }
      });
      cache2 = tiers;
      cachedAt = Date.now();
    }
  };
}
const csgoStore = makeTierStore("tag_campaign_csgo_reward_tiers");
const csgoTagStore = makeTierStore("tag_campaign_csgo_tag_reward_tiers");
const getCsgoRewardTiers = csgoStore.get;
const setCsgoRewardTiers = csgoStore.set;
const getCsgoTagRewardTiers = csgoTagStore.get;
const setCsgoTagRewardTiers = csgoTagStore.set;
const HOUR = 60 * 60 * 1e3;
const DAY = 24 * HOUR;
const TICK_MS = 30 * 60 * 1e3;
const TICK_SLACK_MS = 15 * 60 * 1e3;
const BATCH_SIZE = 200;
const UPSTREAM_PAUSE_MS = 60 * 60 * 1e3;
const CRON_APIFY_TIMEOUT_MS = 75e3;
const UPSTREAM_MAX_CONSECUTIVE_FAILS = 5;
let upstreamPausedUntil = 0;
const CHECK_SCHEDULE = [
  [0, 6 * HOUR],
  //       1-kun: 4 marta
  [1 * DAY, 8 * HOUR],
  //  2-kun: 3 marta
  [2 * DAY, 12 * HOUR],
  // 3-kun: 2 marta
  [3 * DAY, 24 * HOUR],
  // 4-kun: 1 marta
  [4 * DAY, 72 * HOUR]
  // 5–30-kun: har 3 kunda 1 marta
];
const TRACKING_DAYS = 30;
const REMOVED_CHECK_MS = DAY;
const REMOVED_GRACE_MS = 2 * DAY;
const trackingStart = (s) => (s.approvedAt ?? s.createdAt).getTime();
function checkIntervalMs(s) {
  if (s.status === "TAG_REMOVED") return REMOVED_CHECK_MS;
  const age = Date.now() - trackingStart(s);
  return [...CHECK_SCHEDULE].reverse().find(([from]) => age >= from)[1];
}
const fmtUZS = (n) => new Intl.NumberFormat("uz-UZ").format(n);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MIN_ENGAGEMENT_RATE = 3e-3;
const ENGAGEMENT_MIN_VIEWS = 2e3;
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => parseInt(id.trim())).filter((n) => !isNaN(n) && n > 0);
async function notifyAdminsOfSuspiciousViews(submission, reel, heldReward) {
  const bot2 = getBot();
  if (!bot2) return;
  const u = submission.user;
  const rate = (reel.likesCount + reel.commentsCount) / Math.max(1, reel.viewCount) * 100;
  const text = `🚩 <b>Shubhali prosmotr — to'lov ushlab turildi</b> (#${submission.id})

👤 Foydalanuvchi: ${esc(u.firstName || "Nomsiz")}${u.username ? ` (@${esc(u.username)})` : ""} · <code>${u.telegramId}</code>
🎬 Video egasi: @${esc(reel.ownerUsername || "—")}
👁 ${fmtUZS(reel.viewCount)} prosmotr · ❤️ ${fmtUZS(reel.likesCount)} layk · 💬 ${fmtUZS(reel.commentsCount)} izoh
📉 Faollik: <b>${rate.toFixed(2)}%</b> (me'yor ≥ ${MIN_ENGAGEMENT_RATE * 100}%)
💰 Ushlangan to'lov: <b>${fmtUZS(heldReward)}</b> so'm

🔗 ${esc(submission.videoUrl)}

<i>Videoni ko'rib chiqing: haqiqiy bo'lsa — to'lang, nakrutka bo'lsa — rad eting.</i>`;
  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ To'lash", callback_data: `tagrev:pay:${submission.id}` },
      { text: "🚫 Rad etish (nakrutka)", callback_data: `tagrev:reject:${submission.id}` }
    ]]
  };
  for (const adminId of ADMIN_IDS) {
    await bot2.sendMessage(adminId, text, { parse_mode: "HTML", reply_markup, disable_web_page_preview: true }).catch(() => {
    });
  }
}
async function notifyUser(telegramId, text) {
  const chatId = Number(telegramId);
  if (!chatId) return;
  if (phpBot.isReady()) {
    await phpBot.sendMessage(chatId, text).catch(() => {
    });
  } else {
    const b = getSellerBot() || getBot();
    if (b) await b.sendMessage(chatId, text, { parse_mode: "HTML" }).catch(() => {
    });
  }
}
async function checkOneSubmission(submissionId) {
  const submission = await prisma.tagSubmission.findUnique({
    where: { id: submissionId },
    include: { user: true }
  });
  if (!submission || submission.status !== "ACTIVE" && submission.status !== "TAG_REMOVED") return "skipped";
  const reel = await fetchReelViaApify(submission.videoUrl, CRON_APIFY_TIMEOUT_MS);
  if (!reel.success) {
    if (reel.error !== "not_found") {
      console.warn(`[tag-campaign-cron] #${submission.id} Apify xatosi: ${reel.error}`);
      return "upstream_failed";
    }
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { lastCheckedAt: /* @__PURE__ */ new Date(), checksCount: { increment: 1 } }
    });
    return "skipped";
  }
  const requiresTag = submission.method !== "CSGO";
  const stillTagged = !requiresTag || reel.taggedUsernames.includes(submission.targetUsername);
  if (submission.status === "TAG_REMOVED") {
    if (!stillTagged) {
      const removedAt = (submission.tagRemovedAt ?? submission.lastCheckedAt).getTime();
      if (Date.now() - removedAt >= REMOVED_GRACE_MS - TICK_SLACK_MS) {
        await prisma.tagSubmission.delete({ where: { id: submission.id } });
        await notifyUser(
          submission.user.telegramId,
          `🗑 <b>Video ro'yxatdan o'chirildi</b>

Atmetka 2 kun ichida qaytarilmadi, shu sabab video kuzatuvdan olib tashlandi.

${submission.videoUrl}`
        );
      } else {
        await prisma.tagSubmission.update({
          where: { id: submission.id },
          data: { viewCount: reel.viewCount, lastCheckedAt: /* @__PURE__ */ new Date(), checksCount: { increment: 1 } }
        });
      }
      return;
    }
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { status: "ACTIVE", tagRemovedAt: null }
    });
    await notifyUser(
      submission.user.telegramId,
      `✅ <b>Atmetka qaytdi</b>

Videongiz yana faol, prosmotr kuzatuvi davom etadi.

${submission.videoUrl}`
    );
  } else if (!stillTagged) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: {
        status: "TAG_REMOVED",
        tagRemovedAt: /* @__PURE__ */ new Date(),
        viewCount: reel.viewCount,
        lastCheckedAt: /* @__PURE__ */ new Date(),
        checksCount: { increment: 1 }
      }
    });
    await notifyUser(
      submission.user.telegramId,
      `⚠️ <b>Atmetka olib tashlandi</b>

Videongizdan atmetka o'chirilgani aniqlandi — video <b>Noaktiv</b> holatiga o'tdi va to'lovlar to'xtatildi.

2 kun ichida atmetkani qaytarsangiz, kuzatuv davom etadi. Aks holda video ro'yxatdan o'chiriladi.

${submission.videoUrl}`
    );
    return;
  }
  const tiers = Array.isArray(submission.rewardTiers) ? submission.rewardTiers : [];
  const paidTiers = Array.isArray(submission.paidTiers) ? submission.paidTiers : [];
  const newlyReached = tiers.filter(
    (t) => reel.viewCount >= t.views && !paidTiers.includes(t.views)
  );
  if (newlyReached.length === 0) {
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: { viewCount: reel.viewCount, lastCheckedAt: /* @__PURE__ */ new Date(), checksCount: { increment: 1 } }
    });
    return;
  }
  const totalReward = newlyReached.reduce((sum, t) => sum + t.reward, 0);
  const engagement = (reel.likesCount + reel.commentsCount) / Math.max(1, reel.viewCount);
  if (!submission.viewsTrusted && reel.viewCount >= ENGAGEMENT_MIN_VIEWS && engagement < MIN_ENGAGEMENT_RATE) {
    const firstHold = !submission.reviewHeldAt;
    await prisma.tagSubmission.update({
      where: { id: submission.id },
      data: {
        viewCount: reel.viewCount,
        lastCheckedAt: /* @__PURE__ */ new Date(),
        checksCount: { increment: 1 },
        ...firstHold ? { reviewHeldAt: /* @__PURE__ */ new Date() } : {}
      }
    });
    if (firstHold) await notifyAdminsOfSuspiciousViews(submission, reel, totalReward);
    return;
  }
  const allPaidNow = [...paidTiers, ...newlyReached.map((t) => t.views)];
  const isCompleted = tiers.every((t) => allPaidNow.includes(t.views));
  await prisma.$transaction(async (tx) => {
    let wallet2 = await tx.wallet.findUnique({ where: { userId: submission.userId } });
    if (!wallet2) {
      wallet2 = await tx.wallet.create({
        data: { userId: submission.userId, balance: 0, frozenBalance: 0, totalEarned: 0 }
      });
    }
    await tx.wallet.update({
      where: { id: wallet2.id },
      data: { balance: { increment: totalReward }, totalEarned: { increment: totalReward } }
    });
    await tx.transaction.create({
      data: {
        walletId: wallet2.id,
        type: "TAG_REWARD",
        amount: totalReward,
        status: "COMPLETED",
        note: `Atmetka: ${newlyReached.map((t) => `${fmtUZS(t.views)} prosmotr`).join(", ")}`
      }
    });
    await tx.tagSubmission.update({
      where: { id: submission.id },
      data: {
        viewCount: reel.viewCount,
        lastCheckedAt: /* @__PURE__ */ new Date(),
        checksCount: { increment: 1 },
        paidTiers: allPaidNow,
        totalPaid: { increment: totalReward },
        status: isCompleted ? "COMPLETED" : "ACTIVE"
      }
    });
  });
  await notifyUser(
    submission.user.telegramId,
    `💰 <b>Atmetka mukofoti!</b>

Videongiz ${fmtUZS(reel.viewCount)} prosmotrga yetdi.
📥 +${fmtUZS(totalReward)} so'm hisobingizga qo'shildi.

` + (isCompleted ? "✅ Barcha bosqichlar tugallandi." : "_Tekshiruv davom etadi._")
  );
}
async function runTick() {
  const candidates = await prisma.tagSubmission.findMany({
    where: { status: { in: ["ACTIVE", "TAG_REMOVED"] } },
    orderBy: { lastCheckedAt: "asc" },
    select: { id: true, status: true, createdAt: true, approvedAt: true, lastCheckedAt: true }
  });
  const now = Date.now();
  if (now < upstreamPausedUntil) return;
  const isExpired = (s) => s.status === "ACTIVE" && now - trackingStart(s) >= TRACKING_DAYS * DAY;
  const due = candidates.filter((s) => isExpired(s) || now - s.lastCheckedAt.getTime() >= checkIntervalMs(s) - TICK_SLACK_MS).slice(0, BATCH_SIZE);
  let consecutiveFails = 0;
  for (const s of due) {
    try {
      const result = await checkOneSubmission(s.id);
      if (result === "upstream_failed") {
        if (++consecutiveFails >= UPSTREAM_MAX_CONSECUTIVE_FAILS) {
          upstreamPausedUntil = Date.now() + UPSTREAM_PAUSE_MS;
          console.warn(`[tag-campaign-cron] ketma-ket ${consecutiveFails} ta Apify xatosi — tsikl to'xtatildi, 1 soatdan keyin qayta uriniladi`);
          break;
        }
        continue;
      }
      consecutiveFails = 0;
      if (result === "ok" && isExpired(s)) {
        await prisma.tagSubmission.updateMany({ where: { id: s.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
      }
    } catch (e) {
      console.warn(`[tag-campaign-cron] submission #${s.id} fail:`, e instanceof Error ? e.message : e);
    }
  }
}
let started = false;
let running = false;
function tick() {
  if (running) return;
  running = true;
  runTick().catch((e) => console.error("tag-campaign-cron tick error:", e)).finally(() => {
    running = false;
  });
}
function startTagCampaignCron() {
  if (started) return;
  started = true;
  console.log("🏷 Atmetka kampaniyasi cron: 1-kun 4×, 2-kun 3×, 3-kun 2×, 4-kun 1×, keyin har 3 kunda; 30 kunda tugaydi");
  setTimeout(tick, 3e4);
  setInterval(tick, TICK_MS);
}
const tagCampaignCron = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  checkIntervalMs,
  checkOneSubmission,
  startTagCampaignCron
}, Symbol.toStringTag, { value: "Module" }));
function isInstagramVideoUrl(raw) {
  return /instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/i.test(raw.trim());
}
const checkCache = new NodeCache({ stdTTL: 120, checkperiod: 60, useClones: false });
async function hasPendingSubmission(userId) {
  const row = await prisma.tagSubmission.findFirst({ where: { userId, status: "PENDING_REVIEW" }, select: { id: true } });
  return !!row;
}
const MAX_VIDEO_AGE_MS = 30 * 60 * 1e3;
function isTooOld(reel) {
  return !!reel.postedAt && Date.now() - reel.postedAt.getTime() > MAX_VIDEO_AGE_MS;
}
const submittingUsers = /* @__PURE__ */ new Set();
function withSingleSubmission(handler) {
  return async (req, res, next) => {
    const userId = req.pgUser.id;
    if (submittingUsers.has(userId) || await hasPendingSubmission(userId)) {
      res.status(409).json({ success: false, error: "pending_review" });
      return;
    }
    submittingUsers.add(userId);
    try {
      await handler(req, res, next);
    } finally {
      submittingUsers.delete(userId);
    }
  };
}
const handleCheckTagVideo = async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url || !isInstagramVideoUrl(url)) {
      res.status(400).json({ success: false, error: "invalid_url" });
      return;
    }
    if (req.pgUser && await hasPendingSubmission(req.pgUser.id)) {
      res.status(409).json({ success: false, error: "pending_review" });
      return;
    }
    if (!isApifyReelConfigured()) {
      res.status(500).json({ success: false, error: "not_configured" });
      return;
    }
    const targetUsername = await getTagTargetUsername();
    let reel = checkCache.get(url);
    if (!reel) {
      reel = await fetchReelViaApify(url);
      if (reel.success) checkCache.set(url, reel, reel.taggedUsernames.includes(targetUsername) ? 120 : 15);
    }
    if (!reel.success) {
      res.json({ success: false, error: reel.error });
      return;
    }
    if (isTooOld(reel)) {
      res.status(400).json({ success: false, error: "too_old" });
      return;
    }
    const tagged = reel.taggedUsernames.includes(targetUsername);
    if (!tagged) {
      console.log(`[tag-check] topilmadi ${reel.shortCode} owner=@${reel.ownerUsername} kerak=@${targetUsername} topilgan=${JSON.stringify(reel.taggedUsernames)}`);
    }
    const existing = await prisma.tagSubmission.findUnique({ where: { shortCode: reel.shortCode } });
    res.json({
      success: true,
      videoName: reel.caption ? reel.caption.slice(0, 140) : reel.shortCode,
      viewCount: reel.viewCount,
      ownerUsername: reel.ownerUsername,
      tagged,
      targetUsername,
      // Videoda topilgan atmetkalar — mijoz imloviy xatoni (masalan rek25) o'zi ko'rsin.
      foundTags: reel.taggedUsernames.slice(0, 6),
      alreadySubmitted: !!existing
    });
  } catch (error) {
    console.error("handleCheckTagVideo error:", error);
    res.status(500).json({ success: false, error: "server_error" });
  }
};
const handleSubmitTagVideo = withSingleSubmission(async (req, res) => {
  try {
    const pgUser = req.pgUser;
    const url = String(req.body?.url || "").trim();
    if (!url || !isInstagramVideoUrl(url)) {
      res.status(400).json({ success: false, error: "invalid_url" });
      return;
    }
    const targetUsername = await getTagTargetUsername();
    const rewardTiers = await getRewardTiers();
    if (rewardTiers.length === 0) {
      res.status(400).json({ success: false, error: "not_configured" });
      return;
    }
    let reel = checkCache.get(url);
    if (!reel) {
      reel = await fetchReelViaApify(url);
    }
    if (!reel.success) {
      res.json({ success: false, error: reel.error });
      return;
    }
    if (isTooOld(reel)) {
      res.status(400).json({ success: false, error: "too_old" });
      return;
    }
    if (!reel.taggedUsernames.includes(targetUsername)) {
      res.status(400).json({ success: false, error: "not_tagged" });
      return;
    }
    const existing = await prisma.tagSubmission.findUnique({ where: { shortCode: reel.shortCode } });
    if (existing) {
      res.status(409).json({ success: false, error: "already_submitted" });
      return;
    }
    const submission = await prisma.tagSubmission.create({
      data: {
        userId: pgUser.id,
        videoUrl: url,
        shortCode: reel.shortCode,
        caption: reel.caption.slice(0, 500),
        targetUsername,
        method: "TAG_ONLY",
        // Oddiy atmetka ham endi admin tasdig'idan keyingina kuzatuvga tushadi.
        status: "PENDING_REVIEW",
        rewardTiers,
        viewCount: reel.viewCount
      }
    });
    notifyAdminsOfTagSubmission(submission.id, "TAG_ONLY", reel, url, pgUser).catch(
      (e) => console.warn("notifyAdminsOfTagSubmission failed:", e instanceof Error ? e.message : e)
    );
    res.json({ success: true, id: submission.id });
  } catch (error) {
    console.error("handleSubmitTagVideo error:", error);
    res.status(500).json({ success: false, error: "server_error" });
  }
});
const handleListMyTagSubmissions = async (req, res) => {
  try {
    const pgUser = req.pgUser;
    const submissions2 = await prisma.tagSubmission.findMany({
      where: { userId: pgUser.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    res.json({
      success: true,
      submissions: submissions2.map((s) => ({
        id: s.id,
        videoUrl: s.videoUrl,
        caption: s.caption,
        viewCount: s.viewCount,
        status: s.status,
        totalPaid: s.totalPaid,
        rewardTiers: s.rewardTiers,
        paidTiers: s.paidTiers,
        createdAt: s.createdAt,
        // Keyingi prosmotr tekshiruvi (faqat kuzatuvdagi videolar uchun).
        nextCheckAt: s.status === "ACTIVE" || s.status === "TAG_REMOVED" ? new Date(s.lastCheckedAt.getTime() + checkIntervalMs(s)).toISOString() : null
      }))
    });
  } catch (error) {
    console.error("handleListMyTagSubmissions error:", error);
    res.status(500).json({ success: false, error: "server_error" });
  }
};
const handleGetTagCampaignConfig = async (_req, res) => {
  try {
    const targetUsername = await getTagTargetUsername();
    const rewardTiers = await getRewardTiers();
    res.json({ success: true, targetUsername, rewardTiers, enabled: rewardTiers.length > 0 });
  } catch (error) {
    console.error("handleGetTagCampaignConfig error:", error);
    res.status(500).json({ success: false, error: "server_error" });
  }
};
const handleGetCsgoConfig = async (_req, res) => {
  try {
    const [csgoTiers, csgoTagTiers] = await Promise.all([getCsgoRewardTiers(), getCsgoTagRewardTiers()]);
    res.json({
      success: true,
      csgoTiers,
      csgoTagTiers,
      csgoEnabled: csgoTiers.length > 0,
      csgoTagEnabled: csgoTagTiers.length > 0
    });
  } catch (error) {
    console.error("handleGetCsgoConfig error:", error);
    res.status(500).json({ success: false, error: "server_error" });
  }
};
const handleCsgoSubmit = withSingleSubmission(async (req, res) => {
  try {
    const pgUser = req.pgUser;
    const url = String(req.body?.url || "").trim();
    const method = req.body?.method === "CSGO_TAG" ? "CSGO_TAG" : req.body?.method === "CSGO" ? "CSGO" : null;
    if (!method) {
      res.status(400).json({ success: false, error: "invalid_method" });
      return;
    }
    if (!url || !isInstagramVideoUrl(url)) {
      res.status(400).json({ success: false, error: "invalid_url" });
      return;
    }
    const tiers = method === "CSGO_TAG" ? await getCsgoTagRewardTiers() : await getCsgoRewardTiers();
    if (tiers.length === 0) {
      res.status(400).json({ success: false, error: "not_configured" });
      return;
    }
    let reel = checkCache.get(url);
    if (!reel) reel = await fetchReelViaApify(url);
    if (!reel.success) {
      res.json({ success: false, error: reel.error });
      return;
    }
    if (isTooOld(reel)) {
      res.status(400).json({ success: false, error: "too_old" });
      return;
    }
    const targetUsername = await getTagTargetUsername();
    if (method === "CSGO_TAG" && !reel.taggedUsernames.includes(targetUsername)) {
      res.status(400).json({ success: false, error: "not_tagged" });
      return;
    }
    const existing = await prisma.tagSubmission.findUnique({ where: { shortCode: reel.shortCode } });
    if (existing) {
      res.status(409).json({ success: false, error: "already_submitted" });
      return;
    }
    const submission = await prisma.tagSubmission.create({
      data: {
        userId: pgUser.id,
        videoUrl: url,
        shortCode: reel.shortCode,
        caption: reel.caption.slice(0, 500),
        targetUsername,
        method,
        status: "PENDING_REVIEW",
        rewardTiers: tiers,
        viewCount: reel.viewCount
      }
    });
    notifyAdminsOfTagSubmission(submission.id, method, reel, url, pgUser).catch(
      (e) => console.warn("notifyAdminsOfTagSubmission failed:", e instanceof Error ? e.message : e)
    );
    res.json({ success: true, id: submission.id });
  } catch (error) {
    console.error("handleCsgoSubmit error:", error);
    res.status(500).json({ success: false, error: "server_error" });
  }
});
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtNum = (n) => new Intl.NumberFormat("uz-UZ").format(n);
async function notifyAdminsOfTagSubmission(submissionId, method, reel, url, pgUser) {
  const bot2 = getBot();
  const adminIds = getAdminTelegramIds();
  if (!bot2 || adminIds.length === 0) return;
  const target = await getTagTargetUsername();
  const tagLine = method === "CSGO" ? `🏷 Atmetka: shart emas (CS GO)` : reel.taggedUsernames.includes(target) ? `🏷 Atmetka: ✅ topildi — caption'da @${escapeHtml(target)} yozilgan` : `🏷 Atmetka: ❌ topilmadi`;
  const label = method === "CSGO_TAG" ? "CS GO + Atmetka" : method === "CSGO" ? "CS GO" : "Oddiy atmetka";
  const who = pgUser.username ? `@${pgUser.username}` : pgUser.firstName || String(pgUser.telegramId);
  const text = `🏷 <b>Yangi topshiruv: ${label}</b>

👤 Telegram: ${escapeHtml(who)} (<code>${pgUser.telegramId}</code>)
🎬 Video egasi (Instagram): <b>@${escapeHtml(reel.ownerUsername || "—")}</b>
👁 Hozirgi prosmotr: ${fmtNum(reel.viewCount)}
${tagLine}
🆔 <code>#${submissionId}</code>

${reel.caption ? escapeHtml(reel.caption.slice(0, 200)) + "\n\n" : ""}${escapeHtml(url)}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ Tasdiqlash", callback_data: `csgo_review:approve:${submissionId}` },
        { text: "❌ Bekor qilish", callback_data: `csgo_review:reject:${submissionId}` }
      ]
    ]
  };
  for (const adminId of adminIds) {
    try {
      await bot2.sendMessage(adminId, text, { parse_mode: "HTML", reply_markup });
    } catch {
    }
  }
}
async function retryOnUniqueRace(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.code === "P2002") return fn();
    throw e;
  }
}
async function syncUserToPrisma(sqliteUser) {
  const telegramId = BigInt(sqliteUser.telegramId);
  const pgUser = await retryOnUniqueRace(
    () => prisma.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        firstName: sqliteUser.firstName,
        lastName: sqliteUser.lastName || "",
        username: sqliteUser.username || "",
        photoUrl: sqliteUser.photoUrl || "",
        // Prisma `Language` enum faqat uz/ru/en — Telegram'dan boshqa til
        // kodi (masalan "tr") kelsa upsert ValidationError bilan yiqilib,
        // shu foydalanuvchi uchun barcha marketplace so'rovlari 500 bergan.
        language: ["uz", "ru", "en"].includes(sqliteUser.language) ? sqliteUser.language : "uz"
      },
      update: {
        firstName: sqliteUser.firstName,
        lastName: sqliteUser.lastName || "",
        username: sqliteUser.username || "",
        photoUrl: sqliteUser.photoUrl || "",
        lastSeen: /* @__PURE__ */ new Date()
      }
    })
  );
  await retryOnUniqueRace(
    () => prisma.wallet.upsert({
      where: { userId: pgUser.id },
      create: { userId: pgUser.id, balance: 0 },
      update: {}
    })
  );
  return pgUser;
}
async function pgUserMiddleware(req, res, next) {
  try {
    if (!req.telegramUser) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    const pgUser = await syncUserToPrisma(req.telegramUser);
    if (pgUser.bannedUntil && pgUser.bannedUntil > /* @__PURE__ */ new Date()) {
      const until = pgUser.bannedUntil.toLocaleString("ru-RU", {
        timeZone: "Asia/Tashkent",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      res.status(403).json({
        success: false,
        code: "banned",
        bannedUntil: pgUser.bannedUntil.toISOString(),
        error: `Hisobingiz ${until} gacha bloklangan${pgUser.banReason ? `: ${pgUser.banReason}` : ""}.`
      });
      return;
    }
    req.pgUser = pgUser;
    next();
  } catch (err) {
    console.error("pgUserMiddleware error:", err);
    res.status(500).json({ success: false, error: "User sync failed" });
  }
}
async function adminMiddleware(req, res, next) {
  try {
    if (!req.pgUser) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => BigInt(s));
    const isAdmin2 = req.pgUser.role === "ADMIN" || adminIds.includes(req.pgUser.telegramId);
    if (!isAdmin2) {
      res.status(403).json({ success: false, error: "Admin access required" });
      return;
    }
    if (req.pgUser.role !== "ADMIN") {
      await prisma.user.update({
        where: { id: req.pgUser.id },
        data: { role: "ADMIN" }
      });
      req.pgUser.role = "ADMIN";
    }
    next();
  } catch (err) {
    console.error("adminMiddleware error:", err);
    res.status(500).json({ success: false, error: "Admin check failed" });
  }
}
const instagramLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 daqiqa
  max: 100,
  // Har bir IP uchun maksimal 100 ta so'rov
  message: {
    success: false,
    caption: "",
    error: "Too many requests. Please try again later."
  },
  standardHeaders: true,
  legacyHeaders: false
});
function createServer() {
  const app2 = express__default();
  app2.set("trust proxy", 1);
  app2.use(cors());
  app2.use(express__default.json({ limit: "30mb" }));
  app2.use(express__default.urlencoded({ extended: true, limit: "30mb" }));
  app2.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });
  app2.get("/api/demo", handleDemo);
  app2.post("/api/auth/validate", authMiddleware, handleAuthValidate);
  app2.get("/api/user/profile", authMiddleware, handleGetProfile);
  app2.get("/api/user/history", authMiddleware, handleGetHistory);
  app2.delete("/api/user/history/:id", authMiddleware, handleDeleteHistory);
  app2.post("/api/instagram-caption", instagramLimiter, optionalAuthMiddleware, handleInstagramCaption);
  app2.post("/api/instagram-scrape", instagramLimiter, handleInstagramScrape);
  app2.post("/api/track-event", handleTrackEvent);
  app2.post("/api/upload-image", authMiddleware, pgUserMiddleware, handleUploadImage);
  app2.get("/api/files/:fileId", handleGetFile);
  app2.get("/api/weekly-hashtag", handleGetWeeklyHashtag);
  app2.post("/api/bot-forward", handleBotForward);
  app2.post("/api/bot-forward/text", handleBotForwardText);
  app2.get("/api/instagram-bio", handleInstagramBio);
  app2.post("/api/bio/send-telegram", authMiddleware, handleSendBioToTelegram);
  app2.post("/api/marketplace/preview-submit", handlePreviewSubmitAccount);
  app2.get("/api/marketplace/accounts", handleListAccounts);
  app2.get("/api/marketplace/accounts/:id", handleGetAccount);
  app2.post("/api/marketplace/accounts", authMiddleware, pgUserMiddleware, handleCreateAccount);
  app2.get("/api/marketplace/my/accounts", authMiddleware, pgUserMiddleware, handleListMyAccounts);
  app2.put("/api/marketplace/my/accounts/:id", authMiddleware, pgUserMiddleware, handleUpdateMyAccount);
  app2.post("/api/marketplace/my/accounts/:id/edit-request", authMiddleware, pgUserMiddleware, handleRequestAccountEdit);
  app2.post("/api/marketplace/orders", authMiddleware, pgUserMiddleware, handleCreateOrder);
  app2.post("/api/marketplace/orders/:id/pay", authMiddleware, pgUserMiddleware, handleMockPayOrder);
  app2.post("/api/marketplace/orders/:id/accept", authMiddleware, pgUserMiddleware, handleAcceptOrder);
  app2.post("/api/marketplace/orders/:id/posted", authMiddleware, pgUserMiddleware, handleMarkPosted);
  app2.post("/api/marketplace/orders/:id/complete", authMiddleware, pgUserMiddleware, handleCompleteOrder);
  app2.post("/api/marketplace/orders/:id/dispute", authMiddleware, pgUserMiddleware, handleDisputeOrder);
  app2.post("/api/marketplace/orders/:id/cancel", authMiddleware, pgUserMiddleware, handleCancelOrder);
  app2.get("/api/marketplace/my/orders", authMiddleware, pgUserMiddleware, handleListMyOrders);
  app2.get("/api/marketplace/wallet", authMiddleware, pgUserMiddleware, handleGetWallet);
  app2.post("/api/marketplace/wallet/topup", authMiddleware, pgUserMiddleware, handleCreateTopup);
  app2.post("/api/marketplace/wallet/topup/checkout", authMiddleware, pgUserMiddleware, handleCreateTopupCheckout);
  app2.post("/api/marketplace/wallet/topup/checkout/:id/check", authMiddleware, pgUserMiddleware, handleCheckTopupCheckout);
  app2.post("/api/marketplace/wallet/topup/stars", authMiddleware, pgUserMiddleware, handleCreateTopupStars);
  app2.post("/api/marketplace/wallet/topup/stars/:id/check", authMiddleware, pgUserMiddleware, handleCheckTopupStars);
  app2.post("/api/marketplace/wallet/payout", authMiddleware, pgUserMiddleware, handleRequestPayout);
  app2.get("/api/marketplace/admin/accounts/pending", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminListPendingAccounts);
  app2.post("/api/marketplace/admin/accounts/:id/verify", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminVerifyAccount);
  app2.get("/api/marketplace/admin/payouts", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminListPayouts);
  app2.post("/api/marketplace/admin/payouts/:id/approve", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminApprovePayout);
  app2.post("/api/marketplace/admin/payouts/:id/reject", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminRejectPayout);
  app2.get("/api/marketplace/admin/disputes", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminListDisputes);
  app2.post("/api/marketplace/admin/disputes/:id/resolve", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminResolveDispute);
  app2.get("/api/marketplace/admin/stats", authMiddleware, pgUserMiddleware, adminMiddleware, handleAdminStats);
  console.log("✅ Marketplace routes mounted (sync)");
  app2.get("/api/tag-campaign/config", handleGetTagCampaignConfig);
  app2.post("/api/tag-campaign/check", authMiddleware, pgUserMiddleware, handleCheckTagVideo);
  app2.post("/api/tag-campaign/submit", authMiddleware, pgUserMiddleware, handleSubmitTagVideo);
  app2.get("/api/tag-campaign/my", authMiddleware, pgUserMiddleware, handleListMyTagSubmissions);
  app2.get("/api/tag-campaign/csgo-config", handleGetCsgoConfig);
  app2.post("/api/tag-campaign/csgo-submit", authMiddleware, pgUserMiddleware, handleCsgoSubmit);
  setupAuctionAndDemoRoutes(app2, () => bot);

  connectDB();
  initBot();
  

  saveAsBotPool.init().catch((err) => {
    console.error("SaveAsBot pool init failed:", err);
  });
  import("./order-release-cron-Dq0KYMTA.js").then((m) => m.startOrderReleaseCron()).catch((e) => {
    console.error("order-release-cron start failed:", e);
  });
  import("./order-reminder-cron-BZlr-pef.js").then((m) => m.startOrderReminderCron()).catch((e) => {
    console.error("order-reminder-cron start failed:", e);
  });
  startCheckoutUzTopupPoller();
  Promise.resolve().then(() => tagCampaignCron).then((m) => m.startTagCampaignCron()).catch((e) => {
    console.error("tag-campaign-cron start failed:", e);
  });
  return app2;
}
const app = createServer();
const port = process.env.PORT || 3e3;
const __dirname = import.meta.dirname;
const distPath = path.join(__dirname, "../spa");
app.use(
  express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    }
  })
);
app.get("{*path}", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(distPath, "index.html"));
});
app.listen(port, () => {
  console.log(`🚀 Fusion Starter server running on port ${port}`);
  console.log(`📱 Frontend: http://localhost:${port}`);
  console.log(`🔧 API: http://localhost:${port}/api`);
});
process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully");
  await browserPool.shutdown();
  await disconnectDB();
  process.exit(0);
});
process.on("SIGINT", async () => {
  console.log("🛑 Received SIGINT, shutting down gracefully");
  await browserPool.shutdown();
  await disconnectDB();
  process.exit(0);
});
export {
  createNotification as A,
  setAwaitingPrice as B,
  getAllSubmissionsForAccount as C,
  deleteAllSubmissionsForAccount as D,
  refundEscrow as E,
  releaseEscrow as F,
  marketplaceConfig as G,
  accountSubmissions as H,
  accounts as I,
  phpBotBridge as J,
  orders as K,
  tagCampaignCron as L,
  SUPPORT_USERNAME as S,
  phpBot as a,
  autoCancelOrder as b,
  getTagTargetUsername as c,
  getRewardTiers as d,
  getCsgoRewardTiers as e,
  formatRewardTiers as f,
  getSellerBot as g,
  handleSellerUnreachable as h,
  isUnreachable as i,
  getCsgoTagRewardTiers as j,
  fetchReelViaApify as k,
  parseRewardTiersInput as l,
  setRewardTiers as m,
  setCsgoRewardTiers as n,
  setCsgoTagRewardTiers as o,
  prisma as p,
  writeWeeklyHashtag as q,
  readWeeklyChannelUrl as r,
  setTagTargetUsername as s,
  telegramFailure as t,
  getAwaitingPrice as u,
  getSubmission as v,
  writeWeeklyChannelUrl as w,
  clearAwaitingPrice as x,
  buildAccountCaption as y,
  buildAccountButtons as z
};
//# sourceMappingURL=node-build.mjs.map
