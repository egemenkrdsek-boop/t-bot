import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../sessions.js';
import { assertPublicHttpUrl, isLoopback } from '../security/url.js';
import { isSensitivePath, resolveWorkspacePath } from '../security/paths.js';
import { GUI_WARM_IDLE_MS, guiObservation, MAX_BATCH_STEPS, validateBatchSteps } from './gui-policy.js';
import { createScreenshotPath, pruneScreenshots, sweepStaleBrowserProfiles } from './screenshot-store.js';
// A private, disposable profile: never attach to the user's existing browser.
let context;
let profile;
let launching;
let currentHeadless;
let activeTabId;
const tabs = new Map();
let nextId = 1;
const snapshots = new WeakMap();
let idleTimer;
const BROWSER_IDLE_TIMEOUT_MS = GUI_WARM_IDLE_MS;
let lastBrowserActivityAt = 0;
let activeBrowserOps = 0;
/** Last console/page-error records for the browser session (bounded). */
export const consoleHistory = [];
const MAX_CONSOLE_RECORDS = 200;
/** Loopback navigation is opt-in: per call (`allow_local`) or via env. */
const envLocalNavigationAllowed = process.env.TBOT_BROWSER_ALLOW_LOCAL === 'true';
// Set only for the duration of one approved navigation (goto + its redirects).
let activeLocalNavigation = false;
function recordConsole(type, text, location) {
    consoleHistory.push({ type, text: clean(text).slice(0, 2000), ...(location ? { location } : {}), timestamp: Date.now() });
    if (consoleHistory.length > MAX_CONSOLE_RECORDS)
        consoleHistory.splice(0, consoleHistory.length - MAX_CONSOLE_RECORDS);
}
/** Append a tab-fallback note without breaking JSON tool output. */
function applyTabNote(output, note) {
    if (!note)
        return output;
    try {
        const parsed = JSON.parse(output);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return JSON.stringify({ ...parsed, tabNote: note });
        }
    }
    catch { /* plain text result */ }
    return `${output}\nNote: ${note}`;
}
/**
 * `tsx`/esbuild with `keepNames` injects `__name(...)` calls into function
 * bodies it transforms. Playwright serializes the callback source into the page,
 * where that module-scope helper does not exist, so every inspect/read evaluate
 * failed with "ReferenceError: __name is not defined". Define a no-op global in
 * the page before each evaluation; it is idempotent and cheap.
 */
const PAGE_NAME_SHIM = 'window.__name = window.__name || function (fn) { return fn; };';
async function evaluatePage(page, fn, arg) {
    await page.evaluate(PAGE_NAME_SHIM).catch(() => undefined);
    return arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg);
}
// Persistent fallback semantic selector memory for resilient SPA recovery
export const lastElementMap = new Map();
export const lastDialogHistory = [];
export function resetIdleTimer() {
    lastBrowserActivityAt = Date.now();
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
    }
    if (context || launching) {
        idleTimer = setTimeout(() => {
            if (activeBrowserOps === 0) {
                void closeBrowser().catch(() => { });
            }
        }, BROWSER_IDLE_TIMEOUT_MS);
        idleTimer.unref();
    }
}
export async function closeIdleBrowser(idleThresholdMs = GUI_WARM_IDLE_MS) {
    if (activeBrowserOps === 0 && Date.now() - lastBrowserActivityAt > idleThresholdMs) {
        if (context || launching) {
            await closeBrowser();
        }
    }
}
const cap = (s, n = 6000) => (s.length > n ? s.slice(0, n) + '\n[truncated]' : s);
const clean = (s) => redactSecrets(s);
const str = (value, label) => {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${label} must be a non-empty string`);
    return value.trim();
};
const params = (properties, required = []) => ({
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
    description: 'Playwright selector or element ref (e.g. "e1") from browser_inspect.',
};
const textTargetProperty = {
    type: 'string',
    description: 'Visible text, button label or accessible name of the element (e.g. "Sign in"). Used when selector/ref are not available.',
};
const autoScreenshotProperty = {
    type: 'boolean',
    description: 'Deprecated compatibility alias: true requests a visual Set-of-Marks observation. Default is a cheap page-state observation.',
};
const observeProperty = {
    type: 'string',
    enum: ['none', 'state', 'visual'],
    description: 'Post-action observation: state (default) returns URL/title only; visual adds a Set-of-Marks screenshot; none returns the action result only.',
};
const headlessProperty = {
    type: 'boolean',
    description: 'Run browser in headless mode (defaults to false for visible interactive mode).',
};
export const browserToolDefinitions = [
    {
        name: 'browser_tabs',
        description: 'Manage browser tabs (list, switch, open new, or close tab).',
        parameters: params({
            action: { type: 'string', enum: ['list', 'switch', 'new', 'close'], description: 'Tab operation to perform; defaults to "list".' },
            tab: tabProperty,
            url: { type: 'string', description: 'URL when opening a new tab.' },
            headless: headlessProperty,
        }),
    },
    {
        name: 'browser_new_tab',
        description: 'Open a new isolated browser tab and return its tab ID.',
        parameters: params({
            url: { type: 'string', description: 'Initial URL to navigate to.' },
            headless: headlessProperty,
        }),
    },
    {
        name: 'browser_close_tab',
        description: 'Close an isolated browser tab by tab ID.',
        parameters: params({ tab: tabProperty }, ['tab']),
    },
    {
        name: 'browser_navigate',
        description: 'Navigate a tab to an HTTP(S) URL. Every navigation redirect is validated against the public-URL policy; loopback URLs need allow_local: true.',
        parameters: params({
            tab: tabProperty,
            url: { type: 'string', description: 'Target HTTP or HTTPS URL.' },
            headless: headlessProperty,
            allow_local: { type: 'boolean', description: 'Allow a localhost/127.0.0.1 URL for local development. Private LAN and metadata addresses stay blocked.' },
            auto_screenshot: autoScreenshotProperty,
            observe: observeProperty,
        }, ['url']),
    },
    {
        name: 'browser_open',
        description: 'Open or navigate an isolated browser tab to an HTTP(S) URL in visible mode by default. Same URL policy and allow_local opt-in as browser_navigate.',
        parameters: params({
            tab: tabProperty,
            url: { type: 'string', description: 'Target HTTP or HTTPS URL.' },
            headless: headlessProperty,
            allow_local: { type: 'boolean', description: 'Allow a localhost/127.0.0.1 URL for local development.' },
            auto_screenshot: autoScreenshotProperty,
            observe: observeProperty,
        }, ['url']),
    },
    {
        name: 'browser_inspect',
        description: 'Inspect visible page text and up to 120 interactive elements ordered by viewport visibility. Captures semantic metadata for durable selectors.',
        parameters: params({
            tab: tabProperty,
            maxChars: { type: 'integer', minimum: 1000, maximum: 15000, description: 'Maximum output characters; defaults to 6000.' },
        }),
    },
    {
        name: 'browser_click',
        description: 'Click an element. Provide selector, ref (from browser_inspect) or text (visible label). A stale ref triggers one automatic re-inspect; an unknown tab falls back to the active tab.',
        parameters: params({
            tab: tabProperty,
            selector: selectorProperty,
            ref: { type: 'string', description: 'Element ref from browser_inspect (e.g. "e3" or "3").' },
            text: textTargetProperty,
            auto_screenshot: autoScreenshotProperty,
            observe: observeProperty,
        }),
    },
    {
        name: 'browser_type',
        description: 'Type into an input or editable field. Target it with selector/ref/text; if none is given the focused field is used. Clears the field by default.',
        parameters: params({
            tab: tabProperty,
            selector: selectorProperty,
            ref: { type: 'string', description: 'Element ref from browser_inspect (e.g. "e3" or "3").' },
            text: textTargetProperty,
            value: { type: 'string', description: 'Text to type into the field.' },
            clear: { type: 'boolean', description: 'Whether to clear existing text before typing; defaults to true.' },
            auto_screenshot: autoScreenshotProperty,
            observe: observeProperty,
        }, ['value']),
    },
    {
        name: 'browser_fill',
        description: 'Fill a form field (alias for browser_type with clear=true).',
        parameters: params({
            tab: tabProperty,
            selector: selectorProperty,
            ref: { type: 'string', description: 'Element ref from browser_inspect (e.g. "e3" or "3").' },
            text: textTargetProperty,
            value: { type: 'string', description: 'Text to fill into the field.' },
            auto_screenshot: autoScreenshotProperty,
            observe: observeProperty,
        }, ['value']),
    },
    {
        name: 'browser_hover',
        description: 'Hover an element to reveal dropdowns, menus or tooltips. Target with selector/ref/text.',
        parameters: params({
            tab: tabProperty,
            selector: selectorProperty,
            ref: { type: 'string', description: 'Element ref from browser_inspect (e.g. "e3" or "3").' },
            text: textTargetProperty,
            auto_screenshot: autoScreenshotProperty,
        }),
    },
    {
        name: 'browser_scroll',
        description: 'Scroll the page vertically or scroll directly to a specific element ref with live visual feedback.',
        parameters: params({
            tab: tabProperty,
            direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'], description: 'Scroll direction; defaults to "down".' },
            amount: { type: 'integer', description: 'Pixels to scroll; defaults to 600.' },
            ref: { type: 'string', description: 'Optional element ref to scroll directly into view.' },
            auto_screenshot: autoScreenshotProperty,
        }),
    },
    {
        name: 'browser_press',
        description: 'Press a keyboard key or combination (e.g. "Enter", "Escape", "Tab", "ArrowDown", "Control+a").',
        parameters: params({
            tab: tabProperty,
            key: { type: 'string', description: 'Key name according to Playwright conventions.' },
            auto_screenshot: autoScreenshotProperty,
            observe: observeProperty,
        }, ['key']),
    },
    {
        name: 'browser_evaluate',
        description: 'Execute JavaScript with the page’s permissions and return its JSON or string result. Requires approval.',
        parameters: params({ tab: tabProperty, script: { type: 'string', description: 'JavaScript code or expression to evaluate.' } }, ['script']),
    },
    {
        name: 'browser_screenshot',
        description: 'Capture a page screenshot. By default, overlays numbered Set-of-Marks (SoM) badges (#94D82D/#0B130E) over interactive elements and masks password fields.',
        parameters: params({
            tab: tabProperty,
            annotate: { type: 'boolean', description: 'Overlay Set-of-Marks (SoM) visual numbered badges over interactive elements; defaults to true.' },
            mask_inputs: { type: 'boolean', description: 'Mask all input and editable fields; defaults to false (password fields are always masked).' },
        }),
    },
    {
        name: 'browser_batch',
        description: 'Run up to 12 browser steps (navigate, click, fill, type, press, hover, scroll, wait, assert_text) under one approval, then return page state. Stops at the first failed step.',
        parameters: params({
            tab: tabProperty,
            steps: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_BATCH_STEPS,
                description: 'Ordered steps. Each needs an action; use ref/target for click/type and value for fill/type.',
                items: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['navigate', 'open', 'click', 'fill', 'type', 'press', 'hover', 'scroll', 'wait', 'assert_text'] },
                        ref: { type: 'string' },
                        selector: { type: 'string' },
                        value: { type: 'string' },
                        key: { type: 'string' },
                        url: { type: 'string' },
                        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
                        amount: { type: 'integer' },
                        text: { type: 'string' },
                        ms: { type: 'integer', minimum: 50, maximum: 5000 },
                    },
                    required: ['action'],
                    additionalProperties: false,
                },
            },
            observe: observeProperty,
        }, ['steps']),
    },
    {
        name: 'browser_wait_for',
        description: 'Wait until text becomes visible, the URL contains a substring, or network activity is idle. Provide at least one of text, url or network_idle.',
        parameters: params({
            tab: tabProperty,
            text: { type: 'string', description: 'Visible text to wait for.' },
            url: { type: 'string', description: 'URL substring to wait for.' },
            network_idle: { type: 'boolean', description: 'Wait for no network activity for 500ms.' },
            timeout_ms: { type: 'integer', minimum: 500, maximum: 30000, description: 'Maximum wait; defaults to 10000.' },
        }),
    },
    {
        name: 'browser_read',
        description: 'Return readable page content (headings, lists and links preserved as light Markdown) for reading or summarizing.',
        parameters: params({
            tab: tabProperty,
            maxChars: { type: 'integer', minimum: 1000, maximum: 20000, description: 'Maximum output characters; defaults to 8000.' },
        }),
    },
    {
        name: 'browser_console',
        description: 'Return recent console messages and uncaught page errors from the browser session.',
        parameters: params({
            limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Number of recent records; defaults to 50.' },
            clear: { type: 'boolean', description: 'Clear the buffer after reading.' },
        }),
    },
    {
        name: 'browser_download',
        description: 'Download a file by clicking selector/ref/text or by navigating url, then save it inside the workspace. Returns the saved path.',
        parameters: params({
            tab: tabProperty,
            selector: selectorProperty,
            ref: { type: 'string', description: 'Element ref that starts the download.' },
            text: textTargetProperty,
            url: { type: 'string', description: 'Direct URL to download instead of clicking.' },
            filename: { type: 'string', description: 'Optional file name; sanitized and stored under .tbot/downloads.' },
            timeout_ms: { type: 'integer', minimum: 1000, maximum: 60000, description: 'Download start timeout; defaults to 20000.' },
        }),
    },
    {
        name: 'browser_upload',
        description: 'Set files on a file input. Each path must stay inside the workspace; sensitive files are refused.',
        parameters: params({
            tab: tabProperty,
            selector: selectorProperty,
            ref: { type: 'string', description: 'Element ref of the file input.' },
            text: textTargetProperty,
            files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10, description: 'Workspace-relative file paths.' },
        }, ['files']),
    },
    {
        name: 'browser_close',
        description: 'Close the isolated browser session and purge its temporary profile directory.',
        parameters: params({}),
    },
];
export async function updateLiveBrowserHud(page, stepText) {
    if (!page || page.isClosed?.())
        return;
    try {
        await evaluatePage(page, (text) => {
            let hud = document.getElementById('__tbot_live_hud__');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = '__tbot_live_hud__';
                hud.style.cssText = [
                    'position: fixed',
                    'top: 10px',
                    'right: 14px',
                    'z-index: 2147483646',
                    'background-color: #0B130E',
                    'border: 1.5px solid #94D82D',
                    'border-radius: 8px',
                    'padding: 6px 12px',
                    'box-shadow: 0 4px 20px rgba(0, 0, 0, 0.85), 0 0 12px rgba(148, 216, 45, 0.35)',
                    'display: flex',
                    'align-items: center',
                    'gap: 10px',
                    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, monospace, sans-serif',
                    'font-size: 12px',
                    'color: #EEF5EB',
                    'pointer-events: none',
                    'user-select: none',
                    'backdrop-filter: blur(8px)',
                    'transition: all 0.2s ease',
                ].join(';');
                // Brand title: ◈ T BOT CANLI
                const brand = document.createElement('div');
                brand.id = '__tbot_live_hud_brand__';
                brand.innerHTML = '◈ <span style="font-weight: 800; letter-spacing: 0.5px;">T BOT CANLI</span>';
                brand.style.cssText = 'color: #94D82D; display: flex; align-items: center; gap: 4px; font-weight: 700; white-space: nowrap; pointer-events: none;';
                hud.appendChild(brand);
                // Divider
                const sep = document.createElement('div');
                sep.style.cssText = 'width: 1px; height: 16px; background: rgba(148, 216, 45, 0.4); pointer-events: none;';
                hud.appendChild(sep);
                // Active step text container
                const stepSpan = document.createElement('div');
                stepSpan.id = '__tbot_live_hud_step__';
                stepSpan.style.cssText = [
                    'color: #EEF5EB',
                    'font-weight: 500',
                    'max-width: 280px',
                    'overflow: hidden',
                    'text-overflow: ellipsis',
                    'white-space: nowrap',
                    'pointer-events: none',
                ].join(';');
                hud.appendChild(stepSpan);
                // Stop button: [⏹ DURDUR (ESC)]
                const stopBtn = document.createElement('button');
                stopBtn.id = '__tbot_live_hud_stop__';
                stopBtn.textContent = '⏹ DURDUR (ESC)';
                stopBtn.style.cssText = [
                    'background: #D32F2F',
                    'color: #FFFFFF',
                    'border: 1px solid #FF5252',
                    'border-radius: 5px',
                    'padding: 3px 9px',
                    'font-size: 11px',
                    'font-weight: 800',
                    'cursor: pointer',
                    'display: inline-flex',
                    'align-items: center',
                    'letter-spacing: 0.3px',
                    'box-shadow: 0 2px 6px rgba(211, 47, 47, 0.6)',
                    'pointer-events: auto',
                    'transition: background 0.15s ease',
                ].join(';');
                stopBtn.onmouseenter = () => { stopBtn.style.background = '#B71C1C'; };
                stopBtn.onmouseleave = () => { stopBtn.style.background = '#D32F2F'; };
                stopBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.__tbotUserAborted = true;
                    stopBtn.textContent = '⏹ DURDURULUYOR...';
                    stopBtn.style.background = '#7F0000';
                };
                hud.appendChild(stopBtn);
                (document.body || document.documentElement).appendChild(hud);
                // ESC key listener
                if (!window.__tbotEscListenerAttached) {
                    window.__tbotEscListenerAttached = true;
                    window.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            window.__tbotUserAborted = true;
                            const btn = document.getElementById('__tbot_live_hud_stop__');
                            if (btn) {
                                btn.textContent = '⏹ DURDURULUYOR...';
                                btn.style.background = '#7F0000';
                            }
                        }
                    }, { capture: true });
                }
            }
            const stepEl = document.getElementById('__tbot_live_hud_step__');
            if (stepEl) {
                stepEl.textContent = text;
                stepEl.title = text;
            }
        }, stepText);
    }
    catch {
        // Ignore if frame is in navigation transition
    }
}
export async function checkUserAborted(page) {
    if (!page || page.isClosed?.())
        return;
    try {
        const aborted = await evaluatePage(page, () => {
            const val = Boolean(window.__tbotUserAborted);
            if (val) {
                window.__tbotUserAborted = false;
            }
            return val;
        });
        if (aborted) {
            throw new Error('[ACİL DURDURMA - KULLANICI TARAYICI EKRANINDAN İŞLEMİ DURDURDU]');
        }
    }
    catch (err) {
        if (err && err.message && err.message.includes('[ACİL DURDURMA - KULLANICI TARAYICI EKRANINDAN İŞLEMİ DURDURDU]')) {
            throw err;
        }
    }
}
export async function highlightElementSpotlight(page, locator, ref) {
    if (!page || page.isClosed?.())
        return;
    try {
        const targetLoc = (await locator.count().catch(() => 0)) > 1 ? locator.first() : locator;
        await targetLoc.evaluate((el, refLabel) => {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 && rect.height <= 0)
                return;
            const oldSpotlight = document.getElementById('__tbot_spotlight_overlay__');
            if (oldSpotlight)
                oldSpotlight.remove();
            const container = document.createElement('div');
            container.id = '__tbot_spotlight_overlay__';
            container.style.cssText =
                'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;overflow:hidden;';
            // 450ms glowing #94D82D neon 3px border
            const box = document.createElement('div');
            box.style.cssText = [
                'position: fixed',
                `top: ${Math.max(0, rect.top - 3)}px`,
                `left: ${Math.max(0, rect.left - 3)}px`,
                `width: ${rect.width + 6}px`,
                `height: ${rect.height + 6}px`,
                'border: 3px solid #94D82D',
                'border-radius: 6px',
                'box-shadow: 0 0 18px rgba(148, 216, 45, 0.95), inset 0 0 12px rgba(148, 216, 45, 0.4)',
                'box-sizing: border-box',
                'pointer-events: none',
                'transition: all 0.2s ease',
            ].join(';');
            // Central ripple expanding ring
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const ripple = document.createElement('div');
            ripple.style.cssText = [
                'position: fixed',
                `top: ${centerY - 16}px`,
                `left: ${centerX - 16}px`,
                'width: 32px',
                'height: 32px',
                'border: 2.5px solid #94D82D',
                'border-radius: 50%',
                'background: rgba(148, 216, 45, 0.35)',
                'pointer-events: none',
                'box-sizing: border-box',
                'transform: scale(0.3)',
                'opacity: 1',
                'animation: __tbot_ripple_kf__ 0.45s cubic-bezier(0, 0.2, 0.8, 1) forwards',
            ].join(';');
            if (!document.getElementById('__tbot_ripple_style__')) {
                const style = document.createElement('style');
                style.id = '__tbot_ripple_style__';
                style.textContent = `
          @keyframes __tbot_ripple_kf__ {
            0% { transform: scale(0.3); opacity: 1; }
            100% { transform: scale(3.5); opacity: 0; }
          }
        `;
                document.head.appendChild(style);
            }
            container.appendChild(box);
            container.appendChild(ripple);
            (document.body || document.documentElement).appendChild(container);
            setTimeout(() => {
                container.remove();
            }, 450);
        }, ref || '').catch(() => { });
        // Hold briefly so a human can register the spotlight; this is not a page wait.
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    catch {
        // Gracefully continue if element evaluation fails
    }
}
export async function inspectPageElements(page, maxChars = 6000) {
    const previous = [...(snapshots.get(page) ?? [])];
    snapshots.delete(page);
    const generation = randomUUID().slice(0, 8);
    const data = await evaluatePage(page, ({ previous, generation, maxChars }) => {
        const isVisible = (el) => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
        };
        const isInViewport = (el) => {
            const r = el.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth;
            const vh = window.innerHeight || document.documentElement.clientHeight;
            return r.bottom >= 0 && r.right >= 0 && r.top <= vh && r.left <= vw;
        };
        const getCssPath = (el) => {
            if (el.id)
                return `#${CSS.escape(el.id)}`;
            const parts = [];
            let curr = el;
            while (curr && curr.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
                let selector = curr.tagName.toLowerCase();
                if (curr.id) {
                    parts.unshift(`#${CSS.escape(curr.id)}`);
                    break;
                }
                const parent = curr.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children).filter((c) => c.tagName === curr.tagName);
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
        let node;
        while ((node = walker.nextNode())) {
            if (text.length >= textLimit)
                break;
            const parent = node.parentElement;
            if (parent && isVisible(parent) && !parent.closest('script, style, noscript, textarea, select')) {
                const val = (node.textContent || '').trim().replace(/\s+/g, ' ');
                if (val) {
                    text += (text ? ' ' : '') + val;
                }
            }
        }
        // Query interactive elements up to 120 elements, prioritized by viewport
        const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="combobox"], [contenteditable="true"], [onclick]';
        const allInteractive = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
        const visible = allInteractive.filter(isVisible);
        const inView = [];
        const outOfView = [];
        for (const el of visible) {
            if (isInViewport(el))
                inView.push(el);
            else
                outOfView.push(el);
        }
        const candidates = inView.concat(outOfView).slice(0, 120);
        const items = candidates.map((el, index) => {
            const htmlEl = el;
            const ref = `e${index + 1}`;
            htmlEl.setAttribute('data-tbot-ref', ref);
            const input = el;
            const inViewport = isInViewport(htmlEl);
            const sensitive = /password|secret|token|api.?key|card|cvv|cvc|otp|one.?time/i.test([input.type, input.name, input.id, input.autocomplete, htmlEl.getAttribute('aria-label')].join(' '));
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
                cssPath: inViewport ? getCssPath(htmlEl) : '',
                text: textContent,
                label,
                type: input.type || undefined,
                inViewport,
            };
        });
        return { text, items };
    }, { previous, generation, maxChars });
    // Save snapshots and populate lastElementMap for durable recovery
    snapshots.set(page, new Set(data.items.map((i) => i.selector)));
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
    return data;
}
export async function captureAnnotatedScreenshotAndElements(page, workspace) {
    const baseDir = workspace ? workspace : process.cwd();
    const shotPath = await createScreenshotPath(baseDir, 'browser');
    // 1. Scan page elements & update refs
    const { items } = await inspectPageElements(page);
    // 2. Inject Set-of-Marks visual overlay badges
    await evaluatePage(page, () => {
        document.getElementById('__tbot_som_overlay__')?.remove();
        const overlay = document.createElement('div');
        overlay.id = '__tbot_som_overlay__';
        overlay.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:visible;';
        const elements = Array.from(document.querySelectorAll('[data-tbot-ref]'));
        for (const el of elements) {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
                continue;
            const ref = el.getAttribute('data-tbot-ref') || '';
            if (!ref)
                continue;
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
    }).catch(() => { });
    try {
        const maskLocators = [];
        const passwordLocator = page.locator('input[type="password"]');
        if ((await passwordLocator.count().catch(() => 0)) > 0) {
            maskLocators.push(passwordLocator);
        }
        await page.screenshot({
            path: shotPath,
            mask: maskLocators.length > 0 ? maskLocators : undefined,
            timeout: 15000,
        });
    }
    finally {
        await evaluatePage(page, () => {
            document.getElementById('__tbot_som_overlay__')?.remove();
        }).catch(() => { });
    }
    const title = clean(cap(await page.title().catch(() => 'Sayfa'), 200));
    const url = displayUrl(page.url?.() || '');
    const elementLines = items.slice(0, 50).map((it) => {
        const desc = it.label || it.text || it.placeholder || it.name || '';
        const extra = it.href ? ` -> ${it.href}` : '';
        return `- [${it.ref}] <${it.tag}${it.role && it.role !== it.tag ? ` role="${it.role}"` : ''}> "${desc.slice(0, 60)}"${extra}`;
    });
    const elementSummary = elementLines.length > 0
        ? elementLines.join('\n') + (items.length > 50 ? `\n... (+${items.length - 50} daha)` : '')
        : '(Etkileşimli öğe bulunamadı)';
    return {
        screenshotPath: shotPath,
        title,
        url,
        elementSummary,
    };
}
function formatWithObservation(obs, actionResult) {
    return `Screenshot saved: ${obs.screenshotPath}\nSayfa: ${obs.title} (${obs.url})\nGüncel Etkileşimli Öğeler:\n${obs.elementSummary}\n\n${actionResult}`;
}
async function observeBrowserResult(page, workspace, args, actionResult) {
    const mode = guiObservation(args);
    if (mode === 'none')
        return actionResult;
    if (mode === 'visual') {
        try {
            const obs = await captureAnnotatedScreenshotAndElements(page, workspace);
            return formatWithObservation(obs, actionResult);
        }
        catch {
            return actionResult;
        }
    }
    const title = clean(cap(await page.title().catch(() => 'Sayfa'), 200));
    return `${actionResult}\nPage: ${title} (${displayUrl(page.url?.() || '')})`;
}
function setupPageHandlers(page) {
    page.on('console', (message) => {
        try {
            recordConsole(String(message.type?.() ?? 'log'), String(message.text?.() ?? ''), message.location?.()?.url);
        }
        catch { /* ignore */ }
    });
    page.on('pageerror', (error) => {
        recordConsole('pageerror', error?.message ? String(error.message) : String(error));
    });
    // Avoid freezing on dialogs without implicitly approving page confirmations.
    page.on('dialog', async (dialog) => {
        try {
            const type = dialog.type();
            const message = dialog.message();
            lastDialogHistory.push({ type, message, timestamp: Date.now() });
            if (lastDialogHistory.length > 30)
                lastDialogHistory.shift();
            await dialog.dismiss().catch(() => { });
        }
        catch {
            // ignore dialog handling errors
        }
    });
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            snapshots.delete(page);
        }
    });
    page.on('domcontentloaded', () => {
        updateLiveBrowserHud(page, 'Hazır').catch(() => { });
    });
}
function remember(page) {
    for (const [id, existing] of tabs) {
        if (existing === page)
            return id;
    }
    const id = nextId++;
    tabs.set(id, page);
    setupPageHandlers(page);
    page.on('close', () => tabs.delete(id));
    return id;
}
export async function ensureBrowser(options) {
    return browser(options);
}
async function browser(options) {
    const defaultHeadless = process.env.TBOT_HEADLESS === 'true';
    const desiredHeadless = options?.headless !== undefined ? Boolean(options.headless) : defaultHeadless;
    if (context && currentHeadless !== undefined && currentHeadless !== desiredHeadless) {
        await closeBrowser();
    }
    if (context)
        return context;
    if (launching)
        return launching;
    launching = (async () => {
        const packageName = 'playwright-core';
        let playwright;
        try {
            playwright = await import(packageName);
        }
        catch {
            throw new Error('Browser tools require playwright-core. Install it and a compatible Chromium or Chrome browser.');
        }
        // Crashed sessions leave %TEMP%/tbot-browser-* profile directories behind.
        await sweepStaleBrowserProfiles().catch(() => 0);
        const dir = await mkdtemp(join(tmpdir(), 'tbot-browser-'));
        profile = dir;
        const launchContext = async (isHeadless) => {
            try {
                return await playwright.chromium.launchPersistentContext(profile, {
                    channel: 'chrome',
                    headless: isHeadless,
                    timeout: 15000,
                    viewport: { width: 1280, height: 800 },
                    args: [
                        '--no-default-browser-check',
                        '--no-first-run',
                        '--disable-blink-features=AutomationControlled',
                    ],
                });
            }
            catch {
                return await playwright.chromium.launchPersistentContext(profile, {
                    headless: isHeadless,
                    timeout: 15000,
                    viewport: { width: 1280, height: 800 },
                    args: [
                        '--no-default-browser-check',
                        '--no-first-run',
                        '--disable-blink-features=AutomationControlled',
                    ],
                });
            }
        };
        try {
            try {
                context = await launchContext(desiredHeadless);
                currentHeadless = desiredHeadless;
            }
            catch (launchErr) {
                if (!desiredHeadless) {
                    // Automatic fallback to headless: true if graphical display is unavailable (e.g. headless Linux / CI)
                    try {
                        context = await launchContext(true);
                        currentHeadless = true;
                    }
                    catch {
                        throw launchErr;
                    }
                }
                else {
                    throw launchErr;
                }
            }
            context.setDefaultTimeout(10000);
            // Validate every main-frame navigation, including redirects, before the
            // request leaves the browser. Non-navigation resources are untouched.
            try {
                await context.route('**/*', async (route) => {
                    const request = route.request();
                    if (!request.isNavigationRequest?.())
                        return route.continue();
                    try {
                        await validateBrowserUrl(request.url(), activeLocalNavigation);
                        return await route.continue();
                    }
                    catch {
                        try {
                            return await route.abort('blockedbyclient');
                        }
                        catch {
                            return undefined;
                        }
                    }
                });
            }
            catch {
                // Older playwright-core builds without route support: goto validation still applies.
            }
            // Register init script so every new page/tab gets the ESC listener and abort flag
            try {
                await context.addInitScript(() => {
                    window.__tbotUserAborted = false;
                    window.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            window.__tbotUserAborted = true;
                        }
                    }, { capture: true });
                });
            }
            catch {
                // ignore init script registration error
            }
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
                if (profile === dir)
                    profile = undefined;
                void rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => { });
            });
            for (const page of context.pages())
                remember(page);
            resetIdleTimer();
            return context;
        }
        catch (error) {
            await rm(dir, { recursive: true, force: true }).catch(() => { });
            if (profile === dir)
                profile = undefined;
            throw error;
        }
    })();
    try {
        return await launching;
    }
    finally {
        launching = undefined;
    }
}
/**
 * Resolve a tab id to its page. An unknown id falls back to the active tab
 * (or the first open tab) and returns a note instead of failing the call;
 * `create: false` means the caller must navigate first when nothing is open.
 */
async function resolveTab(value, options) {
    const ctx = await browser(options);
    if (!tabs.size) {
        if (options?.create === false) {
            throw new Error('No browser tab is open yet. Call browser_navigate with a url first.');
        }
        remember(await ctx.newPage());
    }
    const requested = value === undefined || value === null || value === '' ? undefined : Number(value);
    const fallbackId = activeTabId !== undefined && tabs.has(activeTabId)
        ? activeTabId
        : tabs.keys().next().value;
    let id;
    let note;
    if (requested !== undefined && Number.isInteger(requested) && tabs.has(requested)) {
        id = requested;
    }
    else if (value !== undefined && value !== null && value !== '') {
        id = fallbackId;
        note = `Tab ${String(value)} is not open; using tab ${id} instead. Call browser_tabs to see open tabs.`;
    }
    else {
        id = fallbackId;
    }
    const page = id === undefined ? undefined : tabs.get(id);
    if (!page || id === undefined) {
        throw new Error('The browser tab was closed. Call browser_tabs to list open tabs or browser_navigate to open one.');
    }
    if (activeTabId !== id) {
        activeTabId = id;
        await inspectPageElements(page).catch(() => { });
    }
    return { page, id, note };
}
function normalizeUrlInput(raw) {
    let trimmed = raw.trim();
    if (trimmed === 'about:blank')
        return 'about:blank';
    if (!/^https?:\/\//i.test(trimmed)) {
        if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
            trimmed = `http://${trimmed}`;
        }
        else {
            trimmed = `https://${trimmed}`;
        }
    }
    return trimmed;
}
/**
 * Public-URL policy for every navigation (including redirects). Loopback is
 * only reachable with an explicit opt-in; private LAN and metadata addresses
 * are always blocked by `assertPublicHttpUrl`.
 */
export async function validateBrowserUrl(raw, allowLocal = false) {
    const normalized = normalizeUrlInput(raw);
    if (normalized === 'about:blank')
        return normalized;
    try {
        const url = await assertPublicHttpUrl(normalized, { allowLocal: allowLocal || envLocalNavigationAllowed });
        return url.href;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let loopback = false;
        try {
            loopback = isLoopback(new URL(normalized).hostname);
        }
        catch { /* keep the original error */ }
        if (loopback) {
            throw new Error(`${message} For a local development server, retry with "allow_local": true (or set TBOT_BROWSER_ALLOW_LOCAL=true).`);
        }
        throw new Error(message);
    }
}
function displayUrl(raw) {
    try {
        const u = new URL(raw);
        u.username = '';
        u.password = '';
        u.search = '';
        u.hash = '';
        return u.href;
    }
    catch {
        return raw === 'about:blank' ? raw : '[unavailable]';
    }
}
export async function closeBrowser() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
    }
    if (launching) {
        try {
            await launching;
        }
        catch { }
    }
    const current = context;
    const dir = profile;
    context = undefined;
    profile = undefined;
    currentHeadless = undefined;
    activeTabId = undefined;
    tabs.clear();
    lastElementMap.clear();
    consoleHistory.length = 0;
    activeLocalNavigation = false;
    try {
        if (current)
            await current.close();
    }
    finally {
        if (dir)
            await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}
function escapeCssAttr(val) {
    return val.replace(/["\\]/g, '\\$&');
}
/**
 * Resilient element resolver with SPA stale reference recovery.
 * Resolves by ref attribute, and falls back to semantic metadata (aria-label, name, text, cssPath).
 */
export async function resolveElementLocator(page, rawSelectorOrRef) {
    let targetRef = rawSelectorOrRef.trim();
    let primarySelector = targetRef;
    // Normalize ref format: e.g. "e1", "1", "[data-tbot-ref=\"e1\"]"
    const refMatch = targetRef.match(/\[data-tbot-ref=["']?([^"'\]]+)["']?\]/);
    if (refMatch) {
        targetRef = refMatch[1];
    }
    else if (/^(?:e)?\d+$/.test(targetRef)) {
        if (!targetRef.startsWith('e')) {
            targetRef = `e${targetRef}`;
        }
        primarySelector = `[data-tbot-ref="${targetRef}"]`;
    }
    else if (!targetRef.includes('=')) {
        // If user provided raw ref key like "e5" or "5"
        if (targetRef.startsWith('e') && /^\d+$/.test(targetRef.slice(1))) {
            primarySelector = `[data-tbot-ref="${targetRef}"]`;
        }
    }
    const findCandidate = async () => {
        // 1. Try primary locator first
        const loc = page.locator(primarySelector);
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
                    const byRoleText = page.getByRole(meta.role, { name: meta.text });
                    if ((await byRoleText.count().catch(() => 0)) > 0) {
                        return { locator: byRoleText.first(), ref: targetRef };
                    }
                }
                catch {
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
        return null;
    };
    const start = Date.now();
    while (true) {
        const candidate = await findCandidate();
        if (candidate)
            return candidate;
        if (Date.now() - start >= 1500) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    // Fall back to original locator if nothing else matched
    return { locator: page.locator(primarySelector), ref: targetRef };
}
const TARGET_HINT = 'Provide "ref" (from browser_inspect), "selector" (CSS/Playwright) or "text" (visible label). ' +
    'Example: {"ref":"e3"} or {"text":"Sign in"}.';
function availableElementHints(limit = 8) {
    const entries = [...lastElementMap.entries()].slice(0, limit);
    if (!entries.length)
        return 'none (call browser_inspect first)';
    return entries.map(([ref, meta]) => {
        const label = (meta.text || meta.ariaLabel || meta.name || meta.placeholder || '').slice(0, 40);
        return `${ref} ${meta.role}${label ? ` "${label}"` : ''}`;
    }).join(', ');
}
function missingElementError(target, rechecked) {
    return new Error(`Element "${target}" was not found${rechecked ? ' (the page was re-inspected once)' : ''}. ` +
        `Available refs: ${availableElementHints()}. Call browser_inspect to refresh refs, or pass text: "<visible label>".`);
}
async function resolveByText(page, text) {
    const roleLocators = [
        page.getByRole('button', { name: text, exact: false }),
        page.getByRole('link', { name: text, exact: false }),
        page.getByRole('tab', { name: text, exact: false }),
        page.getByRole('menuitem', { name: text, exact: false }),
        page.getByRole('checkbox', { name: text, exact: false }),
        page.getByText(text, { exact: false }),
    ];
    for (const locator of roleLocators) {
        let count = 0;
        try {
            count = await locator.count();
        }
        catch {
            count = 0;
        }
        for (let index = 0; index < Math.min(count, 20); index++) {
            const nth = locator.nth(index);
            if (await nth.isVisible().catch(() => false))
                return { locator: nth, ref: text };
        }
        if (count > 0)
            return { locator: locator.first(), ref: text };
    }
    return { locator: page.getByText(text, { exact: false }).first(), ref: text };
}
/**
 * Resolve selector/ref/text to a locator. Stale refs get one automatic
 * re-inspect; every failure names the next step.
 */
async function resolveElementTarget(page, args, toolName) {
    const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref.trim() : undefined;
    const selector = typeof args.selector === 'string' && args.selector.trim() ? args.selector.trim() : undefined;
    const text = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : undefined;
    if (ref) {
        let resolved = await resolveElementLocator(page, ref);
        if ((await resolved.locator.count().catch(() => 0)) === 0) {
            await inspectPageElements(page).catch(() => undefined);
            resolved = await resolveElementLocator(page, ref);
            if ((await resolved.locator.count().catch(() => 0)) > 0) {
                return { ...resolved, note: `Ref "${ref}" was stale; the page was re-inspected automatically.` };
            }
            throw missingElementError(ref, true);
        }
        return resolved;
    }
    if (selector) {
        let resolved;
        try {
            resolved = await resolveElementLocator(page, selector);
        }
        catch {
            throw new Error(`"${selector}" is not a valid selector for ${toolName}. ${TARGET_HINT}`);
        }
        if ((await resolved.locator.count().catch(() => 0)) === 0) {
            throw new Error(`No element matches selector "${selector}". Call browser_inspect and use a ref, or pass text: "<visible label>".`);
        }
        return resolved;
    }
    if (text) {
        const resolved = await resolveByText(page, text);
        if ((await resolved.locator.count().catch(() => 0)) === 0) {
            throw new Error(`No visible element with text "${text}". Call browser_inspect to see the page, or pass a ref/selector.`);
        }
        return resolved;
    }
    throw new Error(`${toolName} needs a target. ${TARGET_HINT}`);
}
export async function handleBrowserTool(name, args, options) {
    activeBrowserOps++;
    try {
        if (options.signal?.aborted)
            throw new Error('Operation cancelled');
        if (!options.signal)
            return await runBrowserTool(name, args, options);
        let onAbort;
        const cancelled = new Promise((_resolve, reject) => {
            onAbort = () => {
                void closeBrowser().catch(() => { });
                reject(new Error('Operation cancelled'));
            };
            options.signal.addEventListener('abort', onAbort, { once: true });
            if (options.signal.aborted)
                onAbort();
        });
        try {
            return await Promise.race([runBrowserTool(name, args, options), cancelled]);
        }
        finally {
            if (onAbort)
                options.signal.removeEventListener('abort', onAbort);
        }
    }
    finally {
        activeBrowserOps--;
        lastBrowserActivityAt = Date.now();
    }
}
export const executeBrowserTool = handleBrowserTool;
async function runBrowserTool(name, args, options) {
    if (options.signal?.aborted)
        throw new Error('Operation cancelled');
    if (name === 'browser_close') {
        await closeBrowser();
        return 'Browser closed.';
    }
    try {
        // Tab Management
        if (name === 'browser_tabs') {
            const action = args.action || 'list';
            if (action === 'new') {
                const ctx = await browser({ headless: typeof args.headless === 'boolean' ? args.headless : undefined });
                const p = await ctx.newPage();
                const id = remember(p);
                if (typeof args.url === 'string' && args.url.trim()) {
                    const targetUrl = await validateBrowserUrl(args.url);
                    await updateLiveBrowserHud(p, `Geziniliyor: ${displayUrl(targetUrl)}`);
                    await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await updateLiveBrowserHud(p, 'Hazır');
                }
                return JSON.stringify({ action: 'new', tab: id, url: displayUrl(p.url()), title: clean(await p.title()) });
            }
            if (action === 'close') {
                const { page } = await resolveTab(args.tab, { create: false });
                await page.close();
                return JSON.stringify({ action: 'close', status: 'closed' });
            }
            if (action === 'switch') {
                const { page, id, note } = await resolveTab(args.tab, { create: false });
                await page.bringToFront();
                await updateLiveBrowserHud(page, 'Sekmeye geçildi');
                await checkUserAborted(page);
                activeTabId = id;
                return applyTabNote(JSON.stringify({ action: 'switch', activeTab: id, url: displayUrl(page.url()), title: clean(await page.title()) }), note);
            }
            // Default: list tabs
            await browser({ headless: typeof args.headless === 'boolean' ? args.headless : undefined });
            const list = await Promise.all([...tabs].map(async ([id, p]) => ({
                id,
                url: displayUrl(p.url()),
                title: clean(cap(await p.title(), 300)),
            })));
            return JSON.stringify(list);
        }
        if (name === 'browser_new_tab') {
            const ctx = await browser({ headless: typeof args.headless === 'boolean' ? args.headless : undefined });
            const p = await ctx.newPage();
            const id = remember(p);
            if (typeof args.url === 'string' && args.url.trim()) {
                const targetUrl = await validateBrowserUrl(args.url);
                await updateLiveBrowserHud(p, `Geziniliyor: ${displayUrl(targetUrl)}`);
                await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await updateLiveBrowserHud(p, 'Hazır');
            }
            return JSON.stringify({ tab: id, url: displayUrl(p.url()), title: clean(await p.title()) });
        }
        if (name === 'browser_console') {
            const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50) || 50));
            const records = consoleHistory.slice(-limit);
            if (args.clear === true)
                consoleHistory.length = 0;
            return JSON.stringify({ ok: true, count: records.length, records });
        }
        const needsPage = name === 'browser_navigate' || name === 'browser_open' || name === 'browser_batch';
        const { page, id: tabId, note: tabNote } = await resolveTab(args.tab, {
            headless: typeof args.headless === 'boolean' ? args.headless : undefined,
            create: needsPage,
        });
        const finish = (output) => applyTabNote(output, tabNote);
        await checkUserAborted(page);
        if (name === 'browser_batch') {
            const steps = validateBatchSteps(args.steps, ['navigate', 'open', 'click', 'fill', 'type', 'press', 'hover', 'scroll', 'wait', 'assert_text']);
            const completed = [];
            for (const [index, step] of steps.entries()) {
                await checkUserAborted(page);
                const action = step.action;
                try {
                    if (action === 'wait') {
                        const ms = Math.min(5000, Math.max(50, Number(step.ms ?? step.duration ?? 500) || 500));
                        await page.waitForTimeout(ms);
                        completed.push(`waited ${ms}ms`);
                        continue;
                    }
                    if (action === 'assert_text') {
                        const text = str(step.text ?? step.value, 'text');
                        await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
                        completed.push(`text visible: ${text.slice(0, 80)}`);
                        continue;
                    }
                    const toolName = {
                        navigate: 'browser_navigate',
                        open: 'browser_open',
                        click: 'browser_click',
                        fill: 'browser_fill',
                        type: 'browser_type',
                        press: 'browser_press',
                        hover: 'browser_hover',
                        scroll: 'browser_scroll',
                    }[action];
                    if (!toolName)
                        throw new Error(`unsupported batch action "${action}"`);
                    const stepResult = await runBrowserTool(toolName, {
                        ...step,
                        tab: args.tab,
                        allow_local: args.allow_local ?? step.allow_local,
                        auto_screenshot: false,
                        observe: 'none',
                    }, options);
                    completed.push(`${action}: ${stepResult.slice(0, 160).replace(/\s+/g, ' ')}`);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`Batch stopped at step ${index + 1} (${action}): ${message}${completed.length ? `\nCompleted: ${completed.join(' | ')}` : ''}`);
                }
            }
            const summary = `Batch completed ${steps.length} step(s).\n${completed.join('\n')}`;
            return finish(await observeBrowserResult(page, options.workspace, args, summary));
        }
        if (name === 'browser_close_tab') {
            await page.close();
            return finish('Tab closed.');
        }
        if (name === 'browser_navigate' || name === 'browser_open') {
            const localAllowed = args.allow_local === true;
            const targetUrl = await validateBrowserUrl(str(args.url, 'url'), localAllowed);
            await updateLiveBrowserHud(page, `Geziniliyor: ${displayUrl(targetUrl)}`);
            await checkUserAborted(page);
            // The opt-in covers this navigation and its redirects only; it never
            // leaks into a later public page or another call.
            const previousLocalNavigation = activeLocalNavigation;
            activeLocalNavigation = localAllowed;
            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            }
            finally {
                activeLocalNavigation = previousLocalNavigation;
            }
            await updateLiveBrowserHud(page, 'Hazır');
            await checkUserAborted(page);
            const result = JSON.stringify({
                tab: tabId,
                url: displayUrl(page.url()),
                title: clean(cap(await page.title(), 300)),
                dialogsCaptured: lastDialogHistory.length > 0 ? lastDialogHistory.slice(-3) : undefined,
            });
            if (guiObservation(args) === 'visual') {
                try {
                    const obs = await captureAnnotatedScreenshotAndElements(page, options.workspace);
                    await pruneScreenshots(options.workspace).catch(() => undefined);
                    return finish(formatWithObservation(obs, result));
                }
                catch {
                    return finish(result);
                }
            }
            return finish(result);
        }
        // Inspect: 120 elements, viewport priority, rich semantic tree
        if (name === 'browser_inspect') {
            await updateLiveBrowserHud(page, 'Öğeler inceleniyor...');
            await checkUserAborted(page);
            const maxChars = args.maxChars === undefined ? 6000 : args.maxChars;
            if (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 15000) {
                throw new Error('maxChars must be an integer between 1000 and 15000');
            }
            const data = await inspectPageElements(page, maxChars);
            await updateLiveBrowserHud(page, 'Hazır');
            await checkUserAborted(page);
            return finish(cap(JSON.stringify({
                tab: tabId,
                url: displayUrl(page.url()),
                title: clean(await page.title()),
                text: data.text,
                elementCount: data.items.length,
                elements: data.items,
            }, (_k, v) => (typeof v === 'string' ? clean(v) : v)), maxChars));
        }
        // Click: selector/ref/text, stale ref auto-recovery
        if (name === 'browser_click') {
            const { locator, ref, note: targetNote } = await resolveElementTarget(page, args, 'browser_click');
            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await updateLiveBrowserHud(page, `Tıklanıyor: [${ref}]`);
            await highlightElementSpotlight(page, locator, ref);
            await checkUserAborted(page);
            await locator.click({ timeout: 10000 });
            await updateLiveBrowserHud(page, 'Hazır');
            await checkUserAborted(page);
            const result = `Clicked element ${ref}.${targetNote ? ` ${targetNote}` : ''}`;
            return finish(await observeBrowserResult(page, options.workspace, args, result));
        }
        // Type / Fill: target optional (focused field), stale ref auto-recovery
        if (name === 'browser_type' || name === 'browser_fill') {
            const rawVal = args.value ?? args.input;
            if (rawVal === undefined || rawVal === null) {
                throw new Error('value is required for browser_type/browser_fill. Example: {"ref":"e3","value":"hello"}.');
            }
            const value = String(rawVal);
            const clearFirst = name === 'browser_fill' || args.clear !== false;
            const hasTarget = [args.ref, args.selector, args.text].some(candidate => typeof candidate === 'string' && candidate.trim().length > 0);
            if (!hasTarget) {
                // No target: type into whatever currently has focus.
                await checkUserAborted(page);
                if (clearFirst) {
                    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => { });
                }
                await page.keyboard.type(value, { delay: 5 });
                await updateLiveBrowserHud(page, 'Hazır');
                await checkUserAborted(page);
                return finish(await observeBrowserResult(page, options.workspace, args, 'Typed into the focused field.'));
            }
            const { locator, ref, note: targetNote } = await resolveElementTarget(page, args, name);
            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await updateLiveBrowserHud(page, `Yazılıyor: [${ref}]`);
            await highlightElementSpotlight(page, locator, ref);
            await checkUserAborted(page);
            if (clearFirst) {
                await locator.fill(value, { timeout: 10000 });
            }
            else {
                await locator.type(value, { timeout: 10000 });
            }
            await updateLiveBrowserHud(page, 'Hazır');
            await checkUserAborted(page);
            const result = `${name === 'browser_fill' ? 'Filled' : 'Typed into'} element ${ref}.${targetNote ? ` ${targetNote}` : ''}`;
            return finish(await observeBrowserResult(page, options.workspace, args, result));
        }
        // Hover
        if (name === 'browser_hover') {
            const { locator, ref, note: targetNote } = await resolveElementTarget(page, args, 'browser_hover');
            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await updateLiveBrowserHud(page, `Üzerine geliniyor: [${ref}]`);
            await highlightElementSpotlight(page, locator, ref);
            await checkUserAborted(page);
            await locator.hover({ timeout: 10000 });
            await updateLiveBrowserHud(page, 'Hazır');
            await checkUserAborted(page);
            const result = `Hovered over element ${ref}.${targetNote ? ` ${targetNote}` : ''}`;
            return finish(await observeBrowserResult(page, options.workspace, args, result));
        }
        // Scroll
        if (name === 'browser_scroll') {
            let result = '';
            if (typeof args.ref === 'string' && args.ref.trim()) {
                const { locator, ref } = await resolveElementLocator(page, args.ref);
                if ((await locator.count().catch(() => 0)) > 0) {
                    await updateLiveBrowserHud(page, `Kaydırılıyor: [${ref}]`);
                    await locator.scrollIntoViewIfNeeded({ timeout: 10000 });
                    await highlightElementSpotlight(page, locator, ref);
                    await checkUserAborted(page);
                    result = `Scrolled to element ${ref}.`;
                }
            }
            if (!result) {
                const direction = args.direction || 'down';
                const amount = typeof args.amount === 'number' && Number.isInteger(args.amount) ? args.amount : 600;
                await updateLiveBrowserHud(page, `Kaydırılıyor: ${direction} (${amount}px)`);
                await checkUserAborted(page);
                await evaluatePage(page, ({ direction, amount }) => {
                    if (direction === 'top') {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                    else if (direction === 'bottom') {
                        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                    }
                    else if (direction === 'up') {
                        window.scrollBy({ top: -amount, behavior: 'smooth' });
                    }
                    else {
                        window.scrollBy({ top: amount, behavior: 'smooth' });
                    }
                }, { direction, amount });
                result = `Scrolled ${direction} ${amount}px.`;
            }
            await updateLiveBrowserHud(page, 'Hazır');
            await checkUserAborted(page);
            return finish(await observeBrowserResult(page, options.workspace, args, result));
        }
        // Press Key
        if (name === 'browser_press') {
            const key = str(args.key, 'key');
            await updateLiveBrowserHud(page, `Tuş basılıyor: "${key}"`);
            await checkUserAborted(page);
            await page.keyboard.press(key);
            await updateLiveBrowserHud(page, 'Hazır');
            await checkUserAborted(page);
            const result = `Pressed key "${key}".`;
            return finish(await observeBrowserResult(page, options.workspace, args, result));
        }
        // Evaluate JavaScript
        if (name === 'browser_evaluate') {
            await checkUserAborted(page);
            const script = str(args.script, 'script');
            // Evaluation may have side effects before throwing; never replay it.
            const evalResult = await evaluatePage(page, script);
            await checkUserAborted(page);
            const serialized = typeof evalResult === 'object' && evalResult !== null ? JSON.stringify(evalResult) : String(evalResult);
            return finish(cap(serialized, 6000));
        }
        // Wait for text, URL or network idle
        if (name === 'browser_wait_for') {
            const text = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : undefined;
            const urlPattern = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : undefined;
            const networkIdle = args.network_idle === true;
            if (!text && !urlPattern && !networkIdle) {
                throw new Error('browser_wait_for needs at least one of "text", "url" or "network_idle": true. Example: {"text":"Saved","timeout_ms":15000}.');
            }
            const timeout = Math.min(30000, Math.max(500, Number(args.timeout_ms ?? 10000) || 10000));
            await checkUserAborted(page);
            if (text)
                await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
            if (urlPattern) {
                const escaped = urlPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                await page.waitForURL(new RegExp(escaped), { timeout });
            }
            if (networkIdle)
                await page.waitForLoadState('networkidle', { timeout });
            await checkUserAborted(page);
            return finish(JSON.stringify({
                ok: true,
                tab: tabId,
                waitedFor: { text, url: urlPattern, networkIdle },
                url: displayUrl(page.url()),
                title: clean(await page.title().catch(() => '')),
            }));
        }
        // Readable page content
        if (name === 'browser_read') {
            const maxChars = Math.min(20000, Math.max(1000, Number(args.maxChars ?? 8000) || 8000));
            await checkUserAborted(page);
            const readable = await evaluatePage(page, (limit) => {
                const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);
                const parts = [];
                let size = 0;
                const push = (line) => {
                    const value = line.replace(/\s+/g, ' ').trim();
                    if (!value)
                        return;
                    parts.push(value);
                    size += value.length + 1;
                };
                const walk = (node) => {
                    if (size >= limit)
                        return;
                    if (skip.has(node.tagName))
                        return;
                    const style = window.getComputedStyle(node);
                    if (style.display === 'none' || style.visibility === 'hidden')
                        return;
                    const tag = node.tagName.toLowerCase();
                    if (/^h[1-6]$/.test(tag)) {
                        push(`${'#'.repeat(Number(tag[1]))} ${(node.textContent || '').replace(/\s+/g, ' ').trim()}`);
                        return;
                    }
                    if (tag === 'li') {
                        push(`- ${(node.textContent || '').replace(/\s+/g, ' ').trim()}`);
                        return;
                    }
                    if (tag === 'a') {
                        const href = node.href;
                        const label = (node.textContent || '').replace(/\s+/g, ' ').trim();
                        if (label && href && !href.startsWith('javascript:'))
                            push(`[${label}](${href})`);
                        return;
                    }
                    if (['p', 'blockquote', 'pre', 'td', 'th', 'dt', 'dd', 'figcaption'].includes(tag)) {
                        push((node.textContent || '').replace(/\s+/g, ' ').trim());
                        return;
                    }
                    for (const child of Array.from(node.children)) {
                        if (size >= limit)
                            break;
                        walk(child);
                    }
                };
                const root = document.querySelector('main, article, [role="main"]') || document.body;
                if (root)
                    walk(root);
                return { text: parts.join('\n').slice(0, limit), truncated: size >= limit };
            }, maxChars);
            return finish(JSON.stringify({
                ok: true,
                tab: tabId,
                url: displayUrl(page.url()),
                title: clean(await page.title().catch(() => '')),
                content: clean(String(readable?.text ?? '')),
                truncated: Boolean(readable?.truncated),
            }));
        }
        // Download a file started by a click or a direct URL
        if (name === 'browser_download') {
            const timeout = Math.min(60000, Math.max(1000, Number(args.timeout_ms ?? 20000) || 20000));
            const requested = typeof args.filename === 'string' ? args.filename.trim() : '';
            const safeName = (requested || `download-${Date.now()}`).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
            const directory = await resolveWorkspacePath(options.workspace, '.tbot/downloads');
            await mkdir(directory, { recursive: true });
            const destination = await resolveWorkspacePath(options.workspace, join('.tbot/downloads', `${randomUUID()}-${safeName}`));
            await checkUserAborted(page);
            const downloadPromise = page.waitForEvent('download', { timeout });
            // A failed target resolution must not leave an unhandled rejection.
            downloadPromise.catch(() => undefined);
            const hasTarget = [args.ref, args.selector, args.text].some(candidate => typeof candidate === 'string' && candidate.trim().length > 0);
            if (hasTarget) {
                const { locator } = await resolveElementTarget(page, args, 'browser_download');
                await locator.click({ timeout: 10000 });
            }
            else if (typeof args.url === 'string' && args.url.trim()) {
                const targetUrl = await validateBrowserUrl(args.url);
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => undefined);
            }
            else {
                throw new Error('browser_download needs a target: "ref"/"selector"/"text" to click, or a direct "url".');
            }
            const download = await downloadPromise;
            await download.saveAs(destination);
            return finish(JSON.stringify({
                ok: true,
                tab: tabId,
                path: destination,
                suggestedFilename: clean(String(download.suggestedFilename?.() ?? safeName)),
                sourceUrl: displayUrl(page.url()),
            }));
        }
        // Upload files to a file input
        if (name === 'browser_upload') {
            const files = Array.isArray(args.files) ? args.files.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
            if (!files.length)
                throw new Error('browser_upload needs a non-empty "files" array of workspace-relative paths.');
            if (files.length > 10)
                throw new Error('browser_upload accepts at most 10 files per call.');
            const resolvedFiles = [];
            for (const file of files) {
                const absolute = await resolveWorkspacePath(options.workspace, file);
                if (isSensitivePath(absolute))
                    throw new Error(`Refusing to upload a protected file: ${file}`);
                const info = await stat(absolute).catch(() => undefined);
                if (!info?.isFile())
                    throw new Error(`Upload file not found or not a regular file: ${file}`);
                resolvedFiles.push(absolute);
            }
            const { locator, ref } = await resolveElementTarget(page, args, 'browser_upload');
            await locator.setInputFiles(resolvedFiles, { timeout: 10000 });
            return finish(JSON.stringify({
                ok: true,
                tab: tabId,
                target: ref,
                files: resolvedFiles.map(path => basename(path)),
            }));
        }
        // Screenshot with Set-of-Marks (SoM) and smart masking
        if (name === 'browser_screenshot') {
            await checkUserAborted(page);
            const baseDir = options.workspace ? options.workspace : process.cwd();
            const path = await createScreenshotPath(baseDir, 'browser');
            const annotate = args.annotate !== false;
            const maskInputs = args.mask_inputs === true;
            if (annotate) {
                // Inject Set-of-Marks overlay
                await evaluatePage(page, () => {
                    document.getElementById('__tbot_som_overlay__')?.remove();
                    const overlay = document.createElement('div');
                    overlay.id = '__tbot_som_overlay__';
                    overlay.style.cssText =
                        'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:visible;';
                    const elements = Array.from(document.querySelectorAll('[data-tbot-ref]'));
                    for (const el of elements) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width <= 0 || rect.height <= 0)
                            continue;
                        const ref = el.getAttribute('data-tbot-ref') || '';
                        if (!ref)
                            continue;
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
                }).catch(() => { });
            }
            try {
                const maskLocators = [];
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
            }
            finally {
                if (annotate) {
                    await evaluatePage(page, () => {
                        document.getElementById('__tbot_som_overlay__')?.remove();
                    }).catch(() => { });
                }
            }
            await checkUserAborted(page);
            await pruneScreenshots(options.workspace).catch(() => undefined);
            return finish(`Screenshot saved: ${path}`);
        }
        throw new Error(`Unknown browser tool: ${name}`);
    }
    finally {
        resetIdleTimer();
    }
}
//# sourceMappingURL=browser.js.map