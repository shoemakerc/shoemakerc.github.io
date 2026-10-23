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

/** The title without accents, subtitle or edition notes, in lowercase. */
function plainTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, "")
    .split(":")[0]
    .trim()
    .replace(/,?\s+and other (essays|stories|writings)$/, "");
}

const squash = (title: string) =>
  title.replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]/g, "");

/** Matches two editions of the same book, but keeps volumes of a series apart. */
function editionKey(title: string): string {
  return squash(plainTitle(title));
}

/**
 * Matches an old-list entry to Goodreads, where the old list often names a
 * series or a work that Goodreads has by volume or by edition.
 */
function listKey(title: string): string {
  return squash(
    plainTitle(title)
      // "Eyeshield 21, Vol. 1" and "Planetes Omnibus, Volume 2" belong to the series.
      .replace(/,?\s*vol(ume)?\.?\s*(\d+|[ivx]+)$/, "")
      .replace(/\s+omnibus$/, "")
      // "The Gulag Archipelago 1918–1956" is "The Gulag Archipelago".
      .replace(/\s*\d{4}\s*[-–]\s*\d{4}$/, ""),
  );
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
    const key = editionKey(gr.title);
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

  const byListKey = new Map<string, Book[]>();
  for (const book of byKey.values()) {
    const key = listKey(book.title);
    byListKey.set(key, [...(byListKey.get(key) ?? []), book]);
  }

  for (const item of readList()) {
    const key = listKey(item.title);
    const matches = byListKey.get(key);
    if (matches) {
      // Once read, always read, even if Goodreads has it back on to-read.
      for (const match of matches) {
        if (item.status === "read" && match.status === "to-read") match.status = "read";
      }
      continue;
    }
    byKey.set(`list:${key}`, {
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

// Names that don't sort by their last word: family name first, surnames of
// more than one word, and people known by a single name.
const sortNames: Record<string, string> = {
  "Augustine of Hippo": "augustine",
  "Bessel van der Kolk": "van der kolk",
  "Gabriel García Márquez": "garcia marquez",
  "Giuseppe Tomasi di Lampedusa": "tomasi di lampedusa",
  "Han Kang": "han kang",
  "Hu Anyan": "hu anyan",
  "Johann Wolfgang von Goethe": "goethe",
  "Lao Tzu": "lao tzu",
  "Liu Cixin": "liu cixin",
  "Madame de La Fayette": "la fayette",
  "Marcus Aurelius": "marcus aurelius",
  "Mario Vargas Llosa": "vargas llosa",
  "Quintus Curtius Rufus": "curtius rufus",
  "Robert van Gulik": "van gulik",
  "Sun Tzu": "sun tzu",
  "Thich Nhat Hanh": "nhat hanh",
  "Ursula K. Le Guin": "le guin",
};

/** The name to sort a byline by: "by Ursula K. Le Guin" → "le guin". */
export function authorSortKey(byline: string): string {
  const name = byline
    .replace(/^.*?\bby\s+/, "")
    .split(/,| and /)[0]
    .replace(/\s+/g, " ")
    .replace(/\s(M\.D\.?|Jr\.?|Sr\.?)$/, "")
    .trim();
  return (sortNames[name] ?? name.split(" ").at(-1) ?? "").toLowerCase();
}
