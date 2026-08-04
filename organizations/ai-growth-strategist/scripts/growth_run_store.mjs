import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  truncate,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { types as utilTypes } from 'node:util';

import {
  deepFreeze,
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';
import { writeJsonAtomic } from '../../../scripts/feishu-commander/atomic_store.mjs';
import {
  RUN_STATES,
  canTransition,
  validateGrowthRun,
} from './growth_run_contract.mjs';
import { createGrowthEvidenceLedger } from './growth_evidence_ledger.mjs';
import { EXTERNAL_ACTIONS } from './growth_experiment_manager.mjs';
import { createGrowthWorkspacePaths } from './growth_workspace_paths.mjs';

const IDENTITY_FIELDS = Object.freeze([
  'enterpriseId',
  'businessProjectId',
  'runId',
]);
const PRODUCTION_STORE_OPTION_FIELDS = Object.freeze(['projectRoot']);
const TEST_STORE_OPTION_FIELDS = Object.freeze(['projectRoot', 'clock']);
const TRANSITION_FIELDS = Object.freeze(['expectedState', 'nextState']);
const WRITE_EVIDENCE_OPTION_FIELDS = Object.freeze(['expectedRevision']);
const RECORD_APPROVAL_OPTION_FIELDS = Object.freeze(['expectedRevision']);
const APPROVAL_INPUT_FIELDS = Object.freeze([
  'approvalId',
  'runId',
  'allowedActions',
  'decision',
  'decidedAt',
  'expiresAt',
]);
const PERSISTED_APPROVAL_FIELDS = Object.freeze([
  'schemaVersion',
  'revision',
  'enterpriseId',
  'businessProjectId',
  'approvalId',
  'runId',
  'allowedActions',
  'decision',
  'decidedAt',
  'expiresAt',
  'consumedActions',
]);
const CONSUMED_ACTION_FIELDS = Object.freeze([
  'action',
  'consumedAt',
  'authorizationId',
]);
const CONSUME_APPROVAL_FIELDS = Object.freeze([
  'action',
  'approvalId',
]);
const EVENT_FIELDS = Object.freeze(['sequence', 'from', 'to', 'at']);
const TRANSACTION_FIELDS = Object.freeze([
  'schemaVersion',
  'kind',
  'identity',
  'previousState',
  'nextState',
  'event',
  'createdAt',
  'token',
]);
const LOCK_OWNER_FIELDS = Object.freeze([
  'schemaVersion',
  'token',
  'pid',
  'acquiredAt',
]);
const LOCK_WAIT_TIMEOUT_MS = 5_000;
const LOCK_LEASE_MS = 2_000;
const LOCK_POLL_MS = 25;
const LOCK_CANDIDATE_PREFIX = '.growth-run.lock.candidate-';
const MAX_LOCK_CANDIDATES = 1_024;
const ALL_RUN_STATES = new Set([
  ...RUN_STATES.normal,
  ...RUN_STATES.exceptional,
]);
const RUN_LOCKS = new Map();
const TRUSTED_GROWTH_RUN_STORES = new WeakSet();
const TEST_GROWTH_RUN_STORES = new WeakSet();
const AUTHORITATIVE_PRODUCTION_STORES = new Map();
const REFLECT_APPLY = Reflect.apply;
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_HAS = WeakSet.prototype.has;
const MAP_GET = Map.prototype.get;
const MAP_SET = Map.prototype.set;
const INTRINSIC_DATE = Date;
const INTRINSIC_DATE_NOW = Date.now;
const INTRINSIC_DATE_PARSE = Date.parse;
const INTRINSIC_DATE_GET_TIME = Date.prototype.getTime;
const INTRINSIC_DATE_TO_ISO_STRING = Date.prototype.toISOString;
const TEST_FACTORY_ENABLED_AT_LOAD = (
  typeof process.env.NODE_TEST_CONTEXT === 'string'
  && process.env.NODE_TEST_CONTEXT.length > 0
);

export function isTrustedGrowthRunStore(value) {
  if (!value || typeof value !== 'object') return false;
  return REFLECT_APPLY(
    WEAK_SET_HAS,
    TRUSTED_GROWTH_RUN_STORES,
    [value],
  );
}

export async function createGrowthRunStore(options = undefined) {
  const { projectRoot } = normalizeProductionStoreOptions(options);
  return createGrowthRunStoreInternal({
    projectRoot,
    clock: intrinsicNowMilliseconds,
    storeKind: 'production',
  });
}

export async function createGrowthRunStoreForTest(options = undefined) {
  if (!TEST_FACTORY_ENABLED_AT_LOAD) {
    throw new Error(
      'createGrowthRunStoreForTest is unavailable outside Node test context',
    );
  }
  const { projectRoot, clock } = normalizeTestStoreOptions(options);
  if (typeof clock !== 'function') {
    throw new TypeError('test growth run store clock must be a function');
  }
  return createGrowthRunStoreInternal({
    projectRoot,
    clock,
    storeKind: 'test',
  });
}

async function createGrowthRunStoreInternal({
  projectRoot,
  clock,
  storeKind,
}) {

  const canonicalProjectRoot = await realpath(projectRoot).catch((error) => {
    throw new Error(`projectRoot does not exist: ${error.message}`, {
      cause: error,
    });
  });
  await assertSafePath(canonicalProjectRoot, canonicalProjectRoot, {
    targetKind: 'directory',
  });
  const workspacePaths = await createGrowthWorkspacePaths({
    projectRoot: canonicalProjectRoot,
  });

  const initialize = async (run) => {
    const normalized = validateGrowthRun(run);
    if (normalized.state !== 'intake') {
      throw new Error('growth run initial state must be intake');
    }
    if (normalized.sequence !== 1) {
      throw new Error('growth run initial sequence must be 1');
    }
    if (normalized.createdAt !== normalized.updatedAt) {
      throw new Error(
        'growth run initial createdAt and updatedAt must be equal',
      );
    }
    const runIdentity = normalizeIdentity({
      enterpriseId: normalized.enterpriseId,
      businessProjectId: normalized.businessProjectId,
      runId: normalized.runId,
    });

    const paths = runtimePaths(workspacePaths.run(runIdentity));
    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      runIdentity,
      async () => {
        const recovery = await recoverRun(
          canonicalProjectRoot,
          paths,
          runIdentity,
        );
        if (
          recovery.intent?.kind === 'initialize'
          && runsEqual(recovery.intent.nextState, normalized)
        ) {
          return recovery.state;
        }
        if (recovery.state || recovery.timeline.length > 0) {
          throw new Error('growth run initialize conflict: run already exists');
        }

        const event = Object.freeze({
          sequence: 1,
          from: null,
          to: 'intake',
          at: normalized.createdAt,
        });
        const intent = createTransactionIntent({
          kind: 'initialize',
          identity: runIdentity,
          previousState: null,
          nextState: normalized,
          event,
          createdAt: normalized.createdAt,
        });
        await writeTransactionIntent(
          canonicalProjectRoot,
          paths.transactionFile,
          intent,
        );
        await writeState(canonicalProjectRoot, paths.stateFile, normalized);
        await appendTimelineEvent(
          canonicalProjectRoot,
          paths.timelineFile,
          event,
        );
        await deleteTransactionIntent(
          canonicalProjectRoot,
          paths.transactionFile,
          intent.token,
          runIdentity,
        );
        return normalized;
      },
    );
  };

  const read = async (identity) => {
    const normalizedIdentity = normalizeIdentity(identity);
    const paths = runtimePaths(workspacePaths.run(normalizedIdentity));
    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      normalizedIdentity,
      async () => {
        const recovered = await recoverRun(
          canonicalProjectRoot,
          paths,
          normalizedIdentity,
        );
        if (!recovered.state) {
          throw new Error('growth run state not found');
        }
        return recovered.state;
      },
    );
  };

  const transition = async (identity, transitionInput) => {
    const normalizedIdentity = normalizeIdentity(identity);
    const normalizedTransition = normalizeTransition(transitionInput);
    const paths = runtimePaths(workspacePaths.run(normalizedIdentity));

    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      normalizedIdentity,
      async () => {
        const recovered = await recoverRun(
          canonicalProjectRoot,
          paths,
          normalizedIdentity,
        );
        const current = recovered.state;
        if (!current) {
          throw new Error('growth run state not found');
        }
        if (current.state !== normalizedTransition.expectedState) {
          throw new Error(
            `growth run transition conflict: expected ${normalizedTransition.expectedState}, found ${current.state}`,
          );
        }
        if (!canTransition(current.state, normalizedTransition.nextState)) {
          throw new Error(
            `growth run transition is invalid: ${current.state} -> ${normalizedTransition.nextState}`,
          );
        }

        const lastEvent = recovered.timeline.at(-1);
        const updatedAt = isoNow(clock);
        if (parseTimestamp(updatedAt) < parseTimestamp(lastEvent.at)) {
          throw new Error(
            'growth run time cannot move earlier than the last timeline event',
          );
        }
        const next = validateGrowthRun({
          ...current,
          state: normalizedTransition.nextState,
          sequence: current.sequence + 1,
          updatedAt,
        }, normalizedIdentity);
        const event = Object.freeze({
          sequence: next.sequence,
          from: current.state,
          to: normalizedTransition.nextState,
          at: next.updatedAt,
        });
        const intent = createTransactionIntent({
          kind: 'transition',
          identity: normalizedIdentity,
          previousState: current,
          nextState: next,
          event,
          createdAt: next.updatedAt,
        });

        await writeTransactionIntent(
          canonicalProjectRoot,
          paths.transactionFile,
          intent,
        );
        await writeState(canonicalProjectRoot, paths.stateFile, next);
        await appendTimelineEvent(
          canonicalProjectRoot,
          paths.timelineFile,
          event,
        );
        await deleteTransactionIntent(
          canonicalProjectRoot,
          paths.transactionFile,
          intent.token,
          normalizedIdentity,
        );
        return next;
      },
    );
  };

  const readTimeline = async (identity) => {
    const normalizedIdentity = normalizeIdentity(identity);
    const paths = runtimePaths(workspacePaths.run(normalizedIdentity));
    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      normalizedIdentity,
      async () => {
        const recovered = await recoverRun(
          canonicalProjectRoot,
          paths,
          normalizedIdentity,
        );
        if (recovered.timeline.length === 0) {
          throw new Error('growth run timeline not found');
        }
        return recovered.timeline;
      },
    );
  };

  const writeEvidenceLedger = async (identity, ledger, options) => {
    const normalizedIdentity = normalizeIdentity(identity);
    const normalizedLedger = createGrowthEvidenceLedger(
      ledger,
      normalizedIdentity,
    );
    const normalizedOptions = normalizeEvidenceWriteOptions(options);
    const isPersistedInput = Object.hasOwn(ledger, 'schemaVersion')
      || Object.hasOwn(ledger, 'revision');
    if (
      isPersistedInput
      && normalizedLedger.revision !== normalizedOptions.expectedRevision
    ) {
      throw new Error(
        'growth evidence ledger revision must equal expectedRevision',
      );
    }
    const paths = runtimePaths(workspacePaths.run(normalizedIdentity));
    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      normalizedIdentity,
      async () => {
        const recovered = await recoverRun(
          canonicalProjectRoot,
          paths,
          normalizedIdentity,
        );
        if (!recovered.state) {
          throw new Error('growth run state not found');
        }
        const currentValue = await readOptionalStrictJson(
          canonicalProjectRoot,
          paths.evidenceFile,
          'growth evidence ledger',
        );
        const currentLedger = currentValue === null
          ? null
          : createGrowthEvidenceLedger(currentValue, normalizedIdentity);
        const currentRevision = currentLedger?.revision ?? 0;
        if (normalizedOptions.expectedRevision !== currentRevision) {
          if (
            currentLedger
            && evidenceLedgerContentsEqual(normalizedLedger, currentLedger)
          ) {
            return currentLedger;
          }
          throw new Error(
            `growth evidence ledger revision conflict: expected ${normalizedOptions.expectedRevision}, found ${currentRevision}`,
          );
        }
        const nextLedger = createGrowthEvidenceLedger({
          schemaVersion: 1,
          revision: currentRevision + 1,
          enterpriseId: normalizedLedger.enterpriseId,
          businessProjectId: normalizedLedger.businessProjectId,
          runId: normalizedLedger.runId,
          items: normalizedLedger.items,
        }, normalizedIdentity);
        await assertSafePath(canonicalProjectRoot, paths.evidenceFile, {
          targetKind: 'file',
          allowMissing: true,
        });
        await writeJsonAtomic(paths.evidenceFile, nextLedger);
        return nextLedger;
      },
    );
  };

  const readEvidenceLedger = async (identity) => {
    const normalizedIdentity = normalizeIdentity(identity);
    const paths = runtimePaths(workspacePaths.run(normalizedIdentity));
    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      normalizedIdentity,
      async () => {
        const recovered = await recoverRun(
          canonicalProjectRoot,
          paths,
          normalizedIdentity,
        );
        if (!recovered.state) {
          throw new Error('growth run state not found');
        }
        const value = await readOptionalStrictJson(
          canonicalProjectRoot,
          paths.evidenceFile,
          'growth evidence ledger',
        );
        if (value === null) {
          throw new Error('growth evidence ledger not found');
        }
        return createGrowthEvidenceLedger(value, normalizedIdentity);
      },
    );
  };

  const recordApproval = async (identity, approval, options) => {
    assertApprovalAuthority();
    const normalizedIdentity = normalizeIdentity(identity);
    const normalizedApproval = normalizeApprovalInput(
      approval,
      normalizedIdentity,
    );
    const normalizedOptions = normalizeApprovalWriteOptions(options);
    const paths = runtimePaths(workspacePaths.run(normalizedIdentity));

    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      normalizedIdentity,
      async () => {
        const recovered = await recoverRun(
          canonicalProjectRoot,
          paths,
          normalizedIdentity,
        );
        if (!recovered.state) {
          throw new Error('growth run state not found');
        }
        if (recovered.state.state !== 'awaiting_approval') {
          throw new Error(
            'growth approval may only be recorded while awaiting_approval',
          );
        }
        const currentValue = await readOptionalStrictJson(
          canonicalProjectRoot,
          paths.approvalFile,
          'growth approval',
        );
        const currentApproval = currentValue === null
          ? null
          : validatePersistedApproval(currentValue, normalizedIdentity);
        if (
          currentApproval
          && approvalContentsEqual(currentApproval, normalizedApproval)
        ) {
          return currentApproval;
        }
        const currentRevision = currentApproval?.revision ?? 0;
        if (normalizedOptions.expectedRevision !== currentRevision) {
          throw new Error(
            `growth approval revision conflict: expected ${normalizedOptions.expectedRevision}, found ${currentRevision}`,
          );
        }
        if (currentRevision >= Number.MAX_SAFE_INTEGER) {
          throw new Error('growth approval revision limit reached');
        }
        const nextApproval = validatePersistedApproval({
          schemaVersion: 1,
          revision: currentRevision + 1,
          enterpriseId: normalizedIdentity.enterpriseId,
          businessProjectId: normalizedIdentity.businessProjectId,
          approvalId: normalizedApproval.approvalId,
          runId: normalizedApproval.runId,
          allowedActions: normalizedApproval.allowedActions,
          decision: normalizedApproval.decision,
          decidedAt: normalizedApproval.decidedAt,
          expiresAt: normalizedApproval.expiresAt,
          consumedActions: currentApproval?.consumedActions ?? [],
        }, normalizedIdentity);
        await assertSafePath(canonicalProjectRoot, paths.approvalFile, {
          targetKind: 'file',
          allowMissing: true,
        });
        await writeJsonAtomic(paths.approvalFile, nextApproval);
        return nextApproval;
      },
    );
  };

  const consumeExternalApproval = async (identity, options) => {
    assertApprovalAuthority();
    const normalizedIdentity = normalizeIdentity(identity);
    const normalizedOptions = normalizeApprovalConsumeOptions(options);
    const paths = runtimePaths(workspacePaths.run(normalizedIdentity));

    return withExclusiveRun(
      canonicalProjectRoot,
      paths,
      normalizedIdentity,
      async () => {
        const recovered = await recoverRun(
          canonicalProjectRoot,
          paths,
          normalizedIdentity,
        );
        if (!recovered.state) {
          throw new Error('growth run state not found');
        }
        if (recovered.state.state !== 'running_approved') {
          throw new Error(
            'external approval consumption requires running_approved state',
          );
        }
        const value = await readOptionalStrictJson(
          canonicalProjectRoot,
          paths.approvalFile,
          'growth approval',
        );
        if (value === null) {
          throw new Error('growth approval not found');
        }
        const currentApproval = validatePersistedApproval(
          value,
          normalizedIdentity,
        );
        if (currentApproval.approvalId !== normalizedOptions.approvalId) {
          throw new Error(
            'approvalId does not match the persisted growth approval',
          );
        }
        if (currentApproval.decision !== 'approved') {
          throw new Error(
            'persisted growth approval decision is not approved',
          );
        }
        if (
          !arrayContains(
            currentApproval.allowedActions,
            normalizedOptions.action,
          )
        ) {
          throw new Error(
            'external action is not allowed by the persisted growth approval',
          );
        }

        const authorizedAt = isoNow(clock);
        if (
          parseTimestamp(authorizedAt)
          < parseTimestamp(currentApproval.decidedAt)
        ) {
          throw new Error(
            'persisted growth approval is not yet decided at trusted time',
          );
        }
        if (
          parseTimestamp(authorizedAt)
          >= parseTimestamp(currentApproval.expiresAt)
        ) {
          throw new Error(
            'persisted growth approval is expired at trusted time',
          );
        }
        for (
          let index = 0;
          index < currentApproval.consumedActions.length;
          index += 1
        ) {
          if (
            currentApproval.consumedActions[index].action
            === normalizedOptions.action
          ) {
            throw new Error(
              'external approval replay conflict: action already consumed',
            );
          }
        }
        if (currentApproval.revision >= Number.MAX_SAFE_INTEGER) {
          throw new Error('growth approval revision limit reached');
        }

        const authorizationId = `authorization-${randomUUID()}`;
        const consumedActions = new Array(
          currentApproval.consumedActions.length + 1,
        );
        for (
          let index = 0;
          index < currentApproval.consumedActions.length;
          index += 1
        ) {
          consumedActions[index] = currentApproval.consumedActions[index];
        }
        consumedActions[consumedActions.length - 1] = Object.freeze({
          action: normalizedOptions.action,
          consumedAt: authorizedAt,
          authorizationId,
        });
        const nextApproval = validatePersistedApproval({
          ...currentApproval,
          revision: currentApproval.revision + 1,
          consumedActions,
        }, normalizedIdentity);
        await assertSafePath(canonicalProjectRoot, paths.approvalFile, {
          targetKind: 'file',
        });
        await writeJsonAtomic(paths.approvalFile, nextApproval);

        return Object.freeze({
          allowed: true,
          action: normalizedOptions.action,
          runId: normalizedIdentity.runId,
          approvalId: currentApproval.approvalId,
          authorizationId,
          authorizedAt,
          expiresAt: currentApproval.expiresAt,
          approvalRevision: nextApproval.revision,
        });
      },
    );
  };

  const assertApprovalAuthority = () => {
    const authoritative = REFLECT_APPLY(
      MAP_GET,
      AUTHORITATIVE_PRODUCTION_STORES,
      [canonicalProjectRoot],
    );
    if (
      storeKind !== 'production'
      || authoritative !== store
      || !isTrustedGrowthRunStore(store)
    ) {
      throw new Error(
        'growth approval requires the authoritative production run store',
      );
    }
  };

  const store = Object.freeze({
    initialize,
    read,
    transition,
    readTimeline,
    writeEvidenceLedger,
    readEvidenceLedger,
    recordApproval,
    consumeExternalApproval,
  });
  if (storeKind === 'production') {
    const existingAuthority = REFLECT_APPLY(
      MAP_GET,
      AUTHORITATIVE_PRODUCTION_STORES,
      [canonicalProjectRoot],
    );
    if (existingAuthority === undefined) {
      REFLECT_APPLY(
        MAP_SET,
        AUTHORITATIVE_PRODUCTION_STORES,
        [canonicalProjectRoot, store],
      );
      REFLECT_APPLY(
        WEAK_SET_ADD,
        TRUSTED_GROWTH_RUN_STORES,
        [store],
      );
    }
  } else {
    REFLECT_APPLY(
      WEAK_SET_ADD,
      TEST_GROWTH_RUN_STORES,
      [store],
    );
  }
  return store;
}

function normalizeProductionStoreOptions(options) {
  const fields = exactDataProperties(
    options,
    PRODUCTION_STORE_OPTION_FIELDS,
    'production growth run store options',
  );
  return Object.freeze({
    projectRoot: fields.projectRoot,
  });
}

function normalizeTestStoreOptions(options) {
  const fields = exactDataProperties(
    options,
    TEST_STORE_OPTION_FIELDS,
    'test-only growth run store options',
  );
  return Object.freeze({
    projectRoot: fields.projectRoot,
    clock: fields.clock,
  });
}

function normalizeIdentity(value) {
  const fields = exactDataProperties(value, IDENTITY_FIELDS, 'growth run identity');
  return Object.freeze({
    enterpriseId: requireEnterpriseId(fields.enterpriseId),
    businessProjectId: requireBusinessProjectId(fields.businessProjectId),
    runId: requireSafeId(fields.runId, 'runId'),
  });
}

function normalizeTransition(value) {
  const fields = exactDataProperties(
    value,
    TRANSITION_FIELDS,
    'growth run transition',
  );
  if (!ALL_RUN_STATES.has(fields.expectedState)) {
    throw new Error('growth run transition expectedState is invalid');
  }
  if (!ALL_RUN_STATES.has(fields.nextState)) {
    throw new Error('growth run transition nextState is invalid');
  }
  return Object.freeze({
    expectedState: fields.expectedState,
    nextState: fields.nextState,
  });
}

function normalizeEvidenceWriteOptions(value) {
  const fields = exactDataProperties(
    value,
    WRITE_EVIDENCE_OPTION_FIELDS,
    'growth evidence write options',
  );
  if (
    !Number.isSafeInteger(fields.expectedRevision)
    || fields.expectedRevision < 0
  ) {
    throw new Error(
      'growth evidence write options.expectedRevision must be a non-negative safe integer',
    );
  }
  return Object.freeze({
    expectedRevision: fields.expectedRevision,
  });
}

function normalizeApprovalWriteOptions(value) {
  const fields = exactDataProperties(
    value,
    RECORD_APPROVAL_OPTION_FIELDS,
    'growth approval write options',
  );
  if (
    !Number.isSafeInteger(fields.expectedRevision)
    || fields.expectedRevision < 0
  ) {
    throw new Error(
      'growth approval write options.expectedRevision must be a non-negative safe integer',
    );
  }
  return Object.freeze({
    expectedRevision: fields.expectedRevision,
  });
}

function normalizeApprovalConsumeOptions(value) {
  const fields = exactDataProperties(
    value,
    CONSUME_APPROVAL_FIELDS,
    'growth approval consume options',
  );
  return Object.freeze({
    action: requireExternalAction(
      fields.action,
      'growth approval consume options.action',
    ),
    approvalId: requireSafeId(
      fields.approvalId,
      'approvalId',
    ),
  });
}

function normalizeApprovalInput(value, expectedIdentity) {
  const fields = exactDataProperties(
    value,
    APPROVAL_INPUT_FIELDS,
    'growth approval',
  );
  const approvalId = requireSafeId(fields.approvalId, 'approvalId');
  const runId = requireSafeId(fields.runId, 'approval.runId');
  if (runId !== expectedIdentity.runId) {
    throw new Error('growth approval runId identity mismatch');
  }
  const allowedActions = copyExternalActions(
    fields.allowedActions,
    'growth approval allowedActions',
  );
  if (
    fields.decision !== 'approved'
    && fields.decision !== 'rejected'
  ) {
    throw new Error(
      'growth approval decision must be approved or rejected',
    );
  }
  const decidedAt = requireCanonicalIsoTimestamp(
    fields.decidedAt,
    'growth approval decidedAt',
  );
  const expiresAt = requireCanonicalIsoTimestamp(
    fields.expiresAt,
    'growth approval expiresAt',
  );
  if (parseTimestamp(expiresAt) <= parseTimestamp(decidedAt)) {
    throw new Error(
      'growth approval expiresAt must be later than decidedAt',
    );
  }
  return Object.freeze({
    approvalId,
    runId,
    allowedActions,
    decision: fields.decision,
    decidedAt,
    expiresAt,
  });
}

function validatePersistedApproval(value, expectedIdentity) {
  const fields = exactDataProperties(
    value,
    PERSISTED_APPROVAL_FIELDS,
    'persisted growth approval',
  );
  if (fields.schemaVersion !== 1) {
    throw new Error(
      'persisted growth approval schemaVersion must be 1',
    );
  }
  if (!Number.isSafeInteger(fields.revision) || fields.revision < 1) {
    throw new Error(
      'persisted growth approval revision must be a positive safe integer',
    );
  }
  const enterpriseId = requireEnterpriseId(fields.enterpriseId);
  const businessProjectId = requireBusinessProjectId(
    fields.businessProjectId,
  );
  if (
    enterpriseId !== expectedIdentity.enterpriseId
    || businessProjectId !== expectedIdentity.businessProjectId
  ) {
    throw new Error('persisted growth approval identity mismatch');
  }
  const normalized = normalizeApprovalInput({
    approvalId: fields.approvalId,
    runId: fields.runId,
    allowedActions: fields.allowedActions,
    decision: fields.decision,
    decidedAt: fields.decidedAt,
    expiresAt: fields.expiresAt,
  }, expectedIdentity);
  const consumedActions = copyConsumedActions(
    fields.consumedActions,
    normalized,
  );
  if (
    normalized.decision !== 'approved'
    && consumedActions.length > 0
  ) {
    throw new Error(
      'rejected growth approval cannot contain consumed actions',
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    revision: fields.revision,
    enterpriseId,
    businessProjectId,
    approvalId: normalized.approvalId,
    runId: normalized.runId,
    allowedActions: normalized.allowedActions,
    decision: normalized.decision,
    decidedAt: normalized.decidedAt,
    expiresAt: normalized.expiresAt,
    consumedActions,
  });
}

function copyExternalActions(value, label) {
  const length = requireDenseStandardArray(
    value,
    label,
    EXTERNAL_ACTIONS.size,
  );
  const result = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      value,
      String(index),
    );
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}[${index}] must be an own data property`);
    }
    const action = requireExternalAction(
      descriptor.value,
      `${label}[${index}]`,
    );
    for (let prior = 0; prior < index; prior += 1) {
      if (result[prior] === action) {
        throw new Error(`${label} must be unique`);
      }
    }
    result[index] = action;
  }
  return Object.freeze(result);
}

function copyConsumedActions(value, approval) {
  const label = 'persisted growth approval consumedActions';
  const length = requireDenseStandardArray(
    value,
    label,
    EXTERNAL_ACTIONS.size,
  );
  const result = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      value,
      String(index),
    );
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}[${index}] must be an own data property`);
    }
    const fields = exactDataProperties(
      descriptor.value,
      CONSUMED_ACTION_FIELDS,
      `${label}[${index}]`,
    );
    const action = requireExternalAction(
      fields.action,
      `${label}[${index}].action`,
    );
    if (!arrayContains(approval.allowedActions, action)) {
      throw new Error(
        `${label}[${index}].action is not in allowedActions`,
      );
    }
    const consumedAt = requireCanonicalIsoTimestamp(
      fields.consumedAt,
      `${label}[${index}].consumedAt`,
    );
    if (
      parseTimestamp(consumedAt) < parseTimestamp(approval.decidedAt)
      || parseTimestamp(consumedAt) >= parseTimestamp(approval.expiresAt)
    ) {
      throw new Error(
        `${label}[${index}].consumedAt is outside approval time`,
      );
    }
    const authorizationId = requireSafeId(
      fields.authorizationId,
      `${label}[${index}].authorizationId`,
    );
    for (let prior = 0; prior < index; prior += 1) {
      if (result[prior].action === action) {
        throw new Error(`${label} actions must be unique`);
      }
      if (result[prior].authorizationId === authorizationId) {
        throw new Error(`${label} authorizationId values must be unique`);
      }
    }
    result[index] = Object.freeze({
      action,
      consumedAt,
      authorizationId,
    });
  }
  return Object.freeze(result);
}

function requireExternalAction(value, label) {
  if (typeof value !== 'string' || EXTERNAL_ACTIONS.has(value) !== true) {
    throw new Error(`${label} is not a supported external action`);
  }
  return value;
}

function approvalContentsEqual(left, right) {
  if (
    left.approvalId !== right.approvalId
    || left.runId !== right.runId
    || left.decision !== right.decision
    || left.decidedAt !== right.decidedAt
    || left.expiresAt !== right.expiresAt
    || left.allowedActions.length !== right.allowedActions.length
  ) {
    return false;
  }
  for (let index = 0; index < left.allowedActions.length; index += 1) {
    if (left.allowedActions[index] !== right.allowedActions[index]) {
      return false;
    }
  }
  return true;
}

function evidenceLedgerContentsEqual(left, right) {
  if (
    left.enterpriseId !== right.enterpriseId
    || left.businessProjectId !== right.businessProjectId
    || left.runId !== right.runId
    || left.items.length !== right.items.length
  ) {
    return false;
  }
  const scalarFields = [
    'id',
    'type',
    'claim',
    'sourceReference',
    'sourceVersion',
    'sourceSha256',
    'observedAt',
    'appliesTo',
    'confidence',
  ];
  for (let index = 0; index < left.items.length; index += 1) {
    const leftItem = left.items[index];
    const rightItem = right.items[index];
    for (const field of scalarFields) {
      if (leftItem[field] !== rightItem[field]) return false;
    }
    if (
      leftItem.conflictReferences.length
      !== rightItem.conflictReferences.length
    ) {
      return false;
    }
    for (
      let referenceIndex = 0;
      referenceIndex < leftItem.conflictReferences.length;
      referenceIndex += 1
    ) {
      if (
        leftItem.conflictReferences[referenceIndex]
        !== rightItem.conflictReferences[referenceIndex]
      ) {
        return false;
      }
    }
  }
  return true;
}

function requireDenseStandardArray(value, label, maximumLength) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must use the standard Array prototype`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    !lengthDescriptor
    || !Object.hasOwn(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new Error(
      `${label}.length must be an own safe integer data property`,
    );
  }
  const length = lengthDescriptor.value;
  if (length > maximumLength) {
    throw new Error(`${label} exceeds size limit of ${maximumLength}`);
  }

  let indexKeyCount = 0;
  const ownKeys = Reflect.ownKeys(value);
  for (let position = 0; position < ownKeys.length; position += 1) {
    const key = ownKeys[position];
    if (key === 'length') continue;
    const index = typeof key === 'string' ? Number(key) : Number.NaN;
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || String(index) !== key
    ) {
      throw new Error(`${label} has unexpected property: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}[${index}] must be an own data property`);
    }
    indexKeyCount += 1;
  }
  if (indexKeyCount !== length) {
    throw new Error(`${label} must be dense and cannot contain sparse holes`);
  }
  return length;
}

function arrayContains(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function exactDataProperties(value, expectedFields, label) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !arrayContains(expectedFields, key)) {
      throw new Error(`${label} has unexpected field: ${String(key)}`);
    }
  }
  const result = Object.create(null);
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor) {
      throw new Error(`${label} is missing required field: ${field}`);
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new Error(
        `${label}.${field} must be an own data property, not an accessor`,
      );
    }
    result[field] = descriptor.value;
  }
  return result;
}

function intrinsicNowMilliseconds() {
  return INTRINSIC_DATE_NOW();
}

function intrinsicIsoNow() {
  return REFLECT_APPLY(
    INTRINSIC_DATE_TO_ISO_STRING,
    new INTRINSIC_DATE(intrinsicNowMilliseconds()),
    [],
  );
}

function parseTimestamp(value) {
  return INTRINSIC_DATE_PARSE(value);
}

function isoNow(clock) {
  let value;
  try {
    value = clock();
  } catch (error) {
    throw new Error(`clock failed: ${error.message}`, { cause: error });
  }
  if (
    !(value instanceof INTRINSIC_DATE)
    && typeof value !== 'string'
    && typeof value !== 'number'
  ) {
    throw new TypeError('clock must return a valid date or time');
  }
  const milliseconds = value instanceof INTRINSIC_DATE
    ? REFLECT_APPLY(INTRINSIC_DATE_GET_TIME, value, [])
    : typeof value === 'number'
      ? value
      : parseTimestamp(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error('clock returned an invalid date or time');
  }
  return REFLECT_APPLY(
    INTRINSIC_DATE_TO_ISO_STRING,
    new INTRINSIC_DATE(milliseconds),
    [],
  );
}

function runtimePaths(paths) {
  const lockDirectory = path.join(paths.root, '.growth-run.lock');
  return Object.freeze({
    ...paths,
    transactionFile: path.join(paths.root, 'transaction.json'),
    lockDirectory,
    lockOwnerFile: path.join(lockDirectory, 'owner.json'),
  });
}

function createTransactionIntent({
  kind,
  identity,
  previousState,
  nextState,
  event,
  createdAt,
}) {
  return validateTransactionIntent({
    schemaVersion: 1,
    kind,
    identity,
    previousState,
    nextState,
    event,
    createdAt,
    token: `transaction-${randomUUID()}`,
  }, identity);
}

function validateTransactionIntent(value, expectedIdentity) {
  const fields = exactDataProperties(
    value,
    TRANSACTION_FIELDS,
    'growth run transaction intent',
  );
  if (fields.schemaVersion !== 1) {
    throw new Error('growth run transaction intent schemaVersion must be 1');
  }
  if (!['initialize', 'transition'].includes(fields.kind)) {
    throw new Error('growth run transaction intent kind is invalid');
  }
  const identity = normalizeIdentity(fields.identity);
  if (expectedIdentity && !identitiesEqual(identity, expectedIdentity)) {
    throw new Error('growth run transaction intent identity mismatch');
  }
  const previousState = fields.previousState === null
    ? null
    : validateGrowthRun(fields.previousState, identity);
  const nextState = validateGrowthRun(fields.nextState, identity);
  const eventFields = exactDataProperties(
    fields.event,
    EVENT_FIELDS,
    'growth run transaction event',
  );
  if (
    !Number.isSafeInteger(eventFields.sequence)
    || eventFields.sequence < 1
  ) {
    throw new Error('growth run transaction event sequence is invalid');
  }
  if (
    eventFields.from !== null
    && !ALL_RUN_STATES.has(eventFields.from)
  ) {
    throw new Error('growth run transaction event from state is invalid');
  }
  if (!ALL_RUN_STATES.has(eventFields.to)) {
    throw new Error('growth run transaction event to state is invalid');
  }
  const event = Object.freeze({
    sequence: eventFields.sequence,
    from: eventFields.from,
    to: eventFields.to,
    at: requireCanonicalIsoTimestamp(
      eventFields.at,
      'growth run transaction event at',
    ),
  });
  const createdAt = requireCanonicalIsoTimestamp(
    fields.createdAt,
    'growth run transaction createdAt',
  );
  const token = requireSafeId(fields.token, 'transaction token');

  if (fields.kind === 'initialize') {
    if (
      previousState !== null
      || nextState.state !== 'intake'
      || nextState.sequence !== 1
      || nextState.createdAt !== nextState.updatedAt
      || event.sequence !== 1
      || event.from !== null
      || event.to !== 'intake'
      || event.at !== nextState.createdAt
    ) {
      throw new Error('growth run initialize transaction intent is inconsistent');
    }
  } else {
    if (!previousState) {
      throw new Error('growth run transition intent requires previousState');
    }
    const expectedNext = {
      ...previousState,
      state: event.to,
      sequence: previousState.sequence + 1,
      updatedAt: event.at,
    };
    if (
      event.sequence !== expectedNext.sequence
      || event.from !== previousState.state
      || !canTransition(event.from, event.to)
      || nextState.updatedAt < previousState.updatedAt
      || !runsEqual(nextState, expectedNext)
    ) {
      throw new Error('growth run transition transaction intent is inconsistent');
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: fields.kind,
    identity,
    previousState,
    nextState,
    event,
    createdAt,
    token,
  });
}

async function recoverRun(projectRoot, paths, identity) {
  const rawIntent = await readOptionalStrictJson(
    projectRoot,
    paths.transactionFile,
    'growth run transaction intent',
  );
  const intent = rawIntent
    ? validateTransactionIntent(rawIntent, identity)
    : null;
  let state = await readOptionalState(
    projectRoot,
    paths.stateFile,
    identity,
  );
  let snapshot = await readTimelineSnapshot(
    projectRoot,
    paths.timelineFile,
    intent,
  );

  if (!intent) {
    if (!state && !snapshot.exists) {
      return Object.freeze({
        state: null,
        timeline: deepFreeze([]),
        intent: null,
      });
    }
    if (!state || !snapshot.exists || snapshot.events.length === 0) {
      throw new Error(
        'growth run state and timeline are inconsistent without transaction intent',
      );
    }
    reconcileStateAndTimeline(state, snapshot.events);
    return Object.freeze({
      state,
      timeline: snapshot.events,
      intent: null,
    });
  }

  if (snapshot.partialBytes !== null) {
    await truncateTimelineTail(
      projectRoot,
      paths.timelineFile,
      snapshot.completeByteLength,
    );
    snapshot = Object.freeze({
      exists: true,
      events: snapshot.events,
      partialBytes: null,
      completeByteLength: snapshot.completeByteLength,
    });
  }

  const statePosition = transactionStatePosition(state, intent);
  const eventPosition = transactionEventPosition(snapshot, intent);
  if (statePosition === 'previous' && eventPosition === 'previous') {
    await writeState(projectRoot, paths.stateFile, intent.nextState);
    await appendTimelineEvent(projectRoot, paths.timelineFile, intent.event);
  } else if (statePosition === 'previous' && eventPosition === 'next') {
    await writeState(projectRoot, paths.stateFile, intent.nextState);
  } else if (statePosition === 'next' && eventPosition === 'previous') {
    await appendTimelineEvent(projectRoot, paths.timelineFile, intent.event);
  }

  state = await readState(projectRoot, paths.stateFile, identity);
  const timeline = await readTimelineFile(projectRoot, paths.timelineFile);
  reconcileStateAndTimeline(state, timeline);
  if (!runsEqual(state, intent.nextState)) {
    throw new Error('growth run recovery state does not match transaction intent');
  }
  const lastEvent = timeline.at(-1);
  if (!eventsEqual(lastEvent, intent.event)) {
    throw new Error('growth run recovery event does not match transaction intent');
  }
  await deleteTransactionIntent(
    projectRoot,
    paths.transactionFile,
    intent.token,
    identity,
  );
  return Object.freeze({ state, timeline, intent });
}

function transactionStatePosition(state, intent) {
  if (runsEqual(state, intent.nextState)) return 'next';
  if (intent.kind === 'initialize' && state === null) return 'previous';
  if (
    intent.kind === 'transition'
    && runsEqual(state, intent.previousState)
  ) {
    return 'previous';
  }
  throw new Error('growth run state conflicts with transaction intent');
}

function transactionEventPosition(snapshot, intent) {
  const events = snapshot.events;
  const lastEvent = events.at(-1);
  if (
    events.length === intent.nextState.sequence
    && eventsEqual(lastEvent, intent.event)
  ) {
    return 'next';
  }
  if (intent.kind === 'initialize') {
    if (events.length === 0) return 'previous';
  } else if (
    events.length === intent.previousState.sequence
  ) {
    reconcileStateAndTimeline(intent.previousState, events);
    return 'previous';
  }
  throw new Error('growth run timeline conflicts with transaction intent');
}

function reconcileStateAndTimeline(state, timeline) {
  if (!state || timeline.length === 0) {
    throw new Error('growth run state and timeline are inconsistent');
  }
  const firstEvent = timeline[0];
  const lastEvent = timeline.at(-1);
  if (
    timeline.length !== state.sequence
    || firstEvent.sequence !== 1
    || firstEvent.at !== state.createdAt
    || lastEvent.sequence !== state.sequence
    || lastEvent.to !== state.state
    || lastEvent.at !== state.updatedAt
  ) {
    throw new Error(
      'growth run state and timeline timestamps or sequence are inconsistent',
    );
  }
}

async function readOptionalState(projectRoot, stateFile, identity) {
  const value = await readOptionalStrictJson(
    projectRoot,
    stateFile,
    'growth run state',
  );
  return value === null ? null : validateGrowthRun(value, identity);
}

async function readOptionalStrictJson(projectRoot, filePath, label) {
  const status = await assertSafePath(projectRoot, filePath, {
    targetKind: 'file',
    allowMissing: true,
  });
  if (!status.exists) return null;
  const raw = await readFile(filePath, 'utf8');
  return parseStrictJson(raw, label);
}

async function readTimelineSnapshot(projectRoot, timelineFile, intent) {
  const status = await assertSafePath(projectRoot, timelineFile, {
    targetKind: 'file',
    allowMissing: true,
  });
  if (!status.exists) {
    return Object.freeze({
      exists: false,
      events: deepFreeze([]),
      partialBytes: null,
      completeByteLength: 0,
    });
  }
  const raw = await readFile(timelineFile);
  if (raw.length === 0) {
    return Object.freeze({
      exists: true,
      events: deepFreeze([]),
      partialBytes: null,
      completeByteLength: 0,
    });
  }
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    throw new Error('growth run timeline must not contain a BOM');
  }

  const lastNewline = raw.lastIndexOf(0x0A);
  const completeByteLength = lastNewline + 1;
  const partialBytes = completeByteLength === raw.length
    ? null
    : raw.subarray(completeByteLength);
  if (partialBytes !== null) {
    if (!intent) {
      throw new Error(
        'growth run timeline has a partial tail without transaction intent',
      );
    }
    const intendedBytes = Buffer.from(JSON.stringify(intent.event), 'utf8');
    if (
      partialBytes.length > intendedBytes.length
      || !intendedBytes.subarray(0, partialBytes.length).equals(partialBytes)
    ) {
      throw new Error(
        'growth run timeline partial tail does not belong to transaction intent',
      );
    }
  }
  const complete = raw.subarray(0, completeByteLength).toString('utf8');
  const events = parseCompleteTimeline(complete);
  return Object.freeze({
    exists: true,
    events,
    partialBytes,
    completeByteLength,
  });
}

function parseCompleteTimeline(raw) {
  if (raw === '') return deepFreeze([]);
  if (!raw.endsWith('\n')) {
    throw new Error('growth run timeline must end with a complete newline');
  }
  const lines = raw.split('\n');
  lines.pop();
  const events = [];
  let previousEvent;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      throw new Error('growth run timeline contains a blank line');
    }
    const event = validateTimelineEvent(
      parseStrictJson(line, `growth run timeline line ${index + 1}`),
      index,
      previousEvent,
    );
    events.push(event);
    previousEvent = event;
  }
  return deepFreeze(events);
}

async function truncateTimelineTail(projectRoot, timelineFile, byteLength) {
  await assertSafePath(projectRoot, timelineFile, {
    targetKind: 'file',
  });
  await truncate(timelineFile, byteLength);
}

async function writeTransactionIntent(projectRoot, transactionFile, intent) {
  await assertSafePath(projectRoot, transactionFile, {
    targetKind: 'file',
    allowMissing: true,
  });
  await writeJsonAtomic(transactionFile, intent);
}

async function deleteTransactionIntent(
  projectRoot,
  transactionFile,
  expectedToken,
  identity,
) {
  const value = await readOptionalStrictJson(
    projectRoot,
    transactionFile,
    'growth run transaction intent',
  );
  if (value === null) return;
  const current = validateTransactionIntent(value, identity);
  if (current.token !== expectedToken) {
    throw new Error('growth run transaction intent token changed');
  }
  await assertSafePath(projectRoot, transactionFile, {
    targetKind: 'file',
  });
  await unlink(transactionFile);
}

function runsEqual(left, right) {
  return left !== null
    && right !== null
    && JSON.stringify(left) === JSON.stringify(right);
}

function eventsEqual(left, right) {
  return Boolean(
    left
    && right
    && left.sequence === right.sequence
    && left.from === right.from
    && left.to === right.to
    && left.at === right.at,
  );
}

function identitiesEqual(left, right) {
  return IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}

async function readState(projectRoot, stateFile, expectedIdentity) {
  const raw = await readSafeTextFile(
    projectRoot,
    stateFile,
    'growth run state',
  );
  return validateGrowthRun(
    parseStrictJson(raw, 'growth run state'),
    expectedIdentity,
  );
}

async function readTimelineFile(projectRoot, timelineFile) {
  const snapshot = await readTimelineSnapshot(
    projectRoot,
    timelineFile,
    null,
  );
  if (!snapshot.exists || snapshot.events.length === 0) {
    throw new Error('growth run timeline must contain at least one event');
  }
  return snapshot.events;
}

function validateTimelineEvent(value, index, previousEvent) {
  const fields = exactDataProperties(
    value,
    EVENT_FIELDS,
    `growth run timeline event ${index + 1}`,
  );
  const expectedSequence = index + 1;
  if (
    !Number.isSafeInteger(fields.sequence)
    || fields.sequence < 1
    || fields.sequence !== expectedSequence
  ) {
    throw new Error(
      `growth run timeline event sequence must be continuous from 1: expected ${expectedSequence}`,
    );
  }
  if (fields.from !== null && !ALL_RUN_STATES.has(fields.from)) {
    throw new Error('growth run timeline event from state is invalid');
  }
  if (!ALL_RUN_STATES.has(fields.to)) {
    throw new Error('growth run timeline event to state is invalid');
  }
  const at = requireCanonicalIsoTimestamp(
    fields.at,
    'growth run timeline event at',
  );

  if (index === 0) {
    if (fields.from !== null || fields.to !== 'intake') {
      throw new Error('growth run timeline first event must be null -> intake');
    }
  } else {
    if (fields.from === null || fields.from !== previousEvent.to) {
      throw new Error('growth run timeline event from state breaks the chain');
    }
    if (!canTransition(fields.from, fields.to)) {
      throw new Error(
        `growth run timeline transition is invalid: ${fields.from} -> ${fields.to}`,
      );
    }
    if (parseTimestamp(at) < parseTimestamp(previousEvent.at)) {
      throw new Error('growth run timeline event time must be non-decreasing');
    }
  }

  return Object.freeze({
    sequence: fields.sequence,
    from: fields.from,
    to: fields.to,
    at,
  });
}

function requireCanonicalIsoTimestamp(value, label) {
  if (
    typeof value !== 'string'
    || Number.isNaN(parseTimestamp(value))
    || REFLECT_APPLY(
      INTRINSIC_DATE_TO_ISO_STRING,
      new INTRINSIC_DATE(parseTimestamp(value)),
      [],
    ) !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

async function readSafeTextFile(projectRoot, filePath, label) {
  const status = await assertSafePath(projectRoot, filePath, {
    targetKind: 'file',
    allowMissing: true,
  });
  if (!status.exists) {
    throw new Error(`${label} not found`);
  }
  return readFile(filePath, 'utf8');
}

async function writeState(projectRoot, stateFile, value) {
  await assertSafePath(projectRoot, stateFile, {
    targetKind: 'file',
    allowMissing: true,
  });
  await writeJsonAtomic(stateFile, value);
}

async function appendTimelineEvent(projectRoot, timelineFile, event) {
  const normalized = validateTimelineEvent(
    event,
    event.sequence - 1,
    event.sequence === 1
      ? undefined
      : Object.freeze({
        sequence: event.sequence - 1,
        from: null,
        to: event.from,
        at: event.at,
      }),
  );
  const serialized = JSON.stringify(normalized);
  await assertSafePath(projectRoot, timelineFile, {
    targetKind: 'file',
    allowMissing: true,
  });

  let handle;
  try {
    handle = await open(timelineFile, 'a');
    await handle.writeFile(`${serialized}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function ensureSafeDirectoryTree(projectRoot, targetDirectory) {
  assertInside(projectRoot, targetDirectory, 'growth run directory');
  const relative = path.relative(projectRoot, path.resolve(targetDirectory));
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const status = await assertSafePath(projectRoot, current, {
      targetKind: 'directory',
      allowMissing: true,
    });
    if (!status.exists) {
      try {
        await mkdir(current);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
      await assertSafePath(projectRoot, current, {
        targetKind: 'directory',
      });
    }
  }
}

async function assertSafePath(projectRoot, targetPath, {
  targetKind,
  allowMissing = false,
} = {}) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);
  assertInside(root, target, 'growth run path');

  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error('projectRoot physical boundary is not a regular directory');
  }
  const physicalRoot = await realpath(root);
  if (!samePath(physicalRoot, root)) {
    throw new Error('projectRoot physical identity changed');
  }

  const relative = path.relative(root, target);
  if (!relative) {
    if (targetKind === 'file') {
      throw new Error('growth run target must be a regular file');
    }
    return { exists: true, details: rootDetails };
  }

  let current = root;
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissing) {
        return { exists: false };
      }
      throw error;
    }
    if (details.isSymbolicLink()) {
      throw new Error(
        `growth run physical boundary contains a symbolic link or reparse point: ${current}`,
      );
    }

    const isTarget = index === segments.length - 1;
    if (!isTarget && !details.isDirectory()) {
      throw new Error(`growth run physical ancestor is not a directory: ${current}`);
    }
    if (isTarget && targetKind === 'directory' && !details.isDirectory()) {
      throw new Error(`growth run target must be a regular directory: ${current}`);
    }
    if (isTarget && targetKind === 'file' && !details.isFile()) {
      throw new Error(`growth run target must be a regular file: ${current}`);
    }

    const physical = await realpath(current);
    if (isWindowsDeletedObjectPath(physical)) {
      const error = new Error(
        'growth run physical path resolved to the Windows deleted-object namespace',
      );
      Object.defineProperties(error, {
        code: {
          value: 'GROWTH_WINDOWS_DELETED_OBJECT',
          enumerable: true,
        },
        path: { value: current, enumerable: true },
        physicalPath: { value: physical, enumerable: false },
        projectRoot: { value: root, enumerable: false },
      });
      throw error;
    }
    assertInside(root, physical, 'growth run physical path');
  }
  return { exists: true };
}

function isWindowsDeletedObjectPath(candidate) {
  if (process.platform !== 'win32') return false;
  const parsed = path.parse(path.resolve(candidate));
  const relative = path.relative(parsed.root, path.resolve(candidate));
  const [first, second] = relative.split(path.sep);
  return (
    first?.toLowerCase() === '$extend'
    && second?.toLowerCase() === '$deleted'
  );
}

function assertInside(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    const error = new Error(
      `${label} escapes the canonical projectRoot boundary`,
    );
    Object.defineProperties(error, {
      growthPathLabel: { value: label, enumerable: false },
      growthPathRoot: { value: resolvedRoot, enumerable: false },
      growthPathCandidate: { value: resolvedCandidate, enumerable: false },
      growthPathRelative: { value: relative, enumerable: false },
    });
    throw error;
  }
}

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(value);
    return process.platform === 'win32'
      ? normalized.toLowerCase()
      : normalized;
  };
  return normalize(left) === normalize(right);
}

function lockKey(projectRoot, identity) {
  const root = process.platform === 'win32'
    ? path.normalize(projectRoot).toLowerCase()
    : path.normalize(projectRoot);
  return [
    root,
    identity.enterpriseId,
    identity.businessProjectId,
    identity.runId,
  ].join('|');
}

async function withExclusiveRun(
  projectRoot,
  paths,
  identity,
  callback,
) {
  return withRunLock(lockKey(projectRoot, identity), async () => {
    await ensureSafeDirectoryTree(projectRoot, paths.root);
    const owner = await acquireProcessLock(projectRoot, paths);
    try {
      return await callback();
    } finally {
      await releaseProcessLock(projectRoot, paths, owner.token);
    }
  });
}

async function acquireProcessLock(projectRoot, paths) {
  const deadline = intrinsicNowMilliseconds() + LOCK_WAIT_TIMEOUT_MS;
  await reclaimStaleCandidateLocks(projectRoot, paths);
  for (;;) {
    const token = `lock-${randomUUID()}`;
    const candidate = candidateLockPaths(paths, token);
    const owner = validateLockOwner({
      schemaVersion: 1,
      token,
      pid: process.pid,
      acquiredAt: intrinsicIsoNow(),
    });
    let candidateCreated = false;
    try {
      await assertSafePath(projectRoot, candidate.directory, {
        targetKind: 'directory',
        allowMissing: true,
      });
      await mkdir(candidate.directory);
      candidateCreated = true;
      await assertSafePath(projectRoot, candidate.directory, {
        targetKind: 'directory',
      });
      await assertSafePath(projectRoot, candidate.ownerFile, {
        targetKind: 'file',
        allowMissing: true,
      });
      await writeJsonAtomic(candidate.ownerFile, owner);
      const persistedOwner = await readOptionalStrictJson(
        projectRoot,
        candidate.ownerFile,
        'growth run candidate lock owner',
      );
      if (
        persistedOwner === null
        || !lockOwnersEqual(validateLockOwner(persistedOwner), owner)
      ) {
        throw new Error('growth run candidate lock owner changed');
      }
    } catch (error) {
      if (candidateCreated) {
        await throwAfterCandidateCleanup(
          projectRoot,
          candidate,
          owner,
          error,
          { allowOwnerless: true },
        );
      }
      throw error;
    }

    let publishResult;
    try {
      publishResult = await publishCandidateLock(
        projectRoot,
        paths,
        candidate,
      );
    } catch (error) {
      await throwAfterCandidateCleanup(
        projectRoot,
        candidate,
        owner,
        error,
      );
    }
    if (publishResult.published) return owner;
    await deleteOwnedCandidateLock(projectRoot, candidate, owner);
    if (!publishResult.contended) {
      throw new Error('growth run lock candidate publication failed');
    }

    try {
      if (await reclaimStaleProcessLock(projectRoot, paths)) continue;
    } catch (error) {
      if (!isLockCompetitionError(error)) throw error;
      continue;
    }
    if (intrinsicNowMilliseconds() >= deadline) {
      throw new Error('growth run lock timeout while owner remains busy');
    }
    await delay(LOCK_POLL_MS);
  }
}

async function publishCandidateLock(projectRoot, paths, candidate) {
  let firstAmbiguousError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fixedStatus = await inspectFixedLockForPublish(projectRoot, paths);
    if (fixedStatus.exists) {
      return { published: false, contended: true };
    }
    try {
      await rename(candidate.directory, paths.lockDirectory);
      return { published: true, contended: false };
    } catch (error) {
      if (['EBUSY', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
        return { published: false, contended: true };
      }
      if (!['EACCES', 'ENOENT', 'EPERM'].includes(error?.code)) throw error;
      const afterFailure = await inspectFixedLockForPublish(
        projectRoot,
        paths,
      );
      if (afterFailure.exists) {
        return { published: false, contended: true };
      }
      if (attempt === 0) {
        firstAmbiguousError = error;
        continue;
      }
      throw firstAmbiguousError;
    }
  }
  throw new Error('growth run lock candidate publication retry exhausted');
}

async function inspectFixedLockForPublish(projectRoot, paths) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await assertSafePath(projectRoot, paths.lockDirectory, {
        targetKind: 'directory',
        allowMissing: true,
      });
    } catch (error) {
      if (
        ['EBADF', 'ENOENT'].includes(error?.code)
        && typeof error.path === 'string'
        && samePath(error.path, paths.lockDirectory)
      ) {
        return { exists: false };
      }
      if (
        error?.code === 'GROWTH_WINDOWS_DELETED_OBJECT'
        && typeof error.path === 'string'
        && samePath(error.path, paths.lockDirectory)
        && attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('growth run fixed lock inspection retry exhausted');
}

function candidateLockPaths(paths, token) {
  const directory = path.join(
    paths.root,
    `${LOCK_CANDIDATE_PREFIX}${token}`,
  );
  return Object.freeze({
    directory,
    ownerFile: path.join(directory, 'owner.json'),
  });
}

function validateLockOwner(value) {
  const fields = exactDataProperties(
    value,
    LOCK_OWNER_FIELDS,
    'growth run lock owner',
  );
  if (fields.schemaVersion !== 1) {
    throw new Error('growth run lock owner schemaVersion must be 1');
  }
  const token = requireSafeId(fields.token, 'growth run lock token');
  if (!Number.isSafeInteger(fields.pid) || fields.pid < 1) {
    throw new Error('growth run lock owner pid must be a positive safe integer');
  }
  return Object.freeze({
    schemaVersion: 1,
    token,
    pid: fields.pid,
    acquiredAt: requireCanonicalIsoTimestamp(
      fields.acquiredAt,
      'growth run lock owner acquiredAt',
    ),
  });
}

async function reclaimStaleProcessLock(projectRoot, paths) {
  const lockStatus = await assertSafePath(projectRoot, paths.lockDirectory, {
    targetKind: 'directory',
    allowMissing: true,
  });
  if (!lockStatus.exists) return true;

  const ownerValue = await readOptionalStrictJson(
    projectRoot,
    paths.lockOwnerFile,
    'growth run lock owner',
  );
  if (ownerValue === null) {
    await assertSafePath(projectRoot, paths.lockDirectory, {
      targetKind: 'directory',
    });
    const details = await stat(paths.lockDirectory);
    if (
      intrinsicNowMilliseconds() - details.mtimeMs <= LOCK_LEASE_MS
    ) return false;
    return quarantineAndDeleteLock(projectRoot, paths, {
      purpose: 'stale',
      expectedOwner: null,
      requireOwnerless: true,
    });
  }

  const owner = validateLockOwner(ownerValue);
  if (
    intrinsicNowMilliseconds() - parseTimestamp(owner.acquiredAt)
    <= LOCK_LEASE_MS
  ) {
    return false;
  }
  if (isProcessAlive(owner.pid)) return false;
  return quarantineAndDeleteLock(projectRoot, paths, {
    purpose: 'stale',
    expectedOwner: owner,
    requireOwnerless: false,
  });
}

async function releaseProcessLock(projectRoot, paths, token) {
  let ownerValue;
  try {
    ownerValue = await readOptionalStrictJson(
      projectRoot,
      paths.lockOwnerFile,
      'growth run lock owner',
    );
  } catch (error) {
    if (isLockCompetitionError(error)) return;
    throw error;
  }
  if (ownerValue === null) return;
  const owner = validateLockOwner(ownerValue);
  if (owner.token !== token) return;
  await quarantineAndDeleteLock(projectRoot, paths, {
    purpose: 'release',
    expectedOwner: owner,
    requireOwnerless: false,
  });
}

async function quarantineAndDeleteLock(projectRoot, paths, {
  purpose,
  expectedOwner,
  requireOwnerless,
}) {
  const quarantineDirectory = path.join(
    paths.root,
    `.growth-run.lock.${purpose}-${randomUUID()}`,
  );
  const quarantineOwnerFile = path.join(quarantineDirectory, 'owner.json');
  await assertSafePath(projectRoot, quarantineDirectory, {
    targetKind: 'directory',
    allowMissing: true,
  });
  let fixedOwnerValue;
  try {
    fixedOwnerValue = await readOptionalStrictJson(
      projectRoot,
      paths.lockOwnerFile,
      'growth run lock owner',
    );
  } catch (error) {
    if (isLockCompetitionError(error)) return false;
    throw error;
  }
  if (requireOwnerless) {
    if (fixedOwnerValue !== null) return false;
    if (purpose === 'stale') {
      await assertSafePath(projectRoot, paths.lockDirectory, {
        targetKind: 'directory',
      });
      const details = await stat(paths.lockDirectory);
      if (
        intrinsicNowMilliseconds() - details.mtimeMs <= LOCK_LEASE_MS
      ) return false;
    }
  } else {
    if (fixedOwnerValue === null) return false;
    const fixedOwner = validateLockOwner(fixedOwnerValue);
    if (!lockOwnersEqual(fixedOwner, expectedOwner)) return false;
  }
  await assertSafePath(projectRoot, paths.lockDirectory, {
    targetKind: 'directory',
  });
  try {
    await rename(paths.lockDirectory, quarantineDirectory);
  } catch (error) {
    if (isLockCompetitionError(error)) return false;
    throw error;
  }

  await assertSafePath(projectRoot, quarantineDirectory, {
    targetKind: 'directory',
  });
  const quarantinedOwnerValue = await readOptionalStrictJson(
    projectRoot,
    quarantineOwnerFile,
    'growth run quarantined lock owner',
  );
  if (requireOwnerless) {
    if (quarantinedOwnerValue !== null) {
      await restoreMismatchedQuarantine(
        projectRoot,
        paths,
        quarantineDirectory,
      );
      return false;
    }
  } else {
    if (quarantinedOwnerValue === null) {
      await restoreMismatchedQuarantine(
        projectRoot,
        paths,
        quarantineDirectory,
      );
      return false;
    }
    const quarantinedOwner = validateLockOwner(quarantinedOwnerValue);
    if (!lockOwnersEqual(quarantinedOwner, expectedOwner)) {
      await restoreMismatchedQuarantine(
        projectRoot,
        paths,
        quarantineDirectory,
      );
      return false;
    }
  }

  await assertSafePath(projectRoot, quarantineDirectory, {
    targetKind: 'directory',
  });
  if (quarantinedOwnerValue !== null) {
    await assertSafePath(projectRoot, quarantineOwnerFile, {
      targetKind: 'file',
    });
  }
  await rm(quarantineDirectory, {
    recursive: true,
    maxRetries: 3,
    retryDelay: 10,
  });
  return true;
}

async function restoreMismatchedQuarantine(
  projectRoot,
  paths,
  quarantineDirectory,
) {
  await assertSafePath(projectRoot, quarantineDirectory, {
    targetKind: 'directory',
  });
  const fixedStatus = await assertSafePath(
    projectRoot,
    paths.lockDirectory,
    {
      targetKind: 'directory',
      allowMissing: true,
    },
  );
  if (fixedStatus.exists) return false;
  try {
    await rename(quarantineDirectory, paths.lockDirectory);
    return true;
  } catch (error) {
    if (isLockCompetitionError(error)) return false;
    throw error;
  }
}

async function deleteOwnedCandidateLock(
  projectRoot,
  candidate,
  expectedOwner,
  options = {},
) {
  try {
    return await deleteOwnedCandidateLockUnchecked(
      projectRoot,
      candidate,
      expectedOwner,
      options,
    );
  } catch (error) {
    if (
      isCandidateVanishedError(error, candidate)
      || await candidatePathVanishedAfterDeletedObject(
        projectRoot,
        candidate,
        error,
      )
    ) return true;
    throw error;
  }
}

async function deleteOwnedCandidateLockUnchecked(
  projectRoot,
  candidate,
  expectedOwner,
  { allowOwnerless = false } = {},
) {
  const candidateStatus = await assertSafePath(
    projectRoot,
    candidate.directory,
    {
      targetKind: 'directory',
      allowMissing: true,
    },
  );
  if (!candidateStatus.exists) return false;

  const ownerValue = await readOptionalStrictJson(
    projectRoot,
    candidate.ownerFile,
    'growth run candidate lock owner',
  );
  if (ownerValue === null) {
    if (!allowOwnerless) return false;
  } else {
    const owner = validateLockOwner(ownerValue);
    if (!lockOwnersEqual(owner, expectedOwner)) return false;
    await assertSafePath(projectRoot, candidate.ownerFile, {
      targetKind: 'file',
    });
  }
  await assertSafePath(projectRoot, candidate.directory, {
    targetKind: 'directory',
  });
  await rm(candidate.directory, {
    recursive: true,
    maxRetries: 3,
    retryDelay: 10,
  });
  return true;
}

async function throwAfterCandidateCleanup(
  projectRoot,
  candidate,
  owner,
  originalError,
  options = {},
) {
  try {
    await deleteOwnedCandidateLock(
      projectRoot,
      candidate,
      owner,
      options,
    );
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      `${originalError.message}; candidate cleanup also failed: ${
        cleanupError.message
      }`,
      { cause: originalError },
    );
  }
  throw originalError;
}

async function reclaimStaleCandidateLocks(projectRoot, paths) {
  await assertSafePath(projectRoot, paths.root, {
    targetKind: 'directory',
  });
  const entries = await readdir(paths.root, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.name.startsWith(LOCK_CANDIDATE_PREFIX)) {
      names.push(entry.name);
    }
  }
  if (names.length > MAX_LOCK_CANDIDATES) {
    throw new Error('growth run lock candidate limit exceeded');
  }

  for (const name of names) {
    const token = requireSafeId(
      name.slice(LOCK_CANDIDATE_PREFIX.length),
      'growth run candidate lock token',
    );
    const candidate = candidateLockPaths(paths, token);
    try {
      await reclaimOneStaleCandidateLock(projectRoot, candidate, token);
    } catch (error) {
      if (
        isCandidateVanishedError(error, candidate)
        || await candidatePathVanishedAfterDeletedObject(
          projectRoot,
          candidate,
          error,
        )
      ) continue;
      throw error;
    }
  }
}

async function reclaimOneStaleCandidateLock(projectRoot, candidate, token) {
    const status = await assertSafePath(
      projectRoot,
      candidate.directory,
      {
        targetKind: 'directory',
        allowMissing: true,
      },
    );
    if (!status.exists) return;

    const ownerValue = await readOptionalStrictJson(
      projectRoot,
      candidate.ownerFile,
      'growth run candidate lock owner',
    );
    if (ownerValue === null) {
      await assertSafePath(projectRoot, candidate.directory, {
        targetKind: 'directory',
      });
      const details = await stat(candidate.directory);
      if (
        intrinsicNowMilliseconds() - details.mtimeMs <= LOCK_LEASE_MS
      ) {
        return;
      }
      await deleteOwnedCandidateLock(
        projectRoot,
        candidate,
        null,
        { allowOwnerless: true },
      );
      return;
    }

    const owner = validateLockOwner(ownerValue);
    if (owner.token !== token) {
      throw new Error(
        'growth run candidate lock token does not match its directory',
      );
    }
    if (
      intrinsicNowMilliseconds() - parseTimestamp(owner.acquiredAt)
      <= LOCK_LEASE_MS
      || isProcessAlive(owner.pid)
    ) {
      return;
    }
    await deleteOwnedCandidateLock(projectRoot, candidate, owner);
}

function isCandidateVanishedError(error, candidate) {
  if (
    error?.code !== 'ENOENT'
    || typeof error.path !== 'string'
  ) return false;
  const relative = path.relative(
    path.resolve(candidate.directory),
    path.resolve(error.path),
  );
  return (
    relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    )
  );
}

async function candidatePathVanishedAfterDeletedObject(
  projectRoot,
  candidate,
  error,
) {
  if (
    error?.code !== 'GROWTH_WINDOWS_DELETED_OBJECT'
    || typeof error.path !== 'string'
  ) return false;
  const relative = path.relative(
    path.resolve(candidate.directory),
    path.resolve(error.path),
  );
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) return false;

  const isDirectory = relative === '';
  try {
    const status = await assertSafePath(projectRoot, error.path, {
      targetKind: isDirectory ? 'directory' : 'file',
      allowMissing: true,
    });
    return !status.exists;
  } catch (retryError) {
    if (isCandidateVanishedError(retryError, candidate)) return true;
    throw retryError;
  }
}

function lockOwnersEqual(left, right) {
  return Boolean(
    left
    && right
    && left.schemaVersion === right.schemaVersion
    && left.token === right.token
    && left.pid === right.pid
    && left.acquiredAt === right.acquiredAt,
  );
}

function isLockCompetitionError(error) {
  return [
    'EACCES',
    'EBADF',
    'EBUSY',
    'EEXIST',
    'ENOENT',
    'ENOTEMPTY',
    'EPERM',
  ].includes(error?.code);
}

function isProcessAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withRunLock(key, callback) {
  const previous = RUN_LOCKS.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  RUN_LOCKS.set(key, current);
  await previous.catch(() => {});
  try {
    return await callback();
  } finally {
    release();
    if (RUN_LOCKS.get(key) === current) RUN_LOCKS.delete(key);
  }
}

function parseStrictJson(source, label) {
  if (source.charCodeAt(0) === 0xFEFF) {
    throw new Error(`${label} must not contain a BOM`);
  }
  assertNoDuplicateJsonKeys(source, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} JSON is invalid: ${error.message}`, {
      cause: error,
    });
  }
}

function assertNoDuplicateJsonKeys(source, label) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/u.test(source[index] ?? '')) index += 1;
  };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      if (source[index] === '\\') {
        index += source[index + 1] === 'u' ? 6 : 2;
      } else {
        index += 1;
      }
    }
    throw new Error(`${label} JSON contains an unterminated string`);
  };
  const parseValue = () => {
    skipWhitespace();
    if (source[index] === '{') return parseObject();
    if (source[index] === '[') return parseArray();
    if (source[index] === '"') return parseString();
    const start = index;
    while (
      index < source.length
      && !/[\s,\]}]/u.test(source[index])
    ) {
      index += 1;
    }
    if (start === index) {
      throw new Error(`${label} JSON expected a value`);
    }
    return undefined;
  };
  const parseObject = () => {
    const keys = new Set();
    index += 1;
    skipWhitespace();
    if (source[index] === '}') {
      index += 1;
      return;
    }
    for (;;) {
      skipWhitespace();
      if (source[index] !== '"') {
        throw new Error(`${label} JSON expected an object key`);
      }
      const key = parseString();
      if (keys.has(key)) {
        throw new Error(`${label} JSON contains duplicate key: ${key}`);
      }
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ':') {
        throw new Error(`${label} JSON expected a colon`);
      }
      index += 1;
      parseValue();
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      if (source[index] !== ',') {
        throw new Error(`${label} JSON expected a comma`);
      }
      index += 1;
    }
  };
  const parseArray = () => {
    index += 1;
    skipWhitespace();
    if (source[index] === ']') {
      index += 1;
      return;
    }
    for (;;) {
      parseValue();
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      if (source[index] !== ',') {
        throw new Error(`${label} JSON expected an array comma`);
      }
      index += 1;
    }
  };

  skipWhitespace();
  parseValue();
  skipWhitespace();
  if (index !== source.length) {
    throw new Error(`${label} JSON contains trailing content`);
  }
}
