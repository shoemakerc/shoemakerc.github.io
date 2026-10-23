import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Staff, Title } from "@/components/ui";
import {
  formatDate,
  formatNumber,
  getPost,
  getPosts,
  plainTitle,
} from "@/lib/posts";

// Static export: every post is generated at build time, nothing else exists.
export const dynamicParams = false;

export function generateStaticParams() {
  return getPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/music/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPost(slug);
  if (!result) return {};
  return {
    title: plainTitle(result.post.title),
    description: result.post.excerpt,
  };
}

export default async function PostPage({ params }: PageProps<"/music/[slug]">) {
  const { slug } = await params;
  const result = await getPost(slug);
  if (!result) notFound();
  const { post, html, previous, next } = result;

  return (
    <article className="article">
      <header className="article-head">
        <p className="meta">
          <Link href="/music/">On Music</Link> · {formatNumber(post.number)}
        </p>
        <h1 className="article-title">
          <Title text={post.title} />
        </h1>
        {post.excerpt && <p className="article-dek">{post.excerpt}</p>}
        <time className="meta" dateTime={post.date}>
          {formatDate(post.date)}
        </time>
      </header>

      {post.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="article-cover" src={post.cover} alt={post.coverAlt ?? ""} />
      )}

      <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />

      <Staff />
      <nav className="article-nav" aria-label="More writing">
        {previous ? (
          <Link href={`/music/${previous.slug}/`}>
            <span className="meta">← Earlier</span>
            <Title text={previous.title} />
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/music/${next.slug}/`} className="article-nav-next">
            <span className="meta">Later →</span>
            <Title text={next.title} />
          </Link>
        )}
      </nav>
    </article>
  );
}
