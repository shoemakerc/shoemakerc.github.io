import type { Metadata } from "next";
import Link from "next/link";
import { Staff } from "@/components/ui";
import {
  billy,
  categories,
  getBookcases,
  getKindle,
  kindlePage,
  spaceHeight,
  type Copy,
  type Ebook,
  type Shelf,
} from "@/lib/bookcase";
import { authorSortKey } from "@/lib/reading";

export const metadata: Metadata = {
  title: "The bookcases",
  description: "The books I own, shelved the way they are at home, and the ones on the Kindle.",
};

const count = new Intl.NumberFormat("en-US");

const kinds = { fiction: "Fiction", nonfiction: "Nonfiction", classics: "Classics" } as const;

/** What each status is called, and the spine it gets, as on the author shelves. */
const statuses = {
  read: { label: "Read", spine: "spine-read" },
  aside: { label: "Set aside", spine: "spine-reading" },
  unread: { label: "On the shelf", spine: "spine-owned" },
} as const;

const statusOf = (copy: Copy) => statuses[copy.status].label;

/** What the Kindle puts under a cover: how far in, or that it's done. */
function standing(book: Ebook) {
  if (book.status === "read") return "Read";
  if (book.status === "unread") return "Unread";
  if (book.percent != null) return `${book.percent}%`;
  return book.status === "aside" ? "Set aside" : "Reading";
}

/** The same in a sentence, for the list and for a screen reader. */
function standingInFull(book: Ebook) {
  if (book.status === "read") return "Read";
  if (book.status === "unread") return "Not read yet";
  const far = book.percent != null ? `, ${book.percent}% in` : "";
  return `${book.status === "aside" ? "Set aside" : "Reading now"}${far}`;
}

/** One screen of the Kindle's library: a page of covers, three across. */
function Kindle({ books, page, pages }: { books: Ebook[]; page: number; pages: number }) {
  // A page that isn't full still takes up the whole screen.
  const blanks = Array.from({ length: kindlePage - books.length });
  return (
    <div className="kindle" role="group" aria-label={`Kindle library, page ${page} of ${pages}`}>
      <div className="kindle-screen">
        <p className="kindle-bar" aria-hidden="true">
          <span>Library</span>
          <span>Downloaded</span>
        </p>
        <ol className="kindle-grid">
          {books.map((book) => (
            <li key={book.url}>
              <a
                href={book.url}
                className="kindle-cover"
                aria-label={`${shortTitle(book.title)} by ${book.author}. ${standingInFull(book)}.`}
                title={`${shortTitle(book.title)} by ${book.author}. ${standingInFull(book)}.`}
              >
                {book.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={book.cover} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="kindle-untitled">{shortTitle(book.title)}</span>
                )}
              </a>
              <span className={`kindle-standing kindle-${book.status}`} aria-hidden="true">
                {standing(book)}
              </span>
            </li>
          ))}
          {blanks.map((_, i) => (
            <li key={i} aria-hidden="true" />
          ))}
        </ol>
        <p className="kindle-bar kindle-foot" aria-hidden="true">
          Page {page} of {pages}
        </p>
      </div>
      <p className="kindle-name" aria-hidden="true">
        kindle
      </p>
    </div>
  );
}

/** Drops edition notes like "(Penguin Classics)" and the subtitle. */
const shortTitle = (title: string) => title.replace(/\s*\([^)]*\)$/, "").split(/:\s/)[0];

/** The name on the spine: "Kurt Vonnegut Jr." → "vonnegut", "Augustine of Hippo" → "augustine". */
function surname(author: string) {
  const key = authorSortKey(`by ${author}`);
  const words = author.replace(/[.,]/g, "").split(" ");
  const ending = words.slice(-key.split(" ").length).join(" ");
  const plain = ending.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  // The sort key has no accents, so where the name ends with it, take it from
  // the name. Where it doesn't, the key is the part that matters.
  return plain === key ? ending : key;
}

/** A book standing on the shelf, as tall and as thick as the book. */
function Volume({ copy }: { copy: Copy }) {
  const label = [
    `${shortTitle(copy.title)} by ${copy.author}`,
    copy.year != null && (copy.year > 0 ? copy.year : `${Math.max(1, -copy.year)} BC`),
    `${copy.format.toLowerCase()}${copy.pages ? `, ${count.format(copy.pages)} pages` : ""}.`,
    `${statusOf(copy)}.`,
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/, (Read|Set aside|On the shelf)\.$/, " $1.");
  // A thin spine has room for the title in small type, and a very thin one
  // for nothing at all.
  const lettering = copy.thickness >= 1.6 ? "full" : copy.thickness >= 1.15 ? "slim" : "none";
  return (
    <li>
      <a
        href={copy.url}
        className={[
          "volume",
          statuses[copy.status].spine,
          lettering === "slim" && "volume-slim",
        ]
          .filter(Boolean)
          .join(" ")}
        title={label}
        aria-label={label}
        style={{ "--tall": copy.height, "--thick": copy.thickness } as React.CSSProperties}
      >
        {lettering !== "none" && <span className="volume-title">{shortTitle(copy.title)}</span>}
        {lettering === "full" && <span className="volume-author">{surname(copy.author)}</span>}
      </a>
    </li>
  );
}

function Space({ shelf }: { shelf: Shelf }) {
  return (
    <div className="billy-space">
      <ol
        className="billy-books"
        aria-label={shelf.category ? `${kinds[shelf.category]}, ${shelf.range}` : "An empty shelf"}
      >
        {shelf.copies.map((copy) => (
          <Volume key={copy.url} copy={copy} />
        ))}
      </ol>
      {/* The shelf the books stand on, labelled along its edge like a library's. */}
      <p className="billy-shelf" aria-hidden="true">
        {shelf.category && (
          <>
            <span>{kinds[shelf.category]}</span>
            <span>{shelf.range}</span>
          </>
        )}
      </p>
    </div>
  );
}

export default function Bookcases() {
  const { units, copies, length } = getBookcases();
  const read = copies.filter((copy) => copy.status === "read").length;
  const shown = (["read", "aside", "unread"] as const).filter((status) =>
    copies.some((copy) => copy.status === status),
  );
  const of = (kind: Copy["category"]) => copies.filter((copy) => copy.category === kind);

  const ebooks = getKindle();
  const screens = Array.from({ length: Math.ceil(ebooks.length / kindlePage) }, (_, i) =>
    ebooks.slice(i * kindlePage, (i + 1) * kindlePage),
  );
  const ebooksRead = ebooks.filter((book) => book.status === "read").length;

  const stats = [
    { value: copies.length, label: "books in print" },
    { value: read, label: `read, ${copies.length - read} to go` },
    { value: `${(length / 100).toFixed(1)} m`, label: "of shelf, spine to spine" },
    ...categories.map((kind) => ({ value: of(kind).length, label: kinds[kind].toLowerCase() })),
  ];

  return (
    <>
      <section className="page-intro">
        <p className="meta">
          <Link href="/reading/">Reading</Link> / In print
        </p>
        <h1 className="page-title">The bookcases</h1>
        <p className="lede">
          The books I own on paper, shelved the way they are at home: fiction,
          then nonfiction, then the ancients, each by author. Drawn to scale,
          so a long book is a thick one and a hardcover stands taller than a
          paperback. Whatever I’m in the middle of is on{" "}
          <Link href="/reading/">the nightstand</Link> instead, though a book
          I’ve set aside is back on its shelf here as well.
          {ebooks.length > 0 && (
            <>
              {" "}
              The ones with no spine to show are <a href="#kindle">on the Kindle</a>, further
              down.
            </>
          )}
        </p>
        <dl className="reading-stats bookcase-stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="meta">{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <Staff label="In print" />
        <ul className="shelf-legend bookcase-legend">
          {shown.map((status) => (
            <li key={status} className="meta">
              <span className={`shelf-swatch ${statuses[status].spine}`} aria-hidden="true" />
              {statuses[status].label}
            </li>
          ))}
        </ul>
        <div
          className="bookcases"
          style={
            {
              "--billy-width": billy.width,
              "--billy-panel": billy.panel,
              "--billy-plinth": billy.plinth,
              "--billy-space": spaceHeight,
            } as React.CSSProperties
          }
        >
          {units.map((unit, i) => (
            <div
              key={i}
              className="billy"
              role="group"
              aria-label={`Bookcase ${i + 1} of ${units.length}`}
            >
              {unit.map((shelf, j) => (
                <Space key={j} shelf={shelf} />
              ))}
              <div className="billy-plinth" />
            </div>
          ))}
        </div>
        <details className="shelf-list">
          <summary>
            <span className="meta">Show as a list</span>
          </summary>
          <div className="shelf-list-columns">
            {categories.map((kind) => (
              <div key={kind}>
                <h2 className="meta shelf-list-author">{kinds[kind]}</h2>
                <ol className="book-list">
                  {of(kind).map((copy) => (
                    <li key={copy.url} className="book">
                      <div className="book-line">
                        <span className="book-text">
                          <a href={copy.url}>
                            <em>{shortTitle(copy.title)}</em>
                          </a>
                          <span className="book-byline"> by {copy.author}</span>
                        </span>
                        <span className="meta">{statusOf(copy)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </details>
        <p className="shelves-companions">
          The shelves are IKEA’s narrow BILLY, {billy.width} cm wide and{" "}
          {billy.height} cm tall. Each book’s thickness comes from its page
          count and its height from its format, or from the edition’s own
          measurements where <a href="https://openlibrary.org/">Open Library</a>{" "}
          has them.
        </p>
      </section>

      {ebooks.length > 0 && (
        <section id="kindle">
          <Staff label="On the Kindle" />
          <p className="lede-small shelves-lede">
            The shelf that weighs nothing: {ebooks.length} books, {ebooksRead} of them read, shown
            the way the Kindle shows them, a screenful of covers at a time and all of it in grey.
          </p>
          <div className="kindles">
            {screens.map((books, i) => (
              <Kindle key={i} books={books} page={i + 1} pages={screens.length} />
            ))}
          </div>
          <details className="shelf-list">
            <summary>
              <span className="meta">Show as a list</span>
            </summary>
            <ol className="book-list">
              {ebooks.map((book) => (
                <li key={book.url} className="book">
                  <div className="book-line">
                    <span className="book-text">
                      <a href={book.url}>
                        <em>{shortTitle(book.title)}</em>
                      </a>
                      <span className="book-byline"> by {book.author}</span>
                    </span>
                    <span className="meta">{standingInFull(book)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
    </>
  );
}
