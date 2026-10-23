'use strict';

// Deterministic clipboard/timer regressions against the shipped dock controller.
// Browser verification remains necessary for real clipboard permissions and glass layout.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const site = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(site, 'dock.js'), 'utf8');
const markup = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(error));

class Element {
  constructor(tagName = 'DIV') {
    this.tagName = tagName; this.dataset = {}; this.attrs = {}; this.style = {};
    this.listeners = {}; this.children = []; this.hidden = false; this.inert = false;
    this.textContent = ''; this.scrollHeight = 58; this.clientHeight = 58;
  }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  emit(type, event = {}) {
    const output = { target: this, detail: 1, isTrusted: true,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...event };
    for (const listener of this.listeners[type] || []) listener(output);
    return output;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  closest(selector) { return selector === '.dock-item' && this.dataset.view ? this : this.parent?.closest(selector) || null; }
}

function setup({ clipboard = 'available', reduced = false } = {}) {
  let now = 0, timerId = 0, inClick = false;
  const timers = new Map(), requests = [], sounds = [], unlocks = [];
  const doc = new Element(), win = new Element(), dock = new Element(), panel = new Element();
  const content = new Element(), media = new Element(), outside = new Element();
  media.matches = reduced; panel.appendChild(content); dock.appendChild(panel);
  const nodes = { '.icon-dock': dock, '#dock-panel': panel, '.dock-panel-content': content };
  for (const match of markup.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    if (!nodes[`#${match[2]}`]) {
      const element = new Element(match[1].toUpperCase());
      element.hidden = /\bhidden\b/.test(match[0]);
      nodes[`#${match[2]}`] = content.appendChild(element);
    }
  }
  const items = {};
  for (const view of ['cloud', 'user', 'mail']) {
    const item = new Element('BUTTON'); item.dataset.view = view;
    item.focus = () => { doc.activeElement = item; doc.emit('focusin', { target: item }); };
    items[view] = dock.appendChild(item);
  }
  dock.querySelectorAll = () => Object.values(items);
  dock.querySelector = selector => items[/data-view="([^"]+)"/.exec(selector)?.[1]] || nodes[selector];
  panel.querySelector = selector => nodes[selector];
  doc.querySelector = selector => nodes[selector];
  doc.activeElement = outside;
  win.matchMedia = () => media;
  win.DockSounds = { play: cue => sounds.push(cue), unlock() { unlocks.push({ inClick }); return Promise.resolve(true); } };
  const navigator = {};
  if (clipboard !== 'missing') navigator.clipboard = {
    writeText(value) {
      if (clipboard === 'throws') throw new Error('Clipboard denied synchronously');
      return new Promise((resolve, reject) => requests.push({ value, inClick, resolve, reject }));
    },
  };
  const context = vm.createContext({ window: win, document: doc, navigator,
    ResizeObserver: class { observe() {} },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'dock.js' });
  return {
    dock, panel, content, nodes, items, requests, sounds, unlocks, doc, win, outside,
    open: () => dock.dataset.panelOpen === 'true',
    visibleCopy: () => dock.dataset.panelOpen === 'true' && Object.values(nodes).some(node => !node.hidden && node.textContent === 'Copied!'),
    click(view, detail = 1) { inClick = true; try { return items[view].emit('click', { detail }); } finally { inClick = false; } },
    async success(index = requests.length - 1) { requests[index].resolve(); await flush(); },
    async failure(index = requests.length - 1) { requests[index].reject(new Error('Clipboard permission denied')); await flush(); },
    outsideClick() { doc.emit('pointerdown', { target: outside }); },
    outsideFocus() { doc.emit('focusin', { target: outside }); },
    escape() { return doc.emit('keydown', { key: 'Escape', target: doc.activeElement }); },
    async tick(ms) {
      const end = now + ms;
      for (let count = 0; count < 50; count++) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = end; await flush(); return; }
        const [id, timer] = next; now = timer.at; timers.delete(id); timer.fn(); await flush();
      }
      throw new Error('Unexpected timer loop');
    },
  };
}

const checks = [], failures = [];
async function test(name, body) {
  try { await body(); await flush(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}

(async () => {
  await test('Email is a disclosure button, with no native mailto navigation', async () => {
    const mail = /<([a-z]+)\b[^>]*data-view="mail"[^>]*>/.exec(markup);
    assert.equal(mail[1], 'button'); assert.match(mail[0], /type="button"/);
    assert.match(mail[0], /aria-controls="dock-panel"/); assert.match(mail[0], /aria-expanded="false"/);
    assert.doesNotMatch(mail[0], /href=/);
  });
  await test('trusted click invokes exact clipboard write synchronously and success alone opens Copied!', async () => {
    const x = setup(); x.click('mail');
    assert.equal(x.requests.length, 1); assert.equal(x.requests[0].value, 'chris@paradigm.xyz');
    assert.equal(x.requests[0].inClick, true); assert.equal(x.visibleCopy(), false);
    assert.deepEqual(x.unlocks, [{ inClick: true }], 'audio unlock stays inside the trusted gesture');
    assert.deepEqual(x.sounds, [], 'no selection or success cue before clipboard resolves');
    await x.success(); assert.equal(x.visibleCopy(), true);
    assert.deepEqual(x.sounds, ['success']);
    assert.equal(x.items.mail.getAttribute('aria-expanded'), 'true');
    assert.equal(x.panel.getAttribute('aria-hidden'), 'false'); assert.equal(x.panel.inert, false);
    assert.equal(x.nodes['#weather-summary'].hidden, true); assert.equal(x.nodes['#bio-summary'].hidden, true);
  });
  await test('successful confirmation stays open for 499ms and closes at 500ms', async () => {
    const x = setup(); x.click('mail'); await x.success();
    await x.tick(499); assert.equal(x.visibleCopy(), true); await x.tick(1); assert.equal(x.open(), false);
    assert.equal(x.items.mail.getAttribute('aria-expanded'), 'false'); assert.equal(x.panel.inert, true);
  });
  await test('confirmation lifetime begins after successful copy, not the initial click', async () => {
    const x = setup(); x.click('mail'); await x.tick(5000);
    assert.equal(x.visibleCopy(), false); await x.success(); await x.tick(499); assert.equal(x.visibleCopy(), true);
    await x.tick(1); assert.equal(x.open(), false);
  });
  await test('clipboard rejection never displays a false success or throws unhandled rejection', async () => {
    const x = setup(); x.click('mail'); await x.failure();
    assert.deepEqual(x.sounds, [], 'failed copy must not sound successful');
    assert.equal(x.visibleCopy(), false);
    assert.equal(x.nodes['#copy-summary'].textContent, 'Couldn’t copy. Try again.');
    assert.equal(x.open(), true); await x.tick(2999); assert.equal(x.open(), true);
    await x.tick(1); assert.equal(x.open(), false);
  });
  await test('missing or synchronously throwing clipboard support cannot display success', async () => {
    for (const clipboard of ['missing', 'throws']) {
      const x = setup({ clipboard }); assert.doesNotThrow(() => x.click('mail')); await flush();
      assert.equal(x.visibleCopy(), false);
      assert.deepEqual(x.sounds, []);
    }
  });
  await test('repeated Email activation resets the half-second timer after latest success', async () => {
    const x = setup(); x.click('mail'); await x.success(); await x.tick(400);
    x.click('mail'); assert.equal(x.requests.length, 2); await x.success();
    await x.tick(100); assert.equal(x.visibleCopy(), true, 'old timer cannot close latest confirmation');
    await x.tick(399); assert.equal(x.visibleCopy(), true); await x.tick(1); assert.equal(x.open(), false);
  });
  await test('older pending copy cannot override newer success or reset its timer', async () => {
    const x = setup(); x.click('mail'); x.click('mail'); await x.success(1); await x.tick(250);
    await x.success(0); await x.tick(249); assert.equal(x.visibleCopy(), true);
    assert.deepEqual(x.sounds, ['success'], 'superseded requests cannot play another success');
    await x.tick(1); assert.equal(x.open(), false);
  });
  await test('switching to Cloud or User cancels pending copies and confirmation autoclose', async () => {
    for (const view of ['cloud', 'user']) {
      const pending = setup(); pending.click('mail'); pending.click(view); await pending.success();
      assert.deepEqual(pending.sounds, ['select'], 'dismissed pending copy cannot play a success cue');
      assert.equal(pending.visibleCopy(), false); assert.equal(pending.open(), true);
      assert.equal(pending.items[view].getAttribute('aria-expanded'), 'true');
      const shown = setup(); shown.click('mail'); await shown.success(); await shown.tick(250); shown.click(view);
      await shown.tick(500); assert.equal(shown.open(), true); assert.equal(shown.visibleCopy(), false);
      assert.equal(shown.items[view].getAttribute('aria-expanded'), 'true');
    }
  });
  await test('outside pointer/focus and Escape dismiss pending operations without late reopening', async () => {
    for (const dismiss of ['outsideClick', 'outsideFocus', 'escape']) {
      const x = setup(); x.click('mail'); x[dismiss](); await x.success();
      assert.equal(x.open(), false, dismiss); assert.equal(x.visibleCopy(), false, dismiss);
    }
  });
  await test('outside dismissal cancels visible confirmation timer and closes only once', async () => {
    const x = setup(); x.click('mail'); await x.success(); await x.tick(400); x.outsideClick();
    assert.equal(x.open(), false); const cues = x.sounds.length; await x.tick(2000);
    assert.equal(x.open(), false); assert.equal(x.sounds.length, cues, 'old timer must stay cancelled');
  });
  await test('keyboard-generated click and reduced motion preserve copy and half-second dismissal', async () => {
    const x = setup({ reduced: true }); x.click('mail', 0); assert.equal(x.requests[0].inClick, true);
    await x.success(); assert.equal(x.visibleCopy(), true); assert.equal(x.dock.dataset.instantExpand, 'true');
    await x.tick(499); assert.equal(x.visibleCopy(), true); await x.tick(1); assert.equal(x.open(), false);
  });
  await test('copy feedback does not overwrite weather copy and Escape restores focus to Email', async () => {
    const x = setup(); x.nodes['#weather-summary'].textContent = 'Currently 60°F and cloudy in San Francisco';
    x.click('mail'); await x.success(); x.doc.activeElement = x.nodes['#copy-summary'];
    const event = x.escape(); assert.equal(x.open(), false); assert.equal(x.doc.activeElement, x.items.mail);
    assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
    x.click('cloud'); assert.equal(x.nodes['#weather-summary'].hidden, false);
    assert.equal(x.nodes['#weather-summary'].textContent, 'Currently 60°F and cloudy in San Francisco');
  });
  await test('all asynchronous clipboard paths are handled', async () => {
    await flush(); assert.deepEqual(unhandled.map(String), []);
  });
  console.log(JSON.stringify({ passed: checks.length, failed: failures.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})();
