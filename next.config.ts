import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build to plain HTML/CSS/JS in `out/` so GitHub Pages can serve it.
  output: "export",
  // `/music/` -> `/music/index.html`, which is how GitHub Pages resolves folders.
  trailingSlash: true,
  // The default image optimizer needs a server; serve images as-is.
  images: { unoptimized: true },
};

export default nextConfig;
