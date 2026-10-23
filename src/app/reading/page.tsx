import type { Metadata } from "next";
import { Staff } from "@/components/ui";
import {
  getCurrentlyReading,
  getShelves,
  type Book,
  type Status,
} from "@/lib/reading";

export const metadata: Metadata = {
  title: "Reading",
  description: "Books I’ve read, am reading, and would like to read.",
};

const statusLabel: Record<Status, string> = {
  read: "Read",
  reading: "Reading",
  unread: "",
};

function BookTitle({ book }: { book: Book }) {
  return book.quoted ? <>“{book.title}”</> : <em>{book.title}</em>;
}

function BookRow({ book }: { book: Book }) {
  return (
    <li className={`book book-${book.status}`}>
      <div className="book-line">
        <span className="book-text">
          <BookTitle book={book} />
          {book.byline && <span className="book-byline"> {book.byline}</span>}
        </span>
        {statusLabel[book.status] && (
          <span className="meta book-status">{statusLabel[book.status]}</span>
        )}
      </div>
      {book.children.length > 0 && (
        <ol className="book-series">
          {book.children.map((child) => (
            <BookRow key={child.title} book={child} />
          ))}
        </ol>
      )}
    </li>
  );
}

export default function Reading() {
  const shelves = getShelves();
  const current = getCurrentlyReading(shelves);
  const all = shelves.flatMap((s) =>
    s.books.flatMap((b) => (b.children.length ? b.children : [b])),
  );
  const read = all.filter((b) => b.status === "read").length;

  return (
    <>
      <section className="page-intro">
        <p className="meta">Reading</p>
        <h1 className="page-title">The shelf</h1>
        <p className="lede">
          Books I’ve read, am reading, or would like to read someday. Kept for
          accountability purposes only.
        </p>
        <p className="meta reading-tally">
          {read} read · {current.length} in progress · {all.length} on the list
        </p>
      </section>

      {current.length > 0 && (
        <section>
          <Staff label="On the nightstand" />
          <ul className="now-reading">
            {current.map(({ book, series }) => (
              <li key={book.title}>
                <span className="now-reading-title">
                  <BookTitle book={book} />
                </span>
                <span className="book-byline">
                  {series ? (
                    <>
                      from <BookTitle book={series} />{" "}
                      {series.byline.replace(/^series\s+/, "")}
                    </>
                  ) : (
                    book.byline
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shelves.map((shelf) => (
        <section key={shelf.name} className="shelf">
          <Staff label={shelf.name} />
          <ol className="book-list">
            {shelf.books.map((book) => (
              <BookRow key={book.title} book={book} />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
