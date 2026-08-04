import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, projectRoot } from './helpers.mjs';

const loaded = await optionalImport('scripts/organization_config.mjs');

test('组织配置模块暴露严格加载入口', () => {
  assert.equal(
    typeof loaded.module?.loadOrganizationConfig,
    'function',
    loaded.error?.message ?? 'loadOrganizationConfig missing',
  );
});

test('真实配置保持 designing 且不能正式接单', async () => {
  if (!loaded.module) return;
  const value = await loaded.module.loadOrganizationConfig({ projectRoot });
  assert.equal(value.status, 'designing');
  assert.equal(value.acceptsFormalTasks, false);
  assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(
    value.coreSkills.map((item) => item.id),
    [
      'growth-opportunity-analysis',
      'competitive-benchmark-analysis',
      'content-customer-growth',
    ],
  );
});

test('配置拒绝额外字段和虚报 operational', async (t) => {
  if (!loaded.module) return;
  const root = await mkdtemp(path.join(tmpdir(), 'growth-config-'));
  const target = path.join(root, 'organizations', 'ai-growth-strategist', 'config');
  await mkdir(target, { recursive: true });
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, {
    recursive: true,
    force: true,
  })));
  const invalid = {
    schemaVersion: 1,
    id: 'ai-growth-strategist',
    displayName: 'AI增长战略官',
    systemName: '增长获客系统',
    deploymentMode: 'same_project_organization_module',
    status: 'operational',
    acceptsFormalTasks: true,
    rootControllerRegistration: 'registered_designing',
    formalTaskRouting: 'fallback_existing',
    peerOrganizationCalls: 'contract_only',
    coreSkills: [
      { id: 'growth-opportunity-analysis', name: '增长机会分析', status: 'designing' },
      { id: 'competitive-benchmark-analysis', name: '竞争对标拆解', status: 'designing' },
      { id: 'content-customer-growth', name: '内容与客户增长', status: 'designing' },
    ],
    publicSkillDependencies: [],
    unexpected: true,
  };
  await writeFile(
    path.join(target, 'organization.json'),
    `${JSON.stringify(invalid, null, 2)}\n`,
    'utf8',
  );
  await assert.rejects(
    loaded.module.loadOrganizationConfig({ projectRoot: root }),
    /unexpected|operational|正式/u,
  );
});
