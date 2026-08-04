import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport, organizationRoot } from './helpers.mjs';

const loaded = await optionalImport(
  'scripts/content_customer_growth_v2_contract.mjs',
);

test('v2 内容客户增长契约暴露严格校验入口', () => {
  assert.equal(
    typeof loaded.module?.validateContentCustomerGrowthV2Candidate,
    'function',
    loaded.error?.message
      ?? 'validateContentCustomerGrowthV2Candidate missing',
  );
});

const fixturePath = path.join(
  organizationRoot,
  'tests',
  'fixtures',
  'content-customer-growth-v2-valid.json',
);
const baseCandidate = JSON.parse(await readFile(fixturePath, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function contextFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-growth-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidate = structuredClone(baseCandidate);
  const businessRoot = path.join(
    root,
    'business-projects',
    candidate.enterpriseId,
    candidate.businessProjectId,
  );
  const expectedUpstreamArtifacts = [];
  for (const artifact of candidate.scope.upstreamArtifacts) {
    const artifactPath = path.join(
      businessRoot,
      'shared-artifacts',
      artifact.artifactId,
      `v${artifact.version}.json`,
    );
    const bytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      status: 'published',
      artifactId: artifact.artifactId,
      version: artifact.version,
      enterpriseId: candidate.enterpriseId,
      businessProjectId: candidate.businessProjectId,
    }));
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, bytes);
    artifact.sha256 = sha256(bytes);
    artifact.path = path.relative(root, artifactPath).replaceAll('\\', '/');
    expectedUpstreamArtifacts.push({
      artifactId: artifact.artifactId,
      version: artifact.version,
      sha256: artifact.sha256,
    });
  }
  candidate.channelPlans.forEach((plan) => {
    plan.brandArtifact = structuredClone(
      candidate.scope.upstreamArtifacts.find(
        (item) => item.artifactId === 'brand-brief',
      ),
    );
  });
  candidate.dealHandoff.sourceArtifact = structuredClone(
    candidate.scope.upstreamArtifacts.find(
      (item) => item.artifactId === 'deal-handoff-contract',
    ),
  );

  const runRoot = path.join(
    businessRoot,
    'organizations',
    'ai-growth-strategist',
    'runs',
    candidate.runId,
  );
  const sourcePath = path.join(
    runRoot,
    'evidence',
    'knowledge-sources',
    'source-001.md',
  );
  const sourceBytes = Buffer.from('飞书知识来源：强调专业、长期陪伴、不过度承诺。');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceBytes);
  const receiptPath = path.join(runRoot, 'evidence', 'knowledge-context.json');
  const receipt = {
    schemaVersion: 2,
    capabilityId: candidate.capabilityId,
    enterpriseId: candidate.enterpriseId,
    businessProjectId: candidate.businessProjectId,
    taskId: candidate.taskId,
    runId: candidate.runId,
    status: 'matched',
    query: '内容增长 客户生命周期 许可触达',
    sources: [{
      relativePath: path.relative(root, sourcePath).replaceAll('\\', '/'),
      sha256: sha256(sourceBytes),
    }],
    limitations: ['仅作内部候选依据，不自动发布或联系客户。'],
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  await writeFile(receiptPath, receiptBytes);
  candidate.knowledgeContext = {
    status: 'matched',
    evidencePath: path.relative(root, receiptPath).replaceAll('\\', '/'),
    evidenceSha256: sha256(receiptBytes),
  };
  return {
    candidate,
    trusted: {
      expectedIdentity: {
        enterpriseId: candidate.enterpriseId,
        businessProjectId: candidate.businessProjectId,
        taskId: candidate.taskId,
        runId: candidate.runId,
      },
      expectedUpstreamArtifacts,
      expectedKnowledgeReceipt: {
        relativePath: candidate.knowledgeContext.evidencePath,
        status: candidate.knowledgeContext.status,
        sha256: candidate.knowledgeContext.evidenceSha256,
      },
      expectedCommercePolicy: {
        priceStatus: 'finalized',
        refundRuleStatus: 'finalized',
      },
      projectRoot: root,
      referenceAt: '2026-07-31T00:00:00.000Z',
    },
  };
}

const mutate = (value, change) => {
  const copy = structuredClone(value);
  change(copy);
  return copy;
};

test('v2 有效候选锁定项目、四类上游成果、飞书凭证和来源 SHA', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  const validated = loaded.module.validateContentCustomerGrowthV2Candidate(
    candidate,
    trusted,
  );
  assert.equal(Object.isFrozen(validated), true);
  assert.deepEqual(
    validated.scope.upstreamArtifacts.map((item) => item.artifactId),
    [
      'growth-opportunity-brief',
      'benchmark-mechanism-map',
      'brand-brief',
      'deal-handoff-contract',
    ],
  );
});

test('v2 受信任参数缺失、身份串项目、上游 SHA 或飞书来源篡改均 fail-closed', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(candidate),
    /trusted|受信任/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(candidate, {
      ...trusted,
      expectedIdentity: {
        ...trusted.expectedIdentity,
        businessProjectId: '20260731-999-other',
      },
    }),
    /identity|项目|businessProjectId/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.scope.upstreamArtifacts[2].sha256 = 'f'.repeat(64);
      }),
      trusted,
    ),
    /SHA-256|sha256/u,
  );
  const receiptPath = path.resolve(
    trusted.projectRoot,
    candidate.knowledgeContext.evidencePath,
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const sourcePath = path.resolve(
    trusted.projectRoot,
    receipt.sources[0].relativePath,
  );
  await writeFile(sourcePath, 'tampered');
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      candidate,
      trusted,
    ),
    /knowledge.*source.*SHA-256|飞书.*来源.*SHA/u,
  );
});

test('v2 强制三渠道月计划、六阶段和许可式客户培育', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => value.channelPlans.pop()),
      trusted,
    ),
    /three channel|三渠道|channelPlans/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.customerLifecycle[1].exitSignal = 'view becomes explicit inquiry';
      }),
      trusted,
    ),
    /passive|explicit inquiry|被动|明确询盘/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.consentPolicy.noAutomatedOutreach = false;
      }),
      trusted,
    ),
    /automated outreach|自动.*触达|consent/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.consentPolicy.optOutMechanism = '';
      }),
      trusted,
    ),
    /opt.?out|退出/u,
  );
});

test('v2 强制14项成交交接、价格退款已确认和复购排除项', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  assert.equal(candidate.dealHandoff.requiredFields.length, 14);
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => value.dealHandoff.requiredFields.pop()),
      trusted,
    ),
    /14|handoff.*incomplete|交接.*不完整/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.dealHandoff.pricePolicyStatus = 'undecided';
      }),
      trusted,
    ),
    /price|价格.*未定|confirmed/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.dealHandoff.refundPolicyStatus = 'undecided';
      }),
      trusted,
    ),
    /refund|退款.*未定|confirmed/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.repurchase.exclusions = ['已退出'];
      }),
      trusted,
    ),
    /complaint|refund|投诉|退款|repurchase/u,
  );
});

test('v2 外部动作全部保持 awaiting_approval 且渠道×生命周期调试矩阵完整', async (t) => {
  const { candidate, trusted } = await contextFixture(t);
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => {
        value.externalActions[0].gate = 'approved';
        value.externalActions[0].approvalId = 'approval-001';
      }),
      trusted,
    ),
    /awaiting_approval|external action|外部动作/u,
  );
  assert.throws(
    () => loaded.module.validateContentCustomerGrowthV2Candidate(
      mutate(candidate, (value) => value.debugReport.channelLifecycleMatrix.pop()),
      trusted,
    ),
    /matrix|矩阵|18/u,
  );
});
