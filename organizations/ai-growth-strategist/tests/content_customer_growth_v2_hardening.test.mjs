import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as contentDebugger from '../scripts/content_customer_growth_debugger.mjs';
import { createBasicGrowthRunManager } from '../scripts/growth_basic_run_manager.mjs';
import {
  validateContentCustomerGrowthV2Candidate,
} from '../scripts/content_customer_growth_v2_contract.mjs';
import * as knowledgeAdapter from '../scripts/knowledge_preflight_adapter.mjs';
import { organizationRoot } from './helpers.mjs';

const runtimeModule = await import(
  '../scripts/content_customer_growth_runtime.mjs'
).catch(() => ({}));
const fixturePath = path.join(
  organizationRoot,
  'tests',
  'fixtures',
  'content-customer-growth-v2-valid.json',
);
const baseCandidate = JSON.parse(await readFile(fixturePath, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function contextFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-hardening-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidate = structuredClone(baseCandidate);
  const businessRoot = path.join(
    root,
    'business-projects',
    candidate.enterpriseId,
    candidate.businessProjectId,
  );
  const expectedUpstreamArtifacts = [];
  for (const artifact of candidate.scope.upstreamArtifacts) {
    const artifactPath = path.join(
      businessRoot,
      'shared-artifacts',
      artifact.artifactId,
      `v${artifact.version}.json`,
    );
    const bytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      status: 'published',
      artifactId: artifact.artifactId,
      version: artifact.version,
      enterpriseId: candidate.enterpriseId,
      businessProjectId: candidate.businessProjectId,
    }));
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, bytes);
    artifact.sha256 = sha256(bytes);
    artifact.path = path.relative(root, artifactPath).replaceAll('\\', '/');
    expectedUpstreamArtifacts.push({
      artifactId: artifact.artifactId,
      version: artifact.version,
      sha256: artifact.sha256,
    });
  }
  candidate.channelPlans.forEach((plan) => {
    plan.brandArtifact = structuredClone(candidate.scope.upstreamArtifacts[2]);
  });
  candidate.dealHandoff.sourceArtifact = structuredClone(
    candidate.scope.upstreamArtifacts[3],
  );
  const runRoot = path.join(
    businessRoot,
    'organizations',
    'ai-growth-strategist',
    'runs',
    candidate.runId,
  );
  const sourcePath = path.join(
    runRoot,
    'evidence',
    'knowledge-sources',
    'source-001.json',
  );
  const sourceBytes = Buffer.from('{"excerpt":"verified"}');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceBytes);
  const receiptPath = path.join(runRoot, 'evidence', 'knowledge-context.json');
  const receipt = {
    schemaVersion: 2,
    capabilityId: candidate.capabilityId,
    enterpriseId: candidate.enterpriseId,
    businessProjectId: candidate.businessProjectId,
    taskId: candidate.taskId,
    runId: candidate.runId,
    status: 'matched',
    sources: [{
      relativePath: path.relative(root, sourcePath).replaceAll('\\', '/'),
      sha256: sha256(sourceBytes),
    }],
    limitations: ['internal candidate only'],
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  await writeFile(receiptPath, receiptBytes);
  candidate.knowledgeContext = {
    status: 'matched',
    evidencePath: path.relative(root, receiptPath).replaceAll('\\', '/'),
    evidenceSha256: sha256(receiptBytes),
  };
  const trusted = {
    expectedIdentity: {
      enterpriseId: candidate.enterpriseId,
      businessProjectId: candidate.businessProjectId,
      taskId: candidate.taskId,
      runId: candidate.runId,
    },
    projectRoot: root,
    expectedUpstreamArtifacts,
    expectedKnowledgeReceipt: {
      relativePath: candidate.knowledgeContext.evidencePath,
      status: candidate.knowledgeContext.status,
      sha256: candidate.knowledgeContext.evidenceSha256,
    },
    expectedCommercePolicy: {
      priceStatus: 'finalized',
      refundRuleStatus: 'finalized',
    },
    referenceAt: '2026-07-31T00:00:00.000Z',
  };
  return { root, runRoot, candidate, trusted };
}

function mutate(value, change) {
  const copy = structuredClone(value);
  change(copy);
  return copy;
}

test('正式知识适配器生成 v2 项目运行凭证、来源快照和 SHA，同时保留旧入口', async (t) => {
  const {
    runContentCustomerGrowthKnowledgePreflight,
  } = knowledgeAdapter;
  assert.equal(typeof runContentCustomerGrowthKnowledgePreflight, 'function');
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-knowledge-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'organizations', 'ai-growth-strategist'), {
    recursive: true,
  });
  const task = {
    requestId: '20260731-001-content-task',
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260731-001-content',
    taskId: '20260731-001-content-task',
    runId: 'run-content-v2',
    capabilityId: 'content-customer-growth',
    text: '规划一个月三渠道内容、许可培育、成交交接与复购候选。',
    summary: '内容与客户增长 v0.2',
  };
  const result = await runContentCustomerGrowthKnowledgePreflight({
    projectRoot: root,
    task,
    executeCli: async ({ evidenceAbsolutePath }) => {
      await writeFile(evidenceAbsolutePath, JSON.stringify({
        schemaVersion: 1,
        requestId: task.requestId,
        capabilityId: task.capabilityId,
        status: 'matched',
        sources: [{
          spaceName: '老雷知识库',
          title: '许可式客户培育',
          url: 'https://example.invalid/doc',
          token: null,
          docType: 'docx',
          excerpt: '拒绝、退出或同意到期后立即停止。',
        }],
      }));
    },
  });
  assert.equal(result.receipt.schemaVersion, 2);
  assert.equal(result.receipt.businessProjectId, task.businessProjectId);
  assert.equal(result.receipt.sources.length, 1);
  assert.match(result.receipt.sources[0].sha256, /^[a-f0-9]{64}$/u);
  assert.match(
    result.binding.relativePath,
    /business-projects\/.+\/runs\/run-content-v2\/evidence\/knowledge-context\.json$/u,
  );
  assert.match(result.binding.sha256, /^[a-f0-9]{64}$/u);
});

test('知识来源目录 junction 不能逃出当前运行舱', async (t) => {
  const { root, runRoot, candidate, trusted } = await contextFixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'content-source-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const sourceDirectory = path.join(runRoot, 'evidence', 'knowledge-sources');
  await rm(sourceDirectory, { recursive: true, force: true });
  try {
    await symlink(
      outside,
      sourceDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EACCES', 'ENOSYS', 'EPERM'].includes(error?.code)) {
      t.skip(`directory link unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const outsideSource = path.join(outside, 'source-001.json');
  const outsideBytes = Buffer.from('{"excerpt":"escaped"}');
  await writeFile(outsideSource, outsideBytes);
  const receiptPath = path.resolve(
    root,
    candidate.knowledgeContext.evidencePath,
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  receipt.sources[0].sha256 = sha256(outsideBytes);
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  await writeFile(receiptPath, receiptBytes);
  candidate.knowledgeContext.evidenceSha256 = sha256(receiptBytes);
  trusted.expectedKnowledgeReceipt.sha256 = candidate
    .knowledgeContext.evidenceSha256;
  assert.throws(
    () => validateContentCustomerGrowthV2Candidate(candidate, trusted),
    /outside|trusted root|junction|link|运行舱|project/iu,
  );
});

test('价格或退款未定版时保留有效内容候选但阻断成交交接', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  trusted.expectedCommercePolicy = {
    priceStatus: 'not_finalized',
    refundRuleStatus: 'not_finalized',
  };
  candidate.dealHandoff.pricePolicyStatus = 'undecided';
  candidate.dealHandoff.refundPolicyStatus = 'undecided';
  if (typeof contentDebugger.createContentCustomerGrowthDebugReport === 'function') {
    candidate.debugReport = contentDebugger
      .createContentCustomerGrowthDebugReport(candidate);
  }
  const result = validateContentCustomerGrowthV2Candidate(candidate, trusted);
  assert.equal(result.dealHandoff.pricePolicyStatus, 'undecided');
  assert.equal(result.debugReport.status, 'blocked');
  assert.equal(
    result.debugReport.diagnostics.some(
      (item) => item.code === 'price_policy_not_finalized',
    ),
    true,
  );
});

test('被动信号不能成为明确询盘进入、成交交接或复购触发', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  for (const invalid of [
    mutate(candidate, (value) => {
      value.customerLifecycle[3].entrySignal = 'view';
    }),
    mutate(candidate, (value) => {
      value.dealHandoff.triggers = ['view'];
    }),
    mutate(candidate, (value) => {
      value.repurchase.eligibilitySignals = ['page view only'];
      value.repurchase.dealHandoffTrigger = 'any passive view';
    }),
  ]) {
    assert.throws(
      () => validateContentCustomerGrowthV2Candidate(invalid, trusted),
      /passive|view|explicit|主动|服务完成|复购|询盘|交接/iu,
    );
  }
});

test('投诉、退款、交付或退出冲突不能藏入复购资格', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  const conflicted = mutate(candidate, (value) => {
    value.repurchase.eligibilitySignals = [
      '主要服务完成',
      '客户主动表达进一步需求',
      '未解决投诉仍可复购',
      '产品与价格规则已确认',
    ];
  });
  assert.throws(
    () => validateContentCustomerGrowthV2Candidate(conflicted, trusted),
    /复购|complaint|投诉|conflict/iu,
  );
});

test('每个内容单元至少绑定两条证据且至少一条为事实', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  const one = mutate(candidate, (value) => {
    value.channelPlans[0].contentUnits[0].evidenceRefs = ['ev-brand'];
  });
  assert.throws(
    () => validateContentCustomerGrowthV2Candidate(one, trusted),
    /two|2|两条|evidence/iu,
  );
  const inferred = mutate(candidate, (value) => {
    value.evidence[0].type = 'inference';
    value.evidence[1].type = 'hypothesis';
  });
  assert.throws(
    () => validateContentCustomerGrowthV2Candidate(inferred, trusted),
    /fact|事实|evidence/iu,
  );
});

test('调试报告必须由真实诊断器生成，不能用任意 all-ok 伪造', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  const fabricated = mutate(candidate, (value) => {
    value.debugReport.status = 'passed';
    value.debugReport.remainingUnknowns = [];
    value.debugReport.channelLifecycleMatrix.forEach((cell) => {
      cell.status = 'green';
      cell.code = 'all-ok';
    });
    value.debugReport.diagnostics = [{
      code: 'all-ok',
      severity: 'info',
      field: 'anything',
      explanation: 'anything',
      recoveryAction: 'anything',
    }];
  });
  assert.throws(
    () => validateContentCustomerGrowthV2Candidate(fabricated, trusted),
    /debug|diagnostic|matrix|调试|诊断/iu,
  );
});

test('used 浏览器绑定必须存在共享控制器生成且身份匹配的时间线', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  const binding = candidate.browserTimelineBindings[0];
  binding.used = true;
  binding.timelinePath = [
    'temp',
    'content-customer-growth',
    candidate.enterpriseId,
    candidate.businessProjectId,
    candidate.taskId,
    candidate.runId,
    `${binding.stepId}.jsonl`,
  ].join('/');
  assert.throws(
    () => validateContentCustomerGrowthV2Candidate(candidate, trusted),
    /timeline|时间线|exist|file/iu,
  );
  await runtimeModule.runContentChannelBrowserSequence({
    projectRoot: trusted.projectRoot,
    identity: trusted.expectedIdentity,
    stepId: binding.stepId,
    steps: [{
      name: 'ready',
      condition: async () => true,
      timeoutMs: 100,
      pollIntervalMs: 10,
    }],
  });
  candidate.debugReport = contentDebugger
    .createContentCustomerGrowthDebugReport(candidate);
  assert.doesNotThrow(
    () => validateContentCustomerGrowthV2Candidate(candidate, trusted),
  );
});

test('内容运行入口实际初始化 run store、执行知识适配并校验协作契约', async (t) => {
  const {
    initializeContentCustomerGrowthRuntime,
  } = runtimeModule;
  assert.equal(typeof initializeContentCustomerGrowthRuntime, 'function');
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-runtime-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'organizations', 'ai-growth-strategist'), {
    recursive: true,
  });
  const task = {
    requestId: '20260731-001-content-task',
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260731-001-content',
    taskId: '20260731-001-content-task',
    runId: 'run-content-v2',
    capabilityId: 'content-customer-growth',
    text: '规划一个月三渠道内容、许可培育、成交交接与复购候选。',
    summary: '内容与客户增长 v0.2',
  };
  const collaborationRequests = [{
    schemaVersion: 1,
    contractVersion: 1,
    parentTaskId: task.taskId,
    requestId: 'request-brand-review',
    enterpriseId: task.enterpriseId,
    primaryOrganization: 'ai-growth-strategist',
    requestingOrganization: 'ai-growth-strategist',
    targetOrganization: 'ai-brand-officer',
    requestedCapability: 'brand-consistency-review',
    scope: '复核固定品牌版本下的内容表达，不修改品牌定位。',
    expectedOutcome: '返回带证据的品牌一致性复核结果。',
    evidenceRequirements: ['brand-brief@3', 'content candidate', 'claim refs'],
    accessEnvelope: {
      enterpriseId: task.enterpriseId,
      allowedScopes: [task.businessProjectId],
      deniedScopes: ['other-projects'],
    },
    constraints: {
      maxDelegationDepth: 1,
      externalWriteAllowed: false,
    },
    recursionDepth: 1,
    status: 'requested',
  }];
  const runtime = await initializeContentCustomerGrowthRuntime({
    projectRoot: root,
    task,
    collaborationRequests,
    executeKnowledgeCli: async ({ evidenceAbsolutePath }) => {
      await writeFile(evidenceAbsolutePath, JSON.stringify({
        schemaVersion: 1,
        requestId: task.requestId,
        capabilityId: task.capabilityId,
        status: 'no_hit',
        sources: [],
      }));
    },
  });
  assert.equal(runtime.run.state, 'intake');
  assert.equal(runtime.plan.executionOrder.length, 16);
  assert.equal(runtime.knowledge.receipt.schemaVersion, 2);
  assert.equal(runtime.collaborationRequests.length, 1);
  assert.equal(Object.isFrozen(runtime), true);
  const resumed = await initializeContentCustomerGrowthRuntime({
    projectRoot: root,
    task,
    collaborationRequests,
    executeKnowledgeCli: async ({ evidenceAbsolutePath }) => {
      await writeFile(evidenceAbsolutePath, JSON.stringify({
        schemaVersion: 1,
        requestId: task.requestId,
        capabilityId: task.capabilityId,
        status: 'no_hit',
        sources: [],
      }));
    },
  });
  assert.equal(resumed.run.createdAt, runtime.run.createdAt);
  assert.equal(resumed.run.sequence, 1);
});

test('内容专用运行时可沿用基础流水线的同一运行身份', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-basic-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'organizations', 'ai-growth-strategist'), {
    recursive: true,
  });
  const task = {
    requestId: '20260802-001-content-task',
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260802-001-content',
    taskId: '20260802-001-content-task',
    runId: 'run-content-basic',
    capabilityId: 'content-customer-growth',
    text: '规划内容与客户增长',
    summary: '内容与客户增长基础运行兼容测试',
  };
  const manager = await createBasicGrowthRunManager({ projectRoot: root });
  await manager.start({
    enterpriseId: task.enterpriseId,
    businessProjectId: task.businessProjectId,
    taskId: task.taskId,
    runId: task.runId,
    request: task.text,
  });

  const runtime = await runtimeModule.initializeContentCustomerGrowthRuntime({
    projectRoot: root,
    task,
    executeKnowledgeCli: async ({ evidenceAbsolutePath }) => {
      await writeFile(evidenceAbsolutePath, JSON.stringify({
        schemaVersion: 1,
        requestId: task.requestId,
        capabilityId: task.capabilityId,
        status: 'no_hit',
        sources: [],
      }));
    },
  });

  assert.equal(runtime.run.runId, task.runId);
  assert.equal(runtime.run.capabilityId, 'growth-basic-pipeline');
  assert.equal(runtime.plan.executionOrder.length, 16);
});

test('内容规划器为知识、渠道和浏览器步骤保留有界重试与合理超时', async () => {
  const module = await import('../scripts/content_customer_growth_planner.mjs');
  const plan = module.createContentCustomerGrowthPlan({
    runId: 'run-content-v2',
  });
  const byId = new Map(plan.steps.map((item) => [item.stepId, item]));
  for (const stepId of [
    'upstream-version-check',
    'short-video-plan',
    'xiaohongshu-plan',
    'permission-private-domain-plan',
  ]) {
    assert.equal(byId.get(stepId).maximumAttempts, 2, stepId);
    assert.equal(byId.get(stepId).timeoutMs, 15_000, stepId);
  }
});
