/**
 * A key name like "B♭ minor", with its ♭ or ♯ set in the music font. Neither
 * text face has those glyphs, and what a device substitutes can make the flat
 * a full em wide ("B ♭ minor") or pair it with a sharp from another font.
 */
export function KeyName({ name }: { name: string }) {
  return (
    <>
      {name.split(/([♭♯])/).map((part, i) =>
        part === "♭" || part === "♯" ? (
          <span key={i} className="accidental">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
