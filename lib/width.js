const stringWidth = require('string-width').default;

function strlen(str) {
  return stringWidth(String(str));
}

function isWide(ch) {
  return stringWidth(String(ch)) === 2;
}

module.exports = { strlen, isWide };
