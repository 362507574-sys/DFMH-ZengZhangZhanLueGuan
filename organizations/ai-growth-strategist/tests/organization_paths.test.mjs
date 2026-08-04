import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, projectRoot } from './helpers.mjs';

const loaded = await optionalImport('scripts/organization_paths.mjs');

test('组织路径模块暴露安全路径入口', () => {
  assert.equal(
    typeof loaded.module?.createOrganizationPaths,
    'function',
    loaded.error?.message ?? 'createOrganizationPaths missing',
  );
});

test('企业、任务、候选、协作与回传路径固定在增长组织内', async () => {
  if (!loaded.module) return;
  const paths = await loaded.module.createOrganizationPaths({ projectRoot });
  const taskId = '20260728-001-growth-test';
  const candidate = paths.candidateFile(
    'demo-enterprise',
    taskId,
    'growth-opportunity-analysis',
    1,
  );
  assert.match(candidate, /ai-growth-strategist/u);
  assert.match(candidate, /demo-enterprise/u);
  assert.match(candidate, /growth-opportunity-analysis-v1\.json$/u);
  assert.equal(
    path.relative(paths.organizationRoot, candidate).startsWith('..'),
    false,
  );
  assert.throws(
    () => paths.taskFile('../escape', taskId),
    /invalid|unsafe/u,
  );
  assert.throws(
    () => paths.taskFile('demo-enterprise', '..\\escape'),
    /invalid|unsafe/u,
  );
});
