const rateYourMusic = "https://rateyourmusic.com/~shoeman27";
const lastFm = "https://www.last.fm/user/shoeman27";

export const site = {
  name: "Chris Shoemaker",
  url: "https://shoemakerc.github.io",
  description: "Notes on music, listening, and the odd bit of code.",
  // Swap this for whatever you're listening to now.
  playlist: {
    id: "7KkKPxl0qHqa9bpLzg3ekY",
    label: "August ’26",
  },
  rateYourMusic,
  lastFm,
  // Shared with the coffee calculator and the looper through /shared/site.json,
  // along with name, url and links, so changes here reach them on their next
  // build.
  nav: [
    { label: "Writing", path: "/music/" },
    { label: "Listening", path: "/#listening" },
    { label: "Reading", path: "/reading/" },
    { label: "Projects", path: "/projects/" },
    { label: "About", path: "/about/" },
  ],
  links: [
    { label: "Email", href: "mailto:chriskimshoemaker@gmail.com" },
    { label: "GitHub", href: "https://github.com/shoemakerc" },
    { label: "Spotify", href: "https://open.spotify.com/user/someguy_886" },
    { label: "RateYourMusic", href: rateYourMusic },
    { label: "Last.fm", href: lastFm },
    { label: "Goodreads", href: "https://www.goodreads.com/user/show/166556608" },
  ],
};
