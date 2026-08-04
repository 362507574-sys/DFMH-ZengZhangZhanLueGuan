import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

const read = (relativePath) => readFile(
  path.join(organizationRoot, relativePath),
  'utf8',
);

test('v0.2 Skill、Workflow 与 openai 配置固化六阶段、三渠道和审批边界', async () => {
  const [skill, workflow, openai] = await Promise.all([
    read('skills/content-customer-growth/SKILL.md'),
    read('workflows/CONTENT_CUSTOMER_GROWTH.md'),
    read('skills/content-customer-growth/agents/openai.yaml'),
  ]);
  for (const text of [skill, workflow]) {
    assert.match(text, /v0\.2\.0/u);
    for (const token of [
      'growth-opportunity-brief@version',
      'benchmark-mechanism-map@version',
      'brand-brief@version',
      'deal-handoff-contract@version',
      'anonymous-awareness',
      'active-interest',
      'consented-nurture',
      'explicit-inquiry',
      'service',
      'repurchase-candidate',
      'short-video',
      'xiaohongshu',
      'permission-private-domain',
      'awaiting_approval',
      'SHA-256',
      '14',
    ]) {
      assert.match(text, new RegExp(token, 'u'), token);
    }
  }
  assert.match(openai, /v0\.2/u);
  assert.match(openai, /精确.*版本.*SHA-256/u);
  assert.match(openai, /禁止自动群发|不得自动群发/u);
});

test('v0.2 模板和 demo 描述完整合同且仍为 designing', async () => {
  const [template, demo] = await Promise.all([
    read('templates/content-customer-growth.v2.json').then(JSON.parse),
    read('examples/content-customer-growth.v2.demo.json').then(JSON.parse),
  ]);
  assert.equal(template.schemaVersion, 2);
  assert.equal(template.capabilityId, 'content-customer-growth');
  assert.equal(template.templateOnly, true);
  assert.deepEqual(template.channels, [
    'short-video',
    'xiaohongshu',
    'permission-private-domain',
  ]);
  assert.equal(template.lifecycleStages.length, 6);
  assert.equal(template.dealHandoff.requiredFieldCount, 14);
  assert.equal(template.externalActionGate, 'awaiting_approval');
  assert.equal(demo.schemaVersion, 2);
  assert.equal(demo.capabilityId, 'content-customer-growth');
  assert.equal(demo.status, 'designing');
  assert.equal(demo.executedExternalActions.length, 0);
});

test('质量档案和固定运行清单精确纳入第三技能 v0.2 核心', async () => {
  const [profile, selfCheck] = await Promise.all([
    read('quality/organization-quality.json').then(JSON.parse),
    read('scripts/organization_self_check.mjs'),
  ]);
  assert.equal(profile.declaredRootStatus, 'designing');
  assert.equal(profile.acceptsFormalTasks, false);
  const skill = profile.skills.find(
    (item) => item.id === 'content-customer-growth',
  );
  for (const runtime of [
    'organizations/ai-growth-strategist/scripts/content_customer_growth_v2_contract.mjs',
    'organizations/ai-growth-strategist/scripts/content_customer_growth_planner.mjs',
    'organizations/ai-growth-strategist/scripts/content_customer_growth_debugger.mjs',
    'organizations/ai-growth-strategist/scripts/content_customer_growth_runtime.mjs',
  ]) {
    assert.equal(skill.runtimePaths.includes(runtime), true, runtime);
  }
  for (const testPath of [
    'organizations/ai-growth-strategist/tests/content_customer_growth_v2_contract.test.mjs',
    'organizations/ai-growth-strategist/tests/content_customer_growth_planner.test.mjs',
    'organizations/ai-growth-strategist/tests/content_customer_growth_debugger.test.mjs',
    'organizations/ai-growth-strategist/tests/content_customer_growth_cli_v2.test.mjs',
    'organizations/ai-growth-strategist/tests/content_customer_growth_v2_assets.test.mjs',
    'organizations/ai-growth-strategist/tests/content_customer_growth_v2_hardening.test.mjs',
  ]) {
    assert.equal(skill.testPaths.includes(testPath), true, testPath);
  }
  for (const asset of [
    'scripts/content_customer_growth_v2_contract.mjs',
    'scripts/content_customer_growth_planner.mjs',
    'scripts/content_customer_growth_debugger.mjs',
    'scripts/content_customer_growth_runtime.mjs',
    'tests/content_customer_growth_v2_contract.test.mjs',
    'tests/content_customer_growth_planner.test.mjs',
    'tests/content_customer_growth_debugger.test.mjs',
    'tests/content_customer_growth_cli_v2.test.mjs',
    'tests/content_customer_growth_v2_assets.test.mjs',
    'tests/content_customer_growth_v2_hardening.test.mjs',
    'templates/content-customer-growth.v2.json',
    'examples/content-customer-growth.v2.demo.json',
    'tests/fixtures/content-customer-growth-v2-valid.json',
    'tests/fixtures/content-customer-growth-v2-consent-failure.json',
  ]) {
    assert.match(selfCheck, new RegExp(asset.replaceAll('.', '\\.'), 'u'), asset);
  }
  assert.doesNotMatch(
    selfCheck,
    /content-customer-growth-v02-forward-proof/u,
  );
});
