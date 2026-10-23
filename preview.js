(() => {
  'use strict';
  const grid = document.querySelector('#preview-grid');
  const status = document.querySelector('#preview-status');
  const entries = [];
  let active = null;
  let request = 0;
  const copy = {
    cloudy: 'Preview: cloudy in San Francisco', sunny: 'Preview: sunny in San Francisco',
    overcast: 'Preview: overcast in San Francisco', rain: 'Preview: raining in San Francisco',
    fog: 'Preview: foggy in San Francisco', night: 'Preview: cloudy in San Francisco',
    'clear-night': 'Preview: clear in San Francisco', 'overcast-night': 'Preview: cloudy in San Francisco',
    'night-rain': 'Preview: raining in San Francisco', 'night-fog': 'Preview: foggy in San Francisco'
  };

  function report() {
    window.skyPreviewReport = {
      simulated: true, ready: entries.filter(entry => entry.ready).length,
      total: entries.length, playing: active?.scene.id ?? null,
      scenes: entries.map(entry => ({
        scene: entry.scene.id, ready: entry.ready, playbackRate: entry.scene.rate,
        currentSrc: entry.video?.currentSrc || null, paused: entry.video?.paused ?? true,
        poster: entry.poster?.getAttribute('src') ?? null, error: entry.error || null
      }))
    };
    const ready = entries.filter(entry => entry.ready).length;
    status.textContent = active ? `Playing ${active.scene.title}. Other scenes are paused.` : `${ready} of ${entries.length} previews ready. Videos load when you press Play.`;
  }

  function pause(entry, message) {
    if (!entry) return;
    entry.wantsPlay = false;
    entry.video?.pause();
    entry.button.textContent = 'Play';
    entry.button.setAttribute('aria-label', `Play ${entry.scene.title}`);
    entry.button.setAttribute('aria-pressed', 'false');
    if (!entry.error) entry.note.textContent = message || 'Paused';
    if (active === entry) active = null;
  }

  function pauseAll() {
    request++;
    entries.forEach(entry => pause(entry));
    report();
  }

  async function play(entry) {
    if (!entry.ready) return;
    if (entry.wantsPlay) { pauseAll(); return; }
    pauseAll();
    const ownRequest = request;
    active = entry; entry.wantsPlay = true; entry.error = null;
    entry.note.classList.remove('error');
    entry.note.textContent = 'Loading video…';
    entry.button.textContent = 'Pause';
    entry.button.setAttribute('aria-label', `Pause ${entry.scene.title}`);
    entry.button.setAttribute('aria-pressed', 'true');
    if (!entry.video.getAttribute('src')) {
      entry.video.src = entry.preferredSrc;
      entry.video.poster = entry.poster.src;
    }
    entry.video.hidden = false;
    entry.video.playbackRate = entry.scene.rate;
    try {
      await entry.video.play();
      if (ownRequest !== request || active !== entry || !entry.wantsPlay) {
        entry.video.pause(); return;
      }
      entry.note.textContent = 'Playing';
    } catch (error) {
      if (ownRequest !== request || !entry.wantsPlay) return;
      if (entry.video.error && !entry.triedFallback && entry.preferredSrc !== entry.scene.src) {
        fallback(entry); return;
      }
      entry.error = `Video unavailable: ${error.message}`;
      pause(entry); entry.note.textContent = entry.error; entry.note.classList.add('error');
    }
    report();
  }

  function fallback(entry) {
    if (entry.triedFallback) return;
    entry.triedFallback = true;
    entry.preferredSrc = entry.scene.src;
    entry.video.pause();
    entry.video.removeAttribute('src');
    entry.video.load();
    if (entry.wantsPlay && active === entry) {
      entry.wantsPlay = false;
      void play(entry);
    }
  }

  function parseScenes(source) {
    // Read the live scene table as data; never execute the weather controller.
    const pattern = /^\s*(?:'([^']+)'|([\w-]+)):\s*\{\s*title:\s*'([^']+)',\s*src:\s*'([^']+)',\s*webmSrc:\s*'([^']+)',\s*rate:\s*([\d.]+),\s*description:\s*'([^']*)'/gm;
    const scenes = [...source.matchAll(pattern)].map(match => ({
      id: match[1] || match[2], title: match[3], src: match[4], webmSrc: match[5],
      rate: Number(match[6]), description: match[7]
    }));
    if (scenes.length !== 10 || scenes.some(scene => !copy[scene.id])) throw new Error('The live scene table could not be read.');
    return scenes;
  }

  function previewDocument(html, scene, baseURL) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const base = doc.createElement('base'); base.href = baseURL;
    doc.head.prepend(base);
    doc.documentElement.dataset.scene = scene.id;
    doc.documentElement.dataset.instantSwitch = 'true';
    doc.title = `${scene.title} — simulated preview`;
    // Keep the actual dock controller. Previews stay silent and never run live weather.
    doc.querySelectorAll('script').forEach(script => {
      if (!script.getAttribute('src') || !new URL(script.getAttribute('src'), baseURL).pathname.endsWith('/dock.js')) script.remove();
    });
    doc.querySelectorAll('noscript').forEach(node => node.remove());
    doc.querySelectorAll('.scene-layer').forEach(layer => {
      if (layer.dataset.scene !== scene.id) layer.remove();
      else layer.setAttribute('aria-hidden', 'false');
    });
    const poster = doc.querySelector('.scene-poster');
    poster.src = poster.dataset.src;
    poster.setAttribute('loading', 'lazy');
    poster.setAttribute('fetchpriority', 'auto');
    const sky = doc.querySelector('.sky');
    sky.setAttribute('aria-label', `${scene.title}: simulated sky preview`);
    sky.setAttribute('aria-description', 'Simulated preview. Cloud toggles the preview caption; User opens information about Chris.');
    sky.removeAttribute('aria-keyshortcuts');
    doc.querySelector('#weather-summary').textContent = copy[scene.id];
    doc.querySelector('#weather-condition').textContent = 'Simulated weather preview';
    doc.querySelector('#weather-freshness').textContent = 'No live weather data requested';
    doc.querySelector('#scene-status').textContent = `${scene.title} preview selected.`;
    doc.querySelector('a[href="https://open-meteo.com/"]')?.parentElement.remove();
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }

  async function connect(entry) {
    const doc = entry.frame.contentDocument;
    if (!doc?.querySelector('.icon-dock')) return;
    entry.video = doc.querySelector('video.sky-scene');
    entry.poster = doc.querySelector('.scene-poster');
    entry.preferredSrc = entry.video.canPlayType('video/webm; codecs="vp09.02.41.10"') ? entry.scene.webmSrc : entry.scene.src;
    entry.video.muted = true; entry.video.loop = true; entry.video.playbackRate = entry.scene.rate;
    const labelPanel = () => {
      if (doc.querySelector('[data-view="cloud"]').getAttribute('aria-expanded') === 'true') doc.querySelector('#dock-panel').setAttribute('aria-label', 'Simulated weather preview');
    };
    doc.querySelector('[data-view="cloud"]').addEventListener('click', labelPanel);
    entry.video.addEventListener('error', () => {
      if (!entry.triedFallback && entry.preferredSrc !== entry.scene.src) { fallback(entry); return; }
      entry.error = 'Video unavailable. The still preview remains visible.';
      pause(entry); entry.video.hidden = true;
      entry.note.textContent = entry.error; entry.note.classList.add('error'); report();
    });
    doc.addEventListener('keydown', event => {
      if (event.defaultPrevented || /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); void play(entry); }
      if (event.key === 'Escape') pauseAll();
    });
    await doc.fonts.ready;
    await new Promise(resolve => entry.frame.contentWindow.requestAnimationFrame(() => entry.frame.contentWindow.requestAnimationFrame(resolve)));
    doc.querySelector('[data-view="cloud"]').click();
    labelPanel();
    entry.ready = true; entry.button.disabled = false;
    entry.note.textContent = 'Still preview';
    report();
  }

  function createCard(scene, html, baseURL, observer) {
    const card = document.createElement('section'); card.className = 'preview-card'; card.id = `preview-${scene.id}`;
    const header = document.createElement('header');
    const title = document.createElement('h2'); title.id = `title-${scene.id}`; title.textContent = scene.title;
    card.setAttribute('aria-labelledby', title.id);
    const button = document.createElement('button'); button.id = `play-${scene.id}`; button.type = 'button'; button.textContent = 'Play'; button.disabled = true;
    button.setAttribute('aria-label', `Play ${scene.title}`); button.setAttribute('aria-pressed', 'false');
    const note = document.createElement('p'); note.className = 'preview-note'; note.id = `status-${scene.id}`; note.textContent = 'Loading still preview…'; note.setAttribute('role', 'status');
    const frame = document.createElement('iframe'); frame.id = `frame-${scene.id}`; frame.title = `${scene.title} — interactive simulated preview`; frame.loading = 'lazy';
    button.setAttribute('aria-controls', frame.id);
    const entry = { scene, card, button, note, frame, ready: false, wantsPlay: false, triedFallback: false };
    entries.push(entry);
    button.addEventListener('click', () => { void play(entry); });
    frame.addEventListener('load', () => { connect(entry).catch(error => {
      entry.error = error.message; note.textContent = `Preview unavailable: ${error.message}`; note.classList.add('error'); report();
    }); });
    frame.srcdoc = previewDocument(html, scene, baseURL);
    header.append(title, button); card.append(header, note, frame); grid.append(card);
    observer?.observe(card);
  }

  document.querySelector('#pause-all').addEventListener('click', pauseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAll(); });
  window.addEventListener('pagehide', pauseAll);
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(records => {
    records.forEach(record => {
      const entry = entries.find(item => item.card === record.target);
      if (!record.isIntersecting && entry?.wantsPlay) { pause(entry, 'Paused outside the viewport'); request++; report(); }
    });
  }, { threshold: 0 }) : null;

  async function init() {
    const baseURL = new URL('./', location.href).href;
    const response = await fetch(new URL('index.html', baseURL), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Main page returned HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const script = [...doc.querySelectorAll('script[src]')].find(node => new URL(node.getAttribute('src'), baseURL).pathname.endsWith('/sky.js'));
    if (!script) throw new Error('Main page has no scene controller.');
    const controller = await fetch(new URL(script.getAttribute('src'), baseURL));
    if (!controller.ok) throw new Error(`Scene table returned HTTP ${controller.status}`);
    const scenes = parseScenes(await controller.text());
    scenes.forEach(scene => createCard(scene, html, baseURL, observer));
    report();
  }
  init().catch(error => { status.textContent = `Previews could not load: ${error.message}`; status.classList.add('error'); });
})();
