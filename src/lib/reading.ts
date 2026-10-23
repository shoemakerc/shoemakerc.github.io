import fs from "node:fs";
import path from "node:path";

// content/reading.md is a copy of the README from github.com/shoemakerc/books.
// Format: `## Section` headings, then `* _Title_ by Author` bullets, where
// ~~struck~~ means read and **bold** means currently reading. Indented bullets
// are entries in a series.

export type Status = "read" | "reading" | "unread";

export type Book = {
  title: string;
  /** Whether the title was written in "quotes" (an essay or story) rather than _italics_. */
  quoted: boolean;
  /** Everything after the title, e.g. "by Albert Camus" or "series by Frank Herbert". */
  byline: string;
  status: Status;
  children: Book[];
};

export type Shelf = { name: string; books: Book[] };

function parseEntry(raw: string): Omit<Book, "children"> {
  let text = raw.trim();
  let status: Status = "unread";
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

export function getShelves(): Shelf[] {
  const source = fs.readFileSync(
    path.join(process.cwd(), "content", "reading.md"),
    "utf8",
  );

  const shelves: Shelf[] = [];
  for (const line of source.split("\n")) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      shelves.push({ name: heading[1].trim(), books: [] });
      continue;
    }
    const item = line.match(/^(\s*)\*\s+(.+)/);
    const shelf = shelves.at(-1);
    if (!item || !shelf) continue;

    const book = { ...parseEntry(item[2]), children: [] };
    const parent = shelf.books.at(-1);
    if (item[1].length > 0 && parent) parent.children.push(book);
    else shelf.books.push(book);
  }

  // A series counts as read once every entry in it is.
  for (const book of shelves.flatMap((s) => s.books)) {
    if (book.children.length && book.status === "unread") {
      const statuses = new Set(book.children.map((c) => c.status));
      if (statuses.has("reading")) book.status = "reading";
      else if (statuses.size === 1 && statuses.has("read")) book.status = "read";
    }
  }
  return shelves;
}

/** Every entry that is marked as currently being read, series entries included. */
export function getCurrentlyReading(
  shelves: Shelf[],
): { book: Book; series?: Book }[] {
  return shelves.flatMap((shelf) =>
    shelf.books.flatMap((book) =>
      book.children.length
        ? book.children
            .filter((child) => child.status === "reading")
            .map((child) => ({ book: child, series: book }))
        : book.status === "reading"
          ? [{ book }]
          : [],
    ),
  );
}
