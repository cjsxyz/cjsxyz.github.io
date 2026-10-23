# chris shu

The browser title stays “chris shu” in every weather condition, with a solid off-white (`#f9f9f9`) square SVG favicon.

Ten silent sky scenes fill a large rectangular frame with solid off-white (`#f9f9f9`) margins. The frame remains inset 12.996–32.49 px, with square 90-degree corners. The page automatically matches current San Francisco weather from Open-Meteo to Cloudy, Overcast, Sunny, Rain, Fog, Cloudy night, Clear night, Overcast night, Night rain, or Night fog. The translucent glass dock has three equal-width controls with no gaps and is scaled to 95%, rendering at about 348×55 px. It contains the Tabler Cloud, User, and Email outline icons, in that order. Icons are centered in their controls. Each control highlights its full area in place with a translucent glass gradient and soft rim when clicked, with adjacent highlight areas meeting edge to edge and all four corners of every highlight rounded. Cloud expands the same glass dock upward to show a current condition centered horizontally with a 1 px optical lift above a softly recessed crease in the glass, such as “Currently 58°F and cloudy in San Francisco”, “Currently 68°F and sunny in San Francisco”, or “Currently 55°F and raining in San Francisco”; clear nights use “clear” and fog uses “foggy”. The 354 px track keeps every supported condition sentence on one line at 13 px; on narrow screens only the weather text scales down to 11 px to accommodate the temperature and full city name. The controls are 46 px high, and the weather panel matches the collapsed dock’s 58 px layout height. The dock displays at 55.1 px tall when collapsed and 110.2 px tall with weather open, with the width increased by another 20% (305 to 366 px before the display scale) while preserving the height and icon sizes. A shared responsive width cap keeps the dock inside the sky frame on narrow screens. It uses the same fresh Open-Meteo data as the video and updates with each weather refresh. Email opens `mailto:chris@paradigm.xyz`; User expands the same drawer with the single paragraph “Conversation and vibes at Paradigm. Building a homestead in the Napa mountains.” The biography uses equal 24 px side insets, balanced wrapping, and centered text. Its 15.25 px top and 24.75 px bottom padding lift the text optically by 2 px from the geometric center. It scrolls if the viewport is too short. Cloud is selected initially, with the weather section collapsed. Pointer activation expands or collapses it in 200 ms; keyboard activation and reduced-motion preferences update immediately. The icon row stays anchored, and rapid toggles reverse the current transition. There is no sliding highlight. Only the selected video plays; other videos load on first selection and pause when inactive.

- **Cloudy:** the approved filmed cumulus scene, with its existing blue, gentle billowing, and 0.5× playback. Rebuilt from the original high-bitrate 1080p footage, retaining cloud detail through float-precision processing and one final encode. The 60 fps asset is slowed twelvefold using bidirectional optical flow. The visible loop lasts about 188.5 seconds.
- **Sunny:** a cloudless portion of the same filmed blue sky, matched to the approved color, with stronger composited sunlight entering from beyond the top-right corner. There is no visible sun disc. A smooth illumination field removes stretched compression texture from the crop. The light changes very slightly over a 24-second, 30 fps loop; there is no cloud motion.
- **Overcast:** a variation of the filmed rain-cloud scene, with broad gray coverage, muted daylight, and no falling rain. It uses the original 1080p camera footage, with gentle slowed motion and a 15.68-second seamless loop at 60 fps. Daytime clouds with little direct sunlight use this scene.
- **Rain:** a different filmed sky that now opens with the dark gray rain-cloud bank covering roughly half the view, rather than counting thin pale clouds toward the coverage. The opening starts later in the source clip; lighter blue-gray sky remains visible beside and below the dark bank. It uses a longer continuous section of the source, slowed ninefold using bidirectional optical flow and colored a muted blue-gray. Dark blue sky stays visible between the clouds. Fine, layered rain streaks are composited into the exported video, with slightly stronger visibility and full steady coverage from the opening frame and poster. The 60 fps loop lasts 119.75 seconds and has no lightning or flashes. The longer loop uses additional continuous source footage rather than repeating the former 43.7-second clip. Rainfall is period-matched to the full loop, with the same approximate falling speed.
- **Fog / Marine Layer:** a single combined coastal-fog scene with soft silver-gray low cloud cover, diffuse daylight, and gentle natural motion. A sky-only 2160×1215 crop from the original portrait 4K footage is downsampled to 1080p, with no visible land or water. It is slowed twofold with optical flow and plays at 1× over a 12.97-second seamless loop. The overall fog layer is 66% opaque. Broad, softly overlapping transparency regions reveal a muted blue-gray atmosphere beneath the original footage, varying the fog density without silhouettes or extra motion. The same mask applies to the poster and video together; browsers without masking support retain the same gently reduced overall density without the extra clearing regions.
- **Cloudy night:** its own independently filmed cloud formation, distinct from Cloudy, graded to a deep blue night, with directional moonlight entering from beyond the top-right corner. No moon disc is visible. The 43.5-second, 60 fps loop plays at 0.5× for 87 seconds of gentle motion.

- **Clear night:** a smooth deep blue cloudless sky with brighter full-moon-like ambient light from the upper right, no moon disc, and very subtle illumination changes.
- **Overcast night:** the slow overcast cloud ceiling graded to muted dark blue-gray, with visible texture and no sunny gaps.
- **Night rain:** a darker version of the revised 119.75-second rain scene, keeping fine precipitation visible from the opening frame.
- **Night fog:** the filmed fog layer graded for dim nighttime light, with the same 66% density and broad clearing mask as daytime Fog, over a dark atmospheric background.

All ten scenes provide 10-bit VP9 video for finer sky gradients, with a high-quality H.264 fallback. Motion interpolation uses high-precision frames, and color grading stays in floating point until export; a faint stationary dither reduces banding without flickering grain. Cloudy, Overcast, and Rain are rendered directly from the full-resolution source footage, bypassing the earlier compressed intermediates. Cloudy, Overcast, Rain, and Night use 1080p sources; Fog uses a crop from a portrait 4K source. The new night variants are graded from the corresponding already-looping 10-bit masters; the extended day/night rain pair is rendered together from the original camera source. Desktop videos are 1920×1080; narrow portrait phones receive 608×1080 crops with the same full vertical detail. Matching lossless WebP posters preserve the smooth gradients while loading.

The Overcast, Overcast night, Rain, Night rain, and Cloudy night exports include a localized source-object cleanup: tiny filmed birds and dark transient specks that became conspicuous after slow retiming are removed only within manually reviewed regions and frames. The repair preserves the existing motion, grading, resolution, frame rate, and loop duration. Rain posters use the repaired opening frame. The other five scenes retain their existing video files.

The dock uses native buttons and a native email link, accessible names, and visible keyboard focus. Tab moves through the controls, Enter activates them, and Space activates the buttons. Left/Right arrows and Home/End move focus without opening the email client. Cloud and User toggle their own drawer content; switching between them changes the content and smoothly adjusts the height. Selecting Email, Escape, outside pointer input, or focus moving outside the dock collapses the drawer. Interaction within it keeps it open. Escape collapses it without pausing the video and returns focus to the opening control if focus was inside the drawer. The drawer is inert and hidden from assistive technology when collapsed. A scrollable biography can receive keyboard focus, and Space scrolls it without pausing the video.

The sky loops blend their ends into their beginnings. Matching poster images stay visible while loading or if playback fails. The interface crossfades scenes in 250 ms using opacity; reduced-motion settings switch immediately. Space pauses or resumes the active sky. Escape pauses it.

Reduced-motion preferences start every scene as a still and avoid downloading videos until playback is explicitly requested. Playback also pauses in background tabs. All media are local, and there are no analytics. The only API request is to Open-Meteo for the fixed San Francisco coordinates below; no device location is requested. The site always follows live weather. Old `scene` and `mode` URL parameters are removed on page load and history navigation, so an old preview link cannot pin the video to the wrong condition or time of day. The icon dock never overrides the live weather scene.

Run `python3 serve.py` and open `http://127.0.0.1:8765/`, or serve this folder with a static HTTP server that supports byte-range requests for video seeking. No build step or runtime dependencies are required.

## Loop durations

Measured from the delivered files, including the website playback rates. Cloudy and Cloudy night play at 0.5×; all other scenes play at 1×.

| Scene | Time before repeating on the website |
| --- | ---: |
| Cloudy | 3m 8.5s |
| Sunny | 24.0s |
| Overcast | 15.7s |
| Rain | 1m 59.8s |
| Fog / Marine Layer | 13.0s |
| Cloudy night | 1m 27.0s |
| Clear night | 24.0s |
| Overcast night | 15.7s |
| Night rain | 1m 59.8s |
| Night fog | 13.0s |
## Live San Francisco weather

`weather.js` requests current conditions for 37.7749, -122.4194, using `America/Los_Angeles`, UTC Unix timestamps, and Fahrenheit. A fresh API request runs on every page load, even when a cached scene is available immediately. Requests then run every 5 minutes while visible; a fresh cached response avoids duplicate visibility-triggered requests. A single timeout schedules the next refresh from the last successful response, so network latency does not skip a refresh. Returning to the tab or coming back online checks for an update. The weather readout and provider credit are available to screen readers; no weather box or corner credit is displayed.

Scene selection uses these priorities:

1. Explicit drizzle, freezing drizzle, rain, freezing rain, rain-shower, or thunderstorm codes (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 97, 99) → **Rain** by day or **Night rain** after dark.
2. Explicit fog codes (45, 48) → **Fog / Marine Layer** by day or **Night fog** after dark.
3. Clear/mainly clear (code 0 or 1) with at most 25% cloud cover (or unavailable cloud-cover data) → **Sunny** by day or **Clear night** after dark.
4. Remaining clear/cloudy codes (0–3) during daylight use current `direct_normal_irradiance_instant`: above 120 W/m² → **Cloudy**, with bright blue sky; 120 W/m² or less → **Overcast**, with gray clouds. This includes an overcast code when the current sunlight estimate indicates a strong direct beam.
5. At night, sunlight does not determine cloud density. Code 3 or at least 60% cloud cover → **Overcast night**; other cloudy skies → **Cloudy night**. If daytime sunlight is missing or null, the same code/coverage distinction selects **Overcast** or **Cloudy**. A valid zero is weak sunlight, not missing data.
6. Snow conditions retain the generic **Cloudy** / **Cloudy night** approximation.

The sunlight field is returned with the same current timestamp as the weather code and cloud cover. Direct normal irradiance measures radiation perpendicular to the sun rather than on a horizontal surface, reducing the influence of low sun angle on the comparison. The 120 W/m² cutoff follows the sunshine threshold described by Open-Meteo; using it to choose a video is a local presentation rule. It does not infer rain from dim light, high cloud cover, or a forecast probability. These values are model estimates, not an on-site light sensor.

The API's `is_day` field selects day or night. Drizzle and all supported thunderstorm types intentionally share the rain videos, without lightning or hail effects. Low clouds, humidity, and reduced visibility alone do not trigger Fog; snow codes alone do not trigger Rain. SF microclimates may differ from this central city location. Open-Meteo's current conditions are weather-model estimates based on 15-minute data, not a live camera or station observation stream. See the [Open-Meteo API documentation](https://open-meteo.com/en/docs).

Only scenes used by the weather controller download their poster images and videos; inactive scenes start without image, poster, or video URLs. Posters are lossless WebP, verified pixel-for-pixel against their original PNGs. The previous scene remains visible until the next poster decodes. Only the selected video plays. A cached scene may load before fresh weather selects a different one. Requests time out after 10 seconds. Invalid or more-than-two-hour-old data are rejected; outages keep the current scene, show the last known update when usable, and retry after one minute. The latest valid response is cached in local storage when available. Reduced-motion preferences continue to show still posters without video downloads.

Weather data by [Open-Meteo](https://open-meteo.com/), provided under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Weather conditions are mapped to approximate video categories locally. The public API is used for this local preview; commercial deployments should use the appropriate Open-Meteo service plan.

## Complete weather-to-video mapping

This site supports the 28 conditions in the [Open-Meteo code documentation](https://open-meteo.com/en/docs), plus code 97 as a local heavy-thunderstorm compatibility extension. The table covers all 29 supported codes. The baseline columns use missing cloud cover and missing sunlight; the final column records the conditional choices. The API's `is_day` chooses the day or night branch before any sunlight comparison.

Daylight clouds use direct normal irradiance above 120 W/m² for bright Cloudy and at or below 120 W/m² for gray Overcast. Clear/mainly-clear reports with at most 25% or unavailable cloud cover retain the clear-sky scenes. When sunlight is unavailable, code 3 or at least 60% cloud cover selects gray Overcast. This coverage rule also distinguishes cloudy from overcast at night, since darkness alone cannot indicate dense clouds. Invalid values are rejected; zero is never converted into missing data.

Neither the sunlight cutoff nor the 60% cloud-cover fallback changes the provider condition label. Both cloudy visuals still say “Currently cloudy in SF”; only explicit rain or fog codes produce those summaries.

| Code | Reported condition | Day video | Night video | Approximation or exception |
| --- | --- | --- | --- | --- |
| 0 | Clear sky | Sunny | Clear night | Clear at ≤25% or missing coverage. Otherwise daylight: Cloudy above 120 W/m², Overcast at/below it; missing sunlight and night use the 60% coverage fallback. |
| 1 | Mainly clear | Sunny | Clear night | Clear at ≤25% or missing coverage. Otherwise daylight: Cloudy above 120 W/m², Overcast at/below it; missing sunlight and night use the 60% coverage fallback. |
| 2 | Partly cloudy | Cloudy | Cloudy night | Daylight: Cloudy above 120 W/m², Overcast at/below it. Missing sunlight and night: gray variant at ≥60% coverage; otherwise cloudy variant. |
| 3 | Overcast | Overcast | Overcast night | Daylight: Cloudy above 120 W/m²; otherwise Overcast, including missing sunlight. Always Overcast night after dark. |
| 45 | Fog | Fog / Marine Layer | Night fog | Corresponding scene. |
| 48 | Depositing rime fog | Fog / Marine Layer | Night fog | Fog approximation; no rime effect. |
| 51 | Light drizzle | Rain | Night rain | Drizzle shares the rain video. |
| 53 | Moderate drizzle | Rain | Night rain | Drizzle shares the rain video. |
| 55 | Dense drizzle | Rain | Night rain | Drizzle shares the rain video. |
| 56 | Light freezing drizzle | Rain | Night rain | Rain approximation; no freezing or ice effects. |
| 57 | Dense freezing drizzle | Rain | Night rain | Rain approximation; no freezing or ice effects. |
| 61 | Slight rain | Rain | Night rain | One rain intensity for these codes. |
| 63 | Moderate rain | Rain | Night rain | One rain intensity for these codes. |
| 65 | Heavy rain | Rain | Night rain | One rain intensity for these codes. |
| 66 | Light freezing rain | Rain | Night rain | Rain approximation; no freezing or ice effects. |
| 67 | Heavy freezing rain | Rain | Night rain | Rain approximation; no freezing or ice effects. |
| 71 | Slight snowfall | Cloudy | Cloudy night | Generic fallback; no snow effect. |
| 73 | Moderate snowfall | Cloudy | Cloudy night | Generic fallback; no snow effect. |
| 75 | Heavy snowfall | Cloudy | Cloudy night | Generic fallback; no snow effect. |
| 77 | Snow grains | Cloudy | Cloudy night | Generic fallback; no snow effect. |
| 80 | Slight rain showers | Rain | Night rain | One rain intensity for these codes. |
| 81 | Moderate rain showers | Rain | Night rain | One rain intensity for these codes. |
| 82 | Violent rain showers | Rain | Night rain | One rain intensity for these codes. |
| 85 | Slight snow showers | Cloudy | Cloudy night | Generic fallback; no snow effect. |
| 86 | Heavy snow showers | Cloudy | Cloudy night | Generic fallback; no snow effect. |
| 95 | Thunderstorm | Rain | Night rain | Rain approximation; no lightning or hail effect. |
| 96 | Thunderstorm with slight hail | Rain | Night rain | Rain approximation; no lightning or hail effect. |
| 97 | Heavy thunderstorm (compatibility) | Rain | Night rain | Local compatibility extension; not in the official Open-Meteo code table. Rain approximation; no lightning or hail effect. |
| 99 | Thunderstorm with heavy hail | Rain | Night rain | Rain approximation; no lightning or hail effect. |

Snow conditions keep generic cloud videos at every coverage because snow effects are not included. Drizzle, freezing precipitation, and supported thunderstorm types share the rain footage without lightning or hail effects. Explicit rain and fog codes take precedence over coverage and day/night cloud fallbacks.

Verification executes the installed `SFWeather` functions across the supported weather codes, day/night states, cloud-cover boundaries, and direct-sunlight values including zero, the 120 W/m² boundary, missing values, and malformed responses. All 4,698 condition/coverage/sunlight cases and 13 API/parser groups passed, along with the actual page startup, refresh, retry, and playback checks. The machine-readable mapping and current test evidence are in `weather-mapping.json`.

## Footage and license

The Mixkit source pages below offer their clips for personal and commercial use under the [Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree). Fog uses Pexels footage under the [Pexels License](https://www.pexels.com/license/), which permits website use and editing. License and source pages were checked October 21, 2026. Each source clip remains subject to its respective license; the website source is separate from the footage.

- Cloudy and the base blue for Sunny / Clear night: [White clouds moving across a clear blue sky — Mixkit 51102](https://mixkit.co/free-stock-video/white-clouds-moving-across-a-clear-blue-sky-51102/).
- Rain, Night rain, Overcast, and Overcast night cloud layers: [Cloudy sky — Mixkit 118](https://mixkit.co/free-stock-video/cloudy-sky-118/). The rain streaks are generated and composited locally.
- Fog / Marine Layer and Night fog: [Serene Foggy Ocean Horizon View — Ahmed, Pexels 32098125](https://www.pexels.com/video/serene-foggy-ocean-horizon-view-32098125/), cropped to the sky and gently graded.
- Cloudy night: [Blue sky background as the clouds travel blown by the wind — Mixkit 26108](https://mixkit.co/free-stock-video/blue-sky-background-as-the-clouds-travel-blown-by-the-26108/), with a locally composed night color grade and moonlight.

The source clips were edited for these site backgrounds. The final videos are `assets/clouds.webm`, `assets/sunny.webm`, `assets/rain.webm`, `assets/overcast.webm`, `assets/fog.webm`, `assets/night.webm`, `assets/clear-night.webm`, `assets/overcast-night.webm`, `assets/night-rain.webm`, and `assets/night-fog.webm`, with `.mp4` alternatives for compatibility. The unused panorama and earlier image-generation metadata are archived outside the deployed site.

## Dock icons

The Cloud, User, and Email SVG paths come from [Tabler Icons](https://tabler.io/icons) and the [official Tabler repository](https://github.com/tabler/tabler-icons), under the MIT license. The original 24×24 viewBox uses 20×20 px icons, displayed at 19×19 px within the 95% dock scale, with non-scaling 1.5 px strokes. The distributed license is saved as `licenses/tabler-icons.txt`.

## Dock sounds

The dock uses the original Bubble theme from [Cuelume 0.2.8](https://cuelume-site.pages.dev/docs/), served locally from `vendor/cuelume/`. Opening Cloud or User, switching between them, or activating Email plays `select`. Toggling a drawer closed, dismissing it outside the dock, moving focus outside, or pressing Escape plays `close`. Each action triggers at most one cue; switching drawers and activating Email do not also play a close cue. Loading, weather refreshes, resizing, hovering, and arrow-key focus movement stay silent. Native keyboard activation plays the same cues as a click.

Cuelume synthesizes the cues with Web Audio after a user interaction; it loads no recordings and makes no external audio requests. Audio being unavailable or blocked does not prevent the dock from working. The sound adapter directly imports the pinned playback engine, omitting two unused modules without deferring the first click sound. The unmodified package modules are pinned to 0.2.8; `vendor/cuelume/provenance.json` records the registry integrity check, and the MIT license is in `licenses/cuelume.txt`.

## MP4 storage optimization

The ten H.264 compatibility videos were recompressed from the approved exports using CRF 18, the slow preset, and grain tuning. Their combined size changed from 834,609,480 to 134,061,775 bytes. Resolution, frame counts, presentation timestamps, frame rates, durations, color metadata, and original H.264 profiles/levels were preserved. MP4 fast-start metadata is placed before video data. The ten WebM files and all poster images are unchanged.

Verification compared every decoded frame against its corresponding original using SSIM and PSNR, checked exact timestamps and full decoding, inspected comparison frames and native-pixel crops, and exercised all ten MP4s in the browser at their starts, middles, and ends. Compression is lossy; these checks establish close similarity, not pixel identity. Originals and verification reports remain outside the deployable site in the workspace's MP4-compression archive. Only MP4 cache versions changed; existing WebM cache URLs remain stable.

## Loading and mobile delivery

An uncached visit displays the lightweight CSS sky while current weather resolves, without downloading a speculative Cloudy poster. A fresh cached weather scene paints immediately. Only a failed initial weather request loads the Cloudy fallback; subsequent outages retain the last scene and report unavailable or last-known weather. This avoids the extra 1,237,834-byte default poster on successful non-Cloudy cold starts.

Portrait viewports at most 600 CSS pixels wide and no wider than 9:16 use the `.mobile-v94` videos. These 608×1080 files remove the horizontal pixels already outside the portrait frame, retaining the full vertical resolution, existing object positions, frame rates, and loop lengths. Wider layouts keep the desktop files. Rotating out of portrait upgrades the active video once, preserving its playback position and paused state; it never repeatedly downloads different tiers on later rotations. Inactive scenes still load nothing until used. The fallback chain is mobile WebM, mobile MP4, desktop MP4, then the matching still image.

The twenty mobile files total 55,783,560 bytes, 70.20% less than the corresponding desktop library. MP4 totals 41,463,653 bytes (69.07% less) and WebM 14,319,907 bytes (73.04% less). Additional variants increase package storage while lowering phone transfer and decoding requirements; visitors receive only the active scene and supported format.

## HTTP delivery

The included Python server negotiates gzip for text resources, validates cached responses, and keeps video byte ranges uncompressed. The current main-page HTML, CSS, scripts, icon, and imported audio modules total about 112 KB uncompressed and 36.5 KB with gzip. Versioned asset URLs cache for one year; HTML and unversioned module imports revalidate. Change the version whenever a versioned asset changes.

`hosting/SETUP.txt` documents the policy, checks, and a matching `hosting/nginx.conf` example for a future static deployment. The example must be adapted and verified on the selected host; no public deployment is implied. The local server uses only Python's standard library.

The weather drawer includes the current Fahrenheit temperature rounded to the nearest whole degree: `Currently [temperature]°F and [condition] in San Francisco`. A missing temperature omits the number and conjunction rather than inventing a value. Loading and unavailable messages also spell out San Francisco.

## Social sharing preview

The canonical site URL is `https://chrisshu.com/`. Open Graph video metadata points to `assets/og-cloudy-v117.mp4`, a 13-second, 768×432, 24 fps H.264 video derived from the user-supplied file `istockphoto-107212526-640_adpp_is.mp4` (iStock video 107212526). The uploaded file was processed locally at the user’s request to reduce its stationary translucent watermark while preserving the moving clouds. The original upload remains unchanged. The selected section begins about 16 seconds into the original upload: the first second of the prior preview is removed, and the end is shortened slightly to make a 13-second clip. The 312 retained consecutive frames play at 24 fps, a 0.1% timing adjustment from the source. This is a preview-resolution source; the output preserves the source resolution. The MP4 is silent and uses fast-start metadata. Twitter Player Card metadata points to `preview-player.html`, which loops the video natively. `assets/og-cloudy-v117.jpg` is the matching poster and image fallback.

This preview always uses bright cloudy skies, regardless of live weather. Metadata is in the initial HTML, so crawlers do not need JavaScript; the main website does not preload the sharing media. Publish the complete site at the configured domain before validating public previews. Video support, autoplay, and fallback selection are controlled by the app displaying the shared link; these tags cannot force every app to play video.


## GitHub Pages

The live site is https://chrisshu.com/ and publishes automatically from the root of `main` in `cjsxyz/cjsxyz.github.io`. Keep `CNAME` set to `chrisshu.com`; `.nojekyll` publishes the files directly as a static site. The Python preview server and sample Nginx configuration are optional local/self-hosted helpers, not production dependencies. GitHub Pages controls production caching and compression.
