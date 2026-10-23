import Link from "next/link";
import { Listening, PostList, Staff } from "@/components/ui";
import { getPosts } from "@/lib/posts";

export default function Home() {
  const posts = getPosts();

  return (
    <>
      <section className="hero">
        <p className="meta">Cellist · Pianist · Programmer</p>
        <h1 className="hero-title">
          Notes on music, listening, and the <em>odd bit</em> of code.
        </h1>
        <p className="lede">
          I’m Chris. I’ve played cello since I was seven and piano since nine,
          studied computer science at Carleton, and still believe the best
          playlist is the one you’re about to hand to a friend.
        </p>
      </section>

      <section>
        <Staff label="Writing" />
        <div className="section-head">
          <h2 className="section-title">On Music</h2>
          <Link href="/music/" className="meta link-arrow">
            All writing →
          </Link>
        </div>
        <PostList posts={posts.slice(0, 5)} />
      </section>

      <Listening />
    </>
  );
}
