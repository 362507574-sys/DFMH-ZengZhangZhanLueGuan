import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';

import { deepFreeze } from '../../../scripts/control-center/project_contract.mjs';

const PROMPT_FILE = 'exact-invocation-prompt.txt';
const RAW_FILES = Object.freeze([
  'raw-candidate.json',
  'raw-forward.md',
]);
const BEFORE_FILES = Object.freeze([PROMPT_FILE]);
const COMPLETE_FILES = Object.freeze([
  PROMPT_FILE,
  ...RAW_FILES,
].sort());
const EXACT_RAW_AUTHORIZATION =
  '仅创建 raw-forward.md 与 raw-candidate.json，除此之外不得创建任何文件';
const FORBIDDEN_PROMPT_CONTENT =
  /forward-score\.json|forward-invocation\.json|score|proof|manifest|canonical|sidecar|评分|证明/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

export function assertFreshRawWriterPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('fresh prompt is required');
  }
  if (FORBIDDEN_PROMPT_CONTENT.test(prompt)) {
    throw new Error('fresh prompt contains forbidden sidecar or scoring content');
  }
  if (!prompt.includes(EXACT_RAW_AUTHORIZATION)) {
    throw new Error('fresh prompt must authorize exact raw outputs');
  }
  return prompt.trim();
}

export async function assertFreshRawWriterDirectory({
  directory,
  phase,
  promptSha256,
}) {
  if (
    typeof directory !== 'string'
    || !directory.trim()
    || !['before_spawn', 'raw_complete'].includes(phase)
    || typeof promptSha256 !== 'string'
    || !SHA256.test(promptSha256)
  ) {
    throw new Error('fresh directory gate input is invalid');
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.map((entry) => entry.name).sort();
  const expected = phase === 'before_spawn' ? BEFORE_FILES : COMPLETE_FILES;
  if (
    files.length !== expected.length
    || files.some((name, index) => name !== expected[index])
  ) {
    throw new Error(`fresh directory has unexpected files during ${phase}`);
  }
  for (const name of files) {
    const stats = await lstat(path.join(directory, name));
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`fresh directory entry is not a regular file: ${name}`);
    }
  }
  const promptBytes = await readFile(path.join(directory, PROMPT_FILE));
  const actualPromptSha256 =
    createHash('sha256').update(promptBytes).digest('hex');
  if (actualPromptSha256 !== promptSha256) {
    throw new Error('fresh prompt SHA changed during raw writer execution');
  }
  assertFreshRawWriterPrompt(promptBytes.toString('utf8'));
  return deepFreeze({
    phase,
    files,
    promptSha256: actualPromptSha256,
  });
}

export function buildParentSidecars({
  cliExitCode,
  rawWriterTask,
  sidecarWriterTask,
  rawCandidateSha256,
  rawForwardSha256,
}) {
  if (cliExitCode !== 0) {
    throw new Error('parent sidecars require formal CLI exit 0');
  }
  if (
    typeof rawWriterTask !== 'string'
    || !rawWriterTask.trim()
    || typeof sidecarWriterTask !== 'string'
    || !sidecarWriterTask.trim()
    || rawWriterTask === sidecarWriterTask
  ) {
    throw new Error('raw writer and sidecar writer isolation is required');
  }
  if (
    !SHA256.test(rawCandidateSha256)
    || !SHA256.test(rawForwardSha256)
  ) {
    throw new Error('parent sidecar raw digest is invalid');
  }
  return deepFreeze({
    invocation: {
      schemaVersion: 1,
      rawWriterTask,
      sidecarWriterTask,
      formalCliExitCode: 0,
      rawCandidateSha256,
      rawForwardSha256,
    },
    score: {
      schemaVersion: 1,
      generatedAfterFormalCliExit0: true,
      rawCandidateSha256,
      rawForwardSha256,
    },
  });
}
