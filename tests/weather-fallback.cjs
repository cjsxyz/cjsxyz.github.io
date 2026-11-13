'use strict';

// Run: node --test tests/weather-fallback.cjs
// Exercise real policy code with deterministic provider responses and bounded
// request timers; no external services are needed for these regression tests.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = readFileSync(path.join(__dirname, '..', 'weather.js'), 'utf8');
const minute = 60000;
const hour = 60 * minute;
const start = Date.parse('2026-11-13T17:00:00Z');
const now = start + 45 * minute;
const response = data => ({ ok: true, status: 200, json: async () => data });
const hrrr = (at = now, changes = {}) => ({ current: {
  time: Math.floor(at / 1000), temperature_2m: 59, weather_code: 3, is_day: 1,
  cloud_cover: 94, direct_normal_irradiance_instant: 302.5, ...changes,
} });
const period = (changes = {}) => ({
  startTime: new Date(start).toISOString(), endTime: new Date(start + hour).toISOString(),
  temperature: 59, temperatureUnit: 'F', shortForecast: 'Light Rain Likely', ...changes,
});
const nws = (changes = {}, properties = {}) => ({ properties: {
  updateTime: new Date(start - 20 * minute).toISOString(),
  generatedAt: new Date(now).toISOString(), periods: [period(changes)], ...properties,
} });

function load({ clock = now, timerScale = 1 } = {}) {
  const delays = [];
  class Clock extends Date { static now() { return clock; } }
  const context = vm.createContext({
    Date: Clock, URLSearchParams, AbortController, clearTimeout,
    setTimeout(fn, ms) { delays.push(ms); return setTimeout(fn, ms * timerScale); },
  });
  vm.runInContext(source, context, { filename: 'weather.js' });
  return { weather: context.SFWeather, delays };
}

async function fallback(weather, payload = nws(), at = now) {
  return weather.fetchCurrent({ now: () => at, fetchImpl: async url => {
    if (url === weather.endpoint) throw new Error('Primary offline');
    assert.equal(url, 'https://api.weather.gov/gridpoints/MTR/86,106/forecast/hourly');
    return response(payload);
  } });
}

test('healthy HRRR is the only request, with no fallback for model disagreement', async () => {
  const { weather } = load();
  const calls = [];
  const current = await weather.fetchCurrent({ now: () => now, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(hrrr(now, { weather_code: 2, cloud_cover: 50, direct_normal_irradiance_instant: 500 }));
  } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('models'), 'ncep_hrrr_conus');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(current.source, undefined);
  assert.equal(weather.pickScene(current, now), 'cloudy');
  assert.match(weather.summarize(current, now), /^Currently /);
});

test('transport, HTTP, malformed JSON, malformed data and stale HRRR all use NWS', async () => {
  const { weather } = load();
  for (const primary of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }),
    async () => response({ current: { weather_code: 3 } }),
    async () => response(hrrr(now - 30 * minute)),
    async () => response(hrrr(now + minute)),
  ]) {
    const calls = [];
    const current = await weather.fetchCurrent({ now: () => now, fetchImpl: async url => {
      calls.push(url);
      return url === weather.endpoint ? primary() : response(nws());
    } });
    assert.equal(current.source, 'nws-hourly');
    assert.deepEqual(calls, [weather.endpoint, weather.fallbackEndpoint]);
  }
});

test('a hanging primary is aborted after its budget and a healthy fallback succeeds', async () => {
  const { weather, delays } = load({ timerScale: 0.001 });
  const calls = [];
  const current = await weather.fetchCurrent({ now: () => now, fetchImpl: (url, options) => {
    calls.push({ url, signal: options.signal });
    return url === weather.endpoint ? new Promise(() => {}) : Promise.resolve(response(nws()));
  } });
  assert.equal(current.source, 'nws-hourly');
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  assert.deepEqual(delays, [3000, 4000]);
});

test('both hanging services finish within their budgets instead of leaving a pending request', async () => {
  const { weather, delays } = load({ timerScale: 0.001 });
  const signals = [];
  await assert.rejects(weather.fetchCurrent({ now: () => now, fetchImpl: (url, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  } }), error => {
    assert.equal(error.name, 'AggregateError');
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /HRRR: Weather request timed out; NWS: Weather request timed out/);
    return true;
  });
  assert.equal(signals.length, 2);
  assert.equal(signals.every(signal => signal.aborted), true);
  assert.deepEqual(delays, [3000, 4000]);
});

test('caller cancellation before or during primary never launches fallback', async () => {
  const { weather } = load();
  for (const preabort of [true, false]) {
    const controller = new AbortController();
    if (preabort) controller.abort();
    let calls = 0;
    const promise = weather.fetchCurrent({ signal: controller.signal, now: () => now, fetchImpl: async (url, options) => {
      calls++;
      controller.abort();
      assert.equal(options.signal.aborted, true);
      return new Promise(() => {});
    } });
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(calls, preabort ? 0 : 1);
  }
});

test('caller cancellation during fallback aborts the active independent request', async () => {
  const { weather } = load();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(weather.fetchCurrent({ signal: controller.signal, now: () => now, fetchImpl: async (url, options) => {
    calls++;
    if (url === weather.endpoint) throw new Error('Primary offline');
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return new Promise(() => {});
  } }), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('NWS retains its full current hour and original issue time without retimestamping', async () => {
  const { weather } = load();
  const current = await fallback(weather);
  assert.equal(current.time, start / 1000);
  assert.equal(current.validUntil, (start + hour) / 1000);
  assert.equal(current.issuedAt, (start - 20 * minute) / 1000);
  assert.equal(weather.isFresh(current, now), true, '45 minutes into the current forecast hour remains valid');
  assert.equal(weather.expiresAt(current), start + hour);
  assert.equal(weather.isFresh(current, start + hour - 1), true);
  assert.equal(weather.isFresh(current, start + hour), false);
  assert.equal(weather.isFresh(current, start - 1), false, 'future periods are not current weather');
  assert.equal(weather.summarize(current, now), 'Forecast: 59°F and rain likely in San Francisco');
  assert.equal(weather.describe(current), 'rain likely');
});

test('forecast issuance expires after six hours even when a new response claims generatedAt now', async () => {
  const { weather } = load();
  for (const issuedAt of [now - 6 * hour, now + minute]) {
    await assert.rejects(fallback(weather, nws({}, { updateTime: new Date(issuedAt).toISOString() })), /validity window/);
  }
  const current = await fallback(weather, nws({}, { updateTime: new Date(now - 6 * hour + minute).toISOString() }));
  assert.equal(weather.expiresAt(current), now + minute);
  assert.equal(weather.isFresh(current, now + minute), false);
});

test('only the current unambiguous forecast period is accepted', async () => {
  const { weather } = load();
  const future = period({ startTime: new Date(start + hour).toISOString(), endTime: new Date(start + 2 * hour).toISOString() });
  for (const periods of [[], [future], [period(), period()]]) {
    await assert.rejects(fallback(weather, nws({}, { periods })), /current forecast period/);
  }
  await assert.rejects(fallback(weather, nws({}, { updateTime: 'not a time' })), /forecast provenance/);
});

test('period selection uses time after the response, not when the request started', async () => {
  const { weather } = load();
  let instant = start + hour - 1;
  const future = period({ startTime: new Date(start + hour).toISOString(), endTime: new Date(start + 2 * hour).toISOString(), shortForecast: 'Sunny' });
  const current = await weather.fetchCurrent({ now: () => instant, fetchImpl: async url => {
    if (url === weather.endpoint) throw new Error('Primary offline');
    instant = start + hour;
    return response(nws({}, { periods: [period(), future] }));
  } });
  assert.equal(current.time, (start + hour) / 1000);
  assert.equal(current.weather_code, 0);
});

test('NWS clear, cloudy and definite precipitation conditions map without invented sunlight', async () => {
  const { weather } = load();
  for (const [shortForecast, code, scene] of [
    ['Sunny', 0, 'sunny'], ['Clear', 0, 'sunny'], ['Mostly Sunny', 1, 'sunny'],
    ['Partly Cloudy', 2, 'cloudy'], ['Partly Sunny', 2, 'cloudy'],
    ['Mostly Cloudy', 3, 'overcast'], ['Cloudy', 3, 'overcast'],
    ['Light Rain', 61, 'rain'], ['Rain Showers', 61, 'rain'], ['Drizzle', 51, 'rain'],
    ['Showers And Thunderstorms', 95, 'rain'], ['Patchy Fog', 45, 'fog'], ['Light Snow', 73, 'cloudy'],
  ]) {
    const current = await fallback(weather, nws({ shortForecast }));
    assert.equal(current.weather_code, code, shortForecast);
    assert.equal(current.cloud_cover, null, 'unknown cloud percentage must not be invented');
    assert.equal(current.direct_normal_irradiance_instant, null);
    assert.equal(weather.pickScene(current, now), scene, shortForecast);
    assert.match(weather.summarize(current, now), /^Forecast: /);
  }
});

test('chance and likely precipitation stay qualified and cannot assert falling rain', async () => {
  const { weather } = load();
  for (const [shortForecast, label] of [
    ['Light Rain Likely', 'rain likely'], ['Slight Chance Rain Showers', 'rain possible'],
    ['Chance Showers And Thunderstorms', 'thunderstorms possible'],
    ['Snow Likely', 'snow likely'], ['Chance Drizzle', 'drizzle possible'],
  ]) {
    const current = await fallback(weather, nws({ shortForecast }));
    assert.equal(current.forecastLabel, label);
    assert.equal(weather.pickScene(current, now), 'overcast');
    assert.match(weather.summarize(current, now), new RegExp(label));
    assert.doesNotMatch(weather.summarize(current, now), /raining/);
  }
});

test('recognized wind modifiers preserve sky, rain and uncertainty classifications', async () => {
  const { weather } = load();
  for (const [shortForecast, code, scene, label] of [
    ['Mostly Cloudy And Breezy', 3, 'overcast', undefined],
    ['Sunny And Windy', 0, 'sunny', undefined],
    ['Rain And Windy', 61, 'rain', undefined],
    ['Snow And Blustery', 73, 'cloudy', undefined],
    ['Rain Likely And Windy', 3, 'overcast', 'rain likely'],
    ['Chance Rain Showers And Breezy', 3, 'overcast', 'rain possible'],
  ]) {
    const current = await fallback(weather, nws({ shortForecast }));
    assert.equal(current.weather_code, code, shortForecast);
    assert.equal(weather.pickScene(current, now), scene, shortForecast);
    assert.equal(current.forecastLabel, label, shortForecast);
  }
  for (const shortForecast of ['Rain And Aliens', 'Sunny And Radioactive', 'Windy']) {
    await assert.rejects(fallback(weather, nws({ shortForecast })), /forecast condition/);
  }
});

test('fractional-second forecast issuance remains valid without changing its meaning', async () => {
  const { weather } = load();
  const update = start - 20 * minute + 456;
  const current = await fallback(weather, nws({}, { updateTime: new Date(update).toISOString() }));
  assert.equal(current.issuedAt, Math.floor(update / 1000));
  assert.equal(current.time, start / 1000);
  assert.equal(weather.isFresh(current, now), true);
});

test('a chance of thunderstorms does not erase definite rain from the same forecast', async () => {
  const { weather } = load();
  const mixed = await fallback(weather, nws({ shortForecast: 'Rain Showers And Slight Chance Thunderstorms' }));
  assert.equal(mixed.weather_code, 61);
  assert.equal(mixed.forecastLabel, undefined);
  assert.equal(weather.pickScene(mixed, now), 'rain');
  const uncertain = await fallback(weather, nws({ shortForecast: 'Chance Rain Showers And Thunderstorms' }));
  assert.equal(uncertain.weather_code, 3);
  assert.equal(uncertain.forecastLabel, 'thunderstorms possible');
});

test('night rain and fog follow the SF clock instead of the fallback daytime flag', async () => {
  const at = Date.parse('2026-11-14T04:45:00Z');
  const { weather } = load({ clock: at });
  for (const [shortForecast, expected] of [['Light Rain', 'night-rain'], ['Fog', 'night-fog']]) {
    const current = await fallback(weather, nws({ shortForecast, isDaytime: true,
      startTime: '2026-11-14T04:00:00Z', endTime: '2026-11-14T05:00:00Z',
    }, { updateTime: '2026-11-14T03:30:00Z' }), at);
    assert.equal(current.is_day, 0);
    assert.equal(weather.pickScene(current, at), expected);
  }
});

test('fallback rejects unknown conditions and unsafe provenance instead of inventing weather', async () => {
  const { weather } = load();
  for (const shortForecast of ['Haze', 'Rain With Aliens', '', null]) {
    await assert.rejects(fallback(weather, nws({ shortForecast })), /forecast condition/);
  }
  const current = await fallback(weather);
  for (const changed of [{ source: 'other' }, { forecastLabel: '<script>rain</script>' }, { validUntil: current.time }]) {
    assert.throws(() => weather.normalize({ ...current, ...changed }), /forecast provenance/);
  }
});

test('NWS Celsius conversion and missing temperatures preserve honest display', async () => {
  const { weather } = load();
  const current = await fallback(weather, nws({ temperature: 15, temperatureUnit: 'C' }));
  assert.equal(current.temperature_2m, 59);
  assert.equal(weather.summarize(await fallback(weather, nws({ temperature: null })), now), 'Forecast: rain likely in San Francisco');
  await assert.rejects(fallback(weather, nws({ temperatureUnit: 'Kelvin' })), /forecast temperature/);
});

test('the next refresh returns to HRRR after recovery and drops forecast-only metadata', async () => {
  const { weather } = load();
  assert.equal((await fallback(weather)).source, 'nws-hourly');
  const calls = [];
  const current = await weather.fetchCurrent({ now: () => now, fetchImpl: async url => {
    calls.push(url); return response(hrrr());
  } });
  assert.deepEqual(calls, [weather.endpoint]);
  assert.equal(current.source, undefined);
  assert.equal(current.forecastLabel, undefined);
  assert.equal(weather.expiresAt(current), now + 30 * minute);
  assert.equal(weather.summarize(current, now), 'Currently 59°F and cloudy in San Francisco');
});
