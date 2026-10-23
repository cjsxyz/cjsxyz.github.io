(async () => {
  const root = document.documentElement;
  const sky = document.querySelector('.sky');
  const status = document.querySelector('#scene-status');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const portraitQuery = window.matchMedia('(max-width: 600px) and (max-aspect-ratio: 9/16)');
  // Start small in portrait; rotation can upgrade once, never downgrade again.
  let portraitMedia = portraitQuery.matches;
  // The weather module runs asynchronously so its request can start before
  // DOM parsing finishes. It may finish on either side of this controller.
  const weather = window.SFWeather || await new Promise(resolve => {
    window.addEventListener('sf-weather-ready', () => resolve(window.SFWeather), { once: true });
  });
  const condition = document.querySelector('#weather-condition');
  const freshness = document.querySelector('#weather-freshness');
  const weatherSummary = document.querySelector('#weather-summary');
  const cacheKey = `sf-sky-weather-${weather.policyId}`;
  const sfTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  let current = null;
  let fetchedAt = 0;
  let lastAttempt = 0;
  let pending = false;
  let refreshTimer;
  let expiryTimer;
  let solarTimer;
  let weatherFailed = false;
  let hasWeatherScene = false;
  const initialWeather = weather.readInitial();
  if (initialWeather) {
    current = initialWeather.current;
    fetchedAt = initialWeather.fetchedAt;
  }
  const cachedWeather = !initialWeather && weather.readCache();
  if (cachedWeather) {
    current = cachedWeather.current;
    fetchedAt = cachedWeather.fetchedAt;
  }
  const scenes = {
    cloudy: { title: 'Cloudy', src: './assets/clouds.mp4?v=weather-scenes-80', webmSrc: './assets/clouds.webm?v=weather-scenes-46', rate: 0.5, description: 'White clouds billowing gently across a blue sky' },
    sunny: { title: 'Sunny', src: './assets/sunny.mp4?v=weather-scenes-80', webmSrc: './assets/sunny.webm?v=weather-scenes-34', rate: 1, description: 'A clear blue sky with bright sunlight and no clouds' },
    sunset: { title: 'Sunset', src: './assets/sunset.mp4?v=weather-scenes-130', webmSrc: './assets/sunset.webm?v=weather-scenes-130', rate: 1, description: 'A quiet pink and lavender sunset sky' },
    'cloudy-sunset': { title: 'Cloudy sunset', src: './assets/cloudy-sunset.mp4?v=weather-scenes-135', webmSrc: './assets/cloudy-sunset.webm?v=weather-scenes-135', rate: 0.25, description: 'Blue-gray clouds above a soft peach sunset sky' },
    overcast: { title: 'Overcast', src: './assets/overcast.mp4?v=weather-scenes-80', webmSrc: './assets/overcast.webm?v=weather-scenes-73', rate: 1, description: 'Soft gray overcast clouds drifting across a muted sky without falling rain' },
    rain: { title: 'Rain', src: './assets/rain.mp4?v=weather-scenes-80', webmSrc: './assets/rain.webm?v=weather-scenes-73', rate: 1, description: 'Visible fine rain falling beneath slowly moving overcast clouds' },
    fog: { title: 'Fog / Marine Layer', src: './assets/fog.mp4?v=weather-scenes-80', webmSrc: './assets/fog.webm?v=weather-scenes-36', rate: 1, description: 'Soft fog and low marine clouds drifting through diffuse coastal light' },
    night: { title: 'Cloudy night', src: './assets/night.mp4?v=weather-scenes-80', webmSrc: './assets/night.webm?v=weather-scenes-73', rate: 0.5, description: 'Clouds drifting through a deep blue night sky, lit from the upper right' },
    'clear-night': { title: 'Clear night', src: './assets/clear-night.mp4?v=weather-scenes-80', webmSrc: './assets/clear-night.webm?v=weather-scenes-44', rate: 1, description: 'A clear deep blue night sky with soft light from the upper right' },
    'overcast-night': { title: 'Overcast night', src: './assets/overcast-night.mp4?v=weather-scenes-80', webmSrc: './assets/overcast-night.webm?v=weather-scenes-73', rate: 1, description: 'A dim blue-gray cloud ceiling drifting slowly through the night' },
    'night-rain': { title: 'Night rain', src: './assets/night-rain.mp4?v=weather-scenes-80', webmSrc: './assets/night-rain.webm?v=weather-scenes-73', rate: 1, description: 'Fine rain falling through a dark blue-gray night sky' },
    'night-fog': { title: 'Night fog', src: './assets/night-fog.mp4?v=weather-scenes-80', webmSrc: './assets/night-fog.webm?v=weather-scenes-44', rate: 1, description: 'Uneven layers of soft coastal fog moving through dim nighttime light' },
  };
  let selected = Object.hasOwn(scenes, root.dataset.scene) ? root.dataset.scene : 'cloudy';
  let wantsToPlay = !reducedMotion.matches;
  let selectionVersion = 0;

  function loadPoster(scene, { fullQuality = false } = {}) {
    const src = fullQuality || !wantsToPlay || scene.failed
      ? scene.poster.dataset.src : scene.poster.dataset.preview;
    if (scene.poster.getAttribute('src') === src && scene.posterAttempt === src) return;
    scene.posterAttempt = src;
    scene.posterReady = false;
    scene.posterFailed = false;
    scene.poster.fetchPriority = 'high';
    if (scene.poster.getAttribute('src') !== src) scene.poster.src = src;
    scene.poster.decode().then(() => {
      if (scene.poster.getAttribute('src') !== src) return;
      scene.posterReady = scene.poster.naturalWidth > 0;
      scene.reveal?.();
    }).catch(() => {
      if (scene.poster.getAttribute('src') !== src) return;
      // A missing lightweight preview can still use the original still.
      if (src !== scene.poster.dataset.src) loadPoster(scene, { fullQuality: true });
      else {
        scene.posterFailed = true;
        scene.reveal?.();
      }
    });
  }

  function updateState() {
    for (const [key, scene] of Object.entries(scenes)) {
      const moving = key === selected && !scene.video.paused && !scene.video.ended && !document.hidden;
      scene.video.dataset.motion = moving ? 'playing' : 'paused';
      scene.video.setAttribute('aria-label', moving ? scene.description : `Still view: ${scene.description}`);
    }
  }

  function applyPlaybackPreference() {
    for (const [key, scene] of Object.entries(scenes)) {
      const video = scene.video;
      if (hasWeatherScene && weather.isFresh(current) && key === selected && wantsToPlay && !document.hidden && !scene.failed) {
        video.hidden = video.readyState < 2 && video.dataset.startupReady !== 'true';
        if (!video.getAttribute('src') || scene.needsFallback) {
          video.hidden = true;
          video.src = scene.preferredSrc;
          scene.needsFallback = false;
        }
        video.playbackRate = scene.rate;
        video.play().catch(() => updateState());
      } else {
        video.pause();
        if (!video.getAttribute('src') || scene.failed) video.hidden = true;
        if (hasWeatherScene && key === selected && video.hidden && (!wantsToPlay || scene.failed)) {
          loadPoster(scene, { fullQuality: true });
        }
      }
    }
    updateState();
  }

  function clearPreviewURL() {
    const url = new URL(location.href);
    if (!url.searchParams.has('scene') && !url.searchParams.has('mode')) return;
    url.searchParams.delete('scene');
    url.searchParams.delete('mode');
    history.replaceState(history.state, '', url);
  }

  function selectScene(key, { instant = false } = {}) {
    if (!Object.hasOwn(scenes, key)) key = 'cloudy';
    selected = key;
    const scene = scenes[key];
    const version = ++selectionVersion;
    scene.reveal = () => {
      if (selected !== key || version !== selectionVersion) return;
      const videoReady = !scene.failed && !scene.video.hidden && scene.video.readyState >= 2;
      const mediaFailed = scene.posterFailed && (scene.failed || !wantsToPlay);
      if (!scene.posterReady && !videoReady && !mediaFailed) return;
      root.dataset.instantSwitch = String(instant);
      root.dataset.scene = key;
      Object.entries(scenes).forEach(([name, item]) => {
        item.layer.setAttribute('aria-hidden', String(name !== key));
      });
      scene.reveal = null;
    };
    // The first decoded medium wins. Keep the old scene visible during a
    // weather change, but never hold a ready video behind an image download.
    loadPoster(scene);
    sky.setAttribute('aria-label', scenes[key].description);
    document.title = 'chris shu';
    status.textContent = `${scenes[key].title} sky selected.`;
    applyPlaybackPreference();
    scene.reveal?.();
  }

  function showWeather() {
    if (current && weather.isFresh(current)) {
      weatherSummary.textContent = weather.summarize(current);
      const temperature = Number.isFinite(current.temperature_2m) ? `${Math.round(current.temperature_2m)}°F · ` : '';
      condition.textContent = `${temperature}${weather.describe(current)}`;
      freshness.textContent = `${weatherFailed ? 'Last known' : 'As of'} ${sfTime.format(current.time * 1000)} PT`;
    } else {
      weatherSummary.textContent = weatherFailed ? 'Weather unavailable in San Francisco' : 'Checking weather in San Francisco…';
      condition.textContent = weatherFailed ? 'Weather unavailable' : 'Checking weather…';
      freshness.textContent = weatherFailed ? 'Will retry automatically' : 'Current conditions';
    }
  }

  function useCurrentWeather({ instant = false } = {}) {
    if (!current || !weather.isFresh(current)) return false;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      applyPlaybackPreference();
      showWeather();
      status.textContent = 'Checking current weather. The previous sky is paused.';
      refreshWeather({ force: true });
    }, Math.max(1, current.time * 1000 + weather.maxWeatherAge - Date.now()));
    hasWeatherScene = true;
    selectScene(weather.pickScene(current), { instant });
    return true;
  }

  async function refreshWeather({ force = false } = {}) {
    if (pending || document.hidden) return;
    clearTimeout(refreshTimer);
    // A page opened in the background still needs its first fresh request when shown.
    if (!force && lastAttempt > 0 && (Date.now() - lastAttempt < 60000 || (!weatherFailed && current && weather.isFresh(current) && Date.now() - fetchedAt < weather.refreshMs))) {
      showWeather();
      scheduleWeatherRefresh();
      return;
    }
    pending = true;
    const earlyRequest = weather.takeStartupRequest();
    // A tab may finish parsing in the background and be opened much later.
    const startup = earlyRequest && Date.now() - earlyRequest.startedAt < 60000 ? earlyRequest : null;
    lastAttempt = startup?.startedAt ?? Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const result = startup ? await startup.result
        : { current: await weather.fetchCurrent({ signal: controller.signal }), fetchedAt: Date.now() };
      if (result.error) throw result.error;
      if (!weather.isFresh(result.current)) throw new Error('Startup weather has expired');
      current = result.current;
      fetchedAt = result.fetchedAt;
      weatherFailed = false;
      try { localStorage.setItem(cacheKey, JSON.stringify({ current, fetchedAt, weatherPolicy: weather.policyId })); } catch { /* Optional cache. */ }
      useCurrentWeather({ instant: !hasWeatherScene });
    } catch {
      weatherFailed = true;
      // Keep a published still during an outage without treating its expired
      // snapshot as current weather or starting a potentially stale video.
      if (!hasWeatherScene && scenes[selected].poster.hasAttribute('data-initial-poster')) {
        status.textContent = 'Weather unavailable. Showing the last published sky.';
      } else if (!hasWeatherScene) {
        hasWeatherScene = true;
        selectScene('cloudy', { instant: true });
      } else applyPlaybackPreference();
      if (!weather.isFresh(current)) status.textContent = 'Weather unavailable. Showing the last sky as a still.';
    } finally {
      clearTimeout(timeout);
      pending = false;
      showWeather();
      scheduleWeatherRefresh();
    }
  }

  function scheduleWeatherRefresh() {
    clearTimeout(refreshTimer);
    if (document.hidden) return;
    const dueAt = current && weather.isFresh(current) && !weatherFailed
      ? fetchedAt + weather.refreshMs : lastAttempt + 60000;
    refreshTimer = setTimeout(() => refreshWeather(), Math.max(250, dueAt - Date.now(), lastAttempt + 60000 - Date.now()));
  }

  function scheduleSolarTransition() {
    clearTimeout(solarTimer);
    if (document.hidden) return;
    // Lighting follows San Francisco's clock even between weather requests.
    const boundary = weather.solarPhase().nextBoundary;
    solarTimer = setTimeout(() => {
      useCurrentWeather();
      showWeather();
      scheduleSolarTransition();
    }, Math.max(100, boundary - Date.now() + 25));
  }

  for (const [key, scene] of Object.entries(scenes)) {
    scene.layer = document.querySelector(`.scene-layer[data-scene="${key}"]`);
    scene.poster = scene.layer.querySelector('.scene-poster');
    const video = scene.video = scene.layer.querySelector('video');
    // Keep the sky gradients in 10-bit color where decoding is available.
    // Try the chosen tier's MP4 before a desktop MP4 if a portrait asset fails.
    // Keep existing desktop URLs stable so their cached copies remain reusable.
    const supportsWebM = video.canPlayType('video/webm; codecs="vp09.02.41.10"');
    const mp4 = portraitMedia ? scene.src.replace(/\.mp4(?:\?.*)?$/, '.mobile-v94.mp4') : scene.src;
    const webm = portraitMedia ? mp4.replace('.mp4', '.webm') : scene.webmSrc;
    scene.desktopSources = [...(supportsWebM ? [scene.webmSrc] : []), scene.src];
    scene.sources = [...(supportsWebM ? [webm] : []), mp4, ...(portraitMedia ? [scene.src] : [])];
    scene.sourceIndex = 0;
    scene.preferredSrc = scene.sources[0];
    video.muted = true;
    video.defaultPlaybackRate = scene.rate;
    video.playbackRate = scene.rate;
    video.addEventListener('loadedmetadata', () => {
      video.playbackRate = scene.rate;
      if (Number.isFinite(scene.restoreTime)) {
        const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 0.001 : scene.restoreTime;
        video.currentTime = Math.max(0, Math.min(scene.restoreTime, end));
        scene.restoreTime = null;
      }
      updateState();
    });
    video.addEventListener('play', () => {
      if (key !== selected || !wantsToPlay || document.hidden) video.pause();
      updateState();
    });
    const showVideoFrame = () => {
      if (video.readyState < 2 || scene.failed) return;
      video.hidden = false;
      scene.reveal?.();
      updateState();
    };
    video.addEventListener('loadeddata', showVideoFrame);
    video.addEventListener('playing', showVideoFrame);
    video.addEventListener('pause', updateState);
    scene.handleVideoError = () => {
      // Ignore unrequested sources and duplicate errors while a retry waits
      // for the scene to become active or motion to be enabled again.
      if (scene.failed || scene.needsFallback || !video.getAttribute('src')) return;
      if (scene.sourceIndex + 1 < scene.sources.length) {
        scene.preferredSrc = scene.sources[++scene.sourceIndex];
        // A late error in a scene that is no longer active must not start a
        // background MP4 download. Retry when playback is actually requested.
        scene.needsFallback = true;
        applyPlaybackPreference();
        return;
      }
      scene.failed = true;
      video.hidden = true;
      video.pause();
      if (key === selected) loadPoster(scene, { fullQuality: true });
      scene.reveal?.();
      if (key === selected) status.textContent = `${scene.title} sky. Showing a still image because the video is unavailable.`;
      updateState();
    };
    video.addEventListener('error', scene.handleVideoError);
  }

  portraitQuery.addEventListener('change', event => {
    if (!portraitMedia || event.matches) return;
    portraitMedia = false;
    for (const [key, scene] of Object.entries(scenes)) {
      const video = scene.video;
      const source = video.getAttribute('src');
      scene.sources = scene.desktopSources;
      scene.sourceIndex = Math.max(0, scene.sources.indexOf(source));
      scene.preferredSrc = scene.sources[scene.sourceIndex];
      if (!source || source === scene.preferredSrc) continue;
      scene.failed = false;
      scene.restoreTime = video.currentTime;
      scene.needsFallback = true;
      if (key !== selected) continue;
      // Source replacement pauses the element. Resume only if it was moving;
      // metadata restores its position before playback continues.
      const wasPlaying = !video.paused;
      video.pause();
      video.hidden = true;
      video.src = scene.preferredSrc;
      scene.needsFallback = false;
      if (wasPlaying) applyPlaybackPreference();
    }
    updateState();
  });

  document.addEventListener('keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') wantsToPlay = false;
    else if (event.code === 'Space' && !event.target.closest('button, input, select, textarea, a, [contenteditable="true"], .bio-summary')) wantsToPlay = !wantsToPlay;
    else return;
    event.preventDefault();
    applyPlaybackPreference();
  });
  document.addEventListener('visibilitychange', () => {
    applyPlaybackPreference();
    if (document.hidden) {
      clearTimeout(refreshTimer);
      clearTimeout(solarTimer);
    } else {
      useCurrentWeather();
      showWeather();
      scheduleSolarTransition();
      refreshWeather();
    }
  });
  window.addEventListener('online', () => refreshWeather({ force: true }));
  reducedMotion.addEventListener('change', event => {
    wantsToPlay = !event.matches;
    applyPlaybackPreference();
  });
  window.addEventListener('popstate', () => {
    clearPreviewURL();
    useCurrentWeather({ instant: true });
    showWeather();
    refreshWeather();
  });
  clearPreviewURL();
  // The published still is already visible before this controller loads.
  // Only fresh weather starts playback; live data replaces an expired snapshot.
  if (!useCurrentWeather({ instant: true })) {
    sky.setAttribute('aria-label', 'Sky background while checking current weather');
    status.textContent = 'Checking current weather.';
  }
  // A parser-started video can fail before this deferred controller attaches.
  // Process its recorded error once all scene elements and sources are ready.
  for (const scene of Object.values(scenes)) {
    if (scene.video.error) scene.handleVideoError();
  }
  showWeather();
  scheduleSolarTransition();
  // Fetch on every page load, even if a cached scene can paint immediately.
  refreshWeather({ force: true });
})();
