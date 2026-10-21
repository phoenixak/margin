import type { Dialect, RewritePreset, Suggestion } from '@margin/core';

export interface Settings {
  /** `off` until the user chooses; nothing is sent before that. */
  provider: 'off' | 'local' | 'gemini';
  localBaseUrl: string;
  /** Empty: the provider's default model. */
  model: string;
  /** Kept in `chrome.storage.local`, which is not encrypted (the options page says so). */
  geminiKey: string;
  /** The user acknowledged that Gemini sends text to Google. Required before any Gemini call. */
  geminiConsent: boolean;
  dialect: Dialect;
  idleDelayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'off',
  localBaseUrl: 'http://localhost:11434/v1',
  model: '',
  geminiKey: '',
  geminiConsent: false,
  dialect: 'American',
  idleDelayMs: 2000,
};

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  return { ...DEFAULT_SETTINGS, ...stored.settings };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** Messages from content scripts, the popup and the options page to the background. */
export type Request =
  | { type: 'check'; id: string; text: string }
  | { type: 'cancel'; id: string }
  | { type: 'ignore'; original: string; fixed: string }
  | { type: 'status' }
  | { type: 'detect'; urls?: string[] }
  | { type: 'test-model' }
  | { type: 'clear-cache' }
  | { type: 'clear-ignored' }
  | { type: 'open-options' };

export type CheckResponse = { ok: true; suggestions: Suggestion[]; model: string } | { ok: false; error: string; setup?: boolean; cancelled?: boolean };

export interface StatusResponse {
  provider: Settings['provider'];
  model?: string;
  tested?: boolean;
  ready: boolean;
  problem?: string;
}

/** Messages from the background to a content script. */
/** `preset` absent: show a preset picker (keyboard shortcut). */
export type TabMessage = { type: 'rewrite-selection'; preset?: RewritePreset };

/** Messages on a `rewrite` port. */
export type RewritePortIn = { type: 'start'; text: string; preset: RewritePreset; instruction?: string };
export type RewritePortOut = { type: 'delta'; text: string } | { type: 'done'; text: string; warnings: string[] } | { type: 'error'; error: string };
