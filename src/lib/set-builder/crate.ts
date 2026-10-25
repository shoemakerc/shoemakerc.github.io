import { formatCamelot, parseKey, type Camelot } from "./camelot";

// A crate is the tracks you're thinking of playing, in whatever order. Tracks
// come from an iTunes search (and get listened to for tempo, key and energy)
// or from a DJ library export, which already knows the tempo and key and
// sometimes where the file lives.

export type Track = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  key: Camelot | null;
  energy: number | null;
  /** True when the tempo or key is the page's own guess rather than the library's or yours. */
  guessed: { bpm: boolean; key: boolean };
  durationMs?: number;
  /** iTunes track, for the preview and artwork. */
  songId?: number;
  previewUrl?: string;
  artwork?: string;
  /** The file on the DJ's computer, from a library export, for writing an M3U8 back. */
  location?: string;
};

let counter = 0;
export const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

function track(fields: Partial<Track> & Pick<Track, "title" | "artist">): Track {
  return {
    id: newId(),
    bpm: null,
    key: null,
    energy: null,
    guessed: { bpm: false, key: false },
    ...fields,
  };
}

function parseBpm(text: string | undefined) {
  const bpm = Number(text?.replace(",", ".").trim());
  return Number.isFinite(bpm) && bpm >= 40 && bpm <= 250 ? Math.round(bpm * 10) / 10 : null;
}

/** "6:12" or "372" (seconds) to milliseconds. */
function parseDuration(text: string | undefined) {
  if (!text) return undefined;
  const parts = text.trim().split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  const seconds = parts.reduce((total, p) => total * 60 + p, 0);
  return seconds > 0 ? seconds * 1000 : undefined;
}

/** Splits one line of CSV or TSV, honoring quotes. */
function splitLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') [cell, i] = [cell + '"', i + 1];
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  return [...cells, cell].map((c) => c.trim());
}

const COLUMNS: Record<
  keyof Pick<Track, "title" | "artist" | "bpm" | "key" | "durationMs" | "location">,
  string[]
> = {
  title: ["track title", "title", "name", "song", "track"],
  artist: ["artist", "artists"],
  bpm: ["bpm", "tempo", "averagebpm"],
  key: ["key", "tonality", "initial key", "musical key", "camelot"],
  durationMs: ["time", "length", "duration"],
  location: ["location", "path", "file", "filename"],
};

/**
 * Rekordbox's "Export a playlist to a file" text (tab-separated), or any CSV
 * or TSV with a header row that names the title, artist, BPM and key.
 */
function parseTable(text: string): Track[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = [..."\t;,"].find((d) => lines[0].includes(d)) ?? "\t";
  const header = splitLine(lines[0], delimiter).map((h) => h.toLowerCase().replace(/^#$/, ""));
  const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([field, names]) => [field, col(names)]));
  if (at.title < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const cells = splitLine(line, delimiter);
    const get = (i: number) => (i >= 0 ? cells[i] : undefined);
    const title = get(at.title);
    if (!title) return [];
    return [
      track({
        title,
        artist: get(at.artist) ?? "",
        bpm: parseBpm(get(at.bpm)),
        key: parseKey(get(at.key) ?? ""),
        durationMs: parseDuration(get(at.durationMs)),
        location: get(at.location) || undefined,
      }),
    ];
  });
}

/** Turns Rekordbox's file://localhost/… URLs into plain paths. */
function filePath(location: string) {
  try {
    return location.startsWith("file:")
      ? decodeURIComponent(location.replace(/^file:\/\/(localhost)?/, "")).replace(/^\/([A-Za-z]:\/)/, "$1")
      : location;
  } catch {
    return location;
  }
}

export type LibraryPlaylist = { name: string; tracks: Track[] };

/**
 * Rekordbox's "Export Collection in xml format": every playlist, with the
 * tracks resolved from the collection. Empty playlists and folders are skipped.
 */
function parseRekordboxXml(text: string): LibraryPlaylist[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return [];
  const byId = new Map<string, Track>();
  const byLocation = new Map<string, Track>();
  for (const el of doc.querySelectorAll("COLLECTION > TRACK")) {
    const location = el.getAttribute("Location") ?? "";
    const t = track({
      title: el.getAttribute("Name") ?? "",
      artist: el.getAttribute("Artist") ?? "",
      bpm: parseBpm(el.getAttribute("AverageBpm") ?? undefined),
      key: parseKey(el.getAttribute("Tonality") ?? ""),
      durationMs: parseDuration(el.getAttribute("TotalTime") ?? undefined),
      location: location ? filePath(location) : undefined,
    });
    byId.set(el.getAttribute("TrackID") ?? "", t);
    byLocation.set(location, t);
  }
  const playlists: LibraryPlaylist[] = [];
  for (const node of doc.querySelectorAll('PLAYLISTS NODE[Type="1"]')) {
    // KeyType 0 points at TrackIDs, 1 at file locations.
    const lookup = node.getAttribute("KeyType") === "1" ? byLocation : byId;
    const tracks = [...node.querySelectorAll(":scope > TRACK")].flatMap((el) => {
      const t = lookup.get(el.getAttribute("Key") ?? "");
      return t ? [{ ...t, id: newId() }] : [];
    });
    if (tracks.length) playlists.push({ name: node.getAttribute("Name") ?? "Untitled", tracks });
  }
  return playlists;
}

/** An M3U or M3U8 playlist: titles from #EXTINF lines, locations from the rest. */
function parseM3u(text: string): Track[] {
  const tracks: Track[] = [];
  let info: { title: string; artist: string; durationMs?: number } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const extinf = /^#EXTINF:\s*(-?\d+)[^,]*,(.*)$/.exec(line);
    if (extinf) {
      const [artist, ...rest] = extinf[2].split(" - ");
      const seconds = Number(extinf[1]);
      const durationMs = seconds > 0 ? seconds * 1000 : undefined;
      info = rest.length
        ? { artist: artist.trim(), title: rest.join(" - ").trim(), durationMs }
        : { artist: "", title: extinf[2].trim(), durationMs };
    } else if (!line.startsWith("#")) {
      const location = filePath(line);
      const name = location
        .split(/[\\/]/)
        .pop()!
        .replace(/\.[^.]+$/, "");
      tracks.push(
        track({
          title: info?.title || name,
          artist: info?.artist ?? "",
          durationMs: info?.durationMs,
          location,
        }),
      );
      info = null;
    }
  }
  return tracks;
}

/** Rekordbox writes its text exports as UTF-16; everything else is UTF-8. */
export function decode(bytes: ArrayBuffer) {
  const head = new Uint8Array(bytes.slice(0, 2));
  const encoding =
    head[0] === 0xff && head[1] === 0xfe
      ? "utf-16le"
      : head[0] === 0xfe && head[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(encoding).decode(bytes).replace(/^﻿/, "");
}

/** Reads any supported export into one or more playlists. */
export function parseLibraryFile(name: string, text: string): LibraryPlaylist[] {
  const base = name.replace(/\.[^.]+$/, "");
  if (/^\s*<\?xml|<DJ_PLAYLISTS/i.test(text)) return parseRekordboxXml(text);
  if (/\.m3u8?$/i.test(name) || /^#EXTM3U/.test(text)) {
    const tracks = parseM3u(text);
    return tracks.length ? [{ name: base, tracks }] : [];
  }
  const tracks = parseTable(text);
  return tracks.length ? [{ name: base, tracks }] : [];
}

const formatBpm = (bpm: number) => (Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1));

/** "1. Artist – Title (8A, 124)" per line, for pasting anywhere. */
export function tracklist(tracks: Track[]) {
  return tracks
    .map((t, i) => {
      const details = [t.key && formatCamelot(t.key), t.bpm && formatBpm(t.bpm)].filter(Boolean).join(", ");
      return `${i + 1}. ${t.artist ? `${t.artist} – ` : ""}${t.title}${details ? ` (${details})` : ""}`;
    })
    .join("\n");
}

/** An M3U8 Rekordbox (or any player) can import, for tracks with known files. */
export function m3u8(tracks: Track[]) {
  const lines = ["#EXTM3U"];
  for (const t of tracks) {
    if (!t.location) continue;
    const seconds = t.durationMs ? Math.round(t.durationMs / 1000) : -1;
    lines.push(`#EXTINF:${seconds},${t.artist ? `${t.artist} - ` : ""}${t.title}`, t.location);
  }
  return `${lines.join("\n")}\n`;
}
