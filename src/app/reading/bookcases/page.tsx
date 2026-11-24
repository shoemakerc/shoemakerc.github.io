import type { Metadata } from "next";
import Link from "next/link";
import { Staff } from "@/components/ui";
import { billy, getBookcases, spaceHeight, type Copy, type Shelf } from "@/lib/bookcase";
import { authorSortKey } from "@/lib/reading";

export const metadata: Metadata = {
  title: "The bookcases",
  description: "The books I own in print, shelved the way they are at home.",
};

const count = new Intl.NumberFormat("en-US");

const kinds = { fiction: "Fiction", nonfiction: "Nonfiction" } as const;

const statusOf = (copy: Copy) => (copy.read ? "Read" : "On the shelf");

/** Drops edition notes like "(Penguin Classics)" and the subtitle. */
const shortTitle = (title: string) => title.replace(/\s*\([^)]*\)$/, "").split(/:\s/)[0];

/** The name on the spine: "Kurt Vonnegut Jr." → "Vonnegut". */
function surname(author: string) {
  const key = authorSortKey(`by ${author}`);
  const words = author.replace(/[.,]/g, "").split(" ");
  // The sort key is the surname in lowercase, without its accents.
  return words.slice(-key.split(" ").length).join(" ");
}

/** A book standing on the shelf, as tall and as thick as the book. */
function Volume({ copy }: { copy: Copy }) {
  const label = [
    `${shortTitle(copy.title)} by ${copy.author}`,
    copy.year,
    `${copy.format.toLowerCase()}${copy.pages ? `, ${count.format(copy.pages)} pages` : ""}.`,
    `${statusOf(copy)}.`,
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/, (Read|On the shelf)\.$/, " $1.");
  // A thin spine has room for the title in small type, and a very thin one
  // for nothing at all.
  const lettering = copy.thickness >= 1.6 ? "full" : copy.thickness >= 1.15 ? "slim" : "none";
  return (
    <li>
      <a
        href={copy.url}
        className={[
          "volume",
          copy.read ? "spine-read" : "spine-owned",
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
  const read = copies.filter((copy) => copy.read).length;
  const of = (kind: Copy["category"]) => copies.filter((copy) => copy.category === kind);

  const stats = [
    { value: copies.length, label: "books in print" },
    { value: read, label: `read, ${copies.length - read} to go` },
    { value: `${of("fiction").length} / ${of("nonfiction").length}`, label: "fiction / nonfiction" },
    { value: `${(length / 100).toFixed(1)} m`, label: "of shelf, spine to spine" },
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
          then nonfiction, each by author. Drawn to scale, so a long book is a
          thick one and a hardcover stands taller than a paperback. Whatever
          I’m in the middle of is on <Link href="/reading/">the nightstand</Link>{" "}
          instead.
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

      <section>
        <Staff label="In print" />
        <ul className="shelf-legend bookcase-legend">
          <li className="meta">
            <span className="shelf-swatch spine-read" aria-hidden="true" />
            Read
          </li>
          <li className="meta">
            <span className="shelf-swatch spine-owned" aria-hidden="true" />
            On the shelf
          </li>
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
            {(["fiction", "nonfiction"] as const).map((kind) => (
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
    </>
  );
}
