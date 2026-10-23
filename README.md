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

## Listening

The Listening section on the home page pulls from [Last.fm](https://www.last.fm/user/shoeman27):

- `content/lastfm.json`, a snapshot of this month's plays and of this week in each earlier year, refreshed daily by `.github/workflows/sync-lastfm.yml` (which redeploys when anything changed). Run `LASTFM_API_KEY=… npm run sync:lastfm` to refresh it locally.
- The "Last heard" line, which asks Last.fm what's playing each minute while the page is open.

Both need a `LASTFM_API_KEY` repository secret (create a key at [last.fm/api](https://www.last.fm/api/account/create)). Without it the sync skips itself, and the section shows just the playlist and links.

## Change the playlist

Edit `playlist` in `src/lib/site.ts`.

The 2017 version of the site is preserved at the `legacy-2017` tag.
