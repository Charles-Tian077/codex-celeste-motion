(() => {
  const html = document.documentElement;
  const root = document.getElementById('root');
  const introLayer = document.getElementById('codex-amber-intro');
  const scene = document.getElementById('codex-amber-background');
  const intro = introLayer.querySelector('video');
  const background = scene.querySelector('video');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const originalInert = root.inert;
  let phase = 'opening';
  let inViewport = true;
  let deadline;
  let releaseTimer;
  let resumeAt = 0;

  function isVisible() {
    return inViewport && !document.hidden;
  }

  function discard(video) {
    video.pause();
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }

  function playBackground() {
    if (phase !== 'live' || !isVisible() || reducedMotion.matches || !background.paused ||
        background.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    if (!scene.hasAttribute('data-playing')) {
      scene.setAttribute('data-playing', '');
      requestAnimationFrame(playBackground);
      return;
    }
    background.play().catch(() => {});
  }

  function updateBackground() {
    clearTimeout(releaseTimer);
    if (phase !== 'live') return;
    if (!isVisible() || reducedMotion.matches) {
      background.pause();
      if (!background.hasAttribute('src')) return;
      resumeAt = background.currentTime;
      releaseTimer = setTimeout(() => {
        discard(background);
        scene.removeAttribute('data-playing');
      }, 1000);
      return;
    }

    if (!background.hasAttribute('src')) {
      background.preload = 'auto';
      background.src = background.dataset.source;
    }
    requestAnimationFrame(playBackground);
  }

  function showWorkspace() {
    clearTimeout(deadline);
    startup.disconnect();
    phase = 'live';
    root.inert = originalInert;
    html.classList.remove('codex-amber-starting');
    html.classList.add('codex-amber-active');
    introLayer.remove();
    updateBackground();
  }

  function handOffWhenReady() {
    if (phase === 'holding' && root.firstElementChild && !root.querySelector(':scope > .startup-loader')) showWorkspace();
  }

  function finishIntro() {
    if (phase !== 'opening') return;
    clearTimeout(deadline);
    phase = 'holding';
    discard(intro);
    introLayer.removeAttribute('data-playing');
    introLayer.setAttribute('data-holding', '');
    deadline = setTimeout(showWorkspace, 22000);
    handOffWhenReady();
  }

  function watchIntro() {
    if (phase !== 'opening') return;
    clearTimeout(deadline);
    if (isVisible()) deadline = setTimeout(finishIntro, 12000);
  }

  function updateViewport() {
    if (phase === 'opening') {
      if (reducedMotion.matches) return finishIntro();
      if (!isVisible()) {
        clearTimeout(deadline);
        intro.pause();
        return;
      }
      if (!intro.hasAttribute('src')) intro.src = intro.dataset.source;
      watchIntro();
      if (intro.paused) intro.play().catch((error) => {
        if (error.name !== 'AbortError') finishIntro();
      });
    } else {
      updateBackground();
    }
  }

  const startup = new MutationObserver(handOffWhenReady);
  startup.observe(root, { childList: true });
  const viewport = new IntersectionObserver(([entry]) => {
    const visible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
    if (visible === inViewport) return;
    inViewport = visible;
    updateViewport();
  });
  viewport.observe(root);
  document.addEventListener('visibilitychange', updateViewport);
  reducedMotion.addEventListener('change', updateViewport);
  window.addEventListener('pagehide', () => {
    clearTimeout(deadline);
    clearTimeout(releaseTimer);
    viewport.disconnect();
    startup.disconnect();
    discard(intro);
    discard(background);
  }, { once: true });

  intro.defaultPlaybackRate = 1;
  intro.playbackRate = 1;
  intro.muted = true;
  background.muted = true;
  intro.addEventListener('playing', () => introLayer.setAttribute('data-playing', ''));
  intro.addEventListener('timeupdate', watchIntro);
  intro.addEventListener('ended', finishIntro, { once: true });
  intro.addEventListener('error', finishIntro, { once: true });
  background.addEventListener('canplay', () => requestAnimationFrame(playBackground));
  background.addEventListener('error', () => scene.removeAttribute('data-playing'));
  background.addEventListener('loadedmetadata', () => {
    if (resumeAt > 0 && resumeAt < background.duration) background.currentTime = resumeAt;
  });
  html.classList.add('codex-amber-starting');
  root.inert = true;
  updateViewport();
})();
