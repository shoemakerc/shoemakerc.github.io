// Songs come from Apple's iTunes Search API: no key, open to browsers, and
// every result has a 30-second preview the judge can listen to. Apple asks
// for no more than about 20 requests a minute, so search on a pause in
// typing rather than every keystroke.

export type Song = {
  id: number;
  title: string;
  artist: string;
  album: string;
  year: string;
  durationMs: number;
  previewUrl: string;
  artwork: string;
  appleUrl: string;
};

type Result = {
  kind?: string;
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  previewUrl?: string;
  artworkUrl100?: string;
  trackViewUrl: string;
};

const API = "https://itunes.apple.com";

async function request(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ country: "US", ...params })}`, {
    signal,
  });
  if (!res.ok) throw new Error(`iTunes ${path} failed: ${res.status}`);
  const body: { results: Result[] } = await res.json();
  return body.results
    .filter((r) => r.kind === "song" && r.previewUrl)
    .map(
      (r): Song => ({
        id: r.trackId,
        title: r.trackName,
        artist: r.artistName,
        album: r.collectionName ?? "",
        year: r.releaseDate?.slice(0, 4) ?? "",
        durationMs: r.trackTimeMillis ?? 0,
        previewUrl: r.previewUrl!,
        artwork: r.artworkUrl100 ?? "",
        appleUrl: r.trackViewUrl,
      }),
    );
}

/** Apple's artwork URLs take any size in place of the 100×100 they come with. */
export function artworkAt(song: Pick<Song, "artwork">, px: number) {
  return song.artwork.replace(/\/\d+x\d+bb\./, `/${px}x${px}bb.`);
}

export function searchSongs(query: string, signal?: AbortSignal) {
  return request("search", { term: query, entity: "song", limit: "8" }, signal);
}

export async function lookupSong(id: number, signal?: AbortSignal) {
  const [song] = await request("lookup", { id: String(id), entity: "song" }, signal);
  return song ?? null;
}

/** Several songs in one request, in the order asked for. */
export async function lookupSongs(ids: number[], signal?: AbortSignal) {
  const songs = await request("lookup", { id: ids.join(","), entity: "song" }, signal);
  const byId = new Map(songs.map((s) => [s.id, s]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
