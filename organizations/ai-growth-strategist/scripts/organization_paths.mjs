import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const STABLE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const TASK_ID = /^[0-9]{8}-[0-9]{3}-[a-z0-9-]{3,80}$/u;
const VERSION = /^[1-9][0-9]{0,8}$/u;
const CAPABILITIES = new Set([
  'growth-opportunity-analysis',
  'competitive-benchmark-analysis',
  'content-customer-growth',
]);

export async function createOrganizationPaths({ projectRoot } = {}) {
  const root = await canonicalDirectory(projectRoot, 'projectRoot');
  const organizationRoot = path.join(root, 'organizations', 'ai-growth-strategist');
  const direct = await lstat(organizationRoot).catch((error) => {
    throw new Error(`organization root does not exist: ${error.message}`, { cause: error });
  });
  if (direct.isSymbolicLink()) throw new Error('organization root must not be a symbolic link');
  const canonicalOrganizationRoot = await canonicalDirectory(organizationRoot, 'organizationRoot');
  assertInside(root, canonicalOrganizationRoot, 'organization root');

  const bounded = (...segments) => {
    const candidate = path.join(canonicalOrganizationRoot, ...segments);
    assertInside(canonicalOrganizationRoot, candidate, 'organization path');
    return candidate;
  };
  const stable = (value, label) => {
    if (typeof value !== 'string' || !STABLE_ID.test(value)) {
      throw new Error(`${label} is invalid or unsafe`);
    }
    return value;
  };
  const task = (value) => {
    if (typeof value !== 'string' || !TASK_ID.test(value)) {
      throw new Error('taskId is invalid or unsafe');
    }
    return value;
  };
  const capability = (value) => {
    if (!CAPABILITIES.has(value)) throw new Error('capabilityId is invalid');
    return value;
  };
  const version = (value) => {
    const normalized = String(value);
    if (!VERSION.test(normalized)) throw new Error('version is invalid');
    return normalized;
  };
  const request = (value) => stable(value, 'requestId');
  return Object.freeze({
    organizationRoot: canonicalOrganizationRoot,
    enterpriseProfile: (enterpriseId) => bounded(
      'enterprises',
      stable(enterpriseId, 'enterpriseId'),
      'profile.json',
    ),
    taskRoot: (enterpriseId, taskId) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
    ),
    taskFile: (enterpriseId, taskId) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
      'task.json',
    ),
    knowledgeEvidenceFile: (enterpriseId, taskId) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
      'evidence',
      'knowledge_context.json',
    ),
    candidateFile: (enterpriseId, taskId, capabilityId, value) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
      'candidates',
      `${capability(capabilityId)}-v${version(value)}.json`,
    ),
    acceptanceFile: (enterpriseId, taskId, capabilityId, value) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
      'acceptance',
      `${capability(capabilityId)}-v${version(value)}.json`,
    ),
    collaborationRequestFile: (enterpriseId, taskId, requestId) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
      'collaboration',
      'requests',
      `${request(requestId)}.json`,
    ),
    collaborationResultFile: (enterpriseId, taskId, requestId) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
      'collaboration',
      'results',
      `${request(requestId)}.json`,
    ),
    returnPackageFile: (enterpriseId, taskId) => bounded(
      'tasks',
      stable(enterpriseId, 'enterpriseId'),
      task(taskId),
      'return-package.json',
    ),
  });
}

async function canonicalDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  const canonical = await realpath(value).catch((error) => {
    throw new Error(`${label} does not exist: ${error.message}`, { cause: error });
  });
  if (!(await stat(canonical)).isDirectory()) throw new Error(`${label} must be a directory`);
  return canonical;
}

function assertInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its allowed root`);
  }
}
