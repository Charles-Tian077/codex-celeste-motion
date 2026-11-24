import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function nativePage(url) {
  try {
    const page = new URL(url);
    if (page.protocol !== 'app:' || page.hostname !== '-' || page.pathname !== '/index.html') return false;
    const route = page.searchParams.get('initialRoute');
    return !/^\/(?:avatar-overlay|global-dictation|hotkey-window|spotlight)(?:[/?#]|$)/.test(route ?? '');
  } catch {
    return false;
  }
}

async function findBrowser(port) {
  const deadline = Date.now() + 12500;
  while (Date.now() < deadline) {
    const result = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(400), redirect: 'error',
    }).then((response) => response.json()).catch(() => null);
    if (result?.webSocketDebuggerUrl) {
      const url = new URL(result.webSocketDebuggerUrl);
      assert.equal(url.protocol, 'ws:');
      assert.equal(url.host, `127.0.0.1:${port}`);
      assert.match(url.pathname, /^\/devtools\/browser\/[a-f0-9-]+$/i);
      assert.ok(!url.search && !url.hash && !url.password && !url.username);
      return url;
    }
    await delay(45);
  }
  throw new Error('The local Codex debugger did not respond.');
}

class BrowserLink {
  constructor(url, receiveEvent) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.id = 0;
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Opening the local renderer connection timed out.')), 3500);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The local renderer connection failed.')); }, { once: true });
    });
    this.closed = new Promise((resolve) => this.socket.addEventListener('close', resolve, { once: true }));
    this.socket.addEventListener('message', ({ data }) => {
      if (data.startsWith('{"method":"Runtime.consoleAPICalled"')) return;
      const message = JSON.parse(data);
      if (message.method) return receiveEvent(message);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('The local renderer closed.'));
      }
      this.pending.clear();
    });
  }

  call(method, params, sessionId) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The local renderer is disconnected.'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The local renderer timed out during ${method}.`));
      }, 5000);
      this.pending.set(id, { timer, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  async evaluate(sessionId, expression, returnByValue = true) {
    const { result, exceptionDetails } = await this.call('Runtime.evaluate', {
      expression, returnByValue, awaitPromise: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.split('\n')[0] ?? 'Theme evaluation failed.');
    return returnByValue ? result.value : result.objectId;
  }
}

const stateExpression = `window[Symbol.for('codex-amber-motion')]?.diagnostic()`;
const mediaExpression = `location.protocol === 'app:' && location.hostname === '-' && location.pathname === '/index.html'
  ? document.querySelector('input[type=file][data-codex-amber-media]') : undefined`;

async function apply() {
  const [port, folder, mode, statusFile] = process.argv.slice(2);
  assert.match(port ?? '', /^\d{1,5}$/);
  assert.ok(Number(port) > 0 && Number(port) <= 65535);
  assert.ok(['launch', 'refresh', 'verify'].includes(mode));
  const verifying = mode === 'verify';
  const revision = 29;
  const media = ['intro.mp4', 'background.mp4', 'background.webp'].map((name) => resolve(folder, name));
  const [script, css, poster] = await Promise.all([
    readFile(new URL('./theme.js', import.meta.url), 'utf8'),
    readFile(new URL('./theme.css', import.meta.url), 'utf8'),
    readFile(resolve(folder, 'splash.webp')),
    ...media.map((path) => access(path)),
  ]);
  const revealUntil = mode === 'refresh' ? 0 : Date.now() + 16000;
  const source = `(${script.trim()})(${JSON.stringify({ css, splash: `data:image/webp;base64,${poster.toString('base64')}`, revealUntil, launchId: randomUUID(), revision })})`;
  const sessions = new Map();
  const ready = Promise.withResolvers();
  const boot = [];
  const decoder = new Map();

  function event(message) {
    const { method, params, sessionId } = message;
    if (method === 'Target.attachedToTarget') {
      const { sessionId: attached, targetInfo } = params;
      if (targetInfo.type !== 'page' || (targetInfo.url && targetInfo.url !== 'about:blank' && !nativePage(targetInfo.url))) {
        void link.call('Target.detachFromTarget', { sessionId: attached }).catch(() => {});
        return;
      }
      const entry = { sessionId: attached, target: targetInfo, supplying: false };
      sessions.set(attached, entry);
      void prepare(entry).catch((error) => {
        if (verifying) boot.push({ stage: 'attach-error', error: error.message });
      });
      return;
    }
    if (method === 'Target.detachedFromTarget') sessions.delete(params.sessionId);
    if (method === 'Page.frameNavigated' && !params.frame.parentId && nativePage(params.frame.url)) {
      const entry = sessions.get(sessionId);
      if (entry) void refreshDocument(entry).catch(() => {});
    }
    if (method === 'Runtime.bindingCalled' && params.name === 'codexAmberMediaReady' && params.payload === 'media') {
      const entry = sessions.get(sessionId);
      if (entry) void supply(entry).catch(() => {});
    }
    if (verifying && method === 'Media.playerPropertiesChanged') {
      const changes = params.properties.filter(({ name }) => /^(kIsPlatformVideoDecoder|kVideoDecoderName|kResolution)$/.test(name));
      if (!changes.length) return;
      const current = decoder.get(params.playerId) ?? {};
      for (const { name, value } of changes) current[name] = value;
      decoder.set(params.playerId, current);
    }
  }

  const link = new BrowserLink(await findBrowser(port), event);

  async function prepare(entry) {
    const id = entry.sessionId;
    const runtime = link.call('Runtime.enable', {}, id);
    const page = link.call('Page.enable', {}, id);
    const binding = link.call('Runtime.addBinding', { name: 'codexAmberMediaReady' }, id);
    const injection = link.call('Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true }, id);
    if (verifying) void link.call('Media.enable', {}, id).catch(() => {});
    await Promise.all([runtime, page, binding, injection]);
    await supply(entry);
  }

  async function refreshDocument(entry) {
    for (let attempt = 0; attempt < 3 && sessions.has(entry.sessionId); attempt++) {
      try {
        await link.evaluate(entry.sessionId, source);
        await supply(entry);
        return;
      } catch {
        await delay(40);
      }
    }
  }

  async function supply(entry) {
    if (entry.supplying) return;
    entry.supplying = true;
    const id = entry.sessionId;
    let objectId;
    try {
      objectId = await link.evaluate(id, mediaExpression, false);
      if (objectId) await link.call('DOM.setFileInputFiles', { objectId, files: media }, id);
      else if (mode !== 'refresh') return;
      const state = await link.evaluate(id, stateExpression);
      if (state?.revision === revision && ['reveal', 'live'].includes(state.phase)) {
        if (verifying) boot.push({ stage: 'supplied', ...state });
        ready.resolve(entry);
      }
    } finally {
      if (objectId) void link.call('Runtime.releaseObject', { objectId }, id).catch(() => {});
      entry.supplying = false;
    }
  }

  try {
    await link.opened;
    await link.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: 'page', exclude: false }, { exclude: true }] });

    const entry = await Promise.race([ready.promise, link.closed.then(() => null), delay(14500, null, { ref: false })]);
    if (!entry) {
      if (verifying) console.log(JSON.stringify({ boot }));
      throw new Error('The native Codex window did not accept the theme media.');
    }
    if (verifying) {
      const { verifyTheme } = await import('./verify.mjs');
      await verifyTheme(link, entry, { boot, decoder, stateExpression, sessions });
      return;
    }
    await writeFile(statusFile, JSON.stringify({ ok: true, helper: process.pid, revision }));
    try { await link.closed; }
    finally { await unlink(statusFile).catch(() => {}); }
  } finally {
    link.socket.close();
  }
}

apply().catch(async (error) => {
  console.error(error.message);
  const [, , , status] = process.argv.slice(2);
  if (status) await writeFile(status, JSON.stringify({ ok: false, message: error.message })).catch(() => {});
  process.exitCode = 1;
});
