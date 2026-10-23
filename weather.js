(() => {
  'use strict';
  const host = typeof window === 'undefined' ? globalThis : window;
  const page = typeof document === 'undefined' ? null : document;

  // East Cut / Financial District. Use NOAA's calibrated National Blend of
  // Models explicitly: automatic selection previously chose a western HRRR
  // grid with a gray sky while local conditions and NWS indicated sunshine.
  // These are current-time model estimates, not station observations.
  // https://open-meteo.com/en/docs/gfs-api
  const policyId = 'east-cut-nbm-nearest-v1';
  const maxWeatherAge = 30 * 60 * 1000;
  const fields = ['temperature_2m', 'is_day', 'weather_code', 'cloud_cover', 'direct_normal_irradiance_instant'];
  const endpoint = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: '37.789', longitude: '-122.396', timezone: 'America/Los_Angeles',
    models: 'ncep_nbm_conus', cell_selection: 'nearest',
    timeformat: 'unixtime', temperature_unit: 'fahrenheit', current: fields.join(','),
  });
  const refreshMs = 5 * 60 * 1000;
  const dayMs = 86400000;
  const sfDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const solarDays = new Map();

  /*
   * Sun-time formulas adapted from SunCalc 1.9.0, sun-only, fixed SF location.
   * https://github.com/mourner/suncalc/blob/v1.9.0/suncalc.js
   * Copyright (c) 2014, Vladimir Agafonkin. All rights reserved.
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   * 1. Redistributions of source code must retain the above copyright notice,
   *    this list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the documentation
   *    and/or other materials provided with the distribution.
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
   * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
   * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
   * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
   * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
   * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
   * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
   * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
   * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
   * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
   * POSSIBILITY OF SUCH DAMAGE.
   */
  function sunTimes(anchor) {
    const rad = Math.PI / 180, lw = rad * 122.396, latitude = rad * 37.789;
    const d = anchor / dayMs - 0.5 + 2440588 - 2451545;
    const cycle = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    const transit = hour => 0.0009 + (hour + lw) / (2 * Math.PI) + cycle;
    const anomaly = rad * (357.5291 + 0.98560028 * transit(0));
    const center = rad * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)
      + 0.0003 * Math.sin(3 * anomaly));
    const longitude = anomaly + center + rad * 102.9372 + Math.PI;
    const declination = Math.asin(Math.sin(longitude) * Math.sin(rad * 23.4397));
    const julianTransit = hour => 2451545 + transit(hour) + 0.0053 * Math.sin(anomaly)
      - 0.0069 * Math.sin(2 * longitude);
    const toMilliseconds = julian => Math.trunc((julian + 0.5 - 2440588) * dayMs);
    const setAt = altitude => julianTransit(Math.acos((Math.sin(altitude * rad)
      - Math.sin(latitude) * Math.sin(declination)) / (Math.cos(latitude) * Math.cos(declination))));
    const sunsetJulian = setAt(-0.833);
    const sunset = toMilliseconds(sunsetJulian);
    return Object.freeze({
      sunrise: toMilliseconds(2 * julianTransit(0) - sunsetJulian),
      sunsetStart: sunset - 30 * 60000,
      sunset,
      dusk: toMilliseconds(setAt(-6)),
    });
  }

  function solarPhase(now = Date.now()) {
    if (!Number.isFinite(now) || Math.abs(now) > 8640000000000000) throw new TypeError('Invalid solar time');
    const parts = Object.fromEntries(sfDate.formatToParts(now).map(part => [part.type, part.value]));
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    let days = solarDays.get(key);
    if (!days) {
      // 20:00 UTC is noon or 1pm in SF throughout DST. Anchor the calculation
      // to that civil date, not the visitor's timezone or a UTC calendar day.
      const anchor = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 20);
      days = { today: sunTimes(anchor), tomorrow: sunTimes(anchor + dayMs) };
      solarDays.set(key, days);
      if (solarDays.size > 4) solarDays.delete(solarDays.keys().next().value);
    }
    const { sunrise, sunsetStart, sunset, dusk } = days.today;
    return {
      ...days.today,
      isDay: now >= sunrise && now < sunset,
      isSunset: now >= sunsetStart && now < dusk,
      nextBoundary: [sunrise, sunsetStart, sunset, dusk, days.tomorrow.sunrise].find(time => time > now),
    };
  }

  const nextSolarBoundary = (now = Date.now()) => solarPhase(now).nextBoundary;
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
      return Number.isFinite(now) && age >= -30000 && age < maxWeatherAge;
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
      if (value.version !== 1 || value.weatherPolicy !== policyId || !Number.isFinite(value.fetchedAt)
        || value.fetchedAt > now + 60000 || now - value.fetchedAt >= maxWeatherAge
        || !Number.isFinite(value.validUntil) || value.validUntil <= now
        || value.validUntil > value.fetchedAt + maxWeatherAge
        || value.validUntil > value.current?.time * 1000 + maxWeatherAge
        || !isFresh(value.current, now)) return null;
      const current = normalize(value.current);
      // A static deployment can lag a visitor's most recent live reading.
      // Never start its older video when newer weather is already cached.
      if (readCache()?.current.time > current.time) return null;
      if (value.scene !== select(current, now)) return null;
      return { current, fetchedAt: value.fetchedAt, scene: value.scene };
    } catch { return null; }
  }

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(`sf-sky-weather-${policyId}`));
      if (cached?.weatherPolicy !== policyId || !isFresh(cached.current)
        || !Number.isFinite(cached.fetchedAt) || cached.fetchedAt > Date.now()) return null;
      return { current: normalize(cached.current), fetchedAt: cached.fetchedAt };
    } catch { return null; }
  }

  function select(current, now = Date.now()) {
    const c = normalize(current);
    const solar = solarPhase(now);
    // Drizzle and thunderstorms share the rain visuals, without lightning or hail.
    // Explicit precipitation and fog codes retain
    // their weather type after dark, with a matching nighttime asset.
    // Visibility, humidity, cloud height, and precipitation totals do not imply these labels.
    // A cached 15-minute observation must not delay a lighting transition.
    const night = !solar.isDay;
    if (rainCodes.has(c.weather_code)) return night ? 'night-rain' : 'rain';
    if (c.weather_code === 45 || c.weather_code === 48) return night ? 'night-fog' : 'fog';
    const clear = (c.weather_code === 0 || c.weather_code === 1)
      && (c.cloud_cover === null || c.cloud_cover <= 25);
    if (clear) return solar.isSunset ? 'sunset' : night ? 'clear-night' : 'sunny';
    if (c.weather_code <= 3) {
      const graySky = c.weather_code === 3
        || (c.cloud_cover !== null && c.cloud_cover >= graySkyCloudCover);
      // Darkness alone says nothing about cloud density. Preserve the three
      // night skies using cloud cover and the provider's condition code.
      if (night) return graySky ? 'overcast-night' : 'night';
      const brightClouds = c.direct_normal_irradiance_instant !== null
        ? c.direct_normal_irradiance_instant > directSunlightThreshold : !graySky;
      // Sunlit clouds get a sunset variant during the final 30 daylight minutes.
      // Zero twilight sunlight is not evidence of a bright sky, and even an old
      // positive reading must not override the night mapping above after sunset.
      if (brightClouds) return solar.isSunset ? 'cloudy-sunset' : 'cloudy';
      return 'overcast';
    }
    // Snow has no dedicated footage; preserve its existing cloud approximation.
    return night ? 'night' : 'cloudy';
  }

  function summarize(current, now = Date.now()) {
    const c = normalize(current);
    const labels = {
      sunny: 'Sunny', sunset: 'Clear', 'clear-night': 'Clear',
      cloudy: 'Cloudy', 'cloudy-sunset': 'Cloudy', night: 'Cloudy', overcast: 'Cloudy', 'overcast-night': 'Cloudy',
      rain: 'Raining', 'night-rain': 'Raining', fog: 'Foggy', 'night-fog': 'Foggy',
    };
    const condition = [71, 73, 75, 77, 85, 86].includes(c.weather_code)
      ? 'snowing' : labels[select(c, now)].toLowerCase();
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
    endpoint, policyId, maxWeatherAge, refreshMs, fetchCurrent, isFresh, summarize, normalize, readInitial, readCache, solarPhase, nextSolarBoundary,
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
