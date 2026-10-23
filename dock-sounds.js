import { play, unlock } from './vendor/cuelume/audio/engine.js';

// Use Cuelume's original Bubble cues. Importing the library is silent;
// its AudioContext starts only after an interaction requests playback.
window.DockSounds = Object.freeze({
  unlock,
  play(cue) {
    if (cue === 'select' || cue === 'close' || cue === 'success') {
      play(cue, { theme: 'bubble' });
    }
  },
});
