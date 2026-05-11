// Character display width for terminal rendering.
// East Asian Wide / Fullwidth characters count as 2; others as 1.
// Covers CJK, Japanese kana, Korean Hangul, and fullwidth punctuation.

function isWide(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x1100 && c <= 0x115f) ||   // Hangul Jamo
         (c >= 0x2e80 && c <= 0xa4cf) ||   // CJK Radicals … Yi
         (c >= 0xac00 && c <= 0xd7a3) ||   // Hangul Syllables
         (c >= 0xf900 && c <= 0xfaff) ||   // CJK Compatibility Ideographs
         (c >= 0xfe10 && c <= 0xfe19) ||   // Vertical forms
         (c >= 0xfe30 && c <= 0xfe6f) ||   // CJK Compatibility Forms
         (c >= 0xff00 && c <= 0xff60) ||   // Fullwidth Forms
         (c >= 0xffe0 && c <= 0xffe6) ||   // Fullwidth Signs
         (c >= 0x1f000 && c <= 0x1f644) || // Emoji
         (c >= 0x20000 && c <= 0x2ffff) || // CJK Extension B+
         (c >= 0x30000 && c <= 0x3ffff);   // CJK Extension G+
}

function strlen(str) {
  let w = 0;
  for (const ch of String(str)) {
    w += isWide(ch) ? 2 : 1;
  }
  return w;
}

module.exports = { isWide, strlen };
