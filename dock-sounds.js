import { play } from './vendor/cuelume/audio/engine.js';

// Use Cuelume's original Bubble cues. Importing the library is silent;
// its AudioContext starts only after an interaction requests playback.
window.DockSounds = Object.freeze({
  play(cue) {
    if (cue === 'select' || cue === 'close') {
      play(cue, { theme: 'bubble' });
    }
  },
});
