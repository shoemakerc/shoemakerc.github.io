import type { Metadata } from "next";
import { Staff } from "@/components/ui";

export const metadata: Metadata = {
  title: "Projects",
  description: "Things I've built, mostly involving sound.",
};

const projects = [
  {
    name: "Qt-Looper",
    year: "2017",
    tags: ["C++", "Qt", "MIDI"],
    href: "https://github.com/shoemakerc/qt-looper",
    summary:
      "A virtual track looper for recording simple MIDI tracks and playing them back in loops. The engine is C++ built on a handful of MIDI libraries, with an interface made in Qt. Final project for CS 312: Audio Programming at Carleton.",
  },
  {
    name: "Spotify Dance Judge",
    year: "2017",
    tags: ["Node.js", "Spotify Web API"],
    href: "https://github.com/shoemakerc/spotify-dance-judge",
    summary:
      "How cool (or not cool) would you look dancing to a given song? Search a track and the Dance Judge pulls its danceability and a few other attributes from the Spotify Web API to deliver a verdict.",
  },
];

export default function Projects() {
  return (
    <>
      <section className="page-intro">
        <p className="meta">Projects</p>
        <h1 className="page-title">Things I’ve built</h1>
        <p className="lede">Mostly experiments where code meets sound.</p>
      </section>
      <Staff />
      <ol className="post-list">
        {projects.map((project, i) => (
          <li key={project.name}>
            <a href={project.href} className="post-row">
              <span className="meta">{`No. ${String(i + 1).padStart(2, "0")}`}</span>
              <span className="post-row-main">
                <span className="post-row-title">{project.name}</span>
                <span className="post-row-excerpt">{project.summary}</span>
                <span className="meta">{project.tags.join(" · ")}</span>
              </span>
              <span className="meta">{project.year}</span>
            </a>
          </li>
        ))}
      </ol>
    </>
  );
}
