// Character display width for terminal rendering.
// Uses string-width for correct emoji / CJK / ANSI width calculation.

const stringWidth = require('string-width').default;

function strlen(str) {
  return stringWidth(str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''));
}

function isWide(ch) {
  if (!ch) return false;
  return strlen(ch) >= 2;
}

// Grapheme-cluster segmentation for correct line-wrapping (used by table.js).
const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function graphemeWidths(str) {
  const clean = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  return [...graphemeSegmenter.segment(clean)].map(s => ({
    segment: s.segment,
    width: stringWidth(s.segment)
  }));
}

module.exports = { strlen, isWide, graphemeWidths };
