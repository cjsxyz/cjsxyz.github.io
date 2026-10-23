'use strict';

// Exercise the shipped modules, with deterministic network/media completion.
// Run: node tests/startup.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const site = path.resolve(__dirname, '..');
const weatherSource = fs.readFileSync(path.join(site, 'weather.js'), 'utf8');
const skySource = fs.readFileSync(path.join(site, 'sky.js'), 'utf8');
const markup = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const scenes = [...skySource.matchAll(/^    (?:([\w-]+)|['"]([\w-]+)['"]): \{ title:/gm)].map(m => m[1] || m[2]);
const assets = Object.fromEntries([...markup.matchAll(/data-scene="([^"]+)"[^>]*>[\s\S]*?<img\b([^>]+)>/g)].map(m => [m[1], {
  full: /data-src="([^"]+)"/.exec(m[2])[1],
  preview: /data-preview="([^"]+)"/.exec(m[2])[1],
}]));
const START = Date.parse('2026-10-23T00:45:00Z');
const flush = () => new Promise(resolve => setImmediate(resolve));
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(error));

class Element {
  constructor() { this.dataset = {}; this.attrs = {}; this.listeners = {}; this.textContent = ''; }
  addEventListener(name, fn, options = {}) { (this.listeners[name] ??= []).push({ fn, once: options.once }); }
  emit(name, event = {}) {
    for (const listener of [...(this.listeners[name] || [])]) {
      if (listener.once) this.listeners[name] = this.listeners[name].filter(item => item !== listener);
      listener.fn({ target: this, ...event });
    }
  }
  dispatchEvent(event) { this.emit(event.type, event); return true; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  removeAttribute(name) { delete this.attrs[name]; }
}
class Poster extends Element {
  constructor(urls, automatic) {
    super(); this.dataset = { src: urls.full, preview: urls.preview };
    this.automatic = automatic; this.sourceWrites = []; this.decoders = [];
    this.complete = false; this.naturalWidth = 0;
  }
  set src(value) {
    this.attrs.src = value; this.sourceWrites.push(value);
    this.complete = this.automatic; this.naturalWidth = this.automatic ? 1920 : 0;
  }
  get src() { return this.attrs.src || ''; }
  decode() {
    if (this.complete && this.naturalWidth) return Promise.resolve();
    return new Promise((resolve, reject) => this.decoders.push({ source: this.src, resolve, reject }));
  }
  finish(error = false, source = this.src) {
    if (this.src === source) { this.complete = true; this.naturalWidth = error ? 0 : 1920; }
    const done = this.decoders.filter(item => item.source === source);
    this.decoders = this.decoders.filter(item => item.source !== source);
    for (const item of done) error ? item.reject(new Error('Image decode failed')) : item.resolve();
  }
}
class Video extends Element {
  constructor(webm) {
    super(); Object.assign(this, { webm, paused: true, hidden: true, ended: false,
      readyState: 0, sourceWrites: [], currentTime: 0, duration: 120 });
  }
  canPlayType() { return this.webm ? 'probably' : ''; }
  set src(value) {
    this.attrs.src = value; this.sourceWrites.push(value); this.readyState = 0;
    this.paused = true; this.currentTime = 0;
  }
  get src() { return this.attrs.src || ''; }
  get currentSrc() { return this.src; }
  set poster(value) { this.attrs.poster = value; }
  get poster() { return this.attrs.poster || ''; }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { const changed = !this.paused; this.paused = true; if (changed) this.emit('pause'); }
  frame(event = 'loadeddata') { this.readyState = 2; this.emit(event); }
  fail() { this.readyState = 0; this.emit('error'); }
}

function setup({ cache = null, hidden = false, reduced = false, webm = true,
  automaticPosters = true, portrait = false, boot = 'weather-first', startup = true,
  storageThrows = false } = {}) {
  let now = START, nextTimer = 0;
  const root = new Element(), doc = new Element(), win = new Element();
  const motion = new Element(), viewport = new Element();
  root.dataset.scene = 'cloudy'; doc.documentElement = root; doc.hidden = hidden;
  motion.matches = reduced; viewport.matches = portrait;
  win.matchMedia = query => query.includes('prefers-reduced-motion') ? motion : viewport;
  const videos = Object.fromEntries(scenes.map(key => [key, new Video(webm)]));
  const posters = Object.fromEntries(scenes.map(key => [key, new Poster(assets[key], automaticPosters)]));
  const layers = Object.fromEntries(scenes.map(key => [key, Object.assign(new Element(), {
    querySelector: selector => selector === 'video' ? videos[key] : posters[key],
  })]));
  const elements = Object.fromEntries(['.sky', '#scene-status', '#weather-condition', '#weather-freshness', '#weather-summary'].map(key => [key, new Element()]));
  doc.querySelector = selector => elements[selector] || layers[/data-scene="([^"]+)"/.exec(selector)?.[1]] || null;
  const timers = new Map(), requests = [], writes = [];
  const location = { href: 'https://chrisshu.com/' };
  const history = { state: null, replaceState(state, title, url) { this.state = state; location.href = String(url); } };
  class ClockDate extends Date { static now() { return now; } }
  const context = vm.createContext({
    window: win, document: doc, Date: ClockDate, URL, URLSearchParams, Intl, AbortController, Event, location, history,
    localStorage: {
      getItem() { if (storageThrows) throw new Error('Storage disabled'); return cache && JSON.stringify(cache); },
      setItem(key, value) { if (storageThrows) throw new Error('Storage disabled'); writes.push({ key, value }); },
    },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options = {}) {
      return new Promise((resolve, reject) => {
        const request = { url, options, at: now, settled: false, aborted: false,
          resolve(value) { if (!this.settled) { this.settled = true; resolve(value); } },
          reject(error) { if (!this.settled) { this.settled = true; reject(error); } },
        };
        options.signal?.addEventListener('abort', () => {
          request.aborted = true; request.reject(new Error('Request aborted'));
        }, { once: true });
        requests.push(request);
      });
    },
  });
  const runWeather = () => {
    doc.currentScript = new Element(); if (startup) doc.currentScript.setAttribute('data-weather-startup', '');
    vm.runInContext(weatherSource, context, { filename: 'weather.js' }); doc.currentScript = null;
  };
  const runSky = () => vm.runInContext(skySource, context, { filename: 'sky.js' });
  if (boot === 'weather-first') { runWeather(); runSky(); }
  else if (boot === 'sky-first') runSky();
  else if (boot === 'weather-only') runWeather();
  const current = changes => ({ time: Math.floor(now / 1000), weather_code: 2, is_day: 1,
    temperature_2m: 60, cloud_cover: 62, direct_normal_irradiance_instant: 600, ...changes });
  return {
    root, doc, win, motion, viewport, videos, posters, layers, elements, requests, writes, runWeather, runSky, current,
    summary: elements['#weather-summary'], status: elements['#scene-status'], get now() { return now; },
    hydrated: () => scenes.filter(key => posters[key].src),
    loaded: () => scenes.filter(key => videos[key].src),
    playing: () => scenes.filter(key => !videos[key].paused),
    async resolve(index, changes = {}) { requests[index].resolve({ ok: true, json: async () => ({ current: current(changes) }) }); await flush(); },
    async response(index, payload, ok = true) { requests[index].resolve({ ok, status: ok ? 200 : 503, json: async () => payload }); await flush(); },
    async reject(index) { requests[index].reject(new Error('Network unavailable')); await flush(); },
    async posterReady(key, error = false, source) { posters[key].finish(error, source); await flush(); },
    async tick(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 1000; guard++) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) { now = end; await flush(); return; }
        const [id, timer] = next; now = timer.due; timers.delete(id); timer.fn(); await flush();
      }
      throw new Error('Timer loop');
    },
    async refresh(changes) { win.emit('online'); await flush(); await this.resolve(requests.length - 1, changes); },
    visible(value) { doc.hidden = !value; doc.emit('visibilitychange'); },
    reduce(value) { motion.matches = value; motion.emit('change', { matches: value }); },
  };
}

const checks = [], failures = [];
async function test(name, body) {
  try { await body(); await flush(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}
const cached = changes => ({ current: { time: START / 1000, weather_code: 2, is_day: 1,
  temperature_2m: 60, cloud_cover: 62, direct_normal_irradiance_instant: 600, ...changes }, fetchedAt: START });

(async () => {
  await test('HTML starts async weather early and keeps all scene media deferred', async () => {
    assert.match(markup, /<script\b[^>]*src="\.\/weather\.js[^>]*\basync\b[^>]*data-weather-startup/);
    assert.ok(markup.indexOf('data-weather-startup') < markup.indexOf('rel="stylesheet"'));
    assert.match(markup, /<link\b[^>]*rel="preconnect"[^>]*api\.open-meteo\.com/);
    const runtime = markup.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/g, '');
    assert.equal(Object.keys(assets).length, 10);
    for (const match of runtime.matchAll(/<(?:img|video)\b[^>]*(?:scene-poster|sky-scene)[^>]*>/g)) {
      assert.doesNotMatch(match[0], /(?<![\w-])(?:src|poster)\s*=/);
    }
    for (const urls of Object.values(assets)) {
      assert.notEqual(urls.preview, urls.full);
      assert.match(urls.preview, /preview-v\d+\.webp$/);
    }
  });
  await test('weather-first boot starts one request and reuses it without any speculative scene assets', async () => {
    const x = setup(); assert.equal(x.requests.length, 1);
    assert.deepEqual(x.hydrated(), []); assert.deepEqual(x.loaded(), []);
    assert.equal(x.requests[0].options.credentials, 'omit'); assert.equal(x.requests[0].options.cache, 'no-store');
    await x.resolve(0, { weather_code: 45 });
    assert.equal(x.requests.length, 1); assert.equal(x.root.dataset.scene, 'fog');
    assert.equal(x.posters.fog.src, assets.fog.preview); assert.deepEqual(x.hydrated(), ['fog']);
    assert.deepEqual(x.loaded(), ['fog']); assert.equal(x.videos.fog.poster, '');
  });
  await test('controller-first boot waits safely for async weather module and consumes one early request', async () => {
    const x = setup({ boot: 'sky-first' }); await flush();
    assert.equal(x.requests.length, 0); assert.deepEqual(x.hydrated(), []);
    x.runWeather(); await flush(); assert.equal(x.requests.length, 1);
    await x.resolve(0, { is_day: 0, weather_code: 0, cloud_cover: 0 });
    assert.equal(x.root.dataset.scene, 'clear-night'); assert.deepEqual(x.loaded(), ['clear-night']);
  });
  await test('completed early request is consumed without a second fetch or shifted success timestamp', async () => {
    const x = setup({ boot: 'weather-only' }); await x.resolve(0, { weather_code: 61 });
    await x.tick(2000); x.runSky(); await flush();
    assert.equal(x.requests.length, 1); assert.equal(x.root.dataset.scene, 'rain');
    assert.equal(JSON.parse(x.writes[0].value).fetchedAt, START);
    await x.tick(297999); assert.equal(x.requests.length, 1);
    await x.tick(1); assert.equal(x.requests.length, 2);
  });
  await test('delayed foreground initialization refreshes an early outcome older than one minute', async () => {
    const x = setup({ boot: 'weather-only' });
    await x.resolve(0, { is_day: 0, weather_code: 0, cloud_cover: 0 });
    // Parsing/controller initialization finishes after the user backgrounds the tab.
    x.visible(false); x.runSky(); await flush();
    assert.equal(x.requests.length, 1); assert.deepEqual(x.hydrated(), []);
    await x.tick(60001); x.visible(true); await flush();
    assert.equal(x.requests.length, 2, 'start a fresh request immediately on return');
    assert.equal(x.requests[1].at, START + 60001);
    assert.deepEqual(x.hydrated(), [], 'do not show the superseded early night result');
    assert.equal(x.summary.textContent, 'Checking weather in San Francisco…');
    await x.resolve(1, { weather_code: 61 });
    assert.equal(x.root.dataset.scene, 'rain'); assert.deepEqual(x.hydrated(), ['rain']);
    assert.equal(JSON.parse(x.writes.at(-1).value).fetchedAt, START + 60001);
    await x.tick(299999); assert.equal(x.requests.length, 2);
    await x.tick(1); assert.equal(x.requests.length, 3);
  });
  await test('early network rejection is handled before controller starts and retains retry timing', async () => {
    const before = unhandled.length, x = setup({ boot: 'weather-only' }); await x.reject(0); await x.tick(2000);
    assert.equal(unhandled.length, before); x.runSky(); await flush();
    assert.equal(x.requests.length, 1); assert.equal(x.summary.textContent, 'Weather unavailable in San Francisco');
    assert.deepEqual(x.hydrated(), ['cloudy']);
    await x.tick(57999); assert.equal(x.requests.length, 1); await x.tick(1); assert.equal(x.requests.length, 2);
  });
  await test('early timeout aborts at ten seconds without unhandled rejection or another initial fetch', async () => {
    const before = unhandled.length, x = setup({ boot: 'weather-only', reduced: true });
    await x.tick(9999); assert.equal(x.requests[0].aborted, false);
    await x.tick(1); assert.equal(x.requests[0].aborted, true); assert.equal(unhandled.length, before);
    x.runSky(); await flush(); assert.equal(x.requests.length, 1);
    assert.deepEqual(x.loaded(), []); assert.equal(x.posters.cloudy.src, assets.cloudy.full);
    assert.equal(x.summary.textContent, 'Weather unavailable in San Francisco');
  });
  await test('plain weather module use without startup attribute does not fetch until controller asks', async () => {
    const x = setup({ startup: false, boot: 'weather-only' }); assert.equal(x.requests.length, 0);
    x.runSky(); await flush(); assert.equal(x.requests.length, 1); await x.resolve(0);
    assert.equal(x.root.dataset.scene, 'cloudy');
  });
  await test('background cold startup does not fetch or hydrate until visible', async () => {
    const x = setup({ hidden: true }); await flush();
    assert.equal(x.requests.length, 0); assert.deepEqual(x.hydrated(), []); assert.deepEqual(x.loaded(), []);
    x.visible(true); await flush(); assert.equal(x.requests.length, 1); await x.resolve(0, { weather_code: 61 });
    assert.deepEqual(x.loaded(), ['rain']);
  });
  await test('background cached night preserves the scene without video downloads or full-quality upgrade', async () => {
    const x = setup({ hidden: true, cache: cached({ is_day: 0 }) }); await flush();
    assert.equal(x.requests.length, 0); assert.deepEqual(x.loaded(), []);
    assert.equal(x.root.dataset.scene, 'overcast-night');
    assert.deepEqual(x.posters['overcast-night'].sourceWrites, [assets['overcast-night'].preview]);
    x.visible(true); await flush(); assert.equal(x.requests.length, 1);
    assert.deepEqual(x.loaded(), ['overcast-night']);
  });
  await test('poster-first reveals actual weather while video remains unready and hidden', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { weather_code: 61 });
    assert.equal(x.root.dataset.scene, 'cloudy'); assert.equal(x.videos.rain.hidden, true);
    await x.posterReady('rain'); assert.equal(x.root.dataset.scene, 'rain');
    assert.equal(x.videos.rain.hidden, true); x.videos.rain.frame(); assert.equal(x.videos.rain.hidden, false);
  });
  await test('video-first reveals actual weather without waiting for poster decode', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { is_day: 0, weather_code: 61 });
    assert.equal(x.root.dataset.scene, 'cloudy'); x.videos['night-rain'].frame();
    assert.equal(x.root.dataset.scene, 'night-rain'); assert.equal(x.posters['night-rain'].naturalWidth, 0);
    assert.equal(x.layers['night-rain'].getAttribute('aria-hidden'), 'false');
    await x.posterReady('night-rain'); assert.equal(x.root.dataset.scene, 'night-rain');
  });
  await test('playing event also reveals a frame when loadeddata was suppressed', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { weather_code: 45 });
    x.videos.fog.frame('playing'); assert.equal(x.root.dataset.scene, 'fog');
  });
  await test('stale poster and video events cannot reveal a superseded scene', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { weather_code: 61 });
    await x.refresh({ weather_code: 45 }); await x.posterReady('rain'); x.videos.rain.frame();
    assert.equal(x.root.dataset.scene, 'cloudy'); assert.equal(x.videos.rain.paused, true);
    x.videos.fog.frame(); assert.equal(x.root.dataset.scene, 'fog'); assert.deepEqual(x.playing(), ['fog']);
    assert.deepEqual(x.hydrated().sort(), ['fog', 'rain']);
  });
  await test('rapid A-to-B-to-A changes reuse ready content and ignore B finishing last', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { weather_code: 61 });
    x.videos.rain.frame(); await x.refresh({ weather_code: 45 }); await x.refresh({ weather_code: 61 });
    assert.equal(x.root.dataset.scene, 'rain'); await x.posterReady('fog'); x.videos.fog.frame();
    assert.equal(x.root.dataset.scene, 'rain'); assert.equal(x.videos.rain.sourceWrites.length, 1);
  });
  await test('preview decode failure falls back to the original still without revealing an empty next scene', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { weather_code: 45 });
    await x.posterReady('fog', true); assert.equal(x.posters.fog.src, assets.fog.full);
    assert.equal(x.root.dataset.scene, 'cloudy'); await x.posterReady('fog'); assert.equal(x.root.dataset.scene, 'fog');
    assert.deepEqual(x.posters.fog.sourceWrites, [assets.fog.preview, assets.fog.full]);
  });
  await test('late preview decode after original replacement cannot mark a missing original ready', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { weather_code: 45 });
    x.reduce(true); assert.equal(x.posters.fog.src, assets.fog.full);
    await x.posterReady('fog', false, assets.fog.preview); assert.equal(x.root.dataset.scene, 'cloudy');
    await x.posterReady('fog'); assert.equal(x.root.dataset.scene, 'fog');
  });
  await test('reduced motion loads only original still and never attaches video until explicitly enabled', async () => {
    const x = setup({ reduced: true }); await x.resolve(0, { weather_code: 61 });
    assert.deepEqual(x.loaded(), []); assert.deepEqual(x.playing(), []);
    assert.deepEqual(x.posters.rain.sourceWrites, [assets.rain.full]); assert.equal(x.root.dataset.scene, 'rain');
    x.reduce(false); assert.deepEqual(x.loaded(), ['rain']); assert.deepEqual(x.playing(), ['rain']);
  });
  await test('failed reduced-motion still settles on matching CSS background without video download', async () => {
    const x = setup({ reduced: true, automaticPosters: false }); await x.resolve(0, { is_day: 0, weather_code: 45 });
    await x.posterReady('night-fog', true); assert.equal(x.root.dataset.scene, 'night-fog');
    assert.deepEqual(x.loaded(), []); assert.deepEqual(x.playing(), []);
  });
  await test('all desktop video failures leave original still, with no unrelated media and no retry loop', async () => {
    const x = setup(); await x.resolve(0, { weather_code: 61 }); const video = x.videos.rain;
    video.fail(); assert.match(video.src, /rain\.mp4\?/); assert.equal(video.hidden, true);
    video.fail(); await flush(); video.fail();
    assert.equal(video.sourceWrites.length, 2); assert.equal(video.hidden, true); assert.equal(video.paused, true);
    assert.equal(x.posters.rain.src, assets.rain.full); assert.deepEqual(x.loaded(), ['rain']);
    assert.deepEqual(x.hydrated(), ['rain']); assert.match(x.status.textContent, /still image/);
  });
  await test('both posters and all videos failing reveal matching CSS background instead of hanging', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { is_day: 0, weather_code: 61 });
    await x.posterReady('night-rain', true); await x.posterReady('night-rain', true);
    x.videos['night-rain'].fail(); x.videos['night-rain'].fail(); await flush();
    assert.equal(x.root.dataset.scene, 'night-rain'); assert.deepEqual(x.playing(), []);
  });
  await test('inactive source errors defer fallback download until that scene is selected again', async () => {
    const x = setup(); await x.resolve(0, { weather_code: 61 }); await x.refresh({ weather_code: 45 });
    x.videos.rain.fail(); x.videos.rain.fail(); x.videos.sunny.fail();
    assert.equal(x.videos.rain.sourceWrites.length, 1); assert.equal(x.videos.sunny.sourceWrites.length, 0);
    await x.refresh({ weather_code: 61 }); assert.equal(x.videos.rain.sourceWrites.length, 2);
    assert.match(x.videos.rain.src, /rain\.mp4\?/); assert.deepEqual(x.playing(), ['rain']);
  });
  await test('backgrounding while a video is pending does not upgrade preview or keep playback active', async () => {
    const x = setup({ automaticPosters: false }); await x.resolve(0, { weather_code: 61 });
    x.visible(false); await flush(); assert.deepEqual(x.playing(), []);
    assert.deepEqual(x.posters.rain.sourceWrites, [assets.rain.preview]);
    x.visible(true); assert.deepEqual(x.playing(), ['rain']); assert.equal(x.requests.length, 1);
  });
  await test('fresh cache paints nighttime first while one live request updates the actual weather', async () => {
    const x = setup({ cache: cached({ is_day: 0 }) }); await flush();
    assert.equal(x.root.dataset.scene, 'overcast-night'); assert.equal(x.requests.length, 1);
    await x.resolve(0, { weather_code: 61 }); assert.equal(x.root.dataset.scene, 'rain');
    assert.equal(x.videos['overcast-night'].paused, true); assert.equal(x.posters.cloudy.src, '');
    assert.equal(x.summary.textContent, 'Currently 60°F and raining in San Francisco');
  });
  await test('expired or malformed cache does not hydrate old scene and storage failures do not stop live weather', async () => {
    for (const options of [
      { cache: cached({ time: START / 1000 - 7201, is_day: 0 }) },
      { cache: { current: 'bad', fetchedAt: START } }, { storageThrows: true },
    ]) {
      const x = setup(options); assert.deepEqual(x.hydrated(), []); await x.resolve(0, { weather_code: 45 });
      assert.equal(x.root.dataset.scene, 'fog'); assert.deepEqual(x.hydrated(), ['fog']);
    }
  });
  await test('five-minute refresh starts from successful completion and never overlaps pending requests', async () => {
    const x = setup(); await x.tick(7500); await x.resolve(0);
    await x.tick(299999); assert.equal(x.requests.length, 1); await x.tick(1); assert.equal(x.requests.length, 2);
    assert.equal(x.requests[1].at, START + 307500); x.win.emit('online'); assert.equal(x.requests.length, 2);
    await x.resolve(1, { direct_normal_irradiance_instant: 0 }); assert.equal(x.root.dataset.scene, 'overcast');
  });
  await test('refresh failure keeps prior scene and cached text then retries in one minute', async () => {
    const x = setup(); await x.resolve(0, { weather_code: 45 }); await x.tick(300000); await x.reject(1);
    assert.equal(x.root.dataset.scene, 'fog'); assert.match(x.elements['#weather-freshness'].textContent, /^Last known /);
    await x.tick(59999); assert.equal(x.requests.length, 2); await x.tick(1); assert.equal(x.requests.length, 3);
    await x.resolve(2, { weather_code: 51 }); assert.equal(x.root.dataset.scene, 'rain');
  });
  await test('actual parser rejects API errors, malformed values and stale times without uncaught failures', async () => {
    for (const kind of ['http', 'provider', 'temperature', 'stale']) {
      const x = setup();
      if (kind === 'http') await x.response(0, {}, false);
      else if (kind === 'provider') await x.response(0, { error: true });
      else await x.resolve(0, kind === 'stale' ? { time: START / 1000 - 7201 } : { temperature_2m: '60' });
      assert.equal(x.summary.textContent, 'Weather unavailable in San Francisco'); assert.deepEqual(x.hydrated(), ['cloudy']);
    }
  });
  await test('all ten scenes use only their confirmed poster and correct viewport/codec tier', async () => {
    const cases = { cloudy: {}, sunny: { weather_code: 0, cloud_cover: 0 }, overcast: { direct_normal_irradiance_instant: 0 },
      rain: { weather_code: 61 }, fog: { weather_code: 45 }, night: { is_day: 0, cloud_cover: 20 },
      'clear-night': { is_day: 0, weather_code: 0, cloud_cover: 0 }, 'overcast-night': { is_day: 0 },
      'night-rain': { is_day: 0, weather_code: 51 }, 'night-fog': { is_day: 0, weather_code: 48 } };
    for (const portrait of [false, true]) for (const webm of [false, true]) for (const [key, changes] of Object.entries(cases)) {
      const x = setup({ portrait, webm }); await x.resolve(0, changes);
      assert.equal(x.root.dataset.scene, key); assert.deepEqual(x.hydrated(), [key]); assert.deepEqual(x.loaded(), [key]);
      assert.equal(x.posters[key].src, assets[key].preview);
      const base = key === 'cloudy' ? 'clouds' : key, ext = webm ? 'webm' : 'mp4';
      if (portrait) assert.equal(x.videos[key].src, `./assets/${base}.mobile-v94.${ext}`);
      else assert.match(x.videos[key].src, new RegExp(`^\\./assets/${base}\\.${ext}\\?v=`));
    }
  });
  await test('portrait fallback tries mobile MP4 then desktop MP4 and finally original still', async () => {
    const x = setup({ portrait: true }); await x.resolve(0, { weather_code: 61 }); const video = x.videos.rain;
    assert.equal(video.src, './assets/rain.mobile-v94.webm'); video.fail();
    assert.equal(video.src, './assets/rain.mobile-v94.mp4'); video.fail();
    assert.match(video.src, /rain\.mp4\?/); video.fail(); await flush();
    assert.equal(video.sourceWrites.length, 3); assert.equal(x.posters.rain.src, assets.rain.full);
    assert.equal(video.hidden, true); assert.deepEqual(x.playing(), []);
  });
  await test('no asynchronous code path emits an unhandled rejection', async () => {
    await flush(); assert.deepEqual(unhandled.map(error => String(error)), []);
  });
  console.log(JSON.stringify({ passed: checks.length, failed: failures.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})();
