import { useSyncExternalStore } from "react";
import type { Track } from "./crate";
import type { Arc } from "./order";

// The crate lives here rather than in component state so the listening queue
// can read the latest tracks between awaits. It's mirrored to localStorage so
// a set survives a reload; if storage is blocked it just lives in memory.

export type Job = "waiting" | "listening" | "failed";

export type CrateState = {
  tracks: Track[];
  arc: Arc;
  /** The track pinned to open the set. */
  openerId: string | null;
  /** Tracks being looked up or listened to. Not saved. */
  jobs: Record<string, Job>;
};

const KEY = "set-builder";
const EMPTY: CrateState = { tracks: [], arc: "peak", openerId: null, jobs: {} };

let state: CrateState | null = null;
const listeners = new Set<() => void>();

function load(): Partial<CrateState> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return { tracks: saved.tracks ?? [], arc: saved.arc ?? "peak", openerId: saved.openerId ?? null };
  } catch {
    return {};
  }
}

export function getCrate() {
  state ??= { ...EMPTY, ...load() };
  return state;
}

export function updateCrate(change: (s: CrateState) => Partial<CrateState>) {
  const prev = getCrate();
  state = { ...prev, ...change(prev) };
  if (state.tracks !== prev.tracks || state.arc !== prev.arc || state.openerId !== prev.openerId) {
    try {
      const { tracks, arc, openerId } = state;
      window.localStorage.setItem(KEY, JSON.stringify({ tracks, arc, openerId }));
    } catch {
      // Private windows and full storage: the set just won't survive a reload.
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useCrate() {
  return useSyncExternalStore(subscribe, getCrate, () => EMPTY);
}
