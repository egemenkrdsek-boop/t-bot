const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tbot-install-test-'));
  try { return run(directory); }
  finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.match(path.basename(directory), /^tbot-install-test-/);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
function write(directory, file, content) {
  const destination = path.join(directory, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}
function sourceFixture(directory, compiler) {
  for (const file of ['prepare.mjs', 'build.mjs', 'copy-desktop.mjs']) {
    write(directory, `scripts/${file}`, fs.readFileSync(path.join(root, 'scripts', file)));
  }
  write(directory, 'src/index.ts', '// fixture');
  write(directory, 'node_modules/typescript/package.json', '{"type":"commonjs"}');
  write(directory, 'node_modules/typescript/bin/tsc', compiler);
}

test('source prepare resolves its compiler without npm or PATH shims', () => fixture(directory => {
  sourceFixture(directory, "require('node:fs').mkdirSync('dist',{recursive:true});require('node:fs').writeFileSync('dist/index.js','compiled');");
  for (const file of ['preload.cjs', 'renderer/index.html', 'renderer/app.js', 'renderer/styles.css']) {
    write(directory, `src/desktop/${file}`, 'asset');
  }
  const result = spawnSync(process.execPath, ['scripts/prepare.mjs'], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, PATH: '', npm_execpath: '', npm_config_global: 'true' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(directory, 'dist/index.js'), 'utf8'), 'compiled');
  assert.equal(fs.readFileSync(path.join(directory, 'dist/desktop/preload.cjs'), 'utf8'), 'asset');
}));

test('source prepare preserves compiler failure and does not copy assets', () => fixture(directory => {
  sourceFixture(directory, 'process.exit(17);');
  const result = spawnSync(process.execPath, ['scripts/prepare.mjs'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 17, result.stderr);
  assert.equal(fs.existsSync(path.join(directory, 'dist/desktop')), false);
}));

const installScenarios = [
  { label: 'default main build failure', pin: '', reachesBuild: true },
  { label: 'exact pinned build failure', pin: 'A'.repeat(40), reachesBuild: true },
  { label: 'pinned checkout mismatch', pin: 'b'.repeat(40), reachesBuild: false },
  { label: 'invalid SHA flag', pin: '--global', reachesBuild: false, invalid: true },
  { label: 'SHA with trailing newline', pin: 'a'.repeat(40) + '\n', reachesBuild: false, invalid: true },
];

for (const scenario of installScenarios) {
test(`PowerShell installer protects global install: ${scenario.label}`, { skip: process.platform !== 'win32' }, () => fixture(directory => {
  const log = path.join(directory, 'calls.txt');
  const gitLog = path.join(directory, 'git.txt');
  const installer = path.join(root, 'scripts/install.ps1').replace(/'/g, "''");
  write(directory, 'runner.ps1', `
$ErrorActionPreference = 'Stop'
function global:node { $global:LASTEXITCODE = 0 }
function global:git {
  [IO.File]::AppendAllText($env:TBOT_TEST_GIT_LOG, (($args -join ' ') + [Environment]::NewLine))
  if ($args[0] -eq 'clone') { [void][IO.Directory]::CreateDirectory($args[-1]) }
  elseif ($args -contains 'rev-parse') { Write-Output ('a' * 40) }
  $global:LASTEXITCODE = 0
}
function global:npm.cmd {
  [IO.File]::AppendAllText($env:TBOT_TEST_LOG, (($args -join ' ') + [Environment]::NewLine))
  $global:LASTEXITCODE = 23
}
try { & '${installer}'; exit 0 }
catch { [Console]::Error.WriteLine($_); exit 1 }
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'runner.ps1')], {
    encoding: 'utf8', env: { ...process.env, TBOT_TEST_LOG: log, TBOT_TEST_GIT_LOG: gitLog, TBOT_INSTALL_REVISION: scenario.pin },
  });
  assert.notEqual(result.status, 0);
  if (scenario.reachesBuild) {
    assert.match(result.stderr, /global CLI was not changed/);
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'ci --global=false --include=dev --ignore-scripts=false');
  } else {
    assert.equal(fs.existsSync(log), false, 'npm must not run on invalid/mismatched pins');
    assert.match(result.stderr, scenario.invalid ? /40-character commit SHA/ : /does not match/);
  }
  if (scenario.invalid) assert.equal(fs.existsSync(gitLog), false, 'invalid flags must not reach git');
  else if (scenario.pin) {
    const calls = fs.readFileSync(gitLog, 'utf8');
    assert.ok(calls.includes(`fetch --depth 1 origin ${scenario.pin.toLowerCase()}`));
    assert.ok(calls.includes(`checkout --detach ${scenario.pin.toLowerCase()}`));
  }
}));

test(`Unix installer protects global install: ${scenario.label}`, t => fixture(directory => {
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/sh.exe' : '/bin/sh';
  if (!fs.existsSync(shell)) return t.skip('POSIX shell unavailable');
  const log = path.join(directory, 'calls.txt');
  const gitLog = path.join(directory, 'git.txt');
  const installer = path.join(root, 'scripts/install.sh').replace(/\\/g, '/').replace(/'/g, "'\\''");
  write(directory, 'runner.sh', `
node() { return 0; }
git() {
  printf '%s\\n' "$*" >> "$TBOT_TEST_GIT_LOG"
  if [ "$1" = clone ]; then
    for destination do :; done
    mkdir -p "$destination"
  elif [ "$3" = rev-parse ]; then
    printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n'
  fi
}
npm() { printf '%s\\n' "$*" >> "$TBOT_TEST_LOG"; return 23; }
. '${installer}'
`);
  const result = spawnSync(shell, [path.join(directory, 'runner.sh').replace(/\\/g, '/')], {
    encoding: 'utf8', env: { ...process.env, TBOT_TEST_LOG: log.replace(/\\/g, '/'), TBOT_TEST_GIT_LOG: gitLog.replace(/\\/g, '/'), TBOT_INSTALL_REVISION: scenario.pin },
  });
  assert.notEqual(result.status, 0, result.stdout);
  if (scenario.reachesBuild) {
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'ci --global=false --include=dev --ignore-scripts=false');
  } else {
    assert.equal(fs.existsSync(log), false, 'npm must not run on invalid/mismatched pins');
    assert.match(result.stderr, scenario.invalid ? /40-character commit SHA/ : /does not match/);
  }
  if (scenario.invalid) assert.equal(fs.existsSync(gitLog), false, 'invalid flags must not reach git');
  else if (scenario.pin) {
    const calls = fs.readFileSync(gitLog, 'utf8');
    assert.ok(calls.includes(`fetch --depth 1 origin ${scenario.pin.toLowerCase()}`));
    assert.ok(calls.includes(`checkout --detach ${scenario.pin.toLowerCase()} --`));
  }
}));
}
