import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  createBasicGrowthPipeline,
  selectGrowthPipeline,
} from '../scripts/growth_basic_pipeline.mjs';

test('大白话明确先做对标再做内容增长时保留两个阶段的业务顺序', () => {
  assert.deepEqual(
    selectGrowthPipeline('继续竞争对标，做完交给内容与客户增长'),
    [
      'competitive-benchmark-analysis',
      'content-customer-growth',
    ],
  );
});

test('大白话明确先做机会再做对标时保留两个阶段的业务顺序', () => {
  assert.deepEqual(
    selectGrowthPipeline('分析下季度增长机会，完成后交给竞争对标继续'),
    [
      'growth-opportunity-analysis',
      'competitive-benchmark-analysis',
    ],
  );
});

test('基础入口按帝王大白话选择单技能或完整三技能', () => {
  assert.deepEqual(selectGrowthPipeline('分析下季度增长机会'), [
    'growth-opportunity-analysis',
  ]);
  assert.deepEqual(selectGrowthPipeline('拆解三个竞品和替代方案'), [
    'competitive-benchmark-analysis',
  ]);
  assert.deepEqual(selectGrowthPipeline('规划短视频、小红书和私域复购'), [
    'content-customer-growth',
  ]);
  assert.deepEqual(selectGrowthPipeline('建立完整获客增长方案'), [
    'growth-opportunity-analysis',
    'competitive-benchmark-analysis',
    'content-customer-growth',
  ]);
});

test('完整基础链固定按机会、对标、内容客户顺序交接', () => {
  const pipeline = createBasicGrowthPipeline({
    request: '建立完整获客增长方案',
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260731-001-growth-basic',
    taskId: '20260731-001-growth-basic-task',
  });
  assert.deepEqual(
    pipeline.stages.map((stage) => stage.skillId),
    [
      'growth-opportunity-analysis',
      'competitive-benchmark-analysis',
      'content-customer-growth',
    ],
  );
  assert.equal(
    pipeline.stages[1].requiredInputs.includes('growth-opportunity-brief'),
    true,
  );
  assert.equal(
    pipeline.stages[2].requiredInputs.includes('benchmark-mechanism-map'),
    true,
  );
  assert.deepEqual(
    pipeline.stages.map((stage) => stage.outputArtifact),
    [
      'growth-opportunity-brief',
      'benchmark-mechanism-map',
      'content-customer-growth-plan',
    ],
  );
});

test('基础安全层保留五项硬门禁且不抬升组织状态', () => {
  const pipeline = createBasicGrowthPipeline({
    request: '建立完整获客增长方案',
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260731-001-growth-basic',
    taskId: '20260731-001-growth-basic-task',
  });
  assert.equal(pipeline.safety.projectIdentityLocked, true);
  assert.equal(pipeline.safety.evidenceRequired, true);
  assert.equal(pipeline.safety.organizationBoundariesLocked, true);
  assert.equal(pipeline.safety.automaticCustomerContact, false);
  assert.equal(
    pipeline.safety.externalActions.every(
      (action) => (
        action.gate === 'awaiting_approval'
        && action.approvalId === null
      ),
    ),
    true,
  );
  assert.equal(pipeline.status, 'designing');
  assert.equal(pipeline.acceptsFormalTasks, false);
  assert.equal(Object.isFrozen(pipeline), true);
});

test('基础入口拒绝空目标和不安全项目身份', () => {
  assert.throws(
    () => selectGrowthPipeline(''),
    /request|目标|text/iu,
  );
  assert.throws(
    () => createBasicGrowthPipeline({
      request: '建立完整获客增长方案',
      enterpriseId: '../other',
      businessProjectId: '20260731-001-growth-basic',
      taskId: '20260731-001-growth-basic-task',
    }),
    /enterprise|identity|safe|企业/iu,
  );
});

test('基础版示例与运行结果一致且验收说明明确延期增强项', async () => {
  const organizationRoot = path.resolve(import.meta.dirname, '..');
  const demo = JSON.parse(await readFile(
    path.join(
      organizationRoot,
      'examples',
      'growth-basic-pipeline.demo.json',
    ),
    'utf8',
  ));
  const generated = createBasicGrowthPipeline({
    request: demo.request,
    ...demo.identity,
  });
  assert.deepEqual(demo, generated);
  const acceptance = await readFile(
    path.join(
      organizationRoot,
      'integration',
      'BASIC_THREE_LAYER_ACCEPTANCE.md',
    ),
    'utf8',
  );
  assert.match(acceptance, /业务层/u);
  assert.match(acceptance, /安全层/u);
  assert.match(acceptance, /验收层/u);
  assert.match(acceptance, /后续增强阶段/u);
  assert.match(acceptance, /awaiting_approval/u);
});

test('固定企业场景完整覆盖三技能、渠道上限与高风险阻断', async () => {
  const organizationRoot = path.resolve(import.meta.dirname, '..');
  const result = await readFile(
    path.join(
      organizationRoot,
      'integration',
      'BASIC_DEMO_RESULT.md',
    ),
    'utf8',
  );
  assert.match(result, /增长机会分析/u);
  assert.match(result, /竞争对标拆解/u);
  assert.match(result, /内容与客户增长/u);
  assert.match(result, /每周最多 5 条/u);
  assert.match(result, /每周最多 3 篇/u);
  assert.match(result, /每周最多 2 次/u);
  assert.match(result, /认知[\s\S]*兴趣[\s\S]*许可[\s\S]*培育[\s\S]*服务[\s\S]*复购/u);
  assert.match(result, /价格和退款规则尚未定版/u);
  assert.match(result, /禁止自动群发和主动联系/u);
  assert.match(result, /直接竞品 A[\s\S]*待采集/u);
  assert.match(result, /awaiting_approval/u);
});
