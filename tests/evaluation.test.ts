import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateComponents } from '../scripts/evaluate-components.mjs';

test('offline evaluation is repeatable, discloses failures, and never fetches a provider', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network forbidden in offline evaluation'); };
  try {
    const first = await evaluateComponents();
    const second = await evaluateComponents();
    assert.equal(first.deterministicResultsSha256, second.deterministicResultsSha256);
    assert.equal(first.seedHex, '0x54424f54');
    assert.equal(first.offline, true);
    const sections = new Map(first.sections.map(section => [section.name, section]));
    assert.deepEqual([...sections.keys()], ['schema_selection', 'greeting_routing', 'context_window', 'repeated_source', 'unicode_editing', 'repo_query_retrieval']);
    const checks = first.sections.flatMap(section => section.checks);
    assert.ok(!checks.some(item => item.id === 'component_threw'));
    assert.equal(first.checks.total, checks.length);
    assert.equal(first.checks.failed, checks.filter(item => !item.pass).length);
    assert.equal(first.checks.criticalFailed, checks.filter(item => !item.pass && item.severity === 'critical').length);
    assert.equal(first.checks.qualityGatePassed, first.checks.criticalFailed === 0);
    assert.ok(sections.get('unicode_editing')!.negativeCases >= 6);
    assert.equal(sections.get('greeting_routing')!.workMisroutedToNoTools, 0);
    for (const name of ['context_window', 'repeated_source', 'unicode_editing']) {
      assert.ok(sections.get(name)!.checks.every(item => item.pass), `${name} invariants failed`);
    }
    for (const section of first.sections) {
      assert.ok(section.wallTimeMs >= 0);
      assert.equal(section.memoryBytes.peakMeasured, false);
    }
    assert.ok(first.claimScope.includes('Does not establish world rank'));
    assert.ok(first.missingEvidence.length >= 5);
    assert.ok(sections.get('schema_selection')!.cases.every(item => item.baselineSerializedBytes > 0 && item.selectedSchemaTokenRatio > 0));
  } finally { globalThis.fetch = previousFetch; }
});
