// Simple table renderer, inspired by Automattic/cli-table.
// Supports CJK-aware column widths, ANSI stripping, head styling.

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// ── Width helpers ──────────────────────────────────────────────────────────

function strlen(str) {
  const stripped = String(str).replace(/\x1b\[(?:\d*;){0,5}\d*m/g, '');
  let w = 0;
  for (const ch of stripped) {
    w += (ch >= '一' && ch <= '鿿') ||
         (ch >= '　' && ch <= '〿') ||
         (ch >= '＀' && ch <= '￯') ? 2 : 1;
  }
  return w;
}

function repeat(str, times) {
  return Array(times + 1).join(str);
}

function pad(str, len, chr, dir) {
  const padLen = len - strlen(str);
  if (padLen <= 0) return str;
  switch (dir) {
    case 'left':
      return repeat(chr, padLen) + str;
    case 'both': {
      const right = Math.ceil(padLen / 2);
      return repeat(chr, padLen - right) + str + repeat(chr, right);
    }
    default: // right
      return str + repeat(chr, padLen);
  }
}

// ── Chars ──────────────────────────────────────────────────────────────────

const CHARS = {
  'top': '─',
  'top-mid': '┬',
  'top-left': '┌',
  'top-right': '┐',
  'bottom': '─',
  'bottom-mid': '┴',
  'bottom-left': '└',
  'bottom-right': '┘',
  'left': '│',
  'left-mid': '├',
  'mid': '─',
  'mid-mid': '┼',
  'right': '│',
  'right-mid': '┤',
  'middle': '│',
};

// ── Table class ────────────────────────────────────────────────────────────

class Table {
  constructor(opts = {}) {
    this.options = opts;
    this.head = opts.head || [];
    this.rows = [];
    this.colAligns = opts.colAligns || [];
    this.colWidths = opts.colWidths || [];
    this.style = Object.assign({ 'padding-left': 1, 'padding-right': 1, head: [], border: [] }, opts.style);
    this.chars = Object.assign({}, CHARS, opts.chars || {});
  }

  push(row) {
    this.rows.push(row);
  }

  _computeWidths() {
    const allRows = this.head.length ? [this.head, ...this.rows] : this.rows;
    const colCount = Math.max(
      this.head.length || 0,
      ...this.rows.map(r => r.length),
      this.colWidths.length
    );
    const widths = new Array(colCount).fill(0);

    // Apply explicit colWidths
    for (let i = 0; i < this.colWidths.length; i++) {
      widths[i] = Math.max(widths[i], this.colWidths[i]);
    }

    // Measure content
    for (const row of allRows) {
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i], strlen(String(row[i])));
      }
    }

    return widths;
  }

  _drawLine() {
    const chars = this.chars;
    const widths = this._computeWidths();
    const pl = this.style['padding-left'] || 1;
    const pr = this.style['padding-right'] || 1;

    return DIM +
      chars['top-left'] +
      widths.map((w, i) => repeat(chars.top, w + pl + pr) + (i < widths.length - 1 ? chars['top-mid'] : '')).join('') +
      chars['top-right'] +
      RESET;
  }

  _drawSep() {
    const chars = this.chars;
    const widths = this._computeWidths();
    const pl = this.style['padding-left'] || 1;
    const pr = this.style['padding-right'] || 1;
    return DIM +
      chars['left-mid'] +
      widths.map((w, i) => repeat(chars.mid, w + pl + pr) + (i < widths.length - 1 ? chars['mid-mid'] : '')).join('') +
      chars['right-mid'] +
      RESET;
  }

  _drawRow(cells) {
    const chars = this.chars;
    const widths = this._computeWidths();
    const pl = this.style['padding-left'] || 1;
    const pr = this.style['padding-right'] || 1;

    const rendered = cells.map((cell, i) => {
      const align = this.colAligns[i] || 'left';
      const dir = align === 'right' ? 'left' : align === 'center' ? 'both' : 'right';
      return ' '.repeat(pl) + pad(String(cell), widths[i], ' ', dir) + ' '.repeat(pr);
    });

    const sep = DIM + chars.middle + RESET;
    const left = DIM + chars.left + RESET;
    const right = DIM + chars.right + RESET;

    return left + rendered.join(sep) + right;
  }

  toString() {
    if (this.rows.length === 0 && this.head.length === 0) return '';

    const widths = this._computeWidths();
    const lines = [];

    // Top border
    lines.push(this._drawLine());

    // All rows with separators between them
    const allRows = this.head.length > 0 ? [this.head, ...this.rows] : this.rows;
    for (let i = 0; i < allRows.length; i++) {
      lines.push(this._drawRow(allRows[i]));
      if (i < allRows.length - 1) {
        lines.push(this._drawSep());
      }
    }

    // Bottom border
    {
      const chars = this.chars;
      const pl = this.style['padding-left'] || 1;
      const pr = this.style['padding-right'] || 1;
      lines.push(DIM +
        chars['bottom-left'] +
        widths.map((w, i) => repeat(chars.bottom, w + pl + pr) + (i < widths.length - 1 ? chars['bottom-mid'] : '')).join('') +
        chars['bottom-right'] +
        RESET);
    }

    return lines.join('\n');
  }
}

module.exports = { Table, strlen, pad, repeat };
