import type { Metadata } from "next";
import { PostList, Staff } from "@/components/ui";
import { getPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "On Music",
  description: "Writing about music as a listener, performer, and maker.",
};

export default function MusicIndex() {
  return (
    <>
      <section className="page-intro">
        <p className="meta">Writing</p>
        <h1 className="page-title">On Music</h1>
        <p className="lede">
          Essays and notes from three angles: as a listener, as a performer,
          and as someone who makes things with sound.
        </p>
      </section>
      <Staff />
      <PostList posts={getPosts()} />
    </>
  );
}
