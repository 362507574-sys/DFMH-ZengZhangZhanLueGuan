import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
export const organizationRoot = path.join(
  projectRoot,
  'organizations',
  'ai-growth-strategist',
);

export async function optionalImport(relativePath) {
  const url = pathToFileURL(path.join(organizationRoot, relativePath)).href;
  try {
    return { module: await import(url), error: null };
  } catch (error) {
    return { module: null, error };
  }
}

export async function projectFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'control-center', 'registries', 'projects'), {
    recursive: true,
  });
  return root;
}

export function validRun() {
  return {
    schemaVersion: 1,
    enterpriseId: 'enterprise-1122334455667788',
    businessProjectId: '20260729-001-growth',
    taskId: '20260729-001-growth-task',
    runId: 'run-001',
    capabilityId: 'growth-opportunity-analysis',
    state: 'intake',
    sequence: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
}

export function step(stepId, dependsOn = []) {
  return {
    stepId,
    dependsOn,
    maximumAttempts: 1,
    timeoutMs: 1000,
    requiresApproval: false,
  };
}

export function validApproval() {
  return {
    schemaVersion: 1,
    approvalId: 'approval-001',
    runId: 'run-001',
    allowedActions: ['publish_content'],
    decision: 'approved',
    decidedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-30T00:00:00.000Z',
  };
}
