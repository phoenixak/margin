import {
  check,
  createModel,
  detectLocalServers,
  explainError,
  ignoreKey,
  type MarginModel,
  modelAdvice,
  REWRITE_PRESETS,
  type RewritePreset,
  type Range,
  rewrite,
  type StoredCache,
  storedCache,
} from '@margin/core';
import { createBinaryModuleFromUrl, Dialect as HarperDialect, LocalLinter } from 'harper.js';
import { type CheckResponse, loadSettings, type Request, type RewritePortIn, type RewritePortOut, type Settings, type StatusResponse, type TabMessage } from './settings.js';
import { registerEnabledSites } from './sites.js';

/*
 * The background owns everything that talks to a model, plus Harper (for dedup only;
 * Margin can't read Harper's own extension). Content scripts only send text and draw.
 */

const controllers = new Map<string, AbortController>();
let cachePromise: Promise<StoredCache> | undefined;
let linter: { dialect: string; linter: LocalLinter } | undefined;

const cache = () =>
  (cachePromise ??= storedCache({
    read: async () => ((await chrome.storage.local.get('cache')) as { cache?: string }).cache,
    write: async (data) => chrome.storage.local.set({ cache: data }),
  }));

async function ignored(): Promise<Set<string>> {
  return new Set(((await chrome.storage.local.get('ignored')) as { ignored?: string[] }).ignored ?? []);
}

function modelFor(s: Settings): MarginModel | { problem: string; setup: boolean } {
  if (s.provider === 'off') return { problem: 'Margin isn’t set up yet. Open its options to choose a local model or Gemini.', setup: true };
  if (s.provider === 'gemini') {
    if (!s.geminiKey) return { problem: 'Add your Gemini API key in Margin’s options.', setup: true };
    if (!s.geminiConsent) return { problem: 'Confirm in Margin’s options that text may be sent to Google.', setup: true };
    return createModel({ provider: 'gemini', apiKey: s.geminiKey, ...(s.model ? { model: s.model } : {}) });
  }
  return createModel({ provider: 'local', baseURL: s.localBaseUrl, ...(s.model ? { model: s.model } : {}) });
}

/** Harper's lint ranges (harper.js spans are UTF-16, like ours). The WASM ships with the extension. */
async function harperRanges(text: string, dialect: Settings['dialect']): Promise<Range[]> {
  try {
    if (linter?.dialect !== dialect) {
      await linter?.linter.dispose();
      const binary = createBinaryModuleFromUrl(chrome.runtime.getURL('harper_wasm_slim_bg.wasm'), 'slim');
      const next = new LocalLinter({ binary, dialect: HarperDialect[dialect] });
      await next.setup(); // load the WASM here, inside the try, so a failure is handled
      linter = { dialect, linter: next };
    }
    return (await linter.linter.lint(text, { language: 'plaintext' })).map((l) => {
      const span = l.span();
      return { start: span.start, end: span.end };
    });
  } catch {
    linter = undefined; // try again next time
    return []; // dedup is best-effort; never block checking on it
  }
}

async function handleCheck(id: string, text: string): Promise<CheckResponse> {
  const settings = await loadSettings();
  const model = modelFor(settings);
  if ('problem' in model) return { ok: false, error: model.problem, setup: model.setup };
  controllers.get(id)?.abort();
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const result = await check({
      text,
      model,
      dialect: settings.dialect,
      language: 'plaintext',
      existing: await harperRanges(text, settings.dialect),
      ignored: await ignored(),
      cache: await cache(),
      signal: controller.signal,
      batch: { maxSentences: 8 },
      concurrency: model.parallel,
    });
    return { ok: true, suggestions: result.suggestions, model: model.id };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: 'cancelled', cancelled: true };
    return { ok: false, error: explainError(error, model) };
  } finally {
    if (controllers.get(id) === controller) controllers.delete(id);
  }
}

async function status(): Promise<StatusResponse> {
  const s = await loadSettings();
  const m = modelFor(s);
  if ('problem' in m) return { provider: s.provider, ready: false, problem: m.problem };
  return { provider: s.provider, model: m.id, tested: m.tested, ready: true };
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'check':
      return handleCheck(req.id, req.text);
    case 'cancel':
      controllers.get(req.id)?.abort();
      return { ok: true };
    case 'ignore': {
      const list = await ignored();
      list.add(await ignoreKey(req.original, req.fixed));
      await chrome.storage.local.set({ ignored: [...list] });
      return { ok: true };
    }
    case 'status':
      return status();
    case 'detect':
      return detectLocalServers(req.urls ? { urls: req.urls } : {});
    case 'test-model': {
      // An error Harper doesn't flag, so a working model always has something to say.
      const r = await handleCheck('test', 'The results of the survey shows a clear preference for remote work.');
      const s = await loadSettings();
      const m = modelFor(s);
      return { ...r, advice: 'problem' in m ? undefined : modelAdvice(m.provider, m.modelId).note };
    }
    case 'clear-cache':
      await (await cache()).clear();
      return { ok: true };
    case 'clear-ignored':
      await chrome.storage.local.set({ ignored: [] });
      return { ok: true };
    case 'open-options':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req).then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) }));
  return true; // async response
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rewrite') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (msg: RewritePortIn) => {
    if (msg.type !== 'start') return;
    const post = (m: RewritePortOut) => {
      try {
        port.postMessage(m);
      } catch {
        // the page went away
      }
    };
    const settings = await loadSettings();
    const model = modelFor(settings);
    if ('problem' in model) return post({ type: 'error', error: model.problem });
    try {
      const r = rewrite({ text: msg.text, model, preset: msg.preset, dialect: settings.dialect, signal: controller.signal, ...(msg.instruction ? { instruction: msg.instruction } : {}) });
      let text = '';
      for await (const part of r.textStream) {
        text += part;
        post({ type: 'delta', text });
      }
      const done = await r.done;
      post({ type: 'done', text: done.text, warnings: done.warnings });
    } catch (error) {
      if (!controller.signal.aborted) post({ type: 'error', error: explainError(error, model) });
    }
  });
});

// Context menu: rewrite works on any page through activeTab, even where checking is off.
const PRESETS: RewritePreset[] = [...(Object.keys(REWRITE_PRESETS) as RewritePreset[]), 'custom'];
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'margin', title: 'Margin: rewrite', contexts: ['selection', 'editable'] });
    for (const p of PRESETS) {
      chrome.contextMenus.create({ id: `margin-${p}`, parentId: 'margin', title: p === 'custom' ? 'Custom…' : REWRITE_PRESETS[p].label, contexts: ['selection', 'editable'] });
    }
  });
  // First install: open the options page so the user chooses where text is checked.
  void chrome.storage.local.get('settings').then((s) => {
    if (!s.settings) void chrome.runtime.openOptionsPage();
  });
});

/** Asks the page to rewrite its selection, injecting the content script once if the site isn't enabled (activeTab allows it after a click or shortcut). */
async function rewriteInTab(tabId: number, preset: RewritePreset | undefined, frameId?: number) {
  const msg: TabMessage = { type: 'rewrite-selection', ...(preset ? { preset } : {}) };
  const opts = frameId !== undefined ? { frameId } : {};
  try {
    await chrome.tabs.sendMessage(tabId, msg, opts);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId, ...(frameId !== undefined ? { frameIds: [frameId] } : {}) }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, msg, opts);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !String(info.menuItemId).startsWith('margin-')) return;
  void rewriteInTab(tab.id, String(info.menuItemId).slice('margin-'.length) as RewritePreset, info.frameId);
});

chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === 'rewrite' && tab?.id) void rewriteInTab(tab.id, undefined);
});

chrome.runtime.onStartup?.addListener(() => void registerEnabledSites());
chrome.runtime.onInstalled.addListener(() => void registerEnabledSites());
