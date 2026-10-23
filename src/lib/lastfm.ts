import fs from "node:fs";
import path from "node:path";

// content/lastfm.json is a snapshot of Chris's Last.fm listening, written
// daily by scripts/sync-lastfm.mjs. Until the first sync runs (it needs a
// LASTFM_API_KEY secret) there's no file, and the Listening section simply
// leaves the numbers out.

export type Track = {
  name: string;
  artist: string;
  album: string;
  image: string | null;
  url: string;
  /** Milliseconds since the epoch. */
  playedAt: number | null;
};

export type Artist = { name: string; plays: number; url: string };

export type Album = {
  title: string;
  artist: string | null;
  plays: number;
  image: string | null;
  url: string;
};

export type Month = {
  /** e.g. "October 2026". */
  label: string;
  /** True while the month is still going; false when showing last month. */
  partial: boolean;
  from: string;
  to: string;
  plays: number;
  artistCount: number;
  artists: Artist[];
  albums: Album[];
};

export type YearAgo = {
  year: number;
  from: string;
  to: string;
  plays: number;
  album: Album | null;
  artists: Artist[];
};

export type Listening = {
  syncedAt: string;
  profile: string;
  registered: string;
  totalPlays: number;
  lastTrack: Track | null;
  month: Month;
  yearsAgo: YearAgo[];
};

export function getListening(): Listening | null {
  const file = path.join(process.cwd(), "content", "lastfm.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
