import { readFile } from "node:fs/promises";
import path from "node:path";

// Publishes src/app/base.css at /shared/base.css so the coffee calculator and
// the looper can pick up the same base styles at build time.
export const dynamic = "force-static";

export async function GET() {
  const css = await readFile(path.join(process.cwd(), "src/app/base.css"), "utf8");
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8" },
  });
}
