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
      "Brew ratios, pour schedules, and a timer for pour-over, French press, AeroPress, espresso, moka pot, and cold brew. Change the coffee, the water, or the number of cups and the rest follow. Saved recipes stay in your browser.",
  },
  {
    name: "Dance Judge",
    year: "2026",
    tags: ["TypeScript", "Web Audio", "DSP"],
    href: "/dance-judge/",
    summary:
      "How cool (or not cool) would you look dancing to a given song? Pick a track and the judge listens to its 30-second preview, finds the beat and the key, and delivers a verdict. It started in 2017 as the Spotify Dance Judge; when Spotify shut off the data it relied on, it learned to listen for itself.",
  },
  {
    name: "Qt-Looper",
    year: "2026",
    tags: ["TypeScript", "Web Audio", "Web MIDI"],
    href: "/qt-looper/",
    summary:
      "A six-track MIDI looper. Record a phrase on any General MIDI instrument or a vintage drum machine and it becomes the loop; play five more over it, then save it as a MIDI file. It started as my 2016 final project for CS 312: Audio Programming at Carleton, in C++ and Qt.",
  },
  {
    name: "Set Builder",
    year: "2026",
    tags: ["TypeScript", "Web Audio", "DSP"],
    href: "/set-builder/",
    summary:
      "Hand it a crate and it finds a running order that mixes: neighboring keys on the Camelot wheel, tempos close enough to beatmatch, and an energy arc that builds or peaks and lands. Search for tracks and it listens for their key and tempo the way the Dance Judge does, or import a Rekordbox playlist and send the sorted set back as an M3U8.",
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
