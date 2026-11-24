(function (matches, splash) {
  const key = Symbol.for('celeste-native-motion');
  if (window.top !== window || !matches(location) || window[key]) return;
  const session = 'celeste-animation-seen';
  const html = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const {signal} = abort;
  const inherited = new Map();
  const files = new Map();
  let played = false;
  try { played = sessionStorage.getItem(session) === '1'; } catch {}
  const showIntro = !played && !reduced.matches;
  let phase = showIntro ? 'opening' : 'loading';
  let ready = false;
  let closed = false;
  let openingResult;
  let release;
  let refresh;
  let deadline;
  let resumeAt = 0;
  let scene;
  let introLayer;
  let input;
  let background;
  let intro;

  const css = document.createElement('style');
  css.textContent = `
    html[data-celeste-motion='live'], html[data-celeste-motion='live'] body {
      background: transparent !important;
    }
    html[data-celeste-motion='live'] body { isolation: isolate; }
    #celeste-motion-back, #celeste-motion-intro {
      position: fixed; inset: 0; overflow: hidden; pointer-events: none;
    }
    #celeste-motion-back { z-index: -1; background: #160e0b center / cover no-repeat; }
    #celeste-motion-back::after {
      position:absolute; inset:0; content:'';
      background: linear-gradient(90deg, rgb(9 7 12 / .58), transparent 55%),
        linear-gradient(180deg, rgb(12 8 11 / .23), rgb(13 10 15 / .43) 62%, rgb(12 9 13 / .65));
    }
    #celeste-motion-intro { z-index: 2147483000; background: #080505 center / contain no-repeat; pointer-events: auto; }
    #celeste-motion-back video, #celeste-motion-intro video {
      width: 100%; height: 100%; position: absolute; inset: 0; opacity: 0;
    }
    #celeste-motion-back video { object-fit: cover; object-position: 62% center; }
    #celeste-motion-intro video { object-fit: contain; }
    #celeste-motion-back[data-active] video, #celeste-motion-intro[data-active] video { opacity: 1; }
    #celeste-motion-back[data-active] { background-image: none !important; }
    html[data-celeste-motion='live'] [data-celeste-glass] {
      background-color: rgb(17 12 18 / var(--celeste-glass, .44)) !important;
      backdrop-filter: none !important;
    }
  `;
  (document.head || html).append(css);

  const state = () => ({
    phase, ready, openingResult,
    sources: [intro,background].filter(video => video?.hasAttribute('src')).length,
    background: background && {
      duration:background.duration, time:background.currentTime, playing:!background.paused,
      width:background.videoWidth,height:background.videoHeight,
    },
  });
  window[key] = {state};

  function createVideo(loop) {
    const video = document.createElement('video');
    video.loop = loop;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    return video;
  }
  function clear(video) {
    if (!video?.hasAttribute('src')) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  function paintGlass() {
    refresh = undefined;
    if (phase !== 'live' || !document.body) return;
    // Limit changes to large layout surfaces. Dialogs and individual controls
    // retain their original backgrounds, behavior and accessibility.
    const width = html.clientWidth, height = html.clientHeight;
    for (const [x,y] of [[.06,.45],[.19,.27],[.49,.68],[.80,.53],[.93,.21]]) {
      for (let element = document.elementFromPoint(width*x,height*y); element && element!==document.body; element=element.parentElement) {
        if (inherited.has(element) || element.closest('[role=dialog], [aria-modal=true]')) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.height < height*.49 || bounds.width < Math.min(104,width*.14)) continue;
        const style = getComputedStyle(element);
        if (style.backgroundImage !== 'none') continue;
        const color = style.backgroundColor;
        if (color === 'transparent' || /[, /]0\)$/.test(color)) continue;
        inherited.set(element,element.getAttribute('data-celeste-glass'));
        element.style.setProperty('--celeste-glass', bounds.width > width*.85 && bounds.height > height*.82 ? '.06' : '.42');
        element.setAttribute('data-celeste-glass','');
      }
    }
    for (const element of inherited.keys()) if (!element.isConnected) inherited.delete(element);
  }
  function scheduleGlass() {
    if (!refresh && phase === 'live') refresh = setTimeout(paintGlass,180);
  }
  const layout = new MutationObserver(scheduleGlass);

  function canPlay() {
    return !document.hidden && document.hasFocus() && !reduced.matches;
  }
  function playBackground() {
    if (phase !== 'live' || !canPlay() || background.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || !background.paused) return;
    if (!scene.hasAttribute('data-active')) {
      scene.setAttribute('data-active','');
      requestAnimationFrame(playBackground);
      return;
    }
    background.play().catch(() => {});
  }
  function updatePlayback() {
    clearTimeout(release);
    if (phase === 'opening' && ready) {
      if (reduced.matches) return finish('reduced-motion');
      if (document.hidden) intro.pause();
      else if (intro.readyState >= 3 && intro.paused) intro.play().catch(() => finish('unavailable'));
      return;
    }
    if (phase !== 'live') return;
    if (!canPlay()) {
      if (!background.hasAttribute('src')) return;
      background.pause();
      resumeAt = background.currentTime;
      release = setTimeout(() => {
        clear(background);
        scene.removeAttribute('data-active');
      },900);
    } else {
      if (!background.hasAttribute('src')) background.src = files.get('background.mp4');
      requestAnimationFrame(playBackground);
    }
  }
  function finish(reason) {
    if (phase === 'live' || closed) return;
    clearTimeout(deadline);
    if (intro) {
      openingResult = {reason,duration:intro.duration,rate:intro.playbackRate,time:intro.currentTime};
      clear(intro);
      introLayer.remove();
    }
    const openingUrl = files.get('intro.mp4');
    if (openingUrl) URL.revokeObjectURL(openingUrl);
    files.delete('intro.mp4');
    try { sessionStorage.setItem(session,'1'); } catch {}
    scene.style.backgroundImage = `url("${files.get('background.webp')}")`;
    document.body.prepend(scene);
    phase = 'live';
    html.dataset.celesteMotion = phase;
    layout.observe(document.body,{subtree:true,childList:true});
    scheduleGlass();
    updatePlayback();
  }
  function mount() {
    if (closed || !document.body || input) return;
    observer.disconnect();
    scene=document.createElement('div');
    scene.id='celeste-motion-back';
    scene.setAttribute('aria-hidden','true');
    background=createVideo(true);
    scene.append(background);
    background.addEventListener('canplay', () => requestAnimationFrame(playBackground), {signal});
    background.addEventListener('loadedmetadata', () => {
      if (resumeAt > 0 && resumeAt < background.duration) background.currentTime=resumeAt;
    }, {signal});
    background.addEventListener('error',()=>scene.removeAttribute('data-active'),{signal});
    if (showIntro) {
      introLayer=document.createElement('div');
      introLayer.id='celeste-motion-intro';
      introLayer.setAttribute('aria-hidden','true');
      introLayer.style.backgroundImage=`url("${splash}")`;
      intro=createVideo(false);
      introLayer.append(intro);
      document.body.append(introLayer);
      intro.addEventListener('canplay',updatePlayback,{signal});
      intro.addEventListener('playing',()=>introLayer.setAttribute('data-active',''),{signal});
      intro.addEventListener('ended',()=>finish('ended'),{signal,once:true});
      intro.addEventListener('error',()=>finish('unavailable'),{signal,once:true});
    }
    input = document.createElement('input');
    input.type='file';
    input.multiple=true;
    input.hidden=true;
    input.dataset.celesteMotionFiles='';
    input.addEventListener('change', () => {
      if (ready) return;
      for (const file of input.files) files.set(file.name,URL.createObjectURL(file));
      ready=['intro.mp4','background.mp4','background.webp'].every(name=>files.has(name));
      if (!ready) return dispose();
      input.remove();
      if (intro) {
        deadline=setTimeout(()=>finish('timeout'),30000);
        intro.src=files.get('intro.mp4');
      } else finish('resume');
    },{signal});
    document.body.append(input);
    window.celesteMotionNeedsMedia?.();
    deadline=setTimeout(()=>{if (!ready) dispose();},16000);
  }
  function dispose() {
    closed=true;
    abort.abort();
    observer.disconnect();
    layout.disconnect();
    clearTimeout(release);
    clearTimeout(refresh);
    clearTimeout(deadline);
    clear(intro);
    clear(background);
    input?.remove();
    introLayer?.remove();
    scene?.remove();
    css.remove();
    for (const [element,value] of inherited) {
      if (value===null) element.removeAttribute('data-celeste-glass');
      else element.setAttribute('data-celeste-glass',value);
      element.style.removeProperty('--celeste-glass');
    }
    for (const url of files.values()) URL.revokeObjectURL(url);
    delete html.dataset.celesteMotion;
    delete window[key];
  }
  const observer=new MutationObserver(mount);
  observer.observe(html,{childList:true});
  window.addEventListener('pagehide',dispose,{signal,once:true});
  window.addEventListener('focus',updatePlayback,{signal});
  window.addEventListener('blur',updatePlayback,{signal});
  window.addEventListener('resize',scheduleGlass,{signal});
  document.addEventListener('visibilitychange',updatePlayback,{signal});
  reduced.addEventListener('change',updatePlayback,{signal});
  mount();
})
