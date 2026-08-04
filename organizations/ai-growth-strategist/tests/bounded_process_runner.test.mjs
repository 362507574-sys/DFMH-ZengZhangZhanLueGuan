import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport('scripts/bounded_process_runner.mjs');
const COMMAND_TIMEOUT_MS = 2_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const PID_RECORD_WAIT_MS = 1_500;

test('超时后等待父进程与派生子进程都确认退出', async (t) => {
  assert.equal(
    typeof loaded.module?.runBoundedCommand,
    'function',
    loaded.error?.message ?? 'runBoundedCommand missing',
  );
  if (!loaded.module) return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-timeout-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidFile = path.join(root, 'pids.json');
  await exerciseTimeoutTree(pidFile, 'timeout tree fixture');
});

test('高并发冷启动下重复超时仍产生完整PID记录且不遗留进程', async (t) => {
  assert.equal(
    typeof loaded.module?.runBoundedCommand,
    'function',
    loaded.error?.message ?? 'runBoundedCommand missing',
  );
  if (!loaded.module) return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'growth-timeout-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let round = 0; round < 2; round += 1) {
    await Promise.all([0, 1].map((lane) => exerciseTimeoutTree(
      path.join(root, `pids-${round}-${lane}.json`),
      `timeout race fixture ${round}-${lane}`,
    )));
  }
});

async function exerciseTimeoutTree(pidFile, label) {
  await assert.rejects(
    loaded.module.runBoundedCommand({
      command: process.execPath,
      args: [
        path.join(
          organizationRoot,
          'tests',
          'fixtures',
          'spawn-long-lived-child.mjs',
        ),
        pidFile,
      ],
      cwd: organizationRoot,
      label,
      timeoutMs: COMMAND_TIMEOUT_MS,
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    }),
    /timed out/u,
  );
  const pids = await readCompletePidRecord(pidFile);
  const survivors = [
    ['parent', pids.parentPid],
    ['child', pids.childPid],
  ].filter(([, pid]) => isAlive(pid));
  for (const [, pid] of survivors) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  assert.deepEqual(
    survivors,
    [],
    `timeout process tree still alive: ${JSON.stringify(survivors)}`,
  );
}

async function readCompletePidRecord(pidFile) {
  const deadline = Date.now() + PID_RECORD_WAIT_MS;
  let lastTransientError;
  do {
    try {
      const parsed = JSON.parse(await readFile(pidFile, 'utf8'));
      assert.deepEqual(
        Object.keys(parsed).sort(),
        ['childPid', 'parentPid'],
        'PID record fields differ',
      );
      for (const field of ['parentPid', 'childPid']) {
        assert.equal(
          Number.isSafeInteger(parsed[field]) && parsed[field] > 0,
          true,
          `${field} must be a positive safe integer`,
        );
      }
      return parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
      lastTransientError = error;
      await delay(25);
    }
  } while (Date.now() < deadline);
  throw new Error(
    `PID record did not become complete within ${PID_RECORD_WAIT_MS}ms`,
    { cause: lastTransientError },
  );
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}
