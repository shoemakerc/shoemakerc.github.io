import Link from "next/link";
import { site } from "@/lib/site";
import { formatDate, formatNumber, type Post } from "@/lib/posts";

/** Renders a title, turning *these* into italics (for book and album names). */
export function Title({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*]+\*)/).map((part, i) =>
        part.startsWith("*") && part.endsWith("*") ? (
          <em key={i}>{part.slice(1, -1)}</em>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Five hairlines, like an empty musical staff. Used as a section break. */
export function Staff({ label }: { label?: string }) {
  return (
    <div className="staff" role="separator">
      <div className="staff-lines" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {label && <span className="staff-label">{label}</span>}
    </div>
  );
}

export function Header() {
  return (
    <header className="site-header">
      <Link href="/" className="wordmark">
        {site.name}
      </Link>
      <nav aria-label="Main">
        <Link href="/music/">Writing</Link>
        <Link href="/#listening">Listening</Link>
        <Link href="/reading/">Reading</Link>
        <Link href="/projects/">Projects</Link>
        <Link href="/about/">About</Link>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <span>© {new Date().getFullYear()} {site.name}</span>
      <span className="footer-links">
        {site.links.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </span>
    </footer>
  );
}

export function PostList({ posts }: { posts: Post[] }) {
  return (
    <ol className="post-list">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link href={`/music/${post.slug}/`} className="post-row">
            <span className="meta">{formatNumber(post.number)}</span>
            <span className="post-row-main">
              <span className="post-row-title">
                <Title text={post.title} />
              </span>
              {post.excerpt && (
                <span className="post-row-excerpt">{post.excerpt}</span>
              )}
            </span>
            <time className="meta" dateTime={post.date}>
              {formatDate(post.date)}
            </time>
          </Link>
        </li>
      ))}
    </ol>
  );
}
