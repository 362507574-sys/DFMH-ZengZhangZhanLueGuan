import path from 'node:path';

import { createProjectPaths } from '../../../scripts/control-center/project_paths.mjs';
import { requireSafeId } from '../../../scripts/control-center/project_contract.mjs';

export async function createGrowthWorkspacePaths({ projectRoot }) {
  const projects = await createProjectPaths({ projectRoot });

  return Object.freeze({
    run({ enterpriseId, businessProjectId, runId }) {
      const workspace = projects.organizationWorkspace(
        enterpriseId,
        businessProjectId,
        'ai-growth-strategist',
      );
      const safeRunId = requireSafeId(runId, 'runId');
      const root = path.join(workspace, 'runs', safeRunId);

      return Object.freeze({
        root,
        planFile: path.join(root, 'plan.json'),
        stateFile: path.join(root, 'state.json'),
        evidenceFile: path.join(root, 'evidence.json'),
        timelineFile: path.join(root, 'timeline.ndjson'),
        debugFile: path.join(root, 'debug.json'),
        approvalFile: path.join(root, 'approval.json'),
        reviewFile: path.join(workspace, 'reviews', `${safeRunId}.json`),
      });
    },
  });
}
