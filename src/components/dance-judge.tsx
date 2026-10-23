"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/dance-judge/analyze";
import { artworkAt, lookupSong, searchSongs, type Song } from "@/lib/dance-judge/itunes";
import { judge, THRESHOLDS, type Verdict } from "@/lib/dance-judge/judge";
import { listen } from "@/lib/dance-judge/listen";

type Judging =
  | { status: "idle" }
  | { status: "listening"; song: Song }
  | { status: "done"; song: Song; analysis: Analysis; verdict: Verdict }
  | { status: "failed"; song: Song | null; message: string };

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
    judgeAbort.current?.abort();
    const controller = new AbortController();
    judgeAbort.current = controller;
    setResultsOpen(false);
    setJudging({ status: "listening", song });
    window.history.replaceState(null, "", `?song=${song.id}`);
    if (scroll) {
      requestAnimationFrame(() =>
        verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
    try {
      const analysis = heard.current.get(song.id) ?? (await listen(song.previewUrl, controller.signal));
      heard.current.set(song.id, analysis);
      setJudging({ status: "done", song, analysis, verdict: judge(analysis) });
    } catch {
      if (controller.signal.aborted) return;
      setJudging({
        status: "failed",
        song,
        message: "The judge couldn’t hear this one. Try another song, or another version of it.",
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
          song: null,
          message: "Couldn’t find that song. Try searching for it instead.",
        }),
      );
  }

  // A shared link (?song=…) goes straight to its verdict.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("song"));
    if (id) judgeById(id, false);
    return () => {
      judgeAbort.current?.abort();
      searchAbort.current?.abort();
      window.clearTimeout(timer.current);
    };
    // Runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim();
  const showResults = resultsOpen && q.length >= 2;
  const status =
    judging.status === "listening"
      ? `Listening to ${judging.song.title}…`
      : judging.status === "done"
        ? `${judging.verdict.line} Danceability ${formatScore(judging.verdict.danceability)}.`
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
        <p className="judge-try">
          <span className="meta">Or try</span>
          {SUGGESTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => judgeById(s.id)}>
              {s.label}
            </button>
          ))}
        </p>
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
        {judging.status === "listening" && <Listening song={judging.song} />}
        {judging.status === "done" && (
          <VerdictCard
            key={judging.song.id}
            song={judging.song}
            analysis={judging.analysis}
            verdict={judging.verdict}
          />
        )}
        {judging.status === "failed" && (
          <div className="judge-failed">
            {judging.song && <SongHeading song={judging.song} />}
            <p className="judge-note">{judging.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SongHeading({ song }: { song: Song }) {
  return (
    <div className="verdict-song">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="verdict-art" src={artworkAt(song, 600)} alt="" width={600} height={600} />
      <div>
        <h2 className="verdict-title">{song.title}</h2>
        <p className="verdict-artist">
          {song.artist}
          {song.year && <span className="meta"> · {song.year}</span>}
        </p>
      </div>
    </div>
  );
}

function Listening({ song }: { song: Song }) {
  return (
    <div className="judge-listening">
      <SongHeading song={song} />
      <div className="staff judge-listening-staff">
        <div className="staff-lines" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="staff-label">The judge is listening…</span>
      </div>
    </div>
  );
}

function VerdictCard({ song, analysis, verdict }: { song: Song; analysis: Analysis; verdict: Verdict }) {
  const [copied, setCopied] = useState(false);
  const spotify = `https://open.spotify.com/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`;

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
      <SongHeading song={song} />
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
      <Heard song={song} analysis={analysis} steady={verdict.tempo !== null} />
      <p className="meta verdict-links">
        <a href={song.appleUrl}>Apple Music ↗</a>
        <a href={spotify}>Spotify ↗</a>
        <button type="button" onClick={copyLink}>
          {copied ? "Link copied" : "Copy link"}
        </button>
      </p>
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

// Width of the drawing in SVG units; it's stretched to fit.
const W = 600;
const H = 120;

/** The onset envelope on a staff, with the beat grid (if any) and a playhead. */
function Heard({ song, analysis, steady }: { song: Song; analysis: Analysis; steady: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const { envelope, beats, duration } = analysis;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const el = audio.current;
      if (el && el.duration) setProgress(el.currentTime / el.duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setPlaying(false));
    else el.pause();
  }

  const mid = H / 2;
  const amp = H * 0.38;
  const step = W / (envelope.length - 1);
  const top = envelope.map((v, i) => `${(i * step).toFixed(1)},${(mid - v * amp).toFixed(1)}`);
  const bottom = envelope
    .map((v, i) => `${(i * step).toFixed(1)},${(mid + v * amp).toFixed(1)}`)
    .reverse();
  const shape = `M${top.join(" L")} L${bottom.join(" L")} Z`;
  const x = progress * W;

  return (
    <figure className="heard">
      <figcaption className="heard-head">
        <span className="meta">What the judge heard</span>
        <button type="button" className="heard-play meta" onClick={toggle}>
          {playing ? "❚❚ Pause" : "▶ Play"} the preview
        </button>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`How much new sound arrives over the ${Math.round(duration)}-second preview${steady ? `, with ${beats.length} beats at ${Math.round(analysis.tempo)} BPM marked below` : ""}.`}
      >
        <defs>
          <clipPath id={`heard-played-${song.id}`}>
            <rect x="0" y="0" width={x} height={H} />
          </clipPath>
        </defs>
        {[0.15, 0.325, 0.5, 0.675, 0.85].map((y) => (
          <line key={y} x1="0" x2={W} y1={y * H} y2={y * H} className="heard-staff" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={shape} className="heard-shape" />
        <path d={shape} className="heard-shape is-played" clipPath={`url(#heard-played-${song.id})`} />
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
        {progress > 0 && (
          <line x1={x} x2={x} y1="0" y2={H} className="heard-playhead" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="heard-scale meta" aria-hidden="true">
        <span>0:00</span>
        <span>{formatTime(duration * 1000)}</span>
      </div>
      <audio
        ref={audio}
        src={song.previewUrl}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
      />
    </figure>
  );
}
