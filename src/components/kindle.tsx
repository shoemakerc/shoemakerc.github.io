"use client";

import { useRef, useState } from "react";

/** A book as the Kindle's library shows it. The page works the wording out. */
export type KindleBook = {
  title: string;
  cover: string | null;
  url: string;
  /** Under the cover: "Read", "Unread", "23%". */
  standing: string;
  /** Whether that line is set faint, as for a book not started. */
  faint: boolean;
  /** The whole of it in a sentence, for a screen reader and the tooltip. */
  label: string;
};

/**
 * A Kindle Paperwhite (the 11th generation: a 6.8-inch screen, three units
 * wide to four tall, with a deeper bezel under it for the name) showing its
 * library a page at a time. Swiping the screen turns the page, as on the
 * real thing, and so do the arrows at the foot of it.
 */
export function Kindle({ pages, count }: { pages: KindleBook[][]; count: number }) {
  const strip = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const turnTo = (to: number) => {
    const screen = strip.current;
    if (screen) screen.scrollTo({ left: to * screen.clientWidth });
  };

  return (
    <div className="kindle" role="group" aria-label="Kindle library">
      <div className="kindle-screen">
        <p className="kindle-bar" aria-hidden="true">
          <span>Library</span>
          <span>{count} books</span>
        </p>
        <div
          className="kindle-pages"
          ref={strip}
          onScroll={(event) => {
            const screen = event.currentTarget;
            setPage(Math.round(screen.scrollLeft / screen.clientWidth));
          }}
        >
          {pages.map((books, i) => (
            <ol key={i} className="kindle-grid" aria-label={`Page ${i + 1} of ${pages.length}`}>
              {books.map((book) => (
                <li key={book.url}>
                  <a href={book.url} className="kindle-cover" aria-label={book.label} title={book.label}>
                    {book.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={book.cover} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span className="kindle-untitled">{book.title}</span>
                    )}
                  </a>
                  <span
                    className={book.faint ? "kindle-standing kindle-faint" : "kindle-standing"}
                    aria-hidden="true"
                  >
                    {book.standing}
                  </span>
                </li>
              ))}
            </ol>
          ))}
        </div>
        <div className="kindle-bar kindle-foot">
          <button
            type="button"
            onClick={() => turnTo(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span aria-live="polite">
            Page {page + 1} of {pages.length}
          </span>
          <button
            type="button"
            onClick={() => turnTo(page + 1)}
            disabled={page >= pages.length - 1}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
      <p className="kindle-name" aria-hidden="true">
        kindle
      </p>
    </div>
  );
}
