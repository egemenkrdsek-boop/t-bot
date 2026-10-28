import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_SKILLS, buildSkillPrompt, DEFAULT_SKILL_KERNEL, resolveSkills } from '../src/skills.js';

test('the default J-Space kernel is compact and available to the agent', () => {
  assert.match(DEFAULT_SKILL_KERNEL, /\[J-SPACE DEFAULT KERNEL\]/);
  assert.match(DEFAULT_SKILL_KERNEL, /Architect/);
  assert.match(DEFAULT_SKILL_KERNEL, /\[V\]/);
  assert.ok(DEFAULT_SKILL_KERNEL.length < 2_500, 'kernel must stay small for per-turn use');
});

test('the full J-Space skill is hidden from user-facing lists', () => {
  const skill = BUILTIN_SKILLS.find(item => item.id === 'jspace');
  assert.ok(skill);
  assert.equal(skill.hidden, true);
  assert.match(skill.guidance, /Ultra J-Space Reasoning Engine/);
  assert.equal(BUILTIN_SKILLS.filter(item => !item.hidden).some(item => item.id === 'jspace'), false);
});

test('casual messages do not activate the full skill or any builtin', () => {
  assert.deepEqual(resolveSkills('Merhaba, nasılsın?', process.cwd()), []);
  assert.deepEqual(resolveSkills('Hello there', process.cwd()), []);
});

test('the full skill loads only through an explicit J-Space trigger', () => {
  const explicit = resolveSkills('/jspace review this architecture', process.cwd());
  assert.ok(explicit.some(skill => skill.id === 'jspace'));
  const prompted = resolveSkills('Use deep reasoning for this complex architecture', process.cwd());
  assert.ok(prompted.some(skill => skill.id === 'jspace'));
  const prompt = buildSkillPrompt(['jspace'], process.cwd());
  assert.match(prompt, /Ultra J-Space Reasoning Engine/);
  assert.match(prompt, /Quad-Stream/);
});
