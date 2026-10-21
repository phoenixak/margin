/**
 * Margin checks only on sites the user enabled. Enabling a site asks the browser for
 * access to that origin and registers the content script there; nothing else runs.
 */

const scriptId = (origin: string) => `margin-${origin.replace(/[^a-z0-9]/gi, '_')}`;

export async function enabledSites(): Promise<string[]> {
  return ((await chrome.storage.local.get('sites')) as { sites?: string[] }).sites ?? [];
}

/** Must be called from a user gesture (popup or options click): it may show a permission prompt. */
export async function enableSite(origin: string): Promise<boolean> {
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return false;
  const sites = new Set(await enabledSites());
  sites.add(origin);
  await chrome.storage.local.set({ sites: [...sites] });
  await register(origin);
  return true;
}

export async function disableSite(origin: string): Promise<void> {
  const sites = (await enabledSites()).filter((s) => s !== origin);
  await chrome.storage.local.set({ sites });
  await chrome.scripting.unregisterContentScripts({ ids: [scriptId(origin)] }).catch(() => {});
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
}

/** Re-registers content scripts for every enabled site that still has permission. */
export async function registerEnabledSites(): Promise<void> {
  for (const origin of await enabledSites()) {
    if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) await register(origin);
  }
}

async function register(origin: string) {
  const id = scriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([{ id, matches: [`${origin}/*`], js: ['content.js'], runAt: 'document_idle', allFrames: false }]);
}
