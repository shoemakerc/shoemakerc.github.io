import type { Metadata } from "next";
import Link from "next/link";
import { DanceJudge } from "@/components/dance-judge";
import { Staff } from "@/components/ui";

export const metadata: Metadata = {
  title: "Dance Judge",
  description:
    "How cool (or not cool) would you look busting moves to a certain song? Pick one, or bring a file, and the judge listens, then rules.",
};

export default function DanceJudgePage() {
  return (
    <>
      <section className="page-intro">
        <p className="meta">
          <Link href="/projects/">Projects</Link> · Since 2017
        </p>
        <h1 className="page-title">Dance Judge</h1>
        <p className="lede">
          How cool (or not cool) would you look busting moves to a certain
          song? Pick one, and let the Dance Judge be the… judge.
        </p>
      </section>
      <Staff />
      <noscript>
        <p className="judge-note">The judge needs JavaScript to listen.</p>
      </noscript>
      <DanceJudge />

      <section className="judge-about">
        <Staff label="How it works" />
        <div className="prose">
          <p>
            I first built the Dance Judge in 2017 as a small Node app that
            logged you in to Spotify and asked its Web API how danceable a song
            was. Spotify has since closed those audio-feature endpoints to
            hobby apps like this one, so this version does the listening
            itself.
          </p>
          <p>
            When you pick a song, your browser downloads Apple’s 30-second
            preview and decodes it. The judge measures how much new sound
            arrives in each 12-millisecond slice, then looks for the delay at
            which that pattern best repeats: that’s the beat, and how cleanly
            it repeats is how strong the beat is. It also tallies the notes it
            hears against the 24 major and minor key profiles, and checks how
            loud, bright, and percussive the clip is.
          </p>
          <p>
            A model fit to Spotify’s archived scores for 295 songs turns those
            measurements into Spotify’s old 0-to-1 scales. On songs it wasn’t
            fit to, the judge reaches the same verdict Spotify’s number would
            about three times in five, and comes within one verdict nearly
            every time. From a search it only hears thirty seconds, though,
            and it has opinions of its own. The verdicts are the same ones
            from 2017.
          </p>
          <p>
            If you have the song as a file, choose it or drop it on the page
            and the judge hears all of it instead, in overlapping half-minute
            stretches, then charts where the song takes off and where it sags.
            The verdict is the average of those stretches. The file is read in
            your browser and never leaves your computer.
          </p>
        </div>
        <p className="meta judge-credits">
          Songs and previews from the{" "}
          <a href="https://performance-partners.apple.com/search-api">iTunes Search API</a> ·{" "}
          <a href="https://github.com/shoemakerc/spotify-dance-judge">The 2017 version</a>
        </p>
      </section>
    </>
  );
}
