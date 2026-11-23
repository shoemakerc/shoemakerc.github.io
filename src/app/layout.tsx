import type { Metadata } from "next";
import { Newsreader, IBM_Plex_Mono, Noto_Music } from "next/font/google";
import { Header, Footer } from "@/components/ui";
import { site } from "@/lib/site";
import "./base.css";
import "./globals.css";

const serif = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// For the ♭ and ♯ in key names (see KeyName), which neither text face has.
// Not preloaded: only pages that show an accidental download it.
const music = Noto_Music({
  variable: "--font-music",
  subsets: ["music"],
  weight: "400",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable} ${music.variable}`}>
      <body>
        <div className="page">
          <Header />
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
