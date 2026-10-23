import fs from "node:fs";
import path from "node:path";

// content/restaurants.md holds the top of Chris's Beli list, copied out by
// hand: Beli has no API, no web profiles and no export. It's a Markdown
// table, best first, with Beli's score out of 10 in the last column.

export type Restaurant = {
  name: string;
  /** Neighborhood and/or city. */
  where: string;
  /** Cuisine, or whatever's worth ordering. */
  what: string;
  score: number | null;
};

export function getRestaurants(): Restaurant[] {
  const source = fs.readFileSync(path.join(process.cwd(), "content", "restaurants.md"), "utf8");
  return source
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    // Drop the header row and the |---| row under it.
    .filter(([name]) => name && name !== "Restaurant" && !/^:?-+:?$/.test(name))
    .map(([name, where = "", what = "", score = ""]) => ({
      name,
      where,
      what,
      score: score && Number.isFinite(Number(score)) ? Number(score) : null,
    }));
}
