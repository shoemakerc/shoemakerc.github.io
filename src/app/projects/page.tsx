import type { Metadata } from "next";
import { Staff } from "@/components/ui";

export const metadata: Metadata = {
  title: "Projects",
  description: "Things I've built, mostly involving sound.",
};

type Project = {
  name: string;
  year: string;
  tags: string[];
  summary: string;
  /** Omit for private repos. */
  href?: string;
  status?: string;
};

const projects: Project[] = [
  {
    name: "Bong Quest",
    year: "2026",
    status: "In progress",
    tags: ["TypeScript", "Phaser", "Vite"],
    href: "/bong-quest/",
    summary:
      "A keyboard-only 2D platformer about a guy who collects bongs, each of which grants a new power: double jump, dash, wall jump, and glide. Nine levels so far, playable in the browser; the art is still placeholder rectangles.",
  },
  {
    name: "Coffee Calculator",
    year: "2026",
    tags: ["Next.js", "TypeScript"],
    href: "/coffee-calculator/",
    summary:
      "Brew ratios, pour schedules, and a timer for pour-over, French press, AeroPress, espresso, and cold brew. Change the coffee, the water, or the number of cups and the rest follow. Saved recipes stay in your browser.",
  },
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

function ProjectRow({
  project,
  children,
}: {
  project: Project;
  children: React.ReactNode;
}) {
  return project.href ? (
    <a href={project.href} className="post-row">
      {children}
    </a>
  ) : (
    <div className="post-row">{children}</div>
  );
}

export default function Projects() {
  return (
    <>
      <section className="page-intro">
        <p className="meta">Projects</p>
        <h1 className="page-title">Things I’ve built</h1>
        <p className="lede">
          Mostly experiments where code meets sound, plus a platformer in the
          works and one for the morning cup.
        </p>
      </section>
      <Staff />
      <ol className="post-list">
        {projects.map((project, i) => (
          <li key={project.name}>
            <ProjectRow project={project}>
              <span className="meta">{`No. ${String(i + 1).padStart(2, "0")}`}</span>
              <span className="post-row-main">
                <span className="post-row-title">{project.name}</span>
                <span className="post-row-excerpt">{project.summary}</span>
                <span className="meta">{project.tags.join(" · ")}</span>
              </span>
              <span className="meta">
                {project.status ? (
                  <span className="project-status">{project.status}</span>
                ) : (
                  project.year
                )}
              </span>
            </ProjectRow>
          </li>
        ))}
      </ol>
    </>
  );
}
