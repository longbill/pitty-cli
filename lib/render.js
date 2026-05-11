const { Table } = require('./table.js');

const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const ITALIC = '\x1b[3m';
const GREEN = '\x1b[32m';

function gray(s) { return GRAY + s + RESET; }

function parseTableRow(line) {
  return line.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').split(/\s*\|\s*/).map(c => c.trim());
}

function isTableSeparator(cell) {
  return /^:?-{3,}:?$/.test(cell);
}

function createRenderer() {
  let inCodeBlock = false;
  let tableBuffer = [];

  function renderInline(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, BOLD + '$1' + RESET);
    text = text.replace(/\*(.+?)\*/g, ITALIC + '$1' + RESET);
    text = text.replace(/`(.+?)`/g, GREEN + '$1' + RESET);
    return text;
  }

  function renderSingleLine(line) {
    if (/^\s*>/.test(line)) {
      return gray(line);
    }

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      return gray(h[1]) + ' ' + BOLD + h[2] + RESET;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      return gray(line);
    }

    line = renderInline(line);

    line = line.replace(/^(\s*)([-*+])\s+/, '$1' + gray('$2') + ' ');
    line = line.replace(/^(\s*)(\d+\.)\s+/, '$1' + gray('$2') + ' ');

    return line;
  }

  function flushTable() {
    if (tableBuffer.length < 2) {
      const lines = tableBuffer.map(l => l);
      tableBuffer = [];
      return lines;
    }

    const parsed = tableBuffer.map(line => ({
      cells: parseTableRow(line).map(renderInline),
      isSep: parseTableRow(line).every(isTableSeparator),
    }));

    const sepIdx = parsed.findIndex(r => r.isSep);
    const headRow = sepIdx > 0 ? parsed[sepIdx - 1].cells : (parsed[0].isSep ? [] : parsed[0].cells);
    const dataStart = sepIdx >= 0 ? sepIdx + 1 : (headRow.length ? 1 : 0);
    const dataRows = parsed.slice(dataStart).filter(r => !r.isSep).map(r => r.cells);

    const table = new Table({ head: headRow.length ? headRow : undefined });
    for (const row of dataRows) {
      table.push(row);
    }

    tableBuffer = [];
    return table.toString().split('\n');
  }

  function renderLine(line) {
    if (/^\s*```/.test(line)) {
      if (tableBuffer.length > 0) return flushTable().concat('');
      inCodeBlock = !inCodeBlock;
      return [];
    }

    if (inCodeBlock) {
      return [GREEN + line + RESET];
    }

    if (/^\s*\|/.test(line) && line.includes('|', line.indexOf('|') + 1)) {
      tableBuffer.push(line);
      return null;
    }
    if (tableBuffer.length > 0) {
      return flushTable().concat(line ? [renderSingleLine(line)] : []);
    }

    return [renderSingleLine(line)];
  }

  function flush() {
    return flushTable();
  }

  function hasPending() {
    return tableBuffer.length > 0;
  }

  return { renderLine, flush, hasPending };
}

module.exports = { createRenderer };
