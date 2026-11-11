import type { Browser, Page } from "puppeteer";

interface PooledBrowser {
  browser: Browser;
  pageCount: number;
  lastUsed: number;
  id: string;
}

const MAX_BROWSERS = 2;
const MAX_PAGES_PER_BROWSER = 5;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 daqiqa
const CLEANUP_INTERVAL = 60 * 1000; // 1 daqiqa
const PAGE_WAIT_TIMEOUT = 15000; // 15 soniya kutish
const PAGE_WAIT_INTERVAL = 200; // 200ms oraliqda tekshirish

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const BLOCKED_RESOURCE_TYPES = new Set([
  'image',
  'stylesheet',
  'font',
  'media',
  'texttrack',
  'manifest',
]);

class BrowserPool {
  private browsers: Map<string, PooledBrowser> = new Map();
  private puppeteerModule: typeof import("puppeteer") | null = null;
  private initPromise: Promise<void> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  constructor() {
    this.startCleanupTimer();
  }

  private async init(): Promise<void> {
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

  private async launchBrowser(): Promise<PooledBrowser> {
    await this.init();
    const browser = await this.puppeteerModule!.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });

    const id = Math.random().toString(36).substring(2, 8);
    const pooled: PooledBrowser = {
      browser,
      pageCount: 0,
      lastUsed: Date.now(),
      id,
    };

    this.browsers.set(id, pooled);
    console.log(`🌐 Browser pool: launched new browser (id: ${id}, total: ${this.browsers.size})`);
    return pooled;
  }

  // Jami ochiq pagelar sonini hisoblash
  private getTotalPageCount(): number {
    let total = 0;
    for (const [, pooled] of this.browsers) {
      total += pooled.pageCount;
    }
    return total;
  }

  // Sig'imi bor brauzerni topish
  private findAvailableBrowser(): PooledBrowser | null {
    for (const [, pooled] of this.browsers) {
      if (pooled.pageCount < MAX_PAGES_PER_BROWSER) {
        return pooled;
      }
    }
    return null;
  }

  async acquirePage(): Promise<{ page: Page; browserId: string }> {
    if (this.shuttingDown) {
      throw new Error("Browser pool is shutting down");
    }

    // Sig'imi bor brauzerni tekshirish
    const available = this.findAvailableBrowser();
    if (available) {
      available.pageCount++;
      available.lastUsed = Date.now();
      const page = await available.browser.newPage();
      await this.configureResourceBlocking(page);
      return { page, browserId: available.id };
    }

    // Yangi brauzer ochish mumkinmi?
    if (this.browsers.size < MAX_BROWSERS) {
      const pooled = await this.launchBrowser();
      pooled.pageCount++;
      pooled.lastUsed = Date.now();
      const page = await pooled.browser.newPage();
      await this.configureResourceBlocking(page);
      return { page, browserId: pooled.id };
    }

    // Barcha brauzerlar to'la — bo'sh joy chiqishini KUTISH
    console.log(`⏳ Browser pool: all browsers full (${this.getTotalPageCount()} pages), waiting...`);
    const maxPages = MAX_BROWSERS * MAX_PAGES_PER_BROWSER;
    const startTime = Date.now();

    while (Date.now() - startTime < PAGE_WAIT_TIMEOUT) {
      await new Promise(resolve => setTimeout(resolve, PAGE_WAIT_INTERVAL));

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

  async releasePage(page: Page, browserId: string): Promise<void> {
    try {
      await page.close();
    } catch {
      // Page allaqachon yopilgan bo'lishi mumkin
    }

    const pooled = this.browsers.get(browserId);
    if (pooled) {
      pooled.pageCount = Math.max(0, pooled.pageCount - 1);
      pooled.lastUsed = Date.now();
    }
  }

  private async configureResourceBlocking(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      const now = Date.now();
      for (const [id, pooled] of this.browsers) {
        if (pooled.pageCount === 0 && now - pooled.lastUsed > IDLE_TIMEOUT) {
          console.log(`🧹 Browser pool: closing idle browser (id: ${id})`);
          try {
            await pooled.browser.close();
          } catch {
            // Ignore
          }
          this.browsers.delete(id);
        }
      }
    }, CLEANUP_INTERVAL);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const closePromises = Array.from(this.browsers.values()).map(async (pooled) => {
      try {
        await pooled.browser.close();
      } catch {
        // Ignore
      }
    });

    await Promise.all(closePromises);
    this.browsers.clear();
    console.log('🛑 Browser pool: all browsers closed');
  }
}

export const browserPool = new BrowserPool();
