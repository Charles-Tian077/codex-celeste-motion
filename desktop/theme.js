function installCodexAmber({ css, splash, revealUntil, launchId, revision }) {
  if (window !== window.top || location.protocol !== 'app:' || location.hostname !== '-' || location.pathname !== '/index.html') return;
  const initialRoute = new URLSearchParams(location.search).get('initialRoute');
  if (/^\/(?:avatar-overlay|global-dictation|hotkey-window|spotlight)(?:[/?#]|$)/.test(initialRoute ?? '')) return;
  const themeKey = Symbol.for('codex-amber-motion');
  const previousTheme = window[themeKey];
  if (previousTheme?.revision === revision) return;
  previousTheme?.dispose?.();

  const earlyRoute = initialRoute === null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let revealUsed = false;
  try { revealUsed = sessionStorage.getItem('codex-amber-reveal') === launchId; } catch {}
  const showReveal = earlyRoute && Date.now() < revealUntil && !revealUsed && !reducedMotion.matches;

  function layer(id, loop) {
    const panel = document.createElement('div');
    panel.id = id;
    panel.setAttribute('aria-hidden', 'true');
    const video = document.createElement('video');
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'none';
    video.loop = loop;
    panel.append(video);
    return { panel, video };
  }

  const reveal = showReveal ? layer('codex-amber-reveal', false) : null;
  const scene = layer('codex-amber-scene', true);
  const style = document.createElement('style');
  style.id = 'codex-amber-window-style';
  style.textContent = css;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const fileURLs = new Map();
  let phase = showReveal ? 'reveal' : 'pending';
  let root;
  let observedBody;
  let input;
  let originalInert;
  let deadline;
  let blurTimer;
  let releaseTimer;
  let resumeAt = 0;
  let revealAt;
  let revealPlayAt;
  let revealDone;
  let openingResult;
  let workbenchMountedAt;
  let olderLayerRetired = false;
  const dom = new MutationObserver(updateLayout);
  const paint = new PerformanceObserver(scheduleReveal);

  function diagnostic() {
    const showingReveal = phase === 'reveal';
    const active = showingReveal ? reveal : scene;
    const video = active?.video;
    const loaders = [...document.querySelectorAll('#root > .startup-loader, body > .startup-loader')];
    const openingStyle = showingReveal && getComputedStyle(reveal.panel);
    const activePane = Array.from(document.querySelectorAll('[data-app-shell-main-surface]')).find((element) => element.clientWidth > 0);
    return {
      phase, revealAt, revealPlayAt, firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime,
      desktopStarting: document.body?.hasAttribute('data-desktop-starting') ?? false,
      logoSuppressed: loaders.length > 0 && loaders.every((loader) => getComputedStyle(loader).visibility === 'hidden'),
      openingOpacity: openingStyle ? Number(openingStyle.opacity) : undefined,
      revealDone, openingResult, workbenchMountedAt,
      media: video?.readyState > 1 && !video.paused,
      width: video?.videoWidth, height: video?.videoHeight, time: video?.currentTime,
      duration: video?.duration, rate: video?.playbackRate, loop: video?.loop, decoded: video?.getVideoPlaybackQuality().totalVideoFrames,
      dropped: video?.getVideoPlaybackQuality().droppedVideoFrames, videoCount: [reveal, scene].filter((item) => item?.video.hasAttribute('src')).length,
      revision,
      fullWindow: Boolean(document.body && scene.panel.parentElement === document.body && scene.panel.clientWidth && scene.panel.clientHeight),
      windowFrame: scene.panel.isConnected ? [scene.panel.clientWidth, scene.panel.clientHeight] : null,
      playOnFocus: document.hasFocus() && !document.hidden,
      pane: Boolean(activePane), composer: Boolean(activePane?.querySelector('[data-composer-surface-variant]')),
      rail: Boolean(root?.querySelector('[data-app-navigation-rail]')),
      sidebar: Boolean(root?.querySelector('[data-sidebar-navigation-root]')),
      mounted: Boolean(root?.firstElementChild && !loaders.length),
      inert: Boolean(root?.inert),
      themeVideoLayer: scene.panel.hasAttribute('data-playing'),
    };
  }

  window[themeKey] = { diagnostic, dispose, revision };

  function discardVideo(video) {
    video.pause();
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }

  function pauseBackground() {
    const video = scene.video;
    video.pause();
    if (!video.hasAttribute('src')) return;
    resumeAt = video.currentTime;
    releaseTimer = setTimeout(() => {
      discardVideo(video);
      scene.panel.removeAttribute('data-playing');
    }, 1000);
  }

  function schedulePlaying() {
    clearTimeout(blurTimer);
    clearTimeout(releaseTimer);
    if (phase !== 'live' || !fileURLs.has('background.mp4')) return;

    if (document.hidden || reducedMotion.matches || !scene.panel.isConnected) {
      pauseBackground();
      return;
    }
    if (!document.hasFocus()) {
      blurTimer = setTimeout(pauseBackground, 250);
      return;
    }

    const video = scene.video;
    if (!video.hasAttribute('src')) video.src = fileURLs.get('background.mp4');
    if (video.paused) video.play().catch(() => {});
  }

  function releaseOpeningVideo() {
    discardVideo(reveal.video);
    if (fileURLs.has('intro.mp4')) URL.revokeObjectURL(fileURLs.get('intro.mp4'));
    fileURLs.delete('intro.mp4');
  }

  function releaseReveal() {
    if (!reveal) return;
    paint.disconnect();
    if (originalInert !== undefined && root) root.inert = originalInert;
    originalInert = undefined;
    releaseOpeningVideo();
    reveal.panel.remove();
  }

  function scheduleReveal() {
    if (phase !== 'reveal' || revealDone || !reveal.video.hasAttribute('src')) return;
    if (document.hidden) {
      reveal.video.pause();
      if (revealPlayAt !== undefined) clearTimeout(deadline);
      return;
    }
    if (!performance.getEntriesByName('first-paint').length || reveal.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || !reveal.video.paused) return;
    if (revealPlayAt === undefined) revealPlayAt = performance.now();
    watchOpeningProgress();
    reveal.video.play().catch((error) => {
      if (error.name !== 'AbortError') finishReveal('video-error');
    });
  }

  function watchOpeningProgress() {
    if (phase !== 'reveal' || revealDone || revealPlayAt === undefined || document.hidden) return;
    clearTimeout(deadline);
    deadline = setTimeout(() => finishReveal('playback-stalled'), 10000);
  }

  function closeReveal() {
    if (phase !== 'reveal') return;
    clearTimeout(deadline);
    phase = fileURLs.has('background.mp4') ? 'live' : 'pending';
    try { sessionStorage.setItem('codex-amber-reveal', launchId); } catch {}
    releaseReveal();
    document.documentElement.dataset.codexAmberPhase = phase;
    updateLayout();
    schedulePlaying();
  }

  function handOffWhenReady() {
    if (phase !== 'reveal' || !revealDone || document.body?.hasAttribute('data-desktop-starting')) return;
    if (root?.firstElementChild && !document.querySelector('#root > .startup-loader, body > .startup-loader')) closeReveal();
  }

  function finishReveal(reason) {
    if (phase !== 'reveal' || revealDone) return;
    clearTimeout(deadline);
    revealDone = reason;
    const video = reveal.video;
    const quality = video.getVideoPlaybackQuality();
    openingResult = {
      reason, duration: video.duration, endTime: video.currentTime, rate: video.playbackRate,
      finishedAt: performance.now(), frames: quality.totalVideoFrames, dropped: quality.droppedVideoFrames,
    };
    releaseOpeningVideo();
    reveal.panel.removeAttribute('data-playing');
    reveal.panel.setAttribute('data-holding', '');
    const still = fileURLs.get('background.webp');
    if (still) reveal.panel.style.setProperty('--amber-splash', `url("${still}")`);
    deadline = setTimeout(closeReveal, 25000);
    handOffWhenReady();
  }

  function retireOlderLayer() {
    if (olderLayerRetired) return;
    olderLayerRetired = true;
    const oldScene = document.getElementById('codex-amber-background');
    if (oldScene) {
      const video = oldScene.querySelector('video');
      if (video) discardVideo(video);
      oldScene.style.setProperty('display', 'none', 'important');
    }
    document.getElementById('codex-amber-style')?.remove();
    document.documentElement.classList.remove('codex-amber-active');
    for (const pane of document.querySelectorAll('.codex-amber-surface')) pane.classList.remove('codex-amber-surface');
  }

  function requestFiles() {
    if (input || fileURLs.size || !document.body) return;
    input = document.createElement('input');
    input.hidden = true;
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('data-codex-amber-media', '');
    input.addEventListener('input', (event) => event.stopPropagation(), { signal });
    input.addEventListener('change', (event) => {
      event.stopPropagation();
      const selected = new Map(Array.from(input.files, (file) => [file.name, file]));
      input.remove();
      input = null;
      if (!selected.get('background.mp4')?.size || !selected.get('background.webp')?.size) {
        dispose();
        return;
      }

      for (const name of ['background.mp4', 'background.webp']) fileURLs.set(name, URL.createObjectURL(selected.get(name)));
      scene.panel.style.setProperty('--amber-still', `url("${fileURLs.get('background.webp')}")`);
      retireOlderLayer();

      if (phase === 'reveal' && !revealDone && selected.get('intro.mp4')?.size && !reducedMotion.matches) {
        fileURLs.set('intro.mp4', URL.createObjectURL(selected.get('intro.mp4')));
        reveal.video.preload = 'auto';
        reveal.video.defaultPlaybackRate = 1;
        reveal.video.playbackRate = 1;
        reveal.video.src = fileURLs.get('intro.mp4');
        clearTimeout(deadline);
        deadline = setTimeout(() => finishReveal('no-first-frame'), 18000);
        scheduleReveal();
      } else if (phase === 'reveal') {
        finishReveal('no-motion');
      } else {
        phase = 'live';
        document.documentElement.dataset.codexAmberPhase = phase;
        updateLayout();
        schedulePlaying();
      }
    }, { signal, once: true });
    document.body.append(input);
    if (typeof window.codexAmberMediaReady === 'function') window.codexAmberMediaReady('media');
  }

  function updateLayout() {
    const html = document.documentElement;
    if (!html) return;
    const body = document.body;
    if (phase === 'live' && observedBody && observedBody === body && root?.isConnected &&
        scene.panel.parentElement === body && style.isConnected) return;

    if (!style.isConnected && (phase === 'reveal' || body)) {
      (document.head ?? html).append(style);
    }
    if (body && scene.panel.parentElement !== body) body.prepend(scene.panel);

    if (phase === 'reveal') {
      if (!reveal.panel.isConnected) {
        revealAt = performance.now();
        html.dataset.codexAmberPhase = phase;
        reveal.panel.style.setProperty('--amber-splash', `url("${splash}")`);
        (document.body ?? html).append(reveal.panel);
        deadline = setTimeout(() => finishReveal('media-unavailable'), 14000);
      }
      if (body && reveal.panel.parentElement !== body) body.append(reveal.panel);
    }

    if (!root?.isConnected) root = document.getElementById('root');
    if (workbenchMountedAt === undefined && root?.querySelector('[data-app-shell-frame]')) {
      workbenchMountedAt = performance.now();
    }
    if (root && phase === 'reveal' && originalInert === undefined) {
      originalInert = root.inert;
      root.inert = true;
    }
    handOffWhenReady();
    requestFiles();
    if (phase === 'live' && body && workbenchMountedAt !== undefined && observedBody !== body) {
      // The renderer keeps inactive pages mounted. Only observe the document
      // chrome once the shared backdrop is in place, independent of routing.
      dom.disconnect();
      dom.observe(html, { childList: true });
      dom.observe(body, { childList: true });
      if (document.head) dom.observe(document.head, { childList: true });
      observedBody = body;
    }
    schedulePlaying();
  }

  function dispose() {
    clearTimeout(deadline);
    clearTimeout(blurTimer);
    clearTimeout(releaseTimer);
    lifetime.abort();
    dom.disconnect();
    releaseReveal();
    discardVideo(scene.video);
    scene.panel.remove();
    for (const url of fileURLs.values()) URL.revokeObjectURL(url);
    fileURLs.clear();
    input?.remove();
    style.remove();
    if (document.documentElement) delete document.documentElement.dataset.codexAmberPhase;
    delete window[themeKey];
  }

  scene.video.addEventListener('playing', () => {
    scene.panel.setAttribute('data-playing', '');
  }, { signal });
  scene.video.addEventListener('loadedmetadata', () => {
    if (resumeAt > 0 && resumeAt < scene.video.duration) scene.video.currentTime = resumeAt;
  }, { signal });
  scene.video.addEventListener('error', () => scene.panel.removeAttribute('data-playing'), { signal });
  if (reveal) {
    paint.observe({ type: 'paint', buffered: true });
    window.addEventListener('focus', scheduleReveal, { signal });
    document.addEventListener('visibilitychange', scheduleReveal, { signal });
    reveal.video.addEventListener('canplay', scheduleReveal, { signal });
    reveal.video.addEventListener('playing', () => reveal.panel.setAttribute('data-playing', ''), { signal });
    reveal.video.addEventListener('timeupdate', watchOpeningProgress, { signal });
    reveal.video.addEventListener('ended', () => finishReveal('ended'), { signal, once: true });
    reveal.video.addEventListener('error', () => finishReveal('video-error'), { signal, once: true });
  }
  for (const type of ['focus', 'blur']) window.addEventListener(type, schedulePlaying, { signal });
  document.addEventListener('visibilitychange', schedulePlaying, { signal });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && phase === 'reveal') finishReveal('reduced-motion');
    schedulePlaying();
  }, { signal });
  window.addEventListener('pagehide', dispose, { signal, once: true });
  dom.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-desktop-starting'] });
  updateLayout();
}
