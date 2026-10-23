(() => {
  'use strict';
  const host = typeof window === 'undefined' ? globalThis : window;
  const page = typeof document === 'undefined' ? null : document;

  // Open-Meteo: https://open-meteo.com/en/docs (fields and WMO codes verified 2026-10-22).
  // Current values are model estimates; Unix timestamps remain UTC even with an SF timezone.
  const fields = ['temperature_2m', 'is_day', 'weather_code', 'cloud_cover', 'direct_normal_irradiance_instant'];
  const endpoint = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: '37.7749', longitude: '-122.4194', timezone: 'America/Los_Angeles',
    timeformat: 'unixtime', temperature_unit: 'fahrenheit', current: fields.join(','),
  });
  const refreshMs = 5 * 60 * 1000;
  const conditionLabels = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Rain', 63: 'Rain', 65: 'Rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Snow', 73: 'Snow', 75: 'Snow', 77: 'Snow',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Rain showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm', 97: 'Thunderstorm', 99: 'Thunderstorm',
  };
  const codes = new Set(Object.keys(conditionLabels).map(Number));
  const rainCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 97, 99]);
  // Direct normal irradiance measures the sun-facing beam, avoiding the extra
  // low-sun-angle dimming of a horizontal measurement. Open-Meteo defines
  // sunshine as exceeding 120 W/m²; we use that as a daytime visual cutoff.
  const directSunlightThreshold = 120;
  // Coverage is a nighttime / missing-sunlight fallback, not a rain diagnosis.
  const graySkyCloudCover = 60;
  const ranges = {
    temperature_2m: [-150, 150], cloud_cover: [0, 100],
    direct_normal_irradiance_instant: [0, 2000],
  };

  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isSafeInteger(value.time) || value.time <= 0
      || !codes.has(value.weather_code) || (value.is_day !== 0 && value.is_day !== 1)) {
      throw new TypeError('Malformed current weather');
    }
    const current = { time: value.time, weather_code: value.weather_code, is_day: value.is_day };
    for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
      const number = value[key];
      if (number == null) current[key] = null;
      else if (typeof number === 'number' && Number.isFinite(number)
        && number >= minimum && number <= maximum) current[key] = number;
      else throw new TypeError(`Malformed weather value: ${key}`);
    }
    return current;
  }

  function isFresh(current, now = Date.now()) {
    try {
      const age = now - normalize(current).time * 1000;
      return Number.isFinite(now) && age >= -30 * 60 * 1000 && age <= 2 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }

  function readInitial() {
    try {
      const node = page?.querySelector('#initial-weather');
      if (!node) return null;
      const value = JSON.parse(node.textContent);
      const now = Date.now();
      if (value.version !== 1 || !Number.isFinite(value.fetchedAt)
        || value.fetchedAt > now + 60000 || now - value.fetchedAt > 45 * 60 * 1000
        || !Number.isFinite(value.validUntil) || value.validUntil <= now
        || value.validUntil > value.fetchedAt + 45 * 60 * 1000
        || !isFresh(value.current, now)) return null;
      const current = normalize(value.current);
      if (value.scene !== select(current)) return null;
      return { current, fetchedAt: value.fetchedAt, scene: value.scene };
    } catch { return null; }
  }

  function select(current) {
    const c = normalize(current);
    // Drizzle and thunderstorms share the rain visuals, without lightning or hail.
    // Explicit precipitation and fog codes retain
    // their weather type after dark, with a matching nighttime asset.
    // Visibility, humidity, cloud height, and precipitation totals do not imply these labels.
    const night = c.is_day === 0;
    if (rainCodes.has(c.weather_code)) return night ? 'night-rain' : 'rain';
    if (c.weather_code === 45 || c.weather_code === 48) return night ? 'night-fog' : 'fog';
    const clear = (c.weather_code === 0 || c.weather_code === 1)
      && (c.cloud_cover === null || c.cloud_cover <= 25);
    if (clear) return night ? 'clear-night' : 'sunny';
    if (c.weather_code <= 3) {
      const graySky = c.weather_code === 3
        || (c.cloud_cover !== null && c.cloud_cover >= graySkyCloudCover);
      // Darkness alone says nothing about cloud density. Preserve the three
      // night skies using cloud cover and the provider's condition code.
      if (night) return graySky ? 'overcast-night' : 'night';
      if (c.direct_normal_irradiance_instant !== null) {
        return c.direct_normal_irradiance_instant > directSunlightThreshold ? 'cloudy' : 'overcast';
      }
      return graySky ? 'overcast' : 'cloudy';
    }
    // Snow has no dedicated footage; preserve its existing cloud approximation.
    return night ? 'night' : 'cloudy';
  }

  function summarize(current) {
    const c = normalize(current);
    const labels = {
      sunny: 'Sunny', 'clear-night': 'Clear',
      cloudy: 'Cloudy', night: 'Cloudy', overcast: 'Cloudy', 'overcast-night': 'Cloudy',
      rain: 'Raining', 'night-rain': 'Raining', fog: 'Foggy', 'night-fog': 'Foggy',
    };
    const condition = [71, 73, 75, 77, 85, 86].includes(c.weather_code)
      ? 'snowing' : labels[select(c)].toLowerCase();
    const temperature = c.temperature_2m === null ? '' : `${Math.round(c.temperature_2m)}°F and `;
    return `Currently ${temperature}${condition} in San Francisco`;
  }

  async function fetchCurrent({ signal } = {}) {
    const response = await fetch(endpoint, { signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
    const payload = await response.json();
    if (!payload || payload.error) throw new TypeError('Malformed weather response');
    const current = normalize(payload.current);
    if (!isFresh(current)) throw new Error('Weather data is outside the current time window');
    return current;
  }

  // Start during HTML parsing, before the deferred scene controller. Resolve
  // failures as data so an early rejection never becomes an unhandled promise.
  let startupRequest = null;
  if (page?.currentScript?.hasAttribute('data-weather-startup') && !page.hidden) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    startupRequest = {
      startedAt: Date.now(),
      result: fetchCurrent({ signal: controller.signal }).then(
        current => ({ current, fetchedAt: Date.now() }),
        error => ({ error }),
      ).finally(() => clearTimeout(timeout)),
    };
  }

  host.SFWeather = Object.freeze({
    endpoint, refreshMs, fetchCurrent, isFresh, summarize, normalize, readInitial,
    takeStartupRequest() {
      const request = startupRequest;
      startupRequest = null;
      return request;
    },
    pickScene: select,
    describe: current => conditionLabels[normalize(current).weather_code],
  });
  if (page) host.dispatchEvent(new Event('sf-weather-ready'));
})();
