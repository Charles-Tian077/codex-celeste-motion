import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [port, target, media, result] = process.argv.slice(2);
assert.match(port, /^\d{1,5}$/);
const matches = {
  Doubao: (page) => page.protocol === 'doubao:' && page.hostname === 'doubao-chat' && /^\/chat(?:\/|$)/.test(page.pathname),
  DeepSeek: (page) => ['localhost', '127.0.0.1', 'dsh.local'].includes(page.hostname) &&
    ['http:', 'https:'].includes(page.protocol),
  Qwen: (page) => (['tauri.localhost', 'localhost', '127.0.0.1'].includes(page.hostname) &&
    ['http:', 'https:'].includes(page.protocol)) || page.protocol === 'tauri:',
};
assert.ok(matches[target]);

function eligible(url) {
  try { return matches[target](new URL(url)); } catch { return false; }
}

class Connection {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.requests = new Map();
    this.serial = 0;
    this.events = () => {};
    this.opened = new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('The app renderer did not respond.')), 4500);
      this.socket.addEventListener('open', () => { clearTimeout(timer); done(); }, {once:true});
      this.socket.addEventListener('error', () => { clearTimeout(timer); fail(new Error('Cannot connect to the app renderer.')); }, {once:true});
    });
    this.closed = new Promise(done => this.socket.addEventListener('close', done, {once:true}));
    this.socket.addEventListener('message', ({data}) => {
      const message = JSON.parse(data);
      if (message.method) {
        this.events(message);
        return;
      }
      const reply = this.requests.get(message.id);
      if (!reply) return;
      this.requests.delete(message.id);
      clearTimeout(reply.timer);
      if (message.error) reply.reject(new Error(message.error.message));
      else reply.resolve(message.result);
    });
  }
  call(method, params = {}, sessionId) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`Renderer command timed out: ${method}`));
      }, 4600);
      this.requests.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async evaluate(sessionId, expression, returnByValue = true) {
    const reply = await this.call('Runtime.evaluate', { expression, returnByValue, awaitPromise: true }, sessionId);
    if (reply.exceptionDetails) return null;
    return returnByValue ? reply.result.value : reply.result.objectId;
  }
}

async function main() {
  const address = `127.0.0.1:${port}`;
  const info = await fetch(`http://${address}/json/version`, {
    redirect:'error', signal:AbortSignal.timeout(2500),
  }).then(response => response.json());
  const endpoint = new URL(info.webSocketDebuggerUrl);
  assert.equal(endpoint.protocol, 'ws:');
  assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname) && endpoint.port === port);
  assert.match(endpoint.pathname, /^\/devtools\/browser\/[\w-]+$/);
  assert.ok(!endpoint.hash && !endpoint.search && !endpoint.username && !endpoint.password);
  endpoint.hostname = '127.0.0.1';
  const connection = new Connection(endpoint);
  await connection.opened;
  const [renderer, splash] = await Promise.all([
    readFile(new URL('./scene.js', import.meta.url), 'utf8'),
    readFile(resolve(media, 'splash.webp')),
  ]);
  const files = ['intro.mp4','background.mp4','background.webp'].map(name => resolve(media,name));
  const source = `(${renderer.trim()})(${matches[target].toString()},${JSON.stringify('data:image/webp;base64,'+splash.toString('base64'))})`;
  const pages = new Map();
  const openedAt = Date.now();
  let confirmed = false;

  async function supply(session) {
    if (session.loading) return;
    session.loading = true;
    try {
      const objectId = await connection.evaluate(session.id,
        "document.querySelector('input[data-celeste-motion-files]')", false);
      if (objectId) {
        await connection.call('DOM.setFileInputFiles', {objectId, files}, session.id);
        await connection.call('Runtime.releaseObject', {objectId}, session.id).catch(() => {});
      }
      const state = await connection.evaluate(session.id, "window[Symbol.for('celeste-native-motion')]?.state()");
      if (!confirmed && state?.ready) {
        confirmed = true;
        await writeFile(result, JSON.stringify({ok:true, phase:state.phase}));
      }
    } finally {
      session.loading = false;
    }
  }
  async function prepare(session) {
    await Promise.all([
      connection.call('Runtime.enable', {}, session.id),
      connection.call('Runtime.addBinding', {name:'celesteMotionNeedsMedia'}, session.id),
      connection.call('Page.enable', {}, session.id),
    ]);
    await connection.call('Page.addScriptToEvaluateOnNewDocument', {source,runImmediately:true},session.id);
    await connection.evaluate(session.id, source);
    await supply(session);
  }
  connection.events = ({method, params, sessionId}) => {
    if (method === 'Runtime.bindingCalled' && params.name === 'celesteMotionNeedsMedia') {
      const page = [...pages.values()].find(entry => entry.id === sessionId);
      if (page) void supply(page).catch(() => {});
    }
    if (method === 'Target.targetDestroyed') pages.delete(params.targetId);
  };
  await connection.call('Target.setDiscoverTargets', {discover:true});
  try {
    while (connection.socket.readyState === WebSocket.OPEN) {
      const {targetInfos} = await connection.call('Target.getTargets');
      for (const page of targetInfos) {
        if (page.type !== 'page' || !eligible(page.url) || pages.has(page.targetId)) continue;
        const {sessionId:id} = await connection.call('Target.attachToTarget',{targetId:page.targetId,flatten:true});
        const session = {id};
        pages.set(page.targetId, session);
        await prepare(session);
      }
      if (!confirmed && Date.now()-openedAt > 20500) throw new Error(`A supported ${target} workbench was not detected.`);
      if (!confirmed) {
        await Promise.all([...pages.values()].map(page => supply(page).catch(() => {})));
      }
      await Promise.race([connection.closed, delay(confirmed ? 1000 : 100)]);
    }
  } finally {
    connection.socket.close();
  }
}
main().catch(async error => {
  await writeFile(result, JSON.stringify({ok:false,error:error.message})).catch(() => {});
  process.exitCode = 1;
});
