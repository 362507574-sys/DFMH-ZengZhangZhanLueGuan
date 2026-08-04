import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';
import { createOrganizationPaths } from './organization_paths.mjs';
import { deepFreeze, readStrictJson } from './strict_json.mjs';

const ACCEPTED = new Set(['matched', 'no_hit', 'degraded']);
const CAPABILITIES = new Set([
  'growth-opportunity-analysis',
  'competitive-benchmark-analysis',
  'content-customer-growth',
]);

export async function runOrganizationKnowledgePreflight({
  projectRoot,
  task,
  executeCli = defaultExecuteCli,
} = {}) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new TypeError('knowledge preflight task is required');
  }
  if (task.requestId !== task.taskId) {
    throw new Error('requestId must match organization taskId');
  }
  if (!CAPABILITIES.has(task.capabilityId)) {
    throw new Error('capabilityId is not a growth strategist capability');
  }
  const paths = await createOrganizationPaths({ projectRoot });
  const evidenceAbsolutePath = paths.knowledgeEvidenceFile(
    task.enterpriseId,
    task.taskId,
  );
  const evidencePath = path.relative(projectRoot, evidenceAbsolutePath)
    .split(path.sep)
    .join('/');
  if (task.evidencePath !== undefined && task.evidencePath !== evidencePath) {
    throw new Error('evidencePath is fixed to the current enterprise and task');
  }
  const input = {
    requestId: task.requestId,
    text: requiredText(task.text, 'text', 20_000),
    summary: requiredText(task.summary, 'summary', 1_000),
    capabilityId: task.capabilityId,
    evidencePath,
  };
  await mkdir(path.dirname(evidenceAbsolutePath), { recursive: true });
  await executeCli({
    projectRoot,
    input,
    evidenceAbsolutePath,
    cliPath: path.join(projectRoot, 'scripts', 'run_feishu_knowledge_preflight.mjs'),
  });
  const evidence = await readStrictJson(evidenceAbsolutePath, {
    label: 'growth knowledge preflight evidence',
    maxBytes: 2 * 1024 * 1024,
  });
  if (evidence.requestId !== input.requestId
    || evidence.capabilityId !== input.capabilityId) {
    throw new Error('knowledge evidence request or capability mismatch');
  }
  if (evidence.status === 'skipped_non_business') {
    throw new Error('formal growth task cannot use skipped_non_business');
  }
  if (!ACCEPTED.has(evidence.status)) {
    throw new Error('knowledge evidence status is invalid');
  }
  if (!Array.isArray(evidence.sources)) {
    throw new Error('knowledge evidence sources must be an array');
  }
  if (evidence.status === 'degraded') {
    requiredText(evidence.degradedReason, 'degradedReason', 2_000);
  }
  for (const [index, source] of evidence.sources.entries()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`knowledge source is invalid at index ${index}`);
    }
    requiredText(source.spaceName, `sources[${index}].spaceName`, 160);
    requiredText(source.title, `sources[${index}].title`, 500);
    if (!source.url && !source.token) {
      throw new Error(`knowledge source reference is missing at index ${index}`);
    }
    requiredText(source.excerpt, `sources[${index}].excerpt`, 1_500);
  }
  return deepFreeze(evidence);
}

export async function runContentCustomerGrowthKnowledgePreflight({
  projectRoot,
  task,
  executeCli = defaultExecuteCli,
} = {}) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new TypeError('content knowledge preflight task is required');
  }
  requireEnterpriseId(task.enterpriseId);
  requireBusinessProjectId(task.businessProjectId);
  requireSafeId(task.taskId, 'taskId');
  requireSafeId(task.runId, 'runId');
  if (
    task.requestId !== task.taskId
    || task.capabilityId !== 'content-customer-growth'
  ) {
    throw new Error('content knowledge task identity is invalid');
  }
  const legacyEvidence = await runOrganizationKnowledgePreflight({
    projectRoot,
    task,
    executeCli,
  });
  const runEvidenceRoot = path.resolve(
    projectRoot,
    'business-projects',
    task.enterpriseId,
    task.businessProjectId,
    'organizations',
    'ai-growth-strategist',
    'runs',
    task.runId,
    'evidence',
  );
  const sourceRoot = path.join(runEvidenceRoot, 'knowledge-sources');
  await mkdir(sourceRoot, { recursive: true });
  const sources = [];
  for (const [index, source] of legacyEvidence.sources.entries()) {
    const snapshot = {
      schemaVersion: 1,
      spaceName: source.spaceName,
      title: source.title,
      url: source.url ?? null,
      token: source.token ?? null,
      docType: source.docType ?? null,
      excerpt: source.excerpt,
    };
    const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8');
    const sourcePath = path.join(
      sourceRoot,
      `source-${String(index + 1).padStart(3, '0')}.json`,
    );
    await writeImmutableFile(sourcePath, bytes, 'knowledge source snapshot');
    sources.push({
      relativePath: toProjectRelative(projectRoot, sourcePath),
      sha256: sha256(bytes),
    });
  }
  const limitations = [];
  if (legacyEvidence.status !== 'matched') {
    limitations.push(
      legacyEvidence.degradedReason
        || '本次飞书知识前置检索未返回可绑定正文来源。',
    );
  }
  const receipt = {
    schemaVersion: 2,
    capabilityId: task.capabilityId,
    enterpriseId: task.enterpriseId,
    businessProjectId: task.businessProjectId,
    taskId: task.taskId,
    runId: task.runId,
    status: legacyEvidence.status,
    sources,
    limitations,
  };
  const receiptPath = path.join(runEvidenceRoot, 'knowledge-context.json');
  const receiptBytes = Buffer.from(JSON.stringify(receipt), 'utf8');
  await writeImmutableFile(receiptPath, receiptBytes, 'knowledge receipt');
  const persisted = await readFile(receiptPath);
  if (sha256(persisted) !== sha256(receiptBytes)) {
    throw new Error('content knowledge receipt changed after creation');
  }
  return deepFreeze({
    legacyEvidence,
    receipt,
    binding: {
      relativePath: toProjectRelative(projectRoot, receiptPath),
      status: receipt.status,
      sha256: sha256(receiptBytes),
    },
  });
}

async function defaultExecuteCli({ projectRoot, input, cliPath }) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('knowledge preflight adapter timed out'));
    }, 20_000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(
        `knowledge preflight CLI failed (${code}): ${stderr.slice(0, 1_000)}`,
      ));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function requiredText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new Error(`${label} exceeds size limit`);
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function toProjectRelative(projectRoot, absolutePath) {
  const relative = path.relative(path.resolve(projectRoot), absolutePath);
  if (
    relative === ''
    || relative.startsWith('..')
    || path.isAbsolute(relative)
  ) {
    throw new Error('knowledge evidence path escaped the project root');
  }
  return relative.split(path.sep).join('/');
}

async function writeImmutableFile(filePath, bytes, label) {
  try {
    await writeFile(filePath, bytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(filePath);
    if (!existing.equals(bytes)) {
      throw new Error(`${label} already exists with different bytes`);
    }
  }
}
