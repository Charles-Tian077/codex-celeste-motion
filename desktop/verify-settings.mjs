import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

function inspect(remember) {
  const settingPanel = document.querySelector('[data-settings-panel]');
  const headings = [...document.querySelectorAll('h1,h2,[role=heading]')];
  const account = headings.some(el => /^(account|账户|帐户|账号)$/i.test(el.textContent.trim()));
  const settings = account || Boolean(settingPanel) || headings.some(el => /^(settings|设置)$/i.test(el.textContent.trim()));
  const scene = document.getElementById('codex-amber-scene');
  const video = scene?.querySelector('video');
  if (remember && video) window[Symbol.for('codex-amber-native-settings-test')] = video;
  const candidates = [];
  const labels = /^(settings|设置|preferences|偏好设置|account|账户|帐户|账号|appearance|外观|profile|个人资料|general|常规|通用)(?=$|[.…\s]|ctrl|control|⌘)/i;
  const controls = [...document.querySelectorAll('button,a,[role=menuitem],[role=button]')];
  for (const control of controls) {
    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(control).visibility !== 'visible' ||
        rect.bottom <= 0 || rect.top >= innerHeight || rect.left >= innerWidth || rect.right <= 0) continue;
    const names = [control.getAttribute('aria-label'),control.getAttribute('title'),control.textContent.trim()].filter(Boolean);
    const label = names.map(s=>s.trim().match(labels)?.[1]).find(Boolean) ?? '';
    const nav = Boolean(control.closest('[data-app-navigation-rail],[data-sidebar-navigation-root]'));
    const popup = control.getAttribute('aria-haspopup');
    const slug = control.getAttribute('data-settings-panel-slug');
    const role = control.getAttribute('role');
    if (!label && !slug && role !== 'menuitem' && !(nav && popup && rect.top > innerHeight * .65)) continue;
    const pos = [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)];
    candidates.push({label, nav, popup, slug, role, pos, expanded:control.getAttribute('aria-expanded'),
      hit:control.contains(document.elementFromPoint(...pos))});
  }
  return { settings, account, headingCount:headings.length, candidates, viewport:[innerWidth,innerHeight,devicePixelRatio],
    sameVideo: video && video === window[Symbol.for('codex-amber-native-settings-test')], menus:document.querySelectorAll('[role=menu]').length,
    scene: scene?.getBoundingClientRect().toJSON(), playing: Boolean(video && !video.paused && video.readyState >= 2),
    mediaSize: video && [video.videoWidth,video.videoHeight], time:video?.currentTime, focus:document.hasFocus(), hidden:document.hidden,
    theme:window[Symbol.for('codex-amber-motion')]?.diagnostic() };
}

function inspectPaint() {
  const capture = (el, pseudo) => {
    const s = getComputedStyle(el,pseudo);
    return [s.backgroundColor,s.backgroundImage === 'none' ? 'none' : s.backgroundImage.split('(')[0],
      s.opacity,s.visibility,s.zIndex,s.transform === 'none',s.backdropFilter === 'none'];
  };
  const walk = (x,y) => {
    let el = document.elementFromPoint(x,y);
    const stack = [];
    while (el) {
      const {x,y,width,height} = el.getBoundingClientRect();
      const data = el.getAttributeNames().filter(n=>/^data-(app-shell|settings|sidebar|codex)/.test(n));
      const clips = [Math.round(x),Math.round(y),Math.round(width),Math.round(height)];
      const s = capture(el);
      const before = getComputedStyle(el,'::before').content === 'none' ? null : capture(el,'::before');
      const after = getComputedStyle(el,'::after').content === 'none' ? null : capture(el,'::after');
      stack.push({data,cls:[...el.classList].filter(n=>/bg-|surface|settings|fixed|isolate/.test(n)).slice(0,12),clips,s,before,after});
      el = el.parentElement;
    }
    return stack;
  };
  const root = document.getElementById('root');
  const pane = document.querySelector('[data-settings-panel]');
  return {
    paneCover: pane && Array.from(pane.children).map(el => [capture(el), [...el.classList].slice(0,10)]),
    rootColor: root && capture(root),
    samples:[
      walk(innerWidth*.88,innerHeight*.83),walk(innerWidth*.38,innerHeight*.86),
      walk(innerWidth*.137,innerHeight*.32),walk(innerWidth*.023,innerHeight*.63),
    ],
  };
}

async function waitFor(read, accept, label, timeout = 13000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    last = await read().catch(() => undefined);
    if (last && accept(last)) return last;
    await delay(120);
  } while (Date.now() < deadline);
  throw new Error(label + ': ' + JSON.stringify(last));
}

export async function inspectNativeSettings(call, evaluate, { verify = false, findSettings } = {}) {
  let inspectCurrent = () => evaluate('(' + inspect.toString() + ')(false)');
  let info = await evaluate('(' + inspect.toString() + ')(true)');
  assert.ok(!info.settings, 'Start at the regular Codex workbench');
  const click = async (control) => {
    const [x,y] = control.pos;
    await call('Input.dispatchMouseEvent', {type:'mouseMoved',x,y});
    await call('Input.dispatchMouseEvent', {type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    await call('Input.dispatchMouseEvent', {type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
  };
  const select = async ({pos:[x,y], role}) => evaluate(`(() => {
    const hit = document.elementFromPoint(${x},${y});
    const item = hit?.closest(${JSON.stringify(role === 'menuitem' ? '[role=menuitem]' : 'button,a,[role=button]')});
    if (!item) return false;
    item.click();
    return true;
  })()`);
  const settingsButton = (view) => view.candidates.find(x=>/^(settings|设置|preferences|偏好设置)$/i.test(x.label) && x.hit);
  if (!settingsButton(info)) {
    const menu = info.candidates.filter(x=>x.nav && x.popup && x.pos[1]>info.viewport[1]*.65).sort((a,b)=>b.pos[1]-a.pos[1])[0];
    assert.ok(menu, 'The native rail settings or account menu was not found: ' + JSON.stringify(info.candidates));
    await click(menu);
    try {
      info = await waitFor(inspectCurrent, x=>settingsButton(x), 'The native account menu did not offer Settings', 2400);
    } catch (error) {
      console.log(String(error.message));
      await call('Input.dispatchKeyEvent', {type:'rawKeyDown',key:',',code:'Comma',windowsVirtualKeyCode:188,modifiers:2});
      await call('Input.dispatchKeyEvent', {type:'keyUp',key:',',code:'Comma',windowsVirtualKeyCode:188,modifiers:2});
      info = await inspectCurrent();
    }
  }
  if (settingsButton(info)) assert.ok(await select(settingsButton(info)), 'The visible Settings action could not be selected');
  const readSettings = async () => {
    const current = await inspectCurrent().catch(() => undefined);
    if (current?.settings || !findSettings) return current;
    const found = await findSettings('(' + inspect.toString() + ')(false)');
    if (found?.view?.settings) {
      call = found.call;
      evaluate = found.evaluate;
      inspectCurrent = () => evaluate('(' + inspect.toString() + ')(false)');
      return found.view;
    }
    return current;
  };
  info = await waitFor(readSettings, x=>x.settings, 'The native Settings action did not show Settings');
  if (!info.account) {
    const accountRow = (view) => view.candidates.find(x => x.hit && (x.slug==='account' || /^(account|账户|帐户|账号)$/i.test(x.label)));
    info = await waitFor(inspectCurrent, x=>x.account || accountRow(x), 'The native Settings sidebar did not show Account');
    if (!info.account) {
      assert.ok(await select(accountRow(info)), 'The visible Account section could not be selected');
      info = await waitFor(inspectCurrent, x=>x.account, 'The Account section did not open');
    }
  }

  let advance;
  if (verify) {
    const before = await waitFor(inspectCurrent, x=>x.playing && x.mediaSize?.[0]===2560, 'The Account page did not have a live background', 6500);
    assert.ok(before.scene.width >= before.viewport[0] - 1 && before.scene.height >= before.viewport[1] - 1,
      'The settings backdrop must cover the full window, including when the prior page is still mounted');
    await delay(420);
    const after = await inspectCurrent();
    advance = after.time - before.time;
    if (advance < 0) advance += after.theme.duration;
    assert.ok(advance > .15 && after.playing, 'The Account page video clock did not advance');
    info = after;
  }
  const paint = await evaluate('(' + inspectPaint.toString() + ')()');
  const samples = paint.samples.map(col=>col.filter(e=>e.s[0]!=='rgba(0, 0, 0, 0)' || e.s[1]!=='none' ||
    [e.before,e.after].some(p=>p && (p[0]!=='rgba(0, 0, 0, 0)'||p[1]!=='none'))).slice(0,15));
  console.log(JSON.stringify({ account:info.account, scene:info.scene && [info.scene.width,info.scene.height],
    playing:info.playing, sameVideo:info.sameVideo, viewport:info.viewport, focus:info.focus, hidden:info.hidden,
    paint:{paneCover:paint.paneCover,rootColor:paint.rootColor,samples} }));

  if (verify) {
    const shot = (x,y) => call('Page.captureScreenshot',{format:'png',clip:{x,y,width:16,height:16,scale:1}, captureBeyondViewport:true}).then(r=>r.data);
    const points = [[.86,.83],[.38,.86],[.135,.35],[.022,.70]];
    await evaluate("document.querySelector('#codex-amber-scene video').pause()");
    try {
      const shown = await Promise.all(points.map(([x,y])=>shot(Math.round(info.viewport[0]*x),Math.round(info.viewport[1]*y))));
      await evaluate("document.getElementById('codex-amber-scene').style.visibility='hidden'; new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const hidden = await Promise.all(points.map(([x,y])=>shot(Math.round(info.viewport[0]*x),Math.round(info.viewport[1]*y))));
      const pixels = shown.map((image,i)=>image!==hidden[i]);
      assert.ok(pixels.every(Boolean), 'The Account content and both navigation rails must reveal the background: ' + pixels);
      console.log(JSON.stringify({actualSettingsMenu:true,accountPixels:pixels,videoClockMoved:advance,sameVideo:info.sameVideo}));
    } finally {
      await evaluate("document.getElementById('codex-amber-scene').style.visibility=''; document.querySelector('#codex-amber-scene video').play()");
    }
    const appearance = info.candidates.find(x=>x.hit && (x.slug==='appearance' || /^(appearance|外观)$/i.test(x.label)));
    assert.ok(appearance && await select(appearance), 'The Appearance section was not available through Settings');
    const other = await waitFor(inspectCurrent, x=>x.settings && !x.account && x.playing, 'The Appearance section did not retain the live background');
    assert.equal(other.sameVideo, info.sameVideo, 'Switching settings sections must retain the same video');
    console.log(JSON.stringify({ appearance:true, samePlayingVideo:other.sameVideo }));
  }
  return {info,paint};
}
