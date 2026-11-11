// Instagram oEmbed API orqali captionni olish
// Puppeteerga qaraganda 50-200ms tez ishlaydi

interface OEmbedResult {
  success: boolean;
  caption?: string;
  error?: string;
}

export async function tryOEmbed(url: string): Promise<OEmbedResult> {
  try {
    const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, error: `oEmbed returned ${response.status}` };
    }

    const data = await response.json() as { title?: string };

    // oEmbed javobidagi "title" maydoni captionni o'z ichiga oladi
    if (data.title && data.title.trim().length > 0) {
      return { success: true, caption: data.title.trim() };
    }

    return { success: false, error: 'No caption in oEmbed response' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'oEmbed failed',
    };
  }
}
