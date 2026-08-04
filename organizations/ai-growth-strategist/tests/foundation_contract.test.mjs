import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { organizationRoot, projectRoot } from './helpers.mjs';

test('控制中心登记与增长组织配置使用帝王确认的三个技能', async () => {
  const registry = JSON.parse(await readFile(
    path.join(projectRoot, 'control-center', 'registries', 'organizations.json'),
    'utf8',
  ));
  const organization = registry.organizations.find(
    (item) => item.id === 'ai-growth-strategist',
  );
  assert.equal(organization.status, 'designing');
  assert.equal(organization.acceptsFormalTasks, false);
  assert.deepEqual(
    organization.coreSkills.map((item) => item.id),
    [
      'growth-opportunity-analysis',
      'competitive-benchmark-analysis',
      'content-customer-growth',
    ],
  );
  assert.ok(organization.coreSkills.every((item) => item.status === 'designing'));

  const config = JSON.parse(await readFile(
    path.join(organizationRoot, 'config', 'organization.json'),
    'utf8',
  ));
  assert.equal(config.id, organization.id);
  assert.deepEqual(config.coreSkills, organization.coreSkills);
});

test('增长组织章程明确三个技能、共同复盘和正式接单门槛', async () => {
  const charter = await readFile(path.join(organizationRoot, 'ORGANIZATION.md'), 'utf8');
  for (const expected of [
    '增长机会分析',
    '竞争对标拆解',
    '内容与客户增长',
    '共同闭环',
    'designing',
    'acceptsFormalTasks=false',
  ]) {
    assert.match(charter, new RegExp(expected, 'u'));
  }
});
