import type { Metadata } from "next";
import { Staff } from "@/components/ui";
import { getAuthors, type Author, type Volume } from "@/lib/authors";
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

/** Drops edition notes like "(Penguin Classics)", and with `short`, the subtitle too. */
function displayTitle(title: string, short: boolean) {
  const trimmed = title.replace(/\s*\([^)]*\)$/, "");
  return short ? trimmed.split(/:\s/)[0] : trimmed;
}

function BookTitle({ book, short = false }: { book: Book; short?: boolean }) {
  const title = displayTitle(book.title, short);
  return book.quoted ? <>“{title}”</> : <em>{title}</em>;
}

/** The title, linked to Goodreads when the book is there. */
function LinkedTitle({ book, short }: { book: Book; short?: boolean }) {
  return book.url ? (
    <a href={book.url}>
      <BookTitle book={book} short={short} />
    </a>
  ) : (
    <BookTitle book={book} short={short} />
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
      {displayTitle(book.title, true)}
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

function CoverCard({ book }: { book: Book }) {
  return (
    <li className="cover-card">
      <Cover book={book} />
      <span className="cover-card-title">
        <LinkedTitle book={book} short />
      </span>
      <span className="book-byline">{book.byline}</span>
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

const shelfLabel: Record<Volume["status"], string> = {
  read: "Read",
  reading: "Reading",
  owned: "On the shelf",
  unowned: "Not yet",
};

function describe(work: Volume) {
  const { book } = work;
  if (work.status === "reading") return "Reading now";
  if (work.status === "owned") return "On the shelf, not read yet";
  if (work.status === "unowned" || !book) return "Not on the shelf yet";
  return [
    book.dateRead ? `Read ${dateFormat.format(new Date(book.dateRead))}` : "Read",
    book.rating && `${book.rating} of 5 stars`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Between 90% and 100% of the shelf's height, the same for a title every time. */
function spineHeight(title: string) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return 90 + (hash % 11);
}

/** A book's spine, as wide as the book is long. */
function Spine({ work }: { work: Volume }) {
  const label = `${work.title}, ${work.year}. ${describe(work)}`;
  const props = {
    className: `spine spine-${work.status}`,
    title: label,
    "aria-label": label,
    style: {
      "--pages": work.book?.pages ?? work.pages,
      "--height": `${spineHeight(work.title)}%`,
    } as React.CSSProperties,
  };
  const face = (
    <>
      <span className="spine-title">{work.spine ?? work.title}</span>
      <span className="spine-year">{work.year}</span>
    </>
  );
  return (
    <li>
      {work.book?.url ? (
        <a href={work.book.url} {...props}>
          {face}
        </a>
      ) : (
        <span role="img" {...props}>
          {face}
        </span>
      )}
    </li>
  );
}

function AuthorShelf({ author }: { author: Author }) {
  const count = (status: Volume["status"]) =>
    author.works.filter((work) => work.status === status).length;
  const progress = [
    count("reading") > 0 && `${count("reading")} under way`,
    count("owned") > 0 && `${count("owned")} more on the shelf`,
  ].filter(Boolean);
  return (
    <div className="author-shelf">
      <div className="author-shelf-head">
        <h3 className="author-shelf-name">{author.name}</h3>
        <p className="author-shelf-tally">
          <span className="author-shelf-number">{count("read")}</span> of{" "}
          {author.works.length} read
        </p>
        {progress.length > 0 && <p className="meta">{progress.join(" · ")}</p>}
      </div>
      <ol className="shelf" aria-label={`Books by ${author.name}, oldest first`}>
        {author.works.map((work) => (
          <Spine key={work.title} work={work} />
        ))}
      </ol>
    </div>
  );
}

function AuthorShelves({ authors }: { authors: Author[] }) {
  return (
    <section>
      <Staff label="Completist" />
      <h2 className="section-title">Pynchon &amp; Wallace</h2>
      <p className="lede-small shelves-lede">
        Two writers I’m reading my way through: paranoia on one shelf, footnotes
        on the other. Every book each of them published, in the order they came
        out, filled in as I go.
      </p>
      {authors.map((author) => (
        <AuthorShelf key={author.name} author={author} />
      ))}
      <ul className="shelf-legend">
        {(["read", "reading", "owned", "unowned"] as const).map((status) => (
          <li key={status} className="meta">
            <span className={`shelf-swatch spine-${status}`} aria-hidden="true" />
            {shelfLabel[status]}
          </li>
        ))}
      </ul>
      <details className="shelf-list">
        <summary>
          <span className="meta">Show as a list</span>
        </summary>
        <div className="shelf-list-columns">
          {authors.map((author) => (
            <div key={author.name}>
              <h3 className="meta shelf-list-author">{author.name}</h3>
              <ol className="book-list">
                {author.works.map((work) => (
                  <li key={work.title} className="book">
                    <div className="book-line">
                      <span className="book-text">
                        {work.book?.url ? (
                          <a href={work.book.url}>
                            <em>{work.title}</em>
                          </a>
                        ) : (
                          <em>{work.title}</em>
                        )}
                        <span className="book-byline"> {work.year}</span>
                      </span>
                      {work.book?.rating ? (
                        <Stars rating={work.book.rating} />
                      ) : (
                        <span className="meta">{shelfLabel[work.status]}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </details>
      <p className="shelves-companions">
        Good company along the way: the{" "}
        <a href="https://pynchonwiki.com/">Pynchon Wiki</a>’s page-by-page
        annotations, and{" "}
        <a href="https://www.thehowlingfantods.com/dfw/">The Howling Fantods</a>{" "}
        for all things Wallace.
      </p>
    </section>
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
                  <LinkedTitle book={book} short />
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      <AuthorShelves authors={getAuthors()} />

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
