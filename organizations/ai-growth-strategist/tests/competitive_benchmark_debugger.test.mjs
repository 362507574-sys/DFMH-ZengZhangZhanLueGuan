import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/competitive_benchmark_debugger.mjs',
);
const candidate = JSON.parse(await readFile(
  path.join(
    organizationRoot,
    'tests',
    'fixtures',
    'competitive-benchmark-v2-valid.json',
  ),
  'utf8',
));
const staleSource = JSON.parse(await readFile(
  path.join(
    organizationRoot,
    'tests',
    'fixtures',
    'competitive-benchmark-v2-stale-source.json',
  ),
  'utf8',
));

function requireFunction(name) {
  assert.equal(
    typeof loaded.module?.[name],
    'function',
    loaded.error?.message ?? `${name} missing`,
  );
  return loaded.module?.[name];
}

test('样本缺替代方案时给出固定warning诊断', () => {
  const diagnose = requireFunction('diagnoseSampleSet');
  if (!diagnose) return;
  const result = diagnose({
    samples: candidate.samples.filter((item) => item.kind === 'direct'),
  });
  assert.equal(result.code, 'missing_alternative_sample');
  assert.equal(result.severity, 'warning');
  assert.equal(Object.isFrozen(result), true);
});

test('过期来源使用外部参考时间纯函数诊断', () => {
  const diagnose = requireFunction('diagnoseSource');
  if (!diagnose) return;
  const result = diagnose(staleSource);
  assert.equal(result.code, 'stale_source');
  assert.equal(result.severity, 'warning');
  assert.equal(result.affectedSample, 'sample-a');
});

test('私有经营表现声明是blocking', () => {
  const diagnose = requireFunction('diagnoseClaim');
  if (!diagnose) return;
  const result = diagnose({
    claim: 'competitor conversion is 30%',
    publicEvidence: false,
    sampleId: 'sample-a',
  });
  assert.equal(result.code, 'private_performance_claim');
  assert.equal(result.severity, 'blocking');
});

test('复制、品牌混淆、知识产权和价格成交越界都是blocking', () => {
  const diagnose = requireFunction('diagnoseTransfer');
  if (!diagnose) return;
  const cases = [
    [{ copiesCoreCopy: true }, 'copy_risk'],
    [{ brandConfusionRisk: 'possible' }, 'brand_confusion'],
    [{ intellectualPropertyRisk: 'possible' }, 'intellectual_property_risk'],
    [{ changesPricePolicy: true }, 'price_deal_boundary_change'],
    [{ changesDealRules: true }, 'price_deal_boundary_change'],
  ];
  for (const [input, code] of cases) {
    const result = diagnose({ sampleId: 'sample-a', ...input });
    assert.equal(result.code, code);
    assert.equal(result.severity, 'blocking');
  }
});

test('渠道存在不能伪装成渠道有效', () => {
  const diagnose = requireFunction('diagnoseChannel');
  if (!diagnose) return;
  const result = diagnose({
    present: true,
    effectivenessEvidence: false,
    sampleId: 'sample-b',
  });
  assert.equal(result.code, 'presence_is_not_effectiveness');
  assert.equal(result.severity, 'warning');
});

test('公开客户路径断层给出warning', () => {
  const diagnose = requireFunction('diagnoseObservablePath');
  if (!diagnose) return;
  const result = diagnose({
    publicSteps: ['小红书内容'],
    hasObservableNextStep: false,
    sampleId: 'sample-b',
  });
  assert.equal(result.code, 'observable_path_gap');
  assert.equal(result.severity, 'warning');
});

test('正常输入返回固定ok且诊断结果深冻结', () => {
  const diagnose = requireFunction('diagnoseTransfer');
  if (!diagnose) return;
  const result = diagnose({
    sampleId: 'sample-a',
    copiesName: false,
    copiesSlogan: false,
    copiesCoreCopy: false,
    copiesVisualIdentity: false,
    copiesCases: false,
    brandConfusionRisk: 'none',
    intellectualPropertyRisk: 'none',
    changesPricePolicy: false,
    changesDealRules: false,
  });
  assert.equal(result.code, 'ok');
  assert.equal(result.severity, 'info');
  assert.equal(Object.isFrozen(result), true);
});

test('所有调试入口拒绝Proxy、accessor、Symbol和超深数据', () => {
  const diagnose = requireFunction('diagnoseClaim');
  if (!diagnose) return;
  assert.throws(
    () => diagnose(new Proxy({
      claim: '公开事实',
      publicEvidence: true,
    }, {})),
    /Proxy|plain data/u,
  );
  const accessor = { publicEvidence: true };
  Object.defineProperty(accessor, 'claim', {
    enumerable: true,
    get: () => 'forged',
  });
  assert.throws(() => diagnose(accessor), /accessor|data property/u);
  const symbolic = { claim: '公开事实', publicEvidence: true };
  symbolic[Symbol('trusted')] = true;
  assert.throws(() => diagnose(symbolic), /Symbol|plain data/u);
  const deep = { claim: '公开事实', publicEvidence: true };
  let cursor = deep;
  for (let index = 0; index < 40; index += 1) {
    cursor.deep = {};
    cursor = cursor.deep;
  }
  assert.throws(() => diagnose(deep), /depth limit/u);
});

test('样本诊断严格拒绝4+1与3+2而不是只检查下限', () => {
  if (!loaded.module) return;
  for (const samples of [
    [
      ...Array.from({ length: 4 }, () => ({ kind: 'direct' })),
      { kind: 'alternative' },
    ],
    [
      ...Array.from({ length: 3 }, () => ({ kind: 'direct' })),
      { kind: 'alternative' },
      { kind: 'alternative' },
    ],
  ]) {
    const diagnosis = loaded.module.diagnoseSampleSet({ samples });
    assert.equal(diagnosis.code, 'invalid_sample_mix');
    assert.equal(diagnosis.severity, 'blocking');
  }
});

test('未来来源返回固定future_source阻断诊断', () => {
  if (!loaded.module) return;
  const diagnosis = loaded.module.diagnoseSource({
    observedAt: '2026-08-01T00:00:00.000Z',
    referenceAt: '2026-07-30T00:00:00.000Z',
    maximumAgeDays: 365,
    sampleId: 'sample-a',
  });
  assert.equal(diagnosis.code, 'future_source');
  assert.equal(diagnosis.severity, 'blocking');
});
