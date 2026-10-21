import { APICallError } from '@ai-sdk/provider';
import type { CheckCache } from './cache.js';
import { type CheckResult, check } from './check.js';
import { explainError } from './errors.js';
import type { MarginModel } from './model.js';
import type { Dialect, Range, Suggestion } from './types.js';

/**
 * Scheduling, cancellation and staleness for checks, independent of VS Code so it can
 * be unit-tested (and reused by the language server). The host adapts it to an editor.
 */

export interface DocSnapshot {
  text: string;
  version: number;
  language: 'markdown' | 'plaintext';
}

export type ModelState = { ok: true; model: MarginModel } | { ok: false; reason: 'off' | 'needs-setup' | 'no-key' };

export type Status =
  | { state: 'off' }
  | { state: 'needs-setup' }
  | { state: 'no-key' }
  | { state: 'ready'; model: string; tested: boolean }
  | { state: 'checking'; model: string; tested: boolean }
  | { state: 'busy'; model: string; retryInMs: number }
  | { state: 'error'; message: string };

export interface EngineHost {
  snapshot(key: string): DocSnapshot | undefined;
  /** Harper's lint ranges for the document, as offsets (from the editor's Harper, or harper.js). */
  harperRanges(key: string): Range[] | Promise<Range[]>;
  model(): ModelState;
  dialect(key: string): Dialect;
  /** Excluded by glob, untrusted, or otherwise never to be sent. */
  excluded(key: string): boolean;
  publish(key: string, version: number, suggestions: Suggestion[]): void;
  status(status: Status): void;
  /** Never receives document text: counts, ids and timings only. */
  log(line: string): void;
}

export interface EngineSettings {
  trigger: 'idle' | 'save' | 'manual';
  idleDelayMs: number;
}

export interface EngineOptions {
  host: EngineHost;
  settings: () => EngineSettings;
  cache: CheckCache;
  ignored: () => ReadonlySet<string>;
  /** How long to wait after the provider says it's busy (429 / 503). Default 30 s. */
  busyRetryMs?: number;
  /** Checks running at once across documents. Default 2. */
  maxConcurrent?: number;
  /** Injected for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  run?: typeof check;
}

interface DocState {
  timer?: unknown;
  controller?: AbortController;
}

export class Engine {
  private readonly docs = new Map<string, DocState>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: EngineOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** The document changed. With the idle trigger, schedules a check after the pause. */
  onEdit(key: string): void {
    const state = this.state(key);
    // Results for the old text are stale now; stop paying for them.
    state.controller?.abort();
    if (this.opts.settings().trigger === 'idle') this.schedule(key, this.opts.settings().idleDelayMs);
  }

  onSave(key: string): void {
    if (this.opts.settings().trigger === 'save') void this.checkNow(key);
  }

  onOpen(key: string): void {
    if (this.opts.settings().trigger !== 'manual') this.schedule(key, 0);
  }

  onClose(key: string): void {
    const state = this.docs.get(key);
    if (!state) return;
    this.clearTimer(state.timer);
    state.controller?.abort();
    this.docs.delete(key);
  }

  /** Checks now (command, save trigger, or a scheduled run). Optionally only sentences in `ranges`. */
  async checkNow(key: string, ranges?: Range[]): Promise<CheckResult | undefined> {
    const { host } = this.opts;
    const state = this.state(key);
    this.clearTimer(state.timer);
    state.controller?.abort();

    const m = host.model();
    if (!m.ok) {
      host.status({ state: m.reason });
      return undefined;
    }
    if (host.excluded(key)) return undefined;
    const doc = host.snapshot(key);
    if (!doc) return undefined;
    const { text, version, language } = doc; // copy: the snapshot object may be live

    const controller = new AbortController();
    state.controller = controller;
    await this.acquire();
    const started = Date.now();
    try {
      if (controller.signal.aborted) return undefined;
      host.status({ state: 'checking', model: m.model.id, tested: m.model.tested });
      const result = await (this.opts.run ?? check)({
        text,
        model: m.model,
        dialect: host.dialect(key),
        language,
        existing: await host.harperRanges(key),
        ignored: this.opts.ignored(),
        cache: this.opts.cache,
        // Eval 2026-10-21: batch 8 was best (batch 15 lost recall). Hosted: 2 calls at once; a local GPU: 1.
        batch: { maxSentences: 8 },
        concurrency: m.model.parallel,
        signal: controller.signal,
        ...(ranges ? { ranges } : {}),
      });
      const now = host.snapshot(key);
      if (controller.signal.aborted || !now || now.version !== version) return undefined; // stale: a newer check follows
      host.publish(key, version, result.suggestions);
      host.status({ state: 'ready', model: m.model.id, tested: m.model.tested });
      host.log(
        `checked doc#${hashKey(key)} v${version} (${text.length} chars): ${result.sentences} sentences, ` +
          `${result.modelCalls} calls, ${result.cacheHits} cached, ${result.suggestions.length} suggestions, ` +
          `${result.rejected.length} rejected, ${Date.now() - started} ms`,
      );
      return result;
    } catch (error) {
      if (controller.signal.aborted) return undefined;
      if (isBusy(error)) {
        const retryInMs = this.opts.busyRetryMs ?? 30_000;
        host.status({ state: 'busy', model: m.model.id, retryInMs });
        host.log(`provider busy; retrying in ${retryInMs} ms`);
        this.schedule(key, retryInMs);
        return undefined;
      }
      const message = explainError(error, m.model);
      host.status({ state: 'error', message });
      host.log(`check failed: ${message}`);
      return undefined;
    } finally {
      this.release();
      if (state.controller === controller) state.controller = undefined;
    }
  }

  dispose(): void {
    for (const key of [...this.docs.keys()]) this.onClose(key);
  }

  private schedule(key: string, ms: number) {
    const state = this.state(key);
    this.clearTimer(state.timer);
    state.timer = this.setTimer(() => void this.checkNow(key), ms);
  }

  private state(key: string): DocState {
    let s = this.docs.get(key);
    if (!s) this.docs.set(key, (s = {}));
    return s;
  }

  private acquire(): Promise<void> {
    if (this.running < (this.opts.maxConcurrent ?? 2)) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => (this.running++, resolve())));
  }

  private release() {
    this.running--;
    this.waiting.shift()?.();
  }
}

/** Rate limits and "high demand" errors: wait and retry rather than report a failure. */
function isBusy(error: unknown): boolean {
  const cause = (error as { lastError?: unknown })?.lastError ?? error; // AI SDK RetryError wraps the last attempt
  const status = APICallError.isInstance(cause) ? cause.statusCode : undefined;
  return status === 429 || status === 503 || /high demand|overloaded|rate.?limit/i.test(String((cause as Error)?.message ?? ''));
}

/** A short non-reversible id for logs, so log lines never contain file paths or text. */
function hashKey(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16);
}
