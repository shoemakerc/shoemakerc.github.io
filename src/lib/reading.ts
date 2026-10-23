import fs from "node:fs";
import path from "node:path";

// Two sources make up the shelf:
//
// - content/goodreads.json, a snapshot of the Goodreads shelves written by
//   scripts/sync-goodreads.mjs. This is where reading gets tracked now.
// - content/reading.md, the README from github.com/shoemakerc/books, which was
//   the reading list before Goodreads. Format: `## Section` headings, then
//   `* _Title_ by Author` bullets, where ~~struck~~ means read and **bold**
//   means currently reading. Indented bullets are entries in a series.
//
// A book on both lists takes its details from Goodreads. A book that is only
// on the old list still shows up, just without a cover or rating.

export type Status = "reading" | "paused" | "read" | "to-read" | "dnf";

export type Book = {
  title: string;
  /** Whether the title was written in "quotes" (an essay or story) rather than _italics_. */
  quoted: boolean;
  /** e.g. "by Albert Camus" or "translated by Red Pine". */
  byline: string;
  series: string | null;
  status: Status;
  /** 1–5 stars, if rated on Goodreads. */
  rating: number | null;
  /** ISO date the book was finished, if Goodreads has one. */
  dateRead: string | null;
  dateAdded: string | null;
  pages: number | null;
  cover: string | null;
  /** The book's Goodreads page. Null for books only on the old list. */
  url: string | null;
};

type GoodreadsBook = {
  id: string;
  title: string;
  series: string | null;
  author: string;
  shelf: "currently-reading" | "read" | "to-read" | "did-not-finish";
  tags: string[];
  rating: number | null;
  dateRead: string | null;
  dateAdded: string | null;
  pages: number | null;
  cover: string | null;
  url: string;
};

type Snapshot = { profile: string; syncedAt: string; books: GoodreadsBook[] };

type ListBook = {
  title: string;
  quoted: boolean;
  byline: string;
  series: string | null;
  status: "read" | "reading" | "unread";
};

/** A loose key for matching the same book across both lists. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, "")
    .split(":")[0]
    .replace(/,?\s+and other (essays|stories|writings)$/, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseListEntry(raw: string): Omit<ListBook, "series"> {
  let text = raw.trim();
  let status: ListBook["status"] = "unread";
  if (text.startsWith("~~") && text.endsWith("~~")) {
    status = "read";
    text = text.slice(2, -2);
  } else if (text.startsWith("**") && text.endsWith("**")) {
    status = "reading";
    text = text.slice(2, -2);
  }

  const match = text.match(/^_(.+?)_(.*)$/) ?? text.match(/^"(.+?)"(.*)$/);
  if (!match) return { title: text, quoted: false, byline: "", status };
  return {
    title: match[1],
    quoted: text.startsWith('"'),
    byline: match[2].trim(),
    status,
  };
}

/** The old list, flattened: a series becomes its individual books. */
function readList(): ListBook[] {
  const source = fs.readFileSync(
    path.join(process.cwd(), "content", "reading.md"),
    "utf8",
  );

  const books: ListBook[] = [];
  let parent: (ListBook & { hasChildren: boolean }) | null = null;
  for (const line of source.split("\n")) {
    const item = line.match(/^(\s*)\*\s+(.+)/);
    if (!item) continue;
    const entry = parseListEntry(item[2]);
    if (item[1].length > 0 && parent) {
      parent.hasChildren = true;
      books.push({
        ...entry,
        byline: entry.byline || parent.byline.replace(/^series\s+/, ""),
        series: parent.title,
      });
    } else {
      parent = { ...entry, series: null, hasChildren: false };
      books.push(parent);
    }
  }
  // Drop series headings like "_Dune_ series by Frank Herbert"; their books are listed.
  return books.filter((b) => !("hasChildren" in b && b.hasChildren));
}

function readSnapshot(): Snapshot {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "content", "goodreads.json"), "utf8"),
  );
}

const shelfStatus = (book: GoodreadsBook): Status =>
  book.shelf === "currently-reading"
    ? book.tags.includes("paused")
      ? "paused"
      : "reading"
    : book.shelf === "read"
      ? "read"
      : book.shelf === "did-not-finish"
        ? "dnf"
        : "to-read";

// When Goodreads lists the same book twice (different editions), keep the one
// furthest along.
const progress: Record<Status, number> = {
  "to-read": 0,
  dnf: 1,
  paused: 2,
  reading: 3,
  read: 4,
};

export type Library = {
  books: Book[];
  profile: string;
  syncedAt: string;
};

export function getLibrary(): Library {
  const snapshot = readSnapshot();
  const byKey = new Map<string, Book>();

  for (const gr of snapshot.books) {
    const key = titleKey(gr.title);
    const book: Book = {
      title: gr.title,
      quoted: false,
      byline: `by ${gr.author}`,
      series: gr.series,
      status: shelfStatus(gr),
      rating: gr.rating,
      dateRead: gr.dateRead,
      dateAdded: gr.dateAdded,
      pages: gr.pages,
      cover: gr.cover,
      url: gr.url,
    };
    const existing = byKey.get(key);
    if (!existing || progress[book.status] > progress[existing.status]) {
      byKey.set(key, book);
    }
  }

  for (const item of readList()) {
    const key = titleKey(item.title);
    const match = byKey.get(key);
    if (match) {
      // Once read, always read, even if Goodreads has it back on to-read.
      if (item.status === "read" && match.status === "to-read") match.status = "read";
      continue;
    }
    byKey.set(key, {
      title: item.title,
      quoted: item.quoted,
      byline: item.byline,
      series: item.series,
      // "Currently reading" on the old list dates from 2023; Goodreads tracks
      // what's actually on the go now.
      status: item.status === "read" ? "read" : "to-read",
      rating: null,
      dateRead: null,
      dateAdded: null,
      pages: null,
      cover: null,
      url: null,
    });
  }

  return {
    books: [...byKey.values()],
    profile: snapshot.profile,
    syncedAt: snapshot.syncedAt,
  };
}

/** The surname-ish word used to sort a byline: "by Ursula K. Le Guin" → "le guin". */
export function authorSortKey(byline: string): string {
  const name = byline
    .replace(/^.*?\bby\s+/, "")
    .split(/,| and /)[0]
    .replace(/\b(M\.D\.?|Jr\.?|Sr\.?)$/, "")
    .trim();
  const words = name.split(/\s+/);
  const particle = words.findIndex(
    (w, i) => i > 0 && i < words.length - 1 && /^(le|de|van|von|da|del|st\.)$/i.test(w),
  );
  return (particle > 0 ? words.slice(particle) : words.slice(-1)).join(" ").toLowerCase();
}
