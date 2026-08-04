import { types as utilTypes } from 'node:util';

import {
  validateGrowthPlan,
  validateStep,
} from './growth_run_contract.mjs';

const INPUT_FIELDS = new Set([
  'runId',
  'capabilityId',
  'steps',
]);

export function createGrowthPlan(input) {
  const {
    runId,
    capabilityId,
    steps,
  } = readPlannerInput(input);
  const validatedSteps = copyValidatedSteps(steps);
  const stepIndexById = new Map();

  for (let index = 0; index < validatedSteps.length; index += 1) {
    const currentStep = validatedSteps[index];
    if (stepIndexById.has(currentStep.stepId)) {
      throw new Error(
        `growth plan stepId values must be unique; duplicate: ${currentStep.stepId}`,
      );
    }
    stepIndexById.set(currentStep.stepId, index);
  }

  const executionOrder = createStableExecutionOrder(
    validatedSteps,
    stepIndexById,
  );

  return validateGrowthPlan({
    schemaVersion: 1,
    runId,
    capabilityId,
    steps: validatedSteps,
    executionOrder,
  });
}

function readPlannerInput(input) {
  assertNotProxy(input, 'growth planner input');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('growth planner input must be a plain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('growth planner input must be a plain object');
  }

  const ownKeys = Reflect.ownKeys(input);
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== 'string' || !INPUT_FIELDS.has(key)) {
      throw new Error(
        `growth planner input has unexpected field: ${String(key)}`,
      );
    }
  }

  const values = {};
  for (const field of INPUT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor) {
      throw new Error(
        `growth planner input is missing required field: ${field}`,
      );
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new Error(
        `growth planner input.${field} must be an own data property, not an accessor`,
      );
    }
    values[field] = descriptor.value;
  }
  return values;
}

function copyValidatedSteps(steps) {
  assertNotProxy(steps, 'growth plan steps');
  if (!Array.isArray(steps)) {
    throw new TypeError('growth plan steps must be an array');
  }
  if (Object.getPrototypeOf(steps) !== Array.prototype) {
    throw new TypeError(
      'growth plan steps must use the standard Array prototype',
    );
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(steps, 'length');
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) {
    throw new Error('growth plan steps.length must be an own data property');
  }
  const length = lengthDescriptor.value;
  if (length === 0) {
    throw new Error('growth plan steps must be a non-empty array');
  }

  const validatedSteps = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(steps, index)) {
      throw new Error(
        'growth plan steps must be dense and cannot contain sparse holes',
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(steps, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(
        `growth plan steps[${index}] must be an own data property`,
      );
    }
    const stepValue = descriptor.value;
    assertNotProxy(stepValue, `growth plan steps[${index}]`);
    rejectProxyDependsOn(stepValue, index);
    validatedSteps.push(validateStep(stepValue));
  }

  rejectUnexpectedOwnProperties(steps, length);
  return validatedSteps;
}

function rejectProxyDependsOn(stepValue, index) {
  if (!stepValue || typeof stepValue !== 'object') return;
  const descriptor = Object.getOwnPropertyDescriptor(stepValue, 'dependsOn');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) return;
  assertNotProxy(
    descriptor.value,
    `growth plan steps[${index}].dependsOn`,
  );
}

function rejectUnexpectedOwnProperties(steps, length) {
  const ownKeys = Reflect.ownKeys(steps);
  for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
    const key = ownKeys[keyIndex];
    if (key === 'length') continue;
    if (
      typeof key === 'string'
      && isExpectedArrayIndex(key, length)
    ) {
      continue;
    }
    throw new Error(
      `growth plan steps array has unexpected own property: ${String(key)}`,
    );
  }
}

function isExpectedArrayIndex(key, length) {
  const index = Number(key);
  return Number.isInteger(index)
    && index >= 0
    && index < length
    && String(index) === key;
}

function createStableExecutionOrder(validatedSteps, stepIndexById) {
  const indegree = new Array(validatedSteps.length).fill(0);
  const dependents = Array.from(
    { length: validatedSteps.length },
    () => [],
  );

  for (let stepIndex = 0; stepIndex < validatedSteps.length; stepIndex += 1) {
    const currentStep = validatedSteps[stepIndex];
    for (
      let dependencyIndex = 0;
      dependencyIndex < currentStep.dependsOn.length;
      dependencyIndex += 1
    ) {
      const dependency = currentStep.dependsOn[dependencyIndex];
      const prerequisiteIndex = stepIndexById.get(dependency);
      if (prerequisiteIndex === undefined) {
        throw new Error(`growth plan dependency is unknown: ${dependency}`);
      }
      indegree[stepIndex] += 1;
      dependents[prerequisiteIndex].push(stepIndex);
    }
  }

  const ready = [];
  for (let index = 0; index < indegree.length; index += 1) {
    if (indegree[index] === 0) pushMinimum(ready, index);
  }

  const executionOrder = [];
  while (ready.length > 0) {
    const stepIndex = popMinimum(ready);
    executionOrder.push(validatedSteps[stepIndex].stepId);

    const nextSteps = dependents[stepIndex];
    for (let index = 0; index < nextSteps.length; index += 1) {
      const dependentIndex = nextSteps[index];
      indegree[dependentIndex] -= 1;
      if (indegree[dependentIndex] === 0) {
        pushMinimum(ready, dependentIndex);
      }
    }
  }

  if (executionOrder.length !== validatedSteps.length) {
    throw new Error('growth plan dependency cycle detected');
  }
  return executionOrder;
}

function pushMinimum(heap, value) {
  heap.push(value);
  let index = heap.length - 1;

  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (heap[parentIndex] <= value) break;
    heap[index] = heap[parentIndex];
    index = parentIndex;
  }
  heap[index] = value;
}

function popMinimum(heap) {
  const minimum = heap[0];
  const last = heap.pop();
  if (heap.length === 0) return minimum;

  let index = 0;
  while (true) {
    const leftIndex = (index * 2) + 1;
    if (leftIndex >= heap.length) break;
    const rightIndex = leftIndex + 1;
    let childIndex = leftIndex;
    if (
      rightIndex < heap.length
      && heap[rightIndex] < heap[leftIndex]
    ) {
      childIndex = rightIndex;
    }
    if (heap[childIndex] >= last) break;
    heap[index] = heap[childIndex];
    index = childIndex;
  }
  heap[index] = last;
  return minimum;
}

function assertNotProxy(value, label) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
}
