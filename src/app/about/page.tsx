import type { Metadata } from "next";
import { Staff } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "About" };

export default function About() {
  return (
    <>
      <section className="page-intro">
        <p className="meta">About</p>
        <h1 className="page-title">Hi, I’m Chris.</h1>
      </section>
      <Staff />
      <div className="prose">
        <p>
          My parents first put a cello in my hands when I was three. I lay on
          the floor and refused to be taught, twice. We tried again at seven
          and it stuck; piano followed at nine, along with years of youth
          orchestras and patient teachers.
        </p>
        <p>
          I studied computer science at Carleton College, where an audio
          programming course finally let me combine the two.
          These days this site is where I write about what I’m hearing,
          playing, and building.
        </p>
        <p>
          You can find me on{" "}
          {site.links.map((link, i) => (
            <span key={link.href}>
              {i > 0 && (i === site.links.length - 1 ? " and " : ", ")}
              <a href={link.href}>{link.label}</a>
            </span>
          ))}
          .
        </p>
      </div>
    </>
  );
}
