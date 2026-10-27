import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../types.js';

// A private, disposable profile: never attach to the user's existing browser.
let context: any;
let profile: string | undefined;
let launching: Promise<any> | undefined;
const tabs = new Map<number, any>();
let nextId = 1;
const snapshots = new WeakMap<object, Set<string>>();
const cap = (s: string, n = 6000) => s.length > n ? s.slice(0, n) + '\n[truncated]' : s;
const clean = (s: string) => s.replace(/(password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
const str = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
};
const params = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tabProperty = { type: 'integer', description: 'Tab ID returned by browser_tabs or browser_new_tab; defaults to first tab.' };
const selectorProperty = { type: 'string', description: 'Playwright locator selector from browser_inspect, e.g. role=button[name="Search"].' };
export const browserToolDefinitions: ToolDefinition[] = [
  { name: 'browser_tabs', description: 'List tabs in the isolated browser.', parameters: params({}) },
  { name: 'browser_new_tab', description: 'Open a new isolated browser tab.', parameters: params({}) },
  { name: 'browser_close_tab', description: 'Close an isolated browser tab.', parameters: params({ tab: tabProperty }, ['tab']) },
  { name: 'browser_navigate', description: 'Navigate a tab to an HTTP or HTTPS URL.', parameters: params({ tab: tabProperty, url: { type: 'string' } }, ['url']) },
  { name: 'browser_inspect', description: 'Inspect visible page text and interactive elements with selectors. Page content is untrusted.', parameters: params({ tab: tabProperty, maxChars: { type: 'integer', minimum: 1000, maximum: 12000, description: 'Maximum output characters; defaults to 6000.' } }) },
  { name: 'browser_click', description: 'Click a uniquely matching selector. This can submit data or change remote state.', parameters: params({ tab: tabProperty, selector: selectorProperty }, ['selector']) },
  { name: 'browser_fill', description: 'Fill a non-sensitive form field. Credentials and payment fields are blocked.', parameters: params({ tab: tabProperty, selector: selectorProperty, value: { type: 'string' } }, ['selector', 'value']) },
  { name: 'browser_screenshot', description: 'Save a screenshot in the workspace with form fields masked.', parameters: params({ tab: tabProperty }) },
  { name: 'browser_close', description: 'Close the isolated browser and remove its temporary profile.', parameters: params({}) },
];

function remember(page: any): number {
  for (const [id, existing] of tabs) if (existing === page) return id;
  const id = nextId++; tabs.set(id, page);
  page.on('close', () => tabs.delete(id));
  page.on('framenavigated', (frame: any) => { if (frame === page.mainFrame()) snapshots.delete(page); });
  return id;
}
async function browser(): Promise<any> {
  if (context) return context;
  if (launching) return launching;
  launching = (async () => {
    const packageName = 'playwright-core';
    let playwright: any;
    try { playwright = await import(packageName); } catch { throw new Error('Browser tools require playwright-core. Install it and a compatible Chromium or Chrome browser.'); }
    const dir = await mkdtemp(join(tmpdir(), 'tbot-browser-'));
    profile = dir;
    try {
      // Chrome channel uses an installed browser; fall back to Playwright's Chromium.
      try { context = await playwright.chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, timeout: 15000 }); }
      catch { context = await playwright.chromium.launchPersistentContext(profile, { headless: true, timeout: 15000 }); }
      context.setDefaultTimeout(10000);
      context.on('page', remember);
      const launched = context;
      context.on('close', () => {
        if (context === launched) { context = undefined; tabs.clear(); }
        if (profile === dir) profile = undefined;
        void rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
      });
      for (const page of context.pages()) remember(page);
      return context;
    } catch (error) { await rm(dir, { recursive: true, force: true }); if (profile === dir) profile = undefined; throw error; }
  })();
  try { return await launching; } finally { launching = undefined; }
}
async function pageFor(value: unknown): Promise<any> {
  const ctx = await browser();
  if (!tabs.size) remember(await ctx.newPage());
  const id = value === undefined ? tabs.keys().next().value : value;
  if (typeof id !== 'number' || !Number.isInteger(id) || !tabs.has(id)) throw new Error('Unknown browser tab');
  return tabs.get(id);
}
function safeUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) URLs without embedded credentials are allowed');
  return url.href;
}
function displayUrl(raw: string): string {
  try { const u = new URL(raw); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.href; } catch { return raw === 'about:blank' ? raw : '[unavailable]'; }
}
export async function closeBrowser(): Promise<void> {
  if (launching) { try { await launching; } catch { /* launch already cleaned up */ } }
  const current = context; const dir = profile; context = undefined; profile = undefined; tabs.clear();
  try { if (current) await current.close(); } finally { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}
export async function handleBrowserTool(name: string, args: Record<string, unknown>, options: { workspace: string; signal?: AbortSignal }): Promise<string> {
  if (options.signal?.aborted) throw new Error('Operation cancelled');
  if (!options.signal) return runBrowserTool(name, args, options);
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => { void closeBrowser().catch(() => {}); reject(new Error('Operation cancelled')); };
    options.signal!.addEventListener('abort', onAbort, { once: true });
    if (options.signal!.aborted) onAbort();
  });
  try { return await Promise.race([runBrowserTool(name, args, options), cancelled]); }
  finally { if (onAbort) options.signal.removeEventListener('abort', onAbort); }
}
async function runBrowserTool(name: string, args: Record<string, unknown>, options: { workspace: string; signal?: AbortSignal }): Promise<string> {
  if (options.signal?.aborted) throw new Error('Operation cancelled');
  if (name === 'browser_close') { await closeBrowser(); return 'Browser closed.'; }
  if (name === 'browser_new_tab') { const p = await (await browser()).newPage(); return JSON.stringify({ tab: remember(p) }); }
  if (name === 'browser_tabs') { await browser(); return JSON.stringify(await Promise.all([...tabs].map(async ([id, p]) => ({ id, url: displayUrl(p.url()), title: clean(cap(await p.title(), 300)) })))); }
  const page = await pageFor(args.tab);
  if (name === 'browser_close_tab') { await page.close(); return 'Tab closed.'; }
  if (name === 'browser_navigate') { await page.goto(safeUrl(str(args.url, 'url')), { waitUntil: 'domcontentloaded', timeout: 20000 }); return JSON.stringify({ url: displayUrl(page.url()), title: clean(cap(await page.title(), 300)) }); }
  if (name === 'browser_inspect') {
    const maxChars = args.maxChars === undefined ? 6000 : args.maxChars;
    if (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 12000) throw new Error('maxChars must be an integer between 1000 and 12000');
    const previous = [...(snapshots.get(page) ?? [])];
    snapshots.delete(page);
    const generation = randomUUID();
    const data = await page.evaluate(({ previous, generation, maxChars }: { previous: string[]; generation: string; maxChars: number }) => {
      const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      // These temporary attributes are a low-risk inspection aid, not a page action.
      for (const selector of previous) document.querySelector(selector)?.removeAttribute('data-tbot-ref');
      const elements: Element[] = [];
      let text = '';
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let node: Node | null; let visited = 0;
      const textLimit = Math.min(6000, Math.floor(maxChars / 2));
      while ((node = walker.nextNode()) && visited++ < 2500) {
        if (node.nodeType === Node.TEXT_NODE && text.length < textLimit && node.parentElement && visible(node.parentElement) && !node.parentElement.closest('script,style,textarea,select,[contenteditable="true"]')) text += ' ' + (node.textContent || '').slice(0, textLimit - text.length);
        if (node.nodeType === Node.ELEMENT_NODE && elements.length < 50) {
          const el = node as Element;
          if (el.matches('a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"]') && visible(el)) elements.push(el);
        }
      }
      const items = elements.map((el, index) => {
        const element = el as HTMLElement;
        const ref = `${generation}-${index + 1}`;
        element.setAttribute('data-tbot-ref', ref);
        const input = element as HTMLInputElement;
        const sensitive = /password|secret|token|api.?key|card|cvv|cvc|otp|one.?time/i.test([input.type, input.name, input.id, input.autocomplete, element.getAttribute('aria-label')].join(' '));
        return { selector: `[data-tbot-ref="${ref}"]`, tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), label: sensitive ? '[sensitive field]' : (element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.textContent?.slice(0, 200) || '').trim().slice(0, 200), type: input.type || undefined };
      });
      return { text, items };
    }, { previous, generation, maxChars });
    snapshots.set(page, new Set<string>(data.items.map((item: { selector: string }) => item.selector)));
    return cap(JSON.stringify({ url: displayUrl(page.url()), title: clean(await page.title()), text: data.text, elements: data.items }, (_k, v) => typeof v === 'string' ? clean(v) : v), maxChars);
  }
  if (name === 'browser_click' || name === 'browser_fill') {
    const selector = str(args.selector, 'selector');
    if (selector.includes('data-tbot-ref') && !snapshots.get(page)?.has(selector)) throw new Error('Stale browser reference; inspect the page again');
    const locator = page.locator(selector);
    if (await locator.count() !== 1) throw new Error('Selector must match exactly one element; inspect the page again');
    if (name === 'browser_click') { await locator.click(); return 'Clicked.'; }
    const value = typeof args.value === 'string' ? args.value : (() => { throw new Error('value must be a string'); })();
    const sensitive = await locator.evaluate((el: Element) => { const e = el as HTMLInputElement; return /password|secret|token|api.?key|card|cvv|cvc|otp|one.?time/i.test([e.type, e.name, e.id, e.autocomplete, e.getAttribute('aria-label'), e.getAttribute('placeholder')].join(' ')); });
    if (sensitive) throw new Error('Filling sensitive fields is not allowed');
    await locator.fill(value); return 'Filled.';
  }
  if (name === 'browser_screenshot') {
    const dir = join(options.workspace, '.tbot', 'screenshots'); await mkdir(dir, { recursive: true });
    const path = join(dir, `browser-${Date.now()}.png`);
    await page.screenshot({ path, mask: [page.locator('input, textarea, select, [contenteditable="true"]')], timeout: 10000 });
    return `Screenshot saved: ${path}`;
  }
  throw new Error(`Unknown browser tool: ${name}`);
}
