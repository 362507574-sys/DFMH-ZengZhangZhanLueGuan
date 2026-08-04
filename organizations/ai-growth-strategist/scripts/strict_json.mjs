import { lstat, readFile } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';

const DEFAULT_MAX_BYTES = 1024 * 1024;

export async function readStrictJson(filePath, {
  label = 'JSON file',
  maxBytes = DEFAULT_MAX_BYTES,
  allowedKeys,
} = {}) {
  const details = await lstat(filePath).catch((error) => {
    throw new Error(`${label} cannot be read: ${error.message}`, { cause: error });
  });
  if (!details.isFile() || details.isSymbolicLink() || details.size > maxBytes) {
    throw new Error(`${label} must be a regular bounded file`);
  }
  const raw = await readFile(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) throw new Error(`${label} must not contain a BOM`);
  assertNoDuplicateJsonKeys(raw, label);
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} JSON is invalid: ${error.message}`, { cause: error });
  }
  assertPlainObject(value, label);
  if (allowedKeys) {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new Error(`${label} has unexpected field: ${key}`);
    }
  }
  return value;
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a plain object, not a Proxy`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} fields must be data properties, not accessors`);
    }
  }
}

export function assertPlainData(value, label = 'value', {
  maxDepth = 32,
  maxNodes = 10_000,
  maxArrayLength = 1_000,
} = {}) {
  let nodes = 0;
  const seen = new Set();
  const visit = (current, location, depth) => {
    nodes += 1;
    if (nodes > maxNodes) throw new Error(`${label} exceeds plain data node limit`);
    if (depth > maxDepth) throw new Error(`${label} exceeds plain data depth limit`);
    if (current === null || typeof current !== 'object') return;
    if (utilTypes.isProxy(current)) {
      throw new TypeError(`${location} must be plain data, not a Proxy`);
    }
    if (seen.has(current)) throw new TypeError(`${location} must not be cyclic`);
    seen.add(current);
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        throw new TypeError(`${location} must use Array.prototype`);
      }
      if (current.length > maxArrayLength) {
        throw new Error(`${location} exceeds maximum array size limit`);
      }
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key === 'symbol')) {
        throw new TypeError(`${location} must not contain Symbol keys`);
      }
      const expectedKeys = new Set([
        'length',
        ...Array.from({ length: current.length }, (_, index) => String(index)),
      ]);
      if (keys.length !== expectedKeys.size
        || keys.some((key) => !expectedKeys.has(key))) {
        throw new TypeError(`${location} has an extra plain data array key`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.hasOwn(current, index)) {
          throw new TypeError(`${location} must be a dense plain data array`);
        }
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(`${location}[${index}] must be a data property`);
        }
        visit(descriptor.value, `${location}[${index}]`, depth + 1);
      }
      seen.delete(current);
      return;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${location} must be a plain data object`);
    }
    const keys = Reflect.ownKeys(current);
    if (keys.some((key) => typeof key === 'symbol')) {
      throw new TypeError(`${location} must not contain Symbol keys`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(`${location}.${key} must be an enumerable data property`);
      }
      visit(descriptor.value, `${location}.${key}`, depth + 1);
    }
    seen.delete(current);
  };
  visit(value, label, 0);
  return value;
}

export function assertNoDuplicateJsonKeys(source, label = 'JSON input') {
  let index = 0;
  const skip = () => {
    while (/\s/u.test(source[index] || '')) index += 1;
  };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      if (source[index] === '\\') index += source[index + 1] === 'u' ? 6 : 2;
      else index += 1;
    }
    throw new Error(`${label} contains an unterminated string`);
  };
  const parseValue = () => {
    skip();
    if (source[index] === '{') return parseObject();
    if (source[index] === '[') return parseArray();
    if (source[index] === '"') return parseString();
    const start = index;
    while (index < source.length && !/[\s,\]}]/u.test(source[index])) index += 1;
    if (start === index) throw new Error(`${label} expected a JSON value`);
    return undefined;
  };
  const parseObject = () => {
    const keys = new Set();
    index += 1;
    skip();
    if (source[index] === '}') {
      index += 1;
      return;
    }
    for (;;) {
      skip();
      if (source[index] !== '"') throw new Error(`${label} expected an object key`);
      const key = parseString();
      if (keys.has(key)) throw new Error(`${label} contains duplicate JSON key: ${key}`);
      keys.add(key);
      skip();
      if (source[index] !== ':') throw new Error(`${label} expected a colon`);
      index += 1;
      parseValue();
      skip();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      if (source[index] !== ',') throw new Error(`${label} expected a comma`);
      index += 1;
    }
  };
  const parseArray = () => {
    index += 1;
    skip();
    if (source[index] === ']') {
      index += 1;
      return;
    }
    for (;;) {
      parseValue();
      skip();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      if (source[index] !== ',') throw new Error(`${label} expected an array comma`);
      index += 1;
    }
  };
  skip();
  parseValue();
  skip();
  if (index !== source.length) throw new Error(`${label} contains trailing content`);
}
