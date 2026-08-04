import assert from 'node:assert/strict';
import test from 'node:test';
import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/strict_json.mjs');

test('纯数据守卫拒绝数组额外键、Symbol、accessor且不触发getter', () => {
  if (!loaded.module) return;
  let touched = 0;
  for (const value of [
    Object.assign(['x'], { extra: true }),
    Object.defineProperty(['x'], 'extra', {
      enumerable: true,
      get() { touched += 1; return true; },
    }),
    Object.defineProperty(['x'], Symbol('hidden'), { value: true }),
  ]) {
    assert.throws(
      () => loaded.module.assertPlainData(value),
      /extra|Symbol|accessor|data property|plain data/u,
    );
  }
  assert.equal(touched, 0);
});

test('纯数据守卫先拒绝Proxy再读取原型且trap为零', () => {
  if (!loaded.module) return;
  let touched = 0;
  const value = new Proxy(['x'], {
    getPrototypeOf() { touched += 1; return Array.prototype; },
    ownKeys() { touched += 1; return ['length', '0']; },
  });
  assert.throws(
    () => loaded.module.assertPlainData(value),
    /Proxy/u,
  );
  assert.equal(touched, 0);
});

test('纯数据对象拒绝Symbol accessor且不触发getter', () => {
  if (!loaded.module) return;
  let touched = 0;
  const value = {};
  Object.defineProperty(value, Symbol('trap'), {
    get() { touched += 1; return true; },
  });
  assert.throws(
    () => loaded.module.assertPlainData(value),
    /Symbol|accessor|plain data/u,
  );
  assert.equal(touched, 0);
});

test('纯数据数组拒绝自定义原型', () => {
  if (!loaded.module) return;
  const value = ['x'];
  Object.setPrototypeOf(value, Object.create(Array.prototype));
  assert.throws(
    () => loaded.module.assertPlainData(value),
    /Array\.prototype/u,
  );
});
