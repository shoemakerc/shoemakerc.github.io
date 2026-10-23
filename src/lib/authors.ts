import { editionKey, getLibrary, type Book } from "@/lib/reading";

// Every book Thomas Pynchon and David Foster Wallace published, for the
// shelves on the Reading page. Each one is matched to the Goodreads shelves
// by author and title, so finishing a book there fills in its spine here.
// Left out: collections of pieces already in other books (String Theory, the
// Reader) and McCain's Promise, an essay from Consider the Lobster.

type Work = {
  title: string;
  year: number;
  /** Roughly, for the spine's width when Goodreads doesn't have the book. */
  pages: number;
  /** A shorter title to print on the spine. */
  spine?: string;
};

export type Volume = Work & {
  status: "read" | "reading" | "owned" | "unowned";
  /** The book on Goodreads, if it's on a shelf there. */
  book: Book | null;
};

export type Author = { name: string; works: Volume[] };

const bibliographies: { name: string; works: Work[] }[] = [
  {
    name: "Thomas Pynchon",
    works: [
      { title: "V.", year: 1963, pages: 492 },
      { title: "The Crying of Lot 49", year: 1966, pages: 183 },
      { title: "Gravity’s Rainbow", year: 1973, pages: 760 },
      { title: "Slow Learner", year: 1984, pages: 193 },
      { title: "Vineland", year: 1990, pages: 385 },
      { title: "Mason & Dixon", year: 1997, pages: 773 },
      { title: "Against the Day", year: 2006, pages: 1085 },
      { title: "Inherent Vice", year: 2009, pages: 369 },
      { title: "Bleeding Edge", year: 2013, pages: 477 },
      { title: "Shadow Ticket", year: 2025, pages: 293 },
    ],
  },
  {
    name: "David Foster Wallace",
    works: [
      { title: "The Broom of the System", year: 1987, pages: 467 },
      { title: "Girl with Curious Hair", year: 1989, pages: 373 },
      { title: "Signifying Rappers", year: 1990, pages: 140 },
      { title: "Infinite Jest", year: 1996, pages: 1079 },
      {
        title: "A Supposedly Fun Thing I’ll Never Do Again",
        year: 1997,
        pages: 353,
        spine: "A Supposedly Fun Thing",
      },
      {
        title: "Brief Interviews with Hideous Men",
        year: 1999,
        pages: 273,
        spine: "Brief Interviews",
      },
      { title: "Everything and More", year: 2003, pages: 319 },
      { title: "Oblivion", year: 2004, pages: 329 },
      { title: "Consider the Lobster", year: 2005, pages: 343 },
      { title: "This Is Water", year: 2009, pages: 137 },
      { title: "Fate, Time, and Language", year: 2010, pages: 264 },
      { title: "The Pale King", year: 2011, pages: 548 },
      { title: "Both Flesh and Not", year: 2012, pages: 336 },
    ],
  },
];

function statusOf(book: Book | null): Volume["status"] {
  if (book?.status === "read") return "read";
  if (book?.status === "reading" || book?.status === "paused") return "reading";
  return book?.owned ? "owned" : "unowned";
}

export function getAuthors(): Author[] {
  const { books } = getLibrary();
  return bibliographies.map(({ name, works }) => {
    const theirs = books.filter((b) => b.byline === `by ${name}`);
    return {
      name,
      works: works.map((work) => {
        const book = theirs.find((b) => editionKey(b.title) === editionKey(work.title)) ?? null;
        return { ...work, status: statusOf(book), book };
      }),
    };
  });
}
