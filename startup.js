(() => {
  // The parser already has the matching still; adopt it without another request.
  // A stale timestamp must not discard that visual while live weather loads.
  let media;
  try { media = JSON.parse(document.querySelector('#initial-media').textContent); }
  catch { return; }
  const layer = document.querySelector(`.scene-layer[data-scene="${media.scene}"]`);
  if (!layer) return;
  const poster = layer.querySelector('.scene-poster');
  const embedded = poster.hasAttribute('data-initial-poster') ? poster.getAttribute('src') : null;
  if (embedded?.startsWith('data:image/webp;base64,')) poster.dataset.preview = embedded;
  const initial = window.SFWeather?.readInitial();
  if (!initial || media.scene !== initial.scene) return;
  const video = layer.querySelector('video');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.scene = initial.scene;
  document.documentElement.dataset.instantSwitch = 'true';
  document.querySelectorAll('.scene-layer').forEach(item => {
    item.setAttribute('aria-hidden', String(item !== layer));
  });
  const source = reduced ? poster.dataset.src : poster.dataset.preview;
  if (poster.getAttribute('src') !== source) poster.src = source;
  if (reduced || document.hidden) return;
  const portrait = window.matchMedia('(max-width: 600px) and (max-aspect-ratio: 9/16)').matches;
  const mp4 = portrait ? media.src.replace(/\.mp4(?:\?.*)?$/, '.mobile-v94.mp4') : media.src;
  const webm = portrait ? mp4.replace('.mp4', '.webm') : media.webmSrc;
  video.dataset.startupReady = 'true';
  // Safari can paint the video surface before a decoded frame is available.
  // Give that surface the same image so the handoff never exposes a blank.
  video.poster = poster.getAttribute('src');
  video.muted = true;
  video.defaultPlaybackRate = media.rate;
  video.playbackRate = media.rate;
  video.preload = 'auto';
  video.src = video.canPlayType('video/webm; codecs="vp09.02.41.10"') ? webm : mp4;
  video.hidden = false;
  video.play().catch(() => { /* A denied autoplay keeps the matching still visible. */ });
})();
