// Imports Chris's StoryGraph ratings into content/storygraph.json.
//
// The StoryGraph rates in quarter stars where Goodreads only does whole ones,
// so the Reading page takes its ratings from here wherever both sites have the
// book (src/lib/reading.ts). The StoryGraph has no API and turns automated
// visits away, so this reads its library export instead. On The StoryGraph,
// export the library from Manage Account, then run
//
//   npm run import:storygraph -- ~/Downloads/<the export>.csv
//
// and commit content/storygraph.json. Only titles, authors and ratings make it
// into the snapshot; reviews and the rest of the export stay out.
//
// Goodreads stays in charge of which books there are and where they're
// shelved, so the script ends by listing what doesn't line up between the two
// sites, for fixing by hand on The StoryGraph.

import fs from "node:fs";
import path from "node:path";

const PROFILE = "https://app.thestorygraph.com/profile/shoeman27";
const OUT = path.join(process.cwd(), "content", "storygraph.json");
const GOODREADS = path.join(process.cwd(), "content", "goodreads.json");

// Node strips the types; reading.ts imports nothing but Node's own modules.
const { bookFinder } = await import(new URL("../src/lib/reading.ts", import.meta.url).href);

if (!process.argv[2]) {
  console.error("Usage: npm run import:storygraph -- path/to/export.csv");
  process.exit(1);
}
// npm runs scripts from the project root, so read the path from where it was typed.
const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]);

/** Rows of cells. Reviews can hold commas, quotes and line breaks, so mind the quoting. */
function parseCsv(text) {
  const rows = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (quoted || (c !== "," && c !== "\n" && c !== "\r")) {
      cell += c;
    } else if (c !== "\r") {
      rows.at(-1).push(cell);
      cell = "";
      if (c === "\n") rows.push([]);
    }
  }
  rows.at(-1).push(cell);
  return rows.filter((row) => row.some((value) => value.trim()));
}

/** "4.5" → 4.5. Anything that isn't a rating in quarter stars → null. */
function parseRating(text) {
  const rating = Number(text.match(/\d+(\.\d+)?/)?.[0]);
  return rating >= 0.25 && rating <= 5 && Number.isInteger(rating * 4) ? rating : null;
}

const [header = [], ...rows] = parseCsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const column = (name) => {
  const index = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  if (index === -1) {
    throw new Error(
      `No "${name}" column in ${file}. Is it The StoryGraph's library export? It has: ${header.join(", ")}`,
    );
  }
  return index;
};
const columns = {
  title: column("Title"),
  author: column("Authors"),
  status: column("Read Status"),
  rating: column("Star Rating"),
};
const cell = (row, index) => (row[index] ?? "").trim();

// The export's read statuses, as the Goodreads shelves they match. Goodreads
// keeps paused books on currently-reading, with a tag. A book can also be in
// the library with no status at all.
const shelves = {
  read: "read",
  "currently-reading": "currently-reading",
  paused: "currently-reading",
  "to-read": "to-read",
  "did-not-finish": "did-not-finish",
};
const library = rows
  .map((row) => {
    const status = cell(row, columns.status).toLowerCase().replace(/[\s_]+/g, "-");
    return {
      title: cell(row, columns.title),
      author: cell(row, columns.author),
      shelf: shelves[status] ?? (status || "no shelf"),
      rating: parseRating(cell(row, columns.rating)),
    };
  })
  .filter((book) => book.title);

const books = library
  .filter((book) => book.rating)
  .map(({ title, author, rating }) => ({ title, author, rating }))
  .sort((a, b) => a.title.localeCompare(b.title) || a.author.localeCompare(b.author));
console.log(`${library.length} books in the export, ${books.length} of them rated.`);
if (books.length === 0) {
  throw new Error(`No ratings in ${file}; refusing to overwrite the snapshot.`);
}

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
if (previous && JSON.stringify(previous.books) === JSON.stringify(books)) {
  console.log("No changes.");
} else {
  const snapshot = { profile: PROFILE, syncedAt: new Date().toISOString(), books };
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Wrote ${books.length} ratings to ${path.relative(process.cwd(), OUT)}.`);
}

// What doesn't line up. Goodreads is the one to believe, so most of these
// want fixing on The StoryGraph.
const goodreads = JSON.parse(fs.readFileSync(GOODREADS, "utf8")).books;
const onStoryGraph = bookFinder(library);
const onGoodreads = bookFinder(goodreads);
const name = (book) => `${book.title} by ${book.author}`;
const progress = { "to-read": 0, "did-not-finish": 1, "currently-reading": 2, read: 3 };
// Of a book's editions on one site, the one that's furthest along.
const furthest = (copies) => copies.reduce((a, b) => (progress[b.shelf] > progress[a.shelf] ? b : a));
const report = {
  "On Goodreads, not on The StoryGraph": [],
  "On The StoryGraph, not on Goodreads": [],
  "Shelved differently": [],
  "Rated on Goodreads only": [],
  "Rated a star or more apart": [],
};
for (const gr of goodreads) {
  const copies = onStoryGraph(gr.title, gr.author);
  if (copies.length === 0) {
    report["On Goodreads, not on The StoryGraph"].push(`${gr.shelf}: ${name(gr)}`);
    continue;
  }
  const [sg] = copies;
  if (gr.rating && !sg.rating) report["Rated on Goodreads only"].push(name(gr));
  else if (gr.rating && Math.abs(gr.rating - sg.rating) >= 1) {
    report["Rated a star or more apart"].push(
      `${name(gr)}: ${gr.rating} on Goodreads, ${sg.rating} on The StoryGraph`,
    );
  }
  const here = furthest([gr, ...onGoodreads(gr.title, gr.author)]);
  const there = furthest(copies);
  if (here.shelf !== there.shelf) {
    report["Shelved differently"].push(
      `${name(here)}: ${here.shelf} on Goodreads, ${there.shelf} on The StoryGraph`,
    );
  }
}
for (const sg of library) {
  if (onGoodreads(sg.title, sg.author).length === 0) {
    report["On The StoryGraph, not on Goodreads"].push(`${sg.shelf}: ${name(sg)}`);
  }
}

const sections = Object.entries(report).filter(([, lines]) => lines.length > 0);
if (sections.length === 0) console.log("Everything lines up with Goodreads.");
for (const [heading, lines] of sections) {
  // Sorted, so each shelf's books sit together. Goodreads can have two
  // editions of a book, which would otherwise show up twice.
  const unique = [...new Set(lines)].sort();
  console.log(`\n${heading} (${unique.length}):`);
  for (const line of unique) console.log(`  ${line}`);
}
