import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { organizationRoot } from './helpers.mjs';

test('Skill机器候选最小合同覆盖validator结构类型枚举与边界', async () => {
  const skill = await readFile(
    path.join(
      organizationRoot,
      'skills',
      'competitive-benchmark-analysis',
      'SKILL.md',
    ),
    'utf8',
  );
  const requiredLiterals = [
    '机器候选最小合同',
    'schemaVersion, capabilityId, enterpriseId, businessProjectId, taskId, runId, status, knowledgeContext, scope, evidence, samples, transfers, boundaryChecks, collaborationRequests, debugReport, review',
    'competitive-benchmark-analysis',
    'expectedIdentity, projectRoot, expectedUpstream, expectedKnowledgeReceipt, referenceAt',
    '--expected-upstream-artifact-id',
    '--expected-upstream-version',
    '--expected-upstream-sha256',
    '--expected-receipt-relative-path',
    '--expected-receipt-status',
    '--expected-receipt-sha256',
    '--reference-at',
    'matched | degraded | no_hit',
    'evidence/knowledge-context.json',
    'schemaVersion, enterpriseId, businessProjectId, taskId, runId, capabilityId, status, query, sources, limitations',
    'relativePath, sha256',
    'knowledge-sources/',
    '逗号、顿号、冒号',
    '可是/却/而/然而/不过/但/yet/although/however/actually/in fact',
    'growth-opportunity-brief',
    'shared-artifacts/growth-opportunity-brief/v<version>.json',
    'schemaVersion, artifactId, version, enterpriseId, businessProjectId, opportunity, status',
    'id, type, claim, sourcePath, sourceVersion, sourceSha256, observedAt, appliesTo',
    'public_fact',
    'scope_fact',
    'evidence/sources/',
    '3条 `kind: direct`',
    '1条 `kind: alternative`',
    'id, name, kind, selectionReason, observedAt, evidenceRefs, layers, privateUnknowns',
    'positioning, productStrategy, contentMechanism, acquisitionChannels, observableCustomerPath',
    'publicFacts, inferences, unknowns, evidenceRefs',
    'id, evidenceRefs, surfaceAction, underlyingMechanism, enterpriseFit, originalImplementation, doNotCopy, antiCopyChecks, experiment',
    '名称, 口号, 核心文案, 视觉身份, 案例',
    'copiesName, copiesSlogan, copiesCoreCopy, copiesVisualIdentity, copiesCases, brandConfusionRisk, intellectualPropertyRisk',
    'id, hypothesis, experimentObject, control, sample, metric, secondaryMetrics, riskMetrics, baseline, target, maximumDays, maximumCost, stopConditions, dataCollectionMethod, reviewAt, externalActions, requiresApproval',
    'publish_content, paid_media, contact_customer, change_price, change_refund_rule, brand_commitment, deal_commitment, write_external_system',
    'changesEnterpriseStrategy, changesBrandPositioning, changesPricePolicy, changesDealRules',
    'ai-brand-officer | ai-deal-officer | ai-helmsman | ai-organization-officer',
    'passed | passed_with_unknowns | blocked',
    'public_scope_only, all_sources_current, ok → info',
    'missing_alternative_sample, limited_direct_sample, stale_source, presence_is_not_effectiveness, observable_path_gap → warning',
    'private_performance_claim, copy_risk, brand_confusion, intellectual_property_risk, price_deal_boundary_change, invalid_sample_mix, future_source → blocking',
    'stepId, policyId, used, action, externalWrite, loginBypass, timelinePath, notes, continuousActionStandard, controller',
    'competitive-benchmark-read-only-research-v1',
    'source-collection | source-validation',
    'open_page | read_page | navigate | find | scroll | extract_text | screenshot',
    'shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md',
    'scripts/browser_continuous_action_controller.mjs',
  ];
  for (const literal of requiredLiterals) {
    assert.ok(skill.includes(literal), `Skill contract is missing: ${literal}`);
  }
  assert.match(skill, /evidence\.appliesTo.*单个.*sampleId.*字符串/u);
  assert.match(skill, /sourcePath.*projectRoot.*相对路径/u);
  assert.match(skill, /externalWrite.*loginBypass.*false/u);
  assert.match(skill, /requiresApproval.*true.*否则.*false/u);
  assert.match(skill, /matched.*真实普通匹配来源/u);
  assert.match(skill, /warning.*不能使用.*passed.*remainingUnknowns/u);
  assert.match(skill, /used=false.*action.*timeline.*null/u);
});

test('第八轮写作合同要求输出前逐字段自检并覆盖 fresh 失败边界', async () => {
  const skill = await readFile(
    path.join(
      organizationRoot,
      'skills',
      'competitive-benchmark-analysis',
      'SKILL.md',
    ),
    'utf8',
  );
  const workflow = await readFile(
    path.join(
      organizationRoot,
      'workflows',
      'COMPETITIVE_BENCHMARK_ANALYSIS.md',
    ),
    'utf8',
  );
  const requiredGuidance = [
    '所有 evidence、sample、transfer 与 experiment 的 id 必须使用小写安全ID',
    'alternative 的每个 layer.publicFacts 仍按 public_fact',
    'scope.objective 与 scope.constraints 只能描述企业内部任务边界',
    'surfaceAction、underlyingMechanism、enterpriseFit、originalImplementation 必须逐字段使用允许的企业内部动作或机制语法',
    '输出前逐字段自检',
  ];
  for (const document of [skill, workflow]) {
    for (const guidance of requiredGuidance) {
      assert.ok(
        document.includes(guidance),
        `fresh writer guidance is missing: ${guidance}`,
      );
    }
  }
});
