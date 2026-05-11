// Table renderer, inspired by Automattic/cli-table.
// Supports CJK-aware widths, ANSI stripping, terminal-width wrapping.

const { strlen, graphemeWidths } = require('./width.js');

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function repeat(str, times) {
  return times > 0 ? Array(times + 1).join(str) : '';
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

// ── Text wrapping ──────────────────────────────────────────────────────────

function wrapText(text, width) {
  if (width <= 0) return [''];
  const lines = String(text).split('\n');
  const result = [];

  for (const line of lines) {
    const widths = graphemeWidths(line);
    if (widths.length === 0) {
      result.push('');
      continue;
    }

    let cur = '';
    let curW = 0;

    for (const { segment, width: segW } of widths) {
      if (curW + segW > width && curW > 0) {
        result.push(cur);
        cur = '';
        curW = 0;
      }
      cur += segment;
      curW += segW;
    }
    if (cur) result.push(cur);
  }

  return result.length ? result : [''];
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
    this.style = Object.assign({ 'padding-left': 1, 'padding-right': 1 }, opts.style || {});
    this.chars = Object.assign({}, CHARS, opts.chars || {});
    this._terminalWidth = opts.terminalWidth || ((process.stdout.columns || 82) - 2);
    this._widths = null; // cached after compute
  }

  push(row) {
    this.rows.push(row);
    this._widths = null;
  }

  _naturalWidths() {
    const allRows = this.head.length ? [this.head, ...this.rows] : this.rows;
    const colCount = Math.max(
      this.head.length || 0,
      ...this.rows.map(r => r.length),
      this.colWidths.length
    );
    const widths = new Array(colCount).fill(0);

    for (let i = 0; i < this.colWidths.length; i++) {
      widths[i] = Math.max(widths[i], this.colWidths[i]);
    }

    for (const row of allRows) {
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i], strlen(String(row[i])));
      }
    }

    return widths;
  }

  _computeWidths() {
    if (this._widths) return this._widths;

    const natural = this._naturalWidths();
    const colCount = natural.length;
    const pl = this.style['padding-left'] || 1;
    const pr = this.style['padding-right'] || 1;

    // Fixed overhead per row: borders + padding
    const overhead = 1 + (colCount - 1) + colCount * (pl + pr);
    const available = this._terminalWidth - overhead;

    if (available <= 0) {
      this._widths = natural.map(() => Math.max(1, Math.floor(this._terminalWidth / colCount) - pl - pr - 1));
      return this._widths;
    }

    const totalNatural = natural.reduce((a, b) => a + b, 0);
    if (totalNatural <= available) {
      this._widths = natural;
    } else {
      // Proportional distribution
      const minWidth = 3;
      let remaining = available;
      const widths = new Array(colCount).fill(minWidth);
      remaining -= minWidth * colCount;

      if (remaining > 0) {
        const totalWeight = natural.reduce((a, b) => a + Math.max(b - minWidth, 0), 0);
        if (totalWeight > 0) {
          for (let i = 0; i < colCount; i++) {
            const extra = Math.round((natural[i] - minWidth) / totalWeight * remaining);
            widths[i] += extra;
          }
        }
        // Distribute any leftover due to rounding
        let used = widths.reduce((a, b) => a + b, 0);
        for (let i = 0; i < colCount && used < available; i++) {
          widths[i]++;
          used++;
        }
      }

      this._widths = widths;
    }

    return this._widths;
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

    // Wrap each cell to its column width
    const wrapped = cells.map((cell, i) => wrapText(String(cell), widths[i]));
    const height = Math.max(...wrapped.map(w => w.length), 1);

    const sep = DIM + chars.middle + RESET;
    const left = DIM + chars.left + RESET;
    const right = DIM + chars.right + RESET;

    const lines = [];
    for (let h = 0; h < height; h++) {
      const rendered = cells.map((_, i) => {
        const text = h < wrapped[i].length ? wrapped[i][h] : '';
        const align = this.colAligns[i] || 'left';
        const dir = align === 'right' ? 'left' : align === 'center' ? 'both' : 'right';
        return ' '.repeat(pl) + pad(text, widths[i], ' ', dir) + ' '.repeat(pr);
      });
      lines.push(left + rendered.join(sep) + right);
    }

    return lines;
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
      lines.push(...this._drawRow(allRows[i]));
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

module.exports = { Table, strlen, pad, repeat, wrapText };
