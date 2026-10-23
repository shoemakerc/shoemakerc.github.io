import Link from "next/link";

// The 2017 site linked to this post at /music/2017-03-16/. Keep that URL alive.
export default function LegacyIntroRedirect() {
  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/music/introduction/" />
      <link rel="canonical" href="/music/introduction/" />
      <p>
        This post has moved to <Link href="/music/introduction/">/music/introduction/</Link>.
      </p>
    </>
  );
}
