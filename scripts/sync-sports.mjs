// Pulls the Minnesota teams' seasons from ESPN into content/sports.json.
//
// For the Twins, Wild, Timberwolves and Vikings, the snapshot holds the
// record, the place in the division, the last ten results and the next game.
// ESPN's site API isn't documented, but it's what espn.com itself runs on and
// it needs no key. It doesn't allow requests from other sites' pages, so the
// Pastimes page can't ask it for live scores; a daily snapshot it is.
//
// Runs daily from .github/workflows/sync-sports.yml; `npm run sync:sports`
// does the same locally.

import fs from "node:fs";
import path from "node:path";

const API = "https://site.api.espn.com/apis";
const OUT = path.join(process.cwd(), "content", "sports.json");
const LEAGUES = [
  { league: "mlb", sport: "baseball" },
  { league: "nhl", sport: "hockey" },
  { league: "nba", sport: "basketball" },
  { league: "nfl", sport: "football" },
];
const TEAM = "MIN";
const RECENT_GAMES = 10;
const DAY = 24 * 60 * 60 * 1000;
// Between the last regular-season game and the first playoff game, a team
// that has clinched a spot has no next game yet. Count it as in the playoffs
// for this long before calling the season over.
const PLAYOFF_WAIT_DAYS = 7;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "shoemakerc.github.io sports sync" } });
    if (res.ok) return res.json();
    if (res.status < 500 || attempt === 3) throw new Error(`${url} → HTTP ${res.status}`);
    await sleep(2000 * attempt);
  }
}

const stat = (entry, name) => entry.stats.find((s) => s.name === name);
const count = (entry, name) => Number(stat(entry, name)?.value ?? 0);

/** "American League Central" → "AL Central", "Central Division" → "Central". */
const divisionName = (name) =>
  name
    .replace(/^American League\b/, "AL")
    .replace(/^National League\b/, "NL")
    .replace(/ Division$/, "");

/** Minnesota's division in the standings for a season (the current one by default). */
async function standings({ sport, league }, season) {
  const query = season ? `&season=${season}` : "";
  const body = await get(`${API}/v2/sports/${sport}/${league}/standings?level=3${query}`);
  const groups = [];
  const walk = (node) => {
    if (node.standings) groups.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(body);
  const group = groups.find((g) => g.standings.entries.some((e) => e.team.abbreviation === TEAM));
  if (!group) throw new Error(`${league}: no division has ${TEAM} in it`);

  // ESPN lists a division's teams in no particular order. Their playoff seeds
  // put them in standings order, tiebreakers included.
  const entries = [...group.standings.entries].sort(
    (a, b) => count(a, "playoffSeed") - count(b, "playoffSeed"),
  );
  const entry = entries.find((e) => e.team.abbreviation === TEAM);
  const record = {
    wins: count(entry, "wins"),
    losses: count(entry, "losses"),
    ties: count(entry, "ties"),
    // The NHL's overtime and shootout losses, which earn a point.
    otLosses: count(entry, "otLosses"),
  };
  return {
    year: group.standings.season,
    season: group.standings.seasonDisplayName,
    ...record,
    games: record.wins + record.losses + record.ties + record.otLosses,
    division: {
      name: divisionName(group.name),
      rank: entries.indexOf(entry) + 1,
      teams: entries.length,
    },
    streak: stat(entry, "streak")?.displayValue || null,
    // "e" when eliminated; x, y, z and friends for the ways of getting in.
    clincher: stat(entry, "clincher")?.displayValue || null,
  };
}

function parseGame(event, league) {
  const game = event.competitions[0];
  const us = game.competitors.find((c) => c.team.abbreviation === TEAM);
  const them = game.competitors.find((c) => c !== us);
  // "Final", "Final/OT", "Final/2OT", "Final/SO", or "Final/10" for extra innings.
  const extra = game.status.type.shortDetail.match(/^Final\/(.+)$/)?.[1] ?? null;
  const result = us.winner
    ? "W"
    : them.winner
      ? league === "nhl" && extra
        ? "OTL"
        : "L"
      : "T";
  return {
    date: event.date,
    home: us.homeAway === "home",
    opponent: them.team.shortDisplayName,
    us: Number(us.score?.value ?? us.score),
    them: Number(them.score?.value ?? them.score),
    result,
    extra,
    postseason: event.seasonType?.type === 3,
  };
}

/**
 * A season's games, regular season and playoffs: the team's last few
 * finished ones, oldest first, and the first one it has yet to play.
 */
async function games({ sport, league }, year) {
  const finished = [];
  let upcoming = null;
  for (const type of [2, 3]) {
    const body = await get(
      `${API}/site/v2/sports/${sport}/${league}/teams/${TEAM.toLowerCase()}/schedule?season=${year}&seasontype=${type}`,
    );
    for (const event of body.events ?? []) {
      const status = event.competitions[0].status.type;
      if (status.completed) finished.push(parseGame(event, league));
      // Postponed and canceled games are over ("post") without being completed.
      else if (status.state !== "post" && (!upcoming || event.date < upcoming.date)) upcoming = event;
    }
  }
  return {
    recent: finished.sort((a, b) => a.date.localeCompare(b.date)).slice(-RECENT_GAMES),
    upcoming,
  };
}

function parseNext(event) {
  if (!event) return null;
  const game = event.competitions[0];
  if (game.status.type.completed) return null;
  const us = game.competitors.find((c) => c.team.abbreviation === TEAM);
  const them = game.competitors.find((c) => c !== us);
  return {
    date: event.date,
    // False when the date is set but the start time isn't, as with spring training.
    timeKnown: event.timeValid !== false,
    home: us.homeAway === "home",
    opponent: them.team.displayName,
    // 1: preseason or spring training, 2: regular season, 3: playoffs.
    seasonType: event.seasonType?.type ?? null,
    stage: event.seasonType?.type === 2 ? null : (event.seasonType?.name ?? null),
    // For playoff games, e.g. "ALDS - Game 3".
    note: game.notes?.[0]?.headline ?? null,
  };
}

async function team(source, now) {
  const { sport, league } = source;
  const info = (await get(`${API}/site/v2/sports/${sport}/${league}/teams/${TEAM.toLowerCase()}`)).team;

  // Before a new season's first game, its standings are all zeros. Show the
  // season just finished until then.
  let season = await standings(source);
  if (season.games === 0) season = await standings(source, season.year - 1);

  const { recent, upcoming } = await games(source, season.year);
  // ESPN's next event for a team can be a game that's already been played,
  // which would make it look like the season's over. The schedule knows the
  // game after it.
  const next = parseNext(info.nextEvent?.[0]) ?? parseNext(upcoming);
  const last = recent.at(-1);
  const sinceLast = last ? now - Date.parse(last.date) : Infinity;
  const clinched = season.clincher && season.clincher !== "e";

  const phase =
    next?.seasonType === 3 ||
    (last?.postseason && sinceLast < PLAYOFF_WAIT_DAYS * DAY) ||
    (clinched && next?.seasonType !== 2 && sinceLast < PLAYOFF_WAIT_DAYS * DAY)
      ? "postseason"
      : next?.seasonType === 2
        ? "regular"
        : "offseason";

  return {
    league,
    name: info.displayName,
    nickname: info.shortDisplayName,
    url: info.links?.find((l) => l.rel.includes("clubhouse"))?.href ?? null,
    season: season.season,
    phase,
    wins: season.wins,
    losses: season.losses,
    ties: season.ties,
    otLosses: season.otLosses,
    division: season.division,
    streak: season.streak,
    clincher: season.clincher,
    recent,
    next,
  };
}

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const now = Date.now();
const teams = [];
for (const source of LEAGUES) {
  try {
    const t = await team(source, now);
    console.log(`${t.name}: ${t.wins}-${t.losses}${t.otLosses ? `-${t.otLosses}` : ""}, ${t.phase}`);
    teams.push(t);
  } catch (error) {
    // One league's hiccup shouldn't wipe out the other three; keep what we had.
    const kept = previous?.teams.find((t) => t.league === source.league);
    console.warn(`${source.league}: ${error.message}${kept ? " (keeping the last snapshot)" : ""}`);
    if (kept) teams.push(kept);
  }
}
if (teams.length === 0) throw new Error("No teams came back; refusing to overwrite the snapshot.");

const data = { source: "https://www.espn.com", teams };
const withoutSyncTime = (snapshot) => JSON.stringify({ ...snapshot, syncedAt: null });
if (previous && withoutSyncTime(previous) === withoutSyncTime({ syncedAt: null, ...data })) {
  console.log("No changes.");
} else {
  fs.writeFileSync(OUT, JSON.stringify({ syncedAt: new Date().toISOString(), ...data }, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}.`);
}
