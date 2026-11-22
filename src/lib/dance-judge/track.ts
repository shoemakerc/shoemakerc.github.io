import { analyze, estimateKey, type Analysis } from "./analyze";

// A whole song, heard the way the judge hears a preview: thirty seconds at a
// time. The scoring model was fit on 30-second clips, so each section is
// analyzed as one, and judge.ts combines the scores. Like analyze.ts this is
// plain math with no DOM, so it runs in a worker or in Node.

export type Section = {
  /** Seconds from the start of the song. */
  start: number;
  end: number;
  analysis: Analysis;
};

export type TrackAnalysis = {
  /** Song length in seconds. */
  duration: number;
  sections: Section[];
  /** Pitch class of the tonic over the whole song, 0 = C. */
  key: number;
  /** 1 for major, 0 for minor. */
  mode: number;
  /** Loudness over the song, 0–1, for drawing. */
  level: number[];
};

const SECTION_SECONDS = 30;
// Half-overlapping sections, so a chorus that straddles a boundary is still
// heard whole by one of them.
const STEP_SECONDS = 15;
/** Shorter than this and there isn't enough to find a beat in. */
export const MIN_SECONDS = 8;
// Sections this far below the loudest are lead-in or run-out silence.
const SILENCE_DB = 40;
const LEVEL_POINTS = 480;

export function analyzeTrack(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): TrackAnalysis {
  const duration = samples.length / sampleRate;
  if (duration < MIN_SECONDS) throw new Error("Too short to judge");

  const size = Math.round(SECTION_SECONDS * sampleRate);
  const step = Math.round(STEP_SECONDS * sampleRate);
  const starts: number[] = [];
  if (samples.length <= size) starts.push(0);
  else {
    for (let s = 0; s + size <= samples.length; s += step) starts.push(s);
    // Whatever the grid leaves over at the end still gets heard.
    const last = samples.length - size;
    if (last - starts[starts.length - 1] > step / 3) starts.push(last);
  }

  const loudness = starts.map((s) => rmsDb(samples, s, Math.min(samples.length, s + size)));
  const floor = Math.max(...loudness) - SILENCE_DB;
  const sections: Section[] = [];
  starts.forEach((s, i) => {
    if (loudness[i] > floor) {
      const end = Math.min(samples.length, s + size);
      sections.push({
        start: s / sampleRate,
        end: end / sampleRate,
        analysis: analyze(samples.subarray(s, end), sampleRate),
      });
    }
    onProgress?.((i + 1) / starts.length);
  });
  if (!sections.length) throw new Error("Nothing but silence");

  const key = estimateKey(samples, sampleRate);
  return { duration, sections, key: key.tonic, mode: key.mode, level: levels(samples) };
}

function rmsDb(samples: Float32Array, from: number, to: number) {
  let energy = 0;
  for (let i = from; i < to; i++) energy += samples[i] * samples[i];
  return 10 * Math.log10(energy / Math.max(1, to - from) + 1e-12);
}

/** RMS in LEVEL_POINTS slices, scaled so the loudest is 1. */
function levels(samples: Float32Array) {
  const out: number[] = [];
  const size = samples.length / LEVEL_POINTS;
  for (let i = 0; i < LEVEL_POINTS; i++) {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let energy = 0;
    for (let j = from; j < to; j++) energy += samples[j] * samples[j];
    out.push(Math.sqrt(energy / (to - from)));
  }
  const top = Math.max(...out) || 1;
  return out.map((x) => Math.round((x / top) * 1000) / 1000);
}
