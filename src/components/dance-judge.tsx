"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/dance-judge/analyze";
import { artworkAt, lookupSong, searchSongs, type Song } from "@/lib/dance-judge/itunes";
import { judge, judgeTrack, THRESHOLDS, type TrackVerdict, type Verdict } from "@/lib/dance-judge/judge";
import { listen, listenToFile, Unjudgeable } from "@/lib/dance-judge/listen";
import { readTags } from "@/lib/dance-judge/tags";
import type { TrackAnalysis } from "@/lib/dance-judge/track";

/** What's on trial: a searched song (heard from its preview) or a file (heard whole). */
type Subject = {
  id: string;
  title: string;
  artist: string;
  year: string;
  art: string | null;
  audioUrl: string;
  /** The iTunes listing, for a searched song. */
  song: Song | null;
};

type Heard =
  | { kind: "clip"; analysis: Analysis; verdict: Verdict }
  | { kind: "track"; track: TrackAnalysis; verdict: TrackVerdict };

type Judging =
  | { status: "idle" }
  // Progress is a fraction once a file's sections are being analyzed.
  | { status: "listening"; subject: Subject; progress: number | null }
  | { status: "done"; subject: Subject; heard: Heard }
  | { status: "failed"; subject: Subject | null; message: string };

const fromSong = (song: Song): Subject => ({
  id: String(song.id),
  title: song.title,
  artist: song.artist,
  year: song.year,
  art: artworkAt(song, 600),
  audioUrl: song.previewUrl,
  song,
});

const AUDIO_FILES = "audio/*,.mp3,.m4a,.aac,.flac,.wav,.aif,.aiff,.ogg,.opus";

// One from each verdict, banger to silly. iTunes track IDs.
const SUGGESTIONS = [
  { id: 269573364, label: "Billie Jean" },
  { id: 617154366, label: "Get Lucky" },
  { id: 1422648513, label: "Dancing Queen" },
  { id: 1046187586, label: "Hallelujah" },
  { id: 571977598, label: "Weightless" },
];

// Long enough that typing a title and artist costs one or two searches.
const SEARCH_DELAY_MS = 450;

const formatScore = (x: number) => x.toFixed(2);

function formatTime(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const clock = (seconds: number) => formatTime(seconds * 1000);

export function DanceJudge() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [judging, setJudging] = useState<Judging>({ status: "idle" });
  const cache = useRef(new Map<string, Song[]>());
  const heard = useRef(new Map<number, Analysis>());
  const timer = useRef<number | undefined>(undefined);
  const searchAbort = useRef<AbortController | null>(null);
  const judgeAbort = useRef<AbortController | null>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragTimer = useRef<number | undefined>(undefined);
  // Object URLs for the current file's audio and cover art, to free later.
  const urls = useRef<string[]>([]);

  /** Stops whatever is being judged and returns a signal for the next thing. */
  function takeTheStand() {
    judgeAbort.current?.abort();
    const controller = new AbortController();
    judgeAbort.current = controller;
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
    setResultsOpen(false);
    return controller.signal;
  }

  function scrollToVerdict() {
    requestAnimationFrame(() =>
      verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  async function runSearch(q: string) {
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    try {
      const songs = await searchSongs(q, controller.signal);
      cache.current.set(q.toLowerCase(), songs);
      setResults(songs);
      setSearchError(false);
    } catch {
      if (controller.signal.aborted) return;
      setSearchError(true);
    }
    setSearching(false);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setResultsOpen(true);
    window.clearTimeout(timer.current);
    searchAbort.current?.abort();
    const q = value.trim();
    const cached = cache.current.get(q.toLowerCase());
    if (q.length < 2 || cached) {
      setResults(q.length < 2 ? null : cached!);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(() => runSearch(q), SEARCH_DELAY_MS);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    window.clearTimeout(timer.current);
    const cached = cache.current.get(q.toLowerCase());
    if (cached?.length) {
      // Put the phone keyboard away so the verdict has the screen.
      (document.activeElement as HTMLElement | null)?.blur();
      judgeSong(cached[0]);
    } else runSearch(q);
  }

  async function judgeSong(song: Song, scroll = true) {
    const signal = takeTheStand();
    const subject = fromSong(song);
    setJudging({ status: "listening", subject, progress: null });
    window.history.replaceState(null, "", `?song=${song.id}`);
    if (scroll) scrollToVerdict();
    try {
      const analysis = heard.current.get(song.id) ?? (await listen(song.previewUrl, signal));
      heard.current.set(song.id, analysis);
      setJudging({
        status: "done",
        subject,
        heard: { kind: "clip", analysis, verdict: judge(analysis) },
      });
    } catch {
      if (signal.aborted) return;
      setJudging({
        status: "failed",
        subject,
        message: "The judge couldn’t hear this one. Try another song, or another version of it.",
      });
    }
  }

  /** A file of the visitor's own: read its tags, then hear the whole song. */
  async function judgeFile(file: File) {
    const signal = takeTheStand();
    const audioUrl = URL.createObjectURL(file);
    urls.current.push(audioUrl);
    let subject: Subject = {
      id: `file:${file.name}:${file.size}:${file.lastModified}`,
      title: file.name.replace(/\.[^.]+$/, ""),
      artist: "",
      year: "",
      art: null,
      audioUrl,
      song: null,
    };
    setQuery("");
    setJudging({ status: "listening", subject, progress: null });
    // A file has no link to share, so the address shouldn't claim one.
    window.history.replaceState(null, "", window.location.pathname);
    scrollToVerdict();
    try {
      const bytes = await file.arrayBuffer();
      signal.throwIfAborted();
      const { picture, ...tags } = readTags(bytes, file.name);
      const art = picture && URL.createObjectURL(picture);
      if (art) urls.current.push(art);
      subject = { ...subject, ...tags, art };
      setJudging({ status: "listening", subject, progress: null });
      const track = await listenToFile(bytes, file.name, {
        signal,
        onProgress: (progress) => setJudging({ status: "listening", subject, progress }),
      });
      setJudging({
        status: "done",
        subject,
        heard: { kind: "track", track, verdict: judgeTrack(track) },
      });
    } catch (error) {
      if (signal.aborted) return;
      setJudging({
        status: "failed",
        subject,
        message:
          error instanceof Unjudgeable
            ? error.message
            : "The judge couldn’t hear this one. Try another file.",
      });
    }
  }

  function judgeById(id: number, scroll = true) {
    return lookupSong(id)
      .then((song) => {
        if (!song) throw new Error(`No song ${id}`);
        return judgeSong(song, scroll);
      })
      .catch(() =>
        setJudging({
          status: "failed",
          subject: null,
          message: "Couldn’t find that song. Try searching for it instead.",
        }),
      );
  }

  // A shared link (?song=…) goes straight to its verdict, and a music file
  // dropped anywhere on the page gets judged.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("song"));
    if (id) judgeById(id, false);

    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    // Browsers don't say when a drag leaves the window, only that it's still
    // over it, so the invitation stays up until those reports stop.
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(true);
      window.clearTimeout(dragTimer.current);
      dragTimer.current = window.setTimeout(() => setDragging(false), 150);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) judgeFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);

    const held = urls.current;
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      judgeAbort.current?.abort();
      searchAbort.current?.abort();
      window.clearTimeout(timer.current);
      window.clearTimeout(dragTimer.current);
      held.forEach((url) => URL.revokeObjectURL(url));
    };
    // Runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim();
  const showResults = resultsOpen && q.length >= 2;
  const status =
    judging.status === "listening"
      ? `Listening to ${judging.subject.title}…`
      : judging.status === "done"
        ? `${judging.heard.verdict.line} Danceability ${formatScore(judging.heard.verdict.danceability)}.`
        : judging.status === "failed"
          ? judging.message
          : showResults && results && !searching
            ? `${results.length} ${results.length === 1 ? "song" : "songs"} found.`
            : "";

  return (
    <div className="judge">
      <form role="search" className="judge-search" onSubmit={onSubmit}>
        <label htmlFor="judge-query" className="meta">
          Pick a song
        </label>
        <input
          id="judge-query"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setResultsOpen(true)}
          placeholder="Title, artist, or both"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </form>

      {!q && (
        <>
          <p className="judge-try">
            <span className="meta">Or try</span>
            {SUGGESTIONS.map((s) => (
              <button key={s.id} type="button" onClick={() => judgeById(s.id)}>
                {s.label}
              </button>
            ))}
          </p>
          <p className="judge-try judge-file">
            <span className="meta">Or bring one</span>
            <button type="button" onClick={() => fileInput.current?.click()}>
              Choose a music file
            </button>
            <span className="judge-file-note">
              or drop it anywhere on this page, and the judge hears the whole song. The file
              stays on your computer.
            </span>
          </p>
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        accept={AUDIO_FILES}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still counts as a change.
          event.target.value = "";
          if (file) judgeFile(file);
        }}
      />
      {dragging && (
        <div className="judge-drop" aria-hidden="true">
          <p>Drop it, and the judge hears the whole song.</p>
        </div>
      )}

      {showResults && (
        <div className="judge-results">
          {searching && !results && <p className="meta">Searching…</p>}
          {searchError && (
            <p className="judge-note">
              The record store isn’t answering. Give it a minute and try again.
            </p>
          )}
          {results && !searchError && results.length === 0 && !searching && (
            <p className="judge-note">Nothing by that name. Try adding the artist.</p>
          )}
          {results && results.length > 0 && (
            <ol className={searching ? "judge-result-list is-stale" : "judge-result-list"}>
              {results.map((song) => (
                <li key={song.id}>
                  <button type="button" className="judge-result" onClick={() => judgeSong(song)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={artworkAt(song, 120)} alt="" width={48} height={48} loading="lazy" />
                    <span className="judge-result-text">
                      <span className="judge-result-title">{song.title}</span>
                      <span className="judge-result-detail">
                        {song.artist}
                        {song.album && ` · ${song.album}`}
                      </span>
                    </span>
                    <span className="meta">{formatTime(song.durationMs)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* One short line for screen readers instead of announcing the whole card. */}
      <p className="visually-hidden" role="status">
        {status}
      </p>

      <div ref={verdictRef} className="judge-stage">
        {judging.status === "listening" && (
          <Listening subject={judging.subject} progress={judging.progress} />
        )}
        {judging.status === "done" && (
          <VerdictCard key={judging.subject.id} subject={judging.subject} heard={judging.heard} />
        )}
        {judging.status === "failed" && (
          <div className="judge-failed">
            {judging.subject && <SongHeading subject={judging.subject} />}
            <p className="judge-note">{judging.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SongHeading({ subject }: { subject: Subject }) {
  return (
    <div className="verdict-song">
      {subject.art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="verdict-art" src={subject.art} alt="" width={600} height={600} />
      ) : (
        <div className="verdict-art verdict-art-blank" aria-hidden="true" />
      )}
      <div>
        <h2 className="verdict-title">{subject.title}</h2>
        <p className="verdict-artist">
          {subject.artist}
          {subject.year && <span className="meta"> · {subject.year}</span>}
        </p>
      </div>
    </div>
  );
}

function Listening({ subject, progress }: { subject: Subject; progress: number | null }) {
  return (
    <div className="judge-listening">
      <SongHeading subject={subject} />
      <div className="staff judge-listening-staff">
        <div className="staff-lines" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="staff-label">
          The judge is listening…{progress !== null && ` ${Math.round(progress * 100)}%`}
        </span>
      </div>
    </div>
  );
}

function VerdictCard({ subject, heard }: { subject: Subject; heard: Heard }) {
  const [copied, setCopied] = useState(false);
  const { verdict } = heard;
  const { song } = subject;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied; the address bar still has the link.
    }
  }

  return (
    <article className="verdict">
      <SongHeading subject={subject} />
      <p className="meta verdict-label">The verdict</p>
      <blockquote className="verdict-line">“{verdict.line}”</blockquote>
      <Meter value={verdict.danceability} />
      <dl className="judge-stats">
        <div>
          <dt className="meta">Danceability</dt>
          <dd>{formatScore(verdict.danceability)}</dd>
        </div>
        <div>
          <dt className="meta">Energy</dt>
          <dd>{formatScore(verdict.energy)}</dd>
        </div>
        <div>
          <dt className="meta">{verdict.tempo === null ? "No steady beat" : "Tempo"}</dt>
          <dd>
            {verdict.tempo === null ? (
              "—"
            ) : (
              <>
                {verdict.tempo}
                <span className="judge-unit"> BPM</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="meta">Key</dt>
          <dd>{verdict.key}</dd>
        </div>
      </dl>
      {heard.kind === "clip" ? (
        <HeardClip subject={subject} analysis={heard.analysis} steady={verdict.tempo !== null} />
      ) : (
        <ThroughTheSong subject={subject} track={heard.track} verdict={heard.verdict} />
      )}
      {song && (
        <p className="meta verdict-links">
          <a href={song.appleUrl}>Apple Music ↗</a>
          <a
            href={`https://open.spotify.com/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`}
          >
            Spotify ↗
          </a>
          <button type="button" onClick={copyLink}>
            {copied ? "Link copied" : "Copy link"}
          </button>
        </p>
      )}
    </article>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="judge-meter">
      <div
        className="judge-meter-track"
        role="meter"
        aria-label="Danceability"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(2))}
      >
        {THRESHOLDS.map((t) => (
          <span key={t} className="judge-meter-tick" style={{ left: `${t * 100}%` }} />
        ))}
        <span className="judge-meter-fill" style={{ width: `${value * 100}%` }} />
        <span className="judge-meter-mark" style={{ left: `${value * 100}%` }} />
      </div>
      <div className="judge-meter-scale meta" aria-hidden="true">
        <span>Silly</span>
        <span>Banger</span>
      </div>
    </div>
  );
}

/** Play, pause and seek for an audio element, with its progress as a fraction. */
function usePlayer(seconds: number) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const el = audio.current;
      if (el) setProgress(el.currentTime / (el.duration || seconds));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, seconds]);

  return {
    playing,
    progress,
    toggle() {
      const el = audio.current;
      if (!el) return;
      if (el.paused) el.play().catch(() => setPlaying(false));
      else el.pause();
    },
    seek(fraction: number) {
      const el = audio.current;
      if (!el) return;
      el.currentTime = fraction * seconds;
      setProgress(fraction);
    },
    /** Spread onto the <audio> element. */
    element: {
      ref: audio,
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onEnded: () => {
        setPlaying(false);
        setProgress(0);
      },
    },
  };
}

// Width of the drawings in SVG units; they're stretched to fit.
const W = 600;

/** A closed path mirroring 0–1 values around the middle of a box W wide and h tall. */
function outline(values: number[], h: number) {
  const mid = h / 2;
  const amp = h * 0.38;
  const step = W / (values.length - 1);
  const top = values.map((v, i) => `${(i * step).toFixed(1)},${(mid - v * amp).toFixed(1)}`);
  const bottom = values
    .map((v, i) => `${(i * step).toFixed(1)},${(mid + v * amp).toFixed(1)}`)
    .reverse();
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

const H = 120;

/** The onset envelope on a staff, with the beat grid (if any) and a playhead. */
function HeardClip({ subject, analysis, steady }: { subject: Subject; analysis: Analysis; steady: boolean }) {
  const { envelope, beats, duration } = analysis;
  const player = usePlayer(duration);
  const shape = outline(envelope, H);
  const x = player.progress * W;

  return (
    <figure className="heard">
      <figcaption className="heard-head">
        <span className="meta">What the judge heard</span>
        <button type="button" className="heard-play meta" onClick={player.toggle}>
          {player.playing ? "❚❚ Pause" : "▶ Play"} the preview
        </button>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`How much new sound arrives over the ${Math.round(duration)}-second preview${steady ? `, with ${beats.length} beats at ${Math.round(analysis.tempo)} BPM marked below` : ""}.`}
      >
        <defs>
          <clipPath id={`heard-played-${subject.id}`}>
            <rect x="0" y="0" width={x} height={H} />
          </clipPath>
        </defs>
        {[0.15, 0.325, 0.5, 0.675, 0.85].map((y) => (
          <line key={y} x1="0" x2={W} y1={y * H} y2={y * H} className="heard-staff" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={shape} className="heard-shape" />
        <path d={shape} className="heard-shape is-played" clipPath={`url(#heard-played-${subject.id})`} />
        {steady &&
          beats.map((t) => (
            <line
              key={t}
              x1={(t / duration) * W}
              x2={(t / duration) * W}
              y1={H - 6}
              y2={H}
              className="heard-beat"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {player.progress > 0 && (
          <line x1={x} x2={x} y1="0" y2={H} className="heard-playhead" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="heard-scale meta" aria-hidden="true">
        <span>0:00</span>
        <span>{clock(duration)}</span>
      </div>
      <audio src={subject.audioUrl} preload="none" {...player.element} />
    </figure>
  );
}

// The 2017 verdicts, in a word each, for the bands of the chart.
const BANDS = [
  { from: 0.85, to: 1, label: "Banger" },
  { from: 0.6, to: 0.85, label: "Get down" },
  { from: 0.45, to: 0.6, label: "Allowed" },
  { from: 0.25, to: 0.45, label: "Weird" },
  { from: 0, to: 0.25, label: "Silly" },
];

const LEVEL_H = 40;
// Past this many sections the dots would run together; the line carries it.
const MAX_DOTS = 40;

/**
 * A whole song's danceability, section by section, over a strip of its
 * loudness. Hover, or focus and use the arrow keys, to read a section; click
 * to play from there. The table underneath has every number.
 */
function ThroughTheSong({ subject, track, verdict }: { subject: Subject; track: TrackAnalysis; verdict: TrackVerdict }) {
  const { duration } = track;
  const { sections, peak } = verdict;
  const player = usePlayer(duration);
  const [active, setActive] = useState<number | null>(null);

  const at = (seconds: number) => (seconds / duration) * 100;
  const middle = (i: number) => (sections[i].start + sections[i].end) / 2;
  const nearest = (seconds: number) =>
    sections.reduce(
      (best, _, i) => (Math.abs(middle(i) - seconds) < Math.abs(middle(best) - seconds) ? i : best),
      0,
    );
  const fractionAt = (event: React.PointerEvent | React.MouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  };

  function onKeyDown(event: React.KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step) {
      event.preventDefault();
      setActive((i) => Math.min(sections.length - 1, Math.max(0, (i ?? (step > 0 ? -1 : sections.length)) + step)));
    } else if ((event.key === "Enter" || event.key === " ") && active !== null) {
      event.preventDefault();
      player.seek(sections[active].start / duration);
    }
  }

  const line = sections.map((s, i) => `${at(middle(i)).toFixed(2)},${((1 - s.danceability) * 100).toFixed(2)}`);
  const shape = outline(track.level, LEVEL_H);
  const played = player.progress * W;
  const shown = active === null ? null : sections[active];
  const low = sections.reduce((worst, s) => (s.danceability < worst.danceability ? s : worst));

  return (
    <figure className="through">
      <figcaption className="heard-head">
        <span className="meta">Danceability through the song</span>
        <button type="button" className="heard-play meta" onClick={player.toggle}>
          {player.playing ? "❚❚ Pause" : "▶ Play"} the song
        </button>
      </figcaption>
      <p className="through-note">
        {sections.length > 1
          ? `Heard whole, in ${sections.length} overlapping half-minute stretches. It peaks at ${formatScore(peak.danceability)} around ${clock((peak.start + peak.end) / 2)}.`
          : "Heard whole, in one stretch."}
      </p>
      <div className="through-chart">
        <div
          className="through-track"
          tabIndex={0}
          role="group"
          aria-label={`Danceability from ${formatScore(low.danceability)} to ${formatScore(peak.danceability)} over ${clock(duration)}. Arrow keys step through the sections, Enter plays from one, and the table below lists them all.`}
          onPointerMove={(event) => setActive(nearest(fractionAt(event) * duration))}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
          onClick={(event) => player.seek(fractionAt(event))}
        >
          <div className="through-plot">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {THRESHOLDS.map((t) => (
                <line key={t} x1="0" x2="100" y1={(1 - t) * 100} y2={(1 - t) * 100} className="through-grid" vectorEffect="non-scaling-stroke" />
              ))}
              {line.length > 1 && (
                <polyline points={line.join(" ")} className="through-line" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {sections.length <= MAX_DOTS &&
              sections.map((s, i) => (
                <span
                  key={s.start}
                  className={i === active ? "through-dot is-active" : "through-dot"}
                  style={{ left: `${at(middle(i))}%`, top: `${(1 - s.danceability) * 100}%` }}
                />
              ))}
          </div>
          <svg className="through-level" viewBox={`0 0 ${W} ${LEVEL_H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <clipPath id="through-played">
                <rect x="0" y="0" width={played} height={LEVEL_H} />
              </clipPath>
            </defs>
            <path d={shape} className="heard-shape" />
            <path d={shape} className="heard-shape is-played" clipPath="url(#through-played)" />
          </svg>
          {player.progress > 0 && (
            <span className="through-playhead" style={{ left: `${player.progress * 100}%` }} />
          )}
          {shown && active !== null && (
            <>
              <span className="through-crosshair" style={{ left: `${at(middle(active))}%` }} />
              <div
                className={`through-tip${at(middle(active)) > 55 ? " is-left" : ""}${shown.danceability > 0.5 ? " is-under" : ""}`}
                style={{ left: `${at(middle(active))}%` }}
              >
                <strong>{formatScore(shown.danceability)}</strong> danceability
                <span>
                  {clock(shown.start)}–{clock(shown.end)} · energy {formatScore(shown.energy)}
                  {shown.tempo !== null && ` · ${shown.tempo} BPM`}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="through-bands meta" aria-hidden="true">
          {BANDS.map((band) => (
            <span key={band.label} style={{ top: `${(1 - (band.from + band.to) / 2) * 100}%` }}>
              {band.label}
            </span>
          ))}
        </div>
      </div>
      <div className="heard-scale through-scale meta" aria-hidden="true">
        <span>0:00</span>
        <span>{clock(duration)}</span>
      </div>
      <details className="through-table">
        <summary>
          <span className="meta">Show as a table</span>
        </summary>
        <table>
          <thead>
            <tr className="meta">
              <th scope="col">Stretch</th>
              <th scope="col">Danceability</th>
              <th scope="col">Energy</th>
              <th scope="col">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.start}>
                <th scope="row">
                  {clock(s.start)}–{clock(s.end)}
                </th>
                <td>{formatScore(s.danceability)}</td>
                <td>{formatScore(s.energy)}</td>
                <td>{s.tempo === null ? "—" : `${s.tempo} BPM`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <audio src={subject.audioUrl} preload="metadata" {...player.element} />
    </figure>
  );
}
