(() => {
  'use strict';
  const root = document.documentElement;
  if (root.dataset.recordingReady) return;
  const video = document.querySelector('#recording-video');
  const poster = document.querySelector('.scene-recording .scene-poster');
  const status = document.querySelector('#recording-status');
  let media;
  try { media = JSON.parse(document.querySelector('#recording-media').textContent); }
  catch { return; }
  if (!video || !poster) return;
  let active = false;
  let weatherScene = root.dataset.scene || 'cloudy';
  const sky = document.querySelector('.sky');
  root.dataset.recordingReady = 'true';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 600px)').matches;
  let wantsPlayback = false;
  let explicitlyPaused = false;
  let needsGesture = false;
  let gestureAttempted = false;
  let audioAutoplayDenied = false;
  let nativeAudioChoice = false;
  let managedMuted = video.muted;
  let lastVolume = video.volume;
  let request = 0;

  function setMuted(value) {
    managedMuted = value;
    video.muted = value;
  }

  function message(value) {
    if (status) status.textContent = value;
  }

  function pause() {
    request++;
    video.pause();
  }

  // Lake media remains completely unrequested until the inline action is used.
  // Pause the other player synchronously to avoid overlapping motion or audio.
  function select(view) {
    if (view !== 'lake' && view !== 'weather') return;
    if (view === 'weather') {
      active = false;
      wantsPlayback = false;
      pause();
      message('');
      root.dataset.background = 'weather';
      sky?.setAttribute('aria-label', 'San Francisco weather');
      if (root.dataset.scene === 'recording') root.dataset.scene = weatherScene;
    } else {
      if (active && !video.error) return;
      weatherScene = root.dataset.scene === 'recording' ? weatherScene : root.dataset.scene;
      active = true;
      root.dataset.background = 'recording';
      root.dataset.scene = 'recording';
      document.querySelectorAll('.scene-layer video').forEach(other => {
        if (other !== video) other.pause();
      });
      sky?.setAttribute('aria-label', 'A lake and mountains');
      if (!video.getAttribute('src')) poster.src = media.preview || media.poster;
      if (video.error) video.load();
      explicitlyPaused = false;
      wantsPlayback = true;
    }
    document.querySelectorAll('.scene-layer').forEach(layer => {
      layer.setAttribute('aria-hidden', String(layer.dataset.scene !== root.dataset.scene));
    });
    window.dispatchEvent(new Event('background-change'));
    if (!active) return;
    observeAudioChoice();
    if ((needsGesture || audioAutoplayDenied) && !nativeAudioChoice) setMuted(false);
    gestureAttempted = false;
    needsGesture = false;
    // Keep play() inside the homestead click, including on mobile Safari.
    play();
  }
  window.RecordingPlayer = { select };

  async function play() {
    if (!active || !wantsPlayback || document.hidden) return;
    const ownRequest = ++request;
    if (!video.getAttribute('src')) {
      video.poster = poster.getAttribute('src');
      video.preload = 'auto';
      video.src = mobile ? media.mobileSrc : media.src;
    }
    const stillWanted = () => ownRequest === request && active && wantsPlayback && !document.hidden;
    try {
      await video.play();
    } catch (error) {
      if (!stillWanted()) return;
      if (error.name === 'NotAllowedError') {
        needsGesture = !gestureAttempted;
        // Keep autoplay silent until the first real click or keyboard action.
        // The full recording and its replacement sound share one media clock.
        if (!video.muted) {
          audioAutoplayDenied = true;
          setMuted(true);
          try { await video.play(); }
          catch (fallbackError) {
            if (stillWanted() && fallbackError.name !== 'NotAllowedError') wantsPlayback = false;
          }
        }
      } else {
        wantsPlayback = false;
      }
    }
    if (ownRequest !== request) return;
    if (!stillWanted()) video.pause();
    if (!video.paused) {
      video.hidden = false;
      message('');
    } else {
      if (video.hidden) poster.src = media.poster;
      message('Video paused. Press Space to play.');
    }
  }

  const shortcut = event => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  function observeAudioChoice() {
    if (video.muted !== managedMuted || video.volume !== lastVolume) nativeAudioChoice = true;
    managedMuted = video.muted;
    lastVolume = video.volume;
  }
  function unlock(event) {
    if (!active || !event.isTrusted || shortcut(event) || gestureAttempted || !needsGesture
      || explicitlyPaused || !wantsPlayback || reduced.matches || document.hidden) return;
    gestureAttempted = true;
    needsGesture = false;
    observeAudioChoice();
    if (!nativeAudioChoice) setMuted(false);
    // Both actions run in the trusted event before any await, including iOS.
    play();
  }
  document.addEventListener('click', event => {
    if (event.button === undefined || event.button === 0) unlock(event);
  }, true);
  video.addEventListener('playing', () => {
    if (!active || !wantsPlayback || document.hidden) { pause(); return; }
    video.hidden = false;
    message('');
  });
  video.addEventListener('volumechange', observeAudioChoice);
  video.addEventListener('error', () => {
    if (!active) return;
    wantsPlayback = false;
    video.hidden = true;
    poster.src = media.poster;
    pause();
    message('Video unavailable. The still image remains visible.');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else play();
  });
  document.addEventListener('keydown', event => {
    if (!active || !event.isTrusted || shortcut(event) || event.repeat) return;
    const editable = event.target?.closest('input, textarea, select, [contenteditable="true"]');
    const control = event.target?.closest('button, a');
    if (editable) return;
    if (!control && (event.code === 'Space' || event.key === 'Escape')) {
      event.preventDefault();
      wantsPlayback = event.key !== 'Escape' && (video.paused || !wantsPlayback);
      explicitlyPaused = !wantsPlayback;
      if (wantsPlayback) {
        if (video.error) video.load();
        observeAudioChoice();
        if ((needsGesture || audioAutoplayDenied) && !nativeAudioChoice) setMuted(false);
        gestureAttempted = true;
        needsGesture = false;
        play();
      } else pause();
    } else if (event.code === 'Space' || event.key === 'Enter') unlock(event);
  });
  reduced.addEventListener('change', () => {
    if (!active) return;
    wantsPlayback = !reduced.matches && !explicitlyPaused;
    if (wantsPlayback) play();
    else pause();
  });

  setMuted(false);
})();
