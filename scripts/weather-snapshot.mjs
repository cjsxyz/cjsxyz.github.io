import { readFile, writeFile, appendFile, mkdir, readdir, copyFile, rm, stat, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../weather.js';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const weather = globalThis.SFWeather;
const MINUTE = 60000;
export const MAX_SNAPSHOT_AGE = 30 * MINUTE;
export const REFRESH_DEPLOY_AGE = 15 * MINUTE;
export const MAX_PROVIDER_AGE = 30 * MINUTE;
const BUILD_MARKER = '.weather-snapshot-build';
const revisionPattern = /^[a-f0-9]{40}$/i;

export function validateSnapshot(value, now = Date.now()) {
  try {
    if (!value || value.version !== 1 || value.weatherPolicy !== weather.policyId || !Number.isFinite(now)
      || !Number.isFinite(value.fetchedAt) || value.fetchedAt <= 0 || value.fetchedAt > now
      || !Number.isFinite(value.validUntil) || value.validUntil <= now
      || value.validUntil > value.fetchedAt + MAX_SNAPSHOT_AGE
      || value.validUntil > value.current?.time * 1000 + weather.maxWeatherAge) return null;
    const current = weather.normalize(value.current);
    const providerAgeAtFetch = value.fetchedAt - current.time * 1000;
    if (providerAgeAtFetch < -30000 || providerAgeAtFetch > MAX_PROVIDER_AGE || !weather.isFresh(current, now)) return null;
    const scene = weather.pickScene(current);
    if (value.scene !== scene) return null;
    if (value.sourceRevision !== undefined && (typeof value.sourceRevision !== 'string' || !revisionPattern.test(value.sourceRevision))) return null;
    return { version: 1, weatherPolicy: weather.policyId, current, fetchedAt: value.fetchedAt, validUntil: value.validUntil, scene,
      ...(value.sourceRevision === undefined ? {} : { sourceRevision: value.sourceRevision.toLowerCase() }) };
  } catch {
    return null;
  }
}

export function createSnapshot(payload, now = Date.now()) {
  if (!payload || payload.error || !Number.isFinite(now)) throw new TypeError('Invalid weather response');
  const current = weather.normalize(payload.current);
  const providerAge = now - current.time * 1000;
  if (providerAge < -30000 || providerAge > MAX_PROVIDER_AGE || !weather.isFresh(current, now)) {
    throw new Error('Provider current weather is outside the snapshot freshness window');
  }
  const rises = payload.daily?.sunrise, sets = payload.daily?.sunset;
  if (!Array.isArray(rises) || !Array.isArray(sets) || rises.length < 2 || sets.length !== rises.length) {
    throw new TypeError('Two days of sunrise and sunset times are required');
  }
  const days = rises.map((rise, index) => {
    const set = sets[index];
    if (!Number.isSafeInteger(rise) || !Number.isSafeInteger(set) || rise <= 0 || rise >= set
      || (index > 0 && rise <= sets[index - 1])) throw new TypeError('Invalid sunrise/sunset order');
    return { rise: rise * 1000, set: set * 1000 };
  });
  if (days[0].rise > now + 24 * 60 * MINUTE || days.at(-1).set < now) {
    throw new Error('Sunrise/sunset dates do not cover the current time');
  }
  const boundaries = days.flatMap(day => [day.rise, day.set]);
  const nextBoundary = boundaries.find(time => time > now);
  if (!nextBoundary) throw new Error('No future sunrise/sunset boundary');
  // Current provider readings are time-bucketed. Use today's astronomical
  // boundary to avoid carrying a preceding day/night phase across that edge.
  current.is_day = days.some(day => now >= day.rise && now < day.set) ? 1 : 0;
  const candidate = {
    version: 1, weatherPolicy: weather.policyId, current, fetchedAt: now,
    validUntil: Math.min(now + MAX_SNAPSHOT_AGE, current.time * 1000 + weather.maxWeatherAge, nextBoundary),
    scene: weather.pickScene(current),
  };
  const snapshot = validateSnapshot(candidate, now);
  if (!snapshot) throw new Error('Unable to form a valid weather snapshot');
  return snapshot;
}

async function requestJSON(url, fetchImpl, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit',
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSnapshot({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const endpoint = new URL(weather.endpoint);
  endpoint.searchParams.set('daily', 'sunrise,sunset');
  endpoint.searchParams.set('forecast_days', '2');
  const payload = await requestJSON(endpoint.href, fetchImpl);
  return createSnapshot(payload, now());
}

export function compareSnapshots(candidate, published, now = Date.now()) {
  const next = validateSnapshot(candidate, now);
  if (!next) return { shouldDeploy: false, reason: 'provider-unavailable' };
  const previous = validateSnapshot(published, now);
  if (!previous) return { shouldDeploy: true, reason: 'missing-or-expired-published-snapshot' };
  // A scheduled run can replace a queued push in GitHub's concurrency group.
  // The latest source must still publish even when the weather is unchanged.
  if (next.sourceRevision && next.sourceRevision !== previous.sourceRevision) return { shouldDeploy: true, reason: 'source-changed' };
  const rounded = value => value === null ? null : Math.round(value);
  if (next.scene !== previous.scene
    || rounded(next.current.temperature_2m) !== rounded(previous.current.temperature_2m)
    || next.current.weather_code !== previous.current.weather_code
    || next.current.is_day !== previous.current.is_day) return { shouldDeploy: true, reason: 'weather-changed' };
  if (now - previous.fetchedAt >= REFRESH_DEPLOY_AGE) return { shouldDeploy: true, reason: 'snapshot-refresh-due' };
  return { shouldDeploy: false, reason: 'weather-unchanged' };
}

export async function check({ output, force = false, fetchImpl = fetch, now = () => Date.now(),
  publishedURL = 'https://chrisshu.com/weather-snapshot.json', githubOutput = process.env.GITHUB_OUTPUT,
  sourceRevision = process.env.GITHUB_SHA } = {}) {
  if (!output) throw new TypeError('A candidate output path is required');
  if (sourceRevision != null && (typeof sourceRevision !== 'string' || !revisionPattern.test(sourceRevision))) {
    throw new TypeError('Source revision must be a full 40-character Git commit SHA');
  }
  const revision = sourceRevision?.toLowerCase();
  let snapshot = null, published = null, providerError = null;
  try { snapshot = await fetchSnapshot({ fetchImpl, now }); }
  catch (error) { providerError = error.message; }
  if ((snapshot && !force) || (!snapshot && force)) {
    try {
      const url = new URL(publishedURL);
      url.searchParams.set('_weather_check', String(now()));
      published = await requestJSON(url.href, fetchImpl);
    } catch { /* Missing/invalid public snapshot requires a new build. */ }
  }
  let reusedPublished = false;
  if (force && !snapshot) {
    snapshot = validateSnapshot(published, now());
    reusedPublished = Boolean(snapshot);
  }
  if (snapshot && revision) snapshot = { ...snapshot, sourceRevision: revision };
  const result = force ? { shouldDeploy: true, reason: reusedPublished ? 'forced-with-cached-snapshot'
    : snapshot ? 'forced' : 'forced-with-live-fallback' }
    : compareSnapshots(snapshot, published, now());
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(snapshot, null, 2) + '\n');
  if (githubOutput) {
    await appendFile(githubOutput, `should_deploy=${result.shouldDeploy}\nreason=${result.reason}\n`);
  }
  return { ...result, snapshot, providerError };
}

const jsonForHTML = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
  character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const inlineJavaScript = source => source.replace(/<\/script/gi, '<\\/script');
const inlineCSS = source => source.replace(/<\/style/gi, '<\\/style');
const attributeValue = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find(value => value !== undefined);
const withoutAttribute = (tag, name) => tag.replace(new RegExp(`\\s${name}(?=\\s|=|/?>)(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'gi'), '');
function withAttribute(tag, name, value) {
  const escaped = value === undefined ? '' : `="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
  return withoutAttribute(tag, name).replace(/\s*(\/?>)$/, ` ${name}${escaped}$1`);
}

function renderInitialScene(html, media) {
  const roots = html.match(/<html\b[^>]*>/gi) || [];
  if (roots.length !== 1) throw new Error('Expected exactly one HTML root for initial scene');
  let rendered = html.replace(roots[0], () => withAttribute(withAttribute(roots[0], 'data-scene', media.scene), 'data-instant-switch', 'true'));
  // The selected poster also works without JavaScript; the generic cloudy
  // noscript image would otherwise request an unrelated, full-size asset.
  rendered = rendered.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, block => /\bscene-poster\b/.test(block) ? '' : block);
  let currentScene, selectedLayers = 0, selectedPosters = 0;
  rendered = rendered.replace(/<(?:div|img)\b[^>]*>/gi, tag => {
    const classes = (attributeValue(tag, 'class') || '').split(/\s+/);
    if (/^<div\b/i.test(tag) && classes.includes('scene-layer')) {
      currentScene = attributeValue(tag, 'data-scene');
      if (!currentScene) throw new Error('A scene layer is missing its scene name');
      if (currentScene === media.scene) selectedLayers++;
      return withAttribute(tag, 'aria-hidden', currentScene === media.scene ? 'false' : 'true');
    }
    if (/^<img\b/i.test(tag) && classes.includes('scene-poster') && currentScene) {
      let image = withoutAttribute(withoutAttribute(tag, 'src'), 'data-initial-poster');
      if (currentScene === media.scene) {
        selectedPosters++;
        image = withAttribute(withAttribute(withAttribute(image, 'src', media.poster), 'data-initial-poster'), 'fetchpriority', 'high');
      }
      return image;
    }
    return tag;
  });
  if (selectedLayers !== 1 || selectedPosters !== 1) throw new Error('Expected exactly one selected scene layer and poster');
  return rendered;
}

async function initialMedia(sourceRoot, html, skySource, scene) {
  const definitions = {};
  for (const match of skySource.matchAll(/^    (?:([\w-]+)|['"]([\w-]+)['"]): \{ title:([^\n]+)/gm)) {
    definitions[match[1] || match[2]] = match[3];
  }
  const definition = definitions[scene];
  if (!definition) throw new Error(`No media definition for ${scene}`);
  const src = /\bsrc: '([^']+)'/.exec(definition)?.[1];
  const webmSrc = /\bwebmSrc: '([^']+)'/.exec(definition)?.[1];
  const rate = Number(/\brate: ([\d.]+)/.exec(definition)?.[1]);
  const layer = new RegExp(`data-scene="${scene}"[^>]*>([\\s\\S]*?)<video\\b`).exec(html)?.[1];
  const preview = /data-preview="([^"]+)"/.exec(layer || '')?.[1];
  if (!src || !webmSrc || !preview || !Number.isFinite(rate)) throw new Error(`Incomplete media manifest for ${scene}`);
  const local = url => {
    if (!url.startsWith('./assets/')) throw new Error('Initial scene media must be local assets');
    const file = path.resolve(sourceRoot, url.split('?')[0]);
    if (!file.startsWith(path.join(sourceRoot, 'assets') + path.sep)) throw new Error('Media path escapes assets');
    return file;
  };
  const physicalRoot = await realpath(sourceRoot);
  const verifiedLocal = async url => {
    const file = local(url);
    if (await realpath(file) !== path.join(physicalRoot, path.relative(sourceRoot, file))) {
      throw new Error('Initial scene media cannot traverse a symbolic link');
    }
    return file;
  };
  const poster = await readFile(await verifiedLocal(preview));
  if (poster.length > 100000) throw new Error('Initial preview is unexpectedly large');
  await Promise.all([src, webmSrc].map(async url => stat(await verifiedLocal(url))));
  return { scene, poster: `data:image/webp;base64,${poster.toString('base64')}`, src, webmSrc, rate };
}

export async function build({ snapshotPath, output, sourceRoot = sourceDirectory, now = Date.now() } = {}) {
  if (!snapshotPath || !output) throw new TypeError('Snapshot and output paths are required');
  const root = path.resolve(sourceRoot), out = path.resolve(output);
  if (root === out || root.startsWith(out + path.sep)) throw new Error('Build output cannot replace the source directory');
  for (const directory of ['assets', 'vendor', 'licenses']) {
    const input = path.join(root, directory);
    if (out === input || out.startsWith(input + path.sep)) throw new Error('Build output cannot be inside a copied source directory');
  }
  // Never erase an arbitrary existing directory passed by mistake.
  try {
    const files = await readdir(out);
    if (files.length && !files.includes(BUILD_MARKER)) throw new Error('Refusing to replace a non-build output directory');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const candidate = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const snapshot = validateSnapshot(candidate, now);
  const [html, weatherSource, skySource, startupSource, styleSource] = await Promise.all([
    readFile(path.join(root, 'index.html'), 'utf8'), readFile(path.join(root, 'weather.js'), 'utf8'),
    readFile(path.join(root, 'sky.js'), 'utf8'), readFile(path.join(root, 'startup.js'), 'utf8'),
    readFile(path.join(root, 'style.css'), 'utf8'),
  ]);
  if (!html.includes('<!-- WEATHER_STARTUP -->')) throw new Error('Missing WEATHER_STARTUP marker');
  const weatherTag = /<script\b[^>]*\bsrc="[^\"]*weather\.js(?:\?[^\"]*)?"[^>]*>\s*<\/script>/;
  if (!weatherTag.test(html)) throw new Error('Missing external weather.js script');
  const styleTag = /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="\.\/style\.css(?:\?[^\"]*)?")[^>]*>/g;
  if ((html.match(styleTag) || []).length !== 1) throw new Error('Expected exactly one external style.css stylesheet');
  const media = snapshot ? await initialMedia(root, html, skySource, snapshot.scene) : null;
  const mediaDescriptor = media ? { scene: media.scene, src: media.src, webmSrc: media.webmSrc, rate: media.rate } : null;
  const initial = snapshot
    ? `<script id="initial-weather" type="application/json">${jsonForHTML(snapshot)}</script>\n    <script id="initial-media" type="application/json">${jsonForHTML(mediaDescriptor)}</script>\n    ` : '';
  let rendered = media ? renderInitialScene(html, media) : html;
  rendered = rendered.replace(weatherTag, () => `${initial}<script data-weather-startup>\n${inlineJavaScript(weatherSource)}\n</script>`);
  rendered = rendered.replace(styleTag, () => `<style data-site-style>\n${inlineCSS(styleSource)}\n</style>`);
  rendered = rendered.replace('<!-- WEATHER_STARTUP -->', () => `<script data-initial-scene>\n${inlineJavaScript(startupSource)}\n</script>`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, BUILD_MARKER), 'Generated site output; safe to rebuild.\n');
  let count = 0, bytes = 0;
  async function copy(relative) {
    const source = path.join(root, relative), info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error('A copied root directory cannot be a symbolic link');
    if (info.isDirectory()) {
      for (const item of await readdir(source, { withFileTypes: true })) {
        if (!item.isSymbolicLink() && !item.name.startsWith('.')) await copy(path.join(relative, item.name));
      }
    } else if (info.isFile()) {
      const destination = path.join(out, relative);
      await mkdir(path.dirname(destination), { recursive: true }); await copyFile(source, destination);
      count++; bytes += info.size;
    }
  }
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isFile() || item.name === 'index.html' || (item.name.startsWith('.') && item.name !== '.nojekyll')) continue;
    if (/\.(?:html|css|js|svg|ico|png|jpe?g|webp|gif|avif)$/i.test(item.name) || ['CNAME', '.nojekyll', 'robots.txt', 'sitemap.xml'].includes(item.name)) await copy(item.name);
  }
  for (const directory of ['assets', 'vendor', 'licenses']) {
    try { await copy(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(path.join(out, 'index.html'), rendered);
  await writeFile(path.join(out, 'weather-snapshot.json'), JSON.stringify(snapshot) + '\n');
  return { output: out, snapshot: snapshot ? { scene: snapshot.scene, fetchedAt: snapshot.fetchedAt, validUntil: snapshot.validUntil } : null,
    files: count + 3, bytes: bytes + Buffer.byteLength(rendered) + Buffer.byteLength(JSON.stringify(snapshot) + '\n') + Buffer.byteLength('Generated site output; safe to rebuild.\n') };
}

async function main(argv) {
  const [command, ...argumentsList] = argv;
  const options = {};
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    if (argument === '--force') options.force = true;
    else if (['--output', '--snapshot'].includes(argument) && argumentsList[index + 1]) options[argument.slice(2)] = argumentsList[++index];
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  let result;
  if (command === 'check') result = await check(options);
  else if (command === 'build') result = await build({ snapshotPath: options.snapshot, output: options.output });
  else throw new Error('Usage: weather-snapshot.mjs check --output candidate.json [--force] | build --snapshot candidate.json --output _site');
  // Summaries contain no raw provider response or credentials.
  if (command === 'check') console.log(JSON.stringify({ should_deploy: result.shouldDeploy, reason: result.reason,
    scene: result.snapshot?.scene ?? null, providerError: result.providerError }, null, 2));
  else console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
