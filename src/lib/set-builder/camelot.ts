// The Camelot wheel: the circle of fifths with numbers instead of names, so
// a DJ can see at a glance which keys mix. Minor keys are the inner ring (A),
// their relative majors the outer ring (B), and a step around the wheel adds
// or drops one sharp.

export type Camelot = { number: number; letter: "A" | "B" };

/** Pitch class (0 = C) and mode (1 major, 0 minor) to the wheel. */
export function fromPitch(pitch: number, mode: number): Camelot {
  // C major sits at 8B and A minor (pitch 9) at 8A; each fifth up is one step.
  const offset = mode ? 7 : 4;
  return { number: ((((pitch * 7 + offset) % 12) + 12) % 12) + 1, letter: mode ? "B" : "A" };
}

export function toPitch({ number, letter }: Camelot) {
  const offset = letter === "B" ? 7 : 4;
  // 7 is its own inverse mod 12, so undoing "times 7" is another "times 7".
  return { pitch: ((((number - 1 - offset) * 7) % 12) + 12) % 12, mode: letter === "B" ? 1 : 0 };
}

export const formatCamelot = (c: Camelot) => `${c.number}${c.letter}`;

const MAJOR_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

/** "A minor", "D♭ major". */
export function keyName(c: Camelot) {
  const { pitch, mode } = toPitch(c);
  return `${(mode ? MAJOR_NAMES : MINOR_NAMES)[pitch]} ${mode ? "major" : "minor"}`;
}

/** Short form for tight spaces: "Am", "D♭". */
export function shortKeyName(c: Camelot) {
  const { pitch, mode } = toPitch(c);
  return mode ? MAJOR_NAMES[pitch] : `${MINOR_NAMES[pitch]}m`;
}

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Reads a key however a library wrote it: Camelot ("8A", "08A"), Open Key
 * ("1m", "1d"), or by name ("Am", "A minor", "F#m", "Dbmaj", "E♭").
 */
export function parseKey(text: string): Camelot | null {
  const s = text.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  if (!s) return null;

  const camelot = /^0?(1[0-2]|[1-9])\s*([ab])$/i.exec(s);
  if (camelot) return { number: Number(camelot[1]), letter: camelot[2].toUpperCase() as "A" | "B" };

  // Open Key (Traktor) starts at C major = 1d and A minor = 1m.
  const openKey = /^(1[0-2]|[1-9])\s*([dm])$/i.exec(s);
  if (openKey) {
    const number = ((Number(openKey[1]) + 6) % 12) + 1;
    return { number, letter: openKey[2].toLowerCase() === "m" ? "A" : "B" };
  }

  const named = /^([a-g])\s*([#b]?)\s*(m(?:in(?:or)?)?|maj(?:or)?|-)?$/i.exec(s);
  if (!named) return null;
  const pitch =
    (LETTERS[named[1].toUpperCase()] + (named[2] === "#" ? 1 : named[2] === "b" ? -1 : 0) + 12) % 12;
  const quality = (named[3] ?? "").toLowerCase();
  const minor = quality === "-" || (quality.startsWith("m") && !quality.startsWith("maj"));
  return fromPitch(pitch, minor ? 0 : 1);
}

export type KeyMove = {
  /** What a DJ would call it. */
  label: string;
  /** How hard it is on the ear: 0 for the same key, 6 for a clash. */
  cost: number;
};

/** How the key changes from one track to the next. */
export function keyMove(from: Camelot, to: Camelot): KeyMove {
  // Steps clockwise, folded into −5…6.
  const step = ((((to.number - from.number) % 12) + 12 + 5) % 12) - 5;
  if (from.letter === to.letter) {
    if (step === 0) return { label: "Same key", cost: 0 };
    if (step === 1 || step === -1) return { label: step > 0 ? "One step up" : "One step down", cost: 1 };
    if (step === 2) return { label: "Energy boost", cost: 2.5 };
    // Up a semitone, the classic last-chorus lift.
    if (step === -5) return { label: "Semitone lift", cost: 3 };
    if (step === -2) return { label: "Two steps down", cost: 3 };
    return { label: "Key clash", cost: 6 };
  }
  if (step === 0) return { label: from.letter === "A" ? "To the major" : "To the minor", cost: 1.5 };
  // Diagonal: 8A to 9B or 8B to 7A, which share all but one note.
  if ((from.letter === "A" && step === 1) || (from.letter === "B" && step === -1)) {
    return { label: "Diagonal", cost: 2 };
  }
  // Parallel: same tonic, other mode (A minor to A major).
  if ((from.letter === "A" && step === 3) || (from.letter === "B" && step === -3)) {
    return { label: "Parallel key", cost: 3 };
  }
  return { label: "Key clash", cost: 6 };
}
