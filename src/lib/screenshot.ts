import puppeteer, { Browser } from 'puppeteer';
import { ViewportSize, Screenshot } from '../types/index.js';
import { DEFAULT_VIEWPORTS } from './viewports.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return browser;
}

export async function captureScreenshots(
  url: string,
  viewports: ViewportSize[] = DEFAULT_VIEWPORTS,
  onProgress?: (current: number, total: number, viewport: string) => void
): Promise<Screenshot[]> {
  const browserInstance = await getBrowser();
  const screenshots: Screenshot[] = [];

  for (let i = 0; i < viewports.length; i++) {
    const viewport = viewports[i];
    onProgress?.(i + 1, viewports.length, viewport.name);

    const page = await browserInstance.newPage();

    try {
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
      });

      // Disable cache to ensure fresh content is loaded
      await page.setCacheEnabled(false);

      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Wait for any lazy-loaded content
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              setTimeout(resolve, 500);
            }
          }, 100);
        });
      });

      const screenshot = await page.screenshot({
        fullPage: true,
        encoding: 'base64',
        type: 'png',
      });

      screenshots.push({
        viewport,
        dataUrl: `data:image/png;base64,${screenshot}`,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`Error capturing screenshot for ${viewport.name}:`, error);
      throw error;
    } finally {
      await page.close();
    }
  }

  return screenshots;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
