import type { Metadata } from "next";
import { Staff } from "@/components/ui";
import { authorSortKey, getLibrary, type Book } from "@/lib/reading";

export const metadata: Metadata = {
  title: "Reading",
  description: "Books I’ve read, am reading, and would like to read.",
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function BookTitle({ book }: { book: Book }) {
  return book.quoted ? <>“{book.title}”</> : <em>{book.title}</em>;
}

/** The title, linked to Goodreads when the book is there. */
function LinkedTitle({ book }: { book: Book }) {
  return book.url ? (
    <a href={book.url}>
      <BookTitle book={book} />
    </a>
  ) : (
    <BookTitle book={book} />
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span className="stars" aria-label={`Rated ${rating} out of 5`}>
      {"★".repeat(rating)}
      <span className="stars-empty">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function Cover({ book }: { book: Book }) {
  const image = book.cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={book.cover} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className="cover-blank" aria-hidden="true">
      {book.title}
    </span>
  );
  return book.url ? (
    <a href={book.url} className="cover" tabIndex={-1} aria-hidden="true">
      {image}
    </a>
  ) : (
    <span className="cover">{image}</span>
  );
}

function CoverCard({ book, note }: { book: Book; note?: string }) {
  return (
    <li className="cover-card">
      <Cover book={book} />
      <span className="cover-card-title">
        <LinkedTitle book={book} />
      </span>
      <span className="book-byline">{book.byline}</span>
      {note && <span className="meta">{note}</span>}
      <Stars rating={book.rating} />
    </li>
  );
}

function BookLine({ book }: { book: Book }) {
  return (
    <li className="book">
      <div className="book-line">
        <span className="book-text">
          <LinkedTitle book={book} />
          {book.byline && <span className="book-byline"> {book.byline}</span>}
        </span>
        <Stars rating={book.rating} />
      </div>
    </li>
  );
}

const keyOf = (book: Book) => `${book.title}|${book.byline}`;

const byAuthor = (a: Book, b: Book) =>
  authorSortKey(a.byline).localeCompare(authorSortKey(b.byline)) ||
  a.title.localeCompare(b.title);

const newestFirst = (key: "dateRead" | "dateAdded") => (a: Book, b: Book) =>
  (b[key] ?? "").localeCompare(a[key] ?? "");

export default function Reading() {
  const { books, profile, syncedAt } = getLibrary();
  const having = (status: Book["status"]) => books.filter((b) => b.status === status);

  const reading = having("reading");
  const paused = having("paused");
  const read = having("read");
  const toRead = having("to-read").sort(byAuthor);
  const dnf = having("dnf").sort(byAuthor);

  const dated = read.filter((b) => b.dateRead).sort(newestFirst("dateRead"));
  const undated = read.filter((b) => !b.dateRead).sort(byAuthor);
  const years = [...new Set(dated.map((b) => b.dateRead!.slice(0, 4)))];
  const thisYear = new Date(syncedAt).getUTCFullYear().toString();

  const rated = read.filter((b) => b.rating);
  const average = rated.reduce((sum, b) => sum + b.rating!, 0) / rated.length;
  const pages = read.reduce((sum, b) => sum + (b.pages ?? 0), 0);

  const stats = [
    { value: read.length, label: "books read" },
    { value: dated.filter((b) => b.dateRead!.startsWith(thisYear)).length, label: `finished in ${thisYear}` },
    { value: `${Math.round(pages / 1000)}k`, label: "pages, give or take" },
    { value: average.toFixed(2), label: `average of ${rated.length} ratings` },
  ];

  return (
    <>
      <section className="page-intro">
        <p className="meta">Reading</p>
        <h1 className="page-title">The shelf</h1>
        <p className="lede">
          Books I’ve read, am reading, or would like to read someday. Kept for
          accountability purposes only, and tracked on{" "}
          <a href={profile}>Goodreads</a>.
        </p>
        <dl className="reading-stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="meta">{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {reading.length > 0 && (
        <section>
          <Staff label="On the nightstand" />
          <ul className="cover-grid cover-grid-large">
            {reading.map((book) => (
              <CoverCard key={keyOf(book)} book={book} />
            ))}
          </ul>
          {paused.length > 0 && (
            <p className="set-aside">
              <span className="meta">Set aside for now</span>{" "}
              {paused.map((book, i) => (
                <span key={keyOf(book)}>
                  {i > 0 && " · "}
                  <LinkedTitle book={book} />
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      <section>
        <Staff label="Finished" />
        {years.map((year) => {
          const finished = dated.filter((b) => b.dateRead!.startsWith(year));
          return (
            <div key={year} className="reading-year">
              <h2 className="reading-year-head">
                <span>{year}</span>
                <span className="meta">{finished.length} books</span>
              </h2>
              <ul className="cover-grid">
                {finished.map((book) => (
                  <CoverCard key={keyOf(book)} book={book} />
                ))}
              </ul>
            </div>
          );
        })}
        {undated.length > 0 && (
          <div className="reading-year">
            <h2 className="reading-year-head">
              <span>Earlier</span>
              <span className="meta">{undated.length} books</span>
            </h2>
            <ol className="book-list">
              {undated.map((book) => (
                <BookLine key={keyOf(book)} book={book} />
              ))}
            </ol>
          </div>
        )}
      </section>

      <section>
        <Staff label="Want to read" />
        <details className="to-read">
          <summary>
            <span className="meta">
              Show all {toRead.length}, by author
            </span>
          </summary>
          <ol className="book-list">
            {toRead.map((book) => (
              <BookLine key={keyOf(book)} book={book} />
            ))}
          </ol>
        </details>
      </section>

      {dnf.length > 0 && (
        <section>
          <Staff label="Did not finish" />
          <ol className="book-list">
            {dnf.map((book) => (
              <BookLine key={keyOf(book)} book={book} />
            ))}
          </ol>
        </section>
      )}

      <p className="meta reading-synced">
        Synced from <a href={profile}>Goodreads</a> ·{" "}
        {dateFormat.format(new Date(syncedAt))}
      </p>
    </>
  );
}
