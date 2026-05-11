function createHistory() {
  const entries = [];
  let index = 0;
  let draft = '';

  function push(input) {
    if (!input.trim()) return;
    entries.push(input);
    index = entries.length;
    draft = '';
  }

  function previous(currentInput) {
    if (entries.length === 0) return currentInput;
    if (index === entries.length) draft = currentInput;
    if (index > 0) index--;
    return entries[index];
  }

  function next() {
    if (entries.length === 0) return draft;
    if (index < entries.length) index++;
    return index === entries.length ? draft : entries[index];
  }

  return { push, previous, next };
}

module.exports = { createHistory };
