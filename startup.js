(() => {
  // The build embeds one recent scene; the live API is already running in parallel.
  const initial = window.SFWeather?.readInitial();
  if (!initial) return;
  let media;
  try { media = JSON.parse(document.querySelector('#initial-media').textContent); }
  catch { return; }
  if (media.scene !== initial.scene) return;
  const layer = document.querySelector(`.scene-layer[data-scene="${initial.scene}"]`);
  if (!layer) return;
  const poster = layer.querySelector('.scene-poster');
  const video = layer.querySelector('video');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.scene = initial.scene;
  document.documentElement.dataset.instantSwitch = 'true';
  document.querySelectorAll('.scene-layer').forEach(item => {
    item.setAttribute('aria-hidden', String(item !== layer));
  });
  if (!reduced && typeof media.poster === 'string' && media.poster.startsWith('data:image/webp;base64,')) {
    poster.dataset.preview = media.poster;
  }
  poster.src = reduced ? poster.dataset.src : poster.dataset.preview;
  if (reduced || document.hidden) return;
  const portrait = window.matchMedia('(max-width: 600px) and (max-aspect-ratio: 9/16)').matches;
  const mp4 = portrait ? media.src.replace(/\.mp4(?:\?.*)?$/, '.mobile-v94.mp4') : media.src;
  const webm = portrait ? mp4.replace('.mp4', '.webm') : media.webmSrc;
  video.dataset.startupReady = 'true';
  video.muted = true;
  video.defaultPlaybackRate = media.rate;
  video.playbackRate = media.rate;
  video.preload = 'auto';
  video.src = video.canPlayType('video/webm; codecs="vp09.02.41.10"') ? webm : mp4;
  video.hidden = false;
  video.play().catch(() => { /* A denied autoplay keeps the matching still visible. */ });
})();
