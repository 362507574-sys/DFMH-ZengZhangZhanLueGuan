import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  renameSync,
} from 'node:fs';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  createGrowthRunStore,
  createGrowthRunStoreForTest,
  isTrustedGrowthRunStore,
} from '../scripts/growth_run_store.mjs';
import { createGrowthWorkspacePaths } from '../scripts/growth_workspace_paths.mjs';
import { projectFixture, validRun } from './helpers.mjs';

const EXTERNAL_ACTION_VALUES = Object.freeze([
  'publish_content',
  'paid_media',
  'contact_customer',
  'change_price',
  'change_refund_rule',
  'brand_commitment',
  'deal_commitment',
  'write_external_system',
]);

function identity(overrides = {}) {
  const run = validRun();
  return {
    enterpriseId: run.enterpriseId,
    businessProjectId: run.businessProjectId,
    runId: run.runId,
    ...overrides,
  };
}

function fixedNow(value = '2026-07-29T01:00:00.000Z') {
  return () => new Date(value);
}

async function runPaths(projectRoot, runIdentity = identity()) {
  const paths = await createGrowthWorkspacePaths({ projectRoot });
  const value = paths.run(runIdentity);
  const lockDirectory = path.join(value.root, '.growth-run.lock');
  return Object.freeze({
    ...value,
    transactionFile: path.join(value.root, 'transaction.json'),
    lockDirectory,
    lockOwnerFile: path.join(lockDirectory, 'owner.json'),
  });
}

async function externalFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-runtime-external-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createDirectoryLinkOrSkip(t, target, linkPath) {
  try {
    await symlink(
      target,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return true;
  } catch (error) {
    if (['EACCES', 'ENOSYS', 'EPERM'].includes(error?.code)) {
      t.skip(`directory link creation unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

function proxyTrapProbe(target) {
  let trapCalls = 0;
  const fail = (trapName) => {
    trapCalls += 1;
    throw new Error(`SENTINEL_STORE_PROXY_TRAP_${trapName}`);
  };
  return {
    proxy: new Proxy(target, {
      get: () => fail('get'),
      set: () => fail('set'),
      has: () => fail('has'),
      ownKeys: () => fail('ownKeys'),
      getPrototypeOf: () => fail('getPrototypeOf'),
      setPrototypeOf: () => fail('setPrototypeOf'),
      isExtensible: () => fail('isExtensible'),
      preventExtensions: () => fail('preventExtensions'),
      getOwnPropertyDescriptor: () => fail('getOwnPropertyDescriptor'),
      defineProperty: () => fail('defineProperty'),
      deleteProperty: () => fail('deleteProperty'),
    }),
    trapCalls: () => trapCalls,
  };
}

async function assertProxyRejected(callback, probe) {
  let captured;
  try {
    await callback();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error, 'expected Proxy input to be rejected');
  assert.match(captured.message, /proxy/iu);
  assert.doesNotMatch(captured.message, /SENTINEL/iu);
  assert.equal(probe.trapCalls(), 0);
}

function planningRun(at = '2026-07-29T01:00:00.000Z') {
  return {
    ...validRun(),
    state: 'planning',
    sequence: 2,
    updatedAt: at,
  };
}

function transitionEvent(at = '2026-07-29T01:00:00.000Z') {
  return {
    sequence: 2,
    from: 'intake',
    to: 'planning',
    at,
  };
}

function transactionIntent({
  kind = 'transition',
  previousState = validRun(),
  nextState = planningRun(),
  event = transitionEvent(),
  createdAt = '2026-07-29T01:00:00.000Z',
  token = 'transaction-001',
} = {}) {
  return {
    schemaVersion: 1,
    kind,
    identity: identity(),
    previousState,
    nextState,
    event,
    createdAt,
    token,
  };
}

function evidenceLedger(overrides = {}) {
  return {
    enterpriseId: identity().enterpriseId,
    businessProjectId: identity().businessProjectId,
    runId: identity().runId,
    items: [{
      id: 'ev-001',
      type: 'behavior_data',
      claim: 'diagnostic content click rate is 18 percent',
      sourceReference: 'internal-report-q2',
      sourceVersion: '2026-q2',
      sourceSha256: 'a'.repeat(64),
      observedAt: '2026-07-28T00:00:00.000Z',
      appliesTo: 'consented newsletter audience',
      confidence: 'A',
      conflictReferences: [],
    }],
    ...overrides,
  };
}

function approval(overrides = {}) {
  const now = Date.now();
  return {
    approvalId: 'approval-001',
    runId: identity().runId,
    allowedActions: [...EXTERNAL_ACTION_VALUES],
    decision: 'approved',
    decidedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
    ...overrides,
  };
}

async function advanceToAwaitingApproval(store) {
  await store.initialize(validRun());
  for (const [expectedState, nextState] of [
    ['intake', 'planning'],
    ['planning', 'ready'],
    ['ready', 'running_internal'],
    ['running_internal', 'awaiting_approval'],
  ]) {
    await store.transition(identity(), { expectedState, nextState });
  }
}

async function prepareApprovedRun(store, approvalValue = approval()) {
  await advanceToAwaitingApproval(store);
  await store.recordApproval(identity(), approvalValue, {
    expectedRevision: 0,
  });
  await store.transition(identity(), {
    expectedState: 'awaiting_approval',
    nextState: 'running_approved',
  });
}

async function assertMissing(filePath) {
  await assert.rejects(
    readFile(filePath),
    (error) => error?.code === 'ENOENT',
  );
}

async function runEvidenceWriteWorker(projectRoot, value, expectedRevision = 0) {
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, '..', 'scripts', 'growth_run_store.mjs'),
  ).href;
  const script = `
    import { createGrowthRunStore } from ${JSON.stringify(moduleUrl)};
    const identity = JSON.parse(process.env.GROWTH_TEST_IDENTITY);
    const ledger = JSON.parse(process.env.GROWTH_TEST_LEDGER);
    const store = await createGrowthRunStore({
      projectRoot: process.env.GROWTH_TEST_ROOT,
    });
    try {
      const result = await store.writeEvidenceLedger(identity, ledger, {
        expectedRevision: Number(process.env.GROWTH_TEST_EXPECTED_REVISION),
      });
      process.stdout.write(JSON.stringify({
        status: 'success',
        claim: result.items[0].claim,
        revision: result.revision,
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: 'error',
        message: error.message,
        growthPathLabel: error.growthPathLabel ?? null,
        growthPathRoot: error.growthPathRoot ?? null,
        growthPathCandidate: error.growthPathCandidate ?? null,
        growthPathRelative: error.growthPathRelative ?? null,
      }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        GROWTH_TEST_ROOT: projectRoot,
        GROWTH_TEST_IDENTITY: JSON.stringify(identity()),
        GROWTH_TEST_LEDGER: JSON.stringify(value),
        GROWTH_TEST_EXPECTED_REVISION: String(expectedRevision),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`evidence worker exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(
          `evidence worker output is invalid: ${stdout} ${stderr}`,
          { cause: error },
        ));
      }
    });
  });
}

async function runApprovalConsumeWorker(
  projectRoot,
  action = 'publish_content',
) {
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, '..', 'scripts', 'growth_run_store.mjs'),
  ).href;
  const script = `
    import { createGrowthRunStore } from ${JSON.stringify(moduleUrl)};
    const identity = JSON.parse(process.env.GROWTH_TEST_IDENTITY);
    const store = await createGrowthRunStore({
      projectRoot: process.env.GROWTH_TEST_ROOT,
    });
    try {
      const result = await store.consumeExternalApproval(identity, {
        action: process.env.GROWTH_TEST_ACTION,
        approvalId: 'approval-001',
      });
      process.stdout.write(JSON.stringify({
        status: 'authorized',
        action: result.action,
        authorizationId: result.authorizationId,
        revision: result.approvalRevision,
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: 'error',
        message: error.message,
      }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        GROWTH_TEST_ROOT: projectRoot,
        GROWTH_TEST_IDENTITY: JSON.stringify(identity()),
        GROWTH_TEST_ACTION: action,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`approval worker exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(
          `approval worker output is invalid: ${stdout} ${stderr}`,
          { cause: error },
        ));
      }
    });
  });
}

async function runTransitionWorker(projectRoot, delayMs = 300) {
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, '..', 'scripts', 'growth_run_store.mjs'),
  ).href;
  const script = `
    import { createGrowthRunStoreForTest } from ${JSON.stringify(moduleUrl)};
    const sleep = (ms) => Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      ms,
    );
    const identity = JSON.parse(process.env.GROWTH_TEST_IDENTITY);
    const store = await createGrowthRunStoreForTest({
      projectRoot: process.env.GROWTH_TEST_ROOT,
      clock: () => {
        sleep(Number(process.env.GROWTH_TEST_DELAY_MS));
        return new Date('2026-07-29T01:00:00.000Z');
      },
    });
    try {
      const result = await store.transition(identity, {
        expectedState: 'intake',
        nextState: 'planning',
      });
      process.stdout.write(JSON.stringify({
        status: 'success',
        state: result.state,
        sequence: result.sequence,
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: 'error',
        message: error.message,
      }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        GROWTH_TEST_ROOT: projectRoot,
        GROWTH_TEST_IDENTITY: JSON.stringify(identity()),
        GROWTH_TEST_DELAY_MS: String(delayMs),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`worker output is invalid: ${stdout} ${stderr}`, {
          cause: error,
        }));
      }
    });
  });
}

function startReadWorker(projectRoot, workerId, triggerFile) {
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, '..', 'scripts', 'growth_run_store.mjs'),
  ).href;
  const markerFile = path.join(projectRoot, `lock-worker-${workerId}.ready`);
  const script = `
    import { existsSync, writeFileSync } from 'node:fs';
    import { createGrowthRunStore } from ${JSON.stringify(moduleUrl)};
    const sleep = (ms) => Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      ms,
    );
    writeFileSync(process.env.GROWTH_TEST_MARKER, 'ready');
    const deadline = Date.now() + 10_000;
    while (!existsSync(process.env.GROWTH_TEST_TRIGGER)) {
      if (Date.now() >= deadline) throw new Error('worker trigger timeout');
      sleep(5);
    }
    const store = await createGrowthRunStore({
      projectRoot: process.env.GROWTH_TEST_ROOT,
    });
    try {
      const result = await store.read(
        JSON.parse(process.env.GROWTH_TEST_IDENTITY),
      );
      process.stdout.write(JSON.stringify({
        status: 'success',
        state: result.state,
        sequence: result.sequence,
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: 'error',
        workerId: process.env.GROWTH_TEST_WORKER_ID,
        message: error.message,
        code: error.code ?? null,
        stack: error.stack ?? null,
      }));
    }
  `;
  const completion = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        GROWTH_TEST_ROOT: projectRoot,
        GROWTH_TEST_IDENTITY: JSON.stringify(identity()),
        GROWTH_TEST_WORKER_ID: workerId,
        GROWTH_TEST_MARKER: markerFile,
        GROWTH_TEST_TRIGGER: triggerFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`read worker exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`read worker output is invalid: ${stdout} ${stderr}`, {
          cause: error,
        }));
      }
    });
  });
  return { markerFile, completion };
}

async function releaseReadWorkerGate(projectRoot, workers, triggerFile) {
  const markerNames = new Set(
    workers.map(({ markerFile }) => path.basename(markerFile)),
  );
  const deadline = Date.now() + 10_000;
  for (;;) {
    const entries = new Set(await readdir(projectRoot));
    if ([...markerNames].every((name) => entries.has(name))) break;
    if (Date.now() >= deadline) {
      throw new Error('read workers did not reach the start gate');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await writeFile(triggerFile, 'go', 'utf8');
}

async function runInstrumentedReadWorker(
  projectRoot,
  lockDirectory,
  injectAtLockLstat = 0,
  replacementOwner = null,
  injectedError = null,
  injectionStage = 'fixed',
  continueAfterInjection = false,
  operation = 'read',
) {
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, '..', 'scripts', 'growth_run_store.mjs'),
  ).href;
  const preload = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const originalLstat = fs.promises.lstat;
    const originalRealpath = fs.promises.realpath;
    const originalRename = fs.promises.rename;
    const originalRm = fs.promises.rm;
    const originalMkdir = fs.promises.mkdir;
    const originalWriteFile = fs.promises.writeFile;
    const target = path.resolve(process.env.GROWTH_TEST_LOCK_DIRECTORY);
    const injectAt = Number(process.env.GROWTH_TEST_INJECT_AT);
    const replacementOwner = process.env.GROWTH_TEST_REPLACEMENT_OWNER
      ? JSON.parse(process.env.GROWTH_TEST_REPLACEMENT_OWNER)
      : null;
    const injectedError = process.env.GROWTH_TEST_INJECTED_ERROR
      ? JSON.parse(process.env.GROWTH_TEST_INJECTED_ERROR)
      : null;
    const injectionStage = process.env.GROWTH_TEST_INJECTION_STAGE;
    const continueAfterInjection =
      process.env.GROWTH_TEST_CONTINUE_AFTER_INJECTION === '1';
    let calls = 0;
    fs.promises.lstat = async function instrumentedLstat(candidate, ...args) {
      const resolvedCandidate = path.resolve(String(candidate));
      const matchesStage = injectionStage === 'candidate-owner'
        ? (
          path.basename(resolvedCandidate) === 'owner.json'
          && path.basename(path.dirname(resolvedCandidate))
            .startsWith('.growth-run.lock.candidate-')
        )
        : injectionStage === 'candidate-directory'
          ? path.basename(resolvedCandidate)
            .startsWith('.growth-run.lock.candidate-')
          : injectionStage === 'fixed' && resolvedCandidate === target;
      if (matchesStage) {
        calls += 1;
        process.stderr.write(
          'LOCK_LSTAT:' + calls + ':' +
          new Error('lock lstat trace').stack.replaceAll('\\\\n', ' | ') +
          '\\n',
        );
        if (calls === injectAt) {
          if (injectedError && !replacementOwner) {
            const error = new Error(injectedError.message);
            error.code = injectedError.code;
            error.path = injectedError.path;
            error.syscall = 'lstat';
            throw error;
          }
          if (injectionStage === 'fixed') {
            const quarantine = target + '.peer-' + process.pid;
            await originalRename(target, quarantine);
            await originalRm(quarantine, { recursive: true });
          }
          if (replacementOwner) {
            await originalMkdir(target);
            await originalWriteFile(
              path.join(target, 'owner.json'),
              JSON.stringify(replacementOwner) + '\\n',
              'utf8',
            );
          }
          if (injectedError) {
            const error = new Error(injectedError.message);
            error.code = injectedError.code;
            error.path = injectedError.path;
            error.syscall = 'lstat';
            throw error;
          }
          if (!continueAfterInjection) {
            const error = new Error(
              "ENOENT: no such file or directory, lstat '" + target + "'",
            );
            error.code = 'ENOENT';
            error.path = target;
            error.syscall = 'lstat';
            throw error;
          }
        }
      }
      return originalLstat.call(this, candidate, ...args);
    };
    fs.promises.rename = async function instrumentedRename(
      source,
      destination,
      ...args
    ) {
      const resolvedSource = path.resolve(String(source));
      const resolvedDestination = path.resolve(String(destination));
      const isCandidatePublish = (
        injectionStage === 'publish'
        && path.basename(resolvedSource)
          .startsWith('.growth-run.lock.candidate-')
        && resolvedDestination === target
      );
      if (isCandidatePublish) {
        calls += 1;
        process.stderr.write(
          'LOCK_RENAME:' + calls + ':' +
          new Error('lock rename trace').stack.replaceAll('\\\\n', ' | ') +
          '\\n',
        );
        const repeat = Math.max(1, Number(injectedError?.repeat ?? 1));
        if (
          calls >= injectAt
          && calls < injectAt + repeat
          && injectedError
        ) {
          const error = new Error(injectedError.message);
          error.code = injectedError.code;
          error.path = injectedError.path;
          error.syscall = 'rename';
          throw error;
        }
      }
      return originalRename.call(this, source, destination, ...args);
    };
    fs.promises.realpath = async function instrumentedRealpath(
      candidate,
      ...args
    ) {
      const resolvedCandidate = path.resolve(String(candidate));
      if (injectionStage === 'fixed-realpath' && resolvedCandidate === target) {
        calls += 1;
        process.stderr.write(
          'LOCK_REALPATH:' + calls + ':' +
          new Error('lock realpath trace').stack.replaceAll('\\\\n', ' | ') +
          '\\n',
        );
        if (calls === injectAt) {
          if (!injectedError?.keepTarget) {
            const quarantine = target + '.peer-realpath-' + process.pid;
            await originalRename(target, quarantine);
            await originalRm(quarantine, { recursive: true });
          }
          if (injectedError?.returnPath) {
            return injectedError.returnPath;
          }
          if (injectedError) {
            const error = new Error(injectedError.message);
            error.code = injectedError.code;
            error.path = injectedError.path;
            error.syscall = 'realpath';
            throw error;
          }
        }
      }
      const candidateDirectory = path.basename(resolvedCandidate)
        .startsWith('.growth-run.lock.candidate-')
        ? resolvedCandidate
        : path.basename(path.dirname(resolvedCandidate))
            .startsWith('.growth-run.lock.candidate-')
          ? path.dirname(resolvedCandidate)
          : null;
      if (injectionStage === 'candidate-realpath' && candidateDirectory) {
        calls += 1;
        process.stderr.write(
          'CANDIDATE_REALPATH:' + calls + ':' +
          new Error('candidate realpath trace').stack.replaceAll('\\\\n', ' | ') +
          '\\n',
        );
        if (calls === injectAt) {
          if (injectedError?.returnPath) {
            if (!injectedError.keepTarget) {
              const quarantine = candidateDirectory
                + '.peer-realpath-' + process.pid;
              await originalRename(candidateDirectory, quarantine);
              await originalRm(quarantine, { recursive: true });
            }
            return injectedError.returnPath;
          }
          if (injectedError) {
            const error = new Error(injectedError.message);
            error.code = injectedError.code;
            error.path = injectedError.path;
            error.syscall = 'realpath';
            throw error;
          }
          const quarantine = candidateDirectory
            + '.peer-realpath-' + process.pid;
          await originalRename(candidateDirectory, quarantine);
          await originalRm(quarantine, { recursive: true });
        }
      }
      return originalRealpath.call(this, candidate, ...args);
    };
    syncBuiltinESMExports();
  `;
  const preloadUrl = `data:text/javascript;base64,${
    Buffer.from(preload, 'utf8').toString('base64')
  }`;
  const script = `
    import { createGrowthRunStore } from ${JSON.stringify(moduleUrl)};
    const store = await createGrowthRunStore({
      projectRoot: process.env.GROWTH_TEST_ROOT,
    });
    try {
      const identity = JSON.parse(process.env.GROWTH_TEST_IDENTITY);
      const result = process.env.GROWTH_TEST_OPERATION === 'read-evidence'
        ? await store.readEvidenceLedger(identity)
        : await store.read(identity);
      process.stdout.write(JSON.stringify({
        status: 'success',
        state: result.state ?? null,
        sequence: result.sequence ?? null,
        revision: result.revision ?? null,
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: 'error',
        message: error.message,
        code: error.code ?? null,
        stack: error.stack ?? null,
      }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', preloadUrl, '--input-type=module', '-e', script],
      {
        env: {
          ...process.env,
          GROWTH_TEST_ROOT: projectRoot,
          GROWTH_TEST_IDENTITY: JSON.stringify(identity()),
          GROWTH_TEST_LOCK_DIRECTORY: lockDirectory,
          GROWTH_TEST_INJECT_AT: String(injectAtLockLstat),
          GROWTH_TEST_REPLACEMENT_OWNER: replacementOwner
            ? JSON.stringify(replacementOwner)
            : '',
          GROWTH_TEST_INJECTED_ERROR: injectedError
            ? JSON.stringify(injectedError)
            : '',
          GROWTH_TEST_INJECTION_STAGE: injectionStage,
          GROWTH_TEST_CONTINUE_AFTER_INJECTION:
            continueAfterInjection ? '1' : '0',
          GROWTH_TEST_OPERATION: operation,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`instrumented worker exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve({ result: JSON.parse(stdout), stderr });
      } catch (error) {
        reject(new Error(
          `instrumented worker output is invalid: ${stdout} ${stderr}`,
          { cause: error },
        ));
      }
    });
  });
}

test('production store options reject accessors and all fields except projectRoot', async (t) => {
  const root = await projectFixture(t);

  let projectRootGetterCalls = 0;
  const projectRootAccessor = {};
  Object.defineProperty(projectRootAccessor, 'projectRoot', {
    enumerable: true,
    get() {
      projectRootGetterCalls += 1;
      return root;
    },
  });
  await assert.rejects(
    createGrowthRunStore(projectRootAccessor),
    /accessor|data property/iu,
  );
  assert.equal(projectRootGetterCalls, 0);

  let nowGetterCalls = 0;
  const nowAccessor = { projectRoot: root };
  Object.defineProperty(nowAccessor, 'now', {
    enumerable: true,
    get() {
      nowGetterCalls += 1;
      return fixedNow();
    },
  });
  await assert.rejects(
    createGrowthRunStore(nowAccessor),
    /unexpected|now|field/iu,
  );
  assert.equal(nowGetterCalls, 0);

  let clockGetterCalls = 0;
  const clockAccessor = { projectRoot: root };
  Object.defineProperty(clockAccessor, 'clock', {
    enumerable: true,
    get() {
      clockGetterCalls += 1;
      return fixedNow();
    },
  });
  await assert.rejects(
    createGrowthRunStore(clockAccessor),
    /unexpected|clock|field/iu,
  );
  assert.equal(clockGetterCalls, 0);
});

test('store options reject Proxies and require exact own data fields', async (t) => {
  const root = await projectFixture(t);
  const optionsProbe = proxyTrapProbe({ projectRoot: root });
  await assertProxyRejected(
    () => createGrowthRunStore(optionsProbe.proxy),
    optionsProbe,
  );

  await assert.rejects(
    createGrowthRunStore({}),
    /missing|required|projectRoot/iu,
  );
  await assert.rejects(
    createGrowthRunStore({ projectRoot: root, extra: true }),
    /unexpected|extra|field/iu,
  );
  const symbolOptions = { projectRoot: root };
  symbolOptions[Symbol('extra')] = true;
  await assert.rejects(
    createGrowthRunStore(symbolOptions),
    /unexpected|symbol|field/iu,
  );

  let clockGetterCalls = 0;
  const testOptionsAccessor = { projectRoot: root };
  Object.defineProperty(testOptionsAccessor, 'clock', {
    enumerable: true,
    get() {
      clockGetterCalls += 1;
      return fixedNow();
    },
  });
  await assert.rejects(
    createGrowthRunStoreForTest(testOptionsAccessor),
    /accessor|data property/iu,
  );
  assert.equal(clockGetterCalls, 0);

  const testOptionsProbe = proxyTrapProbe({
    projectRoot: root,
    clock: fixedNow(),
  });
  await assertProxyRejected(
    () => createGrowthRunStoreForTest(testOptionsProbe.proxy),
    testOptionsProbe,
  );
});

test('initialize requires identical createdAt and updatedAt timestamps', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });

  await assert.rejects(
    store.initialize({
      ...validRun(),
      updatedAt: '2026-07-29T00:00:01.000Z',
    }),
    /createdAt|updatedAt|initial|equal/iu,
  );
});

test('transition failure after state write preserves intent and read deterministically recovers', async (t) => {
  const root = await projectFixture(t);
  const paths = await runPaths(root);
  const timelineBackup = path.join(paths.root, 'timeline.backup');
  let injected = false;
  const store = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: () => {
      if (!injected) {
        injected = true;
        renameSync(paths.timelineFile, timelineBackup);
        mkdirSync(paths.timelineFile);
      }
      return new Date('2026-07-29T01:00:00.000Z');
    },
  });
  await store.initialize(validRun());

  await assert.rejects(
    store.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
    }),
    /timeline|file|directory|append|physical/iu,
  );
  assert.equal(JSON.parse(await readFile(paths.transactionFile, 'utf8')).kind, 'transition');

  await rm(paths.timelineFile, { recursive: true });
  await rename(timelineBackup, paths.timelineFile);
  assert.deepEqual(await store.read(identity()), planningRun());
  assert.deepEqual(await store.readTimeline(identity()), [
    {
      sequence: 1,
      from: null,
      to: 'intake',
      at: validRun().createdAt,
    },
    transitionEvent(),
  ]);
  await assertMissing(paths.transactionFile);
});

test('recovery recognizes a fully appended ambiguous event without duplicating it', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify(transactionIntent())}\n`,
    'utf8',
  );
  await writeFile(paths.stateFile, `${JSON.stringify(planningRun())}\n`, 'utf8');
  await appendFile(
    paths.timelineFile,
    `${JSON.stringify(transitionEvent())}\n`,
    'utf8',
  );

  assert.deepEqual(await store.read(identity()), planningRun());
  assert.deepEqual(
    (await store.readTimeline(identity())).map((event) => event.sequence),
    [1, 2],
  );
  await assertMissing(paths.transactionFile);
});

test('recovery fills state when the intent event committed first', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify(transactionIntent())}\n`,
    'utf8',
  );
  await appendFile(
    paths.timelineFile,
    `${JSON.stringify(transitionEvent())}\n`,
    'utf8',
  );

  assert.deepEqual(await store.read(identity()), planningRun());
  assert.deepEqual(
    (await store.readTimeline(identity())).map((event) => event.sequence),
    [1, 2],
  );
  await assertMissing(paths.transactionFile);
});

test('recovery truncates an intent-owned partial tail before appending the complete event', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify(transactionIntent())}\n`,
    'utf8',
  );
  await writeFile(paths.stateFile, `${JSON.stringify(planningRun())}\n`, 'utf8');
  await appendFile(paths.timelineFile, '{"sequence":2', 'utf8');

  assert.deepEqual(await store.read(identity()), planningRun());
  assert.deepEqual(await store.readTimeline(identity()), [
    {
      sequence: 1,
      from: null,
      to: 'intake',
      at: validRun().createdAt,
    },
    transitionEvent(),
  ]);
  await assertMissing(paths.transactionFile);
});

test('a partial timeline without intent remains corruption for both read entrances', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await appendFile(paths.timelineFile, '{"sequence":2', 'utf8');

  await assert.rejects(store.read(identity()), /timeline|JSON|partial|corrupt/iu);
  await assert.rejects(
    store.readTimeline(identity()),
    /timeline|JSON|partial|corrupt/iu,
  );
});

test('duplicate initialize recovers its matching unfinished initialize intent', async (t) => {
  const root = await projectFixture(t);
  const paths = await runPaths(root);
  await mkdir(paths.root, { recursive: true });
  const event = {
    sequence: 1,
    from: null,
    to: 'intake',
    at: validRun().createdAt,
  };
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify(transactionIntent({
      kind: 'initialize',
      previousState: null,
      nextState: validRun(),
      event,
      createdAt: validRun().createdAt,
      token: 'initialize-transaction-001',
    }))}\n`,
    'utf8',
  );
  const store = await createGrowthRunStore({ projectRoot: root });

  assert.deepEqual(await store.initialize(validRun()), validRun());
  assert.deepEqual(await store.read(identity()), validRun());
  assert.deepEqual(await store.readTimeline(identity()), [event]);
  await assertMissing(paths.transactionFile);
});

test('intent contract is strict and rejects unexpected fields', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify({ ...transactionIntent(), extra: true })}\n`,
    'utf8',
  );

  await assert.rejects(
    store.read(identity()),
    /transaction|intent|unexpected|field/iu,
  );
});

test('transaction metadata createdAt is canonical but independent from event time', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify(transactionIntent({
      createdAt: '2026-07-29T02:00:00.000Z',
    }))}\n`,
    'utf8',
  );
  await writeFile(paths.stateFile, `${JSON.stringify(planningRun())}\n`, 'utf8');
  await appendFile(
    paths.timelineFile,
    `${JSON.stringify(transitionEvent())}\n`,
    'utf8',
  );

  assert.deepEqual(await store.read(identity()), planningRun());
  await assertMissing(paths.transactionFile);
});

test('recovery rejects a backwards transition intent before any disk mutation', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow('2026-07-29T02:00:00.000Z'),
  });
  await store.initialize(validRun());
  const previousState = await store.transition(identity(), {
    expectedState: 'intake',
    nextState: 'planning',
  });
  const paths = await runPaths(root);
  const nextState = {
    ...previousState,
    state: 'ready',
    sequence: 3,
    updatedAt: '2026-07-29T01:00:00.000Z',
  };
  const event = {
    sequence: 3,
    from: 'planning',
    to: 'ready',
    at: nextState.updatedAt,
  };
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify(transactionIntent({
      previousState,
      nextState,
      event,
      createdAt: '2026-07-29T03:00:00.000Z',
      token: 'backwards-transaction-001',
    }))}\n`,
    'utf8',
  );
  const before = {
    state: await readFile(paths.stateFile, 'utf8'),
    timeline: await readFile(paths.timelineFile, 'utf8'),
    transaction: await readFile(paths.transactionFile, 'utf8'),
  };

  await assert.rejects(
    store.read(identity()),
    /transaction|intent|updatedAt|earlier|time|inconsistent/iu,
  );
  assert.equal(await readFile(paths.stateFile, 'utf8'), before.state);
  assert.equal(await readFile(paths.timelineFile, 'utf8'), before.timeline);
  assert.equal(
    await readFile(paths.transactionFile, 'utf8'),
    before.transaction,
  );

  await rm(paths.transactionFile);
  assert.deepEqual(await store.read(identity()), previousState);
  assert.equal(await readFile(paths.stateFile, 'utf8'), before.state);
  assert.equal(await readFile(paths.timelineFile, 'utf8'), before.timeline);
});

test('recovery allows a transition intent whose update time equals the previous time', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow('2026-07-29T02:00:00.000Z'),
  });
  await store.initialize(validRun());
  const previousState = await store.transition(identity(), {
    expectedState: 'intake',
    nextState: 'planning',
  });
  const paths = await runPaths(root);
  const nextState = {
    ...previousState,
    state: 'ready',
    sequence: 3,
    updatedAt: previousState.updatedAt,
  };
  const event = {
    sequence: 3,
    from: 'planning',
    to: 'ready',
    at: previousState.updatedAt,
  };
  await writeFile(
    paths.transactionFile,
    `${JSON.stringify(transactionIntent({
      previousState,
      nextState,
      event,
      createdAt: '2026-07-29T03:00:00.000Z',
      token: 'equal-time-transaction-001',
    }))}\n`,
    'utf8',
  );

  assert.deepEqual(await store.read(identity()), nextState);
  assert.deepEqual(
    (await store.readTimeline(identity())).map(({ sequence, at }) => ({
      sequence,
      at,
    })),
    [
      { sequence: 1, at: validRun().createdAt },
      { sequence: 2, at: previousState.updatedAt },
      { sequence: 3, at: previousState.updatedAt },
    ],
  );
  await assertMissing(paths.transactionFile);
});

test('state and timeline that are separately valid but cross-inconsistent are rejected', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await writeFile(
    paths.stateFile,
    `${JSON.stringify({
      ...validRun(),
      createdAt: '2026-07-29T00:30:00.000Z',
      updatedAt: '2026-07-29T00:30:00.000Z',
    })}\n`,
    'utf8',
  );

  await assert.rejects(
    store.read(identity()),
    /timeline|state|createdAt|inconsistent|conflict/iu,
  );
});

test('two Node processes serialize the same optimistic transition', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());

  const results = await Promise.all([
    runTransitionWorker(root),
    runTransitionWorker(root),
  ]);
  assert.equal(results.filter((item) => item.status === 'success').length, 1);
  const conflict = results.find((item) => item.status === 'error');
  assert.match(conflict.message, /conflict/iu);
  assert.deepEqual(
    (await store.readTimeline(identity())).map((event) => event.sequence),
    [1, 2],
  );
});

test('failed operations release their owned cross-process lock', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow(),
  });
  await store.initialize(validRun());
  const paths = await runPaths(root);

  await assert.rejects(
    store.transition(identity(), {
      expectedState: 'planning',
      nextState: 'ready',
    }),
    /conflict/iu,
  );
  await assertMissing(paths.lockDirectory);
  assert.deepEqual(
    await store.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
    }),
    planningRun(),
  );
  await assertMissing(paths.lockDirectory);
});

test('an expired dead-pid lock is reclaimed but an old live-pid lock is never stolen', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);

  await mkdir(paths.lockDirectory);
  await writeFile(
    paths.lockOwnerFile,
    `${JSON.stringify({
      schemaVersion: 1,
      token: 'dead-owner-token-001',
      pid: 99_999_999,
      acquiredAt: '2020-01-01T00:00:00.000Z',
    })}\n`,
    'utf8',
  );
  assert.deepEqual(await store.read(identity()), validRun());
  await assertMissing(paths.lockDirectory);

  await mkdir(paths.lockDirectory);
  await writeFile(
    paths.lockOwnerFile,
    `${JSON.stringify({
      schemaVersion: 1,
      token: 'live-owner-token-001',
      pid: process.pid,
      acquiredAt: '2020-01-01T00:00:00.000Z',
    })}\n`,
    'utf8',
  );
  await assert.rejects(
    store.read(identity()),
    /lock|timeout|busy/iu,
  );
  assert.equal((await stat(paths.lockDirectory)).isDirectory(), true);
  await rm(paths.lockDirectory, { recursive: true });
});

test('an expired ownerless half-created lock directory is reclaimed', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);

  assert.deepEqual(await store.read(identity()), validRun());
  await assertMissing(paths.lockDirectory);
});

test('candidate publication never replaces an existing fixed owner', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);
  const replacementOwner = {
    schemaVersion: 1,
    token: 'replacement-owner-token-001',
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    5,
    replacementOwner,
    null,
    'candidate-owner',
    true,
  );
  assert.equal(observation.result.status, 'error');
  assert.match(observation.result.message, /lock|timeout|busy/iu);
  assert.deepEqual(
    JSON.parse(await readFile(paths.lockOwnerFile, 'utf8')),
    replacementOwner,
  );
});

test('candidate publish tolerates the fixed lock vanishing during physical-path validation', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    null,
    'fixed-realpath',
    true,
  );
  assert.deepEqual(
    {
      status: observation.result.status,
      state: observation.result.state,
    },
    {
      status: 'success',
      state: 'intake',
    },
    observation.stderr,
  );
});

test('candidate publish tolerates the Windows deleted-object namespace after a fixed lock vanishes', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);
  const deletedObjectPath = path.join(
    path.parse(root).root,
    '$Extend',
    '$Deleted',
    '003A00000000000000000001',
  );

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    {
      returnPath: deletedObjectPath,
    },
    'fixed-realpath',
    true,
  );
  assert.equal(
    observation.result.status,
    'success',
    `${JSON.stringify(observation.result)}\n${observation.stderr}`,
  );
});

test('Windows deleted-object handling is limited to a fixed lock that actually vanished', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  await writeFile(
    paths.lockOwnerFile,
    `${JSON.stringify({
      schemaVersion: 1,
      token: 'live-deleted-object-owner-token-001',
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    })}\n`,
    'utf8',
  );
  const deletedObjectPath = path.join(
    path.parse(root).root,
    '$Extend',
    '$Deleted',
    '003A00000000000000000002',
  );

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    {
      keepTarget: true,
      returnPath: deletedObjectPath,
    },
    'fixed-realpath',
    true,
  );
  assert.equal(observation.result.status, 'error', observation.stderr);
  assert.match(observation.result.message, /lock|timeout|busy/iu);
  assert.deepEqual(
    JSON.parse(await readFile(paths.lockOwnerFile, 'utf8')),
    {
      schemaVersion: 1,
      token: 'live-deleted-object-owner-token-001',
      pid: process.pid,
      acquiredAt: JSON.parse(
        await readFile(paths.lockOwnerFile, 'utf8'),
      ).acquiredAt,
    },
  );
});

for (const targetKind of ['state', 'evidence']) {
  test(`Windows deleted-object namespace is never swallowed for an ordinary ${targetKind} path`, async (t) => {
    const root = await projectFixture(t);
    const store = await createGrowthRunStore({ projectRoot: root });
    await store.initialize(validRun());
    const paths = await runPaths(root);
    if (targetKind === 'evidence') {
      await store.writeEvidenceLedger(identity(), evidenceLedger(), {
        expectedRevision: 0,
      });
    }
    const target = targetKind === 'state'
      ? paths.stateFile
      : paths.evidenceFile;
    const deletedObjectPath = path.join(
      path.parse(root).root,
      '$Extend',
      '$Deleted',
      targetKind === 'state'
        ? '003A00000000000000000003'
        : '003A00000000000000000004',
    );

    const observation = await runInstrumentedReadWorker(
      root,
      target,
      1,
      null,
      {
        returnPath: deletedObjectPath,
      },
      'fixed-realpath',
      true,
      targetKind === 'evidence' ? 'read-evidence' : 'read',
    );
    assert.deepEqual(
      {
        status: observation.result.status,
        code: observation.result.code,
      },
      {
        status: 'error',
        code: 'GROWTH_WINDOWS_DELETED_OBJECT',
      },
      observation.stderr,
    );
  });
}

test('candidate deleted-object namespace is rejected when the candidate still exists', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const candidate = path.join(
    paths.root,
    '.growth-run.lock.candidate-lock-deleted-object-existing-001',
  );
  await mkdir(candidate);
  const deletedObjectPath = path.join(
    path.parse(root).root,
    '$Extend',
    '$Deleted',
    '003A00000000000000000005',
  );

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    {
      keepTarget: true,
      returnPath: deletedObjectPath,
    },
    'candidate-realpath',
    true,
  );
  assert.deepEqual(
    {
      status: observation.result.status,
      code: observation.result.code,
    },
    {
      status: 'error',
      code: 'GROWTH_WINDOWS_DELETED_OBJECT',
    },
    observation.stderr,
  );
  assert.equal((await stat(candidate)).isDirectory(), true);
});

test('candidate deleted-object namespace converges only after the candidate vanished', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const candidate = path.join(
    paths.root,
    '.growth-run.lock.candidate-lock-deleted-object-vanished-001',
  );
  await mkdir(candidate);
  const deletedObjectPath = path.join(
    path.parse(root).root,
    '$Extend',
    '$Deleted',
    '003A00000000000000000006',
  );

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    {
      returnPath: deletedObjectPath,
    },
    'candidate-realpath',
    true,
  );
  assert.equal(
    observation.result.status,
    'success',
    `${JSON.stringify(observation.result)}\n${observation.stderr}`,
  );
});

test('a non-deleted physical escape remains a hard boundary failure', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    {
      returnPath: path.join(path.parse(root).root, 'outside-growth-root'),
    },
    'fixed-realpath',
    true,
  );
  assert.equal(observation.result.status, 'error', observation.stderr);
  assert.match(observation.result.message, /escape|boundary/iu);
});

test('candidate publish handles Windows EBADF only when the fixed lock vanished', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    {
      code: 'EBADF',
      path: paths.lockDirectory,
      message: 'EBADF: fixed lock vanished during realpath',
    },
    'fixed-realpath',
    true,
  );
  assert.equal(
    observation.result.status,
    'success',
    `${JSON.stringify(observation.result)}\n${observation.stderr}`,
  );
});

test('candidate preparation does not swallow permission or unrelated missing-path errors', async (t) => {
  for (const injectedError of [
    {
      code: 'EACCES',
      pathKind: 'lock',
      message: 'EACCES: permission denied while checking the lock',
      injectAt: 1,
      injectionStage: 'candidate-owner',
    },
    {
      code: 'ENOENT',
      pathKind: 'root',
      message: 'ENOENT: unrelated project path disappeared',
      injectAt: 2,
      injectionStage: 'candidate-directory',
    },
  ]) {
    const root = await projectFixture(t);
    const store = await createGrowthRunStore({ projectRoot: root });
    await store.initialize(validRun());
    const paths = await runPaths(root);
    await mkdir(paths.lockDirectory);
    const old = new Date('2020-01-01T00:00:00.000Z');
    await utimes(paths.lockDirectory, old, old);

    const observation = await runInstrumentedReadWorker(
      root,
      paths.lockDirectory,
      injectedError.injectAt,
      null,
      {
        code: injectedError.code,
        path: injectedError.pathKind === 'lock'
          ? paths.lockDirectory
          : root,
        message: injectedError.message,
      },
      injectedError.injectionStage,
    );
    assert.equal(
      observation.result.status,
      'error',
      `${injectedError.code}: ${JSON.stringify(observation.result)}\n${
        observation.stderr
      }`,
    );
    assert.equal(observation.result.code, injectedError.code);
    assert.equal(observation.result.message, injectedError.message);
    const remaining = await readdir(paths.root);
    assert.equal(
      remaining.some((name) => name.startsWith(
        '.growth-run.lock.candidate-',
      )),
      false,
      JSON.stringify(remaining),
    );
  }
});

for (const code of ['EACCES', 'EPERM']) {
  test(`candidate publish preserves a real ${code} when the fixed lock is missing`, async (t) => {
    const root = await projectFixture(t);
    const store = await createGrowthRunStore({ projectRoot: root });
    await store.initialize(validRun());
    const paths = await runPaths(root);
    const injectedError = {
      code,
      path: paths.lockDirectory,
      message: `${code}: candidate lock publication denied`,
      repeat: 2,
    };

    const observation = await runInstrumentedReadWorker(
      root,
      paths.lockDirectory,
      1,
      null,
      injectedError,
      'publish',
    );
    assert.deepEqual(
      {
        status: observation.result.status,
        code: observation.result.code,
        message: observation.result.message,
      },
      {
        status: 'error',
        code,
        message: injectedError.message,
      },
      observation.stderr,
    );
    const remaining = await readdir(paths.root);
    assert.equal(
      remaining.some((name) => name.startsWith(
        '.growth-run.lock.candidate-',
      )),
      false,
      JSON.stringify(remaining),
    );
    await assertMissing(paths.lockDirectory);
  });
}

test('a one-shot Windows EPERM during candidate publish converges on retry', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    {
      code: 'EPERM',
      path: paths.lockDirectory,
      message: 'EPERM: transient candidate publish collision',
      repeat: 1,
    },
    'publish',
  );
  assert.equal(
    observation.result.status,
    'success',
    `${JSON.stringify(observation.result)}\n${observation.stderr}`,
  );
});

test('Node on Windows does not replace an existing directory during lock publish', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const root = await projectFixture(t);
  const source = path.join(root, '.growth-run.lock.candidate-proof');
  const target = path.join(root, '.growth-run.lock');
  await mkdir(source);
  await mkdir(target);
  await writeFile(path.join(target, 'owner.json'), 'fixed-owner\n', 'utf8');

  await assert.rejects(
    rename(source, target),
    (error) => ['EACCES', 'EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code),
  );
  assert.equal(
    await readFile(path.join(target, 'owner.json'), 'utf8'),
    'fixed-owner\n',
  );
  assert.equal((await stat(source)).isDirectory(), true);
});

test('a non-ENOENT candidate failure cannot displace a replacement fixed owner', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);
  const replacementOwner = {
    schemaVersion: 1,
    token: 'replacement-owner-token-002',
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  const injectedError = {
    code: 'EACCES',
    path: paths.lockOwnerFile,
    message: 'EACCES: owner publication failed after fixed lock replacement',
  };

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    5,
    replacementOwner,
    injectedError,
    'candidate-owner',
  );
  let fixedOwner = null;
  try {
    fixedOwner = JSON.parse(await readFile(paths.lockOwnerFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  let thirdContender;
  try {
    await store.read(identity());
    thirdContender = { status: 'acquired', message: null };
  } catch (error) {
    thirdContender = { status: 'blocked', message: error.message };
  }

  assert.deepEqual(
    {
      originalStatus: observation.result.status,
      originalCode: observation.result.code,
      fixedOwnerToken: fixedOwner?.token ?? null,
      thirdStatus: thirdContender.status,
      thirdMessageMatches: /lock|timeout|busy/iu.test(
        thirdContender.message ?? '',
      ),
    },
    {
      originalStatus: 'error',
      originalCode: 'EACCES',
      fixedOwnerToken: replacementOwner.token,
      thirdStatus: 'blocked',
      thirdMessageMatches: true,
    },
    `${JSON.stringify(observation.result)}\n${observation.stderr}`,
  );
});

test('stale candidate directories are reclaimed without touching a live candidate', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const candidates = [
    {
      token: 'lock-stale-ownerless-001',
      owner: null,
      stale: true,
    },
    {
      token: 'lock-stale-dead-owner-001',
      owner: {
        schemaVersion: 1,
        token: 'lock-stale-dead-owner-001',
        pid: 99_999_999,
        acquiredAt: '2020-01-01T00:00:00.000Z',
      },
      stale: true,
    },
    {
      token: 'lock-live-candidate-001',
      owner: {
        schemaVersion: 1,
        token: 'lock-live-candidate-001',
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      },
      stale: false,
    },
  ];
  for (const candidate of candidates) {
    candidate.directory = path.join(
      paths.root,
      `.growth-run.lock.candidate-${candidate.token}`,
    );
    await mkdir(candidate.directory);
    if (candidate.owner) {
      await writeFile(
        path.join(candidate.directory, 'owner.json'),
        `${JSON.stringify(candidate.owner)}\n`,
        'utf8',
      );
    } else {
      const old = new Date('2020-01-01T00:00:00.000Z');
      await utimes(candidate.directory, old, old);
    }
  }

  assert.deepEqual(await store.read(identity()), validRun());
  for (const candidate of candidates) {
    if (candidate.stale) {
      await assertMissing(candidate.directory);
    } else {
      assert.equal((await stat(candidate.directory)).isDirectory(), true);
      assert.deepEqual(
        JSON.parse(
          await readFile(
            path.join(candidate.directory, 'owner.json'),
            'utf8',
          ),
        ),
        candidate.owner,
      );
    }
  }
});

test('candidate reclaim continues when an enumerated candidate vanishes during realpath', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const candidate = path.join(
    paths.root,
    '.growth-run.lock.candidate-lock-vanishing-reclaim-001',
  );
  await mkdir(candidate);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(candidate, old, old);

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    1,
    null,
    null,
    'candidate-realpath',
    true,
  );
  assert.equal(
    observation.result.status,
    'success',
    `${JSON.stringify(observation.result)}\n${observation.stderr}`,
  );
});

test('candidate cleanup is idempotent when its own directory vanishes mid-check', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  await mkdir(paths.lockDirectory);
  const old = new Date('2020-01-01T00:00:00.000Z');
  await utimes(paths.lockDirectory, old, old);

  const observation = await runInstrumentedReadWorker(
    root,
    paths.lockDirectory,
    5,
    null,
    null,
    'candidate-realpath',
    true,
  );
  assert.equal(
    observation.result.status,
    'success',
    `${JSON.stringify(observation.result)}\n${observation.stderr}`,
  );
});

for (const injectedError of [
  {
    code: 'EACCES',
    pathKind: 'candidate',
    message: 'EACCES: candidate reclaim permission denied',
  },
  {
    code: 'ENOENT',
    pathKind: 'root',
    message: 'ENOENT: run root vanished outside the candidate',
  },
]) {
  test(`candidate reclaim does not swallow ${injectedError.code} for ${
    injectedError.pathKind
  }`, async (t) => {
    const root = await projectFixture(t);
    const store = await createGrowthRunStore({ projectRoot: root });
    await store.initialize(validRun());
    const paths = await runPaths(root);
    const candidate = path.join(
      paths.root,
      `.growth-run.lock.candidate-lock-negative-${
        injectedError.code.toLowerCase()
      }-001`,
    );
    await mkdir(candidate);
    const old = new Date('2020-01-01T00:00:00.000Z');
    await utimes(candidate, old, old);

    const observation = await runInstrumentedReadWorker(
      root,
      paths.lockDirectory,
      1,
      null,
      {
        code: injectedError.code,
        path: injectedError.pathKind === 'candidate' ? candidate : paths.root,
        message: injectedError.message,
      },
      'candidate-realpath',
      true,
    );
    assert.deepEqual(
      {
        status: observation.result.status,
        code: observation.result.code,
        message: observation.result.message,
      },
      {
        status: 'error',
        code: injectedError.code,
        message: injectedError.message,
      },
      observation.stderr,
    );
  });
}

test('candidate directory links are rejected before stale-lock cleanup', async (t) => {
  const root = await projectFixture(t);
  const outside = await externalFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const candidateLink = path.join(
    paths.root,
    '.growth-run.lock.candidate-lock-malicious-link-001',
  );
  if (!await createDirectoryLinkOrSkip(t, outside, candidateLink)) return;

  await assert.rejects(
    store.read(identity()),
    /link|symbolic|reparse|physical|escape|boundary/iu,
  );
  assert.equal((await stat(outside)).isDirectory(), true);
});

for (const lockKind of ['ownerless', 'dead-pid']) {
  test(`eight Node readers atomically reclaim one expired ${lockKind} lock`, async (t) => {
    const root = await projectFixture(t);
    const store = await createGrowthRunStore({ projectRoot: root });
    await store.initialize(validRun());
    const paths = await runPaths(root);
    await mkdir(paths.lockDirectory);
    if (lockKind === 'dead-pid') {
      await writeFile(
        paths.lockOwnerFile,
        `${JSON.stringify({
          schemaVersion: 1,
          token: 'dead-concurrent-owner-token-001',
          pid: 99_999_999,
          acquiredAt: '2020-01-01T00:00:00.000Z',
        })}\n`,
        'utf8',
      );
    } else {
      const old = new Date('2020-01-01T00:00:00.000Z');
      await utimes(paths.lockDirectory, old, old);
    }

    const triggerFile = path.join(root, `lock-workers-${lockKind}.go`);
    const workers = Array.from(
      { length: 8 },
      (_, index) => startReadWorker(root, `${lockKind}-${index}`, triggerFile),
    );
    await releaseReadWorkerGate(root, workers, triggerFile);
    const results = await Promise.all(
      workers.map(({ completion }) => completion),
    );

    assert.equal(
      results.every((result) => result.status === 'success'),
      true,
      JSON.stringify(results),
    );
    assert.deepEqual(
      results.map(({ state, sequence }) => ({ state, sequence })),
      Array.from({ length: 8 }, () => ({ state: 'intake', sequence: 1 })),
    );
    assert.deepEqual(await store.read(identity()), validRun());
    assert.deepEqual(
      (await store.readTimeline(identity())).map((event) => event.sequence),
      [1],
    );
    const remaining = await readdir(paths.root);
    assert.equal(
      remaining.some((name) => name.startsWith('.growth-run.lock')),
      false,
      JSON.stringify(remaining),
    );
  });
}

test('initialize, transition and read preserve atomic state and append-only timeline', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow(),
  });

  const initialized = await store.initialize(validRun());
  const paths = await runPaths(root);
  const firstTimelineBytes = await readFile(paths.timelineFile, 'utf8');
  const next = await store.transition(identity(), {
    expectedState: 'intake',
    nextState: 'planning',
  });

  assert.deepEqual(initialized, validRun());
  assert.deepEqual(next, {
    ...validRun(),
    state: 'planning',
    sequence: 2,
    updatedAt: '2026-07-29T01:00:00.000Z',
  });
  assert.deepEqual(await store.read(identity()), next);
  assert.equal(Object.isFrozen(store), true);
  assert.equal(Object.isFrozen(initialized), true);
  assert.equal(Object.isFrozen(next), true);

  const timelineBytes = await readFile(paths.timelineFile, 'utf8');
  assert.equal(timelineBytes.startsWith(firstTimelineBytes), true);
  assert.equal(timelineBytes.split('\n').filter(Boolean).length, 2);
  assert.deepEqual(await store.readTimeline(identity()), [
    {
      sequence: 1,
      from: null,
      to: 'intake',
      at: validRun().createdAt,
    },
    {
      sequence: 2,
      from: 'intake',
      to: 'planning',
      at: '2026-07-29T01:00:00.000Z',
    },
  ]);
});

test('module-level lock lets only one competing transition commit across stores', async (t) => {
  const root = await projectFixture(t);
  const firstStore = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow('2026-07-29T01:00:00.000Z'),
  });
  const secondStore = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow('2026-07-29T02:00:00.000Z'),
  });
  await firstStore.initialize(validRun());

  const results = await Promise.allSettled([
    firstStore.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
    }),
    secondStore.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
    }),
  ]);

  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item) => item.status === 'rejected');
  assert.match(rejected.reason.message, /conflict/iu);
  const current = await firstStore.read(identity());
  assert.equal(current.state, 'planning');
  assert.equal(current.sequence, 2);
  assert.deepEqual(
    (await firstStore.readTimeline(identity())).map((item) => item.sequence),
    [1, 2],
  );
});

test('initialize rejects non-intake seeds, non-first sequence and every duplicate', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });

  await assert.rejects(
    store.initialize({ ...validRun(), state: 'planning' }),
    /intake|initial/iu,
  );
  await assert.rejects(
    store.initialize({ ...validRun(), sequence: 2 }),
    /sequence|initial/iu,
  );

  await store.initialize(validRun());
  await assert.rejects(store.initialize(validRun()), /conflict|exist/iu);
  await assert.rejects(
    store.initialize({
      ...validRun(),
      capabilityId: 'competitive-benchmark-analysis',
    }),
    /conflict|exist/iu,
  );
  assert.deepEqual(await store.read(identity()), validRun());
});

test('initialize treats a pre-existing timeline as a conflict and does not overwrite it', async (t) => {
  const root = await projectFixture(t);
  const paths = await runPaths(root);
  await mkdir(paths.root, { recursive: true });
  const sentinel = '{"existing":true}\n';
  await writeFile(paths.timelineFile, sentinel, 'utf8');
  const store = await createGrowthRunStore({ projectRoot: root });

  await assert.rejects(store.initialize(validRun()), /conflict|exist/iu);
  assert.equal(await readFile(paths.timelineFile, 'utf8'), sentinel);
});

test('transition rejects optimistic conflicts and invalid state edges', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());

  await assert.rejects(
    store.transition(identity(), {
      expectedState: 'planning',
      nextState: 'ready',
    }),
    /conflict/iu,
  );
  await assert.rejects(
    store.transition(identity(), {
      expectedState: 'intake',
      nextState: 'completed',
    }),
    /invalid/iu,
  );
  assert.deepEqual(await store.read(identity()), validRun());
  assert.equal((await store.readTimeline(identity())).length, 1);
});

test('read and readTimeline report explicit not found errors', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });

  await assert.rejects(store.read(identity()), /not found/iu);
  await assert.rejects(store.readTimeline(identity()), /not found/iu);
});

test('read rejects state identity mismatch and strict JSON corruption', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);

  await writeFile(
    paths.stateFile,
    `${JSON.stringify({
      ...validRun(),
      enterpriseId: 'enterprise-9988776655443322',
    })}\n`,
    'utf8',
  );
  await assert.rejects(store.read(identity()), /identity mismatch|identity/iu);

  for (const content of [
    '\uFEFF{"schemaVersion":1}',
    '{"schemaVersion":',
  ]) {
    await writeFile(paths.stateFile, content, 'utf8');
    await assert.rejects(store.read(identity()), /BOM|JSON|parse|invalid/iu);
  }
});

test('test clock validates every call and canonicalizes valid date-time values', async (t) => {
  const root = await projectFixture(t);
  await assert.rejects(
    createGrowthRunStore({ projectRoot: root, now: 'not-a-function' }),
    /now|unexpected|field/iu,
  );
  await assert.rejects(
    createGrowthRunStoreForTest({ projectRoot: root, clock: 'not-a-function' }),
    /clock|function/iu,
  );

  const invalidStore = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: () => new Date('invalid'),
  });
  await invalidStore.initialize(validRun());
  await assert.rejects(
    invalidStore.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
    }),
    /clock|date|time|invalid/iu,
  );

  const canonicalStore = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: () => '2026-07-29T02:00:00+01:00',
  });
  const next = await canonicalStore.transition(identity(), {
    expectedState: 'intake',
    nextState: 'planning',
  });
  assert.equal(next.updatedAt, '2026-07-29T01:00:00.000Z');
});

test('transition rejects a clock value earlier than run creation', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow('2026-07-28T23:59:59.000Z'),
  });
  await store.initialize(validRun());

  await assert.rejects(
    store.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
    }),
    /createdAt|earlier|time/iu,
  );
});

test('readTimeline rejects BOM, blank middle lines, malformed JSON and invalid event contracts', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const first = JSON.stringify({
    sequence: 1,
    from: null,
    to: 'intake',
    at: '2026-07-29T00:00:00.000Z',
  });
  const planning = JSON.stringify({
    sequence: 2,
    from: 'intake',
    to: 'planning',
    at: '2026-07-29T01:00:00.000Z',
  });
  const invalidCases = [
    `\uFEFF${first}\n`,
    `${first}\n\n${planning}\n`,
    `${first}\n{"sequence":\n`,
    `${JSON.stringify({
      sequence: 1,
      from: null,
      to: 'intake',
      at: '2026-07-29T00:00:00.000Z',
      extra: true,
    })}\n`,
    `${first}\n${JSON.stringify({
      sequence: 3,
      from: 'intake',
      to: 'planning',
      at: '2026-07-29T01:00:00.000Z',
    })}\n`,
    `${JSON.stringify({
      sequence: 1,
      from: null,
      to: 'planning',
      at: '2026-07-29T00:00:00.000Z',
    })}\n`,
    `${first}\n${JSON.stringify({
      sequence: 2,
      from: 'intake',
      to: 'completed',
      at: '2026-07-29T01:00:00.000Z',
    })}\n`,
    `${first}\n${JSON.stringify({
      sequence: 2,
      from: 'intake',
      to: 'planning',
      at: '2026-07-28T23:59:59.000Z',
    })}\n`,
    `${first}\n${JSON.stringify({
      sequence: 2,
      from: 'intake',
      to: 'planning',
      at: '2026-07-29T01:00:00Z',
    })}\n`,
  ];

  for (const content of invalidCases) {
    await writeFile(paths.timelineFile, content, 'utf8');
    await assert.rejects(
      store.readTimeline(identity()),
      /timeline|event|BOM|blank|JSON|sequence|transition|time|field/iu,
    );
  }
});

test('readTimeline returns a deeply frozen independent array', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());

  const timeline = await store.readTimeline(identity());
  assert.equal(Object.isFrozen(timeline), true);
  assert.equal(Object.isFrozen(timeline[0]), true);
  assert.throws(() => timeline.push({}), TypeError);
  assert.throws(() => {
    timeline[0].to = 'failed';
  }, TypeError);
  assert.equal((await store.readTimeline(identity()))[0].to, 'intake');
});

test('identity and transition inputs require exact stable own data properties', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());

  await assert.rejects(
    store.read({
      enterpriseId: identity().enterpriseId,
      businessProjectId: identity().businessProjectId,
    }),
    /missing|required|runId/iu,
  );
  await assert.rejects(
    store.read({ ...identity(), extra: true }),
    /unexpected|extra|field/iu,
  );
  await assert.rejects(
    store.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
      extra: true,
    }),
    /unexpected|extra|field/iu,
  );

  let identityGetterCalls = 0;
  const getterIdentity = {
    businessProjectId: identity().businessProjectId,
    runId: identity().runId,
  };
  Object.defineProperty(getterIdentity, 'enterpriseId', {
    enumerable: true,
    get() {
      identityGetterCalls += 1;
      return identity().enterpriseId;
    },
  });
  await assert.rejects(store.read(getterIdentity), /accessor|data property/iu);
  assert.equal(identityGetterCalls, 0);

  let transitionGetterCalls = 0;
  const transitionInput = { nextState: 'planning' };
  Object.defineProperty(transitionInput, 'expectedState', {
    enumerable: true,
    get() {
      transitionGetterCalls += 1;
      return 'intake';
    },
  });
  await assert.rejects(
    store.transition(identity(), transitionInput),
    /accessor|data property/iu,
  );
  assert.equal(transitionGetterCalls, 0);
});

test('identity and transition Proxies are rejected without executing traps', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());

  const identityProbe = proxyTrapProbe(identity());
  await assertProxyRejected(() => store.read(identityProbe.proxy), identityProbe);

  const transitionProbe = proxyTrapProbe({
    expectedState: 'intake',
    nextState: 'planning',
  });
  await assertProxyRejected(
    () => store.transition(identity(), transitionProbe.proxy),
    transitionProbe,
  );
});

test('initialize rejects a run-directory junction that escapes projectRoot', async (t) => {
  const root = await projectFixture(t);
  const outside = await externalFixture(t);
  const paths = await runPaths(root);
  await mkdir(path.dirname(paths.root), { recursive: true });
  if (!await createDirectoryLinkOrSkip(t, outside, paths.root)) return;
  const store = await createGrowthRunStore({ projectRoot: root });

  await assert.rejects(
    store.initialize(validRun()),
    /link|symbolic|reparse|physical|escape|boundary/iu,
  );
});

for (const method of ['read', 'transition', 'readTimeline']) {
  test(`${method} rejects a run-directory junction that escapes projectRoot`, async (t) => {
    const root = await projectFixture(t);
    const outside = await externalFixture(t);
    const store = await createGrowthRunStoreForTest({
      projectRoot: root,
      clock: fixedNow(),
    });
    await store.initialize(validRun());
    const paths = await runPaths(root);
    const outsideRun = path.join(outside, 'escaped-run');
    await rename(paths.root, outsideRun);
    if (!await createDirectoryLinkOrSkip(t, outsideRun, paths.root)) return;

    const invoke = {
      read: () => store.read(identity()),
      transition: () => store.transition(identity(), {
        expectedState: 'intake',
        nextState: 'planning',
      }),
      readTimeline: () => store.readTimeline(identity()),
    }[method];
    await assert.rejects(
      invoke(),
      /link|symbolic|reparse|physical|escape|boundary/iu,
    );
  });
}

test('writeEvidenceLedger and readEvidenceLedger preserve run state and timeline', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const stateBefore = await readFile(paths.stateFile, 'utf8');
  const timelineBefore = await readFile(paths.timelineFile, 'utf8');

  const written = await store.writeEvidenceLedger(
    identity(),
    evidenceLedger(),
    { expectedRevision: 0 },
  );
  const read = await store.readEvidenceLedger(identity());

  assert.deepEqual(written, {
    schemaVersion: 1,
    revision: 1,
    ...evidenceLedger(),
  });
  assert.deepEqual(read, written);
  assert.equal(Object.isFrozen(written), true);
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.items), true);
  assert.equal(Object.isFrozen(read.items[0]), true);
  assert.equal(await readFile(paths.stateFile, 'utf8'), stateBefore);
  assert.equal(await readFile(paths.timelineFile, 'utf8'), timelineBefore);
});

test('evidence ledger may be updated atomically but never across identity', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const first = evidenceLedger();
  const second = evidenceLedger({
    items: [{
      ...first.items[0],
      claim: 'updated evidence claim',
      sourceSha256: 'b'.repeat(64),
    }],
  });

  await store.writeEvidenceLedger(
    identity(),
    first,
    { expectedRevision: 0 },
  );
  await store.writeEvidenceLedger(
    identity(),
    second,
    { expectedRevision: 1 },
  );
  assert.deepEqual(await store.readEvidenceLedger(identity()), {
    schemaVersion: 1,
    revision: 2,
    ...second,
  });
  await assert.rejects(
    store.writeEvidenceLedger(identity(), {
      ...first,
      runId: 'run-999',
    }, { expectedRevision: 2 }),
    /identity/iu,
  );
});

test('evidence methods require an existing reconciled run and explicit evidence presence', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await assert.rejects(
    store.writeEvidenceLedger(
      identity(),
      evidenceLedger(),
      { expectedRevision: 0 },
    ),
    /run|state|not found/iu,
  );
  await assert.rejects(
    store.readEvidenceLedger(identity()),
    /run|state|not found/iu,
  );

  await store.initialize(validRun());
  await assert.rejects(
    store.readEvidenceLedger(identity()),
    /evidence|not found/iu,
  );
  const paths = await runPaths(root);
  await writeFile(
    paths.stateFile,
    `${JSON.stringify({ ...validRun(), sequence: 2 })}\n`,
    'utf8',
  );
  await assert.rejects(
    store.writeEvidenceLedger(
      identity(),
      evidenceLedger(),
      { expectedRevision: 0 },
    ),
    /state|timeline|sequence|inconsistent/iu,
  );
});

test('evidence write rejects getters and Proxies without executing user code', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());

  let getterCalls = 0;
  const getterLedger = evidenceLedger();
  Object.defineProperty(getterLedger, 'items', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return evidenceLedger().items;
    },
  });
  await assert.rejects(
    store.writeEvidenceLedger(
      identity(),
      getterLedger,
      { expectedRevision: 0 },
    ),
    /accessor|data property/iu,
  );
  assert.equal(getterCalls, 0);

  const probe = proxyTrapProbe(evidenceLedger());
  await assertProxyRejected(
    () => store.writeEvidenceLedger(
      identity(),
      probe.proxy,
      { expectedRevision: 0 },
    ),
    probe,
  );

  let optionGetterCalls = 0;
  const getterOptions = {};
  Object.defineProperty(getterOptions, 'expectedRevision', {
    enumerable: true,
    get() {
      optionGetterCalls += 1;
      return 0;
    },
  });
  await assert.rejects(
    store.writeEvidenceLedger(identity(), evidenceLedger(), getterOptions),
    /expectedRevision|accessor|data property/iu,
  );
  assert.equal(optionGetterCalls, 0);

  const optionProbe = proxyTrapProbe({ expectedRevision: 0 });
  await assertProxyRejected(
    () => store.writeEvidenceLedger(
      identity(),
      evidenceLedger(),
      optionProbe.proxy,
    ),
    optionProbe,
  );
  for (const options of [
    undefined,
    {},
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expectedRevision: 0, extra: true },
  ]) {
    await assert.rejects(
      store.writeEvidenceLedger(identity(), evidenceLedger(), options),
      /expectedRevision|missing|safe integer|unexpected|plain object/iu,
    );
  }
});

test('readEvidenceLedger uses strict JSON and validates persisted identity', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  await store.writeEvidenceLedger(
    identity(),
    evidenceLedger(),
    { expectedRevision: 0 },
  );
  const paths = await runPaths(root);

  for (const content of [
    '\uFEFF{"schemaVersion":1}',
    '{"schemaVersion":1,"schemaVersion":1}',
    '{"schemaVersion":',
    `${JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      ...evidenceLedger(),
      runId: 'run-999',
    })}\n`,
  ]) {
    await writeFile(paths.evidenceFile, content, 'utf8');
    await assert.rejects(
      store.readEvidenceLedger(identity()),
      /BOM|duplicate|JSON|identity|invalid/iu,
    );
  }
});

test('evidence file symbolic links and junction-style reparse points are rejected', async (t) => {
  const root = await projectFixture(t);
  const outside = await externalFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const paths = await runPaths(root);
  const outsideFile = path.join(outside, 'evidence.json');
  await writeFile(outsideFile, `${JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    ...evidenceLedger(),
  })}\n`, 'utf8');
  try {
    await symlink(outsideFile, paths.evidenceFile, 'file');
  } catch (error) {
    if (['EACCES', 'ENOSYS', 'EPERM'].includes(error?.code)) {
      t.skip(`file link creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    store.readEvidenceLedger(identity()),
    /link|symbolic|reparse|physical|escape|boundary/iu,
  );
  await assert.rejects(
    store.writeEvidenceLedger(
      identity(),
      evidenceLedger(),
      { expectedRevision: 0 },
    ),
    /link|symbolic|reparse|physical|escape|boundary/iu,
  );
});

test('different competing evidence writers use CAS without lost updates', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const values = Array.from({ length: 6 }, (_, index) => evidenceLedger({
    items: [{
      ...evidenceLedger().items[0],
      claim: `concurrent evidence claim ${index}`,
      sourceSha256: String(index + 1).repeat(64),
    }],
  }));

  const results = await Promise.all(
    values.map((value) => runEvidenceWriteWorker(root, value, 0)),
  );
  assert.equal(
    results.filter((result) => result.status === 'success').length,
    1,
    JSON.stringify(results),
  );
  assert.equal(
    results.filter(
      (result) => result.status === 'error' && /conflict/iu.test(result.message),
    ).length,
    5,
    JSON.stringify(results),
  );
  const read = await store.readEvidenceLedger(identity());
  assert.equal(read.revision, 1);
  assert.equal(
    values.some((value) => value.items[0].claim === read.items[0].claim),
    true,
  );
  assert.equal(read.items[0].sourceSha256.length, 64);

  const updates = [7, 8].map((value) => evidenceLedger({
    items: [{
      ...evidenceLedger().items[0],
      claim: `revision one update ${value}`,
      sourceSha256: String(value).repeat(64),
    }],
  }));
  const updateResults = await Promise.all(
    updates.map((value) => runEvidenceWriteWorker(root, value, 1)),
  );
  assert.equal(
    updateResults.filter((result) => result.status === 'success').length,
    1,
    JSON.stringify(updateResults),
  );
  assert.equal(
    updateResults.filter(
      (result) => result.status === 'error' && /conflict/iu.test(result.message),
    ).length,
    1,
    JSON.stringify(updateResults),
  );
  assert.equal((await store.readEvidenceLedger(identity())).revision, 2);
});

test('same-content competing evidence writers are idempotent at one revision', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const value = evidenceLedger();
  const results = await Promise.all(
    Array.from(
      { length: 6 },
      () => runEvidenceWriteWorker(root, value, 0),
    ),
  );
  assert.equal(
    results.every(
      (result) => result.status === 'success' && result.revision === 1,
    ),
    true,
    JSON.stringify(results),
  );
  const read = await store.readEvidenceLedger(identity());
  assert.equal(read.revision, 1);
  assert.deepEqual(read.items, value.items);
});

test('persisted evidence revision must equal expectedRevision', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  await assert.rejects(
    store.writeEvidenceLedger(identity(), {
      schemaVersion: 1,
      revision: 1,
      ...evidenceLedger(),
    }, { expectedRevision: 0 }),
    /revision|expected/iu,
  );
  const current = await store.writeEvidenceLedger(
    identity(),
    evidenceLedger(),
    { expectedRevision: 0 },
  );
  const updated = await store.writeEvidenceLedger(identity(), {
    ...current,
    items: [{
      ...current.items[0],
      claim: 'persisted update',
      sourceSha256: 'b'.repeat(64),
    }],
  }, { expectedRevision: 1 });
  assert.equal(updated.revision, 2);
});

test('run stores carry an unforgeable brand immune to WeakSet prototype pollution', async (t) => {
  const root = await projectFixture(t);
  const hasDescriptor = Object.getOwnPropertyDescriptor(
    WeakSet.prototype,
    'has',
  );
  const addDescriptor = Object.getOwnPropertyDescriptor(
    WeakSet.prototype,
    'add',
  );
  let store;
  let captured;
  try {
    Object.defineProperty(WeakSet.prototype, 'has', {
      ...hasDescriptor,
      value() {
        throw new Error('SENTINEL_WEAKSET_HAS');
      },
    });
    Object.defineProperty(WeakSet.prototype, 'add', {
      ...addDescriptor,
      value() {
        throw new Error('SENTINEL_WEAKSET_ADD');
      },
    });
    store = await createGrowthRunStore({ projectRoot: root });
    assert.equal(isTrustedGrowthRunStore(store), true);
  } catch (error) {
    captured = error;
  } finally {
    Object.defineProperty(WeakSet.prototype, 'has', hasDescriptor);
    Object.defineProperty(WeakSet.prototype, 'add', addDescriptor);
  }
  assert.ifError(captured);

  for (const fake of [
    null,
    {},
    { ...store },
    Object.assign({}, store),
    Object.create(store),
    new Proxy(store, {}),
  ]) {
    assert.equal(isTrustedGrowthRunStore(fake), false);
  }
});

test('P1 regression: public factory rejects historical clock re-mint options', async (t) => {
  const root = await projectFixture(t);
  const authoritative = await createGrowthRunStore({ projectRoot: root });
  assert.equal(isTrustedGrowthRunStore(authoritative), true);

  await assert.rejects(
    createGrowthRunStore({
      projectRoot: root,
      now: () => new Date('2000-01-01T00:00:00.000Z'),
    }),
    /now|unexpected|projectRoot/iu,
  );
});

test('production store clock is isolated from post-import Date.now replacement', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await store.initialize(validRun());
  const originalDateNow = Date.now;
  let next;
  try {
    Date.now = () => 946_684_800_000;
    next = await store.transition(identity(), {
      expectedState: 'intake',
      nextState: 'planning',
    });
  } finally {
    Date.now = originalDateNow;
  }
  assert.notEqual(next.updatedAt, '2000-01-01T00:00:00.000Z');
  assert.ok(Date.parse(next.updatedAt) > Date.parse(validRun().createdAt));
});

test('test-only factory creates untrusted state stores with no approval authority', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStoreForTest({
    projectRoot: root,
    clock: fixedNow('2000-01-01T00:00:00.000Z'),
  });
  assert.equal(isTrustedGrowthRunStore(store), false);
  await store.initialize({
    ...validRun(),
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
  });
  await assert.rejects(
    store.recordApproval(identity(), approval({
      decidedAt: '1999-12-31T23:00:00.000Z',
      expiresAt: '2000-01-01T01:00:00.000Z',
    }), { expectedRevision: 0 }),
    /test|authoritative|approval|trusted/iu,
  );
});

test('only the first production store for one canonical root has approval authority', async (t) => {
  const root = await projectFixture(t);
  const authoritative = await createGrowthRunStore({ projectRoot: root });
  const later = await createGrowthRunStore({ projectRoot: root });
  assert.equal(isTrustedGrowthRunStore(authoritative), true);
  assert.equal(isTrustedGrowthRunStore(later), false);

  await advanceToAwaitingApproval(authoritative);
  await assert.rejects(
    later.recordApproval(identity(), approval(), { expectedRevision: 0 }),
    /authoritative|approval|trusted/iu,
  );
  await authoritative.recordApproval(identity(), approval(), {
    expectedRevision: 0,
  });
  await authoritative.transition(identity(), {
    expectedState: 'awaiting_approval',
    nextState: 'running_approved',
  });
  await assert.rejects(
    later.consumeExternalApproval(identity(), {
      action: 'publish_content',
      approvalId: 'approval-001',
    }),
    /authoritative|approval|trusted/iu,
  );
});

test('test-only factory is locked when the module loads outside Node test context', async (t) => {
  const root = await projectFixture(t);
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, '..', 'scripts', 'growth_run_store.mjs'),
  ).href;
  const script = `
    import { createGrowthRunStoreForTest } from ${JSON.stringify(moduleUrl)};
    try {
      await createGrowthRunStoreForTest({
        projectRoot: process.env.GROWTH_TEST_ROOT,
        clock: () => new Date('2000-01-01T00:00:00.000Z'),
      });
      process.stdout.write(JSON.stringify({ status: 'unexpected-success' }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: 'rejected',
        message: error.message,
      }));
    }
  `;
  const {
    NODE_TEST_CONTEXT: ignoredNodeTestContext,
    ...nonTestEnvironment
  } = process.env;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...nonTestEnvironment,
        GROWTH_TEST_ROOT: root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`non-test factory worker exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`invalid non-test worker output: ${stdout}`, {
          cause: error,
        }));
      }
    });
  });
  assert.equal(result.status, 'rejected');
  assert.match(result.message, /test|context|unavailable/iu);
});

test('recordApproval persists an identity-bound frozen revision without changing run history', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await advanceToAwaitingApproval(store);
  const paths = await runPaths(root);
  const stateBefore = await readFile(paths.stateFile, 'utf8');
  const timelineBefore = await readFile(paths.timelineFile, 'utf8');
  const approvalValue = approval();

  const result = await store.recordApproval(
    identity(),
    approvalValue,
    { expectedRevision: 0 },
  );
  assert.deepEqual(result, {
    schemaVersion: 1,
    revision: 1,
    enterpriseId: identity().enterpriseId,
    businessProjectId: identity().businessProjectId,
    ...approvalValue,
    consumedActions: [],
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.allowedActions), true);
  assert.equal(Object.isFrozen(result.consumedActions), true);
  assert.deepEqual(
    JSON.parse(await readFile(paths.approvalFile, 'utf8')),
    result,
  );
  assert.equal(await readFile(paths.stateFile, 'utf8'), stateBefore);
  assert.equal(await readFile(paths.timelineFile, 'utf8'), timelineBefore);
});

test('recordApproval enforces exact helper fields, identity, actions, decision and time', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await advanceToAwaitingApproval(store);

  const invalidApprovals = [
    { ...approval(), schemaVersion: 1 },
    { ...approval(), runId: 'run-999' },
    { ...approval(), approvalId: '../unsafe' },
    { ...approval(), decision: 'approve' },
    { ...approval(), decision: 'unknown' },
    { ...approval(), decidedAt: '2026-07-29T11:00:00Z' },
    { ...approval(), expiresAt: '2026-07-29T13:00:00Z' },
    { ...approval(), expiresAt: '2026-07-29T11:00:00.000Z' },
    { ...approval(), allowedActions: ['publish_content', 'publish_content'] },
    { ...approval(), allowedActions: ['internal_analysis'] },
    { ...approval(), allowedActions: ['unknown_action'] },
  ];
  const sparse = new Array(2);
  sparse[0] = 'publish_content';
  invalidApprovals.push({ ...approval(), allowedActions: sparse });
  const abnormalPrototype = ['publish_content'];
  Object.setPrototypeOf(abnormalPrototype, Object.create(Array.prototype));
  invalidApprovals.push({ ...approval(), allowedActions: abnormalPrototype });

  for (const value of invalidApprovals) {
    await assert.rejects(
      store.recordApproval(identity(), value, { expectedRevision: 0 }),
      /approval|unexpected|identity|runId|unsafe|decision|time|timestamp|unique|external|dense|prototype/iu,
    );
  }

  let approvalGetterCalls = 0;
  const getterApproval = approval();
  Object.defineProperty(getterApproval, 'decision', {
    enumerable: true,
    get() {
      approvalGetterCalls += 1;
      return 'approved';
    },
  });
  await assert.rejects(
    store.recordApproval(identity(), getterApproval, {
      expectedRevision: 0,
    }),
    /accessor|data property/iu,
  );
  assert.equal(approvalGetterCalls, 0);

  const approvalProbe = proxyTrapProbe(approval());
  await assertProxyRejected(
    () => store.recordApproval(identity(), approvalProbe.proxy, {
      expectedRevision: 0,
    }),
    approvalProbe,
  );

  let optionGetterCalls = 0;
  const getterOptions = {};
  Object.defineProperty(getterOptions, 'expectedRevision', {
    enumerable: true,
    get() {
      optionGetterCalls += 1;
      return 0;
    },
  });
  await assert.rejects(
    store.recordApproval(identity(), approval(), getterOptions),
    /accessor|data property/iu,
  );
  assert.equal(optionGetterCalls, 0);

  const optionProbe = proxyTrapProbe({ expectedRevision: 0 });
  await assertProxyRejected(
    () => store.recordApproval(
      identity(),
      approval(),
      optionProbe.proxy,
    ),
    optionProbe,
  );
});

test('recordApproval uses CAS, preserves same-content idempotency and rejects stale changes', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await advanceToAwaitingApproval(store);
  const approvalValue = approval();
  const first = await store.recordApproval(
    identity(),
    approvalValue,
    { expectedRevision: 0 },
  );
  const repeated = await store.recordApproval(
    identity(),
    approvalValue,
    { expectedRevision: 0 },
  );
  assert.deepEqual(repeated, first);

  const changed = approval({
    allowedActions: ['publish_content', 'paid_media'],
  });
  await assert.rejects(
    store.recordApproval(identity(), changed, {
      expectedRevision: 0,
    }),
    /revision|conflict/iu,
  );
  const updated = await store.recordApproval(
    identity(),
    changed,
    { expectedRevision: 1 },
  );
  assert.equal(updated.revision, 2);
  assert.deepEqual(updated.allowedActions, changed.allowedActions);
  assert.deepEqual(updated.consumedActions, []);
});

test('consumeExternalApproval validates options without executing getters or Proxies', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);
  for (const value of [
    undefined,
    null,
    {},
    { action: 'publish_content' },
    { approvalId: 'approval-001' },
    {
      action: 'publish_content',
      approvalId: 'approval-001',
      at: '2000-01-01T00:00:00.000Z',
    },
    { action: 'internal_analysis', approvalId: 'approval-001' },
    { action: 'publish_content', approvalId: '../unsafe' },
  ]) {
    await assert.rejects(
      store.consumeExternalApproval(identity(), value),
      /plain|missing|unexpected|action|external|approvalId|unsafe/iu,
    );
  }

  let getterCalls = 0;
  const getterOptions = { approvalId: 'approval-001' };
  Object.defineProperty(getterOptions, 'action', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'publish_content';
    },
  });
  await assert.rejects(
    store.consumeExternalApproval(identity(), getterOptions),
    /accessor|data property/iu,
  );
  assert.equal(getterCalls, 0);

  const probe = proxyTrapProbe({
    action: 'publish_content',
    approvalId: 'approval-001',
  });
  await assertProxyRejected(
    () => store.consumeExternalApproval(identity(), probe.proxy),
    probe,
  );
});

test('consumeExternalApproval atomically writes one-time authorization receipts', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  const approvalValue = approval();
  await prepareApprovedRun(store, approvalValue);
  const beforeAuthorizedAt = Date.now();
  const receipt = await store.consumeExternalApproval(identity(), {
    action: 'publish_content',
    approvalId: 'approval-001',
  });
  const afterAuthorizedAt = Date.now();
  assert.equal(receipt.allowed, true);
  assert.equal(receipt.action, 'publish_content');
  assert.equal(receipt.runId, 'run-001');
  assert.equal(receipt.approvalId, 'approval-001');
  assert.equal(receipt.expiresAt, approvalValue.expiresAt);
  assert.equal(receipt.approvalRevision, 2);
  assert.ok(Date.parse(receipt.authorizedAt) >= beforeAuthorizedAt);
  assert.ok(Date.parse(receipt.authorizedAt) <= afterAuthorizedAt);
  assert.match(receipt.authorizationId, /^[a-z0-9][a-z0-9-]{2,119}$/u);
  assert.equal(Object.isFrozen(receipt), true);

  const paths = await runPaths(root);
  const persisted = JSON.parse(await readFile(paths.approvalFile, 'utf8'));
  assert.equal(persisted.revision, 2);
  assert.deepEqual(persisted.consumedActions, [{
    action: 'publish_content',
    consumedAt: receipt.authorizedAt,
    authorizationId: receipt.authorizationId,
  }]);
  await assert.rejects(
    store.consumeExternalApproval(identity(), {
      action: 'publish_content',
      approvalId: 'approval-001',
    }),
    /replay|consumed|conflict/iu,
  );
  const second = await store.consumeExternalApproval(identity(), {
    action: 'paid_media',
    approvalId: 'approval-001',
  });
  assert.equal(second.approvalRevision, 3);
});

test('consumeExternalApproval requires running_approved and matching approved authority', async (t) => {
  const waitingRoot = await projectFixture(t);
  const waitingStore = await createGrowthRunStore({
    projectRoot: waitingRoot,
  });
  await advanceToAwaitingApproval(waitingStore);
  await waitingStore.recordApproval(identity(), approval({
    allowedActions: ['publish_content'],
  }), { expectedRevision: 0 });
  await assert.rejects(
    waitingStore.consumeExternalApproval(identity(), {
      action: 'publish_content',
      approvalId: 'approval-001',
    }),
    /running_approved|state/iu,
  );

  await waitingStore.transition(identity(), {
    expectedState: 'awaiting_approval',
    nextState: 'running_approved',
  });
  await assert.rejects(
    waitingStore.consumeExternalApproval(identity(), {
      action: 'publish_content',
      approvalId: 'approval-999',
    }),
    /approvalId|match|identity/iu,
  );
  await assert.rejects(
    waitingStore.consumeExternalApproval(identity(), {
      action: 'write_external_system',
      approvalId: 'approval-001',
    }),
    /allowed|action|approval/iu,
  );

  const rejectedRoot = await projectFixture(t);
  const rejectedStore = await createGrowthRunStore({
    projectRoot: rejectedRoot,
  });
  await prepareApprovedRun(rejectedStore, approval({
    decision: 'rejected',
  }));
  await assert.rejects(
    rejectedStore.consumeExternalApproval(identity(), {
      action: 'publish_content',
      approvalId: 'approval-001',
    }),
    /decision|approved|rejected/iu,
  );
});

test('trusted store time rejects not-yet-decided, expired and exact-expiry approvals', async (t) => {
  const now = Date.now();
  for (const [approvalValue, pattern] of [
    [
      approval({
        decidedAt: new Date(now + 60_000).toISOString(),
        expiresAt: new Date(now + 120_000).toISOString(),
      }),
      /decided|time|not yet/iu,
    ],
    [
      approval({
        decidedAt: new Date(now - 120_000).toISOString(),
        expiresAt: new Date(now - 1).toISOString(),
      }),
      /expired|time/iu,
    ],
    [
      approval({
        decidedAt: '2000-01-01T11:00:00.000Z',
        expiresAt: '2000-01-01T13:00:00.000Z',
      }),
      /expired|time/iu,
    ],
  ]) {
    const root = await projectFixture(t);
    const store = await createGrowthRunStore({ projectRoot: root });
    await prepareApprovedRun(store, approvalValue);
    await assert.rejects(
      store.consumeExternalApproval(identity(), {
        action: 'publish_content',
        approvalId: 'approval-001',
      }),
      pattern,
    );
  }
});

test('consume rejects malformed, mismatched and linked approval files', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);
  const paths = await runPaths(root);
  const original = JSON.parse(await readFile(paths.approvalFile, 'utf8'));
  for (const content of [
    '\uFEFF{"schemaVersion":1}',
    '{"schemaVersion":1,"schemaVersion":1}',
    '{"schemaVersion":',
    `${JSON.stringify({ ...original, runId: 'run-999' })}\n`,
    `${JSON.stringify({
      ...original,
      enterpriseId: 'enterprise-9988776655443322',
    })}\n`,
    `${JSON.stringify({
      ...original,
      consumedActions: [{
        action: 'internal_analysis',
        consumedAt: '2026-07-29T12:00:00.000Z',
        authorizationId: 'authorization-001',
      }],
    })}\n`,
  ]) {
    await writeFile(paths.approvalFile, content, 'utf8');
    await assert.rejects(
      store.consumeExternalApproval(identity(), {
        action: 'publish_content',
        approvalId: 'approval-001',
      }),
      /BOM|duplicate|JSON|identity|runId|approval|external|invalid/iu,
    );
  }

  const linkRoot = await projectFixture(t);
  const outside = await externalFixture(t);
  const linkStore = await createGrowthRunStore({
    projectRoot: linkRoot,
  });
  await advanceToAwaitingApproval(linkStore);
  const linkPaths = await runPaths(linkRoot);
  const outsideApproval = path.join(outside, 'approval.json');
  await writeFile(outsideApproval, `${JSON.stringify(original)}\n`, 'utf8');
  try {
    await symlink(outsideApproval, linkPaths.approvalFile, 'file');
  } catch (error) {
    if (['EACCES', 'ENOSYS', 'EPERM'].includes(error?.code)) {
      t.skip(`file link creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    linkStore.recordApproval(identity(), approval(), {
      expectedRevision: 0,
    }),
    /link|symbolic|reparse|physical|escape|boundary/iu,
  );
});

test('six processes can consume one approval action only once', async (t) => {
  const root = await projectFixture(t);
  const store = await createGrowthRunStore({ projectRoot: root });
  await prepareApprovedRun(store);

  const results = await Promise.all(
    Array.from(
      { length: 6 },
      () => runApprovalConsumeWorker(root),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'authorized').length,
    1,
    JSON.stringify(results),
  );
  assert.equal(
    results.filter(
      (result) => (
        result.status === 'error'
        && /replay|consumed|conflict/iu.test(result.message)
      ),
    ).length,
    5,
    JSON.stringify(results),
  );
  const authorizationIds = results
    .filter((result) => result.status === 'authorized')
    .map((result) => result.authorizationId);
  assert.equal(new Set(authorizationIds).size, 1);
});
