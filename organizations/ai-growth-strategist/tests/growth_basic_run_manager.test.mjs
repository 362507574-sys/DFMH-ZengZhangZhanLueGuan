import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  createBasicGrowthRunManager,
  createBasicGrowthRunManagerForTest,
} from '../scripts/growth_basic_run_manager.mjs';
import { projectFixture } from './helpers.mjs';

const RUN_INPUT = Object.freeze({
  request: '建立完整获客增长方案',
  enterpriseId: 'enterprise-1122334455667788',
  businessProjectId: '20260731-002-growth-nightly',
  taskId: '20260731-002-growth-nightly-task',
  runId: 'run-nightly-001',
});

function identity() {
  return {
    enterpriseId: RUN_INPUT.enterpriseId,
    businessProjectId: RUN_INPUT.businessProjectId,
    runId: RUN_INPUT.runId,
  };
}

function payload(label) {
  return {
    title: label,
    facts: [],
    assumptions: [`${label}-assumption`],
    unknowns: [`${label}-unknown`],
  };
}

function runRoot(projectRoot) {
  return path.join(
    projectRoot,
    'business-projects',
    RUN_INPUT.enterpriseId,
    RUN_INPUT.businessProjectId,
    'organizations',
    'ai-growth-strategist',
    'runs',
    RUN_INPUT.runId,
  );
}

async function assertMissing(filePath) {
  await assert.rejects(
    readFile(filePath),
    (error) => error?.code === 'ENOENT',
  );
}

test('基础运行从大白话目标启动并持久化到首技能', async (t) => {
  const projectRoot = await projectFixture(t);
  const manager = await createBasicGrowthRunManager({ projectRoot });
  const started = await manager.start(RUN_INPUT);

  assert.equal(started.state, 'running_internal');
  assert.equal(started.nextSkillId, 'growth-opportunity-analysis');
  assert.equal(started.revision, 1);
  assert.deepEqual(
    started.stages.map((stage) => stage.status),
    ['pending', 'pending', 'pending'],
  );

  const resumed = await manager.status(identity());
  assert.deepEqual(resumed, started);
});

test('基础运行严格按三技能顺序生成不可覆盖成果', async (t) => {
  const projectRoot = await projectFixture(t);
  const manager = await createBasicGrowthRunManager({ projectRoot });
  await manager.start(RUN_INPUT);

  await assert.rejects(
    manager.submitStage({
      ...identity(),
      skillId: 'competitive-benchmark-analysis',
      payload: payload('benchmark'),
    }),
    /next|order|顺序/iu,
  );

  const first = await manager.submitStage({
    ...identity(),
    skillId: 'growth-opportunity-analysis',
    payload: payload('opportunity'),
  });
  assert.equal(first.artifact.version, 1);
  assert.match(first.artifact.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(first.nextSkillId, 'competitive-benchmark-analysis');

  await manager.submitStage({
    ...identity(),
    skillId: 'competitive-benchmark-analysis',
    payload: payload('benchmark'),
  });
  const final = await manager.submitStage({
    ...identity(),
    skillId: 'content-customer-growth',
    payload: payload('content'),
  });
  assert.equal(final.state, 'reviewing');
  assert.equal(final.nextSkillId, null);
  assert.deepEqual(
    final.stages.map((stage) => stage.status),
    ['completed', 'completed', 'completed'],
  );

  const artifactPath = path.join(projectRoot, first.artifact.relativePath);
  const stored = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(stored.payload.title, 'opportunity');
});

test('同组织下游成果自动绑定上游精确版本与哈希', async (t) => {
  const projectRoot = await projectFixture(t);
  const manager = await createBasicGrowthRunManager({ projectRoot });
  await manager.start({
    ...RUN_INPUT,
    request: '分析增长机会，完成后交给竞争对标继续',
  });
  const opportunity = await manager.submitStage({
    ...identity(),
    skillId: 'growth-opportunity-analysis',
    payload: payload('opportunity'),
  });
  const benchmark = await manager.submitStage({
    ...identity(),
    skillId: 'competitive-benchmark-analysis',
    payload: payload('benchmark'),
  });
  const stored = JSON.parse(await readFile(
    path.join(projectRoot, benchmark.artifact.relativePath),
    'utf8',
  ));

  assert.deepEqual(stored.upstreamArtifacts, [{
    artifactId: opportunity.artifact.artifactId,
    version: opportunity.artifact.version,
    relativePath: opportunity.artifact.relativePath,
    sha256: opportunity.artifact.sha256,
    createdAt: opportunity.artifact.createdAt,
  }]);
});

test('修改上游成果创建新版本并使下游重新执行', async (t) => {
  const projectRoot = await projectFixture(t);
  const manager = await createBasicGrowthRunManager({ projectRoot });
  await manager.start(RUN_INPUT);
  for (const [skillId, label] of [
    ['growth-opportunity-analysis', 'opportunity'],
    ['competitive-benchmark-analysis', 'benchmark'],
    ['content-customer-growth', 'content'],
  ]) {
    await manager.submitStage({ ...identity(), skillId, payload: payload(label) });
  }

  const revised = await manager.reviseStage({
    ...identity(),
    skillId: 'growth-opportunity-analysis',
    reason: '帝王调整了增长优先级',
    payload: payload('opportunity-v2'),
  });
  assert.equal(revised.state, 'running_internal');
  assert.equal(revised.artifact.version, 2);
  assert.equal(revised.nextSkillId, 'competitive-benchmark-analysis');
  assert.deepEqual(
    revised.stages.map((stage) => stage.status),
    ['completed', 'pending', 'pending'],
  );
  assert.equal(revised.stages[1].invalidatedBy, 'growth-opportunity-analysis@v2');

  const v1Path = path.join(
    projectRoot,
    'business-projects',
    RUN_INPUT.enterpriseId,
    RUN_INPUT.businessProjectId,
    'organizations',
    'ai-growth-strategist',
    'runs',
    RUN_INPUT.runId,
    'artifacts',
    'growth-opportunity-brief',
    'v1.json',
  );
  const v2Path = path.join(path.dirname(v1Path), 'v2.json');
  assert.equal(JSON.parse(await readFile(v1Path, 'utf8')).payload.title, 'opportunity');
  assert.equal(JSON.parse(await readFile(v2Path, 'utf8')).payload.title, 'opportunity-v2');
});

test('下游尚未执行时允许修改已完成对标并保留运行中状态', async (t) => {
  const projectRoot = await projectFixture(t);
  const manager = await createBasicGrowthRunManager({ projectRoot });
  await manager.start(RUN_INPUT);
  await manager.submitStage({
    ...identity(),
    skillId: 'growth-opportunity-analysis',
    payload: payload('opportunity'),
  });
  await manager.submitStage({
    ...identity(),
    skillId: 'competitive-benchmark-analysis',
    payload: payload('benchmark'),
  });

  const revised = await manager.reviseStage({
    ...identity(),
    skillId: 'competitive-benchmark-analysis',
    reason: '帝王要求在内容阶段开始前替换一个对标样本',
    payload: payload('benchmark-revised'),
  });

  assert.equal(revised.state, 'running_internal');
  assert.equal(revised.artifact.version, 2);
  assert.equal(revised.nextSkillId, 'content-customer-growth');
  assert.equal(revised.stages[2].status, 'pending');
});

test('新管理器可从磁盘恢复并生成精确版本交接包', async (t) => {
  const projectRoot = await projectFixture(t);
  const firstManager = await createBasicGrowthRunManager({ projectRoot });
  await firstManager.start(RUN_INPUT);
  await firstManager.submitStage({
    ...identity(),
    skillId: 'growth-opportunity-analysis',
    payload: payload('opportunity'),
  });

  const resumedManager = await createBasicGrowthRunManager({ projectRoot });
  const resumed = await resumedManager.status(identity());
  assert.equal(resumed.nextSkillId, 'competitive-benchmark-analysis');

  const handoff = await resumedManager.createHandoff({
    ...identity(),
    artifactId: 'growth-opportunity-brief',
    targetOrganization: 'ai-brand-officer',
    requestedCapability: 'brand-consistency-review',
    scope: '复核增长机会与既有品牌边界是否一致',
    expectedOutcome: '返回一致、有风险或需调整的有证据结论',
  });
  assert.equal(handoff.request.targetOrganization, 'ai-brand-officer');
  assert.equal(handoff.artifactBinding.artifactId, 'growth-opportunity-brief');
  assert.equal(handoff.artifactBinding.version, 1);
  assert.match(handoff.artifactBinding.sha256, /^[a-f0-9]{64}$/u);
  assert.match(handoff.relativePath, /handoffs\//u);
});

test('帝王验收后封闭运行且不允许原地改写', async (t) => {
  const projectRoot = await projectFixture(t);
  const manager = await createBasicGrowthRunManager({ projectRoot });
  await manager.start(RUN_INPUT);
  for (const [skillId, label] of [
    ['growth-opportunity-analysis', 'opportunity'],
    ['competitive-benchmark-analysis', 'benchmark'],
    ['content-customer-growth', 'content'],
  ]) {
    await manager.submitStage({ ...identity(), skillId, payload: payload(label) });
  }
  const accepted = await manager.accept(identity());
  assert.equal(accepted.state, 'completed');
  await assert.rejects(
    manager.reviseStage({
      ...identity(),
      skillId: 'content-customer-growth',
      reason: '尝试改写已验收结果',
      payload: payload('forbidden'),
    }),
    /completed|accepted|已验收/iu,
  );
});

test('最终验收状态已写但清单未写时重启可完成验收事务', async (t) => {
  const projectRoot = await projectFixture(t);
  let injected = false;
  const manager = await createBasicGrowthRunManagerForTest({
    projectRoot,
    testHooks: {
      afterAcceptStateTransition() {
        if (!injected) {
          injected = true;
          throw new Error('SIMULATED_CRASH_AFTER_ACCEPT_STATE_TRANSITION');
        }
      },
    },
  });
  await manager.start(RUN_INPUT);
  for (const [skillId, label] of [
    ['growth-opportunity-analysis', 'opportunity'],
    ['competitive-benchmark-analysis', 'benchmark'],
    ['content-customer-growth', 'content'],
  ]) {
    await manager.submitStage({ ...identity(), skillId, payload: payload(label) });
  }

  await assert.rejects(
    manager.accept(identity()),
    /SIMULATED_CRASH_AFTER_ACCEPT_STATE_TRANSITION/u,
  );
  const transactionFile = path.join(
    runRoot(projectRoot),
    'basic-accept-transaction.json',
  );
  assert.equal(
    JSON.parse(await readFile(transactionFile, 'utf8')).kind,
    'accept-run',
  );

  const resumedManager = await createBasicGrowthRunManager({ projectRoot });
  const resumed = await resumedManager.status(identity());
  assert.equal(resumed.state, 'completed');
  assert.match(resumed.acceptedAt, /^\d{4}-\d{2}-\d{2}T/u);
  await assertMissing(transactionFile);
});

test('成果已写但清单未写时重启可依据事务意图前滚', async (t) => {
  const projectRoot = await projectFixture(t);
  let injected = false;
  const manager = await createBasicGrowthRunManagerForTest({
    projectRoot,
    testHooks: {
      afterArtifactWrite({ skillId }) {
        if (!injected && skillId === 'growth-opportunity-analysis') {
          injected = true;
          throw new Error('SIMULATED_CRASH_AFTER_ARTIFACT_WRITE');
        }
      },
    },
  });
  await manager.start(RUN_INPUT);

  await assert.rejects(
    manager.submitStage({
      ...identity(),
      skillId: 'growth-opportunity-analysis',
      payload: payload('opportunity'),
    }),
    /SIMULATED_CRASH_AFTER_ARTIFACT_WRITE/u,
  );
  const transactionFile = path.join(runRoot(projectRoot), 'basic-transaction.json');
  assert.equal(
    JSON.parse(await readFile(transactionFile, 'utf8')).kind,
    'submit-stage',
  );

  const resumedManager = await createBasicGrowthRunManager({ projectRoot });
  const resumed = await resumedManager.status(identity());
  assert.equal(resumed.nextSkillId, 'competitive-benchmark-analysis');
  assert.equal(resumed.stages[0].latestVersion, 1);
  assert.match(resumed.stages[0].artifacts[0].sha256, /^[a-f0-9]{64}$/u);
  await assertMissing(transactionFile);
});

test('清单已写但状态未转时重启自动收敛到审核态', async (t) => {
  const projectRoot = await projectFixture(t);
  let injected = false;
  const manager = await createBasicGrowthRunManagerForTest({
    projectRoot,
    testHooks: {
      afterManifestWrite({ skillId }) {
        if (!injected && skillId === 'content-customer-growth') {
          injected = true;
          throw new Error('SIMULATED_CRASH_AFTER_MANIFEST_WRITE');
        }
      },
    },
  });
  await manager.start(RUN_INPUT);
  await manager.submitStage({
    ...identity(),
    skillId: 'growth-opportunity-analysis',
    payload: payload('opportunity'),
  });
  await manager.submitStage({
    ...identity(),
    skillId: 'competitive-benchmark-analysis',
    payload: payload('benchmark'),
  });
  await assert.rejects(
    manager.submitStage({
      ...identity(),
      skillId: 'content-customer-growth',
      payload: payload('content'),
    }),
    /SIMULATED_CRASH_AFTER_MANIFEST_WRITE/u,
  );

  const transactionFile = path.join(runRoot(projectRoot), 'basic-transaction.json');
  assert.equal(
    JSON.parse(await readFile(transactionFile, 'utf8')).kind,
    'submit-stage',
  );
  const resumedManager = await createBasicGrowthRunManager({ projectRoot });
  const resumed = await resumedManager.status(identity());
  assert.equal(resumed.state, 'reviewing');
  assert.equal(resumed.nextSkillId, null);
  assert.deepEqual(
    resumed.stages.map((stage) => stage.status),
    ['completed', 'completed', 'completed'],
  );
  await assertMissing(transactionFile);
});

test('中断后重复帝王原命令会恢复原运行而不是重建', async (t) => {
  const projectRoot = await projectFixture(t);
  let injected = false;
  const interruptedManager = await createBasicGrowthRunManagerForTest({
    projectRoot,
    testHooks: {
      afterArtifactWrite({ skillId }) {
        if (!injected && skillId === 'growth-opportunity-analysis') {
          injected = true;
          throw new Error('SIMULATED_RESTART_FROM_SAME_COMMAND');
        }
      },
    },
  });
  await interruptedManager.start(RUN_INPUT);
  await assert.rejects(
    interruptedManager.submitStage({
      ...identity(),
      skillId: 'growth-opportunity-analysis',
      payload: payload('opportunity'),
    }),
    /SIMULATED_RESTART_FROM_SAME_COMMAND/u,
  );

  const resumedManager = await createBasicGrowthRunManager({ projectRoot });
  const resumed = await resumedManager.start(RUN_INPUT);
  assert.equal(resumed.nextSkillId, 'competitive-benchmark-analysis');
  assert.equal(resumed.stages[0].latestVersion, 1);
  await assertMissing(path.join(runRoot(projectRoot), 'basic-transaction.json'));
});
