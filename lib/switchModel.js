const config = require('./config.js');

function formatModelLabel(modelRef, current) {
  return `${modelRef === current ? '* ' : '  '}${modelRef}`;
}

function getSelectableModels(cfg = config.load()) {
  return config.listModelRefs(cfg);
}

function renderModels(models, selected, current, output) {
  output.write('\x1b[?25l');
  output.write('选择模型（↑/↓ 移动，Enter 确认，Esc 取消）\n');
  for (let i = 0; i < models.length; i++) {
    const pointer = i === selected ? '> ' : '  ';
    output.write(pointer + formatModelLabel(models[i], current) + '\n');
  }
}

function clearRenderedLines(count, output) {
  if (count <= 0) return;
  output.write(`\x1b[${count}A`);
  output.write('\x1b[J');
}

function chooseModelInteractive({ input = process.stdin, output = process.stdout } = {}) {
  const models = getSelectableModels();
  const current = config.getMainModel();

  if (models.length === 0) {
    output.write('配置文件中没有可选模型。请在 provider.*.models 中配置模型列表。\n');
    return Promise.resolve({ selected: false, model: null });
  }

  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    output.write('可选模型:\n');
    for (const model of models) output.write(formatModelLabel(model, current) + '\n');
    return Promise.resolve({ selected: false, model: null });
  }

  return new Promise((resolve) => {
    const previousRaw = input.isRaw;
    let selected = Math.max(0, models.indexOf(current));
    let renderedLines = 0;
    let finished = false;

    function redraw() {
      clearRenderedLines(renderedLines, output);
      renderModels(models, selected, current, output);
      renderedLines = models.length + 1;
    }

    function finish(result) {
      if (finished) return;
      finished = true;
      input.removeListener('data', onData);
      input.setRawMode(previousRaw);
      input.resume();
      output.write('\x1b[?25h');
      output.write('\n');
      resolve(result);
    }

    function selectCurrent() {
      const model = models[selected];
      config.setMainModel(model);
      finish({ selected: true, model });
    }

    function onData(chunk) {
      const key = chunk.toString('utf-8');
      if (key === '\x03' || key === '\x1b') {
        finish({ selected: false, model: null });
        return;
      }
      if (key === '\r' || key === '\n') {
        selectCurrent();
        return;
      }
      if (key === '\x1b[A') {
        selected = (selected - 1 + models.length) % models.length;
        redraw();
        return;
      }
      if (key === '\x1b[B') {
        selected = (selected + 1) % models.length;
        redraw();
      }
    }

    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    redraw();
  });
}

module.exports = {
  chooseModelInteractive,
  getSelectableModels,
  formatModelLabel,
};
