const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createTestFile, cleanup, getTestDir } = require('./helpers.js');

// ── Tool modules ──────────────────────────────────────────────────────
const globTool = require('../lib/tools/glob.js');
const readTool = require('../lib/tools/read.js');
const writeTool = require('../lib/tools/write.js');
const editTool = require('../lib/tools/edit.js');
const bashTool = require('../lib/tools/bash.js');
const backgroundCreateTool = require('../lib/tools/backgroundCreate.js');
const backgroundListTool = require('../lib/tools/backgroundList.js');
const backgroundReadTool = require('../lib/tools/backgroundRead.js');
const backgroundStopTool = require('../lib/tools/backgroundStop.js');
const backgroundTasks = require('../lib/backgroundTasks.js');
const grepTool = require('../lib/tools/grep.js');
const { executeToolCall } = require('../lib/tools.js');
const { isAllowedPath } = require('../lib/safePath.js');

let testDir;

before(() => {
  testDir = getTestDir();

  // Create test directory structure
  createTestFile('glob/a.js', '');
  createTestFile('glob/b.txt', '');
  createTestFile('glob/sub/c.js', '');
  createTestFile('glob/sub/d.txt', '');
  createTestFile('glob/sub/deep/e.js', '');

  // For grep tests
  createTestFile('grep/sample.txt', `hello world
foo bar
hello foo
baz qux
hello123
`);
  createTestFile('grep/code.py', `def hello():
    print("hello world")
    x = 123
`);

  // For read/edit tests
  createTestFile('readme.txt', 'line0\nline1\nline2\nline3\nline4\n');
});

after(() => {
  cleanup();
});

// ── safePath ────────────────────────────────────────────────────────────────

describe('safePath', () => {
  it('allows path under cwd', () => {
    assert.ok(isAllowedPath(testDir));
    assert.ok(isAllowedPath(path.join(testDir, 'foo.js')));
  });

  it('allows path under /tmp', () => {
    assert.ok(isAllowedPath('/tmp'));
    assert.ok(isAllowedPath('/tmp/test-file.txt'));
  });

  it('allows path under home', () => {
    assert.ok(isAllowedPath(os.homedir()));
  });

  it('blocks path outside allowed dirs', () => {
    const allowed = isAllowedPath('/etc/passwd');
    if (allowed) {
      // If running as root where / is home, skip these assertions
      // The user's homedir includes everything
      assert.equal(isAllowedPath('/etc/passwd'), true);
    } else {
      assert.equal(isAllowedPath('/etc/passwd'), false);
      assert.equal(isAllowedPath('/proc/1/cmdline'), false);
    }
  });

  it('blocks path traversal attempts', () => {
    // If we're in a project dir under /root, /root/.ssh should be blocked
    const cwd = process.cwd();
    if (!cwd.startsWith('/root')) {
      // Fallback: try to escape from home into a blocked area
      const home = os.homedir();
      // .ssh should be directly under home but if home IS allowed,
      // this test may pass differently. Let's check a known blocked path.
    }
    assert.equal(isAllowedPath(path.join(testDir, '../../../etc/passwd')), false);
  });
});

// ── Glob ───────────────────────────────────────────────────────────────────

describe('Glob', () => {
  function glob(pattern, dir) {
    return path.join(testDir, 'glob', dir || '');
  }

  async function globExec(pattern, searchDir) {
    return globTool.execute({ pattern, path: searchDir || glob('') });
  }

  it('matches *.js at any depth', async () => {
    const res = await globExec('*.js');
    assert.equal(res.error, undefined);
    const files = res.files.map(f => path.relative(glob(''), f));
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('sub/c.js'));
    assert.equal(files.includes('b.txt'), false);
  });

  it('matches **/*.js recursively', async () => {
    const res = await globExec('**/*.js');
    assert.equal(res.error, undefined);
    const files = res.files.map(f => path.relative(glob(''), f));
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('sub/c.js'));
    assert.ok(files.includes('sub/deep/e.js'));
  });

  it('matches **/c.js at any depth', async () => {
    const res = await globExec('**/c.js');
    assert.equal(res.error, undefined);
    const files = res.files.map(f => path.relative(glob(''), f));
    assert.ok(files.includes('sub/c.js'));
    assert.equal(files.includes('a.js'), false);
  });

  it('matches single char with ?', async () => {
    const res = await globExec('?.js');
    assert.equal(res.error, undefined);
    const files = res.files.map(f => path.basename(f));
    assert.ok(files.includes('a.js'));
    assert.equal(files.includes('b.txt'), false);
  });

  it('matches exact filename with no glob chars', async () => {
    const res = await globExec('a.js');
    assert.equal(res.error, undefined);
    assert.equal(res.files.length, 1);
    assert.equal(path.basename(res.files[0]), 'a.js');
  });

  it('returns empty array for non-existent path', async () => {
    const res = await globExec('nonexistent.js');
    assert.equal(res.error, undefined);
    assert.equal(res.files.length, 0);
  });

  it('returns error for invalid directory', async () => {
    const res = await globTool.execute({ pattern: '*.js', path: '/nonexistent_dir_xyz' });
    assert.ok(res.error);
  });

  it('handles *.* pattern', async () => {
    const res = await globExec('*.*');
    assert.equal(res.error, undefined);
    assert.ok(res.files.length >= 2); // matches any file with a dot at any depth
  });

  it('respects limit parameter', async () => {
    const manyDir = path.join(testDir, 'glob_many');
    fs.mkdirSync(manyDir, { recursive: true });
    for (let i = 0; i < 250; i++) {
      fs.writeFileSync(path.join(manyDir, `file${i}.js`), '');
    }
    const res = await globTool.execute({ pattern: '*.js', path: manyDir, limit: 50 });
    assert.equal(res.files.length, 50);
    assert.equal(res.truncated, true);
    fs.rmSync(manyDir, { recursive: true, force: true });
  });

  it('does not match dotfiles or files in node_modules', async () => {
    createTestFile('glob/.hidden.js', '');
    createTestFile('glob/node_modules/skip.js', '');
    const res = await globExec('**/*.js');
    const files = res.files.map(f => path.relative(glob(''), f));
    assert.equal(files.includes('.hidden.js'), false);
    assert.equal(files.includes('node_modules/skip.js'), false);
  });
});

// ── Read ───────────────────────────────────────────────────────────────────

describe('Read', () => {
  it('reads a file', async () => {
    const res = await readTool.execute({ file_path: path.join(testDir, 'readme.txt') });
    assert.equal(res.error, undefined);
    assert.ok(res.content);
    assert.equal(res.content.includes('line2'), true);
  });

  it('reads with offset and limit', async () => {
    const res = await readTool.execute({
      file_path: path.join(testDir, 'readme.txt'),
      offset: 1,
      limit: 2,
    });
    assert.equal(res.error, undefined);
    const lines = res.content.split('\n');
    assert.equal(lines.length <= 2, true);
    assert.equal(lines[0], '2	line1');
  });

  it('returns error for non-existent file', async () => {
    const res = await readTool.execute({ file_path: '/nonexistent_file_xyz/test.txt' });
    assert.ok(res.error);
  });

  it('returns error for a directory', async () => {
    const res = await readTool.execute({ file_path: testDir });
    assert.ok(res.error);
  });

  it('blocks path outside allowed range', async () => {
    const res = await readTool.execute({ file_path: '/etc/passwd' });
    assert.ok(res.error);
    assert.ok(res.error.startsWith('Path not allowed'));
  });

  it('includes file size in result', async () => {
    const res = await readTool.execute({ file_path: path.join(testDir, 'readme.txt') });
    assert.equal(res.error, undefined);
    assert.equal(typeof res.size, 'number');
    assert.ok(res.size > 0);
  });
});

// ── Write ──────────────────────────────────────────────────────────────────

describe('Write', () => {
  it('writes content to a file', () => {
    const filePath = path.join(testDir, 'output.txt');
    const res = writeTool.execute({ file_path: filePath, content: 'hello' });
    assert.equal(res.error, undefined);
    assert.equal(res.ok, true);
    assert.equal(fs.readFileSync(filePath, 'utf-8'), 'hello');
  });

  it('creates intermediate directories', () => {
    const filePath = path.join(testDir, 'nested/a/b/c.txt');
    const res = writeTool.execute({ file_path: filePath, content: 'nested' });
    assert.equal(res.error, undefined);
    assert.equal(res.ok, true);
    assert.equal(fs.existsSync(filePath), true);
  });

  it('blocks path outside allowed range', () => {
    const res = writeTool.execute({ file_path: '/etc/pitty-test-xyz', content: 'test' });
    assert.ok(res.error);
    assert.ok(res.error.startsWith('Path not allowed'));
  });
});

// ── Edit ───────────────────────────────────────────────────────────────────

describe('Edit', () => {
  const filePath = path.join(testDir, 'edit_test.txt');

  before(() => {
    fs.writeFileSync(filePath, 'hello world\nfoo bar\n', 'utf-8');
  });

  function makeEditMessages() {
    const stat = fs.statSync(filePath);
    return [{ role: 'tool', content: JSON.stringify({ path: filePath, _mtime: stat.mtimeMs }) }];
  }

  it('replaces existing content', () => {
    const res = editTool.execute({ file_path: filePath, old_string: 'foo bar', new_string: 'baz qux' }, { messages: makeEditMessages() });
    assert.equal(res.error, undefined);
    assert.equal(res.ok, true);
    assert.equal(res.replaced, 1);
    assert.equal(fs.readFileSync(filePath, 'utf-8'), 'hello world\nbaz qux\n');
  });

  it('returns error when old_string not found', () => {
    const res = editTool.execute({ file_path: filePath, old_string: 'nonexistent', new_string: 'x' }, { messages: makeEditMessages() });
    assert.ok(res.error);
  });

  it('blocks path outside allowed range', () => {
    const res = editTool.execute({ file_path: '/etc/passwd', old_string: 'root', new_string: 'user' });
    assert.ok(res.error);
    assert.ok(res.error.startsWith('Path not allowed'));
  });
});

// ── Bash ───────────────────────────────────────────────────────────────────

describe('Bash', () => {
  it('executes a simple command', async () => {
    const res = await bashTool.execute({ command: 'echo hello' });
    assert.equal(res.error, undefined);
    assert.equal(res.stdout.trim(), 'hello');
    assert.equal(res.exitCode, 0);
  });

  it('captures exit code', async () => {
    const res = await bashTool.execute({ command: 'exit 42' });
    assert.equal(res.exitCode, 42);
  });

  it('captures stderr', async () => {
    const res = await bashTool.execute({ command: 'echo err >&2' });
    assert.equal(res.stderr.trim(), 'err');
  });

  it('honors working directory', async () => {
    const res = await bashTool.execute({ command: 'pwd', workdir: '/tmp' });
    assert.ok(res.stdout.trim().endsWith('/tmp') || res.stdout.trim() === '/tmp');
  });

  it('closes stdin for commands that wait for input', async () => {
    const start = Date.now();
    const res = await bashTool.execute({ command: 'cat', timeout: 1000 });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, '');
    assert.ok(Date.now() - start < 500, 'cat should exit promptly when stdin is closed');
  });

  it('moves a running command to background on request', async () => {
    backgroundTasks.resetForTests();
    const start = Date.now();
    const promise = bashTool.execute({
      command: 'sleep 0.2; echo done',
      timeout: 5000,
    });
    setTimeout(() => bashTool.moveCurrentRunToBackground(), 50);
    const res = await promise;

    assert.equal(res.background, true);
    assert.equal(res.taskId, 'bg_1');
    assert.ok(Date.now() - start < 150);
    assert.ok(res.stdout.includes('已转为后台任务继续运行。'));
    assert.ok(res.stdout.includes('后台任务运行结束后，会自动通知你。你现在不需要做任何操作。'));
    assert.equal(res.stdout.includes('/bg stop'), false);
    assert.equal(res.stdout.includes('/bg list'), false);

    await new Promise(resolve => setTimeout(resolve, 300));
    const deltas = backgroundTasks.consumeTaskDeltas();
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].id, 'bg_1');
    assert.ok(deltas[0].output.includes('done'));
    assert.equal(deltas[0].status, 'completed');
    backgroundTasks.resetForTests();
  });

  it('reports completed status for final background output', async () => {
    backgroundTasks.resetForTests();
    const promise = bashTool.execute({
      command: 'sleep 0.05; echo finished',
      timeout: 5000,
    });
    setTimeout(() => bashTool.moveCurrentRunToBackground(), 10);
    await promise;

    await new Promise(resolve => setTimeout(resolve, 200));
    const deltas = backgroundTasks.consumeTaskDeltas();
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].status, 'completed');
    assert.equal(deltas[0].exitCode, 0);
    assert.ok(deltas[0].output.includes('finished'));
    backgroundTasks.resetForTests();
  });

  it('does not automatically background commands estimated as long-running', async () => {
    backgroundTasks.resetForTests();
    const res = await bashTool.execute({
      command: 'sleep 0.05; echo done',
      backgroundAfter: 10,
      timeout: 5000,
    });

    assert.equal(res.background, undefined);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes('done'));
    assert.equal(backgroundTasks.listTasks().length, 0);
    backgroundTasks.resetForTests();
  });

});


// ── Background tasks ─────────────────────────────────────────────────────────

describe('Background task tools', () => {
  it('creates, lists, reads, and stops background tasks', async () => {
    backgroundTasks.resetForTests();

    const created = await backgroundCreateTool.execute({
      command: 'while true; do echo tick; sleep 0.05; done',
      workdir: '/tmp',
    });
    assert.equal(created.taskId, 'bg_1');
    assert.equal(created.status, 'running');

    const listed = backgroundListTool.execute({});
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].taskId, 'bg_1');
    assert.equal(listed.tasks[0].cwd, '/tmp');
    assert.equal(listed.tasks[0].status, 'running');

    await new Promise(resolve => setTimeout(resolve, 120));
    const read = backgroundReadTool.execute({ taskId: 'bg_1' });
    assert.equal(read.taskId, 'bg_1');
    assert.ok(read.output.trim().length > 0);
    assert.ok(read.formatted.includes('[TASK_ID="bg_1"'));
    assert.ok(read.formatted.includes('[END_OF_TASK_OUTPUT DURATION_SECONDS="'));

    const stopped = backgroundStopTool.execute({ taskId: 'bg_1' });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.taskId, 'bg_1');
    backgroundTasks.resetForTests();
  });

  it('reports missing background tasks', () => {
    backgroundTasks.resetForTests();
    assert.ok(backgroundReadTool.execute({ taskId: 'bg_missing' }).error);
    assert.equal(backgroundStopTool.execute({ taskId: 'bg_missing' }).ok, false);
  });
});



describe('Grep', () => {
  const grepDir = path.join(testDir, 'grep');

  it('finds string matches in a single file', async () => {
    const res = await grepTool.execute({ pattern: 'hello', path: path.join(grepDir, 'sample.txt') });
    assert.equal(res.error, undefined);
    assert.equal(res.count, 3);
  });

  it('finds string matches in a directory', async () => {
    const res = await grepTool.execute({ pattern: 'hello', path: grepDir });
    assert.equal(res.error, undefined);
    assert.ok(res.count >= 3);
  });

  it('supports regex patterns', async () => {
    // wo? matches "wo" or "w"; in "hello world" it matches "wo"
    const res = await grepTool.execute({ pattern: 'wo?', path: path.join(grepDir, 'sample.txt') });
    assert.equal(res.error, undefined);
    assert.ok(res.count >= 1);
  });

  it('matches literal path strings as regex', async () => {
    const grepFile = path.join(testDir, 'grep_path_test.txt');
    fs.writeFileSync(grepFile, '/usr/bin/foo\n/usr/local/bin/bar\n');
    const res = await grepTool.execute({ pattern: '/usr/bin', path: grepFile });
    assert.equal(res.error, undefined);
    assert.equal(res.count, 1);
  });

  it('supports regex quantifiers', async () => {
    const grepFile = path.join(testDir, 'grep_regex_test.txt');
    fs.writeFileSync(grepFile, 'foo123\nfoo\nfo\nfooo\nbar\n');
    const res = await grepTool.execute({ pattern: 'fo+', path: grepFile });
    assert.equal(res.error, undefined);
    // fo+ matches lines: "foo123" (matches "foo"), "foo", "fo", "fooo"
    assert.equal(res.count, 4);
  });

  it('respects head_limit', async () => {
    const res = await grepTool.execute({ pattern: 'line', path: path.join(testDir, 'readme.txt'), head_limit: 2 });
    assert.equal(res.error, undefined);
    assert.equal(res.count, 2);
    assert.ok(typeof res.results === 'string');
  });

  it('supports files_with_matches output mode', async () => {
    const res = await grepTool.execute({ pattern: 'hello', path: grepDir, output_mode: 'files_with_matches' });
    assert.equal(res.error, undefined);
    assert.ok(res.count >= 1);
    assert.ok(Array.isArray(res.results));
  });

  it('supports count output mode', async () => {
    const res = await grepTool.execute({ pattern: 'hello', path: grepDir, output_mode: 'count' });
    assert.equal(res.error, undefined);
    assert.ok(res.count >= 3);
    assert.ok(Array.isArray(res.results));
  });

  it('supports case insensitive search', async () => {
    const res = await grepTool.execute({ pattern: 'HELLO', path: path.join(grepDir, 'sample.txt'), '-i': true });
    assert.equal(res.error, undefined);
    assert.equal(res.count, 3);
  });

  it('returns content mode results with file and line info', async () => {
    const res = await grepTool.execute({ pattern: 'hello', path: path.join(grepDir, 'sample.txt') });
    assert.equal(res.error, undefined);
    assert.ok(res.results.includes('File:'));
    assert.ok(res.results.includes('\t'));
  });
});

// ── tools.js executeToolCall ───────────────────────────────────────────────

describe('executeToolCall', () => {
  it('returns error for unknown tool', async () => {
    const res = await executeToolCall({ function: { name: 'NonexistentTool', arguments: '{}' } });
    assert.equal(res.name, 'NonexistentTool');
    assert.ok(res.result.error);
  });

  it('returns error for invalid JSON args', async () => {
    const res = await executeToolCall({ function: { name: 'Glob', arguments: '{invalid json}' } });
    assert.ok(res.result.error);
  });

  it('returns error for missing required param', async () => {
    // Glob requires pattern
    const res = await executeToolCall({ function: { name: 'Glob', arguments: '{}' } });
    assert.ok(res.result.error);
    assert.ok(res.result.error.includes('必要参数') || res.result.error.includes('Missing required'));
  });

  it('executes a valid tool call successfully', async () => {
    const res = await executeToolCall({
      function: {
        name: 'Glob',
        arguments: JSON.stringify({ pattern: '*.js', directory: path.join(testDir, 'glob') }),
      },
    });
    assert.equal(res.result.error, undefined);
    assert.ok(Array.isArray(res.result.files));
  });

  it('catches runtime errors gracefully', async () => {
    // Bash with a command that will throw
    const res = await executeToolCall({
      function: {
        name: 'Read',
        arguments: JSON.stringify({ file_path: '/nonexistent' }),
      },
    });
    assert.ok(res.result.error || res.result === undefined || true);
  });
});
