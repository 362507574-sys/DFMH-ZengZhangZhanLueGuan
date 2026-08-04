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
  'scripts/competitive_benchmark_forward_proof.mjs',
);
const officialProofRoot = path.join(
  organizationRoot,
  'quality',
  'proofs',
  'competitive-benchmark-v02-forward-proof',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function isolatedProof(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(officialProofRoot, root, { recursive: true });
  return root;
}

async function resign(root, relative) {
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.files.find((item) => item.path === relative);
  assert.ok(entry);
  entry.sha256 = digest(await readFile(path.join(root, relative)));
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
}

test('固定基线2/7提升为严格候选驱动的前向7/7', async () => {
  assert.equal(
    typeof loaded.module?.verifyCompetitiveBenchmarkForwardProof,
    'function',
    loaded.error?.message ?? 'competitive benchmark proof verifier missing',
  );
  if (!loaded.module) return;
  const result =
    await loaded.module.verifyCompetitiveBenchmarkForwardProof({
      proofRoot: officialProofRoot,
    });
  assert.deepEqual(result.baselineScore, {
    hasThreeDirectAndOneAlternative: false,
    separatesPublicFactsInferenceUnknowns: false,
    coversFiveLayers: false,
    avoidsPrivatePerformanceClaims: true,
    extractsMechanismBeforeAdaptation: true,
    passesCopyBrandIpChecks: false,
    createsOriginalExperiment: false,
  });
  assert.deepEqual(result.forwardScore, {
    hasThreeDirectAndOneAlternative: true,
    separatesPublicFactsInferenceUnknowns: true,
    coversFiveLayers: true,
    avoidsPrivatePerformanceClaims: true,
    extractsMechanismBeforeAdaptation: true,
    passesCopyBrandIpChecks: true,
    createsOriginalExperiment: true,
  });
  assert.equal(result.baselineTrueCount, 2);
  assert.equal(result.forwardTrueCount, 7);
});

test('删除任一证明文件使重放失败', async (t) => {
  if (!loaded.module) return;
  for (const relative of [
    'canonical-baseline.md',
    'canonical-forward.md',
    'canonical-candidate.json',
    'forward-score.json',
    'forward-invocation.json',
    'canonical-scenario-input.txt',
    'exact-invocation-prompt.txt',
  ]) {
    const root = await isolatedProof(t, `cbv2-delete-${relative.slice(0, 4)}-`);
    await unlink(path.join(root, relative));
    await assert.rejects(
      loaded.module.verifyCompetitiveBenchmarkForwardProof({
        proofRoot: root,
      }),
      /missing|cannot be read|manifest/u,
    );
  }
});

test('篡改forward或candidate后协调重签manifest仍被固定SHA拒绝', async (t) => {
  if (!loaded.module) return;
  for (const relative of [
    'canonical-forward.md',
    'canonical-candidate.json',
  ]) {
    const root = await isolatedProof(t, `cbv2-resign-${relative.slice(0, 4)}-`);
    const filePath = path.join(root, relative);
    await writeFile(
      filePath,
      `${await readFile(filePath, 'utf8')}\n篡改`,
      'utf8',
    );
    await resign(root, relative);
    await assert.rejects(
      loaded.module.verifyCompetitiveBenchmarkForwardProof({
        proofRoot: root,
      }),
      /fixed|canonical|SHA/u,
    );
  }
});

test('篡改score、invocation、source或prompt并重签仍被固定SHA拒绝', async (t) => {
  if (!loaded.module) return;
  for (const relative of [
    'forward-score.json',
    'forward-invocation.json',
    'canonical-scenario-input.txt',
    'exact-invocation-prompt.txt',
  ]) {
    const root = await isolatedProof(t, `cbv2-fixed-${relative.slice(0, 4)}-`);
    const filePath = path.join(root, relative);
    await writeFile(
      filePath,
      `${await readFile(filePath, 'utf8')}\n `,
      'utf8',
    );
    await resign(root, relative);
    await assert.rejects(
      loaded.module.verifyCompetitiveBenchmarkForwardProof({
        proofRoot: root,
      }),
      /fixed|canonical|SHA/u,
    );
  }
});

test('关键词汤、标题堆砌和模板复制不能获得7/7', async () => {
  if (!loaded.module) return;
  assert.equal(typeof loaded.module.scoreForwardMarkdown, 'function');
  const candidate = JSON.parse(await readFile(
    path.join(officialProofRoot, 'canonical-candidate.json'),
    'utf8',
  ));
  const samples = [
    '三个直接 一个替代 五层 公开事实 推断 未知 机制 适配 原创 反照抄 品牌 IP 实验 主指标 护栏 成本 停止',
    '# 定位\n# 产品策略\n# 内容机制\n# 获客渠道\n# 可观察客户路径\n名称 false 口号 false 14天 主指标 护栏 成本 停止',
    JSON.stringify(JSON.parse(await readFile(
      path.join(
        organizationRoot,
        'templates',
        'competitive-benchmark-analysis.v2.json',
      ),
      'utf8',
    ))),
  ];
  for (const sample of samples) {
    const score = loaded.module.scoreForwardMarkdown(sample, candidate);
    assert.equal(Object.values(score).every(Boolean), false);
  }
});

test('原始Markdown与严格候选由固定sidecar绑定且声明非密码学隔离', async () => {
  if (!loaded.module) return;
  const [forward, candidateBytes, invocation] = await Promise.all([
    readFile(path.join(officialProofRoot, 'canonical-forward.md'), 'utf8'),
    readFile(path.join(officialProofRoot, 'canonical-candidate.json')),
    readFile(
      path.join(officialProofRoot, 'forward-invocation.json'),
      'utf8',
    ).then(JSON.parse),
  ]);
  const candidateSha = digest(candidateBytes);
  assert.equal(invocation.rawResultDigest, digest(Buffer.from(forward, 'utf8')));
  assert.equal(
    invocation.canonicalForwardDigest,
    digest(Buffer.from(forward, 'utf8')),
  );
  assert.equal(invocation.canonicalCandidateDigest, candidateSha);
  assert.equal(invocation.forkTurns, 'none');
  assert.equal(invocation.readTests, false);
  assert.equal(invocation.readExamples, false);
  assert.equal(invocation.readTemplates, false);
  assert.equal(invocation.readBaseline, false);
  assert.equal(invocation.isCryptographicIsolationProof, false);
  assert.equal(
    invocation.attestationScope,
    'fixed-declaration-plus-root-spawn-record-non-cryptographic',
  );
});

test('formal proof来自同一fresh角色双原始输出并记录CLI exit0', async () => {
  const [forwardBytes, candidateBytes, invocation] = await Promise.all([
    readFile(path.join(officialProofRoot, 'canonical-forward.md')),
    readFile(path.join(officialProofRoot, 'canonical-candidate.json')),
    readFile(
      path.join(officialProofRoot, 'forward-invocation.json'),
      'utf8',
    ).then(JSON.parse),
  ]);
  assert.equal(invocation.schemaVersion, 2);
  assert.match(
    invocation.taskName,
    /competitive_benchmark_fresh_round2j$/u,
  );
  assert.equal(invocation.writerTask, invocation.taskName);
  assert.equal(invocation.forkTurns, 'none');
  assert.equal(invocation.rawForwardDigest, digest(forwardBytes));
  assert.equal(invocation.rawCandidateDigest, digest(candidateBytes));
  assert.equal(invocation.canonicalForwardDigest, digest(forwardBytes));
  assert.equal(invocation.canonicalCandidateDigest, digest(candidateBytes));
  assert.equal(invocation.cliValidation.exitCode, 0);
  assert.equal(invocation.allowedReads.length, 5);
  assert.ok(invocation.forbiddenReads.includes('tests'));
  assert.ok(invocation.forbiddenReads.includes('examples'));
  assert.ok(invocation.forbiddenReads.includes('templates'));
  assert.ok(invocation.forbiddenReads.includes('baselines'));
  assert.ok(invocation.forbiddenReads.includes('old-temp-and-proof'));
  assert.equal(invocation.isCryptographicIsolationProof, false);
  assert.match(invocation.attestationScope, /root-spawn-record/u);
  assert.equal(invocation.repairChain.length, 4);
  assert.equal(invocation.repairChain[0].exitCode, 1);
  assert.equal(invocation.repairChain[1].exitCode, 1);
  assert.equal(invocation.repairChain[2].exitCode, 1);
  assert.equal(invocation.repairChain[3].exitCode, 0);
  assert.deepEqual(invocation.classifierContract, {
    mode: 'anchored-context-routed-complete-statement-v3',
    regression:
      'organizations/ai-growth-strategist/tests/competitive_benchmark_v2_eighth_round.test.mjs',
    normalization: 'NFKC-strip-Cf-before-metric-detection',
    coverage: 'audit-all-business-text-including-no-metric-before-allow',
    allowModel: 'anchored-complete-consumption-no-word-bag',
    evidenceRouting:
      'public_fact-source-bound-observation-scope_fact-boundary-only',
    subjectPolicy: 'structured-sample-competitor-or-possessive-only',
    trimPolicy:
      'terminal-dot-question-exclamation-semicolon-whitespace-only-preserve-symbol-residue',
    hypothesisBoundary:
      'reject-external-business-rank-direction-value-before-exemptions',
    yearPolicy: 'only-explicit-as-of-for-19xx-20xx-is-non-business-value',
    attackFamilies: {
      noMetricExternal: 22,
      arbitraryChineseUnknownSubjects: 7,
      symbolResidue: 12,
      previousFixed: 65,
      deterministicFuzz: 256,
    },
  });
});

test('7项评分逐项绑定严格候选指针和Markdown具体内容', async () => {
  const [forward, score] = await Promise.all([
    readFile(path.join(officialProofRoot, 'canonical-forward.md'), 'utf8'),
    readFile(
      path.join(officialProofRoot, 'forward-score.json'),
      'utf8',
    ).then(JSON.parse),
  ]);
  const fields = [
    'hasThreeDirectAndOneAlternative',
    'separatesPublicFactsInferenceUnknowns',
    'coversFiveLayers',
    'avoidsPrivatePerformanceClaims',
    'extractsMechanismBeforeAdaptation',
    'passesCopyBrandIpChecks',
    'createsOriginalExperiment',
  ];
  assert.deepEqual(Object.keys(score.bindings).sort(), fields.sort());
  for (const field of fields) {
    const binding = score.bindings[field];
    assert.equal(typeof binding.candidatePointer, 'string');
    assert.ok(binding.candidatePointer.startsWith('/'));
    assert.equal(typeof binding.markdownNeedle, 'string');
    assert.ok(binding.markdownNeedle.length >= 8);
    assert.ok(forward.includes(binding.markdownNeedle), field);
  }
});

test('formal proof逐项绑定三条可信路径与receipt trusted flags', async () => {
  const [invocation, candidate, forward] = await Promise.all([
    readFile(path.join(officialProofRoot, 'forward-invocation.json'), 'utf8').then(JSON.parse),
    readFile(path.join(officialProofRoot, 'canonical-candidate.json'), 'utf8').then(JSON.parse),
    readFile(path.join(officialProofRoot, 'canonical-forward.md'), 'utf8'),
  ]);
  assert.deepEqual(invocation.trustedPaths, {
    upstream: candidate.scope.upstreamArtifact.path,
    receipt: candidate.knowledgeContext.evidencePath,
    source: candidate.evidence[0].sourcePath,
  });
  assert.deepEqual(invocation.trustedDigests, {
    upstreamSha256: candidate.scope.upstreamArtifact.sha256,
    receiptSha256: candidate.knowledgeContext.evidenceSha256,
    sourceSha256: candidate.evidence[0].sourceSha256,
  });
  assert.deepEqual(invocation.receiptSnapshot, {
    schemaVersion: 2,
    status: 'no_hit',
    sources: [],
  });
  for (const trustedPath of Object.values(invocation.trustedPaths)) {
    assert.match(trustedPath, /^business-projects\/ent-benchmark\/20260730-001-benchmark\//u);
    assert.ok(forward.includes(trustedPath), trustedPath);
  }
  for (const flag of [
    '--expected-upstream-artifact-id',
    '--expected-upstream-version',
    '--expected-upstream-sha256',
    '--expected-receipt-relative-path',
    '--expected-receipt-status',
    '--expected-receipt-sha256',
    '--reference-at',
  ]) {
    assert.ok(invocation.cliValidation.trustedFlagNames.includes(flag), flag);
  }
});
