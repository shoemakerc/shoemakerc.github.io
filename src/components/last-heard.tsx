"use client";

import { useEffect, useState } from "react";
import type { Track } from "@/lib/lastfm";

// The one live piece of the Listening section: asks Last.fm what's playing
// each minute while the page is open. The key is read-only and inlined at
// build time from the LASTFM_API_KEY secret. Without it, or if Last.fm is
// down, the line shows the last track from the daily snapshot instead.

const KEY = process.env.NEXT_PUBLIC_LASTFM_API_KEY;
const USER = "shoeman27";
const REFRESH_MS = 60_000;

type Heard = Track & { nowPlaying: boolean };

type ApiTrack = {
  name: string;
  url: string;
  artist: { "#text": string };
  album: { "#text": string };
  date?: { uts: string };
  "@attr"?: { nowplaying?: string };
};

async function fetchLatest(): Promise<Heard | null> {
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.search = new URLSearchParams({
    method: "user.getrecenttracks",
    user: USER,
    api_key: KEY!,
    format: "json",
    limit: "1",
  }).toString();
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  const [t]: ApiTrack[] = [body.recenttracks?.track ?? []].flat();
  if (!t) return null;
  return {
    name: t.name,
    artist: t.artist["#text"],
    album: t.album["#text"],
    image: null,
    url: t.url,
    playedAt: t.date ? Number(t.date.uts) * 1000 : null,
    nowPlaying: t["@attr"]?.nowplaying === "true",
  };
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function ago(then: number, now: number) {
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return relative.format(-days, "day");
  return `on ${shortDate.format(then)}`;
}

export function LastHeard({ fallback }: { fallback: Track | null }) {
  const [heard, setHeard] = useState<Heard | null>(
    fallback && { ...fallback, nowPlaying: false },
  );
  // Unknown until the page is running in a browser, so the static HTML never
  // carries a stale "2 hours ago".
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (document.hidden) return;
      const latest = KEY ? await fetchLatest().catch(() => null) : null;
      if (cancelled) return;
      if (latest) setHeard(latest);
      setNow(Date.now());
    }
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (!heard) return null;

  return (
    <p className="last-heard">
      <span className="meta last-heard-label">
        {heard.nowPlaying && <span className="last-heard-pulse" aria-hidden="true" />}
        {heard.nowPlaying ? "Now playing" : "Last heard"}
      </span>
      <a href={heard.url}>“{heard.name}”</a>
      <span className="last-heard-artist">{heard.artist}</span>
      {!heard.nowPlaying && heard.playedAt && now && (
        <span className="meta">{ago(heard.playedAt, now)}</span>
      )}
    </p>
  );
}
