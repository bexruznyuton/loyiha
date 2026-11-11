import fs from 'fs';
import path from 'path';

export interface AnalyticsEvent {
  timestamp: number;
  type: 'caption_extracted' | 'verification_view' | 'bio_downloaded';
  userId?: string;
  data?: any;
}

const ANALYTICS_FILE = path.join(process.cwd(), 'analytics.json');
// Cumulative counter — hech qachon kesilmaydi, haqiqiy total saqlaydi.
// analytics.json'da faqat oxirgi 10k event saqlanadi (fayl o'lchamini cheklash uchun),
// shu sababli umumiy son uchun alohida counter kerak.
const COUNTER_FILE = path.join(process.cwd(), 'analytics-counter.json');

interface CounterData {
  totalEvents: number;
  totalExtractions: number;
  totalBioDownloads?: number;
  firstEventAt: number; // ms — xizmat birinchi marta ishga tushgan vaqt
  // Migratsiya bayrog'i: agar true bo'lsa, counter haqiqiy total emas (eski cap'dan boshlandi)
  approximate?: boolean;
}

function readCounter(): CounterData {
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8')) as CounterData;
  } catch {
    // Fayl yo'q bo'lsa, mavjud analytics.json'dagi sonlar bilan migratsiya
    let totalEvents = 0;
    let totalExtractions = 0;
    let firstEventAt = Date.now();
    let approximate = false;
    try {
      const d = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8'));
      const evs = Array.isArray(d.events) ? d.events : [];
      totalEvents = evs.length;
      totalExtractions = evs.filter((e: AnalyticsEvent) => e.type === 'caption_extracted').length;
      if (evs.length > 0) firstEventAt = evs[0].timestamp;
      // 10000'ga tegib turgan bo'lsa — cap urilgan, demak haqiqiy total katta
      if (evs.length >= 10000) approximate = true;
    } catch {
      /* analytics.json yo'q */
    }
    const init: CounterData = { totalEvents, totalExtractions, firstEventAt, approximate };
    try {
      fs.writeFileSync(COUNTER_FILE, JSON.stringify(init, null, 2));
    } catch {
      /* yozish xatosi */
    }
    return init;
  }
}

function writeCounter(c: CounterData): void {
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(c, null, 2));
  } catch (e) {
    console.error('counter write fail:', e);
  }
}

// Initialize analytics file if it doesn't exist
function initAnalyticsFile() {
  if (!fs.existsSync(ANALYTICS_FILE)) {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify({ events: [] }, null, 2));
  }
}

// Track an event
export function trackEvent(event: AnalyticsEvent) {
  try {
    initAnalyticsFile();
    const data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8'));
    data.events.push(event);

    // Keep only last 10000 events to prevent file from growing too large
    if (data.events.length > 10000) {
      data.events = data.events.slice(-10000);
    }

    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2));

    // Cumulative counter — increment qilamiz (hech qachon kesilmaydi)
    const counter = readCounter();
    counter.totalEvents += 1;
    if (event.type === 'caption_extracted') counter.totalExtractions += 1;
    if (event.type === 'bio_downloaded') counter.totalBioDownloads = (counter.totalBioDownloads || 0) + 1;
    writeCounter(counter);
  } catch (error) {
    console.error('Error tracking event:', error);
  }
}

// Get analytics data
export function getAnalytics() {
  try {
    initAnalyticsFile();
    const data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8'));
    return data.events as AnalyticsEvent[];
  } catch (error) {
    console.error('Error reading analytics:', error);
    return [];
  }
}

// VPS Europe/Berlin (UTC+2) timezone'da, lekin foydalanuvchilar Asia/Tashkent
// (UTC+5) vaqti bo'yicha kun hisoblashini xohlashadi. Tashkent vaqtidagi
// kun boshi ms ni qaytaradi.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
function startOfTashkentDayMs(daysAgo = 0): number {
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const d = nowTashkent.getUTCDate() - daysAgo;
  return Date.UTC(y, m, d) - TASHKENT_OFFSET_MS;
}

// Get daily stats (Tashkent)
export function getDailyStats() {
  const events = getAnalytics();
  const todayStart = startOfTashkentDayMs(0);

  const todayEvents = events.filter(e => e.timestamp >= todayStart);
  const captionExtractions = todayEvents.filter(e => e.type === 'caption_extracted');

  return {
    totalExtractions: captionExtractions.length,
    totalVisits: todayEvents.length,
  };
}

// Get all-time stats (xizmat ishga tushgandan beri)
// Cumulative counter'dan o'qiymiz — analytics.json'da cap (oxirgi 10k) bor,
// shuning uchun events.length umumiy son emas.
export function getAllTimeStats() {
  const counter = readCounter();
  return {
    totalExtractions: counter.totalExtractions,
    totalVisits: counter.totalEvents,
    firstEventAt: counter.firstEventAt,
    approximate: !!counter.approximate,
  };
}

// Get weekly stats (Tashkent, so'nggi 7 kun)
export function getWeeklyStats() {
  const events = getAnalytics();
  const weekStart = startOfTashkentDayMs(7);

  const weekEvents = events.filter(e => e.timestamp >= weekStart);
  const captionExtractions = weekEvents.filter(e => e.type === 'caption_extracted');

  return {
    totalExtractions: captionExtractions.length,
    totalVisits: weekEvents.length,
  };
}

// Bio yuklash statistikasi — bugun/hafta/jami + noyob foydalanuvchilar
export function getBioStats() {
  const events = getAnalytics().filter(e => e.type === 'bio_downloaded');
  const counter = readCounter();
  const todayStart = startOfTashkentDayMs(0);
  const weekStart = startOfTashkentDayMs(7);

  const today = events.filter(e => e.timestamp >= todayStart);
  const week = events.filter(e => e.timestamp >= weekStart);

  const uniq = (list: AnalyticsEvent[]) => new Set(list.map(e => e.userId).filter(Boolean)).size;

  return {
    today: today.length,
    todayUsers: uniq(today),
    week: week.length,
    weekUsers: uniq(week),
    allTime: counter.totalBioDownloads || 0,
  };
}

// Get hourly distribution (Tashkent vaqti bo'yicha)
export function getHourlyDistribution() {
  const events = getAnalytics();
  const todayStart = startOfTashkentDayMs(0);

  const todayEvents = events.filter(e =>
    e.timestamp >= todayStart &&
    e.type === 'caption_extracted'
  );

  const hourlyData: { [hour: number]: number } = {};
  for (let i = 0; i < 24; i++) hourlyData[i] = 0;

  todayEvents.forEach(event => {
    // Tashkent vaqtidagi soat: timestamp + 5h ni UTC sifatida o'qiymiz
    const hour = new Date(event.timestamp + TASHKENT_OFFSET_MS).getUTCHours();
    hourlyData[hour]++;
  });

  return hourlyData;
}

// Get peak hour
export function getPeakHour() {
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

// ═══════════════════════════════════════════
// VIDEO ANALIZ statistikasi (VIDoctorai — vidoctorai xizmati yozadi)
// ═══════════════════════════════════════════

interface VideoAnalyticsEvent {
  timestamp: number;
  type: string;
  userId?: string;
  viral?: number;
}

const VIDEO_ANALYTICS_FILE =
  process.env.VIDEO_ANALYTICS_FILE || '/var/www/vidoctorai/video_analytics.json';

function getVideoEvents(): VideoAnalyticsEvent[] {
  try {
    if (!fs.existsSync(VIDEO_ANALYTICS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(VIDEO_ANALYTICS_FILE, 'utf-8'));
    return (data.events || []) as VideoAnalyticsEvent[];
  } catch (error) {
    console.error('Error reading video analytics:', error);
    return [];
  }
}

// Umumiy / kunlik / haftalik / oylik video tahlil statistikasi
export function getVideoStats() {
  const events = getVideoEvents().filter(e => e.type === 'video_analyzed');

  const todayStart = startOfTashkentDayMs(0);
  const weekStart = startOfTashkentDayMs(7);
  const monthStart = startOfTashkentDayMs(30);
  const hourAgo = Date.now() - 60 * 60 * 1000;

  const today = events.filter(e => e.timestamp >= todayStart);
  const week = events.filter(e => e.timestamp >= weekStart);
  const month = events.filter(e => e.timestamp >= monthStart);
  const lastHour = events.filter(e => e.timestamp >= hourAgo);

  const uniq = (list: VideoAnalyticsEvent[]) =>
    new Set(list.map(e => e.userId).filter(Boolean)).size;

  const avgViral = (list: VideoAnalyticsEvent[]) => {
    const vals = list.map(e => e.viral).filter((v): v is number => typeof v === 'number');
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
    avgViralAll: avgViral(events),
  };
}

// Video tahlil — bugungi soatlik taqsimot (Tashkent)
export function getVideoHourlyDistribution() {
  const events = getVideoEvents().filter(e => e.type === 'video_analyzed');
  const todayStart = startOfTashkentDayMs(0);

  const hourlyData: { [hour: number]: number } = {};
  for (let i = 0; i < 24; i++) hourlyData[i] = 0;

  events
    .filter(e => e.timestamp >= todayStart)
    .forEach(e => {
      const hour = new Date(e.timestamp + TASHKENT_OFFSET_MS).getUTCHours();
      hourlyData[hour]++;
    });

  return hourlyData;
}
