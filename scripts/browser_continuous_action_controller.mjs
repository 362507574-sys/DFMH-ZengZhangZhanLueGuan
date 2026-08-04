import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class ContinuousActionError extends Error {
  constructor(message, { code, step = '', timeline = [], cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ContinuousActionError';
    this.code = code || 'CONTINUOUS_ACTION_FAILED';
    this.step = step;
    this.timeline = timeline;
  }
}

function requireFunction(value, label) {
  if (typeof value !== 'function') {
    throw new TypeError(`${label} must be a function.`);
  }
}

function requirePositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive number.`);
  }
}

function appendEvent(timeline, now, sequenceStartedAt, event) {
  const timestampMs = now();
  const entry = {
    ...event,
    timestampMs,
    elapsedMs: timestampMs - sequenceStartedAt,
  };
  timeline.push(entry);
  return entry;
}

function createStepError(message, { code, step, timeline, cause }) {
  appendEvent(timeline, () => timeline.__now(), timeline.__startedAt, {
    event: 'step_failed',
    step,
    code,
    message,
  });
  return new ContinuousActionError(message, {
    code,
    step,
    timeline: [...timeline],
    cause,
  });
}

export async function runContinuousActionSequence({
  sequenceName,
  steps,
  context = {},
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onEvent = async () => {},
} = {}) {
  if (!sequenceName || typeof sequenceName !== 'string') {
    throw new TypeError('sequenceName must be a non-empty string.');
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError('steps must be a non-empty array.');
  }
  requireFunction(now, 'now');
  requireFunction(sleep, 'sleep');
  requireFunction(onEvent, 'onEvent');

  const sequenceStartedAt = now();
  const timeline = [];
  Object.defineProperties(timeline, {
    __now: { value: now },
    __startedAt: { value: sequenceStartedAt },
  });

  const emit = async (event) => {
    const entry = appendEvent(timeline, now, sequenceStartedAt, event);
    await onEvent(entry);
    return entry;
  };

  await emit({ event: 'sequence_started', sequence: sequenceName });

  for (const step of steps) {
    if (!step || !step.name || typeof step.name !== 'string') {
      throw new TypeError('Every step must have a non-empty name.');
    }
    requireFunction(step.condition, `${step.name}.condition`);
    if (step.action !== undefined) {
      requireFunction(step.action, `${step.name}.action`);
    }
    requirePositiveNumber(step.timeoutMs, `${step.name}.timeoutMs`);
    requirePositiveNumber(step.pollIntervalMs, `${step.name}.pollIntervalMs`);
    if (step.actionSlaMs !== undefined) {
      requirePositiveNumber(step.actionSlaMs, `${step.name}.actionSlaMs`);
    }

    const waitStartedAt = now();
    await emit({ event: 'condition_wait_started', step: step.name });

    while (true) {
      let conditionMet;
      try {
        conditionMet = await step.condition(context);
      } catch (cause) {
        throw createStepError(`Condition check failed for ${step.name}.`, {
          code: 'CONDITION_CHECK_FAILED',
          step: step.name,
          timeline,
          cause,
        });
      }

      if (conditionMet) {
        await emit({
          event: 'condition_met',
          step: step.name,
          waitDurationMs: now() - waitStartedAt,
        });
        break;
      }

      const elapsed = now() - waitStartedAt;
      if (elapsed >= step.timeoutMs) {
        throw createStepError(`Condition timed out for ${step.name}.`, {
          code: 'CONDITION_TIMEOUT',
          step: step.name,
          timeline,
        });
      }

      await sleep(Math.min(step.pollIntervalMs, step.timeoutMs - elapsed));
    }

    if (step.action) {
      const actionStartedAt = now();
      await emit({
        event: 'action_started',
        step: step.name,
        actionSlaMs: step.actionSlaMs ?? null,
      });
      try {
        await step.action(context);
      } catch (cause) {
        throw createStepError(`Action failed for ${step.name}.`, {
          code: 'ACTION_FAILED',
          step: step.name,
          timeline,
          cause,
        });
      }

      const actionDurationMs = now() - actionStartedAt;
      await emit({
        event: 'action_completed',
        step: step.name,
        actionDurationMs,
        actionSlaMs: step.actionSlaMs ?? null,
        slaBreached: step.actionSlaMs !== undefined && actionDurationMs > step.actionSlaMs,
      });
    }

    await emit({ event: 'step_completed', step: step.name });
  }

  await emit({ event: 'sequence_completed', sequence: sequenceName });
  return {
    sequenceName,
    status: 'completed',
    context,
    durationMs: now() - sequenceStartedAt,
    timeline: [...timeline],
  };
}

export async function writeTimelineFile({
  projectRoot,
  taskDirectory,
  fileName,
  timeline,
} = {}) {
  if (!projectRoot || !taskDirectory) {
    throw new TypeError('projectRoot and taskDirectory are required.');
  }
  if (!fileName || path.basename(fileName) !== fileName || !fileName.endsWith('.jsonl')) {
    throw new TypeError('fileName must be a plain .jsonl file name.');
  }
  if (!Array.isArray(timeline)) {
    throw new TypeError('timeline must be an array.');
  }

  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedTempRoot = path.resolve(resolvedProjectRoot, 'temp');
  const resolvedTaskDirectory = path.resolve(taskDirectory);
  const tempPrefix = `${resolvedTempRoot}${path.sep}`;
  if (
    resolvedTaskDirectory !== resolvedTempRoot
    && !resolvedTaskDirectory.startsWith(tempPrefix)
  ) {
    const error = new ContinuousActionError('Timeline path must stay inside project temp.', {
      code: 'TIMELINE_PATH_OUTSIDE_TEMP',
    });
    throw error;
  }

  const outputPath = path.resolve(resolvedTaskDirectory, fileName);
  const taskPrefix = `${resolvedTaskDirectory}${path.sep}`;
  if (!outputPath.startsWith(taskPrefix)) {
    throw new ContinuousActionError('Timeline file escaped the task directory.', {
      code: 'TIMELINE_PATH_OUTSIDE_TASK',
    });
  }

  await mkdir(resolvedTaskDirectory, { recursive: true });
  const contents = timeline.map((entry) => JSON.stringify(entry)).join('\n');
  await writeFile(outputPath, contents ? `${contents}\n` : '', { encoding: 'utf8', flag: 'wx' });
  return outputPath;
}
