import { RequestHandler } from 'express';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Kichik in-memory kesh: file_id → { url, contentType, expiresAt }
const cache = new Map<string, { url: string; contentType: string; expiresAt: number }>();

// Telegram file URL muddati ~1 soat
const TTL = 50 * 60 * 1000;

const EXT_CONTENT_TYPE: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

async function resolveFileUrl(fileId: string): Promise<{ url: string; contentType: string } | null> {
  const cached = cache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return { url: cached.url, contentType: cached.contentType };

  const r = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const data = await r.json();
  if (!data.ok || !data.result?.file_path) return null;

  const filePath = String(data.result.file_path);
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  // Telegram'ning o'z fayl serveri video/rasm uchun ham ko'pincha generic
  // "application/octet-stream" qaytaradi — sendVideo(url)/sendPhoto(url)
  // orqali boshqa botga URL sifatida yuborilganda Telegram buni rad etadi
  // ("failed to get HTTP URL content"), shu sabab kengaytmadan aniq
  // content-type hisoblanadi (fallback sifatida Telegram javobidan ham
  // foydalanish mumkin, lekin extension ancha ishonchli).
  const contentType = EXT_CONTENT_TYPE[ext] || 'application/octet-stream';

  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  cache.set(fileId, { url, contentType, expiresAt: Date.now() + TTL });
  return { url, contentType };
}

/**
 * GET /api/files/:fileId
 * Telegram file_id'ni proksilab WebApp ichida ko'rsatish uchun.
 * Bot tokeni serverda saqlanadi — clientga ko'rinmaydi.
 */
export const handleGetFile: RequestHandler = async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      res.status(503).send('Bot not configured');
      return;
    }

    const fileId = req.params.fileId;
    if (!fileId) {
      res.status(400).send('Missing file id');
      return;
    }

    const resolved = await resolveFileUrl(fileId);
    if (!resolved) {
      res.status(404).send('File not found');
      return;
    }

    const isHead = req.method === 'HEAD';
    const upstream = await fetch(resolved.url, {
      method: isHead ? 'HEAD' : 'GET',
      headers: req.headers.range ? { range: req.headers.range as string } : undefined,
    });
    if (!upstream.ok || (!isHead && !upstream.body)) {
      res.status(502).send('Upstream error');
      return;
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', resolved.contentType);
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('Accept-Ranges', 'bytes');
    const upstreamLength = upstream.headers.get('content-length');
    if (upstreamLength) res.setHeader('Content-Length', upstreamLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    // Stream the response
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('file proxy error:', err);
    if (!res.headersSent) res.status(500).send('Server error');
  }
};
