import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/growth_opportunity_forward_proof.mjs',
);
const officialProofRoot = path.join(
  organizationRoot,
  'quality',
  'proofs',
  'growth-opportunity-v02-forward-proof',
);

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function createIsolatedProof(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(officialProofRoot, root, { recursive: true });
  return root;
}

async function resignManifestFiles(root, relativePaths) {
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const relative of relativePaths) {
    const entry = manifest.files.find((item) => item.path === relative);
    assert.ok(entry, `manifest entry missing: ${relative}`);
    entry.sha256 = digest(await readFile(path.join(root, relative)));
  }
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
}

test('正向能力证据可重放且严格绑定基线、前测、候选与评分文件', async () => {
  assert.equal(
    typeof loaded.module?.verifyGrowthOpportunityForwardProof,
    'function',
    loaded.error?.message ?? 'forward proof verifier missing',
  );
  if (!loaded.module) return;
  const result = await loaded.module.verifyGrowthOpportunityForwardProof({
    proofRoot: officialProofRoot,
  });
  assert.deepEqual(result.baselineScore, {
    separatesFactsInferencesUnknowns: false,
    coversMarketDemandIndustryGrowthSpace: false,
    usesAttractivenessAndConfidence: true,
    definesCounterEvidence: true,
    hasBoundedExperiment: false,
    respectsOrganizationBoundaries: false,
  });
  assert.deepEqual(result.forwardScore, {
    separatesFactsInferencesUnknowns: true,
    coversMarketDemandIndustryGrowthSpace: true,
    usesAttractivenessAndConfidence: true,
    definesCounterEvidence: true,
    hasBoundedExperiment: true,
    respectsOrganizationBoundaries: true,
  });
});

test('删除或篡改任一正向证据文件会使验证失败', async (t) => {
  if (!loaded.module) return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-proof-tamper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(officialProofRoot, root, { recursive: true });
  await unlink(path.join(root, 'canonical-forward.md'));
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /missing|cannot be read|manifest/u,
  );
  await rm(root, { recursive: true, force: true });
  await cp(officialProofRoot, root, { recursive: true });
  const candidatePath = path.join(root, 'canonical-candidate.json');
  await writeFile(
    candidatePath,
    `${await readFile(candidatePath, 'utf8')}\n `,
    'utf8',
  );
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /SHA|hash|manifest/u,
  );
  await rm(root, { recursive: true, force: true });
  await cp(officialProofRoot, root, { recursive: true });
  await writeFile(
    path.join(root, 'canonical-scenario-input.txt'),
    'tampered canonical source\n',
    'utf8',
  );
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /SHA|hash|manifest/u,
  );
});

test('组织自检与共享检查点都纳管正向证据证明', async () => {
  const [selfCheck, generator] = await Promise.all([
    readFile(
      path.join(organizationRoot, 'scripts', 'organization_self_check.mjs'),
      'utf8',
    ),
    readFile(
      path.join(
        organizationRoot,
        'scripts',
        'generate_shared_runtime_checkpoint.mjs',
      ),
      'utf8',
    ),
  ]);
  assert.match(selfCheck, /growth-opportunity-v02-forward-proof/u);
  assert.match(generator, /growth-opportunity-v02-forward-proof/u);
});

test('关键词汤、标题堆砌与模板复制不能获得6/6', () => {
  if (!loaded.module) return;
  assert.equal(typeof loaded.module.scoreForwardMarkdown, 'function');
  const samples = [
    '已知事实 推断 关键未知 市场趋势 用户需求 行业机会 企业增长空间 吸引力 可信度 反证 有限实验 主指标 风险指标 停止条件 最长期限 awaiting_approval 不联系客户 不改价格 不自动执行',
    '# 已知事实\n# 推断\n# 关键未知\n# 市场趋势\n# 用户需求\n# 行业机会\n# 企业增长空间\n# 吸引力与可信度\n# 反证\n# 有限实验\n主指标 风险指标 停止条件 最长期限 awaiting_approval 不联系客户 不改价格 不自动执行',
    '## 已知事实\n<fact>\n## 推断\n<inference>\n## 关键未知\n<unknown>\n市场趋势 用户需求 行业机会 企业增长空间 吸引力 可信度 反证 有限实验 主指标 风险指标 停止条件 最长期限 awaiting_approval 不联系客户 不改价格 不自动执行',
  ];
  for (const sample of samples) {
    const score = loaded.module.scoreForwardMarkdown(sample, {});
    assert.equal(
      Object.values(score).every(Boolean),
      false,
      `bypass scored 6/6: ${sample}`,
    );
  }
  const repeated = `## 已知事实\n${'同一段事实内容。'.repeat(900)}\n`
    + `## 推断\n${'同一段事实内容。'.repeat(900)}\n`
    + `## 关键未知\n${'同一段事实内容。'.repeat(900)}\n`
    + '市场趋势 用户需求 行业机会 企业增长空间 吸引力 可信度 反证 有限实验 主指标 风险指标 停止条件 最长期限 awaiting_approval 不联系客户 不改价格 不自动执行';
  assert.equal(
    Object.values(
      loaded.module.scoreForwardMarkdown(repeated, {}),
    ).every(Boolean),
    false,
  );
});

test('score仅增加空白并重签manifest仍被固定字节SHA拒绝', async (t) => {
  if (!loaded.module) return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-score-whitespace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(officialProofRoot, root, { recursive: true });
  const scorePath = path.join(root, 'forward-score.json');
  await writeFile(
    scorePath,
    `${await readFile(scorePath, 'utf8')} `,
    'utf8',
  );
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files.find((item) => item.path === 'forward-score.json').sha256 =
    createHash('sha256').update(await readFile(scorePath)).digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /fixed canonical|score|SHA/u,
  );
});

test('attestation即使被伪造并重签manifest也必须拒绝', async (t) => {
  if (!loaded.module) return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-attestation-forge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(officialProofRoot, root, { recursive: true });
  const invocationPath = path.join(root, 'forward-invocation.json');
  const invocation = JSON.parse(await readFile(invocationPath, 'utf8'));
  invocation.attestationScope = 'forged-but-string';
  await writeFile(invocationPath, JSON.stringify(invocation), 'utf8');
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.files.find(
    (item) => item.path === 'forward-invocation.json',
  );
  const { createHash } = await import('node:crypto');
  entry.sha256 = createHash('sha256')
    .update(await readFile(invocationPath))
    .digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /attestation|invocation|isolation/u,
  );
});

test('协调篡改forward与resultDigest并重签manifest仍必须拒绝固定proof', async (t) => {
  if (!loaded.module) return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-proof-resign-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(officialProofRoot, root, { recursive: true });
  const forwardPath = path.join(root, 'canonical-forward.md');
  await writeFile(
    forwardPath,
    `${await readFile(forwardPath, 'utf8')}\n\n无关业务模型重复样本。`,
    'utf8',
  );
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const invocationPath = path.join(root, 'forward-invocation.json');
  const invocation = JSON.parse(await readFile(invocationPath, 'utf8'));
  invocation.resultDigest = hash(await readFile(forwardPath));
  await writeFile(invocationPath, JSON.stringify(invocation), 'utf8');
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [name, file] of [
    ['canonical-forward.md', forwardPath],
    ['forward-invocation.json', invocationPath],
  ]) {
    manifest.files.find((item) => item.path === name).sha256 =
      hash(await readFile(file));
  }
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /canonical|fixed|SHA/u,
  );
});

test('coordinated prompt, promptDigest, and manifest resign is rejected', async (t) => {
  if (!loaded.module) return;
  const root = await createIsolatedProof(t, 'growth-proof-prompt-resign-');
  const promptPath = path.join(root, 'exact-invocation-prompt.txt');
  await writeFile(
    promptPath,
    `${await readFile(promptPath, 'utf8')}\nforged instruction\n`,
    'utf8',
  );
  const invocationPath = path.join(root, 'forward-invocation.json');
  const invocation = JSON.parse(await readFile(invocationPath, 'utf8'));
  invocation.promptDigest = digest(await readFile(promptPath));
  await writeFile(invocationPath, JSON.stringify(invocation), 'utf8');
  await resignManifestFiles(root, [
    'exact-invocation-prompt.txt',
    'forward-invocation.json',
  ]);
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /canonical|fixed|prompt|SHA/u,
  );
});

test('coordinated canonical candidate and manifest resign is rejected', async (t) => {
  if (!loaded.module) return;
  const root = await createIsolatedProof(t, 'growth-proof-candidate-resign-');
  const candidatePath = path.join(root, 'canonical-candidate.json');
  const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
  candidate.scope.timeRange = 'forged replacement time range';
  await writeFile(candidatePath, JSON.stringify(candidate), 'utf8');
  await resignManifestFiles(root, ['canonical-candidate.json']);
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /canonical|fixed|candidate|SHA/u,
  );
});

test('resigned taskName and writerTask substitution is rejected', async (t) => {
  if (!loaded.module) return;
  const root = await createIsolatedProof(t, 'growth-proof-writer-resign-');
  const invocationPath = path.join(root, 'forward-invocation.json');
  const invocation = JSON.parse(await readFile(invocationPath, 'utf8'));
  invocation.taskName = '/root/forged_task';
  invocation.writerTask = '/root/forged_task';
  await writeFile(invocationPath, JSON.stringify(invocation), 'utf8');
  await resignManifestFiles(root, ['forward-invocation.json']);
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /invocation|task|writer|restrictions/u,
  );
});

test('resigned forbiddenPaths weakening is rejected', async (t) => {
  if (!loaded.module) return;
  const root = await createIsolatedProof(t, 'growth-proof-paths-resign-');
  const invocationPath = path.join(root, 'forward-invocation.json');
  const invocation = JSON.parse(await readFile(invocationPath, 'utf8'));
  invocation.forbiddenPaths = invocation.forbiddenPaths.slice(1);
  await writeFile(invocationPath, JSON.stringify(invocation), 'utf8');
  await resignManifestFiles(root, ['forward-invocation.json']);
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /forbidden|invocation|restrictions/u,
  );
});

test('independently resigned resultDigest substitution is rejected', async (t) => {
  if (!loaded.module) return;
  const root = await createIsolatedProof(t, 'growth-proof-result-resign-');
  const invocationPath = path.join(root, 'forward-invocation.json');
  const invocation = JSON.parse(await readFile(invocationPath, 'utf8'));
  invocation.resultDigest = '0'.repeat(64);
  await writeFile(invocationPath, JSON.stringify(invocation), 'utf8');
  await resignManifestFiles(root, ['forward-invocation.json']);
  await assert.rejects(
    loaded.module.verifyGrowthOpportunityForwardProof({ proofRoot: root }),
    /digest|invocation|restrictions/u,
  );
});
