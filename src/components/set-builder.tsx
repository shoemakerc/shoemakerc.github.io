"use client";

import { useEffect, useRef, useState } from "react";
import { judge } from "@/lib/dance-judge/judge";
import { listen } from "@/lib/dance-judge/listen";
import { artworkAt, lookupSongs, searchSongs, type Song } from "@/lib/dance-judge/itunes";
import { formatCamelot, fromPitch, keyName, parseKey, shortKeyName, type Camelot } from "@/lib/set-builder/camelot";
import {
  decode,
  m3u8,
  newId,
  parseLibraryFile,
  tracklist,
  type LibraryPlaylist,
  type Track,
} from "@/lib/set-builder/crate";
import { bestOrder, setCost, transition, type Arc, type Transition } from "@/lib/set-builder/order";
import { getCrate, updateCrate, useCrate, type Job } from "@/lib/set-builder/store";

// Disco and house that everyone knows, in a spread of keys and tempos.
// iTunes track IDs.
const SAMPLE_CRATE = [
  1440900114, // Stayin' Alive
  1442959426, // I Feel Love
  617154366, // Get Lucky
  697195462, // One More Time
  301002607, // Show Me Love
  1440862129, // Latch
  726320692, // Can't Get You Out of My Head
  1538003843, // Levitating
  692624266, // Lady (Hear Me Tonight)
  1783998383, // Cola
  301649414, // Good Times
  1443769846, // Finally
];

const ARCS: { value: Arc; label: string; hint: string }[] = [
  { value: "smooth", label: "Smoothest mixes", hint: "Only the key and tempo moves count." },
  { value: "build", label: "Build", hint: "Energy and tempo climb from first track to last." },
  { value: "peak", label: "Peak and land", hint: "Climb to a peak two-thirds in, then ease off." },
];

// Sorting is quick up to here; past it, a set is really two sets.
const MAX_TRACKS = 100;
const SEARCH_DELAY_MS = 450;
// Apple asks for about 20 requests a minute; imports look tracks up one at a time.
const LOOKUP_GAP_MS = 3200;

/** Still needs its energy measured, and hasn't already failed to. */
const waiting = (t: Track, jobs: Record<string, Job>) => t.energy === null && jobs[t.id] !== "failed";

function fromSong(song: Song): Track {
  return {
    id: newId(),
    title: song.title,
    artist: song.artist,
    bpm: null,
    key: null,
    energy: null,
    guessed: { bpm: false, key: false },
    durationMs: song.durationMs,
    songId: song.id,
    previewUrl: song.previewUrl,
    artwork: song.artwork,
  };
}

const formatBpm = (bpm: number) => (Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1));

function quality(t: Transition) {
  if (!t.key || !t.tempo) return "unknown";
  if (t.cost <= 1.6) return "smooth";
  if (t.cost <= 3.6) return "workable";
  return "rough";
}

const QUALITY_LABELS = { smooth: "Smooth", workable: "Workable", rough: "Rough", unknown: "Unknown" };

export function SetBuilder() {
  const { tracks, arc, openerId, jobs } = useCrate();
  const [sortedAt, setSortedAt] = useState<{ before: number; after: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [choices, setChoices] = useState<LibraryPlaylist[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const working = useRef(false);
  const lastLookup = useRef(0);

  function patch(id: string, fields: Partial<Track>) {
    updateCrate((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...fields } : t)) }));
  }

  function setJob(id: string, job: Job | null) {
    updateCrate((s) => {
      const next = { ...s.jobs };
      if (job) next[id] = job;
      else delete next[id];
      return { jobs: next };
    });
  }

  // One track at a time: find its preview if it came from a library export,
  // then listen for tempo, key and energy. Library values win over guesses.
  async function work() {
    if (working.current) return;
    working.current = true;
    try {
      for (
        let t = getCrate().tracks.find((x) => waiting(x, getCrate().jobs));
        t;
        t = getCrate().tracks.find((x) => waiting(x, getCrate().jobs))
      ) {
        const id = t.id;
        setJob(id, "listening");
        try {
          let previewUrl = t.previewUrl;
          if (!previewUrl) {
            const wait = lastLookup.current + LOOKUP_GAP_MS - Date.now();
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            lastLookup.current = Date.now();
            const [song] = await searchSongs(`${t.artist} ${t.title}`.replace(/\(.*?\)|\[.*?\]/g, " "));
            if (!song) throw new Error("No preview");
            previewUrl = song.previewUrl;
            patch(id, { songId: song.id, previewUrl, artwork: song.artwork });
          }
          const analysis = await listen(previewUrl);
          const verdict = judge(analysis);
          const current = getCrate().tracks.find((x) => x.id === id);
          if (current) {
            patch(id, {
              energy: verdict.energy,
              bpm: current.bpm ?? verdict.tempo,
              key: current.key ?? fromPitch(analysis.key, analysis.mode),
              guessed: {
                bpm: current.bpm === null ? verdict.tempo !== null : current.guessed.bpm,
                key: current.key === null ? true : current.guessed.key,
              },
            });
          }
          setJob(id, null);
        } catch {
          setJob(id, "failed");
        }
      }
    } finally {
      working.current = false;
    }
  }

  useEffect(() => {
    if (tracks.some((t) => waiting(t, jobs))) work();
    // work() reads the latest crate from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  function add(newTracks: Track[]) {
    const room = MAX_TRACKS - getCrate().tracks.length;
    if (room <= 0) {
      setNotice(`The crate holds ${MAX_TRACKS} tracks. Take a few out first.`);
      return;
    }
    if (newTracks.length > room) setNotice(`Added the first ${room}; the crate holds ${MAX_TRACKS} tracks.`);
    updateCrate((s) => ({ tracks: [...s.tracks, ...newTracks.slice(0, room)] }));
    setSortedAt(null);
  }

  function addSong(song: Song) {
    add([fromSong(song)]);
  }

  async function addSample() {
    setNotice("");
    try {
      const songs = await lookupSongs(SAMPLE_CRATE);
      add(songs.map(fromSong));
    } catch {
      setNotice("The record store isn’t answering. Give it a minute and try again.");
    }
  }

  async function importFile(file: File) {
    setNotice("");
    setChoices(null);
    try {
      const playlists = parseLibraryFile(file.name, decode(await file.arrayBuffer()));
      if (!playlists.length) {
        setNotice("Couldn’t find any tracks in that file. Is it one of the exports listed below?");
      } else if (playlists.length === 1) {
        add(playlists[0].tracks);
      } else {
        setChoices(playlists);
      }
    } catch {
      setNotice("Couldn’t read that file.");
    }
  }

  function remove(id: string) {
    updateCrate((s) => ({
      tracks: s.tracks.filter((t) => t.id !== id),
      openerId: s.openerId === id ? null : s.openerId,
    }));
    if (playing === id) audio.current?.pause();
    setSortedAt(null);
  }

  function move(index: number, by: number) {
    updateCrate((s) => {
      const next = [...s.tracks];
      const [t] = next.splice(index, 1);
      next.splice(index + by, 0, t);
      return { tracks: next };
    });
    setSortedAt(null);
  }

  function sort() {
    const opener = openerId ? tracks.findIndex((t) => t.id === openerId) : -1;
    const order = bestOrder(tracks, arc, opener >= 0 ? opener : null);
    const before = setCost(tracks, [...tracks.keys()], arc);
    const after = setCost(tracks, order, arc);
    updateCrate(() => ({ tracks: order.map((i) => tracks[i]) }));
    setSortedAt({ before, after });
  }

  function clear() {
    audio.current?.pause();
    updateCrate(() => ({ tracks: [], jobs: {}, openerId: null }));
    setSortedAt(null);
    setNotice("");
  }

  function togglePreview(t: Track) {
    const el = audio.current;
    if (!el || !t.previewUrl) return;
    if (playing === t.id) {
      el.pause();
      return;
    }
    el.src = t.previewUrl;
    el.play().then(
      () => setPlaying(t.id),
      () => setPlaying(null),
    );
  }

  const transitions = tracks.slice(1).map((t, i) => transition(tracks[i], t));
  const counts = { smooth: 0, workable: 0, rough: 0, unknown: 0 };
  for (const t of transitions) counts[quality(t)]++;
  const pending = tracks.filter((t) => waiting(t, jobs)).length;
  const hasFiles = tracks.some((t) => t.location);

  return (
    <div className="judge set-builder">
      <section className="sb-add">
        <SongSearch
          onAdd={addSong}
          added={new Set(tracks.map((t) => t.songId).filter(Boolean) as number[])}
        />
        <div className="sb-import">
          <label className="sb-file meta">
            <input
              type="file"
              accept=".txt,.csv,.tsv,.xml,.m3u,.m3u8"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importFile(file);
                e.target.value = "";
              }}
            />
            Import a playlist
          </label>
          {!tracks.length && (
            <button type="button" className="meta" onClick={addSample}>
              Or try a sample crate
            </button>
          )}
        </div>
        <p className="sb-help">
          From Rekordbox, right-click a playlist and choose <em>Export a playlist to a file</em>, or use{" "}
          <em>File → Export Collection in xml format</em> to pick from all of them. M3U playlists and CSVs
          with title, artist, BPM and key columns work too. Nothing leaves your browser.
        </p>
        {choices && (
          <div className="sb-choices">
            <p className="meta">Which playlist?</p>
            <ul>
              {choices.map((p, i) => (
                <li key={`${p.name}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      add(p.tracks);
                      setChoices(null);
                    }}
                  >
                    {p.name}
                  </button>{" "}
                  <span className="meta">{p.tracks.length}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notice && <p className="judge-note">{notice}</p>}
      </section>

      {tracks.length > 0 && (
        <section className="sb-set" aria-label="The set">
          <div className="sb-controls">
            <fieldset className="sb-arc">
              <legend className="meta">Shape</legend>
              {ARCS.map((a) => (
                <label key={a.value} title={a.hint}>
                  <input
                    type="radio"
                    name="arc"
                    value={a.value}
                    checked={arc === a.value}
                    onChange={() => {
                      updateCrate(() => ({ arc: a.value }));
                      setSortedAt(null);
                    }}
                  />
                  <span>{a.label}</span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="sb-sort" onClick={sort} disabled={tracks.length < 3}>
              Sort the set
            </button>
          </div>
          <p className="sb-summary meta" role="status">
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
            {transitions.length > 0 &&
              ` · ${counts.smooth} smooth, ${counts.workable} workable, ${counts.rough} rough${counts.unknown ? `, ${counts.unknown} unknown` : ""}`}
            {pending > 0 && ` · Listening to ${pending} more…`}
            {sortedAt &&
              sortedAt.after < sortedAt.before - 0.01 &&
              ` · Sorted: ${Math.round((1 - sortedAt.after / sortedAt.before) * 100)}% smoother`}
            {sortedAt && sortedAt.after >= sortedAt.before - 0.01 && " · Already the best order I can find"}
          </p>

          <div className="sb-charts">
            <Wheel tracks={tracks} />
            <Shape tracks={tracks} arc={arc} />
          </div>

          <ol className="sb-list">
            {tracks.map((t, i) => (
              <li key={t.id}>
                {i > 0 && <TransitionLine t={transitions[i - 1]} />}
                <TrackRow
                  track={t}
                  index={i}
                  last={i === tracks.length - 1}
                  job={jobs[t.id] ?? (waiting(t, jobs) ? "waiting" : undefined)}
                  opener={openerId === t.id}
                  playing={playing === t.id}
                  onPatch={(fields) => {
                    patch(t.id, fields);
                    setSortedAt(null);
                  }}
                  onMove={(by) => move(i, by)}
                  onRemove={() => remove(t.id)}
                  onOpener={() => updateCrate((s) => ({ openerId: s.openerId === t.id ? null : t.id }))}
                  onPlay={() => togglePreview(t)}
                />
              </li>
            ))}
          </ol>

          <Exports tracks={tracks} hasFiles={hasFiles} onClear={clear} />
        </section>
      )}
      <audio ref={audio} preload="none" onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} />
    </div>
  );
}

function SongSearch({ onAdd, added }: { onAdd: (song: Song) => void; added: Set<number> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const cache = useRef(new Map<string, Song[]>());
  const timer = useRef<number | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abort.current?.abort();
      window.clearTimeout(timer.current);
    },
    [],
  );

  async function run(q: string) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setSearching(true);
    try {
      const songs = await searchSongs(q, controller.signal);
      cache.current.set(q.toLowerCase(), songs);
      setResults(songs);
      setFailed(false);
    } catch {
      if (controller.signal.aborted) return;
      setFailed(true);
    }
    setSearching(false);
  }

  function onChange(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    abort.current?.abort();
    const q = value.trim();
    const cached = cache.current.get(q.toLowerCase());
    if (q.length < 2 || cached) {
      setResults(q.length < 2 ? null : cached!);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(() => run(q), SEARCH_DELAY_MS);
  }

  const q = query.trim();
  return (
    <div>
      <form
        role="search"
        className="judge-search"
        onSubmit={(e) => {
          e.preventDefault();
          const first = results?.[0];
          if (first && !added.has(first.id)) onAdd(first);
        }}
      >
        <label htmlFor="sb-query" className="meta">
          Add a track
        </label>
        <input
          id="sb-query"
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Title, artist, or both"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </form>
      {q.length >= 2 && (
        <div className="judge-results">
          {searching && !results && <p className="meta">Searching…</p>}
          {failed && (
            <p className="judge-note">The record store isn’t answering. Give it a minute and try again.</p>
          )}
          {results && !failed && results.length === 0 && !searching && (
            <p className="judge-note">Nothing by that name. Try adding the artist.</p>
          )}
          {results && results.length > 0 && (
            <ol className={searching ? "judge-result-list is-stale" : "judge-result-list"}>
              {results.map((song) => {
                const isAdded = added.has(song.id);
                return (
                  <li key={song.id}>
                    <button
                      type="button"
                      className="judge-result"
                      onClick={() => onAdd(song)}
                      disabled={isAdded}
                      aria-label={`${isAdded ? "Added" : "Add"} ${song.title} by ${song.artist}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={artworkAt(song, 120)} alt="" width={48} height={48} loading="lazy" />
                      <span className="judge-result-text">
                        <span className="judge-result-title">{song.title}</span>
                        <span className="judge-result-detail">
                          {song.artist}
                          {song.album && ` · ${song.album}`}
                        </span>
                      </span>
                      <span className="meta">{isAdded ? "Added" : "+ Add"}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function TransitionLine({ t }: { t: Transition }) {
  const q = quality(t);
  const tempo = t.tempo
    ? `${t.tempo.percent >= 0 ? "+" : "−"}${Math.abs(t.tempo.percent).toFixed(1)}%${t.tempo.halfTime ? " at half time" : ""}`
    : "Tempo unknown";
  return (
    <p className={`sb-transition is-${q}`}>
      <span className="sb-transition-mark" aria-hidden="true" />
      <span className="meta">
        <span className="sb-quality">{QUALITY_LABELS[q]}</span> · {t.key?.label ?? "Key unknown"} · {tempo}
      </span>
    </p>
  );
}

function TrackRow({
  track: t,
  index,
  last,
  job,
  opener,
  playing,
  onPatch,
  onMove,
  onRemove,
  onOpener,
  onPlay,
}: {
  track: Track;
  index: number;
  last: boolean;
  job: Job | undefined;
  opener: boolean;
  playing: boolean;
  onPatch: (fields: Partial<Track>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
  onOpener: () => void;
  onPlay: () => void;
}) {
  const name = `${t.title}${t.artist ? ` by ${t.artist}` : ""}`;
  return (
    <div className={`sb-track${opener ? " is-opener" : ""}`}>
      <span className="meta sb-number">{String(index + 1).padStart(2, "0")}</span>
      <button
        type="button"
        className="sb-art"
        onClick={onPlay}
        disabled={!t.previewUrl}
        aria-label={`${playing ? "Pause" : "Play"} the preview of ${name}`}
      >
        {t.artwork ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artworkAt({ artwork: t.artwork }, 120)} alt="" width={48} height={48} />
        ) : (
          <span className="sb-art-blank" />
        )}
        {t.previewUrl && <span className="sb-art-play">{playing ? "❚❚" : "▶"}</span>}
      </button>
      <span className="sb-track-text">
        <span className="sb-track-title">{t.title}</span>
        <span className="sb-track-detail">
          {t.artist}
          {job === "listening" && <span className="meta sb-job"> · Listening…</span>}
          {job === "waiting" && <span className="meta sb-job"> · Waiting</span>}
          {job === "failed" && !t.energy && <span className="meta sb-job"> · No preview found</span>}
        </span>
      </span>
      <KeyField
        value={t.key}
        guessed={t.guessed.key}
        label={name}
        onChange={(key) => onPatch({ key, guessed: { ...t.guessed, key: false } })}
      />
      <BpmField
        value={t.bpm}
        guessed={t.guessed.bpm}
        label={name}
        onChange={(bpm) => onPatch({ bpm, guessed: { ...t.guessed, bpm: false } })}
      />
      <span
        className="sb-energy"
        title={t.energy === null ? "Energy unknown" : `Energy ${t.energy.toFixed(2)}`}
      >
        <span className="sb-energy-fill" style={{ width: `${(t.energy ?? 0) * 100}%` }} />
        <span className="visually-hidden">
          {t.energy === null ? "Energy unknown" : `Energy ${t.energy.toFixed(2)}`}
        </span>
      </span>
      <span className="sb-actions">
        <button
          type="button"
          onClick={onOpener}
          aria-pressed={opener}
          title="Always open with this track"
          aria-label={`Open with ${name}`}
        >
          {opener ? "★" : "☆"}
        </button>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={`Move ${name} up`}
        >
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={last} aria-label={`Move ${name} down`}>
          ↓
        </button>
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
          ×
        </button>
      </span>
    </div>
  );
}

/** A text box that shows the Camelot code and accepts any spelling of a key. */
function KeyField({
  value,
  guessed,
  label,
  onChange,
}: {
  value: Camelot | null;
  guessed: boolean;
  label: string;
  onChange: (key: Camelot) => void;
}) {
  const shown = value ? formatCamelot(value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span
      className="sb-field sb-key"
      title={value ? `${keyName(value)}${guessed ? ", guessed from the preview" : ""}` : "Key unknown"}
    >
      <input
        value={draft ?? shown}
        placeholder="Key"
        size={3}
        aria-label={`Key of ${label}`}
        className={guessed ? "is-guessed" : undefined}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const key = draft === null ? null : parseKey(draft);
          if (key && formatCamelot(key) !== shown) onChange(key);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="meta">{value ? shortKeyName(value) : ""}</span>
    </span>
  );
}

function BpmField({
  value,
  guessed,
  label,
  onChange,
}: {
  value: number | null;
  guessed: boolean;
  label: string;
  onChange: (bpm: number) => void;
}) {
  const shown = value ? formatBpm(value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="sb-field sb-bpm" title={guessed ? "Guessed from the preview" : undefined}>
      <input
        value={draft ?? shown}
        placeholder="BPM"
        inputMode="decimal"
        size={4}
        aria-label={`Tempo of ${label} in BPM`}
        className={guessed ? "is-guessed" : undefined}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const bpm = draft === null ? NaN : Number(draft.replace(",", "."));
          if (bpm >= 40 && bpm <= 250 && formatBpm(bpm) !== shown) onChange(Math.round(bpm * 10) / 10);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="meta">BPM</span>
    </span>
  );
}

function Exports({ tracks, hasFiles, onClear }: { tracks: Track[]; hasFiles: boolean; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(tracklist(tracks));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied.
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([m3u8(tracks)], { type: "audio/x-mpegurl" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "set.m3u8" });
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <p className="meta sb-exports">
      <button type="button" className="meta" onClick={copy}>
        {copied ? "Tracklist copied" : "Copy the tracklist"}
      </button>
      {hasFiles && (
        <button
          type="button"
          className="meta"
          onClick={download}
          title="Import it back into Rekordbox with File → Import → Import Playlist"
        >
          Download for Rekordbox (M3U8)
        </button>
      )}
      <button type="button" className="meta" onClick={onClear}>
        Empty the crate
      </button>
    </p>
  );
}

// The wheel is drawn with 12 at the top, like a clock, minors inside.
const WHEEL = 300;
const C = WHEEL / 2;
const RINGS = { B: { inner: 100, outer: 140 }, A: { inner: 56, outer: 96 } };

function wheelPoint(number: number, radius: number) {
  const angle = (number / 12) * 2 * Math.PI;
  return [C + radius * Math.sin(angle), C - radius * Math.cos(angle)] as const;
}

function segment(number: number, inner: number, outer: number) {
  const [a, b] = [number - 0.5, number + 0.5];
  const [x1, y1] = wheelPoint(a, outer);
  const [x2, y2] = wheelPoint(b, outer);
  const [x3, y3] = wheelPoint(b, inner);
  const [x4, y4] = wheelPoint(a, inner);
  return `M${x1},${y1} A${outer},${outer} 0 0 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 0 0 ${x4},${y4} Z`;
}

/** The set's path around the Camelot wheel. */
function Wheel({ tracks }: { tracks: Track[] }) {
  const keyed = tracks.filter((t) => t.key);
  const used = new Set(keyed.map((t) => formatCamelot(t.key!)));
  const points = keyed.map((t) => {
    const ring = RINGS[t.key!.letter];
    return wheelPoint(t.key!.number, (ring.inner + ring.outer) / 2);
  });
  const first = points[0];
  return (
    <figure className="sb-wheel">
      <svg
        viewBox={`0 0 ${WHEEL} ${WHEEL}`}
        role="img"
        aria-label={`The set's path around the Camelot wheel: ${keyed.map((t) => formatCamelot(t.key!)).join(", ") || "no keys yet"}.`}
      >
        {(["B", "A"] as const).map((letter) =>
          Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
            const code = `${n}${letter}`;
            const ring = RINGS[letter];
            const [lx, ly] = wheelPoint(n, (ring.inner + ring.outer) / 2);
            return (
              <g key={code} className={used.has(code) ? "sb-wheel-cell is-used" : "sb-wheel-cell"}>
                <path d={segment(n, ring.inner, ring.outer)} />
                <text x={lx} y={ly} dy="0.35em">
                  {code}
                </text>
              </g>
            );
          }),
        )}
        {points.length > 1 && (
          <polyline className="sb-wheel-path" points={points.map(([x, y]) => `${x},${y}`).join(" ")} />
        )}
        {first && <circle className="sb-wheel-start" cx={first[0]} cy={first[1]} r={12} />}
      </svg>
      <figcaption className="meta">○ The opener, and the path from there</figcaption>
    </figure>
  );
}

const SW = 600;
const SH = 220;
const PAD = { top: 16, bottom: 28, left: 8, right: 8 };

/** Energy and tempo across the set, with the chosen arc behind them. */
function Shape({ tracks, arc }: { tracks: Track[]; arc: Arc }) {
  const n = tracks.length;
  const x = (i: number) => PAD.left + (n === 1 ? 0.5 : i / (n - 1)) * (SW - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v) * (SH - PAD.top - PAD.bottom);
  const bpms = tracks.map((t) => t.bpm).filter((b): b is number => b !== null);
  const [lo, hi] = [Math.min(...bpms), Math.max(...bpms)];
  const line = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const energies = tracks.map((t) => t.energy);
  const known = energies.filter((e): e is number => e !== null);
  const [elo, ehi] = [Math.min(...known), Math.max(...known)];
  const norm = energies.map((e) =>
    e === null ? null : known.length > 1 && ehi > elo ? (e - elo) / (ehi - elo) : 0.5,
  );
  const tempo = tracks.map((t) => (t.bpm === null ? null : hi > lo ? (t.bpm - lo) / (hi - lo) : 0.5));
  const guide =
    arc === "smooth"
      ? null
      : Array.from({ length: 41 }, (_, i) => {
          const t = i / 40;
          const v = arc === "build" ? t : t < 0.68 ? t / 0.68 : 1 - ((t - 0.68) / 0.32) * 0.55;
          return `${(PAD.left + t * (SW - PAD.left - PAD.right)).toFixed(1)},${y(v).toFixed(1)}`;
        }).join(" ");
  return (
    <figure className="sb-shape">
      <svg
        viewBox={`0 0 ${SW} ${SH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Energy and tempo from the first track to the last."
      >
        {[0.15, 0.325, 0.5, 0.675, 0.85].map((v) => (
          <line
            key={v}
            x1="0"
            x2={SW}
            y1={v * SH}
            y2={v * SH}
            className="heard-staff"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {guide && <polyline className="sb-shape-guide" points={guide} vectorEffect="non-scaling-stroke" />}
        {bpms.length > 1 && (
          <polyline className="sb-shape-tempo" points={line(tempo)} vectorEffect="non-scaling-stroke" />
        )}
        {known.length > 1 && (
          <polyline className="sb-shape-energy" points={line(norm)} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <figcaption className="sb-shape-legend meta">
        <span className="is-energy">Energy</span>
        <span className="is-tempo">Tempo{bpms.length > 1 && ` ${formatBpm(lo)}–${formatBpm(hi)}`}</span>
        {guide && <span className="is-guide">{arc === "build" ? "Build" : "Peak and land"}</span>}
      </figcaption>
    </figure>
  );
}
