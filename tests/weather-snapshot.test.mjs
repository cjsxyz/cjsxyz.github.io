import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  validateSnapshot, createSnapshot, fetchSnapshot, compareSnapshots, check, build,
} from '../scripts/weather-snapshot.mjs';

// Run: node --test tests/weather-snapshot.test.mjs
// Provider and published responses are deterministic: these tests never use the network.
const minute = 60_000;
const day = 24 * 60 * minute;
const noon = Date.parse('2026-10-22T19:00:00Z');
const night = Date.parse('2026-10-23T03:00:00Z');
const weather = globalThis.SFWeather;
const { sunrise, sunsetStart, sunset, dusk } = weather.solarPhase(noon);
const seconds = value => Math.floor(value / 1000);
const revisionA = 'a'.repeat(40);
const revisionB = 'b'.repeat(40);

function payload(now = noon, overrides = {}) {
  return {
    current: {
      time: seconds(now), temperature_2m: 58.2, weather_code: 2,
      is_day: now >= sunrise && now < sunset ? 1 : 0,
      cloud_cover: 45, direct_normal_irradiance_instant: 500,
      ...overrides,
    },
    daily: {
      time: [seconds(sunrise - 7 * 60 * minute), seconds(sunrise - 7 * 60 * minute + day)],
      sunrise: [seconds(sunrise), seconds(sunrise + day + minute)],
      sunset: [seconds(sunset), seconds(sunset + day - minute)],
    },
  };
}

const snapshot = (now = noon, overrides = {}) => createSnapshot(payload(now, overrides), now);
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sf-weather-snapshot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const sceneCases = [
  ['sunny', noon, { weather_code: 0, cloud_cover: 0 }],
  ['cloudy', noon, { weather_code: 2, cloud_cover: 45, direct_normal_irradiance_instant: 500 }],
  ['overcast', noon, { weather_code: 2, cloud_cover: 70, direct_normal_irradiance_instant: 20 }],
  ['rain', noon, { weather_code: 61 }],
  ['fog', noon, { weather_code: 45 }],
  ['sunset', sunsetStart + 5 * minute, { weather_code: 0, cloud_cover: 0 }],
  ['cloudy-sunset', sunsetStart + 5 * minute, { weather_code: 2, cloud_cover: 45, direct_normal_irradiance_instant: 500 }],
  ['clear-night', night, { weather_code: 0, cloud_cover: 0 }],
  ['night', night, { weather_code: 2, cloud_cover: 45 }],
  ['overcast-night', night, { weather_code: 3, cloud_cover: 95 }],
  ['night-rain', night, { weather_code: 61 }],
  ['night-fog', night, { weather_code: 45 }],
];

test('snapshot creation selects all twelve scenes, including clear and cloudy sunset', () => {
  for (const [expected, now, overrides] of sceneCases) {
    const result = snapshot(now, overrides);
    assert.equal(result.version, 1, expected);
    assert.equal(result.scene, expected);
    assert.equal(result.fetchedAt, now);
    assert.equal(result.validUntil, Math.min(now + 30 * minute, weather.nextSolarBoundary(now)));
    assert.equal(validateSnapshot(result, now)?.scene, expected);
  }
});

test('drizzle and every supported thunderstorm code remain rain by day and night', () => {
  for (const code of [51, 53, 55, 56, 57, 95, 96, 97, 99]) {
    assert.equal(snapshot(noon, { weather_code: code }).scene, 'rain', String(code));
    assert.equal(snapshot(night, { weather_code: code }).scene, 'night-rain', String(code));
  }
});

test('snapshot expiration stops at every solar lighting boundary', () => {
  for (const [now, next, is_day] of [
    [sunrise - 5 * minute, sunrise, 0],
    [sunsetStart - 5 * minute, sunsetStart, 1],
    [sunset - 5 * minute, sunset, 1],
    [dusk - 5 * minute, dusk, 0],
  ]) {
    const result = snapshot(now, { is_day });
    assert.ok(result.validUntil <= next, 'must not outlive the day/night transition');
    assert.ok(result.validUntil > now);
    assert.ok(validateSnapshot(result, result.validUntil - 1));
    assert.equal(validateSnapshot(result, next), null);
  }
});

test('creation rejects malformed, stale, or impossible provider weather', () => {
  for (const current of [
    { time: seconds(noon - 31 * minute) }, { time: seconds(noon + minute) },
    { weather_code: 999 }, { is_day: 2 },
    { temperature_2m: Infinity }, { temperature_2m: 151 },
    { cloud_cover: -1 }, { direct_normal_irradiance_instant: '500' },
  ]) assert.throws(() => snapshot(noon, current), JSON.stringify(current));
  assert.throws(() => createSnapshot(null, noon));
  assert.throws(() => createSnapshot({ error: true, ...payload() }, noon));
});

test('creation derives current day/night phase from solar times near transitions', () => {
  assert.equal(snapshot(sunrise + minute, { is_day: 0, weather_code: 0, cloud_cover: 0 }).scene, 'sunny');
  assert.equal(snapshot(sunset + minute, { is_day: 1, weather_code: 0, cloud_cover: 0 }).scene, 'sunset');
  assert.equal(snapshot(sunrise, { is_day: 0 }).current.is_day, 1);
  assert.equal(snapshot(sunset, { is_day: 1 }).current.is_day, 0);
});

test('clear sunset uses the wall clock with inclusive start and exclusive civil dusk', () => {
  const current = payload(noon, { weather_code: 0, cloud_cover: 0, is_day: 0 }).current;
  for (const [now, expected] of [
    [sunrise - 1, 'clear-night'], [sunrise, 'sunny'],
    [sunsetStart - 1, 'sunny'], [sunsetStart, 'sunset'],
    [sunset, 'sunset'], [dusk - 1, 'sunset'], [dusk, 'clear-night'],
  ]) {
    assert.equal(weather.pickScene(current, now), expected);
    assert.equal(weather.pickScene({ ...current, is_day: 1 }, now), expected,
      'a contradictory provider flag does not change the solar clock');
  }
  assert.equal(weather.summarize(current, sunset), 'Currently 58°F and clear in San Francisco');
  assert.equal(weather.solarPhase(sunset).isDay, false, 'sunset imagery continues into civil twilight');
});

test('sunset requires clear weather and never replaces precipitation, fog or overcast', () => {
  for (const now of [sunsetStart + minute, sunset + minute]) {
    const suffix = now < sunset ? '' : 'night-';
    for (const weather_code of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 97, 99]) {
      assert.equal(weather.pickScene(payload(now, { weather_code, cloud_cover: 0 }).current, now), `${suffix}rain`);
    }
    for (const weather_code of [45, 48]) {
      assert.equal(weather.pickScene(payload(now, { weather_code, cloud_cover: 0 }).current, now), `${suffix}fog`);
    }
    for (const [weather_code, cloud_cover] of [[2, 80], [3, 10]]) {
      assert.equal(weather.pickScene(payload(now, { weather_code, cloud_cover, direct_normal_irradiance_instant: 0 }).current, now),
        now < sunset ? 'overcast' : 'overcast-night');
    }
    for (const weather_code of [0, 1]) for (const cloud_cover of [0, 25, null]) {
      assert.equal(weather.pickScene(payload(now, { weather_code, cloud_cover }).current, now), 'sunset');
    }
    assert.notEqual(weather.pickScene(payload(now, { weather_code: 1, cloud_cover: 26 }).current, now), 'sunset');
    assert.notEqual(weather.pickScene(payload(now, { weather_code: 2, cloud_cover: 10 }).current, now), 'sunset');
  }
});

test('cloudy sunset preserves the daylight sunlight cutoff and ends at actual sunset', () => {
  const current = payload(noon, { weather_code: 2, cloud_cover: 45, is_day: 0 }).current;
  for (const [now, expected] of [
    [sunsetStart - 1, 'cloudy'], [sunsetStart, 'cloudy-sunset'],
    [sunset - 1, 'cloudy-sunset'], [sunset, 'night'], [dusk, 'night'],
  ]) {
    assert.equal(weather.pickScene(current, now), expected);
    assert.equal(weather.pickScene({ ...current, is_day: 1 }, now), expected,
      'stale daylight flags and positive sunlight cannot extend sunset clouds after sunset');
  }
  for (const [irradiance, expected] of [[0, 'overcast'], [120, 'overcast'], [120.01, 'cloudy-sunset']]) {
    assert.equal(weather.pickScene({ ...current, direct_normal_irradiance_instant: irradiance }, sunsetStart), expected);
  }
  for (const [weather_code, cloud_cover, expected] of [
    [2, 59, 'cloudy-sunset'], [2, 60, 'overcast'], [3, 10, 'overcast'], [2, null, 'cloudy-sunset'],
  ]) {
    assert.equal(weather.pickScene({ ...current, weather_code, cloud_cover, direct_normal_irradiance_instant: null }, sunsetStart), expected,
      'missing sunlight preserves the original cloud-coverage fallback');
  }
  assert.equal(weather.pickScene({ ...current, cloud_cover: 80 }, sunset), 'overcast-night');
  assert.equal(weather.summarize(current, sunsetStart), 'Currently 58°F and cloudy in San Francisco');
});

test('cloudy-sunset snapshots expire at sunset and cannot extend sunlit clouds into night', () => {
  const during = snapshot(sunset - minute, { weather_code: 2, cloud_cover: 45 });
  const after = snapshot(sunset, { weather_code: 2, cloud_cover: 45, is_day: 1 });
  assert.equal(during.scene, 'cloudy-sunset');
  assert.equal(during.validUntil, sunset);
  assert.equal(validateSnapshot(during, sunset), null);
  assert.equal(after.scene, 'night');
  assert.equal(compareSnapshots(after, during, sunset).shouldDeploy, true);
  assert.equal(validateSnapshot({ ...during, validUntil: sunset + 10 * minute }, sunset), null);
});

test('solar calculations agree with independent USNO SF references across seasons and DST', () => {
  // USNO one-day service, SF 37.7749,-122.4194, rounded to whole minutes.
  // https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=37.7749,-122.4194&tz=-7
  // The compact SunCalc 1.9 approximation differs by up to ~3 minutes; this is
  // a visual lighting cue, not a precision astronomical ephemeris.
  const references = [
    ['2026-03-07', '2026-03-07T14:32Z', '2026-03-08T02:09Z', '2026-03-08T02:36Z'],
    ['2026-03-08', '2026-03-08T14:31Z', '2026-03-09T02:10Z', '2026-03-09T02:37Z'],
    ['2026-03-20', '2026-03-20T14:13Z', '2026-03-21T02:22Z', '2026-03-21T02:48Z'],
    ['2026-06-21', '2026-06-21T12:48Z', '2026-06-22T03:35Z', '2026-06-22T04:06Z'],
    ['2026-09-22', '2026-09-22T13:58Z', '2026-09-23T02:06Z', '2026-09-23T02:32Z'],
    ['2026-10-31', '2026-10-31T14:34Z', '2026-11-01T01:12Z', '2026-11-01T01:39Z'],
    ['2026-11-01', '2026-11-01T14:35Z', '2026-11-02T01:11Z', '2026-11-02T01:38Z'],
    ['2026-12-21', '2026-12-21T15:21Z', '2026-12-22T00:54Z', '2026-12-22T01:24Z'],
  ];
  for (const [date, rise, set, civilDusk] of references) {
    const solar = weather.solarPhase(Date.parse(`${date}T20:00Z`));
    for (const [field, expected] of [['sunrise', rise], ['sunset', set], ['dusk', civilDusk]]) {
      assert.ok(Math.abs(solar[field] - Date.parse(expected)) < 4 * minute, `${date} ${field}`);
    }
    assert.equal(solar.sunsetStart, solar.sunset - 30 * minute);
  }
});

test('solar dates belong to San Francisco even around UTC midnight and host timezone changes', () => {
  for (const date of ['2026-03-08', '2026-06-21', '2026-11-01', '2026-12-21']) {
    const midday = Date.parse(`${date}T20:00Z`);
    const solar = weather.solarPhase(midday);
    const utcNextMidnight = Date.parse(`${date}T00:00Z`) + day;
    assert.equal(weather.solarPhase(utcNextMidnight).sunset, solar.sunset,
      'UTC midnight is still the same SF afternoon');
    for (const boundary of [solar.sunrise, solar.sunsetStart, solar.sunset, solar.dusk]) {
      assert.equal(weather.nextSolarBoundary(boundary - 1), boundary);
      assert.ok(weather.nextSolarBoundary(boundary) > boundary);
    }
    assert.ok(weather.nextSolarBoundary(solar.dusk) <= solar.dusk + day);
  }
  const moduleURL = new URL('../weather.js', import.meta.url).href;
  const script = `await import(${JSON.stringify(moduleURL)}); console.log(JSON.stringify(SFWeather.solarPhase(${sunset})))`;
  const expected = JSON.stringify(weather.solarPhase(sunset));
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland']) {
    const actual = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }).trim();
    assert.equal(actual, expected, TZ);
  }
  for (const invalid of [NaN, Infinity, -Infinity, 'today', null]) assert.throws(() => weather.solarPhase(invalid));
});

test('snapshot validation and deploy comparison cannot carry clear daylight or sunset beyond its phase', () => {
  const clear = { weather_code: 0, cloud_cover: 0 };
  const before = snapshot(sunsetStart - minute, clear);
  const during = snapshot(sunsetStart + minute, clear);
  const lastLight = snapshot(dusk - minute, clear);
  const after = snapshot(dusk + minute, clear);
  assert.equal(before.validUntil, sunsetStart);
  assert.equal(validateSnapshot(before, sunsetStart), null);
  assert.equal(during.scene, 'sunset');
  assert.equal(lastLight.validUntil, dusk);
  assert.equal(validateSnapshot(lastLight, dusk), null);
  assert.equal(after.scene, 'clear-night');
  assert.equal(compareSnapshots(during, before, during.fetchedAt).shouldDeploy, true);
  assert.equal(compareSnapshots(after, lastLight, after.fetchedAt).shouldDeploy, true);
  const uncappedLegacy = { ...before, validUntil: before.fetchedAt + 45 * minute };
  assert.equal(validateSnapshot(uncappedLegacy, sunsetStart), null, 'clock-aware selection rejects old uncapped scenes too');
});

test('provider timestamps allow at most 30 minutes old or 30 seconds ahead at fetch', () => {
  assert.ok(snapshot(noon, { time: seconds(noon - 30 * minute) + 1 }));
  assert.throws(() => snapshot(noon, { time: seconds(noon - 30 * minute) }));
  assert.ok(snapshot(noon, { time: seconds(noon + 30_000) }));
  assert.throws(() => snapshot(noon, { time: seconds(noon - 30 * minute) - 1 }));
  assert.throws(() => snapshot(noon, { time: seconds(noon + 30_000) + 1 }));
  const aged = snapshot(noon - 40 * minute);
  assert.equal(validateSnapshot(aged, noon), null, 'old provider time must expire even if fetched recently');
  assert.equal(validateSnapshot({ ...snapshot(), current: { ...snapshot().current, time: seconds(noon - 31 * minute) } }, noon), null);
});

test('recent fetch cannot extend an older reading beyond its actual freshness limit', () => {
  const result = snapshot(noon, { time: seconds(noon - 20 * minute) });
  assert.equal(result.validUntil, noon + 10 * minute);
  assert.ok(validateSnapshot(result, result.validUntil - 1));
  assert.equal(validateSnapshot(result, result.validUntil), null);
  assert.equal(validateSnapshot({ ...result, validUntil: noon + 30 * minute }, noon), null);
});

test('creation requires two valid chronological solar-day entries', () => {
  const valid = payload();
  for (const daily of [
    undefined, {}, { sunrise: [], sunset: [] },
    { sunrise: valid.daily.sunrise.slice(0, 1), sunset: valid.daily.sunset.slice(0, 1) },
    { ...valid.daily, sunrise: ['14:30', valid.daily.sunrise[1]] },
    { ...valid.daily, sunrise: [valid.daily.sunset[0], valid.daily.sunrise[1]] },
    { ...valid.daily, sunrise: [...valid.daily.sunrise].reverse() },
    { ...valid.daily, sunset: [valid.daily.sunset[0], null] },
  ]) assert.throws(() => createSnapshot({ ...valid, daily }, noon), JSON.stringify(daily));
});

test('validation rejects stale, future, mismatched and malformed snapshots', () => {
  const good = snapshot();
  for (const value of [
    null, [], {}, { ...good, version: 2 },
    { ...good, weatherPolicy: undefined }, { ...good, weatherPolicy: 'old-central-sf-hrrr' },
    { ...good, scene: 'night-rain' }, { ...good, scene: '</script>' },
    { ...good, fetchedAt: noon + minute },
    { ...good, fetchedAt: Number.NaN }, { ...good, fetchedAt: 'now' },
    { ...good, validUntil: noon }, { ...good, validUntil: noon - 1 },
    { ...good, validUntil: noon + 46 * minute },
    { ...good, current: { ...good.current, temperature_2m: '58' } },
  ]) assert.equal(validateSnapshot(value, noon), null, JSON.stringify(value));
  assert.equal(validateSnapshot(good, good.validUntil), null);
  assert.equal(validateSnapshot(good, good.validUntil + 1), null);
  assert.equal(validateSnapshot(good, Number.NaN), null);
});

test('validation preserves optional full source revisions and rejects invalid metadata', () => {
  const good = snapshot();
  assert.ok(validateSnapshot(good, noon));
  assert.ok(!Object.hasOwn(validateSnapshot(good, noon), 'sourceRevision'));
  assert.equal(validateSnapshot({ ...good, sourceRevision: revisionA }, noon).sourceRevision, revisionA);
  assert.equal(validateSnapshot({ ...good, sourceRevision: revisionB.toUpperCase() }, noon).sourceRevision, revisionB);
  for (const sourceRevision of [null, '', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), 123, {}, ` ${revisionA}`, `${revisionA}\n`]) {
    assert.equal(validateSnapshot({ ...good, sourceRevision }, noon), null, JSON.stringify(sourceRevision));
  }
});

test('provider fetch requests Fahrenheit and solar times with an abort signal', async () => {
  const calls = [];
  const result = await fetchSnapshot({
    now: () => noon,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return jsonResponse(payload());
    },
  });
  assert.equal(result.scene, 'cloudy');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, 'api.open-meteo.com');
  assert.equal(calls[0].url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(calls[0].url.searchParams.get('models'), 'ncep_nbm_conus');
  assert.equal(calls[0].url.searchParams.get('cell_selection'), 'nearest');
  assert.equal(calls[0].url.searchParams.get('latitude'), '37.789');
  assert.equal(calls[0].url.searchParams.get('longitude'), '-122.396');
  assert.equal(calls[0].url.searchParams.get('timeformat'), 'unixtime');
  assert.match(calls[0].url.searchParams.get('daily'), /sunrise/);
  assert.match(calls[0].url.searchParams.get('daily'), /sunset/);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('provider fetch rejects network, HTTP, JSON and validation failures', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => jsonResponse({}, 503),
    async () => new Response('not json'),
    async () => jsonResponse({ error: true }),
    async () => jsonResponse(payload(noon, { weather_code: 999 })),
  ]) await assert.rejects(fetchSnapshot({ fetchImpl, now: () => noon }));
});

test('comparison skips unchanged fresh weather and small temperature fluctuations', () => {
  const published = snapshot(noon - 10 * minute);
  for (const temperature_2m of [58.1, 58.2, 58.49]) {
    const candidate = snapshot(noon, { temperature_2m });
    assert.equal(compareSnapshots(candidate, published, noon).shouldDeploy, false);
  }
});

test('comparison deploys meaningful weather changes or aged/invalid published data', () => {
  const published = snapshot(noon - 10 * minute);
  for (const candidate of [
    snapshot(noon, { temperature_2m: 58.5 }),
    snapshot(noon, { weather_code: 1, cloud_cover: 45 }),
    snapshot(noon, { direct_normal_irradiance_instant: 20 }),
    snapshot(noon, { weather_code: 61 }),
  ]) assert.equal(compareSnapshots(candidate, published, noon).shouldDeploy, true);
  for (const old of [null, {}, snapshot(noon - 30 * minute)]) {
    assert.equal(compareSnapshots(snapshot(), old, noon).shouldDeploy, true);
  }
});

test('comparison refuses an invalid candidate regardless of published data', () => {
  for (const candidate of [null, {}, { ...snapshot(), validUntil: noon }]) {
    assert.equal(compareSnapshots(candidate, snapshot(), noon).shouldDeploy, false);
  }
});

test('comparison deploys source changes even when weather is unchanged', () => {
  const candidate = { ...snapshot(), sourceRevision: revisionB };
  for (const published of [snapshot(noon - 10 * minute), { ...snapshot(noon - 10 * minute), sourceRevision: revisionA }]) {
    assert.deepEqual(compareSnapshots(candidate, published, noon), { shouldDeploy: true, reason: 'source-changed' });
  }
  assert.equal(compareSnapshots(candidate, { ...snapshot(noon - 10 * minute), sourceRevision: revisionB }, noon).shouldDeploy, false);
  assert.equal(compareSnapshots(snapshot(), { ...snapshot(noon - 10 * minute), sourceRevision: revisionA }, noon).shouldDeploy, false,
    'candidates without source metadata keep backward-compatible weather-only decisions');
});

test('check writes candidate JSON and GitHub output without unnecessary deploys', async t => {
  const directory = await temporary(t);
  const output = path.join(directory, 'candidate.json');
  const githubOutput = path.join(directory, 'github-output.txt');
  await writeFile(githubOutput, 'existing=value\n');
  const publishedURL = 'https://example.test/weather-snapshot.json';
  const calls = [];
  const result = await check({ output, githubOutput, publishedURL, sourceRevision: null, now: () => noon,
    fetchImpl: async url => {
      calls.push(String(url));
      return jsonResponse(String(url).startsWith(publishedURL) ? snapshot(noon - 10 * minute) : payload());
    },
  });
  assert.equal(result.shouldDeploy, false);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).scene, 'cloudy');
  assert.match(await readFile(githubOutput, 'utf8'), /^existing=value\n[\s\S]*should_deploy=false/m);
  assert.equal(calls.filter(url => new URL(url).hostname === 'api.open-meteo.com').length, 1);
  assert.equal(calls.filter(url => url.startsWith(publishedURL)).length, 1);
});

test('check fails closed on scheduled provider failure and supports forced code deploys', async t => {
  const directory = await temporary(t);
  for (const force of [false, true]) {
    const output = path.join(directory, `candidate-${force}.json`);
    const githubOutput = path.join(directory, `github-${force}.txt`);
    const calls = [];
    const result = await check({ output, githubOutput, force, sourceRevision: revisionB, now: () => noon,
      fetchImpl: async url => { calls.push(String(url)); throw new Error('offline'); },
    });
    assert.equal(result.shouldDeploy, force);
    assert.equal(result.snapshot, null);
    assert.equal(result.reason, force ? 'forced-with-live-fallback' : 'provider-unavailable');
    assert.equal(calls.length, force ? 2 : 1);
    assert.equal(calls.filter(url => new URL(url).hostname === 'api.open-meteo.com').length, 1);
    assert.equal(JSON.parse(await readFile(output, 'utf8')), null);
    assert.match(await readFile(githubOutput, 'utf8'), new RegExp(`should_deploy=${force}`));
  }
});

test('check deploys a valid candidate if the published snapshot is unavailable', async t => {
  const directory = await temporary(t);
  for (const failure of ['http', 'json', 'stale']) {
    const result = await check({ output: path.join(directory, `${failure}.json`), sourceRevision: null, githubOutput: null, now: () => noon,
      fetchImpl: async url => {
        if (new URL(url).hostname === 'api.open-meteo.com') return jsonResponse(payload());
        if (failure === 'http') return jsonResponse({}, 404);
        if (failure === 'json') return new Response('invalid json');
        return jsonResponse({ ...snapshot(), validUntil: noon - 1 });
      },
    });
    assert.equal(result.shouldDeploy, true, failure);
    assert.equal(result.snapshot.scene, 'cloudy');
  }
});

test('check uses the workflow revision by default and allows explicit metadata opt-out', async t => {
  const directory = await temporary(t);
  const before = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = revisionB.toUpperCase();
  try {
    for (const optOut of [false, true]) {
      const output = path.join(directory, `revision-${optOut}.json`);
      const result = await check({ output, githubOutput: null, now: () => noon,
        ...(optOut ? { sourceRevision: null } : {}),
        fetchImpl: async url => jsonResponse(new URL(url).hostname === 'api.open-meteo.com'
          ? payload() : { ...snapshot(noon - 10 * minute), sourceRevision: revisionA }),
      });
      assert.equal(result.shouldDeploy, !optOut);
      assert.equal(result.reason, optOut ? 'weather-unchanged' : 'source-changed');
      const written = JSON.parse(await readFile(output, 'utf8'));
      if (optOut) assert.ok(!Object.hasOwn(written, 'sourceRevision'));
      else assert.equal(written.sourceRevision, revisionB);
    }
  } finally {
    if (before === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = before;
  }
});

test('forced provider outage reuses valid published weather without extending its lifetime', async t => {
  const directory = await temporary(t);
  const published = { ...snapshot(noon - 25 * minute), sourceRevision: revisionA };
  const output = path.join(directory, 'forced-candidate.json');
  const githubOutput = path.join(directory, 'github-output.txt');
  const calls = [];
  const result = await check({ output, githubOutput, force: true, sourceRevision: revisionB, now: () => noon,
    fetchImpl: async url => {
      calls.push(String(url));
      if (new URL(url).hostname === 'api.open-meteo.com') throw new Error('provider unavailable');
      return jsonResponse(published);
    },
  });
  assert.equal(result.shouldDeploy, true);
  assert.equal(result.reason, 'forced-with-cached-snapshot');
  assert.deepEqual(result.snapshot, { ...published, sourceRevision: revisionB });
  assert.equal(result.snapshot.fetchedAt, noon - 25 * minute);
  assert.equal(result.snapshot.validUntil, noon + 5 * minute);
  assert.equal(validateSnapshot(result.snapshot, noon + 5 * minute), null);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { ...published, sourceRevision: revisionB });
  assert.match(await readFile(githubOutput, 'utf8'), /should_deploy=true\nreason=forced-with-cached-snapshot/);
  assert.equal(calls.length, 2);
});

test('forced provider outage falls back to live startup when published weather is invalid', async t => {
  const directory = await temporary(t);
  for (const [index, published] of [null, {}, { ...snapshot(), validUntil: noon }, { ...snapshot(), sourceRevision: 'invalid' },
    { ...snapshot(), weatherPolicy: undefined }, { ...snapshot(), weatherPolicy: 'old-central-sf-hrrr' }].entries()) {
    const output = path.join(directory, `invalid-cache-${index}.json`);
    const result = await check({ output, githubOutput: null, force: true, sourceRevision: revisionB, now: () => noon,
      fetchImpl: async url => {
        if (new URL(url).hostname === 'api.open-meteo.com') return jsonResponse({}, 503);
        return jsonResponse(published);
      },
    });
    assert.equal(result.shouldDeploy, true);
    assert.equal(result.reason, 'forced-with-live-fallback');
    assert.equal(result.snapshot, null);
    assert.equal(JSON.parse(await readFile(output, 'utf8')), null);
  }
});

async function buildFixture(t) {
  const directory = await temporary(t);
  const sourceRoot = path.join(directory, 'source');
  const output = path.join(directory, 'site');
  const snapshotPath = path.join(directory, 'candidate.json');
  await mkdir(sourceRoot);
  const files = {
    'index.html': `<!doctype html><html><head>
      <script src="./weather.js?v=test" async data-weather-startup></script>
      <link rel="stylesheet" href="./style.css?v=test" />
      </head><body>
      <noscript><img class="scene-poster" src="./assets/generic-full.webp" alt="Generic cloudy fallback"></noscript>
      ${sceneCases.map(([scene]) => `<div class="scene-layer scene-${scene}" data-scene="${scene}" aria-hidden="true">${scene.includes('fog') ? '<div class="fog-atmosphere">' : ''}<img class="scene-poster" data-preview="./assets/${scene}.preview.webp" alt=""><video hidden></video>${scene.includes('fog') ? '</div>' : ''}</div>`).join('\n')}
      <!-- WEATHER_STARTUP -->
      </body></html>`,
    'weather.js': 'globalThis.fixtureWeatherLoaded = true; // </script> must remain inside script\n',
    'startup.js': 'globalThis.fixtureStartupLoaded = true;\n',
    'sky.js': `const scenes = {\n${sceneCases.map(([scene]) => `    '${scene}': { title: '${scene}', src: './assets/${scene}.mp4?v=1', webmSrc: './assets/${scene}.webm?v=1', rate: 0.75 },`).join('\n')}\n};\n`,
    'style.css': `body { margin: 0; }\n/* Literal replacement characters: $& $' */\n.scene-layer { opacity: 0; }\n${sceneCases.map(([scene]) => `:root[data-scene="${scene}"] .scene-${scene} { opacity: 1; }`).join('\n')}\n:root[data-instant-switch="true"] .scene-layer { transition: none; }`,
    'preview.html': '<title>Local weather gallery</title>',
    'preview.js': 'globalThis.localWeatherGallery = true;',
    'preview-player.html': '<title>Social video preview</title>',
    'preview-player.js': 'globalThis.socialVideoPreview = true;',
    'favicon.svg': '<svg/>',
    'og.png': 'social-preview',
    'CNAME': 'chrisshu.com\n',
    '.nojekyll': '',
    'robots.txt': 'User-agent: *',
    'sitemap.xml': '<urlset/>',
    'README.md': 'Not deployment content',
    'package.json': '{}',
    '.env': 'PRIVATE=do-not-copy',
    '.private.js': 'DO_NOT_PUBLISH',
    'scripts/private.js': 'DO_NOT_PUBLISH',
    'tests/private.js': 'DO_NOT_PUBLISH',
    '.git/config': 'DO_NOT_PUBLISH',
    '.github/workflows/private.yml': 'DO_NOT_PUBLISH',
    'hosting/private.conf': 'DO_NOT_PUBLISH',
    'edge/private.js': 'DO_NOT_PUBLISH',
    'assets/nested/extra.txt': 'asset',
    'assets/generic-full.webp': 'generic-cloudy-fallback',
    'assets/.secret.txt': 'DO_NOT_PUBLISH',
    'vendor/package/index.js': 'export default true;',
    'licenses/vendor.txt': 'License text',
  };
  for (const [scene] of sceneCases) {
    files[`assets/${scene}.preview.webp`] = `fixture-poster:${scene}`;
    files[`assets/${scene}.mp4`] = `fixture-video:${scene}`;
    files[`assets/${scene}.webm`] = `fixture-video:${scene}`;
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(sourceRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await writeFile(snapshotPath, JSON.stringify(snapshot()));
  return { directory, sourceRoot, output, snapshotPath, files };
}

async function recordingFixture(t) {
  const fixture = await buildFixture(t);
  const config = { src: './assets/recording-v137.mp4', mobileSrc: './assets/recording-mobile-v137.mp4',
    poster: './assets/recording-poster-v137.webp', preview: './assets/recording-preview-v137.webp' };
  const recording = `<div class="scene-layer scene-recording" data-scene="recording" aria-hidden="true"><img class="scene-poster" data-src="${config.poster}" data-preview="${config.preview}" alt=""><video hidden></video></div>
      <script type="application/json" id="recording-media">${JSON.stringify(config)}</script>
      <script src="./recording.js?v=137" data-recording-player></script>`;
  fixture.files['index.html'] = fixture.files['index.html']
    .replace('<html>', '<html data-background="weather">')
    .replace('<!-- WEATHER_STARTUP -->', `${recording}\n<!-- WEATHER_STARTUP -->`);
  fixture.files['recording.js'] = 'globalThis.fixtureRecordingLoaded = true; // </script> stays in the player\n';
  for (const [key, url] of Object.entries(config)) fixture.files[url.slice(2)] = `fixture-recording:${key}`;
  for (const relative of ['index.html', 'recording.js', ...Object.values(config).map(url => url.slice(2))]) {
    await writeFile(path.join(fixture.sourceRoot, relative), fixture.files[relative]);
  }
  return { ...fixture, config };
}

function embeddedJSON(html, id) {
  const body = new RegExp(`<script\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/script>`).exec(html)?.[1];
  return body === undefined ? undefined : JSON.parse(body);
}

function attributes(tag) {
  const result = {};
  for (const match of tag.replace(/^<\w+\b/, '').matchAll(/([\w:-]+)(?:\s*=\s*(["'])(.*?)\2)?/g)) {
    result[match[1]] = match[3] ?? true;
  }
  return result;
}

function sceneMarkup(html, scene) {
  const layer = new RegExp(`(<div\\b[^>]*\\bclass="[^"]*\\bscene-layer\\b[^"]*"[^>]*\\bdata-scene="${scene}"[^>]*>)([\\s\\S]*?)<video\\b`).exec(html);
  assert.ok(layer, `scene-layer for ${scene} exists`);
  const poster = /<img\b[^>]*\bclass="[^"]*\bscene-poster\b[^"]*"[^>]*>/.exec(layer[2]);
  assert.ok(poster, `scene-poster for ${scene} exists`);
  return { layer: attributes(layer[1]), poster: attributes(poster[0]) };
}

function assertInlineStyles(html, css) {
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]);
  assert.ok(styles.some(style => style.trim() === css.trim()), 'full CSS is inline');
  assert.doesNotMatch(html, /<link\b[^>]*\bhref="[^" ]*style\.css(?:\?[^" ]*)?"/);
}

async function fileList(directory, prefix = '') {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, item.name);
    if (item.isDirectory()) result.push(...await fileList(path.join(directory, item.name), relative));
    else result.push(relative);
  }
  return result.sort();
}

test('build makes each selected scene visible without JavaScript and inlines one poster plus CSS', async t => {
  const fixture = await buildFixture(t);
  for (const [scene, now, overrides] of sceneCases) {
    const candidate = { ...snapshot(now, overrides), sourceRevision: revisionB };
    await writeFile(fixture.snapshotPath, JSON.stringify(candidate));
    const result = await build({ ...fixture, now });
    const html = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
    assert.equal(result.snapshot.scene, scene);
    assert.deepEqual(embeddedJSON(html, 'initial-weather'), candidate);
    const media = embeddedJSON(html, 'initial-media');
    assert.deepEqual(media, { scene, src: `./assets/${scene}.mp4?v=1`, webmSrc: `./assets/${scene}.webm?v=1`, rate: 0.75 });
    const root = attributes(/<html\b[^>]*>/.exec(html)[0]);
    assert.equal(root['data-scene'], scene);
    assert.equal(root['data-instant-switch'], 'true');
    for (const [key] of sceneCases) {
      const markup = sceneMarkup(html, key);
      assert.equal(markup.layer['aria-hidden'], key === scene ? 'false' : 'true', key);
      if (key === scene) {
        assert.equal(markup.poster.src, `data:image/webp;base64,${Buffer.from(`fixture-poster:${scene}`).toString('base64')}`);
        assert.ok(Object.hasOwn(markup.poster, 'data-initial-poster'));
        assert.equal(markup.poster.fetchpriority, 'high');
      } else {
        assert.ok(!Object.hasOwn(markup.poster, 'src'), `inactive ${key} has no image request`);
        assert.ok(!Object.hasOwn(markup.poster, 'data-initial-poster'));
      }
    }
    assertInlineStyles(html, fixture.files['style.css']);
    assert.equal((html.match(/data:image\/webp;base64,/g) || []).length, 1);
    assert.equal((html.match(/\sdata-initial-poster(?:[\s=>])/g) || []).length, 1);
    assert.doesNotMatch(html, /generic-full\.webp/, 'the generic noscript image cannot cover the selected scene');
    assert.ok(html.indexOf('id="initial-weather"') < html.indexOf('fixtureWeatherLoaded'));
    assert.ok(html.indexOf('id="initial-media"') < html.indexOf('fixtureWeatherLoaded'));
    assert.ok(html.indexOf('fixtureWeatherLoaded') < html.indexOf('fixtureStartupLoaded'));
    assert.doesNotMatch(html, /<script\b[^>]*src="[^" ]*weather\.js/);
    assert.doesNotMatch(html, /<!-- WEATHER_STARTUP -->/);
    assert.match(html, /<\\\/script> must remain inside script/);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.output, 'weather-snapshot.json'), 'utf8')), candidate);
  }
  assert.equal(await readFile(path.join(fixture.sourceRoot, 'index.html'), 'utf8'), fixture.files['index.html']);
});

test('build omits stale or invalid inline weather while keeping the live startup fallback', async t => {
  const fixture = await buildFixture(t);
  for (const candidate of [null, {}, { ...snapshot(), validUntil: noon }, { ...snapshot(), scene: 'rain' }]) {
    await writeFile(fixture.snapshotPath, JSON.stringify(candidate));
    const result = await build({ ...fixture, now: noon });
    const html = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
    assert.equal(result.snapshot, null);
    assert.equal(embeddedJSON(html, 'initial-weather'), undefined);
    assert.equal(embeddedJSON(html, 'initial-media'), undefined);
    const root = attributes(/<html\b[^>]*>/.exec(html)[0]);
    assert.ok(!Object.hasOwn(root, 'data-scene'));
    assert.ok(!Object.hasOwn(root, 'data-instant-switch'));
    assert.doesNotMatch(html, /data:image\/webp;base64,|\sdata-initial-poster(?:[\s=>])/);
    assertInlineStyles(html, fixture.files['style.css']);
    assert.match(html, /<noscript>[\s\S]*?generic-full\.webp[\s\S]*?<\/noscript>/);
    for (const [scene] of sceneCases) assert.ok(!Object.hasOwn(sceneMarkup(html, scene).poster, 'src'));
    assert.match(html, /<script data-weather-startup>/);
    assert.match(html, /fixtureWeatherLoaded/);
    assert.match(html, /fixtureStartupLoaded/);
    assert.equal(JSON.parse(await readFile(path.join(fixture.output, 'weather-snapshot.json'), 'utf8')), null);
  }
});

test('weather startup stays selected while the optional lake recording remains unrequested', async t => {
  const fixture = await recordingFixture(t);
  for (const candidate of [null, {}, { ...snapshot(), validUntil: noon }, snapshot(), snapshot(noon, { weather_code: 61 })]) {
    await writeFile(fixture.snapshotPath, JSON.stringify(candidate));
    const result = await build({ ...fixture, now: noon });
    const html = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
    const expectedWeather = validateSnapshot(candidate, noon);
    assert.equal(result.snapshot?.scene ?? null, expectedWeather?.scene ?? null);
    assert.deepEqual(embeddedJSON(html, 'initial-weather'), expectedWeather ?? undefined);
    assert.deepEqual(embeddedJSON(html, 'recording-media'), fixture.config);
    assert.equal(embeddedJSON(html, 'initial-media')?.scene, expectedWeather?.scene);
    const root = attributes(/<html\b[^>]*>/.exec(html)[0]);
    assert.equal(root['data-background'], 'weather');
    assert.equal(root['data-scene'], expectedWeather?.scene);
    const lake = sceneMarkup(html, 'recording');
    assert.equal(lake.layer['aria-hidden'], 'true');
    assert.ok(!Object.hasOwn(lake.poster, 'src'), 'the lake poster must not be requested before selection');
    assert.ok(!Object.hasOwn(lake.poster, 'data-initial-poster'));
    assert.equal((html.match(/data:image\/webp;base64,/g) || []).length, expectedWeather ? 1 : 0);
    for (const [scene] of sceneCases) {
      const weatherMarkup = sceneMarkup(html, scene);
      assert.equal(weatherMarkup.layer['aria-hidden'], scene === expectedWeather?.scene ? 'false' : 'true');
      if (scene === expectedWeather?.scene) {
        assert.equal(weatherMarkup.poster.src, `data:image/webp;base64,${Buffer.from(`fixture-poster:${scene}`).toString('base64')}`);
      } else assert.ok(!Object.hasOwn(weatherMarkup.poster, 'src'), `no request for inactive ${scene} poster`);
    }
    assert.match(html, /<script src="\.\/recording\.js\?v=137" data-recording-player><\/script>/);
    assert.match(html, /<script data-initial-scene>[\s\S]*?fixtureStartupLoaded/);
    assert.doesNotMatch(html, /fixtureRecordingLoaded|\s(?:src|href|poster)="\.\/assets\/recording|<!-- WEATHER_STARTUP -->/);
    assert.ok(html.indexOf('fixtureWeatherLoaded') < html.indexOf('fixtureStartupLoaded'));
    assertInlineStyles(html, fixture.files['style.css']);
    assert.equal(await readFile(path.join(fixture.output, 'recording.js'), 'utf8'), fixture.files['recording.js']);
    for (const [key, url] of Object.entries(fixture.config)) {
      assert.equal(await readFile(path.join(fixture.output, url), 'utf8'), `fixture-recording:${key}`);
    }
  }
});

test('optional lake media paths and preview size are validated even without a weather snapshot', async t => {
  const fixture = await recordingFixture(t);
  await writeFile(fixture.snapshotPath, 'null');
  await build({ ...fixture, now: noon });
  const previous = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
  for (const key of ['src', 'mobileSrc', 'poster', 'preview']) {
    for (const value of ['./assets/../../secret.webp', 'https://example.test/secret.webp', '//example.test/secret.webp', null]) {
      const invalid = { ...fixture.config, [key]: value };
      await writeFile(path.join(fixture.sourceRoot, 'index.html'),
        fixture.files['index.html'].replace(JSON.stringify(fixture.config), JSON.stringify(invalid)));
      await assert.rejects(build({ ...fixture, now: noon }), /local assets|escapes assets|Incomplete recording/);
      assert.equal(await readFile(path.join(fixture.output, 'index.html'), 'utf8'), previous);
    }
  }
  await writeFile(path.join(fixture.sourceRoot, 'index.html'), fixture.files['index.html']);
  await writeFile(path.join(fixture.sourceRoot, fixture.config.preview), Buffer.alloc(100001));
  await assert.rejects(build({ ...fixture, now: noon }), /preview is unexpectedly large/);
  assert.equal(await readFile(path.join(fixture.output, 'index.html'), 'utf8'), previous);
});

test('optional lake player rejects linked assets and incomplete configuration or player markup', async t => {
  const fixture = await recordingFixture(t);
  const secret = path.join(fixture.directory, 'outside.txt');
  await writeFile(secret, 'DO_NOT_PUBLISH');
  for (const url of [...Object.values(fixture.config), './recording.js']) {
    const relative = url.slice(2), target = path.join(fixture.sourceRoot, relative);
    await rm(target);
    await symlink(secret, target);
    await assert.rejects(build({ ...fixture, now: noon }), /symbolic link/);
    await rm(target);
    await writeFile(target, fixture.files[relative]);
  }
  const original = fixture.files['index.html'];
  const configTag = /<script type="application\/json" id="recording-media">[\s\S]*?<\/script>/.exec(original)[0];
  const playerTag = '<script src="./recording.js?v=137" data-recording-player></script>';
  for (const html of [
    original.replace(configTag, ''), original.replace(configTag, configTag + configTag),
    original.replace('type="application/json" id="recording-media"', 'type="text/javascript" id="recording-media"'),
    original.replace(JSON.stringify(fixture.config), '{invalid json}'),
    original.replace(playerTag, ''), original.replace(playerTag, playerTag + playerTag),
    original.replace('./recording.js?v=137', 'https://example.test/recording.js'),
    original.replace(JSON.stringify(fixture.config), JSON.stringify({ ...fixture.config, unexpected: {} })),
    original.replace(playerTag, playerTag.replace('</script>', 'unexpectedInlinePlayer()</script>')),
  ]) {
    await writeFile(path.join(fixture.sourceRoot, 'index.html'), html);
    await assert.rejects(build({ ...fixture, now: noon }));
  }
});

test('a missing optional lake asset cannot replace the last valid weather build', async t => {
  const fixture = await recordingFixture(t);
  await build({ ...fixture, now: noon });
  const previous = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
  for (const url of [...Object.values(fixture.config), './recording.js']) {
    const target = path.join(fixture.sourceRoot, url);
    const content = await readFile(target);
    await rm(target);
    await assert.rejects(build({ ...fixture, now: noon }), /ENOENT/);
    assert.equal(await readFile(path.join(fixture.output, 'index.html'), 'utf8'), previous);
    await writeFile(target, content);
  }
});

test('build safely handles closing-style text without allowing HTML to escape the inline CSS', async t => {
  const fixture = await buildFixture(t);
  await build({ ...fixture, now: noon });
  const previous = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
  const css = '/* </StYlE><script id="css-breakout">unsafe()</script> */\nbody { margin: 0; }';
  await writeFile(path.join(fixture.sourceRoot, 'style.css'), css);
  let error;
  try { await build({ ...fixture, now: noon }); }
  catch (caught) { error = caught; }
  if (error) {
    assert.match(error.message, /style|css|unsafe|inline/i);
    assert.equal(await readFile(path.join(fixture.output, 'index.html'), 'utf8'), previous);
  } else {
    const html = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
    const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
    assert.equal(styles.length, 1);
    assert.match(styles[0][1], /css-breakout/);
    assert.match(styles[0][1], /body \{ margin: 0; \}/, 'CSS stays inside its style element after the dangerous text');
    const outsideStyles = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    assert.doesNotMatch(outsideStyles, /css-breakout/);
  }
});

test('malformed scene, poster or stylesheet markup cannot replace a prior successful build', async t => {
  const fixture = await buildFixture(t);
  await build({ ...fixture, now: noon });
  const previous = await readFile(path.join(fixture.output, 'index.html'), 'utf8');
  const sentinel = path.join(fixture.output, 'preserve.txt');
  await writeFile(sentinel, 'untouched');
  const original = fixture.files['index.html'];
  const selectedLayer = /<div class="scene-layer scene-cloudy"[^>]*>[\s\S]*?<\/div>/.exec(original)[0];
  const variants = [
    original.replace('<html>', ''),
    original.replace(/<link rel="stylesheet"[^>]*>/, ''),
    original.replace('<!-- WEATHER_STARTUP -->', ''),
    original.replace('class="scene-layer scene-cloudy"', 'class="missing-layer"'),
    original.replace(selectedLayer, selectedLayer.replace('class="scene-poster"', 'class="missing-poster"')),
    original.replace('data-scene="cloudy"', 'data-scene="missing"'),
    original.replace(selectedLayer, `${selectedLayer}${selectedLayer}`),
    original.replace('<html>', '<html><html>'),
    original.replace('<link rel="stylesheet" href="./style.css?v=test" />', '<link rel="stylesheet" href="./style.css?v=test" /><link rel="stylesheet" href="./style.css?v=duplicate" />'),
  ];
  for (const [index, html] of variants.entries()) {
    await writeFile(path.join(fixture.sourceRoot, 'index.html'), html);
    await assert.rejects(build({ ...fixture, now: noon }), `malformed fixture ${index}`);
    assert.equal(await readFile(path.join(fixture.output, 'index.html'), 'utf8'), previous, `fixture ${index}`);
    assert.equal(await readFile(sentinel, 'utf8'), 'untouched');
  }
});

test('build copies only deployable files and reports actual output size', async t => {
  const fixture = await buildFixture(t);
  const secret = path.join(fixture.directory, 'outside-secret.txt');
  await writeFile(secret, 'DO_NOT_PUBLISH');
  await symlink(secret, path.join(fixture.sourceRoot, 'assets', 'linked-secret.txt'));
  const result = await build({ ...fixture, now: noon });
  const files = await fileList(fixture.output);
  for (const relative of ['CNAME', '.nojekyll', 'robots.txt', 'sitemap.xml', 'style.css',
    'preview-player.html', 'preview-player.js', 'favicon.svg', 'og.png', 'assets/nested/extra.txt', 'vendor/package/index.js', 'licenses/vendor.txt']) {
    assert.ok(files.includes(relative), relative);
  }
  for (const relative of ['README.md', 'package.json', '.env', '.private.js', 'scripts/private.js',
    'tests/private.js', '.git/config', '.github/workflows/private.yml', 'hosting/private.conf',
    'edge/private.js', 'assets/.secret.txt', 'assets/linked-secret.txt', 'preview.html', 'preview.js']) {
    assert.ok(!files.includes(relative), `must exclude ${relative}`);
  }
  const sizes = await Promise.all(files.map(async relative => {
    const info = await lstat(path.join(fixture.output, relative));
    assert.ok(!info.isSymbolicLink());
    return info.size;
  }));
  assert.equal(result.files, files.length);
  assert.equal(result.bytes, sizes.reduce((sum, bytes) => sum + bytes, 0));
});

test('build does not replace an unrelated nonempty output or the source tree', async t => {
  const fixture = await buildFixture(t);
  await mkdir(fixture.output);
  await writeFile(path.join(fixture.output, 'keep.txt'), 'keep');
  await assert.rejects(build({ ...fixture, now: noon }), /non-build output/);
  assert.equal(await readFile(path.join(fixture.output, 'keep.txt'), 'utf8'), 'keep');
  for (const output of [fixture.sourceRoot, fixture.directory]) {
    await assert.rejects(build({ ...fixture, output, now: noon }), /source directory/);
  }
  assert.equal(await readFile(path.join(fixture.sourceRoot, 'index.html'), 'utf8'), fixture.files['index.html']);
});

test('build refuses unsafe selected-media paths before touching prior output', async t => {
  const fixture = await buildFixture(t);
  for (const preview of ['./assets/../../secret.webp', 'https://example.test/secret.webp', '//example.test/secret.webp']) {
    await writeFile(path.join(fixture.sourceRoot, 'index.html'),
      fixture.files['index.html'].replace('./assets/cloudy.preview.webp', preview));
    await assert.rejects(build({ ...fixture, now: noon }), /local assets|escapes assets/);
  }
});

test('build refuses output nested inside copied asset, vendor or license trees', async t => {
  const fixture = await buildFixture(t);
  for (const relative of ['assets', 'assets/build', 'vendor/build', 'licenses/build']) {
    await assert.rejects(build({ ...fixture, output: path.join(fixture.sourceRoot, relative), now: noon }));
  }
  assert.equal(await readFile(path.join(fixture.sourceRoot, 'assets/cloudy.preview.webp'), 'utf8'), 'fixture-poster:cloudy');
});

test('build rejects selected media through symlinks and never copies linked source trees', async t => {
  const fixture = await buildFixture(t);
  const outside = path.join(fixture.directory, 'outside');
  await mkdir(outside);
  const secret = path.join(outside, 'secret.webp');
  await writeFile(secret, 'DO_NOT_PUBLISH');
  const preview = path.join(fixture.sourceRoot, 'assets/cloudy.preview.webp');
  await rm(preview);
  await symlink(secret, preview);
  await assert.rejects(build({ ...fixture, now: noon }));
  await rm(preview);
  await writeFile(preview, 'fixture-poster:cloudy');
  await rm(path.join(fixture.sourceRoot, 'vendor'), { recursive: true });
  await symlink(outside, path.join(fixture.sourceRoot, 'vendor'));
  let refused = false;
  try { await build({ ...fixture, now: noon }); }
  catch { refused = true; }
  if (!refused) {
    const files = await fileList(fixture.output);
    assert.ok(!files.some(file => file.startsWith('vendor/')), 'linked source tree must not be copied');
  }
});

test('build refuses missing or oversized media and missing startup markers', async t => {
  const fixture = await buildFixture(t);
  await writeFile(path.join(fixture.sourceRoot, 'assets/cloudy.preview.webp'), Buffer.alloc(100001));
  await assert.rejects(build({ ...fixture, now: noon }), /unexpectedly large/);
  await writeFile(path.join(fixture.sourceRoot, 'assets/cloudy.preview.webp'), 'small');
  await rm(path.join(fixture.sourceRoot, 'assets/cloudy.webm'));
  await assert.rejects(build({ ...fixture, now: noon }), /ENOENT/);
  await writeFile(path.join(fixture.sourceRoot, 'index.html'), fixture.files['index.html'].replace('<!-- WEATHER_STARTUP -->', ''));
  await assert.rejects(build({ ...fixture, now: noon }), /WEATHER_STARTUP/);
  await writeFile(path.join(fixture.sourceRoot, 'index.html'), fixture.files['index.html'].replace(/<script src="\.\/weather[^>]*><\/script>/, ''));
  await assert.rejects(build({ ...fixture, now: noon }), /external weather\.js/);
});
