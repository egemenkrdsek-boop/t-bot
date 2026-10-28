import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  capabilitiesAllowed,
  capabilitiesForTool,
  defaultCapabilities,
} from '../src/security/capabilities.js';
import { localToolDefinitions } from '../src/tools/index.js';

test('every local tool declares at least one capability', () => {
  for (const tool of localToolDefinitions) {
    assert.ok(capabilitiesForTool(tool.name).length > 0, `missing capability for ${tool.name}`);
  }
});

test('an unknown tool fails closed when a host allowlist is present', () => {
  assert.equal(capabilitiesAllowed('future_unclassified_tool', defaultCapabilities(false)), false);
  assert.equal(capabilitiesAllowed('future_unclassified_tool', undefined), true);
});

test('read-only capability sets deny writes, GUI and MCP operations', () => {
  const readOnly = defaultCapabilities(true);
  assert.equal(capabilitiesAllowed('file_read', readOnly), true);
  assert.equal(capabilitiesAllowed('file_write', readOnly), false);
  assert.equal(capabilitiesAllowed('shell', readOnly), false);
  assert.equal(capabilitiesAllowed('browser_open', readOnly), false);
  assert.equal(capabilitiesAllowed('mcp_call', readOnly), false);
  assert.equal(capabilitiesAllowed('checkpoint_list', readOnly), true);
  assert.equal(capabilitiesAllowed('checkpoint_restore', readOnly), false);
});
