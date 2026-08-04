import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

test('v2模板和异题演示明确3+1、五层与原创迁移结构', async () => {
  const [template, demo] = await Promise.all([
    readFile(
      path.join(
        organizationRoot,
        'templates',
        'competitive-benchmark-analysis.v2.json',
      ),
      'utf8',
    ).then(JSON.parse),
    readFile(
      path.join(
        organizationRoot,
        'examples',
        'competitive-benchmark-analysis.v2.demo.json',
      ),
      'utf8',
    ).then(JSON.parse),
  ]);
  assert.equal(template.schemaVersion, 2);
  assert.deepEqual(template.sampleKinds, { direct: 3, alternative: 1 });
  assert.deepEqual(template.fiveLayers, [
    'positioning',
    'productStrategy',
    'contentMechanism',
    'acquisitionChannels',
    'observableCustomerPath',
  ]);
  assert.deepEqual(template.knowledgeReceipt, {
    schemaVersion: 2,
    sourceFields: ['relativePath', 'sha256'],
    sourceRoot: 'evidence/knowledge-sources/',
    sourceShaRequired: true,
  });
  assert.equal(demo.schemaVersion, 2);
  assert.deepEqual(demo.knowledgeReceiptExample, {
    schemaVersion: 2,
    status: 'no_hit',
    sources: [],
    limitationRequired: true,
  });
  assert.equal(demo.samplePlan.filter((item) => item.kind === 'direct').length, 3);
  assert.equal(
    demo.samplePlan.filter((item) => item.kind === 'alternative').length,
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(demo),
    /A每周3篇|B每周5条|C每月1场/u,
  );
});

test('Skill frontmatter仅name和Use when description且版本为v0.2.0', async () => {
  const skill = await readFile(
    path.join(
      organizationRoot,
      'skills',
      'competitive-benchmark-analysis',
      'SKILL.md',
    ),
    'utf8',
  );
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1];
  assert.ok(frontmatter);
  const keys = frontmatter
    .split(/\r?\n/u)
    .map((line) => line.split(':', 1)[0]);
  assert.deepEqual(keys, ['name', 'description']);
  assert.match(frontmatter, /description:\s*Use when/u);
  assert.match(skill, /## 输入/u);
  assert.match(skill, /## 依赖/u);
  assert.match(skill, /v0\.2\.0/u);
  assert.match(skill, /missing_alternative_sample/u);
  assert.match(skill, /BROWSER_CONTINUOUS_ACTION_STANDARD/u);
});

test('Workflow严格列出14步与外部动作审批边界', async () => {
  const workflow = await readFile(
    path.join(
      organizationRoot,
      'workflows',
      'COMPETITIVE_BENCHMARK_ANALYSIS.md',
    ),
    'utf8',
  );
  const ordered = [
    'intake',
    'sample-plan',
    'source-collection',
    'source-validation',
    'positioning',
    'product-strategy',
    'content-mechanism',
    'acquisition-channels',
    'observable-customer-path',
    'mechanism-transfer',
    'enterprise-adaptation',
    'copy-brand-ip-check',
    'experiments',
    'approval',
  ];
  let previous = -1;
  for (const step of ordered) {
    const current = workflow.indexOf(step);
    assert.ok(current > previous, `${step} order is invalid`);
    previous = current;
  }
  assert.match(workflow, /不发布|发布.*审批/u);
  assert.match(workflow, /不.*联系客户|客户联系.*审批/u);
  assert.match(workflow, /designing\s*\/\s*acceptsFormalTasks=false/u);
});

test('Skill与Workflow固化外部expected upstream和浏览生产validator', async () => {
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
  for (const text of [skill, workflow]) {
    assert.match(text, /expected upstream|预期上游/u);
    assert.match(text, /expected-upstream-artifact-id/u);
    assert.match(text, /expected-receipt-relative-path/u);
    assert.match(text, /expected-receipt-status/u);
    assert.match(text, /expected-receipt-sha256/u);
    assert.match(text, /sources.*relativePath.*sha256/isu);
    assert.match(text, /schemaVersion.*数字 `2`|schemaVersion.*2/isu);
    assert.match(text, /逗号、顿号、冒号/u);
    assert.match(text, /validateBrowserResearchExecution/u);
    assert.match(text, /browser_continuous_action_controller\.mjs/u);
    assert.match(text, /future_source/u);
  }
  assert.match(skill, /evidence\.type.*public_fact.*scope_fact/u);
  assert.match(skill, /evidence\.appliesTo.*单个.*sampleId.*字符串/u);
});
