import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/competitive_benchmark_fresh_provenance.mjs',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safePrompt =
  '仅创建 raw-forward.md 与 raw-candidate.json，除此之外不得创建任何文件';

async function isolatedDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cbv2-fresh-provenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'exact-invocation-prompt.txt'),
    safePrompt,
    'utf8',
  );
  return root;
}

test('fresh prompt静态拒绝sidecar、评分和正式证明词', () => {
  assert.equal(
    typeof loaded.module?.assertFreshRawWriterPrompt,
    'function',
    loaded.error?.message ?? 'fresh provenance gate missing',
  );
  if (!loaded.module) return;
  for (const forbidden of [
    'forward-score.json',
    'forward-invocation.json',
    'score',
    'proof',
    'manifest',
    'canonical',
    'sidecar',
    '评分',
    '证明',
  ]) {
    assert.throws(
      () => loaded.module.assertFreshRawWriterPrompt(`${safePrompt}\n${forbidden}`),
      /fresh prompt|forbidden/u,
      forbidden,
    );
  }
});

test('fresh prompt只正向授权两个raw文件', () => {
  if (!loaded.module) return;
  assert.equal(
    loaded.module.assertFreshRawWriterPrompt(safePrompt),
    safePrompt,
  );
  for (const weakened of [
    '创建 raw-forward.md 与 raw-candidate.json',
    '仅创建 raw-forward.md',
    '仅创建 raw-candidate.json',
  ]) {
    assert.throws(
      () => loaded.module.assertFreshRawWriterPrompt(weakened),
      /fresh prompt|exact raw outputs/u,
    );
  }
});

test('spawn前目录只能有父线程固定prompt且sidecar不存在', async (t) => {
  if (!loaded.module) return;
  const root = await isolatedDirectory(t);
  const promptBytes = await readFile(path.join(
    root,
    'exact-invocation-prompt.txt',
  ));
  const promptSha256 = digest(promptBytes);
  const checked = await loaded.module.assertFreshRawWriterDirectory({
    directory: root,
    phase: 'before_spawn',
    promptSha256,
  });
  assert.deepEqual(checked.files, ['exact-invocation-prompt.txt']);

  await writeFile(path.join(root, 'forward-score.json'), '{}', 'utf8');
  await assert.rejects(
    loaded.module.assertFreshRawWriterDirectory({
      directory: root,
      phase: 'before_spawn',
      promptSha256,
    }),
    /fresh directory|unexpected|sidecar/u,
  );
});

test('fresh结束及每轮修复目录严格为prompt加两raw且prompt SHA不变', async (t) => {
  if (!loaded.module) return;
  const root = await isolatedDirectory(t);
  const promptPath = path.join(root, 'exact-invocation-prompt.txt');
  const promptSha256 = digest(await readFile(promptPath));
  await writeFile(path.join(root, 'raw-forward.md'), '# raw', 'utf8');
  await writeFile(path.join(root, 'raw-candidate.json'), '{}', 'utf8');
  const checked = await loaded.module.assertFreshRawWriterDirectory({
    directory: root,
    phase: 'raw_complete',
    promptSha256,
  });
  assert.deepEqual(checked.files, [
    'exact-invocation-prompt.txt',
    'raw-candidate.json',
    'raw-forward.md',
  ]);

  await writeFile(promptPath, `${safePrompt}\nchanged`, 'utf8');
  await assert.rejects(
    loaded.module.assertFreshRawWriterDirectory({
      directory: root,
      phase: 'raw_complete',
      promptSha256,
    }),
    /prompt SHA/u,
  );
});

test('父线程仅在正式CLI0后生成sidecar且作者必须隔离', () => {
  if (!loaded.module) return;
  const base = {
    cliExitCode: 0,
    rawWriterTask: '/root/fresh-round2l',
    sidecarWriterTask: '/root/competitive_benchmark_v02_impl',
    rawCandidateSha256: 'a'.repeat(64),
    rawForwardSha256: 'b'.repeat(64),
  };
  const sidecars = loaded.module.buildParentSidecars(base);
  assert.equal(sidecars.invocation.rawWriterTask, base.rawWriterTask);
  assert.equal(
    sidecars.invocation.sidecarWriterTask,
    base.sidecarWriterTask,
  );
  assert.equal(sidecars.score.generatedAfterFormalCliExit0, true);

  assert.throws(
    () => loaded.module.buildParentSidecars({ ...base, cliExitCode: 1 }),
    /CLI exit 0/u,
  );
  assert.throws(
    () => loaded.module.buildParentSidecars({
      ...base,
      sidecarWriterTask: base.rawWriterTask,
    }),
    /writer isolation/u,
  );
});

test('Skill与Workflow固化raw writer和sidecar writer隔离顺序', async () => {
  const [skill, workflow] = await Promise.all([
    readFile(path.join(
      organizationRoot,
      'skills',
      'competitive-benchmark-analysis',
      'SKILL.md',
    ), 'utf8'),
    readFile(path.join(
      organizationRoot,
      'workflows',
      'COMPETITIVE_BENCHMARK_ANALYSIS.md',
    ), 'utf8'),
  ]);
  for (const [label, text] of [
    ['Skill', skill],
    ['Workflow', workflow],
  ]) {
    assert.match(text, /仅创建 `raw-forward\.md` 与 `raw-candidate\.json`/u, label);
    assert.match(text, /父线程.*正式 CLI.*退出0.*生成.*sidecar/isu, label);
    assert.match(text, /rawWriterTask.*sidecarWriterTask.*不得相同/isu, label);
  }
});
