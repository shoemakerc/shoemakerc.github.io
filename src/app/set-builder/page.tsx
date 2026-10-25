import type { Metadata } from "next";
import Link from "next/link";
import { SetBuilder } from "@/components/set-builder";
import { Staff } from "@/components/ui";

export const metadata: Metadata = {
  title: "Set Builder",
  description:
    "Drop in the tracks you want to play and it finds an order that mixes: neighboring keys on the Camelot wheel, tempos close enough to beatmatch, and the energy arc you pick.",
};

export default function SetBuilderPage() {
  return (
    <>
      <section className="page-intro">
        <p className="meta">
          <Link href="/projects/">Projects</Link> · 2026
        </p>
        <h1 className="page-title">Set Builder</h1>
        <p className="lede">
          Drop in the tracks you want to play and it works out an order that mixes: keys that sit together on
          the Camelot wheel, tempos close enough to beatmatch, and an energy arc of your choosing.
        </p>
      </section>
      <Staff />
      <noscript>
        <p className="judge-note">The set builder needs JavaScript.</p>
      </noscript>
      <SetBuilder />

      <section className="judge-about">
        <Staff label="How it works" />
        <div className="prose">
          <p>
            I’m learning to DJ, and the part that takes me longest isn’t the mixing. It’s deciding what comes
            next. This does the first draft. Every pair of tracks gets a score for how well the second one
            follows the first, and then it searches for the running order with the best total.
          </p>
          <p>
            Keys are scored on the Camelot wheel, which is the circle of fifths with numbers. Staying put or
            moving one step around it is the easiest move, and so is crossing between a minor key and its
            relative major. An energy boost two steps up, or a lift of a semitone, costs a bit more. Anything
            else is a clash. For tempo, the incoming track has to be pitched to match. Under 2% nobody hears
            it, and past 8% it starts to sound wrong. Mixing at half or double time works, but costs a little
            extra.
          </p>
          <p>
            Tracks you search for get the <Link href="/dance-judge/">Dance Judge</Link> treatment: your
            browser listens to the 30-second preview for tempo, key and energy. Those numbers are guesses
            (faded until you correct them), and the key is wrong about one time in four, so trust your library
            over it. Imported playlists keep your library’s BPM and key. The page only looks up previews for
            their energy, one every few seconds so Apple doesn’t mind.
          </p>
        </div>
        <p className="meta judge-credits">
          Songs and previews from the{" "}
          <a href="https://performance-partners.apple.com/search-api">iTunes Search API</a> · Your crate stays
          in this browser
        </p>
      </section>
    </>
  );
}
