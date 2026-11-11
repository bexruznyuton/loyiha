import { RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const STORE_PATH = path.join(DATA_DIR, 'weekly-hashtag.json');

const DEFAULT_HASHTAG =
  '#reels #instagram #viral #trending #explore #fyp #instagood #instadaily #reelsinstagram #viralreels #explorepage #trend #instareel #reelsvideo #foryou #love #photography #photooftheday #beautiful #fashion #style #art #music #travel #motivation #fitness #food #nature #life #happy';

interface WeeklyHashtagStore {
  hashtag: string;
  updatedAt: string;
  intervalDays: number;
  // "Hamma xeshteglar" tugmasi ochadigan kanal (Insy bot → Heshteg panelidan sozlanadi).
  channelUrl: string;
}

// Hech qachon saqlanmagan/sozlanmagan holat uchun BARQAROR (o'zgarmas) belgi —
// "new Date().toISOString()" ISHLATILMAYDI, aks holda har bir so'rovda YANGI
// vaqt qaytib, WebApp'da "🆕 Yangilandi" belgisi doim (admin hech narsa
// o'zgartirmagan bo'lsa ham) ko'rinib turaverardi (aynan shu bug tufayli).
const UNCONFIGURED_UPDATED_AT = '';

function readStore(): WeeklyHashtagStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WeeklyHashtagStore>;
    return {
      hashtag: parsed.hashtag || DEFAULT_HASHTAG,
      updatedAt: parsed.updatedAt || UNCONFIGURED_UPDATED_AT,
      intervalDays: parsed.intervalDays || 7,
      channelUrl: parsed.channelUrl || '',
    };
  } catch {
    return {
      hashtag: DEFAULT_HASHTAG,
      updatedAt: UNCONFIGURED_UPDATED_AT,
      intervalDays: 7,
      channelUrl: '',
    };
  }
}

function saveStore(next: WeeklyHashtagStore): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2));
}

export function readWeeklyChannelUrl(): string {
  return readStore().channelUrl;
}

// Kanal havolasini saqlaydi (xeshteg va uning "yangilandi" vaqti o'zgarmaydi).
export function writeWeeklyChannelUrl(channelUrl: string): void {
  saveStore({ ...readStore(), channelUrl });
}

export function writeWeeklyHashtag(hashtag: string): WeeklyHashtagStore {
  const next: WeeklyHashtagStore = {
    ...readStore(),
    hashtag,
    updatedAt: new Date().toISOString(),
    intervalDays: 7,
  };
  saveStore(next);
  return next;
}

export const handleGetWeeklyHashtag: RequestHandler = (_req, res) => {
  const s = readStore();
  res.json({ success: true, ...s });
};
