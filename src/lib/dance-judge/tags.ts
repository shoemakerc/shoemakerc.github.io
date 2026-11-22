// Reads the title, artist, year and cover art out of a music file, so a
// dropped file can be introduced like a searched song. Covers the tags most
// files carry: ID3v2 (MP3, and inside WAV and AIFF), MP4 atoms (M4A), and
// Vorbis comments (FLAC). Anything else falls back to the file's name.

export type Tags = {
  title: string;
  artist: string;
  year: string;
  /** Cover art, if the file has any. */
  picture: Blob | null;
};

type Found = Partial<Tags>;

export function readTags(bytes: ArrayBuffer, fileName: string): Tags {
  const view = new DataView(bytes);
  let found: Found = {};
  try {
    const magic = ascii(view, 0, 4);
    if (magic.startsWith("ID3")) found = id3(view, 0);
    else if (magic === "fLaC") found = flac(view);
    else if (magic === "RIFF") found = chunked(view, true);
    else if (magic === "FORM") found = chunked(view, false);
    else if (ascii(view, 4, 4) === "ftyp") found = mp4(view);
  } catch {
    // A truncated or odd tag: keep whatever was read before it went wrong.
  }
  const named = fromName(fileName);
  return {
    title: found.title?.trim() || named.title,
    artist: found.artist?.trim() || named.artist,
    year: found.year?.match(/\d{4}/)?.[0] ?? "",
    picture: found.picture ?? null,
  };
}

/** "Artist - Title.mp3", the usual way an untagged file is named. */
function fromName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const [artist, ...rest] = base.split(" - ");
  return rest.length
    ? { artist: artist.trim(), title: rest.join(" - ").trim() }
    : { artist: "", title: base.trim() };
}

function ascii(view: DataView, at: number, length: number) {
  let out = "";
  for (let i = at; i < at + length && i < view.byteLength; i++) out += String.fromCharCode(view.getUint8(i));
  return out;
}

const bytesOf = (view: DataView, at: number, length: number) =>
  new Uint8Array(view.buffer, view.byteOffset + at, length);

// ---------- ID3v2 ----------

const syncsafe = (view: DataView, at: number) =>
  (view.getUint8(at) << 21) | (view.getUint8(at + 1) << 14) | (view.getUint8(at + 2) << 7) | view.getUint8(at + 3);

const ID3_ENCODINGS = ["latin1", "utf-16", "utf-16be", "utf-8"];

/** Where a string in this encoding ends: one zero byte, or two for UTF-16. */
function terminator(data: Uint8Array, from: number, encoding: number) {
  const wide = encoding === 1 || encoding === 2;
  for (let i = from; i < data.length; i += wide ? 2 : 1) {
    if (data[i] === 0 && (!wide || data[i + 1] === 0)) return i;
  }
  return data.length;
}

function id3Text(data: Uint8Array) {
  const encoding = data[0];
  const end = terminator(data, 1, encoding);
  return new TextDecoder(ID3_ENCODINGS[encoding] ?? "latin1").decode(data.subarray(1, end));
}

function id3Picture(data: Uint8Array, v22: boolean) {
  const encoding = data[0];
  let at = 1;
  let type: string;
  if (v22) {
    // Three-letter format ("JPG", "PNG") instead of a MIME type.
    type = `image/${String.fromCharCode(...data.subarray(1, 4)).toLowerCase().replace("jpg", "jpeg")}`;
    at = 4;
  } else {
    const end = terminator(data, 1, 0);
    type = new TextDecoder("latin1").decode(data.subarray(1, end)) || "image/jpeg";
    at = end + 1;
  }
  at += 1; // What the picture is of: front cover, artist, and so on.
  at = terminator(data, at, encoding) + (encoding === 1 || encoding === 2 ? 2 : 1);
  return new Blob([data.slice(at)], { type });
}

/**
 * Undoes "unsynchronisation": some taggers slip a zero byte in after every
 * 0xFF so old players won't mistake tag bytes for audio.
 */
function resynchronise(data: Uint8Array) {
  const out = new Uint8Array(data.length);
  let length = 0;
  for (let i = 0; i < data.length; i++) {
    out[length++] = data[i];
    if (data[i] === 0xff && data[i + 1] === 0) i++;
  }
  return out.subarray(0, length);
}

function id3(view: DataView, start: number): Found {
  const major = view.getUint8(start + 3);
  const flags = view.getUint8(start + 5);
  const size = Math.min(syncsafe(view, start + 6), view.byteLength - start - 10);
  // Before 2.4 the whole tag is unsynchronised at once; 2.4 does it per frame.
  if (major < 4 && flags & 0x80) {
    const body = resynchronise(bytesOf(view, start + 10, size));
    return id3Frames(new DataView(body.buffer, body.byteOffset, body.byteLength), 0, body.length, major, flags);
  }
  return id3Frames(view, start + 10, start + 10 + size, major, flags);
}

function id3Frames(view: DataView, from: number, end: number, major: number, flags: number): Found {
  const v22 = major === 2;
  let at = from;
  // An extended header sits between the tag header and the frames.
  if (!v22 && flags & 0x40) {
    at += major === 4 ? syncsafe(view, at) : view.getUint32(at) + 4;
  }
  const idLength = v22 ? 3 : 4;
  const found: Found = {};
  while (at + idLength + (v22 ? 3 : 6) <= Math.min(end, view.byteLength)) {
    const id = ascii(view, at, idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break; // Padding.
    const size = v22
      ? (view.getUint8(at + 3) << 16) | (view.getUint8(at + 4) << 8) | view.getUint8(at + 5)
      : major === 4
        ? syncsafe(view, at + 4)
        : view.getUint32(at + 4);
    const unsynchronised = major === 4 && (view.getUint8(at + 9) & 0x02) !== 0;
    at += v22 ? 6 : 10;
    if (size <= 0 || at + size > view.byteLength) break;
    const data = unsynchronised ? resynchronise(bytesOf(view, at, size)) : bytesOf(view, at, size);
    if (id === "TIT2" || id === "TT2") found.title = id3Text(data);
    else if (id === "TPE1" || id === "TP1") found.artist = id3Text(data);
    else if (["TDRC", "TYER", "TYE", "TDOR"].includes(id)) found.year ??= id3Text(data);
    else if ((id === "APIC" || id === "PIC") && !found.picture) found.picture = id3Picture(data, v22);
    at += size;
  }
  return found;
}

/** WAV (RIFF, little-endian sizes) and AIFF (FORM, big-endian) keep ID3 in a chunk of its own. */
function chunked(view: DataView, littleEndian: boolean): Found {
  for (let at = 12; at + 8 <= view.byteLength; ) {
    const id = ascii(view, at, 4);
    const size = view.getUint32(at + 4, littleEndian);
    if (id.toUpperCase().startsWith("ID3") && ascii(view, at + 8, 3) === "ID3") return id3(view, at + 8);
    at += 8 + size + (size % 2);
  }
  return {};
}

// ---------- MP4 ----------

/** The atoms directly inside [from, to), by name. */
function* atoms(view: DataView, from: number, to: number) {
  for (let at = from; at + 8 <= to; ) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header) return;
    yield { name: ascii(view, at + 4, 4), from: at + header, to: Math.min(to, at + size) };
    at += size;
  }
}

function mp4(view: DataView): Found {
  const find = (name: string, from: number, to: number) => {
    for (const atom of atoms(view, from, to)) if (atom.name === name) return atom;
    return null;
  };
  const moov = find("moov", 0, view.byteLength);
  const udta = moov && find("udta", moov.from, moov.to);
  const meta = udta && find("meta", udta.from, udta.to);
  // `meta` has four bytes of version and flags before its children.
  const list = meta && find("ilst", meta.from + 4, meta.to);
  if (!list) return {};
  const found: Found = {};
  const text = new TextDecoder();
  for (const item of atoms(view, list.from, list.to)) {
    const data = find("data", item.from, item.to);
    if (!data) continue;
    // Eight bytes of type and locale, then the value.
    const value = bytesOf(view, data.from + 8, data.to - data.from - 8);
    if (item.name === "©nam") found.title = text.decode(value);
    else if (item.name === "©ART") found.artist = text.decode(value);
    else if (item.name === "©day") found.year = text.decode(value);
    else if (item.name === "covr") {
      const png = view.getUint32(data.from) === 14;
      found.picture = new Blob([value.slice()], { type: png ? "image/png" : "image/jpeg" });
    }
  }
  return found;
}

// ---------- FLAC ----------

function flac(view: DataView): Found {
  const found: Found = {};
  const text = new TextDecoder();
  for (let at = 4, last = false; !last && at + 4 <= view.byteLength; ) {
    const header = view.getUint8(at);
    last = (header & 0x80) !== 0;
    const size = (view.getUint8(at + 1) << 16) | (view.getUint8(at + 2) << 8) | view.getUint8(at + 3);
    const body = at + 4;
    const type = header & 0x7f;
    if (type === 4) {
      // Vorbis comments: a vendor string, then "KEY=value" entries.
      let p = body + 4 + view.getUint32(body, true);
      const count = view.getUint32(p, true);
      p += 4;
      for (let i = 0; i < count; i++) {
        const length = view.getUint32(p, true);
        const entry = text.decode(bytesOf(view, p + 4, length));
        const split = entry.indexOf("=");
        const key = entry.slice(0, split).toUpperCase();
        const value = entry.slice(split + 1);
        if (key === "TITLE") found.title = value;
        else if (key === "ARTIST") found.artist ??= value;
        else if (key === "DATE" || key === "YEAR") found.year ??= value;
        p += 4 + length;
      }
    } else if (type === 6 && !found.picture) {
      let p = body + 4;
      const mimeLength = view.getUint32(p);
      const mime = ascii(view, p + 4, mimeLength);
      p += 4 + mimeLength;
      p += 4 + view.getUint32(p); // Description.
      p += 16; // Width, height, depth, colors.
      const length = view.getUint32(p);
      found.picture = new Blob([bytesOf(view, p + 4, length).slice()], { type: mime || "image/jpeg" });
    }
    at = body + size;
  }
  return found;
}
