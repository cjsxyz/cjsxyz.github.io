'use strict';

// Run: node --test tests/weather-policy.cjs
// These tests execute the shipped weather.js in a VM; no network requests occur.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = readFileSync(path.join(__dirname, '..', 'weather.js'), 'utf8');
const minute = 60000;
const observationTime = 1792779300; // 2026-10-23 11:15 PDT, 18:15 UTC.
const now = observationTime * 1000 + 2 * minute;
const documentation = {
  fieldsAndCodes: 'https://open-meteo.com/en/docs',
  models: 'https://open-meteo.com/en/docs/gfs-api',
};
// Recorded audit responses, not synthetic observations. Missing temperatures
// remain null rather than being filled with values from another grid/model.
const recorded = [
  { name: 'default land HRRR', expected: 'overcast', documentation,
    current: { time: observationTime, is_day: 1, weather_code: 3, cloud_cover: 88,
      direct_normal_irradiance_instant: 107.5, temperature_2m: 60.5 } },
  { name: 'nearest HRRR', expected: 'cloudy', documentation,
    current: { time: observationTime, is_day: 1, weather_code: 2, cloud_cover: 69,
      direct_normal_irradiance_instant: 315.5, temperature_2m: null } },
  { name: 'nearest NBM', expected: 'sunny', documentation,
    current: { time: observationTime, is_day: 1, weather_code: 0, cloud_cover: 12,
      direct_normal_irradiance_instant: 609.9, temperature_2m: null } },
];

function load({ clock = now, initial = null, payload = { current: recorded[2].current } } = {}) {
  let instant = clock;
  let initialValue = initial;
  let responsePayload = payload;
  const calls = [];
  class Clock extends Date { static now() { return instant; } }
  const sandbox = {
    Date: Clock, URLSearchParams, AbortController, setTimeout, clearTimeout,
    Event: class Event { constructor(type) { this.type = type; } },
    dispatchEvent() {},
    document: {
      currentScript: null, hidden: false,
      querySelector(selector) {
        return selector === '#initial-weather' && initialValue !== null
          ? { textContent: typeof initialValue === 'string' ? initialValue : JSON.stringify(initialValue) }
          : null;
      },
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (responsePayload instanceof Error) throw responsePayload;
      return { ok: true, json: async () => responsePayload };
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'weather.js' });
  return {
    weather: context.SFWeather, calls,
    setNow(value) { instant = value; },
    setInitial(value) { initialValue = value; },
    setPayload(value) { responsePayload = value; },
  };
}
const current = changes => ({ ...recorded[2].current, ...changes });

function initialSnapshot(weather, changes = {}) {
  return {
    version: 1, weatherPolicy: weather.policyId, current: current(),
    fetchedAt: now, validUntil: observationTime * 1000 + 30 * minute, scene: 'sunny',
    ...changes,
  };
}

test('both model and geographic policy are explicit, with five-minute refresh', async () => {
  const x = load();
  assert.equal(x.calls.length, 0, 'module loading without startup attribute does not fetch');
  const url = new URL(x.weather.endpoint);
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '37.789');
  assert.equal(url.searchParams.get('longitude'), '-122.396');
  assert.equal(url.searchParams.get('models'), 'ncep_nbm_conus');
  assert.equal(url.searchParams.get('cell_selection'), 'nearest');
  assert.equal(url.searchParams.get('timezone'), 'America/Los_Angeles');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.deepEqual(new Set(url.searchParams.get('current').split(',')), new Set([
    'temperature_2m', 'is_day', 'weather_code', 'cloud_cover', 'direct_normal_irradiance_instant',
  ]));
  assert.equal(x.weather.policyId, 'east-cut-nbm-nearest-v1');
  assert.equal(x.weather.refreshMs, 5 * minute);
  assert.equal(x.weather.maxWeatherAge, 30 * minute);
  const controller = new AbortController();
  const result = await x.weather.fetchCurrent({ signal: controller.signal });
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].url, x.weather.endpoint);
  assert.equal(x.calls[0].options.signal, controller.signal);
  assert.equal(x.calls[0].options.cache, 'no-store');
  assert.equal(x.calls[0].options.credentials, 'omit');
  assert.equal(x.weather.pickScene(result), 'sunny');
});

test('recorded same-time model/grid responses explain all three daytime scenes', () => {
  const { weather } = load();
  for (const fixture of recorded) {
    assert.equal(weather.isFresh(fixture.current), true, fixture.name);
    assert.equal(weather.pickScene(fixture.current), fixture.expected, fixture.name);
  }
});

test('clouds use direct sunlight, including the existing 120 W/m² boundary', () => {
  const { weather } = load();
  const clouds = current({ weather_code: 2, cloud_cover: 69 });
  for (const [sunlight, expected] of [[0, 'overcast'], [120, 'overcast'], [120.1, 'cloudy'], [700, 'cloudy']]) {
    assert.equal(weather.pickScene({ ...clouds, direct_normal_irradiance_instant: sunlight }), expected);
  }
  assert.equal(weather.pickScene({ ...clouds, direct_normal_irradiance_instant: null }), 'overcast');
  assert.equal(weather.pickScene({ ...clouds, cloud_cover: 35, direct_normal_irradiance_instant: null }), 'cloudy');
  assert.equal(weather.pickScene({ ...clouds, weather_code: 3, direct_normal_irradiance_instant: 700 }), 'cloudy');
});

test('night phases retain clear, cloudy and overcast skies independently of sunlight', () => {
  const { weather } = load();
  for (const [change, expected] of [
    [{ weather_code: 0, cloud_cover: 12 }, 'clear-night'],
    [{ weather_code: 2, cloud_cover: 35 }, 'night'],
    [{ weather_code: 2, cloud_cover: 69 }, 'overcast-night'],
    [{ weather_code: 3, cloud_cover: null }, 'overcast-night'],
  ]) {
    for (const sunlight of [0, 609.9, null]) {
      assert.equal(weather.pickScene(current({ ...change, is_day: 0, direct_normal_irradiance_instant: sunlight })), expected);
    }
  }
});

test('reported rain, drizzle, thunderstorms and fog override sunny-looking numeric fields', () => {
  const { weather } = load();
  for (const is_day of [0, 1]) {
    for (const weather_code of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 97, 99]) {
      const c = current({ weather_code, is_day, cloud_cover: 0, direct_normal_irradiance_instant: 900 });
      assert.equal(weather.pickScene(c), is_day ? 'rain' : 'night-rain', `code ${weather_code}, day ${is_day}`);
      assert.match(weather.summarize(c), /raining in San Francisco$/);
    }
    for (const weather_code of [45, 48]) {
      const c = current({ weather_code, is_day, cloud_cover: 0, direct_normal_irradiance_instant: 900 });
      assert.equal(weather.pickScene(c), is_day ? 'fog' : 'night-fog');
      assert.match(weather.summarize(c), /foggy in San Francisco$/);
    }
  }
  assert.equal(weather.pickScene(current({ weather_code: 3, cloud_cover: 100, direct_normal_irradiance_instant: 0 })), 'overcast',
    'gray skies alone do not diagnose rain or fog');
});

test('freshness expires at 30 minutes and tolerates only 30 seconds of future time', () => {
  const { weather } = load();
  const at = observationTime * 1000;
  const reading = current();
  assert.equal(weather.isFresh(reading, at + 30 * minute - 1), true);
  assert.equal(weather.isFresh(reading, at + 30 * minute), false);
  assert.equal(weather.isFresh(reading, at + 2 * 60 * minute), false);
  assert.equal(weather.isFresh(reading, at - 30000), true);
  assert.equal(weather.isFresh(reading, at - 30001), false);
  for (const invalid of [null, {}, current({ time: '1792779300' }), current({ weather_code: 999 })]) {
    assert.equal(weather.isFresh(invalid, at), false);
  }
  assert.equal(weather.isFresh(reading, Number.NaN), false);
});

test('fetch rejects stale/future provider time rather than refreshing it with the request time', async () => {
  const x = load();
  for (const time of [Math.floor(now / 1000) - 1800, Math.floor(now / 1000) + 31]) {
    x.setPayload({ current: current({ time }) });
    await assert.rejects(x.weather.fetchCurrent(), /outside the current time window/);
  }
  x.setPayload({ current: current({ time: Math.floor(now / 1000) - 1799 }) });
  assert.equal((await x.weather.fetchCurrent()).time, Math.floor(now / 1000) - 1799);
  x.setPayload(new Error('Provider unavailable'));
  await assert.rejects(x.weather.fetchCurrent(), /Provider unavailable/);
});

test('initial weather requires this exact model/location policy and matching scene', () => {
  const x = load();
  const good = initialSnapshot(x.weather);
  x.setInitial(good);
  assert.equal(x.weather.readInitial().scene, 'sunny');
  for (const changes of [
    { weatherPolicy: undefined }, { weatherPolicy: 'sf-default-v1' },
    { weatherPolicy: 'east-cut-hrrr-nearest-v1' }, { weatherPolicy: null },
    { scene: 'overcast' }, { version: 2 },
  ]) {
    x.setInitial({ ...good, ...changes });
    assert.equal(x.weather.readInitial(), null, JSON.stringify(changes));
  }
});

test('initial snapshot cannot outlive its observation or reset an expired reading with fresh fetchedAt', () => {
  const x = load();
  const good = initialSnapshot(x.weather);
  x.setInitial(good);
  x.setNow(good.validUntil - 1);
  assert.equal(x.weather.readInitial().scene, 'sunny');
  x.setNow(good.validUntil);
  assert.equal(x.weather.readInitial(), null);
  x.setNow(now);
  for (const changes of [
    { validUntil: good.validUntil + 1 },
    { current: current({ time: Math.floor(now / 1000) - 1800 }), fetchedAt: now, validUntil: now + minute },
    { validUntil: now }, { fetchedAt: now + 60001 },
  ]) {
    x.setInitial({ ...good, ...changes });
    assert.equal(x.weather.readInitial(), null, JSON.stringify(changes));
  }
});
