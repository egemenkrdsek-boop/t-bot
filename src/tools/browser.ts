import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../types.js';
import { redactSecrets } from '../sessions.js';

// A private, disposable profile: never attach to the user's existing browser.
let context: any;
let profile: string | undefined;
let launching: Promise<any> | undefined;
const tabs = new Map<number, any>();
let nextId = 1;
const snapshots = new WeakMap<object, Set<string>>();
let idleTimer: NodeJS.Timeout | undefined;
const BROWSER_IDLE_TIMEOUT_MS = 60_000;
let lastBrowserActivityAt = 0;
let activeBrowserOps = 0;

export interface FallbackElementMeta {
  role: string;
  text: string;
  ariaLabel: string;
  name: string;
  tag: string;
  href: string;
  cssPath: string;
  placeholder: string;
}

// Persistent fallback semantic selector memory for resilient SPA recovery
export const lastElementMap = new Map<string, FallbackElementMeta>();

// Auto dialog notification history
export interface DialogRecord {
  type: string;
  message: string;
  timestamp: number;
}
export const lastDialogHistory: DialogRecord[] = [];

export function resetIdleTimer(): void {
  lastBrowserActivityAt = Date.now();
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (context || launching) {
    idleTimer = setTimeout(() => {
      if (activeBrowserOps === 0) {
        void closeBrowser().catch(() => {});
      }
    }, BROWSER_IDLE_TIMEOUT_MS);
    idleTimer.unref();
  }
}

export async function closeIdleBrowser(idleThresholdMs = 180_000): Promise<void> {
  if (activeBrowserOps === 0 && Date.now() - lastBrowserActivityAt > idleThresholdMs) {
    if (context || launching) {
      await closeBrowser();
    }
  }
}

const cap = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + '\n[truncated]' : s);
const clean = (s: string) => redactSecrets(s);
const str = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
};
const params = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const tabProperty = {
  type: 'integer',
  description: 'Tab ID returned by browser_tabs or browser_new_tab; defaults to the active tab.',
};
const selectorProperty = {
  type: 'string',
  description: 'Element ref (e.g. "e1", "1") or Playwright selector from browser_inspect.',
};

export const browserToolDefinitions: ToolDefinition[] = [
  {
    name: 'browser_tabs',
    description: 'Manage browser tabs (list, switch, open new, or close tab).',
    parameters: params({
      action: { type: 'string', enum: ['list', 'switch', 'new', 'close'], description: 'Tab operation to perform; defaults to "list".' },
      tab: tabProperty,
      url: { type: 'string', description: 'URL when opening a new tab.' },
    }),
  },
  {
    name: 'browser_new_tab',
    description: 'Open a new isolated browser tab and return its tab ID.',
    parameters: params({ url: { type: 'string', description: 'Initial URL to navigate to.' } }),
  },
  {
    name: 'browser_close_tab',
    description: 'Close an isolated browser tab by tab ID.',
    parameters: params({ tab: tabProperty }, ['tab']),
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a tab to an HTTP or HTTPS URL.',
    parameters: params({ tab: tabProperty, url: { type: 'string' } }, ['url']),
  },
  {
    name: 'browser_open',
    description: 'Open or navigate an isolated browser tab to a specified HTTP(S) URL.',
    parameters: params({ tab: tabProperty, url: { type: 'string' } }, ['url']),
  },
  {
    name: 'browser_inspect',
    description:
      'Inspect visible page text and up to 200 interactive elements ordered by viewport visibility. Captures semantic metadata for durable selectors.',
    parameters: params({
      tab: tabProperty,
      maxChars: { type: 'integer', minimum: 1000, maximum: 15000, description: 'Maximum output characters; defaults to 6000.' },
    }),
  },
  {
    name: 'browser_click',
    description: 'Click an element by ref (e.g. "e1") or selector with automatic SPA stale-reference recovery.',
    parameters: params({ tab: tabProperty, selector: selectorProperty, ref: { type: 'string', description: 'Element ref (e.g. "e1", "1").' } }),
  },
  {
    name: 'browser_type',
    description: 'Type text into an input or editable field with automatic SPA recovery. Credentials and payment fields are blocked.',
    parameters: params(
      {
        tab: tabProperty,
        selector: selectorProperty,
        ref: { type: 'string', description: 'Element ref (e.g. "e1", "1").' },
        value: { type: 'string', description: 'Text to type into the field.' },
        clear: { type: 'boolean', description: 'Whether to clear existing text before typing; defaults to true.' },
      },
      ['value']
    ),
  },
  {
    name: 'browser_fill',
    description: 'Fill a form field (alias for browser_type). Credentials and payment fields are blocked.',
    parameters: params(
      {
        tab: tabProperty,
        selector: selectorProperty,
        ref: { type: 'string', description: 'Element ref (e.g. "e1", "1").' },
        value: { type: 'string', description: 'Text to fill into the field.' },
      },
      ['value']
    ),
  },
  {
    name: 'browser_hover',
    description: 'Hover the mouse pointer over an element to reveal dropdowns, menus, or tooltips.',
    parameters: params({ tab: tabProperty, selector: selectorProperty, ref: { type: 'string', description: 'Element ref (e.g. "e1", "1").' } }),
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page vertically or scroll directly to a specific element ref.',
    parameters: params({
      tab: tabProperty,
      direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'], description: 'Scroll direction; defaults to "down".' },
      amount: { type: 'integer', description: 'Pixels to scroll; defaults to 600.' },
      ref: { type: 'string', description: 'Optional element ref to scroll directly into view.' },
    }),
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key or combination (e.g. "Enter", "Escape", "Tab", "ArrowDown", "Control+a").',
    parameters: params({ tab: tabProperty, key: { type: 'string', description: 'Key name according to Playwright conventions.' } }, ['key']),
  },
  {
    name: 'browser_evaluate',
    description: 'Safely execute a JavaScript expression in the tab context and return its JSON or string result.',
    parameters: params({ tab: tabProperty, script: { type: 'string', description: 'JavaScript code or expression to evaluate.' } }, ['script']),
  },
  {
    name: 'browser_screenshot',
    description:
      'Capture a page screenshot. By default, overlays numbered Set-of-Marks (SoM) badges (#94D82D/#0B130E) over interactive elements and masks password fields.',
    parameters: params({
      tab: tabProperty,
      annotate: { type: 'boolean', description: 'Overlay Set-of-Marks (SoM) visual numbered badges over interactive elements; defaults to true.' },
      mask_inputs: { type: 'boolean', description: 'Mask all input and editable fields; defaults to false (password fields are always masked).' },
    }),
  },
  {
    name: 'browser_close',
    description: 'Close the isolated browser session and purge its temporary profile directory.',
    parameters: params({}),
  },
];

function setupPageHandlers(page: any): void {
  // Automatic Dialog Handler: dismiss/accept alerts, confirms, prompts gracefully without freezing
  page.on('dialog', async (dialog: any) => {
    try {
      const type = dialog.type();
      const message = dialog.message();
      lastDialogHistory.push({ type, message, timestamp: Date.now() });
      if (lastDialogHistory.length > 30) lastDialogHistory.shift();
      await dialog.accept().catch(() => {});
    } catch {
      // ignore dialog handling errors
    }
  });

  page.on('framenavigated', (frame: any) => {
    if (frame === page.mainFrame()) {
      snapshots.delete(page);
    }
  });
}

function remember(page: any): number {
  for (const [id, existing] of tabs) {
    if (existing === page) return id;
  }
  const id = nextId++;
  tabs.set(id, page);
  setupPageHandlers(page);
  page.on('close', () => tabs.delete(id));
  return id;
}

async function browser(): Promise<any> {
  if (context) return context;
  if (launching) return launching;

  launching = (async () => {
    const packageName = 'playwright-core';
    let playwright: any;
    try {
      playwright = await import(packageName);
    } catch {
      throw new Error('Browser tools require playwright-core. Install it and a compatible Chromium or Chrome browser.');
    }
    const dir = await mkdtemp(join(tmpdir(), 'tbot-browser-'));
    profile = dir;
    try {
      try {
        context = await playwright.chromium.launchPersistentContext(profile, {
          channel: 'chrome',
          headless: true,
          timeout: 15000,
          viewport: { width: 1280, height: 800 },
        });
      } catch {
        context = await playwright.chromium.launchPersistentContext(profile, {
          headless: true,
          timeout: 15000,
          viewport: { width: 1280, height: 800 },
        });
      }
      context.setDefaultTimeout(10000);
      context.on('page', remember);
      const launched = context;
      context.on('close', () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        if (context === launched) {
          context = undefined;
          tabs.clear();
        }
        if (profile === dir) profile = undefined;
        void rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
      });

      for (const page of context.pages()) remember(page);
      resetIdleTimer();
      return context;
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      if (profile === dir) profile = undefined;
      throw error;
    }
  })();

  try {
    return await launching;
  } finally {
    launching = undefined;
  }
}

async function pageFor(value: unknown): Promise<any> {
  const ctx = await browser();
  if (!tabs.size) {
    remember(await ctx.newPage());
  }
  const id = value === undefined ? tabs.keys().next().value : value;
  if (typeof id !== 'number' || !Number.isInteger(id) || !tabs.has(id)) {
    throw new Error('Unknown browser tab. Call browser_tabs to view active tab IDs.');
  }
  return tabs.get(id);
}

export function safeUrl(raw: string): string {
  if (raw.trim() === 'about:blank') return 'about:blank';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP(S) URLs without embedded credentials are allowed');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === '169.254.169.254' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '0:0:0:0:0:0:0:0' ||
    host.endsWith(':169.254.169.254') ||
    host.endsWith(':a9fe:a9fe') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error(`Blocked unsafe or cloud metadata URL host: ${url.hostname}`);
  }
  return url.href;
}

function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return raw === 'about:blank' ? raw : '[unavailable]';
  }
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (launching) {
    try {
      await launching;
    } catch {}
  }
  const current = context;
  const dir = profile;
  context = undefined;
  profile = undefined;
  tabs.clear();
  lastElementMap.clear();
  try {
    if (current) await current.close();
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function escapeCssAttr(val: string): string {
  return val.replace(/["\\]/g, '\\$&');
}

/**
 * Resilient element resolver with SPA stale reference recovery.
 * Resolves by ref attribute, and falls back to semantic metadata (aria-label, name, text, cssPath).
 */
export async function resolveElementLocator(
  page: any,
  rawSelectorOrRef: string
): Promise<{ locator: any; ref: string }> {
  let targetRef = rawSelectorOrRef.trim();
  let primarySelector = targetRef;

  // Normalize ref format: e.g. "e1", "1", "[data-tbot-ref=\"e1\"]"
  const refMatch = targetRef.match(/\[data-tbot-ref=["']?([^"'\]]+)["']?\]/);
  if (refMatch) {
    targetRef = refMatch[1];
  } else if (/^(?:e)?\d+$/.test(targetRef)) {
    if (!targetRef.startsWith('e')) {
      targetRef = `e${targetRef}`;
    }
    primarySelector = `[data-tbot-ref="${targetRef}"]`;
  } else if (!targetRef.includes('=')) {
    // If user provided raw ref key like "e5" or "5"
    if (targetRef.startsWith('e') && /^\d+$/.test(targetRef.slice(1))) {
      primarySelector = `[data-tbot-ref="${targetRef}"]`;
    }
  }

  // 1. Try primary locator first
  let loc = page.locator(primarySelector);
  const count = await loc.count().catch(() => 0);
  if (count === 1) {
    return { locator: loc, ref: targetRef };
  }
  if (count > 1) {
    // Pick the first visible matching locator
    for (let i = 0; i < count; i++) {
      const nth = loc.nth(i);
      if (await nth.isVisible().catch(() => false)) {
        return { locator: nth, ref: targetRef };
      }
    }
    return { locator: loc.first(), ref: targetRef };
  }

  // 2. Stale reference recovery via lastElementMap metadata
  const meta = lastElementMap.get(targetRef) || lastElementMap.get(targetRef.replace(/^e/, ''));
  if (meta) {
    // Strategy A: aria-label
    if (meta.ariaLabel) {
      const byAria = page.locator(`[aria-label="${escapeCssAttr(meta.ariaLabel)}"]`);
      if ((await byAria.count().catch(() => 0)) > 0) {
        return { locator: byAria.first(), ref: targetRef };
      }
    }

    // Strategy B: name attribute
    if (meta.name) {
      const byName = page.locator(`[name="${escapeCssAttr(meta.name)}"]`);
      if ((await byName.count().catch(() => 0)) > 0) {
        return { locator: byName.first(), ref: targetRef };
      }
    }

    // Strategy C: placeholder
    if (meta.placeholder) {
      const byPlaceholder = page.locator(`[placeholder="${escapeCssAttr(meta.placeholder)}"]`);
      if ((await byPlaceholder.count().catch(() => 0)) > 0) {
        return { locator: byPlaceholder.first(), ref: targetRef };
      }
    }

    // Strategy D: role + accessible name/text
    if (meta.role && meta.text) {
      try {
        const byRoleText = page.getByRole(meta.role as any, { name: meta.text });
        if ((await byRoleText.count().catch(() => 0)) > 0) {
          return { locator: byRoleText.first(), ref: targetRef };
        }
      } catch {
        // role may not be standard ARIA
      }
    }

    // Strategy E: link href
    if (meta.tag === 'a' && meta.href) {
      const byHref = page.locator(`a[href="${escapeCssAttr(meta.href)}"]`);
      if ((await byHref.count().catch(() => 0)) > 0) {
        return { locator: byHref.first(), ref: targetRef };
      }
    }

    // Strategy F: exact or partial visible text
    if (meta.text && meta.text.length > 2) {
      const byText = page.getByText(meta.text, { exact: false });
      if ((await byText.count().catch(() => 0)) > 0) {
        return { locator: byText.first(), ref: targetRef };
      }
    }

    // Strategy G: CSS Path
    if (meta.cssPath) {
      const byCss = page.locator(meta.cssPath);
      if ((await byCss.count().catch(() => 0)) > 0) {
        return { locator: byCss.first(), ref: targetRef };
      }
    }
  }

  // Fall back to original locator if nothing else matched
  return { locator: loc, ref: targetRef };
}

export async function handleBrowserTool(
  name: string,
  args: Record<string, unknown>,
  options: { workspace: string; signal?: AbortSignal }
): Promise<string> {
  activeBrowserOps++;
  try {
    if (options.signal?.aborted) throw new Error('Operation cancelled');
    if (!options.signal) return await runBrowserTool(name, args, options);

    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        void closeBrowser().catch(() => {});
        reject(new Error('Operation cancelled'));
      };
      options.signal!.addEventListener('abort', onAbort, { once: true });
      if (options.signal!.aborted) onAbort();
    });

    try {
      return await Promise.race([runBrowserTool(name, args, options), cancelled]);
    } finally {
      if (onAbort) options.signal.removeEventListener('abort', onAbort);
    }
  } finally {
    activeBrowserOps--;
    lastBrowserActivityAt = Date.now();
  }
}

async function runBrowserTool(
  name: string,
  args: Record<string, unknown>,
  options: { workspace: string; signal?: AbortSignal }
): Promise<string> {
  if (options.signal?.aborted) throw new Error('Operation cancelled');

  if (name === 'browser_close') {
    await closeBrowser();
    return 'Browser closed.';
  }

  try {
    // Tab Management
    if (name === 'browser_tabs') {
      const action = (args.action as string) || 'list';
      if (action === 'new') {
        const ctx = await browser();
        const p = await ctx.newPage();
        const id = remember(p);
        if (typeof args.url === 'string' && args.url.trim()) {
          await p.goto(safeUrl(args.url), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        return JSON.stringify({ action: 'new', tab: id, url: displayUrl(p.url()), title: clean(await p.title()) });
      }

      if (action === 'close') {
        const page = await pageFor(args.tab);
        await page.close();
        return JSON.stringify({ action: 'close', status: 'closed' });
      }

      if (action === 'switch') {
        const page = await pageFor(args.tab);
        await page.bringToFront();
        return JSON.stringify({ action: 'switch', activeTab: args.tab, url: displayUrl(page.url()), title: clean(await page.title()) });
      }

      // Default: list tabs
      await browser();
      const list = await Promise.all(
        [...tabs].map(async ([id, p]) => ({
          id,
          url: displayUrl(p.url()),
          title: clean(cap(await p.title(), 300)),
        }))
      );
      return JSON.stringify(list);
    }

    if (name === 'browser_new_tab') {
      const ctx = await browser();
      const p = await ctx.newPage();
      const id = remember(p);
      if (typeof args.url === 'string' && args.url.trim()) {
        await p.goto(safeUrl(args.url), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      return JSON.stringify({ tab: id, url: displayUrl(p.url()), title: clean(await p.title()) });
    }

    const page = await pageFor(args.tab);

    if (name === 'browser_close_tab') {
      await page.close();
      return 'Tab closed.';
    }

    if (name === 'browser_navigate' || name === 'browser_open') {
      await page.goto(safeUrl(str(args.url, 'url')), { waitUntil: 'domcontentloaded', timeout: 20000 });
      return JSON.stringify({
        url: displayUrl(page.url()),
        title: clean(cap(await page.title(), 300)),
        dialogsCaptured: lastDialogHistory.length > 0 ? lastDialogHistory.slice(-3) : undefined,
      });
    }

    // Inspect: 200 elements, viewport priority, rich semantic tree
    if (name === 'browser_inspect') {
      const maxChars = args.maxChars === undefined ? 6000 : (args.maxChars as number);
      if (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 15000) {
        throw new Error('maxChars must be an integer between 1000 and 15000');
      }

      const previous = [...(snapshots.get(page) ?? [])];
      snapshots.delete(page);
      const generation = randomUUID().slice(0, 8);

      const data = await page.evaluate(
        ({ previous, generation, maxChars }: { previous: string[]; generation: string; maxChars: number }) => {
          const isVisible = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
          };

          const isInViewport = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth;
            const vh = window.innerHeight || document.documentElement.clientHeight;
            return r.bottom >= 0 && r.right >= 0 && r.top <= vh && r.left <= vw;
          };

          const getCssPath = (el: Element): string => {
            if (el.id) return `#${CSS.escape(el.id)}`;
            const parts: string[] = [];
            let curr: Element | null = el;
            while (curr && curr.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
              let selector = curr.tagName.toLowerCase();
              if (curr.id) {
                parts.unshift(`#${CSS.escape(curr.id)}`);
                break;
              }
              const parent: Element | null = curr.parentElement;
              if (parent) {
                const siblings = Array.from(parent.children).filter((c) => c.tagName === curr!.tagName);
                if (siblings.length > 1) {
                  const idx = siblings.indexOf(curr) + 1;
                  selector += `:nth-of-type(${idx})`;
                }
              }
              parts.unshift(selector);
              curr = parent;
            }
            return parts.join(' > ');
          };

          // Remove previous inspection attributes
          for (const sel of previous) {
            document.querySelector(sel)?.removeAttribute('data-tbot-ref');
          }

          // Extract visible page text
          let text = '';
          const textLimit = Math.min(6000, Math.floor(maxChars / 2));
          const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (text.length >= textLimit) break;
            const parent = node.parentElement;
            if (parent && isVisible(parent) && !parent.closest('script, style, noscript, textarea, select')) {
              const val = (node.textContent || '').trim().replace(/\s+/g, ' ');
              if (val) {
                text += (text ? ' ' : '') + val;
              }
            }
          }

          // Query interactive elements up to 200 elements, prioritized by viewport
          const INTERACTIVE_SELECTOR =
            'button, a, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="combobox"], [contenteditable="true"], [onclick]';
          const allInteractive = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
          const visible = allInteractive.filter(isVisible);

          const inView: Element[] = [];
          const outOfView: Element[] = [];
          for (const el of visible) {
            if (isInViewport(el)) inView.push(el);
            else outOfView.push(el);
          }

          const candidates = inView.concat(outOfView).slice(0, 200);

          const items = candidates.map((el, index) => {
            const htmlEl = el as HTMLElement;
            const ref = `e${index + 1}`;
            htmlEl.setAttribute('data-tbot-ref', ref);
            const input = el as HTMLInputElement;

            const sensitive = /password|secret|token|api.?key|card|cvv|cvc|otp|one.?time/i.test(
              [input.type, input.name, input.id, input.autocomplete, htmlEl.getAttribute('aria-label')].join(' ')
            );

            const role = htmlEl.getAttribute('role') || htmlEl.tagName.toLowerCase();
            const ariaLabel = htmlEl.getAttribute('aria-label') || '';
            const name = htmlEl.getAttribute('name') || '';
            const placeholder = htmlEl.getAttribute('placeholder') || '';
            const href = htmlEl.getAttribute('href') || '';
            const textContent = (htmlEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);

            const label = sensitive
              ? '[sensitive field]'
              : (ariaLabel || placeholder || textContent || name || '').slice(0, 150);

            return {
              ref,
              selector: `[data-tbot-ref="${ref}"]`,
              tag: htmlEl.tagName.toLowerCase(),
              role,
              ariaLabel,
              name,
              placeholder,
              href,
              cssPath: getCssPath(htmlEl),
              text: textContent,
              label,
              type: input.type || undefined,
              inViewport: isInViewport(htmlEl),
            };
          });

          return { text, items };
        },
        { previous, generation, maxChars }
      );

      // Save snapshots and populate lastElementMap for durable recovery
      snapshots.set(page, new Set<string>(data.items.map((i: { selector: string }) => i.selector)));
      lastElementMap.clear();
      for (const item of data.items) {
        lastElementMap.set(item.ref, {
          role: item.role,
          text: item.text,
          ariaLabel: item.ariaLabel,
          name: item.name,
          tag: item.tag,
          href: item.href,
          cssPath: item.cssPath,
          placeholder: item.placeholder,
        });
      }

      return cap(
        JSON.stringify(
          {
            url: displayUrl(page.url()),
            title: clean(await page.title()),
            text: data.text,
            elementCount: data.items.length,
            elements: data.items,
          },
          (_k, v) => (typeof v === 'string' ? clean(v) : v)
        ),
        maxChars
      );
    }

    // Click: Resilient element resolution
    if (name === 'browser_click') {
      const rawTarget = typeof args.ref === 'string' && args.ref.trim() ? args.ref : str(args.selector, 'selector or ref');
      const { locator, ref } = await resolveElementLocator(page, rawTarget);
      if ((await locator.count().catch(() => 0)) === 0) {
        throw new Error(`Element "${rawTarget}" not found. Inspect the page again.`);
      }
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 10000 });
      return `Clicked element ${ref}.`;
    }

    // Type / Fill: Resilient form filling
    if (name === 'browser_type' || name === 'browser_fill') {
      const rawTarget = typeof args.ref === 'string' && args.ref.trim() ? args.ref : str(args.selector, 'selector or ref');
      const value = typeof args.value === 'string' ? args.value : (() => { throw new Error('value must be a string'); })();
      const clearFirst = args.clear !== false;

      const { locator, ref } = await resolveElementLocator(page, rawTarget);
      if ((await locator.count().catch(() => 0)) === 0) {
        throw new Error(`Element "${rawTarget}" not found. Inspect the page again.`);
      }

      const isSensitive = await locator.evaluate((el: Element) => {
        const e = el as HTMLInputElement;
        return /password|secret|token|api.?key|card|cvv|cvc|otp|one.?time/i.test(
          [e.type, e.name, e.id, e.autocomplete, e.getAttribute('aria-label'), e.getAttribute('placeholder')].join(' ')
        );
      }).catch(() => false);

      if (isSensitive) {
        throw new Error('Filling sensitive credentials or payment fields is not allowed.');
      }

      await locator.scrollIntoViewIfNeeded().catch(() => {});
      if (clearFirst) {
        await locator.fill(value, { timeout: 10000 });
      } else {
        await locator.type(value, { timeout: 10000 });
      }
      return `Typed into element ${ref}.`;
    }

    // Hover
    if (name === 'browser_hover') {
      const rawTarget = typeof args.ref === 'string' && args.ref.trim() ? args.ref : str(args.selector, 'selector or ref');
      const { locator, ref } = await resolveElementLocator(page, rawTarget);
      if ((await locator.count().catch(() => 0)) === 0) {
        throw new Error(`Element "${rawTarget}" not found. Inspect the page again.`);
      }
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.hover({ timeout: 10000 });
      return `Hovered over element ${ref}.`;
    }

    // Scroll
    if (name === 'browser_scroll') {
      if (typeof args.ref === 'string' && args.ref.trim()) {
        const { locator, ref } = await resolveElementLocator(page, args.ref);
        if ((await locator.count().catch(() => 0)) > 0) {
          await locator.scrollIntoViewIfNeeded({ timeout: 10000 });
          return `Scrolled to element ${ref}.`;
        }
      }

      const direction = (args.direction as string) || 'down';
      const amount = typeof args.amount === 'number' && Number.isInteger(args.amount) ? args.amount : 600;

      await page.evaluate(({ direction, amount }: { direction: string; amount: number }) => {
        if (direction === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (direction === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        } else if (direction === 'up') {
          window.scrollBy({ top: -amount, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: amount, behavior: 'smooth' });
        }
      }, { direction, amount });

      return `Scrolled ${direction} ${amount}px.`;
    }

    // Press Key
    if (name === 'browser_press') {
      const key = str(args.key, 'key');
      await page.keyboard.press(key);
      return `Pressed key "${key}".`;
    }

    // Evaluate JavaScript
    if (name === 'browser_evaluate') {
      const script = str(args.script, 'script');
      const evalResult = await page.evaluate((code: string) => {
        // eslint-disable-next-line no-eval
        return window.eval(code);
      }, script);
      const serialized = typeof evalResult === 'object' && evalResult !== null ? JSON.stringify(evalResult) : String(evalResult);
      return cap(serialized, 6000);
    }

    // Screenshot with Set-of-Marks (SoM) and smart masking
    if (name === 'browser_screenshot') {
      const dir = join(options.workspace, '.tbot', 'screenshots');
      await mkdir(dir, { recursive: true });
      const path = join(dir, `browser-${Date.now()}.png`);

      const annotate = args.annotate !== false;
      const maskInputs = args.mask_inputs === true;

      if (annotate) {
        // Inject Set-of-Marks overlay
        await page.evaluate(() => {
          document.getElementById('__tbot_som_overlay__')?.remove();
          const overlay = document.createElement('div');
          overlay.id = '__tbot_som_overlay__';
          overlay.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:visible;';

          const elements = Array.from(document.querySelectorAll('[data-tbot-ref]'));
          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const ref = el.getAttribute('data-tbot-ref') || '';
            if (!ref) continue;

            const badge = document.createElement('div');
            badge.textContent = `[${ref}]`;
            badge.style.cssText = [
              'position:absolute',
              `top:${Math.max(0, rect.top + window.scrollY)}px`,
              `left:${Math.max(0, rect.left + window.scrollX)}px`,
              'background-color:#94D82D',
              'color:#0B130E',
              'font-size:11px',
              'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
              'font-weight:700',
              'line-height:1.2',
              'padding:1px 4px',
              'border:1.5px solid #0B130E',
              'border-radius:3px',
              'box-shadow:0 2px 4px rgba(0,0,0,0.5)',
              'pointer-events:none',
              'z-index:2147483647',
              'display:inline-block',
              'white-space:nowrap',
            ].join(';');
            overlay.appendChild(badge);
          }
          document.body?.appendChild(overlay);
        }).catch(() => {});
      }

      try {
        const maskLocators: any[] = [];
        // Always mask password inputs for privacy/security
        const passwordLocator = page.locator('input[type="password"]');
        if ((await passwordLocator.count().catch(() => 0)) > 0) {
          maskLocators.push(passwordLocator);
        }

        if (maskInputs) {
          const allInputs = page.locator('input, textarea, select, [contenteditable="true"]');
          if ((await allInputs.count().catch(() => 0)) > 0) {
            maskLocators.push(allInputs);
          }
        }

        await page.screenshot({
          path,
          mask: maskLocators.length > 0 ? maskLocators : undefined,
          timeout: 15000,
        });
      } finally {
        if (annotate) {
          await page.evaluate(() => {
            document.getElementById('__tbot_som_overlay__')?.remove();
          }).catch(() => {});
        }
      }

      return `Screenshot saved: ${path}`;
    }

    throw new Error(`Unknown browser tool: ${name}`);
  } finally {
    resetIdleTimer();
  }
}
