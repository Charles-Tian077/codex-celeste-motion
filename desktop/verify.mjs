import { inspectNativeSettings } from './verify-settings.mjs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

async function waitFor(read, accepts, label, timeout = 13000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read().catch(() => undefined);
    if (last && accepts(last)) return last;
    await delay(90);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

async function verifyRegions(call, evaluate) {
  const zones = await evaluate(`(() => {
    const bounds = (selectors, vertical = .38) => {
      const el = [...document.querySelectorAll(selectors)].find((item) => item.clientWidth > 0 && item.clientHeight > 0);
      if (!el) return;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left + b.width * .44), y: Math.round(b.top + b.height * vertical),
        width: 20, height: 20, scale: 1 };
    };
    return { rail: bounds('[data-app-navigation-rail]'), account: bounds('[data-app-navigation-rail]', .946), sidebar: bounds('[data-sidebar-navigation-root]'),
      workspace: bounds('[data-app-shell-main-surface]'), composer: bounds('[data-composer-surface-variant]'),
      projectBar: bounds('[data-composer-utility-rail][data-composer-rail-item]') };
  })()`);
  for (const zone of ['rail', 'account', 'sidebar', 'workspace', 'composer', 'projectBar']) assert.ok(zones[zone], `Native ${zone} exists.`);

  const visible = (value) => evaluate(`(() => {
    document.getElementById('codex-amber-scene').style.visibility = ${JSON.stringify(value)};
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  })()`);
  const screenshot = async (clip) => (await call('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })).data;
  const verified = [];
  for (const [zone, clip] of Object.entries(zones)) {
    const withVideo = await screenshot(clip);
    let withoutVideo;
    try {
      await visible('hidden');
      withoutVideo = await screenshot(clip);
    } finally {
      await visible('');
    }
    if (withVideo === withoutVideo) {
      const details = await evaluate(`(() => {
        const [x,y]=[${clip.x + 10},${clip.y + 10}];
        const all = [...document.querySelectorAll('body *')].filter((el) => {
          const {left,right,top,bottom} = el.getBoundingClientRect();
          return x >= left && x < right && y >= top && y < bottom;
        });
        const stack = all.map((el) => {
          const info = (s) => [s.backgroundColor,s.backgroundImage.startsWith('url(')?'url()':s.backgroundImage.slice(0,95),s.opacity,s.zIndex];
          const s = getComputedStyle(el), before = getComputedStyle(el,'::before'), after = getComputedStyle(el,'::after');
          return [el.tagName, [...el.classList].filter((value) => /surface|bg-|fade|cover|overlay|isolate/.test(value)).slice(0,5),
            el.getAttributeNames().filter((name) => /^data-(app-shell|codex-|thread-)/.test(name)),
            info(s), before.content === 'none' ? null : info(before), after.content === 'none' ? null : info(after)];
        });
        return { dpr: devicePixelRatio, clip: ${JSON.stringify(clip)}, stack: stack.filter((item)=>item[3][0] !== 'rgba(0, 0, 0, 0)' || item[3][1] !== 'none' || item[4] || item[5]).slice(0,25),
          scene: document.getElementById('codex-amber-scene').getBoundingClientRect().toJSON() };
      })()`);
      console.log(JSON.stringify({ failedRegion: zone, details }));
      const fs = await import('node:fs/promises');
      await fs.writeFile(new URL('./qa/clip-with.png', import.meta.url), Buffer.from(withVideo, 'base64')).catch(() => {});
      await fs.writeFile(new URL('./qa/clip-without.png', import.meta.url), Buffer.from(withoutVideo, 'base64')).catch(() => {});
    }
    assert.notEqual(withVideo, withoutVideo, `${zone} must reveal pixels from the shared Claude animation.`);
    verified.push(zone);
  }
  console.log('Native compositing:', verified.join(', '));
}

async function verifyCompleteOpening(reveal, sample) {
  assert.equal(reveal.openingOpacity, 1, 'The visible opening must paint over the native loader.');
  await delay(Math.max(0, (reveal.duration - reveal.time) * 1000));
  const complete = await waitFor(sample, (s) => s.phase === 'live' && s.openingResult?.reason === 'ended',
    'The original-speed clip did not finish and hand off to Codex', 11000);
  const playback = complete.openingResult;
  assert.equal(playback.rate, 1);
  assert.ok(Math.abs(playback.duration - 323 / 30) < .02 && Math.abs(playback.endTime - playback.duration) < .04);
  assert.ok(playback.finishedAt - complete.revealPlayAt >= 10600, 'The complete intro must play at original speed.');
  assert.ok(complete.workbenchMountedAt <= playback.finishedAt + 300, 'The active workbench should be ready at handoff.');
  console.log(JSON.stringify({ playback, workbenchMountedAt: complete.workbenchMountedAt,
    playBeganAt: complete.revealPlayAt }));
}

export async function verifyTheme(link, entry, { boot, decoder, stateExpression, sessions }) {
  let session = entry.sessionId;
  const call = (method, params = {}) => link.call(method, params, session);
  const evaluate = (expression) => link.evaluate(session, expression);
  const sample = () => evaluate(stateExpression);
  const reveal = await waitFor(sample, (s) => s.phase === 'reveal' && s.time >= .15 && s.media, 'The gradual Claude reveal did not play', 11000);
  assert.equal(reveal.width, 2560);
  assert.equal(reveal.height, 1440);
  assert.equal(reveal.rate, 1);
  assert.equal(reveal.loop, false);
  assert.equal(reveal.videoCount, 1);
  assert.ok(boot.some((state) => state.logoSuppressed), 'Stock loader must be suppressed during early boot.');
  assert.ok(reveal.revealAt <= reveal.firstPaint && reveal.revealPlayAt >= reveal.firstPaint, 'Replace the first paint and play only after it.');
  console.log(JSON.stringify({ reveal, early: boot[0] }));
  await verifyCompleteOpening(reveal, sample);

  const workbenchReady = (s) => s?.phase === 'live' && s.media && s.pane && s.composer && s.rail && s.sidebar;
  const findWorkbench = async () => {
    const current = await sample();
    if (workbenchReady(current)) return current;
    for (const id of sessions.keys()) {
      if (id === session) continue;
      const state = await link.evaluate(id, stateExpression).catch(() => null);
      if (workbenchReady(state)) { session = id; return state; }
    }
    return current;
  };
  let live;
  try {
    live = await waitFor(findWorkbench, workbenchReady, 'The complete workbench animation did not start', 17500);
  } catch (error) {
    for (const id of sessions.keys()) {
      const shape = await link.evaluate(id, `(() => {
        const root = document.getElementById('root');
        return { live: ${stateExpression}, initialRoute: new URLSearchParams(location.search).get('initialRoute')?.split('/')[1]?.replace(/[^a-z-]/gi, '').slice(0, 24),
          children: [...(root?.children ?? [])].slice(0, 6).map((el) => [el.tagName, [...el.classList].slice(0, 6), el.childElementCount]),
          attributes: [...document.querySelectorAll('main, [data-app-shell-frame], [data-codex-composer]')].slice(0, 8).map((el) => el.getAttributeNames().filter((x) => x.startsWith('data-'))) };
      })()`).catch(() => null);
      console.log(JSON.stringify({ shape }));
    }
    throw error;
  }
  assert.equal(live.width, 2560);
  assert.equal(live.height, 1440);
  assert.equal(live.videoCount, 1);
  assert.equal(live.inert, false);
  assert.equal(live.loop, true);
  assert.equal(live.fullWindow, true);
  await delay(1450);
  const baseline = await sample();
  await delay(8100);
  const steady = await sample();
  const decoded = steady.decoded - baseline.decoded;
  const dropped = steady.dropped - baseline.dropped;
  console.log(JSON.stringify({ steadyPlayback: { decoded, dropped, initialTime: baseline.time, finalTime: steady.time,
    duration: steady.duration, foreground: steady.playOnFocus }, decoder: [...decoder.values()] }));
  const elapsed = (steady.time - baseline.time + steady.duration) % steady.duration;
  assert.ok(decoded >= 222 && Math.abs(elapsed - 8.1) < .7 && Math.abs(steady.duration - 12) < .06,
    'The full-resolution background must play across a six-second cycle without a decoder seek.');
  await verifyRegions(call, evaluate);

  await evaluate(`(() => {
    const video = document.querySelector('#codex-amber-scene video');
    video.currentTime = video.duration - .55;
  })()`);
  await waitFor(sample, (s) => s.media && s.time > 0 && s.time < 1, 'Native 12-second playback did not wrap', 4500);

  await evaluate(`(async () => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
    window.dispatchEvent(new Event('blur'));
  })()`);
  try {
    await waitFor(sample, (s) => s.videoCount === 0 && !s.media && s.fullWindow, 'Inactive window did not release its decoder', 3500);
  } finally {
    await evaluate(`delete document.hasFocus; window.dispatchEvent(new Event('focus'));`);
  }
  await waitFor(sample, (s) => s.fullWindow && s.media && s.videoCount === 1, 'Background did not resume on focus', 4000);
  console.log('Inactive playback releases its video and resumes with one decoder.');

  await call('Page.reload');
  let reloaded;
  try {
    reloaded = await waitFor(findWorkbench, (s) => workbenchReady(s) && s.revealAt === undefined, 'Recreated renderer did not restore the theme');
  } catch (error) {
    for (const id of sessions.keys()) {
      const state = await link.evaluate(id, `({scheme: location.protocol, pathname: location.pathname, initial: new URLSearchParams(location.search).get('initialRoute')?.split('/')[1]?.replace(/[^a-z-]/gi,'').slice(0,20),
        state: ${stateExpression}, shell: !!document.querySelector('[data-app-shell-frame]'), input: !!document.querySelector('[data-codex-amber-media]')})`).catch((e) => e.message);
      console.log(JSON.stringify({ reloadCandidate: state }));
    }
    throw error;
  }
  assert.equal(reloaded.revealAt, undefined);
  console.log('Theme restored after renderer reload without replaying the opening.');

  await inspectNativeSettings(call, evaluate, {
    verify: true,
    findSettings: async (expression) => {
      for (const id of sessions.keys()) {
        if (id === session) continue;
        const view = await link.evaluate(id, expression).catch(() => null);
        if (view?.settings) {
          return { view, call: (method, params) => link.call(method, params, id), evaluate: (script) => link.evaluate(id, script) };
        }
      }
    },
  });
}
