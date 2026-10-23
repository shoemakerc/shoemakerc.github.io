// Refits the Dance Judge's scoring model, the weights in
// src/lib/dance-judge/judge.ts.
//
// For each song in dance-judge-songs.txt it finds Apple's 30-second preview
// through the iTunes Search API and runs the site's own analyzer on it, then
// looks up Spotify's archived audio features for the same song through
// ReccoBeats, which mirrors them. Out the other end come ridge regressions
// from the analyzer's inputs to Spotify's danceability and energy, with their
// cross-validated accuracy, ready to paste into judge.ts.
//
// macOS only, since it decodes the previews with afconvert, and slow on
// purpose: Apple allows about 20 searches a minute. Everything fetched is
// cached in $TMPDIR/dance-judge-calibration (or $DANCE_JUDGE_CACHE), so a
// rerun picks up where the last one stopped and only the analysis and fit
// run again. `npm run calibrate:dance-judge`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SONGS = path.join(ROOT, "scripts", "dance-judge-songs.txt");
const CACHE = process.env.DANCE_JUDGE_CACHE ?? path.join(os.tmpdir(), "dance-judge-calibration");
const CACHE_FILE = path.join(CACHE, "songs.json");
const RECCOBEATS = "https://api.reccobeats.com/v1";
const FOLDS = 10;
const LAMBDAS = [0.3, 1, 3, 10, 30, 100];

// Node strips the types; neither file has runtime imports of its own.
const load = (file) => import(pathToFileURL(path.join(ROOT, "src/lib/dance-judge", file)).href);
const { analyze } = await load("analyze.ts");
const { inputs, INPUT_NAMES } = await load("judge.ts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fs.mkdirSync(path.join(CACHE, "previews"), { recursive: true });
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));

const songs = fs
  .readFileSync(SONGS, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const [title, artist] = line.split(" | ");
    return { line, title, artist };
  });

// ---------- Matching ----------

const norm = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** The title without "(feat. …)", "[Remastered]" or " - Radio Edit". */
const baseTitle = (s) => norm(s.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, "")) || norm(s);
const normArtist = (s) => norm(s).replace(/^the /, "");
const VERSIONS = /\b(live|karaoke|instrumental|remix|remixed|acoustic|demo|cover|tribute|8 bit|lullaby|version|edit|mix|session|rehearsal|take)\b/;
const COVERS = /made famous|karaoke|tribute|originally performed|in the style of|cover/i;

/** The artist has to be the whole credit or its first name ("Daft Punk, Pharrell Williams & Nile Rodgers"). */
function artistMatches(credit, want) {
  const w = normArtist(want);
  const h = normArtist(credit);
  // Names in other scripts normalize to nothing; don't let "" match everything.
  if (!w || !h || COVERS.test(credit)) return false;
  return h === w || normArtist(credit.split(/\s*(?:,|&|\bfeat\.?|\bft\.|\bwith\b|\bx\b)\s*/i)[0]) === w;
}

async function getJson(url, minGap) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(minGap);
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return res.json();
    if (res && res.status < 500 && res.status !== 429 && res.status !== 403) return null;
    const wait = Number(res?.headers.get("retry-after")) * 1000 || 5000 * attempt;
    console.warn(`  ${res?.status ?? "network error"}; waiting ${wait / 1000}s`);
    await sleep(wait);
  }
  return null;
}

// Apple asks for about 20 searches a minute.
const itunes = (params) => getJson(`https://itunes.apple.com/search?${new URLSearchParams(params)}`, 3200);
const reccobeats = (route, params) => getJson(`${RECCOBEATS}${route}?${new URLSearchParams(params)}`, 400);

async function findPreview(song) {
  const body = await itunes({ term: `${song.title} ${song.artist}`, entity: "song", limit: "15", country: "US" });
  const hits = (body?.results ?? []).filter(
    (r) => r.previewUrl && artistMatches(r.artistName, song.artist) && baseTitle(r.trackName) === baseTitle(song.title),
  );
  const pick = hits.find((r) => !VERSIONS.test(norm(r.trackName))) ?? hits[0];
  return pick ? { trackId: pick.trackId, previewUrl: pick.previewUrl, album: pick.collectionName } : null;
}

const isTrack = (song) => (t) =>
  baseTitle(t.trackTitle) === baseTitle(song.title) &&
  !VERSIONS.test(norm(t.trackTitle)) &&
  t.artists?.length > 0 &&
  normArtist(t.artists[0].name) === normArtist(song.artist) &&
  !t.artists.some((a) => COVERS.test(a.name));

/**
 * ReccoBeats' title search stops at 200 rows and often misses the original,
 * so look in the album iTunes names, then in the artist's whole catalog, and
 * take the most popular exact match.
 */
async function findSpotifyTrack(song, album) {
  const found = [];
  const albumName = album.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+(single|ep)$/i, "").trim();
  if (albumName) {
    const albums = await reccobeats("/album/search", { searchText: albumName, size: "50" });
    const candidates = (albums?.content ?? [])
      .filter((a) => a.artists?.length && normArtist(a.artists[0].name) === normArtist(song.artist))
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, 3);
    for (const a of candidates) {
      const tracks = await reccobeats(`/album/${a.id}/track`, { size: "50" });
      found.push(...(tracks?.content ?? []).filter(isTrack(song)));
      if (found.length) break;
    }
  }
  if (!found.some((t) => (t.popularity ?? 0) >= 15)) {
    const artists = await reccobeats("/artist/search", { searchText: song.artist, size: "10" });
    const artist = (artists?.content ?? []).find((a) => normArtist(a.name) === normArtist(song.artist));
    for (let page = 0; artist && page < 12; page++) {
      const tracks = await reccobeats(`/artist/${artist.id}/track`, { size: "50", page: String(page) });
      found.push(...(tracks?.content ?? []).filter(isTrack(song)));
      if (found.some((t) => (t.popularity ?? 0) >= 30) || page + 1 >= (tracks?.totalPages ?? 0)) break;
    }
  }
  const best = found.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];
  return best ? { id: best.href.split("/").pop(), title: best.trackTitle, popularity: best.popularity } : null;
}

async function fetchFeatures(pending) {
  for (let i = 0; i < pending.length; i += 40) {
    const batch = pending.slice(i, i + 40);
    const body = await reccobeats("/audio-features", { ids: batch.map((s) => cache[s.line].spotify.id).join(",") });
    for (const song of batch) {
      const f = (body?.content ?? []).find((f) => f.href.endsWith(cache[song.line].spotify.id));
      // Spotify's own numbers have at most three significant digits. Four mean
      // ReccoBeats estimated them itself, which isn't what we're fitting to.
      const spotify = f && [f.danceability, f.energy].every((x) => Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-6);
      cache[song.line].features = spotify
        ? { danceability: f.danceability, energy: f.energy, tempo: f.tempo, key: f.key, mode: f.mode }
        : null;
    }
    save();
  }
}

// ---------- Listening ----------

/** Reads the mono float32 WAV that afconvert writes. */
function readWav(file) {
  const buf = fs.readFileSync(file);
  let format = null;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") format = { channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12) };
    if (id === "data" && format) {
      const samples = new Float32Array(size / 4 / format.channels);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readFloatLE(at + 8 + i * 4 * format.channels);
      return { samples, sampleRate: format.rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`No audio in ${file}`);
}

async function listen(preview) {
  const m4a = path.join(CACHE, "previews", `${preview.trackId}.m4a`);
  const wav = m4a.replace(/\.m4a$/, ".wav");
  if (!fs.existsSync(m4a)) {
    const res = await fetch(preview.previewUrl);
    if (!res.ok) return null;
    fs.writeFileSync(m4a, Buffer.from(await res.arrayBuffer()));
  }
  // Same rate the browser analyzes at (see listen.ts).
  if (!fs.existsSync(wav)) execFileSync("afconvert", ["-f", "WAVE", "-d", "LEF32@22050", "-c", "1", m4a, wav]);
  const { samples, sampleRate } = readWav(wav);
  return analyze(samples, sampleRate);
}

// ---------- Fitting ----------

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Ridge regression on standardized inputs, returned in raw units. */
function ridge(X, y, lambda) {
  const n = X.length;
  const d = X[0].length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, x) => s + x[j], 0) / n);
  const sd = mean.map((m, j) => Math.sqrt(X.reduce((s, x) => s + (x[j] - m) ** 2, 0) / n) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / sd[j]));
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const A = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => Z.reduce((s, z) => s + z[i] * z[j], 0) + (i === j ? lambda : 0)),
  );
  const w = solve(A, Array.from({ length: d }, (_, i) => Z.reduce((s, z, k) => s + z[i] * (y[k] - yMean), 0)));
  const coef = w.map((wi, j) => wi / sd[j]);
  return { intercept: yMean - coef.reduce((s, c, j) => s + c * mean[j], 0), coef };
}

const predict = (model, x) => Math.min(1, Math.max(0, x.reduce((s, v, j) => s + model.coef[j] * v, model.intercept)));

function pearson(a, b) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/**
 * Picks the ridge penalty by cross-validation and reports how well it
 * predicts unseen songs. Regression pulls every guess toward the average, so
 * the final model is stretched back out by 1/r: otherwise almost nothing
 * would ever be "a complete banger".
 */
function fit(X, y) {
  let best = null;
  for (const lambda of LAMBDAS) {
    const predicted = new Array(y.length);
    for (let fold = 0; fold < FOLDS; fold++) {
      const train = X.map((_, i) => i).filter((i) => i % FOLDS !== fold);
      const model = ridge(train.map((i) => X[i]), train.map((i) => y[i]), lambda);
      X.forEach((x, i) => {
        if (i % FOLDS === fold) predicted[i] = predict(model, x);
      });
    }
    const r = pearson(predicted, y);
    if (!best || r > best.r) best = { lambda, r, predicted };
  }
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const stretch = 1 / best.r;
  const widen = (p) => Math.min(1, Math.max(0, mean + (p - mean) * stretch));
  const predicted = best.predicted.map(widen);
  const mae = predicted.reduce((s, p, i) => s + Math.abs(p - y[i]), 0) / y.length;
  const raw = ridge(X, y, best.lambda);
  const model = {
    intercept: raw.intercept * stretch + mean * (1 - stretch),
    coef: raw.coef.map((c) => c * stretch),
  };
  return { lambda: best.lambda, r: best.r, mae, stretch, predicted, model };
}

// The 2017 verdicts change at these danceability scores (THRESHOLDS in judge.ts).
const band = (x) => [0.25, 0.45, 0.6, 0.85].filter((t) => x >= t).length;

// ---------- Run ----------

for (const song of songs) {
  const entry = (cache[song.line] ??= {});
  if (entry.preview === undefined) {
    entry.preview = await findPreview(song);
    save();
  }
  if (entry.preview && entry.spotify === undefined) {
    entry.spotify = await findSpotifyTrack(song, entry.preview.album);
    save();
  }
  console.log(`${entry.preview && entry.spotify ? "✓" : "✗"} ${song.line}`);
}
await fetchFeatures(songs.filter((s) => cache[s.line].spotify && cache[s.line].features === undefined));

const rows = [];
for (const song of songs) {
  const { preview, features } = cache[song.line];
  if (!preview || !features) continue;
  const analysis = await listen(preview);
  if (analysis) rows.push({ song, analysis, features });
}

const X = rows.map((r) => inputs(r.analysis));
const near = (a, b) => Math.abs(a - b) / b < 0.04;
const tempoRight = rows.filter((r) => near(r.analysis.tempo, r.features.tempo)).length;
const tempoClose = rows.filter((r) => [0.5, 2 / 3, 1, 1.5, 2].some((k) => near(r.analysis.tempo, r.features.tempo * k))).length;
const keyRight = rows.filter((r) => r.analysis.key === r.features.key && r.analysis.mode === r.features.mode).length;

console.log(`\n${rows.length} songs with a preview and Spotify's features.`);
console.log(`Tempo within 4% of Spotify's: ${tempoRight}; counting double, half and 3:2 time: ${tempoClose}.`);
console.log(`Key and mode the same as Spotify's: ${keyRight}.\n`);
for (const target of ["danceability", "energy"]) {
  const y = rows.map((r) => r.features[target]);
  const { lambda, r, mae, stretch, predicted, model } = fit(X, y);
  const guess = y.reduce((s, v) => s + v, 0) / y.length;
  const baseline = y.reduce((s, v) => s + Math.abs(v - guess), 0) / y.length;
  console.log(`${target}: cross-validated r ${r.toFixed(3)}, mean error ${mae.toFixed(3)} (guessing the mean: ${baseline.toFixed(3)}), ridge λ ${lambda}, stretched ×${stretch.toFixed(2)}`);
  if (target === "danceability") {
    const same = predicted.filter((p, i) => band(p) === band(y[i])).length;
    const near = predicted.filter((p, i) => Math.abs(band(p) - band(y[i])) <= 1).length;
    console.log(`Same verdict as Spotify's number would give: ${same} of ${y.length}; within one: ${near}.`);
  }
  console.log(`const ${target.toUpperCase()}: Model = {`);
  console.log(`  intercept: ${model.intercept.toFixed(5)},`);
  console.log(`  coef: [${model.coef.map((c) => c.toFixed(5)).join(", ")}],`);
  console.log(`}; // ${INPUT_NAMES.join(", ")}\n`);
}
