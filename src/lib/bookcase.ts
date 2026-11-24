import {
  authorSortKey,
  editionKey,
  getLibrary,
  readSnapshot,
  type GoodreadsBook,
} from "@/lib/reading";

// The books owned in print, shelved for the bookcase page: everything on the
// Goodreads "owned" shelf except what's on the nightstand, fiction first,
// then nonfiction, then the classics (anything from the ancient world, verse
// or philosophy), each by author and then by when the book came out. The
// shelves are IKEA's narrow BILLY, drawn to scale, and so are the books, so a
// shelf holds what 36 cm of shelf would.

/** The 40 cm BILLY, in centimetres. Six spaces, as it comes out of the box. */
export const billy = {
  width: 40,
  height: 202,
  /** How thick the sides, the top and the shelves are. */
  panel: 1.8,
  /** The kick board under the bottom shelf. */
  plinth: 7,
  spaces: 6,
};

/** How much shelf there is between the sides. */
const shelfWidth = billy.width - 2 * billy.panel;

/** How tall each space is, with the shelves evenly spread. */
export const spaceHeight =
  Math.round(
    ((billy.height - billy.plinth - (billy.spaces + 1) * billy.panel) / billy.spaces) * 10,
  ) / 10;

/** In the order they're shelved. */
export const categories = ["fiction", "nonfiction", "classics"] as const;

export type Category = (typeof categories)[number];

/**
 * The ancient world ends, for shelving purposes, with Rome: a book first
 * published before this year is a classic. Goodreads sometimes has only the
 * date of a modern edition, and then the snapshot's year wants setting by hand.
 */
const antiquityEnds = 500;

/**
 * Whether a book goes with the classics. Its edition's `classic` in the
 * snapshot overrules the year, for the likes of The Tale of Genji: old enough
 * in spirit, five centuries too late by the calendar.
 */
const isClassic = (book: GoodreadsBook) =>
  book.edition?.classic ?? (book.year != null && book.year < antiquityEnds);

export type Copy = {
  title: string;
  author: string;
  /** When the book first came out. Before 1 is BC. */
  year: number | null;
  pages: number | null;
  format: string;
  category: Category;
  read: boolean;
  url: string;
  /** In centimetres. */
  height: number;
  thickness: number;
  /** Whether the height is the edition's own, rather than a guess from its format. */
  measured: boolean;
};

export type Shelf = {
  category: Category | null;
  /** The authors on it, library style: "ADJ–DOS". */
  range: string | null;
  copies: Copy[];
};

type Binding = "hardcover" | "paperback" | "pocket";

function bindingOf(format: string | null): Binding {
  if (/mass market|pocket/i.test(format ?? "")) return "pocket";
  return /hard|cloth|library binding/i.test(format ?? "") ? "hardcover" : "paperback";
}

/**
 * How tall a book stands when Open Library doesn't say. Hardcovers and
 * mass-market paperbacks come in one size, near enough; trade paperbacks vary
 * by house, and Penguin's and Vintage's are a little shorter than most.
 */
function usualHeight(binding: Binding, publisher: string | null): number {
  if (binding === "hardcover") return 23.5;
  if (binding === "pocket") return 17.5;
  if (/penguin/i.test(publisher ?? "")) return 19.7;
  if (/vintage/i.test(publisher ?? "")) return 20.3;
  return 20.6;
}

/**
 * How thick a book is, going by its pages. Long books are printed on thinner
 * paper, so this grows slower than the page count: about 1.6 cm for 250 pages
 * in paperback, 4.7 cm for 1,000. Boards add to a hardcover.
 */
function usualThickness(binding: Binding, pages: number | null): number {
  const leaves = (binding === "pocket" ? 0.018 : 0.02) * (pages ?? 250) ** 0.78;
  return Math.round((leaves + (binding === "hardcover" ? 0.7 : 0.1)) * 10) / 10;
}

const inPrint = (book: GoodreadsBook) => !/kindle|ebook|e-book|audio/i.test(book.edition?.format ?? "");

/** "garcia marquez" → "GAR", for the label on the edge of a shelf. */
const callLetters = (copy: Copy) =>
  authorSortKey(`by ${copy.author}`).replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();

export type Bookcases = {
  /** Each bookcase, top shelf first. The last has empty shelves to spare. */
  units: Shelf[][];
  copies: Copy[];
  /** How much shelf the books take up, in centimetres. */
  length: number;
};

export function getBookcases(): Bookcases {
  // A book counts as read whichever edition was read, so ask the library.
  const read = new Set(
    getLibrary()
      .books.filter((book) => book.status === "read")
      .map((book) => editionKey(book.title)),
  );

  const copies = readSnapshot()
    .books.filter((book) => book.tags.includes("owned"))
    // What's on the nightstand stays there, set aside or not.
    .filter((book) => book.shelf !== "currently-reading")
    .filter(inPrint)
    .map((book): Copy => {
      const binding = bindingOf(book.edition?.format ?? null);
      return {
        title: book.title,
        author: book.author.replace(/\s+/g, " "),
        year: book.year,
        pages: book.pages,
        format: book.edition?.format ?? "Paperback",
        category: isClassic(book) ? "classics" : book.edition?.nonfiction ? "nonfiction" : "fiction",
        read: read.has(editionKey(book.title)),
        url: book.url,
        height: book.edition?.height ?? usualHeight(binding, book.edition?.publisher ?? null),
        thickness: book.edition?.thickness ?? usualThickness(binding, book.pages),
        measured: book.edition?.height != null,
      };
    })
    .sort(
      (a, b) =>
        authorSortKey(`by ${a.author}`).localeCompare(authorSortKey(`by ${b.author}`)) ||
        (a.year ?? 0) - (b.year ?? 0) ||
        a.title.localeCompare(b.title),
    );

  const shelves: Shelf[] = [];
  for (const category of categories) {
    // Each kind starts on a shelf of its own.
    let shelf: Shelf | null = null;
    let used = 0;
    for (const copy of copies.filter((c) => c.category === category)) {
      if (!shelf || used + copy.thickness > shelfWidth) {
        shelf = { category, range: null, copies: [] };
        shelves.push(shelf);
        used = 0;
      }
      shelf.copies.push(copy);
      used += copy.thickness;
    }
  }
  for (const shelf of shelves) {
    const first = callLetters(shelf.copies[0]);
    const last = callLetters(shelf.copies[shelf.copies.length - 1]);
    shelf.range = first === last ? first : `${first}–${last}`;
  }

  const units: Shelf[][] = [];
  for (let i = 0; i < Math.max(shelves.length, 1); i += billy.spaces) {
    const unit = shelves.slice(i, i + billy.spaces);
    while (unit.length < billy.spaces) unit.push({ category: null, range: null, copies: [] });
    units.push(unit);
  }

  return {
    units,
    copies,
    length: copies.reduce((sum, copy) => sum + copy.thickness, 0),
  };
}
