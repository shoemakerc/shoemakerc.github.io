import { keyMove, type Camelot, type KeyMove } from "./camelot";

// Scores the move from each track to the next on key and tempo, then searches
// for the running order with the lowest total. A set is a path, not a loop,
// and the cost isn't symmetric (an energy boost up the wheel is easier than
// the same jump down), so this is a small asymmetric travelling-salesman
// problem. Sets are short enough that restarts plus local moves get there.

export type Arc = "smooth" | "build" | "peak";

export type Mixable = {
  bpm: number | null;
  key: Camelot | null;
  /** 0–1, from the Dance Judge's energy model; null when unknown. */
  energy: number | null;
};

export type TempoMove = {
  /** Percent the incoming track has to be pitched to match, signed. */
  percent: number;
  /** True when the match is at half or double time. */
  halfTime: boolean;
  cost: number;
};

export type Transition = { key: KeyMove | null; tempo: TempoMove | null; cost: number };

// Most decks pitch ±8% before the track starts sounding wrong, and under 2%
// nobody notices. Unknown keys or tempos cost a little, so known-good moves
// win, but not so much that they all get pushed to one end.
const COMFORT_PERCENT = 2;
const PITCH_LIMIT = 8;
const UNKNOWN_COST = 1.5;

export function tempoMove(from: number, to: number): TempoMove {
  const options = [1, 2, 0.5].map((factor) => ({
    factor,
    percent: ((to * factor) / from - 1) * 100,
  }));
  const best = options.reduce((a, b) => (Math.abs(b.percent) < Math.abs(a.percent) - 0.5 ? b : a));
  const size = Math.abs(best.percent);
  const cost =
    Math.max(0, size - COMFORT_PERCENT) * 0.35 +
    Math.max(0, size - PITCH_LIMIT) * 0.8 +
    (best.factor === 1 ? 0 : 1);
  return { percent: best.percent, halfTime: best.factor !== 1, cost };
}

export function transition(a: Mixable, b: Mixable): Transition {
  const key = a.key && b.key ? keyMove(a.key, b.key) : null;
  const tempo = a.bpm && b.bpm ? tempoMove(a.bpm, b.bpm) : null;
  return { key, tempo, cost: (key?.cost ?? UNKNOWN_COST) + (tempo?.cost ?? UNKNOWN_COST) };
}

/** Where each arc wants the energy at a point 0–1 through the set, on a 0–1 scale. */
function target(arc: Arc, t: number) {
  if (arc === "build") return t;
  // Up to a peak about two-thirds in, then land somewhere in the middle.
  return t < 0.68 ? t / 0.68 : 1 - ((t - 0.68) / 0.32) * 0.55;
}

// Missing the arc by the full energy range costs about as much as a clash.
const ARC_WEIGHT = 5;
// In a build, letting the tempo sag costs this much per percent.
const SAG_COST = 0.08;

/** Everything the search needs, worked out once per sort. */
type Problem = {
  n: number;
  /** cost[a * n + b]: playing b straight after a. */
  cost: Float64Array;
  /** Each track's energy rescaled to 0–1 across the crate, or NaN. */
  level: Float64Array;
  arc: Arc;
};

function prepare(tracks: Mixable[], arc: Arc): Problem {
  const n = tracks.length;
  const cost = new Float64Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const [x, y] = [tracks[a], tracks[b]];
      let c = transition(x, y).cost;
      if (arc === "build" && x.bpm && y.bpm && y.bpm < x.bpm) c += (1 - y.bpm / x.bpm) * 100 * SAG_COST;
      cost[a * n + b] = c;
    }
  }
  const level = new Float64Array(n).fill(NaN);
  const energies = tracks.map((t) => t.energy).filter((e): e is number => e !== null);
  // With only a couple of known energies there's no arc to speak of.
  if (arc !== "smooth" && energies.length >= 3) {
    const low = Math.min(...energies);
    const range = Math.max(...energies) - low || 1;
    tracks.forEach((t, i) => {
      if (t.energy !== null) level[i] = (t.energy - low) / range;
    });
  }
  return { n, cost, level, arc };
}

function score(p: Problem, order: ArrayLike<number>) {
  let total = 0;
  for (let i = 1; i < p.n; i++) total += p.cost[order[i - 1] * p.n + order[i]];
  if (p.arc === "smooth") return total;
  const last = Math.max(1, p.n - 1);
  for (let i = 0; i < p.n; i++) {
    const level = p.level[order[i]];
    if (Number.isNaN(level)) continue;
    const miss = level - target(p.arc, i / last);
    total += ARC_WEIGHT * miss * miss;
  }
  return total;
}

/** The total cost of a running order (indexes into `tracks`). */
export function setCost(tracks: Mixable[], order: number[], arc: Arc) {
  return score(prepare(tracks, arc), order);
}

/** A small seeded generator, so the same crate always sorts the same way. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds an order one nearest neighbor at a time, from a given opener. */
function greedy(p: Problem, first: number) {
  const order = [first];
  const left = new Set(Array.from({ length: p.n }, (_, i) => i));
  left.delete(first);
  while (left.size) {
    const from = order[order.length - 1];
    let best = -1;
    let bestCost = Infinity;
    for (const i of left) {
      const c = p.cost[from * p.n + i];
      if (c < bestCost) [best, bestCost] = [i, c];
    }
    order.push(best);
    left.delete(best);
  }
  return order;
}

/**
 * Tries moving runs of one to three tracks elsewhere, and reversing stretches,
 * keeping any change that lowers the cost, until nothing helps. Position 0
 * stays put when the opener is pinned.
 */
function improve(p: Problem, start: number[], pinned: boolean) {
  const n = p.n;
  const order = Int32Array.from(start);
  const next = new Int32Array(n);
  let cost = score(p, order);
  const from = pinned ? 1 : 0;
  // Long runs are rarely worth it in big crates, and cost the most to try.
  const maxRun = n > 40 ? 1 : 3;

  const accept = () => {
    const c = score(p, next);
    if (c >= cost - 1e-9) return false;
    order.set(next);
    cost = c;
    return true;
  };

  for (let improved = true, rounds = 0; improved && rounds < 40; rounds++) {
    improved = false;
    for (let len = 1; len <= maxRun; len++) {
      for (let i = from; i + len <= n; i++) {
        // Lift order[i, i + len) out and drop it in before rest[j].
        for (let j = from; j <= n - len; j++) {
          if (j === i) continue;
          let w = 0;
          for (let r = 0; r < n; r++) {
            if (r >= i && r < i + len) continue;
            if (w === j) for (let k = 0; k < len; k++) next[w++] = order[i + k];
            next[w++] = order[r];
          }
          if (w === j) for (let k = 0; k < len; k++) next[w++] = order[i + k];
          if (accept()) improved = true;
        }
      }
    }
    for (let i = from; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        next.set(order);
        for (let a = i, b = j; a < b; a++, b--) [next[a], next[b]] = [order[b], order[a]];
        if (accept()) improved = true;
      }
    }
  }
  return { order: Array.from(order), cost };
}

/**
 * The best running order found, as indexes into `tracks`. With `opener`, that
 * track stays first.
 */
export function bestOrder(tracks: Mixable[], arc: Arc, opener: number | null = null) {
  const n = tracks.length;
  if (n < 3) return [...tracks.keys()];
  const p = prepare(tracks, arc);
  const rand = random(n * 7919 + (opener ?? 0));
  const starts: number[][] = [];
  if (opener !== null) starts.push(greedy(p, opener));
  else for (let i = 0; i < n; i++) starts.push(greedy(p, i));
  // A few shuffles too, since greedy starts tend to agree with each other.
  for (let s = 0; s < 4; s++) {
    const order = [...tracks.keys()].filter((i) => i !== opener);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    starts.push(opener === null ? order : [opener, ...order]);
  }
  // Big crates get fewer restarts so sorting stays quick.
  const budget = n > 40 ? 4 : n > 20 ? 10 : starts.length;
  const ranked = starts
    .map((order) => ({ order, cost: score(p, order) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, budget);
  let best = ranked[0];
  for (const { order } of ranked) {
    const result = improve(p, order, opener !== null);
    if (result.cost < best.cost) best = result;
  }
  return best.order;
}
