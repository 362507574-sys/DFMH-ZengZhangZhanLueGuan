import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';

import { assertNoDuplicateJsonKeys } from './strict_json.mjs';
import {
  validateGrowthOpportunityV2Candidate,
} from './growth_opportunity_v2_contract.mjs';

const PROOF_ID = 'growth-opportunity-v02-forward-proof';
// Canonical proof trust root v2026-07-30. Update only after an approved
// independent rerun, then change artifacts, manifest, tests and these hashes
// together. These constants are not a general-purpose signature mechanism.
const CANONICAL_V20260730_SHA256 = Object.freeze({
  'exact-invocation-prompt.txt':
    '3a8248da01ff5376dce23004f91e7b4927efa5e39621ac775759091493de2ba4',
  'canonical-forward.md':
    '413af217dafb9556c07b4d7ad287ee27cb273399d59c3fb28b6a63edf04a8160',
  'canonical-candidate.json':
    '1f1c3ae878bd29e032f24dc1fa373328df06c0c1703e9db30cfd259e2050863b',
  'forward-score.json':
    'fbeed4e9d1b75210651d4f32f72991f6ccefaeac816002a59b94c4e9303d05f1',
});
const REQUIRED_FILES = Object.freeze([
  'canonical-baseline.md',
  'canonical-forward.md',
  'canonical-candidate.json',
  'forward-score.json',
  'forward-invocation.json',
  'canonical-scenario-input.txt',
  'exact-invocation-prompt.txt',
]);
const SCORE_FIELDS = Object.freeze([
  'separatesFactsInferencesUnknowns',
  'coversMarketDemandIndustryGrowthSpace',
  'usesAttractivenessAndConfidence',
  'definesCounterEvidence',
  'hasBoundedExperiment',
  'respectsOrganizationBoundaries',
]);

export async function verifyGrowthOpportunityForwardProof({ proofRoot }) {
  const root = await realpath(proofRoot).catch(() => {
    throw new Error('forward proof root is missing or cannot be read');
  });
  const manifest = await readJson(
    await safeProofFile(root, 'manifest.json'),
    'forward proof manifest',
  );
  assertManifest(manifest);
  const manifestIndex = new Map(
    manifest.files.map((item) => [item.path, item.sha256]),
  );
  const contents = new Map();
  for (const relative of REQUIRED_FILES) {
    if (!manifestIndex.has(relative)) {
      throw new Error(`forward proof manifest is missing ${relative}`);
    }
    const filePath = await safeProofFile(root, relative);
    const bytes = await readFile(filePath);
    const actual = sha256(bytes);
    if (actual !== manifestIndex.get(relative)) {
      throw new Error(`forward proof manifest SHA mismatch: ${relative}`);
    }
    contents.set(relative, bytes);
  }
  for (const [relative, expectedSha] of Object.entries(
    CANONICAL_V20260730_SHA256,
  )) {
    if (sha256(contents.get(relative)) !== expectedSha) {
      throw new Error(`fixed canonical proof SHA mismatch: ${relative}`);
    }
  }

  const baselineText = contents.get('canonical-baseline.md').toString('utf8');
  const forwardText = contents.get('canonical-forward.md').toString('utf8');
  assertCanonicalScenario(baselineText, 'canonical baseline');
  assertCanonicalScenario(forwardText, 'canonical forward');

  const candidate = parseJsonBytes(
    contents.get('canonical-candidate.json'),
    'canonical candidate',
  );
  const invocation = parseJsonBytes(
    contents.get('forward-invocation.json'),
    'forward invocation',
  );
  assertInvocation(invocation, {
    promptDigest: sha256(contents.get('exact-invocation-prompt.txt')),
    resultDigest: sha256(contents.get('canonical-forward.md')),
  });
  const validated = validateGrowthOpportunityV2Candidate(candidate, {
    expectedIdentity: {
      enterpriseId: 'ent-proof',
      businessProjectId: '20260730-001-proof',
      taskId: 'task-proof',
      runId: 'run-proof',
    },
    projectRoot: path.resolve(
      import.meta.dirname,
      '..',
      'fixtures',
      'gov2-proof-root',
    ),
  });
  assertCanonicalScenario(JSON.stringify(validated), 'canonical candidate');
  const scenarioBytes = contents.get('canonical-scenario-input.txt');
  const scenarioSha = sha256(scenarioBytes);
  if (validated.evidence.some((item) => (
    item.sourceReference !== 'canonical-scenario-input.txt'
    || item.sourceSha256 !== scenarioSha
  ))) {
    throw new Error('canonical evidence source SHA does not match source packet');
  }

  const scoreRecord = parseJsonBytes(
    contents.get('forward-score.json'),
    'forward score',
  );
  const baselineScore = scoreBaselineMarkdown(baselineText);
  const forwardScore = scoreForwardMarkdown(forwardText, validated);
  if (Object.values(forwardScore).some((state) => !state)) {
    throw new Error('canonical candidate does not satisfy machine proof checks');
  }
  if (JSON.stringify(scoreRecord.baselineScore) !== JSON.stringify(baselineScore)
    || JSON.stringify(scoreRecord.forwardScore) !== JSON.stringify(forwardScore)) {
    throw new Error('forward score is not replayable from canonical artifacts');
  }
  return Object.freeze({
    baselineScore: Object.freeze(baselineScore),
    forwardScore: Object.freeze(forwardScore),
  });
}

export function scoreBaselineMarkdown(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('growth opportunity Markdown is required');
  }
  const section = (heading) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = text.match(new RegExp(
      `(?:^|\\n)#{2,4}\\s*(?:\\d+\\.\\s*)?${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{2,4}\\s|$)`,
      'u',
    ));
    return match?.[1]?.trim() ?? '';
  };
  const substantive = (content, minimum = 80) => (
    content.length >= minimum
    && !/<(?:fact|inference|unknown|[^>]+)>/iu.test(content)
    && /[。；：]/u.test(content)
  );
  const facts = section('已知事实');
  const inferences = section('推断');
  const unknowns = section('关键未知');
  const branches = [
    '市场趋势',
    '用户需求',
    '行业机会',
    '企业增长空间',
  ].map(section);
  const hasReadableExperiment = /### 实验一/u.test(text)
    && text.includes('**主指标：**')
    && text.includes('**风险指标：**')
    && text.includes('**停止条件：**')
    && /\*\*(?:最长期限与成本边界|期限与成本边界)：\*\*/u.test(text)
    && substantive(section('实验一：经营诊断主题对照'), 300);
  return {
    separatesFactsInferencesUnknowns:
      substantive(facts)
      && substantive(inferences)
      && substantive(unknowns),
    coversMarketDemandIndustryGrowthSpace:
      branches.every((content) => substantive(content)),
    usesAttractivenessAndConfidence: (
      (
        /\*\*吸引力判断：\*\*/u.test(text)
        && /\*\*可信度判断：\*\*/u.test(text)
        && substantive(
          section('机会一：验证经营诊断主题的稳定互动与报名承接'),
          300,
        )
      )
      || substantive(section('吸引力与可信度分开判断'), 150)
    ),
    definesCounterEvidence:
      (
        (text.match(/\*\*反证：\*\*/gu)?.length ?? 0) >= 2
        && /点击差异可能|归因/u.test(text)
      )
      || substantive(section('反证与未知'), 200),
    hasBoundedExperiment: hasReadableExperiment,
    respectsOrganizationBoundaries:
      text.includes('awaiting_approval')
      && text.includes('不联系客户')
      && text.includes('不改价格')
      && /(?:不自动执行|只提出实验)/u.test(text),
  };
}

export function scoreForwardMarkdown(text, validatedCandidate) {
  if (typeof text !== 'string'
    || sha256(Buffer.from(text, 'utf8'))
      !== CANONICAL_V20260730_SHA256['canonical-forward.md']) {
    return Object.fromEntries(SCORE_FIELDS.map((field) => [field, false]));
  }
  return scoreCandidate(validatedCandidate);
}

function scoreCandidate(candidate) {
  const evidenceTraceability = candidate.evidence.every((item) => (
    item.sourceReference
    && item.sourceVersion
    && /^[0-9a-f]{64}$/u.test(item.sourceSha256)
    && item.observedAt
    && item.appliesTo
  ));
  const fourBranchCompleteness = candidate.analysisBranches
    .map((item) => item.id)
    .join('|') === [
      'market-trends',
      'user-demand',
      'industry-opportunity',
      'enterprise-growth-space',
    ].join('|');
  const evidenceIndex = new Map(
    candidate.evidence.map((item) => [item.id, item]),
  );
  const counterEvidence = candidate.opportunities.every((item) => (
    item.counterEvidenceRefs.length > 0
    && item.counterEvidenceRefs.every(
      (reference) => evidenceIndex.get(reference)?.polarity === 'counter',
    )
    && item.counterEvidenceRefs.every(
      (reference) => !item.evidenceRefs.includes(reference),
    )
  ));
  const dualEvaluation = candidate.priorityMap.every((entry) => {
    const opportunity = candidate.opportunities.find(
      (item) => item.id === entry.opportunityId,
    );
    return opportunity
      && entry.attractiveness === opportunity.attractiveness.total
      && entry.confidence === opportunity.confidence.grade;
  });
  const boundedExperiment = candidate.opportunities.every((item) => (
    item.experiment.metric
    && item.experiment.maximumDays > 0
    && item.experiment.maximumCost
    && item.experiment.stopConditions.length > 0
    && item.experiment.requiresApproval === true
  ));
  const boundarySafety = Object.values(candidate.boundaryChecks).every(
    (state) => state === false,
  );
  return {
    separatesFactsInferencesUnknowns:
      evidenceTraceability
      && candidate.analysisBranches.every(
        (branch) => branch.inferences.length && branch.unknowns.length,
      ),
    coversMarketDemandIndustryGrowthSpace: fourBranchCompleteness,
    usesAttractivenessAndConfidence: dualEvaluation,
    definesCounterEvidence: counterEvidence,
    hasBoundedExperiment: boundedExperiment,
    respectsOrganizationBoundaries: boundarySafety,
  };
}

function assertManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 1 || value.proofId !== PROOF_ID
    || !Array.isArray(value.files)
    || value.files.length !== REQUIRED_FILES.length) {
    throw new Error('forward proof manifest is invalid');
  }
  const seen = new Set();
  for (const item of value.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).join('|') !== 'path|sha256'
      || !REQUIRED_FILES.includes(item.path)
      || !/^[0-9a-f]{64}$/u.test(item.sha256)
      || seen.has(item.path)) {
      throw new Error('forward proof manifest file entry is invalid');
    }
    seen.add(item.path);
  }
}

function assertInvocation(value, expected) {
  const expectedForbidden = [
    'organizations/ai-growth-strategist/tests',
    'organizations/ai-growth-strategist/examples',
    'organizations/ai-growth-strategist/templates',
    'temp/growth-strategist-v02-implementation/forward',
  ];
  if (!value || typeof value !== 'object'
    || value.role !== 'independent-forward-evaluator'
    || value.readTests !== false
    || value.readExamples !== false
    || value.readTemplates !== false
    || value.readOldForward !== false
    || value.baselineUsedSkill !== false
    || value.forwardUsedSkill !== true
    || !Array.isArray(value.forbiddenPaths)
    || JSON.stringify(value.forbiddenPaths) !== JSON.stringify(expectedForbidden)
    || value.taskName !==
      '/root/growth_opportunity_v02_impl/canonical_forward_proof'
    || value.writerTask !== value.taskName
    || value.promptDigest !== expected.promptDigest
    || value.resultDigest !== expected.resultDigest
    || value.isCryptographicIsolationProof !== false
    || value.attestationScope !== 'fixed_declaration_integrity_only') {
    throw new Error('forward invocation restrictions are invalid');
  }
}

function assertCanonicalScenario(text, label) {
  const hasCanonicalValues = text.includes('2000')
    && text.includes('18%')
    && text.includes('7%')
    && text.includes('240')
    && text.includes('96')
    && text.includes('14');
  if (!hasCanonicalValues || text.includes('其他主题9%')
    || text.includes('有效咨询24')) {
    throw new Error(`${label} does not use the approved canonical scenario`);
  }
}

async function safeProofFile(root, relative) {
  if (!REQUIRED_FILES.includes(relative) && relative !== 'manifest.json') {
    throw new Error('forward proof path is not allowlisted');
  }
  const candidate = path.resolve(root, relative);
  const relation = path.relative(root, candidate);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error('forward proof path escapes proof root');
  }
  const details = await lstat(candidate).catch(() => {
    throw new Error(`forward proof file is missing or cannot be read: ${relative}`);
  });
  if (!details.isFile() || details.isSymbolicLink() || details.size > 1024 * 1024) {
    throw new Error(`forward proof file must be a bounded regular file: ${relative}`);
  }
  const physical = await realpath(candidate);
  const physicalRelation = path.relative(root, physical);
  if (physicalRelation.startsWith('..') || path.isAbsolute(physicalRelation)) {
    throw new Error('forward proof file resolves outside proof root');
  }
  return physical;
}

async function readJson(filePath, label) {
  return parseJsonBytes(await readFile(filePath), label);
}

function parseJsonBytes(bytes, label) {
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
