// Pulls Chris's Goodreads shelves into content/goodreads.json.
//
// Goodreads closed its API in 2020 and retired the shelf RSS feeds in October
// 2026, and its shelf pages now ask for a sign-in. What a public profile still
// serves is the embeddable "grid widget": up to 200 covers from one shelf, in
// whichever order you ask for, each linking to its review. This script pieces
// the shelves back together from that, on top of the last snapshot:
//
// - Which shelf and tags a book has come from which widgets it shows up in.
// - Author, pages and year aren't in the widget, so a book that's new to the
//   shelves gets them from its own Goodreads page. Known books keep theirs.
// - Ratings and dates read aren't in the widget either, but it will sort by
//   them. A newly finished book that sorts ahead of every dated one was
//   finished since the last sync, so it gets today's date, and a book that
//   sorts between two with the same rating has that rating too.
//
// - How far along a book is comes from the public list of status updates
//   ("is on page 17 of 256 of Meditations"), which names the book each is for.
//
// - A book shelved as "owned" also gets its edition looked up, once: the format,
//   publisher and whether Goodreads' readers file it under nonfiction, from its
//   Goodreads page, and its height and thickness from Open Library, where
//   that has them for the ISBN. The bookcase page draws the book from those.
//   An edition can also carry `classic`, set by hand, to shelve a book with
//   the classics or keep it out of them whatever its year says.
//
// What it can't see: a book with no cover on Goodreads (the widget leaves
// those out, so they stay as the snapshot has them), a changed rating on a
// book that already had one, and the real date for a book finished days ago.
// Dates, ratings and editions in the snapshot are only ever filled in, never
// replaced, so correcting one by hand in content/goodreads.json sticks.
//
// Runs daily from .github/workflows/sync-goodreads.yml; `npm run sync:goodreads`
// does the same locally.

import fs from "node:fs";
import path from "node:path";

const USER_ID = "166556608";
const SHELVES = ["currently-reading", "read", "to-read", "did-not-finish"];
const OUT = path.join(process.cwd(), "content", "goodreads.json");
const PROFILE = `https://www.goodreads.com/user/show/${USER_ID}`;
const WIDGET = `https://www.goodreads.com/review/grid_widget/${USER_ID}`;
/** The most books the widget returns, whatever num_books says. It has no pages. */
const WIDGET_MAX = 200;
/** Orders to ask for, first to last and last to first, to reach all of a shelf longer than that. */
const SORTS = ["date_added", "title", "author", "date_pub", "num_pages", "avg_rating"];

const STATUSES = `https://www.goodreads.com/user_status/list/${USER_ID}`;
const MAX_STATUS_PAGES = 30;

const started = Date.now();
const today = new Date(started).toISOString().slice(0, 10);

/** "Dune Messiah (Dune, #2)" → { title: "Dune Messiah", series: "Dune", seriesNumber: "2" } */
function splitSeries(full) {
  const m = full.match(/^(.*?)\s*\(([^()]+?),?\s*#([\d.]+)\)$/);
  return m
    ? { title: m[1], series: m[2], seriesNumber: m[3] }
    : { title: full, series: null, seriesNumber: null };
}

/**
 * Cover URLs to try, best first: a 300px-tall version (much lighter than the
 * full-size image), then the full-size one. The widget links to a thumbnail,
 * …/23995368._SY75_.jpg or …/50130878._SX50_SY75_.jpg, so its size comes off.
 */
function coverCandidates(url) {
  if (!url || url.includes("/nophoto/")) return [];
  const full = url.replace(/\._(?:[A-Z]{2}\d+_)+(?=\.\w+$)/, "");
  return [full.replace(/(\.\w+)$/, "._SY300_$1"), full];
}

/**
 * The text at a URL, or null for a 404 when `optional`. Goodreads answers the
 * odd request with a 503, or with nothing at all, so this tries a few times.
 */
async function get(url, { optional = false, agent = "shoemakerc.github.io reading sync" } = {}) {
  for (let attempt = 1; ; attempt++) {
    // A sync is a couple of dozen requests; no need to send them all at once.
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt ** 2));
    const res = await fetch(url, { headers: { "User-Agent": agent } }).catch(() => null);
    const text = res?.ok ? await res.text().catch(() => "") : "";
    if (text) return text;
    if (optional && res?.status === 404) return null;
    const passing = !res || res.ok || res.status === 429 || res.status >= 500;
    if (!passing || attempt === 4) {
      throw new Error(`${url} → ${!res ? "no response" : res.ok ? "an empty page" : `HTTP ${res.status}`}`);
    }
  }
}

/** How many books the profile page says each shelf and each tag holds. */
async function fetchCounts() {
  const html = await get(PROFILE);
  const counts = { shelf: new Map(), tag: new Map() };
  const link = new RegExp(`/review/list/${USER_ID}\\?(shelf|tag)=([^"]+)">[^<(]*\\(([\\d,]+)\\)`, "g");
  for (const [, kind, name, count] of html.matchAll(link)) {
    counts[kind].set(decodeURIComponent(name), Number(count.replace(/,/g, "")));
  }
  for (const shelf of SHELVES) {
    if (!counts.shelf.has(shelf)) throw new Error(`No "${shelf}" shelf on ${PROFILE}`);
  }
  return counts;
}

/** One widget's worth of a shelf (or tag), in the order asked for. */
async function fetchWidget(shelf, sort, order) {
  // Goodreads keeps each widget it has made for hours, by its exact address,
  // and would hand a daily sync the same stale shelf. The time makes it new.
  const url = `${WIDGET}?shelf=${encodeURIComponent(shelf)}&num_books=${WIDGET_MAX}&sort=${sort}&order=${order}&at=${started}`;
  const js = await get(url);
  if (!js.includes("widget_code")) throw new Error(`${url} did not return a widget`);
  // The widget arrives as HTML inside a JavaScript string.
  const html = js.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
  const book = /gr_grid_book_container"><a [^>]*\/review\/show\/(\d+)[^>]*><img [^>]*src="([^"]+)"/g;
  const entries = [];
  for (const [, reviewId, image] of html.matchAll(book)) {
    // Goodreads names a cover after its book: …/books/1644068428l/23995368._SY75_.jpg
    const id = image.match(/\/(\d+)\.[^/]*$/)?.[1];
    if (id) entries.push({ reviewId, id, image });
    else console.warn(`  Skipping review ${reviewId}: no book id in ${image}`);
  }
  return entries;
}

/**
 * Every book the widget will show from a shelf (or tag) that the profile says
 * holds `count` books. `coverless` are the known books there that the widget
 * may be leaving out. `orders` are the sorts to always fetch, newest first.
 */
async function fetchShelf(shelf, count, coverless, orders = ["date_added"]) {
  const seen = new Map();
  const seenIds = new Set();
  const lists = new Map();
  const hidden = () => coverless.filter((book) => !seenIds.has(book.id)).length;
  const add = async (sort, order) => {
    const key = `${sort}:${order}`;
    if (lists.has(key)) return;
    const list = await fetchWidget(shelf, sort, order);
    lists.set(key, list);
    for (const entry of list) {
      seen.set(entry.reviewId, entry);
      seenIds.add(entry.id);
    }
  };
  for (const sort of orders) await add(sort, "d");
  if (count > WIDGET_MAX) {
    for (const sort of [...orders, ...SORTS]) {
      for (const order of ["a", "d"]) {
        if (seen.size + hidden() < count) await add(sort, order);
      }
    }
  }
  if (count > 0 && seen.size === 0 && hidden() < count) {
    // An empty widget for a shelf with books on it means something broke.
    throw new Error(`The widget shows nothing on "${shelf}"; refusing to overwrite the snapshot.`);
  }
  // Whole when every book the profile counts is either here or known to be left out.
  const complete = seen.size + hidden() === count;
  console.log(`${shelf}: ${seen.size}${hidden() ? `, and ${hidden()} without a cover` : ""}`);
  if (!complete) {
    console.warn(`  Goodreads counts ${count ?? "?"}. Books the widget doesn't show stay as they were.`);
  }
  return { seen, lists, complete };
}

const bookPages = new Map();

/** The details the widget leaves out, from the book's own page. */
async function fetchBook(id) {
  if (bookPages.has(id)) return bookPages.get(id);
  const url = `https://www.goodreads.com/book/show/${id}`;
  const html = await get(url);
  const data = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  const state = data && JSON.parse(data[1]).props?.pageProps?.apolloState;
  const book =
    state && Object.values(state).find((v) => v.__typename === "Book" && String(v.legacyId) === id);
  if (!book?.title) throw new Error(`Couldn't read the book details on ${url}`);
  const author = state[book.primaryContributorEdge?.node?.__ref]?.name;
  // The work's date is the first publication; the book's is this edition's.
  const published = state[book.work?.__ref]?.details?.publicationTime ?? book.details?.publicationTime;
  // A year before 1 is BC: the Odyssey's is -800.
  const year = published == null ? null : new Date(published).getUTCFullYear();
  const pages = Number(book.details?.numPages);
  const genres = (book.bookGenres ?? []).map((g) => g.genre?.name);
  const details = {
    ...splitSeries((book.titleComplete ?? book.title).trim()),
    author: (author ?? "").trim(),
    pages: pages > 0 ? pages : null,
    year,
    edition: {
      format: book.details?.format ?? null,
      publisher: book.details?.publisher?.trim() || null,
      isbn: book.details?.isbn13 ?? book.details?.isbn ?? null,
      // The genres are what readers shelve the book under, most used first.
      nonfiction: genres.includes("Nonfiction"),
    },
  };
  bookPages.set(id, details);
  return details;
}

/**
 * A book's height and thickness in centimetres, from Open Library's record of
 * the edition with this ISBN: "8.1 x 5.4 x 1.4 inches". Null where it has no
 * record or no size, which is most of the time.
 */
async function fetchSize(isbn) {
  const json = await get(`https://openlibrary.org/isbn/${isbn}.json`, { optional: true, agent: "reading-sync" });
  const text = json && JSON.parse(json).physical_dimensions;
  const numbers = (text?.match(/\d+(\.\d+)?/g) ?? []).map(Number).sort((a, b) => b - a);
  if (numbers.length < 2 || numbers.length > 3) return null;
  const perUnit = /cent|cm/i.test(text) ? 1 : /mm|milli/i.test(text) ? 0.1 : 2.54;
  const cm = (n) => Math.round(n * perUnit * 10) / 10;
  // Whichever way round they're given, a book is taller than it is wide, and
  // wider than it is thick.
  const height = cm(numbers[0]);
  const thick = numbers.length === 3 ? numbers[2] : null;
  // A thickness of exactly an inch or two has been rounded past any use.
  const thickness = thick && !(perUnit === 2.54 && Number.isInteger(thick)) ? cm(thick) : null;
  if (height < 10 || height > 40) return null;
  return { height, thickness: thickness >= 0.3 && thickness <= 12 ? thickness : null };
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The latest status update for each book it can find, by book id: the page
 * (or just the percentage, for an update made that way) and the day. Updates
 * come newest first, 30 to a page, and nothing older than `since` is new, so
 * a daily sync reads one page. The first one reads them all.
 */
async function fetchProgress(since) {
  const progress = new Map();
  for (let page = 1; page <= MAX_STATUS_PAGES; page++) {
    const html = await get(`${STATUSES}?page=${page}`);
    const update = /user_status_header">([\s\S]*?)<\/span>[\s\S]*?\/user_status\/show\/\d+">(\w{3}) (\d{1,2}), (\d{4})/g;
    let oldest = null;
    for (const [, header, month, day, year] of html.matchAll(update)) {
      const date = `${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
      oldest = date;
      const id = header.match(/\/book\/show\/(\d+)/)?.[1];
      const paged = header.match(/is on page ([\d,]+) of ([\d,]+) of/);
      const [at, pages] = paged ? paged.slice(1).map((n) => Number(n.replace(/,/g, ""))) : [null, null];
      const percent = paged ? (100 * at) / pages : Number(header.match(/is (\d+)% done with/)?.[1]);
      if (!id || progress.has(id) || !Number.isFinite(percent)) continue;
      progress.set(id, { page: at, pages, percent: Math.round(Math.min(percent, 100)), date });
    }
    if (!oldest || (since && oldest < since)) break;
  }
  return progress;
}

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const previousBooks = previous?.books ?? [];
const byReview = new Map(previousBooks.filter((b) => b.reviewId).map((b) => [b.reviewId, b]));
const byId = new Map(previousBooks.map((b) => [b.id, b]));
// A review keeps its id when the book is switched to another edition; the
// book's own id is the fallback for snapshots from before reviews were recorded.
const previousOf = (entry) => byReview.get(entry.reviewId) ?? byId.get(entry.id);
const coverless = (test) => previousBooks.filter((b) => test(b) && !/^https?:/.test(b.cover ?? ""));

const counts = await fetchCounts();

const shelves = new Map();
for (const shelf of SHELVES) {
  const orders = shelf === "read" ? ["date_read", "rating"] : ["date_added"];
  const known = coverless((b) => b.shelf === shelf);
  shelves.set(shelf, await fetchShelf(shelf, counts.shelf.get(shelf), known, orders));
}
if (shelves.get("read").seen.size === 0) {
  // A public profile always has read books; an empty result means something broke.
  throw new Error("No read books came back; refusing to overwrite the snapshot.");
}

const tagNames = [...new Set([...counts.tag.keys(), ...previousBooks.flatMap((b) => b.tags)])];
const tags = new Map();
for (const tag of tagNames) {
  const known = coverless((b) => b.tags.includes(tag));
  tags.set(tag, await fetchShelf(tag, counts.tag.get(tag), known));
}

const byNewId = new Map();
const matched = new Set();
// Books now in another edition, and the edition each was in before.
const switched = new Map();
for (const shelf of SHELVES) {
  for (const entry of shelves.get(shelf).seen.values()) {
    if (byNewId.has(entry.id)) continue;
    const prev = previousOf(entry);
    if (prev) matched.add(prev.id);
    // A book that's new here, or now in another edition, needs looking up.
    const same = prev?.id === entry.id;
    const details = same ? prev : await fetchBook(entry.id);
    if (prev?.edition && !same) switched.set(entry.id, prev.edition);
    // A tag whose widget came back short can add to a book's tags but not take away.
    const tagged = tagNames.filter(
      (tag) =>
        tags.get(tag).seen.has(entry.reviewId) || (!tags.get(tag).complete && prev?.tags.includes(tag)),
    );
    const sameTags = prev?.tags.length === tagged.length && tagged.every((tag) => prev.tags.includes(tag));
    byNewId.set(entry.id, {
      id: entry.id,
      reviewId: entry.reviewId,
      title: details.title,
      series: details.series,
      seriesNumber: details.seriesNumber,
      author: details.author,
      shelf,
      tags: sameTags ? prev.tags : tagged,
      rating: prev?.rating ?? null,
      dateRead: prev?.dateRead ?? null,
      dateAdded: prev?.dateAdded ?? today,
      pages: details.pages,
      year: details.year,
      cover: coverCandidates(entry.image),
      url: `https://www.goodreads.com/book/show/${entry.id}`,
      ...(prev?.progress && { progress: prev.progress }),
      ...(same && prev.edition && { edition: prev.edition }),
    });
    if (!prev) console.log(`  New on ${shelf}: ${details.title}`);
    else if (prev.shelf !== shelf) console.log(`  ${prev.shelf} → ${shelf}: ${details.title}`);
  }
}

// Known books that no widget showed: left out for having no cover, or off the shelves.
for (const book of previousBooks) {
  if (matched.has(book.id)) continue;
  if (/^https?:/.test(book.cover ?? "") && shelves.get(book.shelf).complete) {
    console.log(`  No longer on ${book.shelf}: ${book.title}`);
  } else {
    byNewId.set(book.id, book);
  }
}

/** The nearest values before and after `index`, skipping books that don't have one. */
function neighbors(list, index, valueOf) {
  const nearest = (step) => {
    for (let i = index + step; i >= 0 && i < list.length; i += step) {
      const value = valueOf(list[i]);
      if (value != null) return value;
    }
    return null;
  };
  return [nearest(-1), nearest(1)];
}

// Fill in what the read shelf's sort orders give away, going by the books
// that were already on it, whose dates and ratings are known.
const read = shelves.get("read");
const knownRead = (entry, key) => {
  const prev = previousOf(entry);
  return prev?.shelf === "read" ? prev[key] : null;
};
for (const entry of read.seen.values()) {
  const book = byNewId.get(entry.id);
  const place = (list) => list?.findIndex((e) => e.reviewId === entry.reviewId) ?? -1;

  if (!book.dateRead && previousOf(entry)?.shelf !== "read") {
    const newestFirst = read.lists.get("date_read:d");
    const at = place(newestFirst);
    const [newer, older] = at < 0 ? [] : neighbors(newestFirst, at, (e) => knownRead(e, "dateRead"));
    // Newer than every dated book: finished since the last sync. Between two
    // from the same year: the earlier of them is close enough for a page that
    // groups by year. With no dated book after it, it has no date on Goodreads.
    if (older && !newer) book.dateRead = today;
    else if (older && newer.slice(0, 4) === older.slice(0, 4)) book.dateRead = older;
    if (book.dateRead) console.log(`  Finished ${book.dateRead}: ${book.title}`);
  }

  if (book.rating == null) {
    for (const key of ["rating:d", "rating:a"]) {
      const list = read.lists.get(key);
      const at = place(list);
      const [before, after] = at < 0 ? [] : neighbors(list, at, (e) => knownRead(e, "rating"));
      if (before != null && before === after) book.rating = before;
    }
    if (book.rating) console.log(`  Rated ${book.rating}: ${book.title}`);
  }
}

const books = [...byNewId.values()].sort((a, b) => Number(a.id) - Number(b.id));

// How far along the unfinished books are. A finished one has no use for it.
const lastUpdate = previousBooks.reduce((latest, b) => (b.progress?.date > latest ? b.progress.date : latest), "");
const progress = await fetchProgress(lastUpdate);
for (const book of books) {
  if (progress.has(book.id)) book.progress = progress.get(book.id);
  if (book.shelf === "read") delete book.progress;
}
console.log(`progress: ${books.filter((b) => b.progress).length} books`);

// The edition of each book that's owned, for the bookcase page. One that
// can't be looked up today is left for the next sync to try.
for (const book of books) {
  if (!book.tags.includes("owned")) {
    delete book.edition;
    continue;
  }
  if (book.edition) continue;
  try {
    const { edition } = await fetchBook(book.id);
    const size = edition.isbn ? await fetchSize(edition.isbn) : null;
    // Another edition of a book is still the same kind of book, so how the
    // last one was filed carries over, corrections by hand included.
    const was = switched.get(book.id);
    book.edition = {
      ...edition,
      ...(was && { nonfiction: was.nonfiction }),
      height: size?.height ?? null,
      thickness: size?.thickness ?? null,
      ...(was?.classic != null && { classic: was.classic }),
    };
    console.log(`  Edition: ${book.title} (${edition.format ?? "format unknown"}${size ? `, ${size.height} cm` : ""})`);
  } catch (error) {
    console.warn(`  No edition yet for ${book.title}: ${error.message}`);
  }
}
console.log(`editions: ${books.filter((b) => b.edition).length} owned books`);

// Some resized covers 403, so check each one that's new since the last sync.
// A cover saved as public/covers/<Goodreads id>.jpg replaces Goodreads' own,
// for books whose Goodreads cover is missing or broken.
for (const book of books) {
  const local = `/covers/${book.id}.jpg`;
  if (fs.existsSync(path.join(process.cwd(), "public", local))) {
    book.cover = local;
    continue;
  }
  // A book the widgets didn't show keeps the cover it had.
  if (!Array.isArray(book.cover)) continue;
  const candidates = book.cover;
  const known = byId.get(book.id)?.cover;
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
    profile: PROFILE,
    syncedAt: new Date().toISOString(),
    books,
  };
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Wrote ${books.length} books to ${path.relative(process.cwd(), OUT)}.`);
}
