.pragma library

// What each bundled preset is for, in words, because an EasyEffects preset has
// no description field and its filename is the only thing a stranger gets.
//
// This table holds only what cannot be read out of the preset itself. The
// effect chain, the impulse responses a preset needs and its EQ curve are all
// in the JSON, so they are read from there rather than written twice and left
// to drift apart.
//
// The four presets built on the Perfect EQ curve say so. Ten unrelated names
// is a list; four families is something a person can hold in their head.

var CATALOGUE = {
  "Perfect EQ": {
    summary: "A mild ten-band correction. A little weight at 32 and 64 Hz, a small scoop through the lower mids, a lift above 4 kHz.",
    use: "The one to try first. Three of the presets below are this exact curve with a stage added after it."
  },

  "Bass Enhancing + Perfect EQ": {
    summary: "The Perfect EQ curve, then a convolution stage that adds width and low end from a stereo impulse response.",
    use: "For music on headphones or decent speakers, where the extra processing delay does not matter."
  },

  "Bass Enhancing + Perfect EQ - Low Latency": {
    summary: "The same as above with a much shorter impulse response and a limiter after it, so it adds a fraction of the delay.",
    use: "Anything interactive. Games, calls, and video where lips and sound have to stay together."
  },

  "Bass Boosted": {
    summary: "The Perfect EQ curve, the convolution stage, then a harmonic bass enhancer, crossfeed and a maximizer.",
    use: "The heaviest low end in the set. For earbuds and small speakers with no bass of their own."
  },

  "Boosted": {
    summary: "The same idea as Perfect EQ pushed harder: +5 dB at 32 and 64 Hz and +4 dB at 4 kHz.",
    use: "When a quiet recording needs more of everything at both ends.",
    caution: "The largest boost here and nothing limits it afterwards. Drop the volume before switching to it on headphones."
  },

  "Advanced Auto Gain": {
    summary: "A thirty-band curve lifting 113 to 358 Hz and dipping 1.1 kHz, then an exciter, automatic gain and a limiter.",
    use: "Evens out sources that were mastered at wildly different levels, so a mixed playlist stops needing the volume key."
  },

  "Loudness+Autogain": {
    summary: "The same thirty-band curve, followed by a loudness contour, automatic gain, a compressor and crossfeed.",
    use: "For listening quietly. The loudness stage keeps the bass and treble audible at a volume where they would otherwise disappear."
  },

  "Laptop": {
    summary: "A noise gate, upward compression and a limiter wrapped around a gentle smile curve.",
    use: "Built for small laptop speakers. It raises the quiet detail those drivers lose and holds down the peaks that make them buzz."
  },

  "Dolby Atmos": {
    summary: "A rising curve, a harmonic bass enhancer, a widened stereo image and a small large-room reverb.",
    use: "An effect rather than a correction, for a wide and spacious sound.",
    caution: "Not accurate, and nothing to do with Dolby's own processing beyond the name it was given."
  },

  "Speaker Sync": {
    summary: "Crossfeed, with a six-band EQ that moves nothing by more than half a decibel.",
    use: "Crossfeed bleeds a little of each channel into the other, which makes hard-panned stereo far less tiring on headphones.",
    caution: "The name is wrong. Its delay stage is set to zero, so it time-aligns nothing."
  }
}

function names() {
  return Object.keys(CATALOGUE)
}

function describe(name) {
  return CATALOGUE[name] || null
}

// True for a preset this plugin ships, which is what lets the panel mark the
// bundled ones apart from presets the user made.
function isBundled(name) {
  return Object.prototype.hasOwnProperty.call(CATALOGUE, name)
}
