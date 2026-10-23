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

## Change the playlist

Edit `playlist` in `src/lib/site.ts`.

The 2017 version of the site is preserved at the `legacy-2017` tag.
