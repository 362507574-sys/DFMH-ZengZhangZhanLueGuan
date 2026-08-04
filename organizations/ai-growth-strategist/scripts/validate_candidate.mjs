import process from 'node:process';
import { assertNoDuplicateJsonKeys } from './strict_json.mjs';

import { validateGrowthOpportunityCandidate } from './growth_opportunity_contract.mjs';
import { validateGrowthOpportunityV2Candidate } from './growth_opportunity_v2_contract.mjs';
import { validateCompetitiveBenchmarkCandidate } from './competitive_benchmark_contract.mjs';
import { validateCompetitiveBenchmarkV2Candidate } from './competitive_benchmark_v2_contract.mjs';
import { validateContentCustomerGrowthCandidate } from './content_customer_growth_contract.mjs';
import { validateContentCustomerGrowthV2Candidate } from './content_customer_growth_v2_contract.mjs';

const validators = new Map([
  ['growth-opportunity-analysis', validateGrowthOpportunityCandidate],
  ['competitive-benchmark-analysis', validateCompetitiveBenchmarkCandidate],
  ['content-customer-growth', validateContentCustomerGrowthCandidate],
]);

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 200 * 1024) {
      throw new Error('candidate JSON exceeds maximum input size in bytes');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function trustedV2Context(argv, capabilityId) {
  const common = [
    '--expected-enterprise-id',
    '--expected-business-project-id',
    '--expected-task-id',
    '--expected-run-id',
    '--project-root',
  ];
  const competitive = [
    '--expected-upstream-artifact-id',
    '--expected-upstream-version',
    '--expected-upstream-sha256',
    '--expected-receipt-relative-path',
    '--expected-receipt-status',
    '--expected-receipt-sha256',
    '--reference-at',
  ];
  const content = [
    '--expected-growth-opportunity-version',
    '--expected-growth-opportunity-sha256',
    '--expected-benchmark-version',
    '--expected-benchmark-sha256',
    '--expected-brand-version',
    '--expected-brand-sha256',
    '--expected-deal-handoff-version',
    '--expected-deal-handoff-sha256',
    '--expected-receipt-relative-path',
    '--expected-receipt-status',
    '--expected-receipt-sha256',
    '--expected-price-status',
    '--expected-refund-rule-status',
    '--reference-at',
  ];
  const required = capabilityId === 'competitive-benchmark-analysis'
    ? [...common, ...competitive]
    : capabilityId === 'content-customer-growth'
      ? [...common, ...content]
      : common;
  const allowed = new Set(required);
  if (argv.length !== required.length * 2) {
    throw new Error(
      capabilityId === 'growth-opportunity-analysis'
        ? 'v2 candidate requires trusted context flags including expected-enterprise-id and project-root'
        : 'v2 candidate requires trusted context flags including expected upstream, receipt and project-root',
    );
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || typeof value !== 'string' || !value) {
      throw new Error('v2 trusted context flags are invalid');
    }
    if (Object.hasOwn(values, flag)) {
      throw new Error(`duplicate trusted context flag: ${flag}`);
    }
    values[flag] = value;
  }
  if (Object.keys(values).length !== required.length) {
    throw new Error('v2 trusted context is incomplete');
  }
  const context = {
    expectedIdentity: {
      enterpriseId: values['--expected-enterprise-id'],
      businessProjectId: values['--expected-business-project-id'],
      taskId: values['--expected-task-id'],
      runId: values['--expected-run-id'],
    },
    projectRoot: values['--project-root'],
  };
  if (capabilityId === 'competitive-benchmark-analysis') {
    if (!/^[1-9]\d*$/u.test(values['--expected-upstream-version'])) {
      throw new Error('expected upstream version flag is invalid');
    }
    context.expectedUpstream = {
      artifactId: values['--expected-upstream-artifact-id'],
      version: Number(values['--expected-upstream-version']),
      sha256: values['--expected-upstream-sha256'],
    };
    context.expectedKnowledgeReceipt = {
      relativePath: values['--expected-receipt-relative-path'],
      status: values['--expected-receipt-status'],
      sha256: values['--expected-receipt-sha256'],
    };
    context.referenceAt = values['--reference-at'];
  }
  if (capabilityId === 'content-customer-growth') {
    const artifactFlags = [
      ['growth-opportunity-brief', '--expected-growth-opportunity-version', '--expected-growth-opportunity-sha256'],
      ['benchmark-mechanism-map', '--expected-benchmark-version', '--expected-benchmark-sha256'],
      ['brand-brief', '--expected-brand-version', '--expected-brand-sha256'],
      ['deal-handoff-contract', '--expected-deal-handoff-version', '--expected-deal-handoff-sha256'],
    ];
    context.expectedUpstreamArtifacts = artifactFlags.map(
      ([artifactId, versionFlag, shaFlag]) => {
        if (!/^[1-9]\d*$/u.test(values[versionFlag])) {
          throw new Error(`${artifactId} expected version flag is invalid`);
        }
        return {
          artifactId,
          version: Number(values[versionFlag]),
          sha256: values[shaFlag],
        };
      },
    );
    context.expectedKnowledgeReceipt = {
      relativePath: values['--expected-receipt-relative-path'],
      status: values['--expected-receipt-status'],
      sha256: values['--expected-receipt-sha256'],
    };
    context.expectedCommercePolicy = {
      priceStatus: values['--expected-price-status'],
      refundRuleStatus: values['--expected-refund-rule-status'],
    };
    context.referenceAt = values['--reference-at'];
  }
  return context;
}

try {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error('candidate JSON is required on standard input');
  const source = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  assertNoDuplicateJsonKeys(source, 'candidate JSON');
  const candidate = JSON.parse(source);
  let validator = validators.get(candidate?.capabilityId);
  if (
    candidate?.capabilityId === 'growth-opportunity-analysis'
    && candidate?.schemaVersion === 2
  ) {
    validator = validateGrowthOpportunityV2Candidate;
  }
  if (
    candidate?.capabilityId === 'competitive-benchmark-analysis'
    && candidate?.schemaVersion === 2
  ) {
    validator = validateCompetitiveBenchmarkV2Candidate;
  }
  if (
    candidate?.capabilityId === 'content-customer-growth'
    && candidate?.schemaVersion === 2
  ) {
    validator = validateContentCustomerGrowthV2Candidate;
  }
  if (!validator) {
    throw new Error(`unsupported capabilityId: ${String(candidate?.capabilityId)}`);
  }
  const isV2 = candidate?.schemaVersion === 2
    && (
      candidate?.capabilityId === 'growth-opportunity-analysis'
      || candidate?.capabilityId === 'competitive-benchmark-analysis'
      || candidate?.capabilityId === 'content-customer-growth'
    );
  const validated = isV2
    ? validator(
      candidate,
      trustedV2Context(process.argv.slice(2), candidate.capabilityId),
    )
    : validator(candidate);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    capabilityId: validated.capabilityId,
    schemaVersion: validated.schemaVersion,
    status: validated.status,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 1;
}
