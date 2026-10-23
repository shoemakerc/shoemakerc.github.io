// Pulls Chris's Last.fm listening into content/lastfm.json.
//
// The snapshot holds two things the Listening section shows: a summary of
// this month (plays, top artists, top albums) and, for every earlier year on
// the account, what was on most in this same week. Both come from counting
// scrobbles with user.getRecentTracks rather than from Last.fm's top charts,
// which only cover fixed periods.
//
// Needs a Last.fm API key in LASTFM_API_KEY (https://www.last.fm/api/account/create).
// Runs daily from .github/workflows/sync-lastfm.yml; `npm run sync:lastfm`
// does the same locally.

import fs from "node:fs";
import path from "node:path";

// Month and week boundaries follow Chris's clock, not the runner's UTC one.
process.env.TZ ||= "America/Los_Angeles";

const USER = "shoeman27";
const API = "https://ws.audioscrobbler.com/2.0/";
const KEY = process.env.LASTFM_API_KEY;
const OUT = path.join(process.cwd(), "content", "lastfm.json");
const DAY = 24 * 60 * 60 * 1000;
// Early in a month there's too little to say, so show the month before instead.
const MIN_MONTH_DAYS = 7;
// Last.fm's grey star, served when it has no real image.
const PLACEHOLDER_IMAGE = "2a96cbd8b46e442fc41c2b86b821562f";

if (!KEY) {
  console.log("LASTFM_API_KEY is not set; skipping the Last.fm sync.");
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, params = {}) {
  const url = new URL(API);
  url.search = new URLSearchParams({ method, user: USER, api_key: KEY, format: "json", ...params });
  for (let attempt = 1; ; attempt++) {
    // Last.fm asks for no more than five requests a second.
    await sleep(250);
    const res = await fetch(url, { headers: { "User-Agent": "shoemakerc.github.io listening sync" } });
    const body = await res.json().catch(() => null);
    // 8: backend error, 16: temporary error, 29: rate limited. Worth retrying.
    const retryable = res.status >= 500 || [8, 16, 29].includes(body?.error);
    if (res.ok && body && !body.error) return body;
    if (!retryable || attempt === 4) {
      throw new Error(`${method} → HTTP ${res.status}: ${body?.message ?? "no body"}`);
    }
    await sleep(2000 * attempt);
  }
}

/** Last.fm's URL style: spaces become "+", everything else percent-encoded. */
const slug = (s) => encodeURIComponent(s).replace(/%20/g, "+");
const artistUrl = (artist) => `https://www.last.fm/music/${slug(artist)}`;
const albumUrl = (artist, album) => `${artistUrl(artist)}/${slug(album)}`;

function image(images) {
  const url = images?.find((i) => i.size === "extralarge")?.["#text"] || images?.at(-1)?.["#text"];
  return url && !url.includes(PLACEHOLDER_IMAGE) ? url : null;
}

function parseTrack(t) {
  return {
    name: t.name,
    artist: t.artist["#text"],
    album: t.album["#text"],
    image: image(t.image),
    url: t.url,
    playedAt: t.date ? Number(t.date.uts) * 1000 : null,
  };
}

/** Every scrobble between two times, oldest pages last. */
async function scrobbles(from, to) {
  const tracks = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const body = await call("user.getrecenttracks", {
      from: Math.floor(from / 1000),
      to: Math.floor(to / 1000),
      limit: 200,
      page,
    });
    const list = [body.recenttracks.track ?? []].flat();
    pages = Number(body.recenttracks["@attr"]?.totalPages ?? 1);
    // A track that's playing right now has no date and shows up regardless of
    // the range, so leave it out of the counts.
    tracks.push(...list.filter((t) => t.date).map(parseTrack));
  }
  return tracks;
}

function tally(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const entry = counts.get(key) ?? { plays: 0, items: [] };
    entry.plays++;
    entry.items.push(item);
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.plays - a.plays);
}

/** The most common value of `field` among some tracks. */
function mostCommon(tracks, field) {
  return tally(tracks, (t) => t[field])[0]?.items[0][field] ?? null;
}

function summarize(tracks, { artists: artistLimit, albums: albumLimit }) {
  const artists = tally(tracks, (t) => t.artist);
  // Group albums by title and cover rather than title and artist, so a
  // compilation or a classical record credited track by track to different
  // composers and performers still counts as one album.
  const albums = tally(tracks, (t) => t.album && `${t.album}\n${t.image ?? t.artist}`);
  return {
    plays: tracks.length,
    artistCount: artists.length,
    artists: artists.slice(0, artistLimit).map(({ plays, items }) => ({
      name: items[0].artist,
      plays,
      url: artistUrl(items[0].artist),
    })),
    albums: albums.slice(0, albumLimit).map(({ plays, items }) => {
      const artist = mostCommon(items, "artist");
      return {
        title: items[0].album,
        artist,
        plays,
        image: items[0].image,
        url: albumUrl(artist, items[0].album),
      };
    }),
  };
}

const isoDate = (ms) => {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
};

const info = (await call("user.getinfo")).user;
const registered = Number(info.registered.unixtime) * 1000;
const now = Date.now();
const today = new Date(now);

// This month so far, or all of last month during its first week.
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
const partial = today.getDate() >= MIN_MONTH_DAYS;
const from = partial ? monthStart : new Date(today.getFullYear(), today.getMonth() - 1, 1);
const to = partial ? today : monthStart;
const month = {
  label: from.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  partial,
  from: isoDate(from),
  to: isoDate(to - 1),
  ...summarize(await scrobbles(from.getTime(), to.getTime()), { artists: 5, albums: 4 }),
};
console.log(`${month.label}: ${month.plays} plays`);

// The seven days up to today, in each earlier year since the account opened.
const yearsAgo = [];
for (let years = 1; ; years++) {
  const end = new Date(today);
  end.setFullYear(today.getFullYear() - years);
  const start = end.getTime() - 7 * DAY;
  if (end.getTime() < registered) break;
  const week = summarize(await scrobbles(Math.max(start, registered), end.getTime()), { artists: 3, albums: 1 });
  console.log(`${end.getFullYear()}: ${week.plays} plays`);
  if (week.plays === 0) continue;
  yearsAgo.push({
    year: end.getFullYear(),
    from: isoDate(start),
    to: isoDate(end),
    plays: week.plays,
    album: week.albums[0] ?? null,
    artists: week.artists,
  });
}

// What's playing now, or else the last scrobble: a fallback for the live
// "Last heard" line when the browser can't reach Last.fm.
const recent = await call("user.getrecenttracks", { limit: 1 });
const latest = [recent.recenttracks.track ?? []].flat().map(parseTrack).find((t) => t.playedAt);

const data = {
  profile: `https://www.last.fm/user/${USER}`,
  registered: isoDate(registered),
  totalPlays: Number(info.playcount),
  lastTrack: latest ?? null,
  month,
  yearsAgo,
};

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const withoutSyncTime = (snapshot) => JSON.stringify({ ...snapshot, syncedAt: null });
if (previous && withoutSyncTime(previous) === withoutSyncTime({ syncedAt: null, ...data })) {
  console.log("No changes.");
} else {
  fs.writeFileSync(OUT, JSON.stringify({ syncedAt: new Date().toISOString(), ...data }, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}.`);
}
