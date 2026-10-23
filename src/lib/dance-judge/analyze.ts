// Listens to a short clip and measures what the 2017 Dance Judge used to ask
// Spotify for: how strong and steady the beat is, how fast it goes, what key
// it's in, and how loud and bright it sounds. Plain math on mono samples with
// no DOM and no imports, so the calibration script can run it in Node too.

export type Features = {
  /** How periodic the onsets are at the strongest beat lag (0–1). */
  pulse: number;
  /** The same, for the kick-drum range only. */
  pulseLow: number;
  /** Average periodicity at the chosen tempo over 6-second windows (0–1). */
  stability: number;
  /** Onset strength on the beat, relative to the average. */
  onBeat: number;
  /** Onset strength halfway between beats, relative to the average. */
  offBeat: number;
  /** Share of the energy that's percussive rather than sustained (0–1). */
  percussive: number;
  /** Onsets per second. */
  onsetRate: number;
  /** Average onset strength in dB-per-frame, before normalizing. */
  flux: number;
  /** The same, above 2 kHz: hi-hats, cymbals, distortion. */
  airFlux: number;
  /** Share of the energy below 150 Hz. */
  bass: number;
  /** Peak-to-average level in dB (median over one-second windows); low when squashed loud. */
  crest: number;
  /** K-weighted loudness in dB, gated like EBU R128 (roughly LUFS). */
  loudness: number;
  /** Spread between loud and quiet passages, in dB. */
  dynamics: number;
  /** Spectral centroid in Hz. */
  centroid: number;
  /** Spectral flatness (0 = tonal, 1 = noise). */
  flatness: number;
  /** Share of the energy above 4 kHz. */
  brightness: number;
  /** How well the clip fits its best key profile (correlation, −1–1). */
  keyStrength: number;
};

export type Analysis = {
  /** Beats per minute. */
  tempo: number;
  /** Pitch class of the tonic, 0 = C. */
  key: number;
  /** 1 for major, 0 for minor. */
  mode: number;
  features: Features;
  /** Onset strength over the clip, 0–1, for drawing. */
  envelope: number[];
  /** Beat times in seconds. */
  beats: number[];
  /** Clip length in seconds. */
  duration: number;
};

const ENVELOPE_POINTS = 240;

export function analyze(samples: Float32Array, sampleRate: number): Analysis {
  const rhythm = rhythmFrames(samples, sampleRate);
  const { onset, fps } = rhythm;

  const acf = autocorrelate(onset, Math.ceil(fps * 2.6));
  const tempo = pickTempo(acf, fps);
  const period = (60 * fps) / tempo;

  let pulse = 0;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    pulse = Math.max(pulse, at(acf, (60 * fps) / bpm));
  }
  const acfLow = autocorrelate(rhythm.onsetLow, Math.ceil(period * 1.1));
  const pulseLow = peakNear(acfLow, period);

  const phase = beatPhase(onset, period);
  const beats: number[] = [];
  for (let t = phase; t < onset.length; t += period) beats.push(t / fps);

  const key = estimateKey(samples, sampleRate);

  const features: Features = {
    pulse,
    pulseLow,
    stability: localStability(onset, period, fps),
    onBeat: gridStrength(onset, phase, period),
    offBeat: gridStrength(onset, phase + period / 2, period),
    percussive: rhythm.percussive,
    onsetRate: countOnsets(onset, fps) / (onset.length / fps),
    flux: rhythm.flux,
    airFlux: rhythm.airFlux,
    bass: rhythm.bass,
    crest: crestFactor(samples, sampleRate),
    loudness: rhythm.loudness,
    dynamics: rhythm.dynamics,
    centroid: rhythm.centroid,
    flatness: rhythm.flatness,
    brightness: rhythm.brightness,
    keyStrength: key.strength,
  };

  return {
    tempo,
    key: key.tonic,
    mode: key.mode,
    features,
    envelope: downsample(onset, ENVELOPE_POINTS),
    beats,
    duration: samples.length / sampleRate,
  };
}

// ---------- Spectra ----------

type Plan = { n: number; rev: Uint32Array; cos: Float64Array; sin: Float64Array; window: Float64Array };

function plan(n: number): Plan {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return { n, rev, cos, sin, window };
}

/** Power spectrum (n/2 + 1 bins) of the windowed frame starting at `start`. */
function powerSpectrum(
  samples: Float32Array,
  start: number,
  p: Plan,
  re: Float64Array,
  im: Float64Array,
  out: Float64Array,
) {
  const { n, rev, cos, sin, window } = p;
  for (let i = 0; i < n; i++) {
    const s = start + i;
    re[rev[i]] = s < samples.length ? samples[s] * window[i] : 0;
    im[i] = 0;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let base = 0; base < n; base += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = -sin[k * step];
        const a = base + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
}

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);

type Band = { lo: number; weights: Float64Array; center: number };

function melBands(n: number, sampleRate: number, count: number, fMin: number, fMax: number): Band[] {
  const binHz = sampleRate / n;
  const edges: number[] = [];
  for (let i = 0; i < count + 2; i++) {
    edges.push(melToHz(hzToMel(fMin) + ((hzToMel(fMax) - hzToMel(fMin)) * i) / (count + 1)));
  }
  const bands: Band[] = [];
  for (let b = 0; b < count; b++) {
    const [left, center, right] = [edges[b], edges[b + 1], edges[b + 2]];
    const lo = Math.max(1, Math.floor(left / binHz));
    const hi = Math.min(n / 2, Math.ceil(right / binHz));
    const weights = new Float64Array(Math.max(1, hi - lo + 1));
    for (let k = lo; k <= hi; k++) {
      const f = k * binHz;
      const w = f <= center ? (f - left) / (center - left) : (right - f) / (right - center);
      weights[k - lo] = Math.max(0, w);
    }
    // Very low bands can be narrower than one bin; give them the nearest one.
    if (weights.every((w) => w === 0)) weights[Math.min(weights.length - 1, Math.round(center / binHz) - lo)] = 1;
    bands.push({ lo, weights, center });
  }
  return bands;
}

// ---------- Rhythm ----------

const MEL_BANDS = 40;
const LOW_HZ = 160;
const AIR_HZ = 2000;

/**
 * One pass over the clip in ~46 ms frames: an onset-strength envelope (how
 * much new sound arrives in each frame), the same for the bass range, and
 * the loudness and timbre numbers.
 */
function rhythmFrames(samples: Float32Array, sampleRate: number) {
  const n = 2 ** Math.round(Math.log2(sampleRate * 0.046));
  const hop = n / 4;
  const fps = sampleRate / hop;
  const frames = Math.max(1, Math.floor((samples.length - n) / hop) + 1);
  const p = plan(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const power = new Float64Array(n / 2 + 1);
  const bands = melBands(n, sampleRate, MEL_BANDS, 30, Math.min(11000, sampleRate / 2));
  const low = bands.filter((b) => b.center < LOW_HZ).length;
  const air = bands.findIndex((b) => b.center >= AIR_HZ);
  const binHz = sampleRate / n;
  const hfBin = Math.ceil(4000 / binHz);
  const bassBin = Math.floor(150 / binHz);
  // The K-weighting curve loudness meters use: roll off the deep bass, lift
  // the presence range a few dB, the way ears do.
  const kWeight = new Float64Array(n / 2 + 1);
  for (let k = 1; k <= n / 2; k++) {
    const f = k * binHz;
    kWeight[k] = (f ** 4 / (f ** 4 + 38 ** 4)) * (1 + ((10 ** 0.4 - 1) * f * f) / (f * f + 1500 ** 2));
  }

  const mel = new Float64Array(frames * MEL_BANDS);
  const frameDb = new Float64Array(frames);
  const centroid = new Float64Array(frames);
  const flatness = new Float64Array(frames);
  const brightness = new Float64Array(frames);
  const bass = new Float64Array(frames);
  const heard = new Float64Array(frames);

  for (let t = 0; t < frames; t++) {
    powerSpectrum(samples, t * hop, p, re, im, power);
    let total = 0;
    let weighted = 0;
    let high = 0;
    let lowEnd = 0;
    let logSum = 0;
    let weightedPower = 0;
    for (let k = 1; k <= n / 2; k++) {
      total += power[k];
      weightedPower += kWeight[k] * power[k];
      weighted += power[k] * k * binHz;
      if (k >= hfBin) high += power[k];
      if (k <= bassBin) lowEnd += power[k];
      logSum += Math.log(power[k] + 1e-12);
    }
    const mean = total / (n / 2);
    centroid[t] = total > 0 ? weighted / total : 0;
    flatness[t] = mean > 0 ? Math.exp(logSum / (n / 2)) / mean : 0;
    brightness[t] = total > 0 ? high / total : 0;
    bass[t] = total > 0 ? lowEnd / total : 0;
    // Mean square of the frame, by Parseval (one-sided spectrum, Hann window).
    heard[t] = (weightedPower * 16) / (3 * n * n);

    let energy = 0;
    for (let i = 0; i < n; i++) {
      const s = t * hop + i;
      if (s < samples.length) energy += samples[s] * samples[s];
    }
    frameDb[t] = 10 * Math.log10(energy / n + 1e-12);

    for (let b = 0; b < MEL_BANDS; b++) {
      const { lo, weights } = bands[b];
      let sum = 0;
      for (let i = 0; i < weights.length; i++) sum += weights[i] * power[lo + i];
      mel[t * MEL_BANDS + b] = sum;
    }
  }

  // Ignore near-silence (fades, gaps) in the loudness and timbre averages.
  const loudest = Math.max(...frameDb);
  const active: number[] = [];
  for (let t = 0; t < frames; t++) if (frameDb[t] > loudest - 50) active.push(t);
  const meanOver = (xs: Float64Array) => active.reduce((s, t) => s + xs[t], 0) / active.length;
  // Loudness meters gate out anything 20 dB below the loudest passages.
  const heardDb = Array.from(heard, (e) => 10 * Math.log10(e + 1e-12));
  const gate = Math.max(...heardDb) - 20;
  const gated = heardDb.filter((d) => d > gate);
  const meanHeard = gated.reduce((s, d) => s + 10 ** (d / 10), 0) / gated.length;
  const sortedDb = active.map((t) => frameDb[t]).sort((a, b) => a - b);

  // Onset strength: rises in log band energy, averaged across bands.
  const db = new Float64Array(mel.length);
  let maxDb = -Infinity;
  for (let i = 0; i < mel.length; i++) {
    db[i] = 10 * Math.log10(mel[i] + 1e-10);
    maxDb = Math.max(maxDb, db[i]);
  }
  for (let i = 0; i < db.length; i++) db[i] = Math.max(db[i], maxDb - 80);
  const onset = new Float64Array(frames);
  const onsetLow = new Float64Array(frames);
  let airRise = 0;
  for (let t = 1; t < frames; t++) {
    let all = 0;
    let lowRise = 0;
    for (let b = 0; b < MEL_BANDS; b++) {
      const rise = Math.max(0, db[t * MEL_BANDS + b] - db[(t - 1) * MEL_BANDS + b]);
      all += rise;
      if (b < low) lowRise += rise;
      if (b >= air) airRise += rise;
    }
    onset[t] = all / MEL_BANDS;
    onsetLow[t] = lowRise / Math.max(1, low);
  }
  const flux = onset.reduce((s, x) => s + x, 0) / frames;

  return {
    onset,
    onsetLow,
    fps,
    flux,
    airFlux: airRise / frames / (MEL_BANDS - air),
    bass: meanOver(bass),
    percussive: percussiveShare(mel, frames),
    loudness: 10 * Math.log10(meanHeard + 1e-12),
    dynamics: percentile(sortedDb, 0.95) - percentile(sortedDb, 0.1),
    centroid: meanOver(centroid),
    flatness: meanOver(flatness),
    brightness: meanOver(brightness),
  };
}

/**
 * Harmonic/percussive split by median filtering (Fitzgerald 2010), on the mel
 * spectrogram to keep it cheap: sustained notes are smooth across time, hits
 * are smooth across frequency.
 */
function percussiveShare(mel: Float64Array, frames: number) {
  const timeSpan = 8;
  const bandSpan = 4;
  const buf: number[] = [];
  let perc = 0;
  let total = 0;
  for (let t = 0; t < frames; t++) {
    for (let b = 0; b < MEL_BANDS; b++) {
      buf.length = 0;
      for (let u = Math.max(0, t - timeSpan); u <= Math.min(frames - 1, t + timeSpan); u++) {
        buf.push(mel[u * MEL_BANDS + b]);
      }
      const h = median(buf);
      buf.length = 0;
      for (let c = Math.max(0, b - bandSpan); c <= Math.min(MEL_BANDS - 1, b + bandSpan); c++) {
        buf.push(mel[t * MEL_BANDS + c]);
      }
      const pc = median(buf);
      const s = mel[t * MEL_BANDS + b];
      const mask = h + pc > 0 ? (pc * pc) / (h * h + pc * pc) : 0;
      perc += mask * s;
      total += s;
    }
  }
  return total > 0 ? perc / total : 0;
}

function crestFactor(samples: Float32Array, sampleRate: number) {
  const crests: number[] = [];
  for (let start = 0; start + sampleRate <= samples.length; start += sampleRate) {
    let peak = 0;
    let energy = 0;
    for (let i = start; i < start + sampleRate; i++) {
      peak = Math.max(peak, Math.abs(samples[i]));
      energy += samples[i] * samples[i];
    }
    if (energy > 0) crests.push(20 * Math.log10(peak / Math.sqrt(energy / sampleRate)));
  }
  return crests.length ? median(crests) : 0;
}

/** Normalized autocorrelation of the mean-removed signal, lags 0..maxLag. */
function autocorrelate(x: Float64Array, maxLag: number) {
  const n = x.length;
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const d = x.map((v) => v - mean);
  const r = new Float64Array(Math.min(maxLag, n - 1) + 1);
  let zero = 0;
  for (let i = 0; i < n; i++) zero += d[i] * d[i];
  if (zero === 0) return r;
  for (let lag = 0; lag < r.length; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += d[i] * d[i + lag];
    // Unbiased: don't penalize long lags for having fewer overlapping frames.
    r[lag] = (sum / zero) * (n / (n - lag));
  }
  return r;
}

/** Linear interpolation into an array at a fractional index. */
function at(xs: ArrayLike<number>, i: number) {
  const lo = Math.floor(i);
  if (lo < 0 || lo + 1 >= xs.length) return 0;
  return xs[lo] + (xs[lo + 1] - xs[lo]) * (i - lo);
}

function peakNear(acf: Float64Array, lag: number) {
  let best = 0;
  for (let l = lag * 0.96; l <= lag * 1.04; l += 0.25) best = Math.max(best, at(acf, l));
  return best;
}

/**
 * Strongest periodicity between 55 and 215 BPM, weighted toward ~120 the way
 * listeners tap along (a log-normal prior, as in librosa's beat tracker), and
 * checked against the half and double tempo so a busy hi-hat doesn't win.
 */
function pickTempo(acf: Float64Array, fps: number) {
  let best = 120;
  let bestScore = -Infinity;
  for (let bpm = 55; bpm <= 215; bpm += 0.25) {
    const lag = (60 * fps) / bpm;
    const r = at(acf, lag) + 0.5 * at(acf, lag * 2) + 0.25 * at(acf, lag / 2);
    const prior = -0.5 * (Math.log2(bpm / 120) / 0.9) ** 2;
    const score = Math.log(Math.max(r, 1e-4)) + prior;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return Math.round(best * 10) / 10;
}

/** The offset (in frames) of the beat grid that lines up with the most onsets. */
function beatPhase(onset: Float64Array, period: number) {
  let best = 0;
  let bestSum = -Infinity;
  for (let phase = 0; phase < period; phase += 0.5) {
    let sum = 0;
    for (let t = phase; t < onset.length; t += period) sum += localMax(onset, t);
    if (sum > bestSum) {
      bestSum = sum;
      best = phase;
    }
  }
  return best;
}

function localMax(xs: Float64Array, i: number) {
  const c = Math.round(i);
  let m = 0;
  for (let j = c - 1; j <= c + 1; j++) if (j >= 0 && j < xs.length) m = Math.max(m, xs[j]);
  return m;
}

function gridStrength(onset: Float64Array, phase: number, period: number) {
  const mean = onset.reduce((s, x) => s + x, 0) / onset.length;
  if (mean === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let t = phase; t < onset.length; t += period) {
    sum += localMax(onset, t);
    count++;
  }
  return count ? sum / count / mean : 0;
}

function localStability(onset: Float64Array, period: number, fps: number) {
  const size = Math.round(6 * fps);
  const hop = Math.round(1.5 * fps);
  if (onset.length <= size) return peakNear(autocorrelate(onset, Math.ceil(period * 1.1)), period);
  const strengths: number[] = [];
  for (let start = 0; start + size <= onset.length; start += hop) {
    const acf = autocorrelate(onset.subarray(start, start + size), Math.ceil(period * 1.1));
    strengths.push(peakNear(acf, period));
  }
  return strengths.reduce((s, x) => s + x, 0) / strengths.length;
}

function countOnsets(onset: Float64Array, fps: number) {
  const mean = onset.reduce((s, x) => s + x, 0) / onset.length;
  const sd = Math.sqrt(onset.reduce((s, x) => s + (x - mean) ** 2, 0) / onset.length);
  const threshold = mean + 0.5 * sd;
  const gap = Math.round(0.05 * fps);
  let count = 0;
  let last = -Infinity;
  for (let t = 1; t < onset.length - 1; t++) {
    if (onset[t] > threshold && onset[t] >= onset[t - 1] && onset[t] > onset[t + 1] && t - last >= gap) {
      count++;
      last = t;
    }
  }
  return count;
}

// ---------- Key ----------

// Temperley's key profiles ("What's Key for Key?", 1999), from the tonic up,
// with the flat seventh raised: pop leans on it (Mixolydian riffs, natural
// minor) far more than the classical music the profiles came from. On 42
// songs with well-known keys this named 32 right, to 23 for the original
// profiles and 20 for Spotify's own key data.
const MAJOR = [5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 2.5, 4];
const MINOR = [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 3.5, 2.5];

/**
 * A pitch-class histogram from spectral peaks between 80 Hz and 1.5 kHz (the
 * fundamentals, mostly, rather than their overtones) in ~370 ms frames,
 * matched against the 24 major and minor key profiles.
 */
function estimateKey(samples: Float32Array, sampleRate: number) {
  const n = 2 ** Math.round(Math.log2(sampleRate * 0.37));
  const hop = n / 2;
  const p = plan(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const power = new Float64Array(n / 2 + 1);
  const binHz = sampleRate / n;
  const lo = Math.ceil(80 / binHz);
  const hi = Math.min(n / 2 - 1, Math.floor(1500 / binHz));
  const chroma = new Float64Array(12);
  const frame = new Float64Array(12);

  for (let start = 0; start + n <= samples.length; start += hop) {
    powerSpectrum(samples, start, p, re, im, power);
    frame.fill(0);
    let peak = 0;
    for (let k = lo; k <= hi; k++) peak = Math.max(peak, power[k]);
    if (peak === 0) continue;
    for (let k = lo; k <= hi; k++) {
      const m = power[k];
      if (m < peak * 1e-4 || m <= power[k - 1] || m < power[k + 1]) continue;
      // Parabolic interpolation on log power for the true peak frequency.
      const [a, b, c] = [Math.log(power[k - 1] + 1e-12), Math.log(m), Math.log(power[k + 1] + 1e-12)];
      const offset = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
      const midi = 69 + 12 * Math.log2(((k + offset) * binHz) / 440);
      const nearest = Math.round(midi);
      const cents = Math.abs(midi - nearest);
      if (cents > 0.4) continue;
      frame[((nearest % 12) + 12) % 12] += Math.sqrt(m) * (1 - cents / 0.4);
    }
    const sum = frame.reduce((s, x) => s + x, 0);
    if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / sum;
  }

  let best = { tonic: 0, mode: 1, strength: -1 };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [
      [1, MAJOR],
      [0, MINOR],
    ] as const) {
      const rotated = Array.from({ length: 12 }, (_, i) => profile[(i - tonic + 12) % 12]);
      const strength = correlation(Array.from(chroma), rotated);
      if (strength > best.strength) best = { tonic, mode, strength };
    }
  }
  return best;
}

// ---------- Helpers ----------

function correlation(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    dbb += (b[i] - mb) ** 2;
  }
  return da && dbb ? num / Math.sqrt(da * dbb) : 0;
}

function median(xs: number[]) {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

function downsample(xs: Float64Array, points: number) {
  const out: number[] = [];
  const size = xs.length / points;
  for (let i = 0; i < points; i++) {
    let m = 0;
    for (let j = Math.floor(i * size); j < Math.min(xs.length, Math.floor((i + 1) * size)); j++) m = Math.max(m, xs[j]);
    out.push(m);
  }
  const sorted = out.slice().sort((a, b) => a - b);
  const top = percentile(sorted, 0.98) || 1;
  return out.map((x) => Math.round(Math.min(1, x / top) * 1000) / 1000);
}
