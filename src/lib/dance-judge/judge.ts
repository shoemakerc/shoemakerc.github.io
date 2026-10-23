import type { Analysis } from "./analyze";

// Turns what the analyzer heard into Spotify's old 0–1 scales. The weights
// come from scripts/calibrate-dance-judge.mjs: ridge regressions against
// Spotify's archived audio features (as mirrored by ReccoBeats) for 295
// songs, measured on the same 30-second previews the page plays. On songs
// held out of the fit, danceability correlates with Spotify's at r = 0.79
// (typically within 0.09) and energy at r = 0.79 (within 0.11).

export const INPUT_NAMES = [
  "pulse",
  "pulseLow",
  "stability",
  "log onBeat",
  "log offBeat",
  "percussive",
  "onsetRate",
  "log flux",
  "log airFlux",
  "bass",
  "crest",
  "loudness",
  "dynamics",
  "log centroid",
  "log flatness",
  "log brightness",
  "keyStrength",
  "major",
  "tempo octave",
  "tempo octave²",
] as const;

type Model = { intercept: number; coef: number[] };

/** The model inputs, in INPUT_NAMES order. */
export function inputs(a: Pick<Analysis, "features" | "tempo" | "mode">): number[] {
  const f = a.features;
  const octave = Math.log2(a.tempo / 120);
  return [
    f.pulse,
    f.pulseLow,
    f.stability,
    Math.log(f.onBeat || 1),
    Math.log(f.offBeat || 1),
    f.percussive,
    f.onsetRate,
    Math.log(f.flux || 1e-3),
    Math.log(f.airFlux || 1e-3),
    f.bass,
    f.crest,
    f.loudness,
    f.dynamics,
    Math.log(f.centroid || 1),
    Math.log(f.flatness || 1e-6),
    Math.log(f.brightness || 1e-6),
    f.keyStrength,
    a.mode,
    octave,
    octave * octave,
  ];
}

// Rerun `npm run calibrate:dance-judge` after changing the analyzer or inputs().
const DANCEABILITY: Model = {
  intercept: 0.096,
  coef: [
    0.00338, 0.09491, -0.02825, 0.0707, -0.03045, 0.2291, -0.03508, 0.45168, 0.13936, 0.08968,
    -0.00932, 0.00167, 0.00227, 0.09151, -0.02232, 0.00668, 0.01248, 0.00404, -0.01137, -0.14844,
  ],
};

const ENERGY: Model = {
  intercept: -0.09529,
  coef: [
    0.20594, 0.12045, -0.03593, 0.03755, -0.00162, 0.42856, -0.00396, 0.11153, -0.0776, 0.01965,
    -0.00807, 0.02, -0.01259, 0.18728, 0.05793, -0.03075, -0.19942, 0.00977, 0.01019, -0.19255,
  ],
};

const score = (m: Model, x: number[]) =>
  Math.min(1, Math.max(0, x.reduce((s, xi, i) => s + m.coef[i] * xi, m.intercept)));

// The 2017 verdicts, unchanged.
const VERDICTS: [number, string][] = [
  [0.25, "You’re gonna look silly dancing to this…"],
  [0.45, "You can try to dance to this, but it might look a bit weird."],
  [0.6, "Alright, I guess I’ll allow it."],
  [0.85, "I recommend you get down to this."],
  [Infinity, "A complete banger. I hope you’re busting moves right now."],
];

/** Where the verdicts change, for drawing the meter. */
export const THRESHOLDS = VERDICTS.slice(0, -1).map(([t]) => t);

// Below this beat strength the onsets barely repeat (ambient, rubato piano),
// and in calibration three in four tempo guesses down there were wrong.
const STEADY_PULSE = 0.14;

const MAJOR_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

export type Verdict = {
  danceability: number;
  energy: number;
  line: string;
  /** Beats per minute, or null when there's no steady beat to count. */
  tempo: number | null;
  key: string;
};

export function judge(a: Analysis): Verdict {
  const x = inputs(a);
  const danceability = score(DANCEABILITY, x);
  return {
    danceability,
    energy: score(ENERGY, x),
    line: VERDICTS.find(([limit]) => danceability < limit)![1],
    tempo: a.features.pulse >= STEADY_PULSE ? Math.round(a.tempo) : null,
    key: `${(a.mode ? MAJOR_NAMES : MINOR_NAMES)[a.key]} ${a.mode ? "major" : "minor"}`,
  };
}
