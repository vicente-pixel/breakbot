import puppeteer, { Browser, Page } from 'puppeteer';
import { ViewportSize } from '../types/index.js';
import { DEFAULT_VIEWPORTS, getTailwindBreakpoint } from './viewports.js';

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

export interface DOMIssue {
  type: 'horizontal-overflow' | 'vertical-overflow' | 'hidden-content' | 'touch-target' | 'text-overflow' | 'overlap' | 'offscreen';
  description: string;
  selector: string;
  viewport: string;
  viewportWidth: number;
  severity: 'low' | 'medium' | 'high';
  element?: {
    tagName: string;
    className: string;
    id: string;
    rect: { x: number; y: number; width: number; height: number };
  };
  suggestedFix?: string;
}

export interface ViewportAnalysis {
  viewport: ViewportSize;
  breakpoint: string;
  issues: DOMIssue[];
  metrics: {
    hasHorizontalScroll: boolean;
    documentWidth: number;
    viewportWidth: number;
    overflowingElements: number;
    smallTouchTargets: number;
    truncatedText: number;
  };
}

export interface AnalysisResult {
  url: string;
  timestamp: string;
  viewports: ViewportAnalysis[];
  summary: {
    totalIssues: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
    worstViewport: string | null;
    commonIssues: string[];
  };
}

async function analyzeViewport(page: Page, viewport: ViewportSize): Promise<ViewportAnalysis> {
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
  });

  // Wait for layout to settle
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));

  const issues: DOMIssue[] = [];
  const breakpoint = getTailwindBreakpoint(viewport.width);

  // Run all checks in the browser context
  const analysis = await page.evaluate((vp) => {
    const results = {
      hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      overflowingElements: 0,
      smallTouchTargets: 0,
      truncatedText: 0,
      issues: [] as Array<{
        type: string;
        description: string;
        selector: string;
        severity: string;
        element: {
          tagName: string;
          className: string;
          id: string;
          rect: { x: number; y: number; width: number; height: number };
        };
        suggestedFix?: string;
      }>,
    };

    // Helper to get a useful selector
    function getSelector(el: Element): string {
      if (el.id) return `#${el.id}`;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
      }
      return el.tagName.toLowerCase();
    }

    // Helper to get element info
    function getElementInfo(el: Element) {
      const rect = el.getBoundingClientRect();
      return {
        tagName: el.tagName.toLowerCase(),
        className: typeof el.className === 'string' ? el.className : '',
        id: el.id || '',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }

    // Check all visible elements
    const allElements = document.querySelectorAll('body *');

    allElements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);

      // Skip invisible elements
      if (styles.display === 'none' || styles.visibility === 'hidden' || rect.width === 0) {
        return;
      }

      // Check for horizontal overflow (element extends beyond viewport)
      if (rect.right > window.innerWidth + 5) {
        results.overflowingElements++;
        results.issues.push({
          type: 'horizontal-overflow',
          description: `Element extends ${Math.round(rect.right - window.innerWidth)}px beyond viewport`,
          selector: getSelector(el),
          severity: rect.right - window.innerWidth > 50 ? 'high' : 'medium',
          element: getElementInfo(el),
          suggestedFix: 'overflow-x-hidden or max-w-full or w-full',
        });
      }

      // Check for elements starting off-screen (left side)
      if (rect.left < -10 && rect.right > 0) {
        results.issues.push({
          type: 'offscreen',
          description: `Element partially off-screen to the left`,
          selector: getSelector(el),
          severity: 'medium',
          element: getElementInfo(el),
          suggestedFix: 'Check margin/padding or use relative positioning',
        });
      }

      // Check for small touch targets (buttons, links, inputs)
      const isInteractive = el.matches('a, button, input, select, textarea, [role="button"], [onclick]');
      if (isInteractive && (rect.width < 44 || rect.height < 44)) {
        results.smallTouchTargets++;
        if (rect.width < 30 || rect.height < 30) {
          results.issues.push({
            type: 'touch-target',
            description: `Interactive element too small for touch (${Math.round(rect.width)}x${Math.round(rect.height)}px, min 44x44px recommended)`,
            selector: getSelector(el),
            severity: 'medium',
            element: getElementInfo(el),
            suggestedFix: 'min-w-[44px] min-h-[44px] or p-3',
          });
        }
      }

      // Check for text truncation
      if (el.scrollWidth > el.clientWidth && styles.overflow !== 'visible') {
        const isTextElement = el.matches('p, span, h1, h2, h3, h4, h5, h6, a, li, td, th, label');
        if (isTextElement) {
          results.truncatedText++;
          results.issues.push({
            type: 'text-overflow',
            description: `Text is being truncated or clipped`,
            selector: getSelector(el),
            severity: 'low',
            element: getElementInfo(el),
            suggestedFix: 'break-words or text-wrap or overflow-visible',
          });
        }
      }
    });

    // Check for horizontal scrollbar on body
    if (results.hasHorizontalScroll) {
      results.issues.unshift({
        type: 'horizontal-overflow',
        description: `Page has horizontal scrollbar (document: ${results.documentWidth}px, viewport: ${results.viewportWidth}px)`,
        selector: 'body',
        severity: 'high',
        element: {
          tagName: 'body',
          className: document.body.className,
          id: document.body.id,
          rect: { x: 0, y: 0, width: results.documentWidth, height: document.body.scrollHeight },
        },
        suggestedFix: 'Add overflow-x-hidden to body or fix overflowing children',
      });
    }

    return results;
  }, viewport);

  // Convert browser results to our issue format
  for (const issue of analysis.issues) {
    issues.push({
      type: issue.type as DOMIssue['type'],
      description: issue.description,
      selector: issue.selector,
      viewport: viewport.name,
      viewportWidth: viewport.width,
      severity: issue.severity as DOMIssue['severity'],
      element: issue.element,
      suggestedFix: issue.suggestedFix,
    });
  }

  return {
    viewport,
    breakpoint,
    issues,
    metrics: {
      hasHorizontalScroll: analysis.hasHorizontalScroll,
      documentWidth: analysis.documentWidth,
      viewportWidth: analysis.viewportWidth,
      overflowingElements: analysis.overflowingElements,
      smallTouchTargets: analysis.smallTouchTargets,
      truncatedText: analysis.truncatedText,
    },
  };
}

export async function analyzeResponsiveDesign(
  url: string,
  viewports: ViewportSize[] = DEFAULT_VIEWPORTS
): Promise<AnalysisResult> {
  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const viewportResults: ViewportAnalysis[] = [];

    for (const viewport of viewports) {
      const analysis = await analyzeViewport(page, viewport);
      viewportResults.push(analysis);
    }

    // Calculate summary
    const allIssues = viewportResults.flatMap(v => v.issues);
    const highSeverity = allIssues.filter(i => i.severity === 'high').length;
    const mediumSeverity = allIssues.filter(i => i.severity === 'medium').length;
    const lowSeverity = allIssues.filter(i => i.severity === 'low').length;

    // Find worst viewport
    let worstViewport: string | null = null;
    let maxIssues = 0;
    for (const vp of viewportResults) {
      if (vp.issues.length > maxIssues) {
        maxIssues = vp.issues.length;
        worstViewport = vp.viewport.name;
      }
    }

    // Find common issue types
    const issueTypeCounts = new Map<string, number>();
    for (const issue of allIssues) {
      issueTypeCounts.set(issue.type, (issueTypeCounts.get(issue.type) || 0) + 1);
    }
    const commonIssues = [...issueTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);

    return {
      url,
      timestamp: new Date().toISOString(),
      viewports: viewportResults,
      summary: {
        totalIssues: allIssues.length,
        highSeverity,
        mediumSeverity,
        lowSeverity,
        worstViewport,
        commonIssues,
      },
    };
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
