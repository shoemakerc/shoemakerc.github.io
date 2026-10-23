import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkSmartypants from "remark-smartypants";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const MUSIC_DIR = path.join(process.cwd(), "content", "music");

export type Post = {
  slug: string;
  /** Title as written, may contain *emphasis*. */
  title: string;
  date: string;
  excerpt: string;
  cover?: string;
  coverAlt?: string;
  /** Position in publication order, starting at 1. */
  number: number;
};

function readAll(): (Post & { body: string })[] {
  return fs
    .readdirSync(MUSIC_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const { data, content } = matter(
        fs.readFileSync(path.join(MUSIC_DIR, file), "utf8"),
      );
      return {
        slug: file.replace(/\.md$/, ""),
        title: data.title,
        date: data.date,
        excerpt: data.excerpt ?? "",
        cover: data.cover,
        coverAlt: data.coverAlt,
        body: content,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((post, i) => ({ ...post, number: i + 1 }));
}

/** Newest first. */
export function getPosts(): Post[] {
  return readAll().map(withoutBody).reverse();
}

function withoutBody({ body, ...post }: Post & { body: string }): Post {
  void body;
  return post;
}

export async function getPost(slug: string) {
  const all = readAll();
  const index = all.findIndex((post) => post.slug === slug);
  if (index === -1) return null;

  const { body, ...post } = all[index];
  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkSmartypants)
      .use(remarkRehype)
      .use(rehypeStringify)
      .process(body),
  );

  return {
    post,
    html,
    previous: index > 0 ? withoutBody(all[index - 1]) : null,
    next: index < all.length - 1 ? withoutBody(all[index + 1]) : null,
  };
}

export function formatDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatNumber(n: number) {
  return `No. ${String(n).padStart(2, "0")}`;
}

/** Title with markdown emphasis removed, for <title> and alt text. */
export function plainTitle(title: string) {
  return title.replace(/\*/g, "");
}
