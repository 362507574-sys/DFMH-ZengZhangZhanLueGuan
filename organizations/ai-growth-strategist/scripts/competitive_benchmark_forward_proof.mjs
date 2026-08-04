import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';

import {
  validateCompetitiveBenchmarkV2Candidate,
} from './competitive_benchmark_v2_contract.mjs';
import { assertNoDuplicateJsonKeys } from './strict_json.mjs';

const PROOF_ID = 'competitive-benchmark-v02-forward-proof';
// Fixed trust root v2026-07-30. This is an immutable local proof seal, not a
// general signature system. Change only after a new independent forward run.
const FIXED_SHA256 = Object.freeze({
  'canonical-baseline.md':
    'e7653eef974a27e0783dd63ef4f35ad3729533f0da49c29db1949e8244b3593f',
  'canonical-candidate.json':
    '254b8a283557b97439ea25cc4f56c25666983080e62e9f80b7b38bfa18eb3e54',
  'canonical-forward.md':
    '408a96edf8211c1f298c0db025969fb24c70b08e09c986f9f116d1f839ea81c1',
  'canonical-scenario-input.txt':
    '825c6b61ece01e409e5d65c28a31fe12fa49c2e316e0adf99f13efef81f31ae9',
  'exact-invocation-prompt.txt':
    'fab380e8d0fd293c57da00317dc81f734ded3997295f89a3f432bd3bccdb6fea',
  'forward-invocation.json':
    'c44a184dab34bbca9b4f734b2e5bef7ab920e4c4a1cd1ab69c40564483ce2d2b',
  'forward-score.json':
    'a40784236261fe4ed023f4142eb9b7767f68a7f2ccca85a098c4ae9c3eea0c43',
});
const REQUIRED_FILES = Object.freeze(Object.keys(FIXED_SHA256));
const BASELINE_SOURCE = Object.freeze({
  markdown:
    'temp/growth-strategist-v02-implementation/baselines/competitive-benchmark-analysis.md',
  markdownSha256:
    '96e7c15faaa49e97fe8a0bcfefc1ab1047ebcaf0558d8cc4d6b1176c75e2c1b8',
  score:
    'temp/growth-strategist-v02-implementation/baselines/competitive-benchmark-analysis.score.json',
  scoreSha256:
    'aee653619d07de0dda2fc3ea4c1baf385c72779b791906dd79d392ff892aa7cc',
});
const SCORE_FIELDS = Object.freeze([
  'hasThreeDirectAndOneAlternative',
  'separatesPublicFactsInferenceUnknowns',
  'coversFiveLayers',
  'avoidsPrivatePerformanceClaims',
  'extractsMechanismBeforeAdaptation',
  'passesCopyBrandIpChecks',
  'createsOriginalExperiment',
]);
const FIVE_LAYERS = Object.freeze([
  'positioning',
  'productStrategy',
  'contentMechanism',
  'acquisitionChannels',
  'observableCustomerPath',
]);
const SCORE_BINDING_POINTERS = Object.freeze({
  hasThreeDirectAndOneAlternative: '/samples',
  separatesPublicFactsInferenceUnknowns: '/samples/0/layers',
  coversFiveLayers: '/samples/0/layers',
  avoidsPrivatePerformanceClaims: '/samples/0/privateUnknowns',
  extractsMechanismBeforeAdaptation: '/transfers/0/underlyingMechanism',
  passesCopyBrandIpChecks: '/transfers/0/antiCopyChecks',
  createsOriginalExperiment: '/transfers/0/experiment',
});

export async function verifyCompetitiveBenchmarkForwardProof({ proofRoot }) {
  const root = await canonicalDirectory(proofRoot, 'forward proof root');
  const manifest = parseJson(
    await readFile(await safeProofFile(root, 'manifest.json')),
    'forward proof manifest',
  );
  assertManifest(manifest);
  const manifestIndex = new Map(
    manifest.files.map((item) => [item.path, item.sha256]),
  );
  const contents = new Map();
  for (const relative of REQUIRED_FILES) {
    const bytes = await readFile(await safeProofFile(root, relative));
    const actual = sha256(bytes);
    if (manifestIndex.get(relative) !== actual) {
      throw new Error(`forward proof manifest SHA mismatch: ${relative}`);
    }
    if (FIXED_SHA256[relative] !== actual) {
      throw new Error(`fixed canonical proof SHA mismatch: ${relative}`);
    }
    contents.set(relative, bytes);
  }

  const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const baselineMarkdown = await readFixedProjectFile({
    projectRoot,
    relative: BASELINE_SOURCE.markdown,
    expectedSha: BASELINE_SOURCE.markdownSha256,
    label: 'original baseline Markdown',
  });
  const baselineScoreBytes = await readFixedProjectFile({
    projectRoot,
    relative: BASELINE_SOURCE.score,
    expectedSha: BASELINE_SOURCE.scoreSha256,
    label: 'independent baseline score',
  });
  const independentBaselineScore = parseJson(
    baselineScoreBytes,
    'independent baseline score',
  );
  const baselineScore = scoreBaselineMarkdown(
    baselineMarkdown.toString('utf8'),
  );
  assertIndependentBaselineScore(independentBaselineScore, baselineScore);

  const candidate = parseJson(
    contents.get('canonical-candidate.json'),
    'canonical candidate',
  );
  const validated = validateCompetitiveBenchmarkV2Candidate(candidate, {
    expectedIdentity: {
      enterpriseId: 'ent-benchmark',
      businessProjectId: '20260730-001-benchmark',
      taskId: 'task-benchmark',
      runId: 'run-benchmark',
    },
    projectRoot: path.join(
      projectRoot,
      'organizations',
      'ai-growth-strategist',
      'fixtures',
      'cbv2-proof-root',
    ),
    expectedUpstream: {
      artifactId: 'growth-opportunity-brief',
      version: 1,
      sha256:
        '16bb5e728dcca2bcc9ede982ba0c3ca2c182e404cefdf2336241f04563444022',
    },
    expectedKnowledgeReceipt: {
      relativePath:
        'business-projects/ent-benchmark/20260730-001-benchmark/organizations/ai-growth-strategist/runs/run-benchmark/evidence/knowledge-context.json',
      status: 'no_hit',
      sha256:
        '440a037e5f1ddbc20d8b24110e340b6ad943e1e3a60c42b7cec93096ede88863',
    },
    referenceAt: '2026-07-30T23:59:59.000Z',
  });
  const scenarioSha = sha256(contents.get('canonical-scenario-input.txt'));
  if (validated.evidence.some(
    (item) => item.sourceSha256 !== scenarioSha,
  )) {
    throw new Error('canonical source SHA does not bind every evidence item');
  }

  const forwardText = contents.get('canonical-forward.md').toString('utf8');
  const invocation = parseJson(
    contents.get('forward-invocation.json'),
    'forward invocation',
  );
  assertInvocation(invocation, {
    promptDigest: sha256(contents.get('exact-invocation-prompt.txt')),
    forwardDigest: sha256(contents.get('canonical-forward.md')),
    candidateDigest: sha256(contents.get('canonical-candidate.json')),
  });
  const forwardScore = scoreForwardMarkdown(forwardText, validated);
  if (!Object.values(forwardScore).every(Boolean)) {
    throw new Error('canonical candidate does not satisfy forward 7/7 checks');
  }

  const scoreRecord = parseJson(
    contents.get('forward-score.json'),
    'forward score record',
  );
  assertScoreRecord(scoreRecord, baselineScore, forwardScore, forwardText);
  return Object.freeze({
    baselineScore: Object.freeze(baselineScore),
    forwardScore: Object.freeze(forwardScore),
    baselineTrueCount: countTrue(baselineScore),
    forwardTrueCount: countTrue(forwardScore),
  });
}

export function scoreBaselineMarkdown(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('baseline Markdown is required');
  }
  const hasAlternative = /替代样本|显式替代|alternative/iu.test(text);
  const perSampleSeparation = ['A', 'B', 'C'].every((id) => {
    const section = sectionBetween(text, `${id}`, nextSample(id));
    return /公开事实/u.test(section)
      && /推断/u.test(section)
      && /未知/u.test(section);
  });
  const fiveLayers = [
    '定位',
    '产品策略',
    '内容机制',
    '获客渠道',
    '可观察客户路径',
  ].every((label) => text.includes(label));
  const privateUnknowns = /未使用任何外部资料/u.test(text)
    && /收入、利润、复购|购买率、营收、利润/u.test(text)
    && /不能据此断言|不能.*判断/u.test(text);
  const mechanismFirst = /闭环骨架|闭环机制/u.test(text)
    && /不应机械照搬|不是机械照抄|不建议.*照抄/u.test(text);
  const explicitAntiCopy = [
    '名称',
    '口号',
    '核心文案',
    '视觉身份',
    '案例',
    '品牌混淆',
    '知识产权',
  ].every((label) => text.includes(label));
  const boundedExperiment = /14\s*天/u.test(text)
    && /主指标/u.test(text)
    && /护栏指标/u.test(text)
    && /成本上限/u.test(text)
    && /停止条件/u.test(text);
  return {
    hasThreeDirectAndOneAlternative: hasAlternative,
    separatesPublicFactsInferenceUnknowns: perSampleSeparation,
    coversFiveLayers: fiveLayers,
    avoidsPrivatePerformanceClaims: privateUnknowns,
    extractsMechanismBeforeAdaptation: mechanismFirst,
    passesCopyBrandIpChecks: explicitAntiCopy,
    createsOriginalExperiment: boundedExperiment,
  };
}

export function scoreForwardMarkdown(text, candidate) {
  if (
    typeof text !== 'string'
    || sha256(Buffer.from(text, 'utf8'))
      !== FIXED_SHA256['canonical-forward.md']
    || !candidate
    || typeof candidate !== 'object'
  ) {
    return allFalseScore();
  }
  const direct = candidate.samples?.filter(
    (item) => item.kind === 'direct',
  ).length;
  const alternative = candidate.samples?.filter(
    (item) => item.kind === 'alternative',
  ).length;
  const layersComplete = candidate.samples?.every((sample) => (
    FIVE_LAYERS.every((layerId) => {
      const layer = sample.layers?.[layerId];
      return layer
        && layer.publicFacts?.length > 0
        && layer.inferences?.length > 0
        && layer.unknowns?.length > 0
        && layer.evidenceRefs?.length > 0;
    })
  )) === true;
  const separation = layersComplete
    && candidate.samples.every((sample) => sample.privateUnknowns.length > 0);
  const mechanismFirst = candidate.transfers?.every((transfer) => (
    nonEmpty(transfer.surfaceAction)
    && nonEmpty(transfer.underlyingMechanism)
    && transfer.surfaceAction.trim() !== transfer.underlyingMechanism.trim()
    && nonEmpty(transfer.enterpriseFit)
    && nonEmpty(transfer.originalImplementation)
  )) === true;
  const antiCopy = candidate.transfers?.every((transfer) => (
    [
      'copiesName',
      'copiesSlogan',
      'copiesCoreCopy',
      'copiesVisualIdentity',
      'copiesCases',
    ].every((field) => transfer.antiCopyChecks?.[field] === false)
    && transfer.antiCopyChecks.brandConfusionRisk === 'none'
    && transfer.antiCopyChecks.intellectualPropertyRisk === 'none'
  )) === true;
  const experiments = candidate.transfers?.every((transfer) => {
    const experiment = transfer.experiment;
    return nonEmpty(experiment?.metric)
      && experiment.secondaryMetrics?.length > 0
      && experiment.riskMetrics?.length > 0
      && experiment.maximumDays > 0
      && nonEmpty(experiment.maximumCost)
      && experiment.stopConditions?.length > 0
      && experiment.externalActions?.every((action) => [
        'analyze_evidence',
        'analyze_internal_data',
        'draft_internal_content',
        'internal_analysis',
        'measure_internal_metric',
        'review_internal_result',
      ].includes(action))
      && experiment.requiresApproval === false;
  }) === true;
  const publicScope = text.includes('不推断私有成交表现')
    && /外部动作：(0|无)/u.test(text)
    && candidate.samples.every((sample) => sample.privateUnknowns.length > 0);
  return {
    hasThreeDirectAndOneAlternative: direct === 3 && alternative === 1,
    separatesPublicFactsInferenceUnknowns: separation,
    coversFiveLayers: layersComplete,
    avoidsPrivatePerformanceClaims: publicScope,
    extractsMechanismBeforeAdaptation: mechanismFirst,
    passesCopyBrandIpChecks: antiCopy,
    createsOriginalExperiment: experiments,
  };
}

function assertManifest(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schemaVersion !== 1
    || value.proofId !== PROOF_ID
    || !Array.isArray(value.files)
    || value.files.length !== REQUIRED_FILES.length
  ) {
    throw new Error('forward proof manifest is invalid');
  }
  const seen = new Set();
  for (let index = 0; index < value.files.length; index += 1) {
    const item = value.files[index];
    if (
      !item
      || typeof item !== 'object'
      || Array.isArray(item)
      || Object.keys(item).join('|') !== 'path|sha256'
      || item.path !== REQUIRED_FILES[index]
      || !/^[0-9a-f]{64}$/u.test(item.sha256)
      || seen.has(item.path)
    ) {
      throw new Error('forward proof manifest file entry is invalid');
    }
    seen.add(item.path);
  }
}

function assertInvocation(value, expected) {
  if (
    value?.schemaVersion !== 2
    || value.proofId !== PROOF_ID
    || value.role !== 'independent-forward-business-role'
    || value.taskName
      !== '/root/competitive_benchmark_v02_impl/competitive_benchmark_fresh_round2j'
    || value.writerTask !== value.taskName
    || value.forkTurns !== 'none'
    || value.readSkill !== true
    || value.readWorkflow !== true
    || value.readTests !== false
    || value.readExamples !== false
    || value.readTemplates !== false
    || value.readBaseline !== false
    || value.readOldForward !== false
    || !Array.isArray(value.allowedReads)
    || value.allowedReads.length !== 5
    || !Array.isArray(value.forbiddenReads)
    || !['tests', 'examples', 'templates', 'baselines', 'old-temp-and-proof']
      .every((item) => value.forbiddenReads.includes(item))
    || value.promptDigest !== expected.promptDigest
    || value.rawResultDigest !== expected.forwardDigest
    || value.rawForwardDigest !== expected.forwardDigest
    || value.rawCandidateDigest !== expected.candidateDigest
    || value.canonicalForwardDigest !== expected.forwardDigest
    || value.canonicalCandidateDigest !== expected.candidateDigest
    || value.canonicalAugmentation
      !== 'three-bounded-field-repairs-synchronized-forward-and-candidate'
    || JSON.stringify(value.trustedPaths) !== JSON.stringify({
      upstream:
        'business-projects/ent-benchmark/20260730-001-benchmark/shared-artifacts/growth-opportunity-brief/v1.json',
      receipt:
        'business-projects/ent-benchmark/20260730-001-benchmark/organizations/ai-growth-strategist/runs/run-benchmark/evidence/knowledge-context.json',
      source:
        'business-projects/ent-benchmark/20260730-001-benchmark/organizations/ai-growth-strategist/runs/run-benchmark/evidence/sources/canonical-scenario-input.txt',
    })
    || JSON.stringify(value.trustedDigests) !== JSON.stringify({
      upstreamSha256:
        '16bb5e728dcca2bcc9ede982ba0c3ca2c182e404cefdf2336241f04563444022',
      receiptSha256:
        '440a037e5f1ddbc20d8b24110e340b6ad943e1e3a60c42b7cec93096ede88863',
      sourceSha256:
        '825c6b61ece01e409e5d65c28a31fe12fa49c2e316e0adf99f13efef81f31ae9',
    })
    || JSON.stringify(value.receiptSnapshot) !== JSON.stringify({
      schemaVersion: 2,
      status: 'no_hit',
      sources: [],
    })
    || JSON.stringify(value.classifierContract) !== JSON.stringify({
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
    })
    || value.isCryptographicIsolationProof !== false
    || value.attestationScope
      !== 'fixed-declaration-plus-root-spawn-record-non-cryptographic'
    || value.cliValidation?.exitCode !== 0
    || !Array.isArray(value.cliValidation.trustedFlagNames)
    || ![
      '--expected-upstream-artifact-id',
      '--expected-upstream-version',
      '--expected-upstream-sha256',
      '--expected-receipt-relative-path',
      '--expected-receipt-status',
      '--expected-receipt-sha256',
      '--reference-at',
    ].every((flag) => value.cliValidation.trustedFlagNames.includes(flag))
    || !Array.isArray(value.repairChain)
    || typeof value.writerSummary !== 'string'
    || !value.writerSummary
  ) {
    throw new Error('forward invocation restrictions or digests are invalid');
  }
}

function assertIndependentBaselineScore(value, scored) {
  const simplified = Object.fromEntries(
    SCORE_FIELDS.map((field) => [field, value.scores?.[field]?.value]),
  );
  if (
    value.trueCount !== 2
    || value.falseCount !== 5
    || JSON.stringify(simplified) !== JSON.stringify(scored)
  ) {
    throw new Error('independent baseline score is inconsistent');
  }
}

function assertScoreRecord(value, baselineScore, forwardScore, forwardText) {
  if (
    value?.schemaVersion !== 1
    || value.proofId !== PROOF_ID
    || JSON.stringify(value.baselineScore) !== JSON.stringify(baselineScore)
    || JSON.stringify(value.forwardScore) !== JSON.stringify(forwardScore)
    || value.baselineTrueCount !== countTrue(baselineScore)
    || value.forwardTrueCount !== countTrue(forwardScore)
    || typeof value.scoringBasis !== 'string'
    || !value.scoringBasis
    || !value.bindings
    || typeof value.bindings !== 'object'
    || Array.isArray(value.bindings)
  ) {
    throw new Error('forward score is not replayable from canonical artifacts');
  }
  for (const field of SCORE_FIELDS) {
    const binding = value.bindings[field];
    if (
      !binding
      || binding.candidatePointer !== SCORE_BINDING_POINTERS[field]
      || typeof binding.markdownNeedle !== 'string'
      || binding.markdownNeedle.length < 8
      || !forwardText.includes(binding.markdownNeedle)
    ) {
      throw new Error(`forward score binding is invalid: ${field}`);
    }
  }
}

async function safeProofFile(root, relative) {
  if (!REQUIRED_FILES.includes(relative) && relative !== 'manifest.json') {
    throw new Error('forward proof path is not allowlisted');
  }
  const candidate = path.resolve(root, relative);
  assertInside(root, candidate, 'forward proof file');
  const details = await lstat(candidate).catch(() => {
    throw new Error(`forward proof file is missing or cannot be read: ${relative}`);
  });
  if (
    !details.isFile()
    || details.isSymbolicLink()
    || details.size > 1024 * 1024
  ) {
    throw new Error(`forward proof file must be bounded and regular: ${relative}`);
  }
  const physical = await realpath(candidate);
  assertInside(root, physical, 'real forward proof file');
  return physical;
}

async function readFixedProjectFile({
  projectRoot,
  relative,
  expectedSha,
  label,
}) {
  const filePath = path.resolve(projectRoot, ...relative.split('/'));
  assertInside(projectRoot, filePath, label);
  const details = await lstat(filePath).catch(() => {
    throw new Error(`${label} is missing or cannot be read`);
  });
  if (
    !details.isFile()
    || details.isSymbolicLink()
    || details.size > 1024 * 1024
  ) {
    throw new Error(`${label} must be a bounded regular file`);
  }
  const physical = await realpath(filePath);
  assertInside(projectRoot, physical, `real ${label}`);
  const bytes = await readFile(physical);
  if (sha256(bytes) !== expectedSha) {
    throw new Error(`${label} fixed SHA mismatch`);
  }
  return bytes;
}

async function canonicalDirectory(value, label) {
  const details = await lstat(value).catch(() => {
    throw new Error(`${label} is missing or cannot be read`);
  });
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a safe directory`);
  }
  return realpath(value);
}

function parseJson(bytes, label) {
  const source = bytes.toString('utf8');
  assertNoDuplicateJsonKeys(source, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} JSON is invalid: ${error.message}`, {
      cause: error,
    });
  }
}

function sectionBetween(text, marker, next) {
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const end = next ? text.indexOf(next, start + marker.length) : -1;
  return text.slice(start, end < 0 ? text.length : end);
}

function nextSample(id) {
  if (id === 'A') return 'B';
  if (id === 'B') return 'C';
  return null;
}

function allFalseScore() {
  return Object.fromEntries(SCORE_FIELDS.map((field) => [field, false]));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function countTrue(value) {
  return Object.values(value).filter(Boolean).length;
}

function assertInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes its trusted root`);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
