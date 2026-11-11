import { RequestHandler } from "express";
import { InstagramCaptionRequest, InstagramCaptionResponse } from "@shared/api";
import { trackEvent } from "../analytics";
import { captionQueue } from "../queue";
import { getCachedCaption, setCachedCaption } from "../cache";
import { browserPool } from "../browser-pool";
import { tryOEmbed } from "../oembed";
import { CaptionHistory } from "../models/CaptionHistory";
import { saveAsBotPool, InaccessiblePostError, RateLimitedError } from "../saveasbot";
import { isHeshtegEnabled } from "../lib/marketplace-config";
import { cleanInstagramCaption } from "../lib/instagram-caption-cleaner";

// Maxsus xato: post yopiq/yo'q/yosh chegarali bo'lganda upstream catch oladi.
class PostInaccessibleUz extends Error {
  constructor() {
    super("Post yopiq akkauntda, yosh chegarasi bor yoki o'chirib yuborilgan. Bu video uchun xeshteg olib bo'lmaydi.");
    this.name = 'PostInaccessibleUz';
  }
}

// URL dan Instagram shortcode ajratish
function extractShortcode(url: string): string | null {
  const m = url.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Bir xil URL uchun bir vaqtda kelgan so'rovlarni birlashtirib yuborish (dedup)
// 20 ta so'rov bir xil URL ga kelsa, faqat 1 marta Puppeteer ishlaydi
const inflightRequests = new Map<string, Promise<{ caption: string; source: string }>>();

// Extract caption from a single Instagram post/reel
async function extractCaption(url: string): Promise<{ caption: string; source: string }> {
  // 1-qadam: oEmbed API orqali olishga harakat (eng tez yo'l, ~50-200ms)
  const oembedResult = await tryOEmbed(url);
  if (oembedResult.success && oembedResult.caption) {
    const caption = cleanInstagramCaption(oembedResult.caption);
    if (caption) {
      console.log('⚡ Caption found via oEmbed API (fast path)');
      return { caption, source: 'oembed' };
    }
  }
  console.log('oEmbed failed, falling back to Telegram Bot / Puppeteer embed:', oembedResult.error);

  // 1.5-qadam: @SaveAsBot session pool (Telegram bot orqali) — Puppeteer-dan oldin harakat qilamiz!
  if (saveAsBotPool.isReady()) {
    console.log('🤖 API usullari muvaffaqiyatsiz bo\'ldi — Puppeteer-dan oldin SaveAsBot-ni sinab ko\'ramiz');
    // Rate-limit'ga 1 marta retry qilamiz (kichik kechikish bilan)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const botCaption = await saveAsBotPool.fetchCaption(url, 20000); // 20 soniya timeout
        if (botCaption) {
          const caption = cleanInstagramCaption(botCaption);
          if (caption) return { caption, source: 'saveasbot' };
        }
        console.log('🤖 SaveAsBot caption qaytarmadi, Puppeteer-ga o\'tilmoqda');
        break;
      } catch (err) {
        if (err instanceof InaccessiblePostError) {
          // Post-ga kirish iloji yo'q — Puppeteer ham yordam bermaydi, qisqa yo'l.
          throw new PostInaccessibleUz();
        }
        if (err instanceof RateLimitedError && attempt === 1) {
          const waitMs = err.retryAfterMs || 5500;
          console.warn(`🤖 SaveAsBot rate limit — ${waitMs}ms kutib retry qilamiz`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (err instanceof RateLimitedError) {
          console.warn('🤖 SaveAsBot rate limit (retry ham fail) — Puppeteer-ga o\'tilmoqda');
          break;
        }
        console.error('🤖 SaveAsBot xatoligi, Puppeteer-ga o\'tilmoqda:', err);
        break;
      }
    }
  } else {
    console.log(`🤖 SaveAsBot pool tayyor emas, to'g'ridan-to'g'ri Puppeteer-ga o'tilmoqda`);
  }

  // 2-qadam: Puppeteer bilan public embed URL orqali olish (login shart emas)
  const shortcode = extractShortcode(url);
  const embedUrl = shortcode
    ? `https://www.instagram.com/p/${shortcode}/embed/captioned/`
    : url;

  const { page, browserId } = await browserPool.acquirePage();

  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    console.log(`Navigating to embed URL: ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 15000 });

    // Embed sahifasida caption renderlanishini kutish
    try {
      await page.waitForSelector(
        '.Caption, [class*="Caption"], [data-testid*="caption"], span[dir="auto"]',
        { timeout: 5000 }
      );
    } catch {
      console.log('Caption selector timed out, trying extraction anyway');
    }

    console.log('Extracting caption from embed page...');

    const caption = await page.evaluate(() => {
      // Embed sahifasi uchun selektorlar
      const embedSelectors = [
        '.Caption',
        '[class*="Caption"]',
        '[data-testid="post-comment-root"] span',
        'article span[dir="auto"]',
        'h1',
        'span[dir="auto"]',
      ];

      // Embed sahifasi bloklanganda (login/0-byte) faqat brend/navigatsiya matni qoladi
      // (masalan "Meta", "Instagram") — ularni caption deb qabul qilmaymiz.
      const JUNK = new Set([
        'meta', 'instagram', 'about', 'help', 'press', 'api', 'jobs', 'privacy',
        'terms', 'locations', 'contact uploading & non-users', 'report', 'embed',
        'watch on instagram', 'more posts from', 'open instagram',
      ]);
      const isNavOrButton = (t: string) => {
        const low = t.trim().toLowerCase();
        if (JUNK.has(low)) return true;
        // Bitta qisqa so'z (brend/tugma) — haqiqiy caption emas
        if (low.length <= 4 && !/\p{Emoji}/u.test(t)) return true;
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

      // Barcha ko'rinadigan matndan qidirish — qisqa emoji-only captionlar uchun ham
      const body = document.body?.innerText || '';
      const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        if (!isNavOrButton(line) && !/^\d+$/.test(line)) {
          return line;
        }
      }

      return null;
    });

    const INSTAGRAM_ERROR_PHRASES = [
      'link to this photo or video may be broken',
      'post may have been removed',
      'page isn\'t available',
      'something went wrong',
    ];

    const cleanedCaption = cleanInstagramCaption(caption || '');
    if (cleanedCaption && !INSTAGRAM_ERROR_PHRASES.some(p => cleanedCaption.toLowerCase().includes(p))) {
      console.log('Caption found via Puppeteer embed');
      return { caption: cleanedCaption, source: 'puppeteer-embed' };
    }

    if (caption) {
      // Instagram xato xabari — reel mavjud emas yoki private
      throw new Error('This post is not available. It may be private or deleted.');
    }

    const allText = await page.evaluate(() => document.body?.innerText || '');
    console.log('Page text length:', allText.length);

    throw new Error('Caption not found on page. Instagram may require login or page structure changed.');
  } catch (error) {
    console.error('Puppeteer extraction error details:', error);
    throw error;
  } finally {
    await browserPool.releasePage(page, browserId);
  }
}

export const handleInstagramCaption: RequestHandler = async (req, res) => {
  try {
    const { url } = req.body as InstagramCaptionRequest;

    if (!url) {
      res.status(400).json({
        success: false,
        caption: '',
        error: "URL is required"
      } as InstagramCaptionResponse);
      return;
    }

    // Admin /heshteg orqali xizmatni o'chirib qo'ygan bo'lsa — to'xtatamiz.
    const enabled = await isHeshtegEnabled().catch(() => true);
    if (!enabled) {
      res.status(503).json({
        success: false,
        caption: '',
        error: "service_disabled"
      } as InstagramCaptionResponse);
      return;
    }

    if (!url.includes('instagram.com')) {
      res.status(400).json({
        success: false,
        caption: '',
        error: "Invalid Instagram URL"
      } as InstagramCaptionResponse);
      return;
    }

    // URL tozalash (query parametrlarni olib tashlash)
    const cleanUrl = url.split('?')[0];

    // Avval cache'ni tekshirish
    const cachedCaption = getCachedCaption(cleanUrl);
    const cleanedCachedCaption = cleanInstagramCaption(cachedCaption || '');
    if (cleanedCachedCaption) {
      if (cleanedCachedCaption !== cachedCaption) {
        setCachedCaption(cleanUrl, cleanedCachedCaption);
      }
      console.log(`✅ Cache hit for ${cleanUrl}`);

      trackEvent({
        timestamp: Date.now(),
        type: 'caption_extracted',
        data: { url: cleanUrl, cached: true }
      });

      res.json({
        success: true,
        caption: cleanedCachedCaption
      } as InstagramCaptionResponse);
      return;
    }

    // Bir xil URL allaqachon ishlanayotgan bo'lsa, uning natijasini kutish (dedup)
    const inflight = inflightRequests.get(cleanUrl);
    if (inflight) {
      console.log(`🔗 Dedup: ${cleanUrl} already in-flight, waiting for result`);
      const { caption, source } = await inflight;

      trackEvent({
        timestamp: Date.now(),
        type: 'caption_extracted',
        data: { url: cleanUrl, cached: true, source }
      });

      res.json({
        success: true,
        caption,
        source
      } as InstagramCaptionResponse);
      return;
    }

    console.log(`📥 Queue: Adding ${cleanUrl} to queue`);
    console.log(`📊 Queue stats: ${captionQueue.size} waiting, ${captionQueue.pending} processing`);

    // So'rovni boshlash va inflight mapga qo'shish
    const extractionPromise = captionQueue.add(async () => {
      console.log(`🔄 Processing ${cleanUrl}...`);
      const result = await extractCaption(cleanUrl);
      console.log(`✅ Completed ${cleanUrl} (source=${result.source})`);
      return result;
    }) as Promise<{ caption: string; source: string }>;

    inflightRequests.set(cleanUrl, extractionPromise);

    let caption: string;
    let source: string;
    try {
      const result = await extractionPromise;
      caption = result.caption;
      source = result.source;
    } finally {
      inflightRequests.delete(cleanUrl);
    }

    // Cache'ga saqlash
    setCachedCaption(cleanUrl, caption);

    // Analitika
    trackEvent({
      timestamp: Date.now(),
      type: 'caption_extracted',
      data: { url: cleanUrl, cached: false, source }
    });

    // Agar user autentifikatsiya qilingan bo'lsa — tarixga saqlash (fire-and-forget)
    if (req.telegramUser) {
      CaptionHistory.create({
        userId: req.telegramUser._id,
        telegramId: req.telegramUser.telegramId,
        url: cleanUrl,
        caption,
      }).catch(err => console.error('Failed to save caption history:', err));
    }

    res.json({
      success: true,
      caption,
      source
    } as InstagramCaptionResponse);

  } catch (error) {
    console.error("Caption extraction error:", error);

    // Maxsus aniq xatolar — to'g'ridan-to'g'ri foydalanuvchiga o'zbekcha matnda.
    if (error instanceof PostInaccessibleUz) {
      res.status(200).json({
        success: false,
        caption: '',
        error: error.message,
      } as InstagramCaptionResponse);
      return;
    }

    const errMsg = error instanceof Error ? error.message.toLowerCase() : "";

    // Foydalanuvchiga texnik stack ko'rsatmaymiz — qolgan barcha xatolar do'stona xabarga aylanadi.
    const isTimeout = errMsg.includes('timeout') || errMsg.includes('timed out');
    const friendly = isTimeout
      ? "Server javob bermadi. Iltimos, qaytadan urinib ko'ring."
      : "Hozir xeshtegni olib bo'lmadi. Boshqa havola bilan urinib ko'ring yoki video havolasini adminga yuboring.";

    res.status(isTimeout ? 408 : 200).json({
      success: false,
      caption: '',
      error: friendly,
    } as InstagramCaptionResponse);
  }
};
