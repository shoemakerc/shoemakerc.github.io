import fs from "node:fs";
import path from "node:path";

// content/sports.json is a snapshot of the Minnesota teams' seasons, written
// daily from ESPN by scripts/sync-sports.mjs.

export type League = "mlb" | "nhl" | "nba" | "nfl";

export type Game = {
  date: string;
  home: boolean;
  /** e.g. "Packers". */
  opponent: string;
  us: number;
  them: number;
  /** "OTL" is the NHL's overtime or shootout loss, which still earns a point. */
  result: "W" | "L" | "T" | "OTL";
  /** How it went past regulation: "OT", "2OT", "SO", or "10" for ten innings. */
  extra: string | null;
  postseason: boolean;
};

export type NextGame = {
  date: string;
  /** False when the date is set but the start time isn't. */
  timeKnown: boolean;
  home: boolean;
  /** e.g. "Green Bay Packers". */
  opponent: string;
  /** e.g. "Spring Training" or "Preseason"; null in the regular season. */
  stage: string | null;
  /** e.g. "ALDS - Game 3", for playoff games. */
  note: string | null;
};

export type Team = {
  league: League;
  name: string;
  nickname: string;
  url: string | null;
  /** e.g. "2026" or "2026-27". */
  season: string;
  phase: "regular" | "postseason" | "offseason";
  wins: number;
  losses: number;
  ties: number;
  otLosses: number;
  division: { name: string; rank: number; teams: number };
  /** e.g. "W3". */
  streak: string | null;
  /** "e" once eliminated; other letters for the ways of making the playoffs. */
  clincher: string | null;
  /** Oldest first. */
  recent: Game[];
  next: NextGame | null;
};

export type Sports = { syncedAt: string; source: string; teams: Team[] };

export function getSports(): Sports | null {
  const file = path.join(process.cwd(), "content", "sports.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Baseball, then hockey, basketball and football: the usual order of
// attention, all else being equal.
const preference: Record<League, number> = { mlb: 4, nhl: 3, nba: 2, nfl: 1 };
const seasonGames: Record<League, number> = { mlb: 162, nhl: 82, nba: 82, nfl: 17 };

/**
 * How closely a team is being followed right now. A team in season always
 * beats one that isn't. From there, its league's place in the usual order
 * moves by up to a place and a half either way with its record, and two
 * more for a playoff run. Records are pulled toward .500 by 15% of a
 * season's worth of games, so a 1–0 start doesn't count for much and 5–0
 * in football counts for a lot.
 */
function attention(team: Team): number {
  if (team.phase === "offseason") return preference[team.league] - 10;
  const games = team.wins + team.losses + team.ties + team.otLosses;
  const prior = 0.15 * seasonGames[team.league];
  // A tie or an NHL overtime loss is worth half a win, as in the standings.
  const won = team.wins + (team.ties + team.otLosses) / 2;
  const pct = (won + prior / 2) / (games + prior);
  const form = Math.max(-1.5, Math.min(1.5, (pct - 0.5) * 5));
  return preference[team.league] + form + (team.phase === "postseason" ? 2 : 0);
}

/** Most closely followed first. */
export function byAttention(teams: Team[]): Team[] {
  return [...teams].sort((a, b) => attention(b) - attention(a));
}

/** "77–85", or "6–3–2" with the NHL's overtime losses or the NFL's ties. */
export function record(team: Team): string {
  const extra = team.league === "nhl" ? [team.otLosses] : team.ties ? [team.ties] : [];
  return [team.wins, team.losses, ...extra].join("–");
}
