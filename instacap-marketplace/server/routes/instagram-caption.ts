import { RequestHandler } from "express";
import { InstagramScrapeRequest, InstagramScrapeResponse } from "@shared/api";

// Note: Puppeteer is required for this functionality
// Install with: pnpm add puppeteer
// For production, you may need additional system dependencies

// Scrolls through the user page and gathers all the posts' links
async function getLinks(url: string): Promise<string[]> {
  const links: string[] = [];
  
  // Dynamic import to handle optional dependency
  const puppeteer = await import("puppeteer").catch(() => null);
  if (!puppeteer) {
    throw new Error("Puppeteer is not installed. Run: pnpm add puppeteer");
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    let lastHeight = await page.evaluate('document.body.scrollHeight');
    let scrollAttempts = 0;
    const maxScrollAttempts = 50; // Prevent infinite loops

    while (scrollAttempts < maxScrollAttempts) {
      // Extract links from current page state
      const pageLinks = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors
          .map(a => a.href)
          .filter(href => href.includes('/p/'));
      });

      // Add new unique links
      pageLinks.forEach(link => {
        if (!links.includes(link)) {
          links.push(link);
        }
      });

      // Scroll down
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if we've reached the bottom
      const newHeight = await page.evaluate('document.body.scrollHeight');
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

// Searches the string in the caption of all the posts
async function filterCaptions(links: string[], searchString: string): Promise<string[]> {
  const filteredLinks: string[] = [];
  
  const puppeteer = await import("puppeteer").catch(() => null);
  if (!puppeteer) {
    throw new Error("Puppeteer is not installed. Run: pnpm add puppeteer");
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    for (const link of links) {
      try {
        await page.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });

        // Extract all text content from the page
        const pageText = await page.evaluate(() => document.body.innerText);

        // Check if search string exists in the page text (case-insensitive)
        if (pageText.toLowerCase().includes(searchString.toLowerCase())) {
          filteredLinks.push(link);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error processing link ${link}:`, error);
        // Continue with next link
      }
    }

    return filteredLinks;
  } finally {
    await browser.close();
  }
}

export const handleInstagramScrape: RequestHandler = async (req, res) => {
  try {
    const { username, searchString } = req.body as InstagramScrapeRequest;

    if (!username || !searchString) {
      res.status(400).json({
        success: false,
        error: "Username and searchString are required"
      } as InstagramScrapeResponse);
      return;
    }

    const url = `https://www.instagram.com/${username}`;

    // Get all post links
    console.log(`Fetching posts from ${url}...`);
    const allLinks = await getLinks(url);
    console.log(`Found ${allLinks.length} posts`);

    // Filter posts by caption content
    console.log(`Filtering posts containing "${searchString}"...`);
    const filteredLinks = await filterCaptions(allLinks, searchString);
    console.log(`Found ${filteredLinks.length} matching posts`);

    res.json({
      success: true,
      totalPosts: allLinks.length,
      matchedPosts: filteredLinks.length,
      links: filteredLinks
    } as InstagramScrapeResponse);

  } catch (error) {
    console.error("Scraping error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "An unexpected error occurred"
    } as InstagramScrapeResponse);
  }
};
