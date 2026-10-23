import { LastHeard } from "@/components/last-heard";
import { Staff } from "@/components/ui";
import type { Album, Listening as Data, Month, YearAgo } from "@/lib/lastfm";
import { site } from "@/lib/site";

const plays = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "play" : "plays"}`;

const monthName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

// Years shown before the "Show all" toggle, newest first, so this column
// doesn't run far past the month beside it.
const RECENT_YEARS = 6;

const syncedFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function Listening({ data }: { data: Data | null }) {
  return (
    <section id="listening" className="listening">
      <Staff label="Now playing" />
      <div className="listening-grid">
        <div>
          <h2 className="section-title">Listening</h2>
          <p className="lede-small">
            A rotating playlist of whatever has been on repeat lately. Currently
            spinning: <em>{site.playlist.label}</em>.
          </p>
          <LastHeard fallback={data?.lastTrack ?? null} />
          <p className="lede-small listening-more">
            Ratings and reviews of everything else live on{" "}
            <a href={site.rateYourMusic}>RateYourMusic</a>, and every play gets
            logged on <a href={site.lastFm}>Last.fm</a>.
          </p>
        </div>
        <iframe
          title={`Spotify playlist: ${site.playlist.label}`}
          src={`https://open.spotify.com/embed/playlist/${site.playlist.id}?theme=0`}
          width="100%"
          height="352"
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        />
      </div>

      {data && (
        <>
          <div className="listening-stats">
            <MonthSummary month={data.month} />
            {data.yearsAgo.length > 0 && <YearsAgo weeks={data.yearsAgo} />}
          </div>
          <p className="meta listening-synced">
            Counted from <a href={data.profile}>Last.fm</a> ·{" "}
            {data.totalPlays.toLocaleString("en-US")} plays since{" "}
            {data.registered.slice(0, 4)} · synced{" "}
            {syncedFormat.format(new Date(data.syncedAt))}
          </p>
        </>
      )}
    </section>
  );
}

function AlbumCover({ album, className = "" }: { album: Album; className?: string }) {
  return (
    <a href={album.url} className={`cover cover-square ${className}`} tabIndex={-1} aria-hidden="true">
      {album.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={album.image} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="cover-blank">{album.title}</span>
      )}
    </a>
  );
}

function MonthSummary({ month }: { month: Month }) {
  const name = monthName(month.from);
  return (
    <div className="listening-block">
      <h3 className="meta listening-block-title">
        {month.partial ? `${name} so far` : name}
      </h3>
      <p className="listening-tally">
        <span className="listening-tally-number">{month.plays.toLocaleString("en-US")}</span>{" "}
        plays across {month.artistCount.toLocaleString("en-US")}{" "}
        {month.artistCount === 1 ? "artist" : "artists"}
      </p>

      {month.albums.length > 0 && (
        <ol className="album-row">
          {month.albums.map((album) => (
            <li key={album.url} className="cover-card">
              <AlbumCover album={album} />
              <span className="cover-card-title">
                <a href={album.url}>
                  <em>{album.title}</em>
                </a>
              </span>
              {album.artist && <span className="book-byline">{album.artist}</span>}
              <span className="meta">{plays(album.plays)}</span>
            </li>
          ))}
        </ol>
      )}

      {month.artists.length > 0 && (
        <ol className="artist-chart">
          {month.artists.map((artist, i) => (
            <li key={artist.url}>
              <span className="meta">{String(i + 1).padStart(2, "0")}</span>
              <a href={artist.url}>{artist.name}</a>
              <span className="meta">{artist.plays}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function YearsAgo({ weeks }: { weeks: YearAgo[] }) {
  const recent = weeks.slice(0, RECENT_YEARS);
  const earlier = weeks.slice(RECENT_YEARS);
  return (
    <div className="listening-block">
      <h3 className="meta listening-block-title">This week, years ago</h3>
      <ol className="years-ago">
        {recent.map((week) => (
          <YearRow key={week.year} week={week} />
        ))}
      </ol>
      {earlier.length > 0 && (
        <details className="years-ago-more">
          <summary>
            <span className="meta">
              <span className="show-label">Show all {weeks.length} years</span>
              <span className="hide-label">Show fewer</span>
            </span>
          </summary>
          <ol className="years-ago">
            {earlier.map((week) => (
              <YearRow key={week.year} week={week} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function YearRow({ week }: { week: YearAgo }) {
  const others = week.artists
    .filter((a) => a.name !== week.album?.artist)
    .slice(0, 2);
  return (
    <li>
      <span className="meta years-ago-year">{week.year}</span>
      {week.album ? (
        <AlbumCover album={week.album} className="years-ago-cover" />
      ) : (
        <span className="cover cover-square years-ago-cover" />
      )}
      <span className="years-ago-text">
        {week.album ? (
          <span>
            <a href={week.album.url}>
              <em>{week.album.title}</em>
            </a>
            {week.album.artist && <> — {week.album.artist}</>}
          </span>
        ) : (
          <a href={week.artists[0]?.url}>{week.artists[0]?.name}</a>
        )}
        <span className="years-ago-detail">
          {others.length > 0 && <>Also {others.map((a) => a.name).join(", ")} · </>}
          {plays(week.plays)} that week
        </span>
      </span>
    </li>
  );
}
