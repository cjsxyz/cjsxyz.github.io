'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../recording.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const denied = () => Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function element() {
  return {
    dataset: {}, attrs: {}, listeners: {}, hidden: true, textContent: '',
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key] ?? null; },
    addEventListener(key, fn) { (this.listeners[key] ??= []).push(fn); },
    emit(key, event = {}) { for (const fn of this.listeners[key] || []) fn(event); },
  };
}
function setup({ reduced = false, mobile = false, hidden = false, plays = [], start = true } = {}) {
  const root = element(); root.dataset.background = 'weather'; root.dataset.scene = 'sunny';
  const video = element();
  Object.assign(video, { paused: true, calls: [], pauses: 0, volume: 1 });
  let muted = false;
  Object.defineProperty(video, 'muted', {
    set(value) { if (muted !== value) { muted = value; queueMicrotask(() => video.emit('volumechange')); } },
    get() { return muted; },
  });
  Object.defineProperty(video, 'src', { set(value) { this.attrs.src = value; }, get() { return this.attrs.src; } });
  video.play = function() {
    this.calls.push({ muted: this.muted, src: this.src });
    const result = plays.shift();
    if (result instanceof Error) return Promise.reject(result);
    // A browser marks play() as unpaused before its promise resolves.
    this.paused = false;
    if (result) return result;
    this.emit('playing');
    return Promise.resolve();
  };
  video.pause = function() { this.paused = true; this.pauses++; this.emit('pause'); };
  video.load = function() { this.error = null; };
  const poster = element();
  Object.defineProperty(poster, 'src', { set(value) { this.attrs.src = value; }, get() { return this.attrs.src; } });
  const status = element(), config = element();
  config.textContent = JSON.stringify({ src: './assets/desktop.mp4', mobileSrc: './assets/mobile.mp4', poster: './assets/full.webp', preview: './assets/preview.webp' });
  const motion = element(); motion.matches = reduced;
  const document = element(); document.documentElement = root; document.hidden = hidden;
  document.querySelector = selector => ({
    '#recording-video': video, '.scene-recording .scene-poster': poster,
    '#recording-status': status, '#recording-media': config,
  })[selector];
  const other = element(); other.paused = false; other.pause = () => { other.paused = true; };
  const layer = element(); layer.dataset.scene = 'recording';
  document.querySelectorAll = selector => selector === '.scene-layer video' ? [other, video] : [layer];
  const events = [];
  const window = { matchMedia: query => query.includes('reduced-motion') ? motion : { matches: mobile }, dispatchEvent: event => events.push(event.type) };
  const context = vm.createContext({ document, window, Event });
  vm.runInContext(source, context);
  if (start) window.RecordingPlayer.select('lake');
  const key = (code, options = {}) => document.emit('keydown', {
    isTrusted: true, code, key: code === 'Escape' ? 'Escape' : code === 'Enter' ? 'Enter' : ' ',
    preventDefault() {}, ...options,
  });
  const click = (options = {}) => document.emit('click', { isTrusted: true, button: 0, ...options });
  return { video, poster, status, motion, root, document, context, key, click, player: window.RecordingPlayer, other, layer, events };
}
const control = { closest: query => query === 'button, a' ? {} : null };
const editable = { closest: query => query.includes('input') ? {} : null };

test('the homestead action starts the lake with its baked-in 10% sound', async () => {
  const s = setup(); await flush();
  assert.equal(s.video.src, './assets/desktop.mp4');
  assert.equal(s.video.poster, s.poster.attrs.src);
  assert.equal(s.video.paused, false);
  assert.equal(s.video.hidden, false);
  assert.equal(s.video.muted, false);
  assert.equal(s.video.volume, 1, '10% level is baked into the asset, not applied twice');
  assert.equal(s.other.paused, true);
  assert.equal(s.root.dataset.scene, 'recording');
  assert.equal(s.layer.attrs['aria-hidden'], 'false');
  assert.equal(s.status.hidden, true);
});
test('autoplay denial falls back silently, then one trusted click synchronously enables sound', async () => {
  const s = setup({ plays: [denied()] }); await flush();
  assert.deepEqual(s.video.calls.map(call => call.muted), [false, true]);
  s.click({ isTrusted: false });
  assert.equal(s.video.calls.length, 2);
  s.click();
  assert.equal(s.video.calls.at(-1).muted, false, 'unmute/play occurs inside the event before an await');
  await flush();
  s.click();
  assert.equal(s.video.calls.length, 3, 'subsequent clicks do not touch playback');
});
test('successful audible autoplay never installs a later automatic unmute behavior', async () => {
  const s = setup(); await flush();
  s.video.muted = true; await flush();
  s.click(); s.key('Enter', { target: control }); await flush();
  assert.equal(s.video.muted, true);
  assert.equal(s.video.calls.length, 1);
});
test('mobile loads only the smaller recording', async () => {
  const s = setup({ mobile: true }); await flush();
  assert.deepEqual(s.video.calls.map(call => call.src), ['./assets/mobile.mp4']);
});
test('weather startup and ordinary gestures never load lake media, including reduced motion', async () => {
  for (const reduced of [false, true]) {
    const s = setup({ reduced, start: false }); await flush();
    s.click(); s.key('Space'); s.key('Enter', { target: control });
    s.motion.matches = !reduced; s.motion.emit('change');
    assert.equal(s.video.src, undefined);
    assert.equal(s.poster.src, undefined);
    assert.equal(s.video.calls.length, 0);
    assert.equal(s.root.dataset.scene, 'sunny');
    s.player.select('lake');
    assert.equal(s.video.calls.length, 1, 'explicit selection can start despite reduced motion');
    assert.equal(s.video.calls[0].muted, false);
  }
});
test('background tabs do not start; visibility resumes without changing a native mute choice', async () => {
  const s = setup({ hidden: true }); await flush();
  assert.equal(s.video.calls.length, 0);
  s.document.hidden = false; s.document.emit('visibilitychange'); await flush();
  s.video.muted = true; await flush();
  s.document.hidden = true; s.document.emit('visibilitychange');
  assert.equal(s.video.paused, true);
  s.document.hidden = false; s.document.emit('visibilitychange'); await flush();
  assert.equal(s.video.paused, false);
  assert.equal(s.video.muted, true);
});
test('native volume changes suppress automatic unmute after autoplay denial', async () => {
  const s = setup({ plays: [denied()] }); await flush();
  s.video.volume = 0; s.video.emit('volumechange');
  s.click(); await flush();
  assert.equal(s.video.muted, true);
  assert.equal(s.video.volume, 0);
});
test('Escape pause survives page gestures and visibility changes; Space resumes', async () => {
  const s = setup({ plays: [denied()] }); await flush(); s.key('Escape');
  s.click(); s.key('Enter', { target: control });
  s.document.hidden = true; s.document.emit('visibilitychange');
  s.document.hidden = false; s.document.emit('visibilitychange'); await flush();
  assert.equal(s.video.paused, true);
  assert.equal(s.video.calls.length, 2);
  s.key('Space'); await flush();
  assert.equal(s.video.paused, false);
  assert.equal(s.video.muted, false);
});
test('dock Space enables initially blocked sound without pausing; text editing and shortcuts do not', async () => {
  const s = setup({ plays: [denied()] }); await flush();
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { repeat: true }, { isTrusted: false }, { target: editable }]) s.key('Enter', options);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { button: 2 }]) s.click(options);
  assert.equal(s.video.calls.length, 2);
  s.key('Space', { target: control });
  assert.equal(s.video.calls.length, 3);
  assert.equal(s.video.calls.at(-1).muted, false);
  assert.equal(s.video.paused, false);
});
test('Escape and unrelated keys cannot unlock sound', async () => {
  const s = setup({ plays: [denied()] }); await flush();
  s.key('KeyA', { key: 'a' }); s.key('Tab', { key: 'Tab' });
  assert.equal(s.video.calls.length, 2);
  s.key('Escape');
  assert.equal(s.video.calls.length, 2);
  assert.equal(s.video.muted, true);
  assert.equal(s.video.paused, true);
});
test('a late autoplay rejection cannot restart after explicit pause', async () => {
  const pending = deferred();
  const s = setup({ plays: [pending.promise] });
  s.key('Escape'); pending.reject(denied()); await flush();
  s.click();
  assert.equal(s.video.calls.length, 1);
  assert.equal(s.video.paused, true);
});
test('late successful playback events are paused after backgrounding or Escape', async () => {
  for (const reason of ['hidden', 'explicit']) {
    const pending = deferred();
    const s = setup({ plays: [pending.promise] });
    if (reason === 'hidden') { s.document.hidden = true; s.document.emit('visibilitychange'); }
    else s.key('Escape');
    s.video.paused = false; s.video.emit('playing'); pending.resolve(); await flush();
    assert.equal(s.video.paused, true);
    assert.equal(s.video.calls.length, 1);
  }
});
test('late fallback rejection cannot override a newer trusted playback request', async () => {
  const pending = deferred();
  const s = setup({ plays: [denied(), pending.promise] }); await flush();
  s.click();
  pending.reject(denied()); await flush();
  assert.equal(s.video.calls.length, 3);
  assert.equal(s.video.muted, false);
  assert.equal(s.video.paused, false);
});
test('turning reduced motion off does not override an explicit pause', async () => {
  const s = setup(); await flush(); s.key('Escape');
  s.motion.matches = true; s.motion.emit('change');
  s.motion.matches = false; s.motion.emit('change'); await flush();
  assert.equal(s.video.paused, true);
  assert.equal(s.video.calls.length, 1);
});
test('if even muted autoplay is blocked, the first trusted tap starts with sound', async () => {
  const s = setup({ plays: [denied(), denied()] }); await flush();
  assert.equal(s.video.paused, true);
  s.click();
  assert.equal(s.video.calls.at(-1).muted, false);
  await flush();
  assert.equal(s.video.paused, false);
});
test('low-power blocked playback can also start using explicit Space', async () => {
  const s = setup({ plays: [denied(), denied()] }); await flush();
  s.key('Space'); await flush();
  assert.equal(s.video.paused, false);
  assert.equal(s.video.muted, false);
});
test('a denied first gesture is not retried by later clicks, but explicit Space can retry sound', async () => {
  const s = setup({ plays: [denied(), denied(), denied(), denied()] }); await flush();
  s.click(); await flush();
  assert.equal(s.video.paused, true);
  assert.equal(s.video.calls.length, 4);
  s.click();
  assert.equal(s.video.calls.length, 4);
  s.key('Space');
  assert.equal(s.video.calls.at(-1).muted, false);
  await flush();
  assert.equal(s.video.paused, false);
});
test('motion preference changes and hidden pages prevent pending gesture unlocks', async () => {
  for (const reason of ['hidden', 'reduced']) {
    const s = setup({ plays: [denied()] }); await flush();
    if (reason === 'hidden') { s.document.hidden = true; s.document.emit('visibilitychange'); }
    else { s.motion.matches = true; s.motion.emit('change'); }
    s.click(); s.key('Enter', { target: control }); await flush();
    assert.equal(s.video.calls.length, 2);
    assert.equal(s.video.paused, true);
    assert.equal(s.video.muted, true);
  }
});
test('media errors leave the full still visible and no unhandled promise', async () => {
  const s = setup({ plays: [new Error('Decode failed')] }); await flush();
  s.video.emit('error');
  assert.equal(s.video.hidden, true);
  assert.equal(s.poster.src, './assets/full.webp');
  assert.match(s.status.textContent, /still image/);
});
test('duplicate initialization cannot create a second player', async () => {
  const s = setup(); await flush();
  vm.runInContext(source, s.context);
  assert.equal(s.video.calls.length, 1);
});

test('Weather stops lake audio synchronously, restores its previous sky, and never resumes lake on visibility', async () => {
  const s = setup(); await flush();
  s.player.select('weather');
  assert.equal(s.video.paused, true);
  assert.equal(s.root.dataset.background, 'weather');
  assert.equal(s.root.dataset.scene, 'sunny');
  assert.equal(s.layer.attrs['aria-hidden'], 'true');
  assert.equal(s.events.at(-1), 'background-change');
  s.document.hidden = true; s.document.emit('visibilitychange');
  s.document.hidden = false; s.document.emit('visibilitychange');
  s.key('Space'); s.click(); await flush();
  assert.equal(s.video.calls.length, 1);
  assert.equal(s.video.paused, true);
});
test('reselecting lake resumes the same recording and keeps a native mute choice', async () => {
  const s = setup(); await flush();
  s.video.muted = true; await flush();
  s.video.currentTime = 35;
  s.player.select('lake'); s.player.select('unknown');
  assert.equal(s.video.calls.length, 1);
  s.player.select('weather'); s.player.select('lake'); await flush();
  assert.equal(s.video.calls.length, 2);
  assert.equal(s.video.muted, true);
  assert.equal(s.video.currentTime, 35);
});
test('late successful playback and rejection cannot restart or mute the lake after Weather', async () => {
  for (const reject of [false, true]) {
    const pending = deferred();
    const s = setup({ plays: [pending.promise] });
    s.player.select('weather');
    if (reject) pending.reject(denied());
    else { s.video.paused = false; s.video.emit('playing'); pending.resolve(); }
    await flush();
    assert.equal(s.video.paused, true);
    assert.equal(s.video.calls.length, 1);
    assert.equal(s.video.muted, false);
    assert.equal(s.root.dataset.scene, 'sunny');
  }
});
test('Weather remains active after late lake errors and motion preference changes', async () => {
  const s = setup(); await flush();
  s.player.select('weather');
  s.video.emit('error');
  s.motion.matches = true; s.motion.emit('change');
  s.motion.matches = false; s.motion.emit('change'); await flush();
  assert.equal(s.video.paused, true);
  assert.equal(s.status.textContent, '');
  assert.equal(s.root.dataset.background, 'weather');
});
test('a lake decode failure can be retried by selecting homestead again', async () => {
  const s = setup(); await flush();
  s.video.error = new Error('decode'); s.video.emit('error');
  assert.equal(s.poster.src, './assets/full.webp');
  s.player.select('lake'); await flush();
  assert.equal(s.video.paused, false);
  assert.equal(s.video.error, null);
});
