import type { Metadata } from "next";
import { Staff } from "@/components/ui";
import { getRestaurants } from "@/lib/restaurants";
import {
  byAttention,
  getSports,
  record,
  type Game,
  type NextGame,
  type Team,
} from "@/lib/sports";

export const metadata: Metadata = {
  title: "Pastimes",
  description: "Minnesota sports, restaurants, and learning to play bass and DJ.",
};

const leagues: Record<Team["league"], string> = {
  mlb: "MLB",
  nhl: "NHL",
  nba: "NBA",
  nfl: "NFL",
};

const phases: Record<Team["phase"], string> = {
  regular: "In season",
  postseason: "Playoffs",
  offseason: "Off-season",
};

// Game days and times by the clock in Minnesota.
const zone = "America/Chicago";
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone });
const gameDayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: zone,
});
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
// ESPN puts a game whose start time isn't set yet at midnight Eastern, which
// would read as the day before in Minnesota.
const dateOnlyFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

const syncedFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function ordinal(n: number) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

const overtimes: Record<string, string> = {
  OT: "overtime",
  "2OT": "double overtime",
  "3OT": "triple overtime",
  SO: "a shootout",
};

/** " in 10 innings", " in overtime", or nothing. */
function extraTime(game: Game) {
  if (!game.extra) return "";
  if (/^\d+$/.test(game.extra)) return ` in ${game.extra} innings`;
  return ` in ${overtimes[game.extra] ?? game.extra}`;
}

function result(game: Game) {
  const score = `${Math.max(game.us, game.them)}–${Math.min(game.us, game.them)}`;
  if (game.result === "W") return `Beat the ${game.opponent} ${score}${extraTime(game)}`;
  if (game.result === "T") return `Tied the ${game.opponent} ${score}`;
  return `Lost to the ${game.opponent} ${score}${extraTime(game)}`;
}

function when(next: NextGame) {
  const date = new Date(next.date);
  if (!next.timeKnown) return dateOnlyFormat.format(date);
  const time = timeFormat.format(date).replace(":00", "").replace(/^12\sPM$/, "noon");
  return `${gameDayFormat.format(date)}, ${time} CT`;
}

/** "won 5 straight", for streaks of three or more. */
function streak(team: Team) {
  const match = team.streak?.match(/^([WL])(\d+)$/);
  if (!match || Number(match[2]) < 3) return null;
  return `${match[1] === "W" ? "won" : "lost"} ${match[2]} straight`;
}

function standing(team: Team) {
  const place = `${ordinal(team.division.rank)} in the ${team.division.name}`;
  if (team.phase === "offseason") return `Finished ${place}`;
  const clinched = team.clincher && team.clincher !== "e";
  return [
    place,
    streak(team),
    team.phase === "regular" && team.clincher === "e" && "out of the running",
    team.phase === "regular" && clinched && "in the playoffs",
  ]
    .filter(Boolean)
    .join(" · ");
}

const outcomes: { result: Game["result"]; one: string; many: string }[] = [
  { result: "W", one: "win", many: "wins" },
  { result: "L", one: "loss", many: "losses" },
  { result: "OTL", one: "overtime loss", many: "overtime losses" },
  { result: "T", one: "tie", many: "ties" },
];

/** The last ten results as a row of marks, oldest first. */
function Form({ games }: { games: Game[] }) {
  const tally = outcomes
    .map(({ result, one, many }) => {
      const n = games.filter((g) => g.result === result).length;
      return n > 0 && `${n} ${n === 1 ? one : many}`;
    })
    .filter(Boolean)
    .join(", ");
  return (
    <ol className="form" aria-label={`Last ${games.length} games: ${tally}`}>
      {games.map((game) => (
        <li
          key={game.date}
          className={`form-${game.result.toLowerCase()}`}
          title={`${result(game)}, ${dayFormat.format(new Date(game.date))}`}
        >
          {game.result === "OTL" ? "OT" : game.result}
        </li>
      ))}
    </ol>
  );
}

function TeamCard({ team, rank }: { team: Team; rank: number }) {
  const last = team.recent.at(-1);
  const next = team.next;
  return (
    <li className={`team team-${team.phase}`}>
      <p className="meta team-meta">
        <span>
          {`No. ${String(rank).padStart(2, "0")}`} · {leagues[team.league]}
        </span>
        <span className="team-phase">{phases[team.phase]}</span>
      </p>
      <h3 className="team-name">
        {team.url ? <a href={team.url}>{team.nickname}</a> : team.nickname}
      </h3>
      <p className="team-record">
        <span className="team-record-number">{record(team)}</span>
        {team.league === "nhl" && (
          <span className="meta"> {2 * team.wins + team.otLosses} pts</span>
        )}
      </p>
      <p className="team-standing">{standing(team)}</p>
      {team.recent.length > 0 && <Form games={team.recent} />}
      <dl className="team-games">
        {last && (
          <div>
            <dt className="meta">Last</dt>
            <dd>
              {result(last)}{" "}
              <span className="meta">{dayFormat.format(new Date(last.date))}</span>
            </dd>
          </div>
        )}
        {next && (
          <div>
            <dt className="meta">Next</dt>
            <dd>
              {next.stage && `${next.stage[0]}${next.stage.slice(1).toLowerCase()}: `}
              {next.home ? "vs." : "at"} {next.opponent}
              {next.note && `, ${next.note.replace(" - ", ", ")}`}{" "}
              <span className="meta">{when(next)}</span>
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

export default function Pastimes() {
  const sports = getSports();
  const restaurants = getRestaurants();

  return (
    <>
      <section className="page-intro">
        <p className="meta">Pastimes</p>
        <h1 className="page-title">Everything else</h1>
        <p className="lede">
          The Minnesota teams I follow
          {restaurants.length > 0 && ", the restaurants I keep ranking"}, and two
          things I’m still learning to do: play bass and DJ.
        </p>
      </section>

      {sports && (
        <section>
          <Staff label="Rooting interests" />
          <h2 className="section-title">Minnesota sports</h2>
          <p className="lede-small teams-lede">
            The Twins, Wild, Timberwolves and Vikings, in order of how closely
            I’m following each one right now. By default that’s baseball,
            hockey, basketball, then football, but the order reshuffles every
            morning: teams in season jump ahead of teams that aren’t, and a
            good record moves a team up the list.
          </p>
          <ol className="teams">
            {byAttention(sports.teams).map((team, i) => (
              <TeamCard key={team.league} team={team} rank={i + 1} />
            ))}
          </ol>
          <p className="meta teams-synced">
            Records from <a href={sports.source}>ESPN</a> · synced{" "}
            {syncedFormat.format(new Date(sports.syncedAt))}
          </p>
        </section>
      )}

      {restaurants.length > 0 && (
        <section>
          <Staff label="Eating out" />
          <h2 className="section-title">Restaurants</h2>
          <p className="lede-small">
            Everywhere I eat gets ranked on Beli, which keeps its lists to
            itself: no web profiles, no export. So here’s the top of mine,
            copied out by hand.
          </p>
          <ol className="restaurants">
            {restaurants.map((restaurant, i) => (
              <li key={restaurant.name}>
                <span className="meta">{String(i + 1).padStart(2, "0")}</span>
                <span className="restaurant">
                  <span className="restaurant-name">{restaurant.name}</span>
                  <span className="restaurant-detail">
                    {[restaurant.where, restaurant.what].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {restaurant.score !== null && (
                  <span className="restaurant-score">{restaurant.score.toFixed(1)}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <Staff label="Practice" />
        <h2 className="section-title">In the woodshed</h2>
        <p className="lede-small">
          Woodshedding is jazz slang for practicing where nobody can hear you.
          These two are still very much in the shed.
        </p>
        <div className="woodshed">
          <div>
            <h3 className="meta woodshed-title">Bass guitar</h3>
            <p>
              Years of cello should make this easy: four strings, the same clef.
              Instead the strings are a fourth apart rather than a fifth, there
              are frets where my fingers expect none, and there’s no bow to hide
              behind.
            </p>
          </div>
          <div>
            <h3 className="meta woodshed-title">DJing</h3>
            <p>
              Learning to mix in Rekordbox and djay Pro. So far that mostly means
              learning what a trainwreck sounds like (two songs slowly drifting
              out of time) and trying not to lean on the sync button.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
