// Pulls Chris's Goodreads shelves into content/goodreads.json.
//
// Goodreads closed its API in 2020, but every public shelf still has an RSS
// feed. This script reads those feeds (100 books per page) and writes a
// snapshot the site builds from, so a Goodreads outage never breaks a deploy.
// Runs daily from .github/workflows/sync-goodreads.yml; `npm run sync:goodreads`
// does the same locally.

import fs from "node:fs";
import path from "node:path";

const USER_ID = "166556608";
const SHELVES = ["currently-reading", "read", "to-read", "did-not-finish"];
const OUT = path.join(process.cwd(), "content", "goodreads.json");
const MAX_PAGES = 30;

const entities = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, name) => entities[name] ?? m);

function field(item, tag) {
  const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (cdata ? cdata[1] : decode(raw)).trim();
}

/** "Dune Messiah (Dune, #2)" → { title: "Dune Messiah", series: "Dune", seriesNumber: "2" } */
function splitSeries(full) {
  const m = full.match(/^(.*?)\s*\(([^()]+?),?\s*#([\d.]+)\)$/);
  return m
    ? { title: m[1], series: m[2], seriesNumber: m[3] }
    : { title: full, series: null, seriesNumber: null };
}

const isoDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Cover URLs to try, best first: a 300px-tall version (much lighter than the
 * full-size image), then whatever the feed linked to.
 */
function coverCandidates(url) {
  if (!url || url.includes("/nophoto/")) return [];
  const resized = url
    .replace(/\._[A-Z]{2}\d+_(?=\.\w+$)/, "")
    .replace(/(\.\w+)$/, "._SY300_$1");
  return resized === url ? [url] : [resized, url];
}

function parseItem(item, shelf) {
  const id = field(item, "book_id");
  const rating = Number(field(item, "user_rating"));
  const pages = Number(item.match(/<num_pages>(\d+)<\/num_pages>/)?.[1]);
  const year = Number(field(item, "book_published"));
  return {
    id,
    ...splitSeries(field(item, "title")),
    author: field(item, "author_name"),
    shelf,
    tags: field(item, "user_shelves")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && t !== shelf),
    rating: rating > 0 ? rating : null,
    dateRead: isoDate(field(item, "user_read_at")),
    dateAdded: isoDate(field(item, "user_date_added")),
    pages: pages > 0 ? pages : null,
    year: year > 0 ? year : null,
    cover: coverCandidates(field(item, "book_large_image_url")),
    url: `https://www.goodreads.com/book/show/${id}`,
  };
}

async function fetchShelf(shelf) {
  const books = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://www.goodreads.com/review/list_rss/${USER_ID}?shelf=${shelf}&page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": "shoemakerc.github.io reading sync" } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    const xml = await res.text();
    if (!xml.includes("<rss")) throw new Error(`${url} did not return RSS`);
    const items = xml.split("<item>").slice(1);
    // Pages hold up to 100 books but are sometimes short, so stop only when empty.
    if (items.length === 0) break;
    books.push(...items.map((item) => parseItem(item, shelf)));
  }
  return books;
}

const byId = new Map();
for (const shelf of SHELVES) {
  const books = await fetchShelf(shelf);
  console.log(`${shelf}: ${books.length}`);
  for (const book of books) if (!byId.has(book.id)) byId.set(book.id, book);
}

const books = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
if (!books.some((b) => b.shelf === "read")) {
  // A public profile always has read books; an empty result means something broke.
  throw new Error("No read books came back; refusing to overwrite the snapshot.");
}

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const previousCovers = new Map(previous?.books.map((b) => [b.id, b.cover]));

// Some resized covers 403, so check each one that's new since the last sync.
for (const book of books) {
  const candidates = book.cover;
  const known = previousCovers.get(book.id);
  if (known && candidates.includes(known)) {
    book.cover = known;
    continue;
  }
  book.cover = null;
  for (const url of candidates) {
    const res = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (res?.ok) {
      book.cover = url;
      break;
    }
  }
}
if (previous && JSON.stringify(previous.books) === JSON.stringify(books)) {
  console.log("No changes.");
} else {
  const snapshot = {
    profile: `https://www.goodreads.com/user/show/${USER_ID}`,
    syncedAt: new Date().toISOString(),
    books,
  };
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Wrote ${books.length} books to ${path.relative(process.cwd(), OUT)}.`);
}
