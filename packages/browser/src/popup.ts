import type { Request, StatusResponse } from './settings.js';
import { disableSite, enabledSites, enableSite } from './sites.js';

const $ = (id: string) => document.getElementById(id)!;

async function init() {
  const status = (await chrome.runtime.sendMessage({ type: 'status' } satisfies Request)) as StatusResponse;
  $('status').textContent = status.ready
    ? `${status.model}${status.tested ? '' : ' (not tested with Margin)'}${status.provider === 'gemini' ? ' · text goes to Google' : ' · text stays on this computer'}`
    : (status.problem ?? 'Not set up.');
  $('options').addEventListener('click', () => void chrome.runtime.openOptionsPage());

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin: string | undefined;
  try {
    const url = new URL(tab?.url ?? '');
    if (url.protocol === 'https:' || url.protocol === 'http:') origin = url.origin;
  } catch {
    // not a web page
  }
  if (!origin || /(^|\.)docs\.google\.com$/.test(new URL(origin).hostname)) return;
  const button = $('toggle') as HTMLButtonElement;
  const on = (await enabledSites()).includes(origin);
  button.hidden = false;
  button.textContent = on ? `Turn off on ${new URL(origin).hostname}` : `Check text on ${new URL(origin).hostname}`;
  button.addEventListener('click', async () => {
    if (on) {
      await disableSite(origin);
    } else if (await enableSite(origin)) {
      // Start right away on this tab; the registered script covers future loads.
      if (tab?.id) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    }
    window.close();
  });
}

void init();
