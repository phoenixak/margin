import { DEFAULT_LOCAL_MODEL, type LocalProbe, localSetupHelp, modelInfo } from '@margin/core';
import { type CheckResponse, loadSettings, type Request, saveSettings, type Settings } from './settings.js';
import { disableSite, enabledSites } from './sites.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T>(req: Request) => chrome.runtime.sendMessage(req) as Promise<T>;

function os(): 'windows' | 'mac' | 'linux' {
  const p = navigator.platform.toLowerCase();
  return p.startsWith('win') ? 'windows' : p.startsWith('mac') ? 'mac' : 'linux';
}

let flash: ReturnType<typeof setTimeout> | undefined;
async function save(patch: Partial<Settings>) {
  await saveSettings(patch);
  $('saved').textContent = 'Saved.';
  clearTimeout(flash);
  flash = setTimeout(() => ($('saved').textContent = ''), 1500);
}

function showSections(provider: Settings['provider']) {
  $('local').hidden = provider !== 'local';
  $('gemini').hidden = provider !== 'gemini';
}

function fillModels(models: string[], selected: string) {
  const select = $<HTMLSelectElement>('localModel');
  const all = [...new Set([...(selected ? [selected] : []), ...models])];
  if (!all.length) all.push(DEFAULT_LOCAL_MODEL);
  select.replaceChildren(
    ...all.map((m) => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = modelInfo('local', m)?.autoCheck ? `${m} (recommended)` : m;
      o.selected = m === (selected || DEFAULT_LOCAL_MODEL);
      return o;
    }),
  );
}

async function detect() {
  const s = await loadSettings();
  $('detectStatus').textContent = 'Looking…';
  const help = $('help');
  help.hidden = true;
  const url = s.localBaseUrl.replace(/\/v1\/?$/, '');
  // The extension needs permission for a non-default server.
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    const ok = await chrome.permissions.request({ origins: [`${url}/*`] });
    if (!ok) {
      $('detectStatus').textContent = 'Permission to reach that server was not granted.';
      return;
    }
  }
  const probes = await send<LocalProbe[]>({ type: 'detect', urls: [...new Set([url, 'http://localhost:11434', 'http://localhost:1234'])] });
  const found = probes.filter((p) => p.server);
  if (found.length) {
    const first = found.find((p) => p.server!.baseURL.startsWith(url)) ?? found[0]!;
    if (first.server!.baseURL !== s.localBaseUrl) {
      $<HTMLInputElement>('localBaseUrl').value = first.server!.baseURL;
      await save({ localBaseUrl: first.server!.baseURL });
    }
    fillModels(first.server!.models, s.model);
    if (!s.model) {
      const recommended = first.server!.models.find((m) => modelInfo('local', m)?.autoCheck) ?? first.server!.models[0]!;
      $<HTMLSelectElement>('localModel').value = recommended;
      await save({ model: recommended });
    }
    $('detectStatus').textContent = `Found ${found.map((p) => `${p.server!.kind === 'lmstudio' ? 'LM Studio' : p.server!.kind === 'ollama' ? 'Ollama' : 'a server'} (${p.server!.models.length} models)`).join(', ')}.`;
    return;
  }
  const blocked = probes.find((p) => p.problem === 'forbidden-origin');
  const empty = probes.find((p) => p.problem === 'no-models');
  const problem = blocked ?? empty ?? probes[0]!;
  $('detectStatus').textContent = 'No usable local server found.';
  help.hidden = false;
  help.textContent = localSetupHelp(problem.problem!, /:1234/.test(problem.url) ? 'lmstudio' : 'ollama', os());
}

async function renderSites() {
  const list = $('sites');
  const sites = await enabledSites();
  if (!sites.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'None yet. Click the Margin toolbar button on a site to turn checking on there.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...sites.map((origin) => {
      const li = document.createElement('li');
      li.append(`${origin} `);
      const b = document.createElement('button');
      b.textContent = 'Turn off';
      b.addEventListener('click', async () => {
        await disableSite(origin);
        await renderSites();
      });
      li.append(b);
      return li;
    }),
  );
}

async function init() {
  const s = await loadSettings();
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=provider]')) {
    r.checked = r.value === s.provider;
    r.addEventListener('change', async () => {
      await save({ provider: r.value as Settings['provider'] });
      showSections(r.value as Settings['provider']);
      if (r.value === 'local') await detect();
    });
  }
  showSections(s.provider);
  const baseUrl = $<HTMLInputElement>('localBaseUrl');
  baseUrl.value = s.localBaseUrl;
  baseUrl.addEventListener('change', () => save({ localBaseUrl: baseUrl.value.trim() || 'http://localhost:11434/v1' }));
  fillModels([], s.provider === 'local' ? s.model : '');
  $<HTMLSelectElement>('localModel').addEventListener('change', (e) => save({ model: (e.target as HTMLSelectElement).value }));
  $('detect').addEventListener('click', () => void detect());

  const key = $<HTMLInputElement>('geminiKey');
  key.value = s.geminiKey;
  key.addEventListener('change', () => save({ geminiKey: key.value.trim() }));
  const consent = $<HTMLInputElement>('geminiConsent');
  consent.checked = s.geminiConsent;
  consent.addEventListener('change', () => save({ geminiConsent: consent.checked }));

  const dialect = $<HTMLSelectElement>('dialect');
  dialect.value = s.dialect;
  dialect.addEventListener('change', () => save({ dialect: dialect.value as Settings['dialect'] }));
  const idle = $<HTMLInputElement>('idleDelayMs');
  idle.value = String(s.idleDelayMs);
  idle.addEventListener('change', () => save({ idleDelayMs: Math.max(500, Number(idle.value) || 2000) }));

  $('test').addEventListener('click', async () => {
    $('testStatus').textContent = 'Testing…';
    const r = await send<CheckResponse & { advice?: string }>({ type: 'test-model' });
    $('testStatus').textContent = r.ok
      ? `Works (${r.model}): ${r.suggestions.length ? `suggested “${r.suggestions[0]!.replacement}” for a test sentence` : 'no suggestion for the test sentence'}.${r.advice ? ` ${r.advice}` : ''}`
      : r.error;
  });
  $('clearCache').addEventListener('click', async () => {
    await send({ type: 'clear-cache' });
    $('clearStatus').textContent = 'Cache cleared.';
  });
  $('clearIgnored').addEventListener('click', async () => {
    await send({ type: 'clear-ignored' });
    $('clearStatus').textContent = 'Ignored suggestions cleared.';
  });
  await renderSites();
  if (s.provider === 'local') await detect();
}

void init();
