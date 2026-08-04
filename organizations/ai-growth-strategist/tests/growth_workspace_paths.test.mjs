import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createGrowthWorkspacePaths } from '../scripts/growth_workspace_paths.mjs';
import { projectFixture } from './helpers.mjs';

function assertInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  assert.notEqual(relative, '..');
  assert.equal(relative.startsWith(`..${path.sep}`), false);
  assert.equal(path.isAbsolute(relative), false);
}

test('growth run paths stay inside the assigned business project', async (t) => {
  const root = await projectFixture(t);
  const paths = await createGrowthWorkspacePaths({ projectRoot: root });
  const value = paths.run({
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260729-001-growth',
    runId: 'run-001',
  });
  const project = path.join(
    root,
    'business-projects',
    'enterprise-1122334455667788',
    '20260729-001-growth',
  );
  const organizationWorkspace = path.join(
    project,
    'organizations',
    'ai-growth-strategist',
  );
  const runRoot = path.join(organizationWorkspace, 'runs', 'run-001');
  const runFiles = {
    planFile: 'plan.json',
    stateFile: 'state.json',
    evidenceFile: 'evidence.json',
    timelineFile: 'timeline.ndjson',
    debugFile: 'debug.json',
    approvalFile: 'approval.json',
  };

  assert.equal(value.root, runRoot);
  assert.equal(
    value.reviewFile,
    path.join(organizationWorkspace, 'reviews', 'run-001.json'),
  );
  for (const candidate of Object.values(value)) assertInside(project, candidate);
  for (const [key, fileName] of Object.entries(runFiles)) {
    assert.equal(value[key], path.join(runRoot, fileName));
    assertInside(runRoot, value[key]);
  }
});

test('growth workspace rejects traversal ids', async (t) => {
  const root = await projectFixture(t);
  const paths = await createGrowthWorkspacePaths({ projectRoot: root });
  assert.throws(() => paths.run({
    enterpriseId: '../other',
    businessProjectId: '20260729-001-growth',
    runId: 'run-001',
  }), /invalid|unsafe|escape/u);
});

test('growth workspace rejects traversal and absolute run ids', async (t) => {
  const root = await projectFixture(t);
  const paths = await createGrowthWorkspacePaths({ projectRoot: root });

  for (const runId of ['../escape', '..\\escape', path.resolve(root, 'escape')]) {
    assert.throws(() => paths.run({
      enterpriseId: 'enterprise-1122334455667788',
      businessProjectId: '20260729-001-growth',
      runId,
    }), /invalid|unsafe|escape/u);
  }
});
