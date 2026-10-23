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

`/reading/` is built from two files:

- `content/goodreads.json`, a snapshot of the [Goodreads shelves](https://www.goodreads.com/user/show/166556608), refreshed daily by `.github/workflows/sync-goodreads.yml` (which redeploys when anything changed). Run `npm run sync:goodreads` to refresh it locally.
- `content/reading.md`, the old list from [shoemakerc/books](https://github.com/shoemakerc/books). Books on both lists use the Goodreads details; books only on the old list still show up, without a cover or rating.

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

## Change the playlist

Edit `playlist` in `src/lib/site.ts`.

The 2017 version of the site is preserved at the `legacy-2017` tag.
