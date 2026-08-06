import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { runBoundedCommand } from './bounded_process_runner.mjs';

const META_TESTS = Object.freeze([
  'generate_shared_runtime_checkpoint.test.mjs',
  'organization_self_check.test.mjs',
]);
const GROUP_TIMEOUT_MS = 10 * 60_000;
const TOTAL_TIMEOUT_MS = 30 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const SAFE_TEST_NAME = /^[a-z0-9][a-z0-9_.-]*\.test\.mjs$/u;

export function classifyOrganizationTests(testNames) {
  if (!Array.isArray(testNames) || testNames.length < 1) {
    throw new TypeError('testNames must be a non-empty array');
  }
  const seen = new Set();
  const normalized = testNames.map((name) => {
    if (
      typeof name !== 'string'
      || !SAFE_TEST_NAME.test(name)
      || path.basename(name) !== name
    ) {
      throw new Error(`unsafe organization test name: ${String(name)}`);
    }
    if (seen.has(name)) {
      throw new Error(`duplicate organization test name: ${name}`);
    }
    seen.add(name);
    return name;
  }).sort(compareText);
  for (let index = 0; index < META_TESTS.length; index += 1) {
    const required = META_TESTS[index];
    if (!seen.has(required)) {
      throw new Error(`missing checkpoint meta test: ${required}`);
    }
  }
  const metaSet = new Set(META_TESTS);
  const core = normalized.filter((name) => !metaSet.has(name));
  if (core.length < 1) {
    throw new Error('organization core test group must not be empty');
  }
  return Object.freeze({
    core: Object.freeze(core),
    meta: META_TESTS,
  });
}

export async function runOrganizationTestPlan() {
  if (arguments.length !== 0) {
    throw new TypeError(
      'production organization test plan accepts zero arguments and uses its fixed project root',
    );
  }
  const organizationRoot = path.resolve(import.meta.dirname, '..');
  const projectRoot = path.resolve(organizationRoot, '..', '..');
  const testsRoot = path.join(organizationRoot, 'tests');
  const entries = await readdir(testsRoot, { withFileTypes: true });
  const testNames = entries.flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.test.mjs')) return [];
    return [entry.name];
  });
  const plan = classifyOrganizationTests(testNames);
  const groups = [
    Object.freeze({ label: 'organization core tests', names: plan.core }),
    ...plan.meta.map((name) => Object.freeze({
      label: `organization meta test ${name}`,
      names: Object.freeze([name]),
    })),
  ];
  const startedAt = performance.now();
  const results = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const remainingMs = Math.floor(
      TOTAL_TIMEOUT_MS - (performance.now() - startedAt),
    );
    if (remainingMs < 1) {
      throw new Error(
        `organization test plan timed out before ${group.label} after ${TOTAL_TIMEOUT_MS}ms`,
      );
    }
    const timeoutMs = Math.min(GROUP_TIMEOUT_MS, remainingMs);
    process.stderr.write(`[growth-self-check] start ${group.label}\n`);
    const streams = await runBoundedCommand({
      command: process.execPath,
      args: [
        '--test',
        '--test-concurrency=1',
        '--test-reporter=tap',
        ...group.names.map((name) => path.join(testsRoot, name)),
      ],
      cwd: projectRoot,
      label: group.label,
      timeoutMs,
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
      env: childEnvironment(),
    });
    const summary = parseTapSummary(streams, group.label);
    results.push(Object.freeze({
      label: group.label,
      files: group.names.length,
      tests: summary.tests,
      passed: summary.passed,
      failed: summary.failed,
    }));
    process.stderr.write(
      `[growth-self-check] pass ${group.label}: ${summary.passed}/${summary.tests}\n`,
    );
  }
  return Object.freeze({
    ok: true,
    concurrency: 1,
    coreFiles: plan.core.length,
    metaFiles: plan.meta.length,
    totalTests: results.reduce((sum, item) => sum + item.tests, 0),
    groups: Object.freeze(results),
  });
}

function childEnvironment() {
  const environment = { ...process.env, PYTHONUTF8: '1' };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

function parseTapSummary(streams, label) {
  const output = `${streams.stdout}\n${streams.stderr}`;
  const tests = [...output.matchAll(/^# tests (\d+)\r?$/gmu)];
  const passes = [...output.matchAll(/^# pass (\d+)\r?$/gmu)];
  const failures = [...output.matchAll(/^# fail (\d+)\r?$/gmu)];
  if (tests.length !== 1 || passes.length !== 1 || failures.length !== 1) {
    throw new Error(`${label} did not emit one canonical TAP summary`);
  }
  const summary = {
    tests: Number(tests[0][1]),
    passed: Number(passes[0][1]),
    failed: Number(failures[0][1]),
  };
  if (
    !Number.isSafeInteger(summary.tests)
    || summary.tests < 1
    || summary.passed !== summary.tests
    || summary.failed !== 0
  ) {
    throw new Error(`${label} TAP summary did not prove all tests passed`);
  }
  return summary;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const result = await runOrganizationTestPlan();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
