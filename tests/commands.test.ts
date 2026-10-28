import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMAND_COUNT,
  COMMAND_GROUPS,
  commandCatalog,
  commandNamesFor,
  commandsFor,
  findCommand,
  helpFor,
  isWorkflowInvocation,
} from '../src/commands.js';

test('command catalog has unique canonical names and aliases', () => {
  const seen = new Set<string>();
  for (const group of COMMAND_GROUPS) {
    for (const command of group.commands) {
      assert.match(command.name, /^\/[a-z][a-z0-9_-]*$/);
      assert.ok(command.surfaces.length > 0, `${command.name} has no surface`);
      assert.ok(['none', 'optional', 'required'].includes(command.argument ?? 'none'));
      for (const name of [command.name, ...(command.aliases ?? [])]) {
        assert.equal(seen.has(name), false, `duplicate command spelling: ${name}`);
        seen.add(name);
      }
      assert.ok(command.usage.includes(command.name));
    }
  }
  assert.equal(COMMAND_COUNT, seen.size - COMMAND_GROUPS.flatMap(group => group.commands)
    .reduce((count, command) => count + (command.aliases?.length ?? 0), 0));
});

test('aliases resolve to one canonical command', () => {
  assert.equal(findCommand('/ram')?.name, '/gc');
  assert.equal(findCommand('/quit')?.name, '/exit');
  assert.equal(findCommand('/unknown'), undefined);
  assert.ok(commandNamesFor('cli').includes('/ram'));
});

test('surface catalogs expose the commands implemented by that surface', () => {
  const desktop = new Set(commandCatalog('desktop').map(command => command.name));
  assert.ok(desktop.has('/plan'));
  assert.ok(desktop.has('/ultracode'));
  assert.ok(desktop.has('/tokens'));
  assert.ok(desktop.has('/memory'));
  assert.ok(desktop.has('/remember'));
  assert.ok(desktop.has('/forget'));
  assert.ok(desktop.has('/doctor'));
  assert.ok(desktop.has('/effort'));
  assert.ok(desktop.has('/skills'));
  assert.ok(desktop.has('/sessions'));
  assert.ok(desktop.has('/resume'));
  assert.ok(desktop.has('/gui'));
  assert.ok(desktop.has('/bot'));
  assert.ok(desktop.has('/mcp'));

  const cli = new Set(commandCatalog('cli').map(command => command.name));
  assert.ok(cli.has('/doctor'));
  assert.ok(cli.has('/ram') === false, 'aliases are resolved through findCommand, not duplicated in the catalog');
  assert.ok(commandNamesFor('cli').includes('/ram'));
  assert.ok(cli.has('/bot'));
});

test('help text is generated from the same catalog', () => {
  const cliHelp = helpFor('cli');
  for (const command of commandsFor('cli')) assert.ok(cliHelp.includes(command.usage), `CLI help missing ${command.usage}`);
  const desktopHelp = helpFor('desktop');
  for (const command of commandsFor('desktop')) assert.ok(desktopHelp.includes(command.usage), `desktop help missing ${command.usage}`);
  assert.ok(desktopHelp.includes('Yalnızca CLI/TUI'));
});

test('ultracode distinguishes a mode toggle from a real workflow request', () => {
  assert.equal(isWorkflowInvocation('/ultracode'), false);
  assert.equal(isWorkflowInvocation('/ultracode', 'on'), false);
  assert.equal(isWorkflowInvocation('/ultracode', 'off'), false);
  assert.equal(isWorkflowInvocation('/ultracode', 'fix the failing build'), true);
  assert.equal(isWorkflowInvocation('/goal'), true);
  assert.equal(isWorkflowInvocation('/goal', 'status'), true);
  assert.equal(isWorkflowInvocation('/goal', 'ship the release'), true);
  assert.equal(isWorkflowInvocation('/plan', 'apply'), true);
  assert.equal(isWorkflowInvocation('/mcp', ''), true);
  assert.equal(isWorkflowInvocation('/tokens', ''), false);
});
