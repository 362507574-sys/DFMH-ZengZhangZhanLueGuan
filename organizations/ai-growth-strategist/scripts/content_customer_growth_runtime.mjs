import path from 'node:path';

import {
  runContinuousActionSequence,
  writeTimelineFile,
} from '../../../scripts/browser_continuous_action_controller.mjs';
import { createCollaborationRequest } from './collaboration_contract.mjs';
import { createContentCustomerGrowthPlan } from './content_customer_growth_planner.mjs';
import { createGrowthRunStore } from './growth_run_store.mjs';
import { createGrowthWorkspacePaths } from './growth_workspace_paths.mjs';
import {
  runContentCustomerGrowthKnowledgePreflight,
} from './knowledge_preflight_adapter.mjs';
import { deepFreeze, readStrictJson } from './strict_json.mjs';

const BROWSER_STEPS = new Set([
  'short-video-plan',
  'xiaohongshu-plan',
  'permission-private-domain-plan',
]);

export async function initializeContentCustomerGrowthRuntime({
  projectRoot,
  task,
  collaborationRequests = [],
  executeKnowledgeCli,
} = {}) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new TypeError('content runtime task is required');
  }
  const store = await createGrowthRunStore({ projectRoot });
  const identity = {
    enterpriseId: task.enterpriseId,
    businessProjectId: task.businessProjectId,
    runId: task.runId,
  };
  let run;
  try {
    run = await store.read(identity);
  } catch (error) {
    if (!/state not found/iu.test(error?.message ?? '')) throw error;
    const now = new Date().toISOString();
    run = await store.initialize({
      schemaVersion: 1,
      ...identity,
      taskId: task.taskId,
      capabilityId: 'content-customer-growth',
      state: 'intake',
      sequence: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (run.taskId !== task.taskId) {
    throw new Error('content runtime existing run identity is inconsistent');
  }
  if (run.capabilityId === 'growth-basic-pipeline') {
    const workspacePaths = await createGrowthWorkspacePaths({ projectRoot });
    const manifest = await readStrictJson(path.join(
      workspacePaths.run(identity).root,
      'basic-run.json',
    ), {
      label: 'content runtime basic manifest',
      maxBytes: 2 * 1024 * 1024,
    });
    if (
      manifest.taskId !== task.taskId
      || !manifest.stages?.some(
        (stage) => stage.skillId === 'content-customer-growth',
      )
    ) {
      throw new Error('content runtime basic pipeline does not include this skill');
    }
  } else if (run.capabilityId !== 'content-customer-growth') {
    throw new Error('content runtime existing run identity is inconsistent');
  }
  const knowledge = await runContentCustomerGrowthKnowledgePreflight({
    projectRoot,
    task,
    executeCli: executeKnowledgeCli,
  });
  const plan = createContentCustomerGrowthPlan({ runId: task.runId });
  const validatedCollaborations = collaborationRequests.map(
    (request) => createCollaborationRequest(request),
  );
  return deepFreeze({
    run,
    plan,
    knowledge,
    collaborationRequests: validatedCollaborations,
  });
}

export async function runContentChannelBrowserSequence({
  projectRoot,
  identity,
  stepId,
  steps,
  context = {},
  now,
  sleep,
} = {}) {
  if (!BROWSER_STEPS.has(stepId)) {
    throw new Error('content browser stepId is invalid');
  }
  for (const field of [
    'enterpriseId',
    'businessProjectId',
    'taskId',
    'runId',
  ]) {
    if (typeof identity?.[field] !== 'string' || !identity[field].trim()) {
      throw new Error(`content browser identity.${field} is required`);
    }
  }
  const result = await runContinuousActionSequence({
    sequenceName: `content-customer-growth:${stepId}`,
    steps,
    context,
    ...(now === undefined ? {} : { now }),
    ...(sleep === undefined ? {} : { sleep }),
  });
  const identityRecord = {
    schemaVersion: 1,
    event: 'content_timeline_identity',
    enterpriseId: identity.enterpriseId,
    businessProjectId: identity.businessProjectId,
    taskId: identity.taskId,
    runId: identity.runId,
    stepId,
    controller: 'scripts/browser_continuous_action_controller.mjs',
  };
  const taskDirectory = path.resolve(
    projectRoot,
    'temp',
    'content-customer-growth',
    identity.enterpriseId,
    identity.businessProjectId,
    identity.taskId,
    identity.runId,
  );
  const outputPath = await writeTimelineFile({
    projectRoot,
    taskDirectory,
    fileName: `${stepId}.jsonl`,
    timeline: [identityRecord, ...result.timeline],
  });
  return deepFreeze({
    ...result,
    timelinePath: path.relative(projectRoot, outputPath)
      .split(path.sep)
      .join('/'),
  });
}
