import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';
import { validateGrowthOpportunityV2Candidate } from '../scripts/growth_opportunity_v2_contract.mjs';

const skillRoot = path.join(
  organizationRoot,
  'skills',
  'growth-opportunity-analysis',
);
const templatePath = path.join(
  organizationRoot,
  'templates',
  'growth-opportunity-analysis.v2.json',
);
const demoPath = path.join(
  organizationRoot,
  'examples',
  'growth-opportunity-analysis.v2.demo.json',
);

test('v2 模板提供四支线、双层评价、反证与有界实验字段', async () => {
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  assert.equal(template.schemaVersion, 2);
  assert.deepEqual(
    template.analysisBranches.map((item) => item.id),
    [
      'market-trends',
      'user-demand',
      'industry-opportunity',
      'enterprise-growth-space',
    ],
  );
  assert.ok(Object.hasOwn(template.opportunities[0], 'counterEvidenceRefs'));
  assert.ok(Object.hasOwn(template.opportunities[0], 'attractiveness'));
  assert.ok(Object.hasOwn(template.opportunities[0], 'confidence'));
  assert.ok(Object.hasOwn(template.opportunities[0], 'experiment'));
});

test('v2 演示候选可被正式契约直接校验', async () => {
  const demo = JSON.parse(await readFile(demoPath, 'utf8'));
  const result = validateGrowthOpportunityV2Candidate(demo);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.status, 'candidate');
});

test('Skill v0.2.0 前置元数据只有 name 与 Use when description', async () => {
  const skill = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(skill);
  assert.ok(match, 'SKILL.md frontmatter missing');
  const keys = match[1]
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split(':', 1)[0]);
  assert.deepEqual(keys, ['name', 'description']);
  assert.match(match[1], /description:\s*Use when/u);
  assert.match(skill, /v0\.2\.0/u);
  for (const term of [
    'growth_opportunity_v2_contract.mjs',
    'growth_opportunity_planner.mjs',
    'growth_opportunity_debugger.mjs',
    'counterEvidenceRefs',
    'awaiting_approval',
    'artifactId@version',
  ]) {
    assert.match(skill, new RegExp(term.replace('.', '\\.'), 'u'));
  }
});

test('Skill 界面元数据与 v0.2 触发和默认提示一致', async () => {
  const yaml = await readFile(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
  assert.match(yaml, /display_name:\s*"增长机会分析"/u);
  assert.match(yaml, /short_description:\s*"[^"]{25,64}"/u);
  assert.match(yaml, /default_prompt:\s*".*\$growth-opportunity-analysis/u);
});

test('v0.2 Workflow 固化十二步、证据账本、调试和审批边界', async () => {
  const workflow = await readFile(
    path.join(organizationRoot, 'workflows', 'GROWTH_OPPORTUNITY_ANALYSIS.md'),
    'utf8',
  );
  for (const term of [
    'research-plan',
    'market-trends',
    'user-demand',
    'industry-opportunity',
    'enterprise-growth-space',
    'opportunity-pool',
    'priority-map',
    'experiments',
    'debug',
    'approval',
    '反证',
    '重试',
    '停止',
  ]) {
    assert.match(workflow, new RegExp(term, 'u'));
  }
});
