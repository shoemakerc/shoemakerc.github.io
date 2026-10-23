import { site } from "@/lib/site";

// Published at /shared/site.json for the coffee calculator and the looper,
// which build their headers and footers from it. See also /shared/base.css.
export const dynamic = "force-static";

export function GET() {
  const { name, url, nav, links } = site;
  return Response.json({ name, url, nav, links });
}
