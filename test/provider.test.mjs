// 冒烟测试：不依赖 DSH，直接验证「包内 skills/ 能不能被 provider 正常列出与加载」。
// 运行: node test/provider.test.mjs
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBundledSkillProvider, BUNDLED_SKILL_RANK } from '../lib/provider.js';

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, '..', 'skills');

const warnings = [];
const provider = createBundledSkillProvider({ skillsDir, onWarn: (m) => warnings.push(m) });

const expected = [
  'blender-part',
  'makerworld-publish',
  'makerworld-session',
  'mw-listing-check',
  'mw-ship',
  'print-part-check',
];

const listed = await provider.list({});
const names = listed.map((s) => s.name).sort();

assert.deepEqual(names, expected, `列出的 skill 应为 ${expected.join(', ')}，实际 ${names.join(', ')}`);
assert.deepEqual(warnings, [], `不应有警告，实际: ${warnings.join(' | ')}`);

for (const candidate of listed) {
  assert.equal(candidate.provider, 'dsh-makerworld', `${candidate.name}: provider 名不对`);
  assert.equal(candidate.rank, BUNDLED_SKILL_RANK, `${candidate.name}: rank 不对`);
  assert.ok(candidate.description && candidate.description.length > 10, `${candidate.name}: description 太短`);
  assert.ok(candidate.resourceBase?.kind === 'directory', `${candidate.name}: resourceBase 不对`);

  const loaded = await provider.get(candidate, {});
  assert.ok(loaded, `${candidate.name}: get() 返回空`);
  assert.ok(loaded.content && loaded.content.length > 200, `${candidate.name}: 正文太短（${loaded.content?.length}）`);
  assert.ok(!loaded.content.startsWith('---'), `${candidate.name}: 正文里不该再带 frontmatter`);
}

// enabledSkills 过滤
const only = createBundledSkillProvider({ skillsDir, enabledSkills: ['mw-ship'] });
const onlyNames = (await only.list({})).map((s) => s.name);
assert.deepEqual(onlyNames, ['mw-ship'], 'enabledSkills 过滤没生效');

// 中止信号
assert.deepEqual(await provider.list({ signal: AbortSignal.abort() }), [], 'aborted lookup 应返回空');

console.log(`✅ ${listed.length} 个 skill 全部可列出、可加载，无警告`);
for (const candidate of listed) {
  const loaded = await provider.get(candidate, {});
  console.log(`   ${candidate.name.padEnd(22)} ${String(loaded.content.length).padStart(6)} 字符  ${candidate.description.slice(0, 28)}…`);
}
