# shoemakerc.github.io

Personal site of Chris Shoemaker: writing on music, a listening shelf, and the odd bit of code.

Built with Next.js as a static export and deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `master`.

## Develop

```bash
npm install
npm run dev
```

## Write a post

Add a Markdown file to `content/music/`. The filename becomes the URL (`content/music/my-post.md` → `/music/my-post/`).

```md
---
title: "*Album Title* and why it matters"   # *asterisks* render as italics
date: "2026-10-22"
excerpt: "One-sentence summary shown in lists and under the title."
cover: "/music/my-cover.jpg"                # optional, file goes in public/music/
coverAlt: "Description of the cover"
---
```

## Reading

`/reading/` is built from three files:

- `content/goodreads.json`, a snapshot of the [Goodreads shelves](https://www.goodreads.com/user/show/166556608), refreshed daily by `.github/workflows/sync-goodreads.yml` (which redeploys when anything changed). Run `npm run sync:goodreads` to refresh it locally. Goodreads retired its shelf RSS feeds in October 2026, so the sync reads the public shelf widget instead, which has no dates or ratings: a newly finished book is dated the day the sync first sees it on the read shelf, and its rating is worked out from where it sorts among the rated books. Both can be corrected by hand in the snapshot, and the sync leaves a date or rating alone once it's there. A book with no cover on Goodreads doesn't show in the widget, so it stays as the snapshot has it. One added since the feeds went never reaches the snapshot at all; the sync only keeps count of those, as `uncovered`, so that it can still tell when a long shelf has come back whole. How far along each unfinished book is comes from the public list of Goodreads status updates, and is what fills in the piles under “On the nightstand”: one for the books on the go, one for those shelved as `paused`, each book as thick as it is long and inked in up to the bookmark.

`/reading/bookcases/` shelves the books owned in print: everything on the Goodreads `owned` shelf except what's being read (a book tagged `paused` is on its shelf here and in the nightstand's set-aside pile both), so adding a book to that shelf or taking one off moves it here at the next sync. For each owned book the sync also records its edition, once: the format, publisher and whether Goodreads' readers file it under nonfiction, from its Goodreads page, and its height and thickness from [Open Library](https://openlibrary.org/) where that has them for the ISBN. `src/lib/bookcase.ts` shelves them to scale on IKEA's narrow BILLY (40 × 202 cm, six spaces), fiction, then nonfiction, then classics (anything first published before 500 AD, on a shelf of their own), each by author and then by year; a book Open Library has no size for gets its thickness from its page count and its height from its format. To correct a book, edit its `edition` in the snapshot (`nonfiction`, `format`, or `height` and `thickness` in centimetres); the sync leaves an edition alone once it's there. A book's `year` is when it first came out, negative for BC; where Goodreads has only a modern edition's date for an ancient book, set the year by hand to shelve it with the classics. To shelve a later book with the classics anyway, as The Tale of Genji is, add `"classic": true` to its `edition`; `false` keeps an old one out.
- `content/reading.md`, the old list from [shoemakerc/books](https://github.com/shoemakerc/books). Books on both lists use the Goodreads details; books only on the old list still show up, without a cover or Goodreads rating.
- `content/storygraph.json`, the ratings from [The StoryGraph](https://app.thestorygraph.com/profile/shoeman27). The StoryGraph rates in quarter stars, so its ratings replace the whole-star Goodreads ones wherever both sites have the book; Goodreads still decides which books are on the page and how far along each one is.

The StoryGraph has no API and turns automated visits away, so its ratings come in by hand. After rating something there, export the library from the Manage Account page and run

```bash
npm run import:storygraph -- ~/Downloads/<the export>.csv
```

then commit `content/storygraph.json`. Only titles, authors and ratings go into it, not reviews. The import also lists the books that don't line up between the two sites, shelf by shelf, for bringing The StoryGraph in line with Goodreads.

The Pynchon & Wallace shelves list every book each of them published (`src/lib/authors.ts`) and color in each spine from the same Goodreads snapshot: read, currently reading, shelved as `owned`, or neither.

## Pastimes

`/pastimes/` has three sections:

- Minnesota sports, from `content/sports.json`: the Twins, Wild, Timberwolves and Vikings, pulled from ESPN daily by `.github/workflows/sync-sports.yml` (which redeploys when anything changed). Run `npm run sync:sports` to refresh it locally. The teams are ordered by `byAttention` in `src/lib/sports.ts`, which starts from baseball, hockey, basketball, football and adjusts for who's in season and who's winning.
- Restaurants, from `content/restaurants.md`, a table of the top of the Beli list. Beli has no API or export, so it's kept by hand; the section is hidden while the table is empty.
- The woodshed (bass and DJing), written straight into `src/app/pastimes/page.tsx`.

## Listening

The Listening section on the home page pulls from [Last.fm](https://www.last.fm/user/shoeman27):

- `content/lastfm.json`, a snapshot of this month's plays and of this week in each earlier year, refreshed daily by `.github/workflows/sync-lastfm.yml` (which redeploys when anything changed). Run `LASTFM_API_KEY=… npm run sync:lastfm` to refresh it locally.
- The "Last heard" line, which asks Last.fm what's playing each minute while the page is open.

Both need a `LASTFM_API_KEY` repository secret (create a key at [last.fm/api](https://www.last.fm/api/account/create)). Without it the sync skips itself, and the section shows just the playlist and links.

## Dance Judge

`/dance-judge/` is the 2017 [spotify-dance-judge](https://github.com/shoemakerc/spotify-dance-judge), rebuilt to run in the browser. Spotify no longer gives hobby apps audio features, so the page finds songs and 30-second previews with the [iTunes Search API](https://performance-partners.apple.com/search-api) and analyzes the audio itself (`src/lib/dance-judge/analyze.ts`): tempo, beat strength, key, loudness, and timbre.

`src/lib/dance-judge/judge.ts` turns those measurements into Spotify-style danceability and energy scores, using weights fit against Spotify's archived scores for a few hundred songs. To refit them, edit `scripts/dance-judge-songs.txt` if you like, then run (macOS only, since it decodes audio with `afconvert`; about 30 minutes the first time, seconds after that):

```bash
npm run calibrate:dance-judge
```

It prints new weights to paste into `judge.ts`.

A visitor can also choose or drop a music file of their own, which is read in the browser and never uploaded. `tags.ts` pulls the title, artist and cover art from the file, and `track.ts` analyzes the whole song in overlapping 30-second sections, each scored the way a preview is; the verdict averages the sections, and the page charts them over time. All analysis runs in a Web Worker (`worker.ts`).

## Change the playlist

Edit `playlist` in `src/lib/site.ts`.

The 2017 version of the site is preserved at the `legacy-2017` tag.
