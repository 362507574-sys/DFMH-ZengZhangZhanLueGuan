import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  requireBusinessProjectId,
  requireEnterpriseId,
  requireSafeId,
} from '../../../scripts/control-center/project_contract.mjs';
import {
  jsonSafeClone,
  sha256File,
  writeJsonAtomic,
} from '../../../scripts/feishu-commander/atomic_store.mjs';
import { createBasicGrowthPipeline } from './growth_basic_pipeline.mjs';
import { createCollaborationRequest } from './collaboration_contract.mjs';
import { createGrowthRunStore } from './growth_run_store.mjs';
import { createGrowthWorkspacePaths } from './growth_workspace_paths.mjs';
import {
  assertPlainData,
  deepFreeze,
  readStrictJson,
} from './strict_json.mjs';

const MANIFEST_FILE = 'basic-run.json';
const TRANSACTION_FILE = 'basic-transaction.json';
const ACCEPT_TRANSACTION_FILE = 'basic-accept-transaction.json';
const ACCEPTED_SEAL_FILE = 'basic-accepted-seal.json';
const RUN_LOCKS = new Map();
const TEST_FACTORY_ENABLED_AT_LOAD = (
  typeof process.env.NODE_TEST_CONTEXT === 'string'
  && process.env.NODE_TEST_CONTEXT.length > 0
);

export async function createBasicGrowthRunManager({ projectRoot } = {}) {
  return createBasicGrowthRunManagerInternal({
    projectRoot,
    testHooks: Object.freeze({}),
  });
}

export async function createBasicGrowthRunManagerForTest({
  projectRoot,
  testHooks = {},
} = {}) {
  if (!TEST_FACTORY_ENABLED_AT_LOAD) {
    throw new Error(
      'createBasicGrowthRunManagerForTest is unavailable outside Node test context',
    );
  }
  if (!testHooks || typeof testHooks !== 'object' || Array.isArray(testHooks)) {
    throw new TypeError('basic growth testHooks must be a plain object');
  }
  return createBasicGrowthRunManagerInternal({ projectRoot, testHooks });
}

async function createBasicGrowthRunManagerInternal({
  projectRoot,
  testHooks,
}) {
  const canonicalProjectRoot = await realpath(projectRoot).catch((error) => {
    throw new Error(`projectRoot does not exist: ${error.message}`, {
      cause: error,
    });
  });
  const store = await createGrowthRunStore({
    projectRoot: canonicalProjectRoot,
  });
  const workspacePaths = await createGrowthWorkspacePaths({
    projectRoot: canonicalProjectRoot,
  });

  const start = async (input) => {
    const pipeline = createBasicGrowthPipeline(input);
    const identity = normalizeIdentity({
      enterpriseId: pipeline.identity.enterpriseId,
      businessProjectId: pipeline.identity.businessProjectId,
      runId: input?.runId,
    });
    return withRunLock(identity, async () => {
      const paths = basicPaths(workspacePaths, identity);
      const existing = await readOptionalManifest(
        canonicalProjectRoot,
        paths.manifestFile,
      );
      if (existing) {
        if (
          existing.request !== pipeline.request
          || existing.taskId !== pipeline.identity.taskId
        ) {
          throw new Error('basic growth run already exists with different input');
        }
        const recovered = await recoverBasicTransaction({
          projectRoot: canonicalProjectRoot,
          paths,
          identity,
        });
        let manifest = recovered ?? validateManifest(existing, identity);
        let run = await store.read(identity);
        ({ run, manifest } = await recoverAcceptTransaction({
          projectRoot: canonicalProjectRoot,
          paths,
          identity,
          store,
          run,
          manifest,
        }));
        if (
          run.state === 'running_internal'
          && manifest.stages.every((stage) => stage.status === 'completed')
        ) {
          run = await store.transition(identity, {
            expectedState: 'running_internal',
            nextState: 'reviewing',
          });
        }
        if (run.state === 'completed') {
          await verifyAcceptedSeal({
            projectRoot: canonicalProjectRoot,
            sealFile: paths.acceptedSealFile,
            identity,
            manifest,
          });
        }
        return publicStatus(run, manifest);
      }

      const now = new Date().toISOString();
      await store.initialize({
        schemaVersion: 1,
        enterpriseId: identity.enterpriseId,
        businessProjectId: identity.businessProjectId,
        taskId: pipeline.identity.taskId,
        runId: identity.runId,
        capabilityId: 'growth-basic-pipeline',
        state: 'intake',
        sequence: 1,
        createdAt: now,
        updatedAt: now,
      });

      const manifest = validateManifest({
        schemaVersion: 1,
        revision: 1,
        enterpriseId: identity.enterpriseId,
        businessProjectId: identity.businessProjectId,
        taskId: pipeline.identity.taskId,
        runId: identity.runId,
        request: pipeline.request,
        mode: pipeline.mode,
        createdAt: now,
        updatedAt: now,
        acceptedAt: null,
        stages: pipeline.stages.map((stage) => ({
          skillId: stage.skillId,
          artifactId: stage.outputArtifact,
          status: 'pending',
          latestVersion: 0,
          invalidatedBy: null,
          artifacts: [],
        })),
        safety: pipeline.safety,
      }, identity);
      await writeMutableJson(
        canonicalProjectRoot,
        paths.manifestFile,
        manifest,
      );

      let run = await store.transition(identity, {
        expectedState: 'intake',
        nextState: 'planning',
      });
      run = await store.transition(identity, {
        expectedState: run.state,
        nextState: 'ready',
      });
      run = await store.transition(identity, {
        expectedState: run.state,
        nextState: 'running_internal',
      });
      return publicStatus(run, manifest);
    });
  };

  const status = async (input) => {
    const identity = normalizeIdentity(input);
    return withRunLock(identity, async () => {
      const paths = basicPaths(workspacePaths, identity);
      let manifest = await recoverBasicTransaction({
        projectRoot: canonicalProjectRoot,
        paths,
        identity,
      }) ?? await readRequiredManifest(
        canonicalProjectRoot,
        paths.manifestFile,
        identity,
      );
      let run = await store.read(identity);
      ({ run, manifest } = await recoverAcceptTransaction({
        projectRoot: canonicalProjectRoot,
        paths,
        identity,
        store,
        run,
        manifest,
      }));
      if (
        run.state === 'running_internal'
        && manifest.stages.every((stage) => stage.status === 'completed')
      ) {
        run = await store.transition(identity, {
          expectedState: 'running_internal',
          nextState: 'reviewing',
        });
      }
      if (run.state === 'completed') {
        await verifyAcceptedSeal({
          projectRoot: canonicalProjectRoot,
          sealFile: paths.acceptedSealFile,
          identity,
          manifest,
        });
      }
      return publicStatus(run, manifest);
    });
  };

  const submitStage = async (input) => {
    const identity = normalizeIdentity(input);
    const skillId = requireSafeId(input?.skillId, 'skillId');
    const payload = normalizePayload(input?.payload);
    return withRunLock(identity, async () => {
      const paths = basicPaths(workspacePaths, identity);
      await recoverBasicTransaction({
        projectRoot: canonicalProjectRoot,
        paths,
        identity,
      });
      const run = await store.read(identity);
      if (run.state !== 'running_internal') {
        throw new Error('basic growth stage submission requires running_internal state');
      }
      const manifest = await readRequiredManifest(
        canonicalProjectRoot,
        paths.manifestFile,
        identity,
      );
      const nextIndex = manifest.stages.findIndex(
        (stage) => stage.status === 'pending',
      );
      if (nextIndex < 0 || manifest.stages[nextIndex].skillId !== skillId) {
        throw new Error('basic growth stage must follow the next pipeline order');
      }

      const written = await writeArtifact({
        canonicalProjectRoot,
        paths,
        manifest,
        identity,
        stageIndex: nextIndex,
        payload,
        testHooks,
      });
      const nextManifest = written.manifest;
      let nextRun = run;
      if (nextManifest.stages.every((stage) => stage.status === 'completed')) {
        nextRun = await store.transition(identity, {
          expectedState: 'running_internal',
          nextState: 'reviewing',
        });
      }
      return deepFreeze({
        ...publicStatus(nextRun, nextManifest),
        artifact: written.artifact,
      });
    });
  };

  const reviseStage = async (input) => {
    const identity = normalizeIdentity(input);
    const skillId = requireSafeId(input?.skillId, 'skillId');
    const reason = requiredText(input?.reason, 'revision reason', 2_000);
    const payload = normalizePayload(input?.payload);
    return withRunLock(identity, async () => {
      const paths = basicPaths(workspacePaths, identity);
      await recoverBasicTransaction({
        projectRoot: canonicalProjectRoot,
        paths,
        identity,
      });
      let run = await store.read(identity);
      if (run.state === 'completed') {
        throw new Error('completed basic growth run is already accepted and immutable');
      }
      if (!['running_internal', 'reviewing'].includes(run.state)) {
        throw new Error('basic growth revision requires running_internal or reviewing state');
      }
      const manifest = await readRequiredManifest(
        canonicalProjectRoot,
        paths.manifestFile,
        identity,
      );
      const stageIndex = manifest.stages.findIndex(
        (stage) => stage.skillId === skillId,
      );
      if (stageIndex < 0) {
        throw new Error('basic growth revision skill is not in this pipeline');
      }
      if (manifest.stages[stageIndex].status !== 'completed') {
        throw new Error('basic growth revision requires a completed stage');
      }

      if (run.state === 'reviewing') {
        run = await store.transition(identity, {
          expectedState: 'reviewing',
          nextState: 'planning',
        });
        run = await store.transition(identity, {
          expectedState: run.state,
          nextState: 'ready',
        });
        run = await store.transition(identity, {
          expectedState: run.state,
          nextState: 'running_internal',
        });
      }

      const invalidationLabel = `${skillId}@v${manifest.stages[stageIndex].latestVersion + 1}`;
      const preparedStages = manifest.stages.map((stage, index) => {
        if (index <= stageIndex) return stage;
        return {
          ...stage,
          status: 'pending',
          invalidatedBy: invalidationLabel,
        };
      });
      const preparedManifest = {
        ...manifest,
        stages: preparedStages,
      };
      const written = await writeArtifact({
        canonicalProjectRoot,
        paths,
        manifest: preparedManifest,
        identity,
        stageIndex,
        payload,
        reason,
        testHooks,
      });
      return deepFreeze({
        ...publicStatus(run, written.manifest),
        artifact: written.artifact,
      });
    });
  };

  const createHandoff = async (input) => {
    const identity = normalizeIdentity(input);
    const artifactId = requireSafeId(input?.artifactId, 'artifactId');
    const targetOrganization = requireSafeId(
      input?.targetOrganization,
      'targetOrganization',
    );
    const requestedCapability = requireSafeId(
      input?.requestedCapability,
      'requestedCapability',
    );
    const scope = requiredText(input?.scope, 'handoff scope', 1_000);
    const expectedOutcome = requiredText(
      input?.expectedOutcome,
      'handoff expectedOutcome',
      1_000,
    );
    return withRunLock(identity, async () => {
      const paths = basicPaths(workspacePaths, identity);
      const [run, manifest] = await Promise.all([
        store.read(identity),
        readRequiredManifest(canonicalProjectRoot, paths.manifestFile, identity),
      ]);
      if (!['running_internal', 'reviewing', 'completed'].includes(run.state)) {
        throw new Error('basic growth handoff is unavailable in the current state');
      }
      const stage = manifest.stages.find(
        (item) => item.artifactId === artifactId,
      );
      if (!stage || stage.status !== 'completed' || stage.artifacts.length === 0) {
        throw new Error('handoff requires a completed exact artifact version');
      }
      const artifact = stage.artifacts.at(-1);
      const digest = createHash('sha256').update([
        identity.enterpriseId,
        identity.businessProjectId,
        identity.runId,
        targetOrganization,
        requestedCapability,
        artifactId,
        artifact.version,
        artifact.sha256,
      ].join('\n')).digest('hex');
      const requestId = `handoff-${digest.slice(0, 24)}`;
      const request = createCollaborationRequest({
        schemaVersion: 1,
        contractVersion: 1,
        parentTaskId: manifest.taskId,
        requestId,
        enterpriseId: identity.enterpriseId,
        primaryOrganization: 'ai-growth-strategist',
        requestingOrganization: 'ai-growth-strategist',
        targetOrganization,
        requestedCapability,
        scope,
        expectedOutcome,
        evidenceRequirements: [
          'verify the exact bound artifact sha256',
          'separate facts assumptions and unknowns',
          'return risks and unresolved items with evidence',
        ],
        accessEnvelope: {
          enterpriseId: identity.enterpriseId,
          businessProjectId: identity.businessProjectId,
          allowedScopes: [artifact.relativePath],
          deniedScopes: [
            'other-enterprises',
            'other-business-projects',
            'raw-customer-pii',
          ],
        },
        constraints: {
          maxDelegationDepth: 1,
          externalWriteAllowed: false,
          exactArtifactRequired: true,
        },
        recursionDepth: 1,
        status: 'requested',
      });
      const handoff = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        request,
        artifactBinding: artifact,
      };
      const handoffFile = path.join(paths.handoffDirectory, `${requestId}.json`);
      await writeImmutableJson(canonicalProjectRoot, handoffFile, handoff);
      return deepFreeze({
        ...handoff,
        relativePath: relativePath(canonicalProjectRoot, handoffFile),
      });
    });
  };

  const accept = async (input) => {
    const identity = normalizeIdentity(input);
    return withRunLock(identity, async () => {
      const paths = basicPaths(workspacePaths, identity);
      await recoverBasicTransaction({
        projectRoot: canonicalProjectRoot,
        paths,
        identity,
      });
      let manifest = await readRequiredManifest(
        canonicalProjectRoot,
        paths.manifestFile,
        identity,
      );
      let run = await store.read(identity);
      ({ run, manifest } = await recoverAcceptTransaction({
        projectRoot: canonicalProjectRoot,
        paths,
        identity,
        store,
        run,
        manifest,
      }));
      if (run.state === 'completed') {
        await verifyAcceptedSeal({
          projectRoot: canonicalProjectRoot,
          sealFile: paths.acceptedSealFile,
          identity,
          manifest,
        });
        return publicStatus(run, manifest);
      }
      if (!manifest.stages.every((stage) => stage.status === 'completed')) {
        throw new Error('basic growth run cannot be accepted before all stages complete');
      }
      const transaction = createAcceptTransaction({
        identity,
        previousManifest: manifest,
        createdAt: new Date().toISOString(),
      });
      await writeMutableJson(
        canonicalProjectRoot,
        paths.acceptTransactionFile,
        transaction,
      );
      run = await store.transition(identity, {
        expectedState: 'reviewing',
        nextState: 'completed',
      });
      await testHooks.afterAcceptStateTransition?.({
        acceptedAt: run.updatedAt,
      });
      const acceptedAt = run.updatedAt;
      const nextManifest = validateManifest({
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: acceptedAt,
        acceptedAt,
      }, identity);
      await writeMutableJson(
        canonicalProjectRoot,
        paths.manifestFile,
        nextManifest,
      );
      await ensureAcceptedSeal({
        projectRoot: canonicalProjectRoot,
        sealFile: paths.acceptedSealFile,
        identity,
        manifest: nextManifest,
      });
      await deleteAcceptTransaction({
        projectRoot: canonicalProjectRoot,
        transactionFile: paths.acceptTransactionFile,
        identity,
        token: transaction.token,
      });
      return publicStatus(run, nextManifest);
    });
  };

  return Object.freeze({
    start,
    status,
    submitStage,
    reviseStage,
    createHandoff,
    accept,
  });
}

async function writeArtifact({
  canonicalProjectRoot,
  paths,
  manifest,
  identity,
  stageIndex,
  payload,
  reason = null,
  testHooks = {},
}) {
  const stage = manifest.stages[stageIndex];
  const version = stage.latestVersion + 1;
  const createdAt = new Date().toISOString();
  const artifactFile = path.join(
    paths.artifactDirectory,
    stage.artifactId,
    `v${version}.json`,
  );
  const upstreamArtifacts = manifest.stages
    .slice(0, stageIndex)
    .map((item) => item.artifacts.at(-1));
  if (upstreamArtifacts.some((item) => !item)) {
    throw new Error('basic growth stage is missing an exact upstream artifact');
  }
  const storedArtifact = {
    schemaVersion: 1,
    enterpriseId: identity.enterpriseId,
    businessProjectId: identity.businessProjectId,
    runId: identity.runId,
    skillId: stage.skillId,
    artifactId: stage.artifactId,
    version,
    createdAt,
    revisionReason: reason,
    upstreamArtifacts,
    payload,
  };
  const serializedArtifact = serializeJson(storedArtifact);
  const artifact = {
    artifactId: stage.artifactId,
    version,
    relativePath: relativePath(canonicalProjectRoot, artifactFile),
    sha256: createHash('sha256').update(serializedArtifact).digest('hex'),
    createdAt,
  };
  const stages = manifest.stages.map((item, index) => (
    index === stageIndex
      ? {
        ...item,
        status: 'completed',
        latestVersion: version,
        invalidatedBy: null,
        artifacts: [...item.artifacts, artifact],
      }
      : item
  ));
  const nextManifest = validateManifest({
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: createdAt,
    stages,
  }, identity);
  const transaction = createBasicTransaction({
    identity,
    previousManifest: manifest,
    nextManifest,
    artifact,
    storedArtifact,
    createdAt,
  });
  await writeMutableJson(
    canonicalProjectRoot,
    paths.transactionFile,
    transaction,
  );
  await writeImmutableSerializedJson(
    canonicalProjectRoot,
    artifactFile,
    serializedArtifact,
  );
  await testHooks.afterArtifactWrite?.({
    skillId: stage.skillId,
    artifact,
  });
  await writeMutableJson(
    canonicalProjectRoot,
    paths.manifestFile,
    nextManifest,
  );
  await testHooks.afterManifestWrite?.({
    skillId: stage.skillId,
    artifact,
  });
  await deleteBasicTransaction({
    projectRoot: canonicalProjectRoot,
    transactionFile: paths.transactionFile,
    identity,
    token: transaction.token,
  });
  return deepFreeze({ artifact, manifest: nextManifest });
}

function createBasicTransaction({
  identity,
  previousManifest,
  nextManifest,
  artifact,
  storedArtifact,
  createdAt,
}) {
  return deepFreeze({
    schemaVersion: 1,
    kind: 'submit-stage',
    identity: jsonSafeClone(identity),
    previousManifest: jsonSafeClone(previousManifest),
    nextManifest: jsonSafeClone(nextManifest),
    artifact: jsonSafeClone(artifact),
    storedArtifact: jsonSafeClone(storedArtifact),
    createdAt,
    token: `basic-transaction-${randomUUID()}`,
  });
}

function validateBasicTransaction(value, identity, paths, projectRoot) {
  assertPlainData(value, 'basic growth transaction', {
    maxDepth: 28,
    maxNodes: 20_000,
    maxArrayLength: 1_000,
  });
  assertExactKeys(value, [
    'schemaVersion',
    'kind',
    'identity',
    'previousManifest',
    'nextManifest',
    'artifact',
    'storedArtifact',
    'createdAt',
    'token',
  ], 'basic growth transaction');
  if (value.schemaVersion !== 1 || value.kind !== 'submit-stage') {
    throw new Error('basic growth transaction version or kind is invalid');
  }
  assertExactKeys(value.identity, [
    'enterpriseId',
    'businessProjectId',
    'runId',
  ], 'basic growth transaction identity');
  for (const field of ['enterpriseId', 'businessProjectId', 'runId']) {
    if (value.identity[field] !== identity[field]) {
      throw new Error(`basic growth transaction identity mismatch: ${field}`);
    }
  }
  const previousManifest = validateManifest(value.previousManifest, identity);
  const nextManifest = validateManifest(value.nextManifest, identity);
  if (nextManifest.revision !== previousManifest.revision + 1) {
    throw new Error('basic growth transaction manifest revision is inconsistent');
  }
  assertExactKeys(value.artifact, [
    'artifactId',
    'version',
    'relativePath',
    'sha256',
    'createdAt',
  ], 'basic growth transaction artifact');
  const artifactId = requireSafeId(value.artifact.artifactId, 'artifactId');
  if (!Number.isSafeInteger(value.artifact.version) || value.artifact.version < 1) {
    throw new Error('basic growth transaction artifact version is invalid');
  }
  if (!/^[a-f0-9]{64}$/u.test(value.artifact.sha256 ?? '')) {
    throw new Error('basic growth transaction artifact sha256 is invalid');
  }
  requiredCanonicalIso(value.artifact.createdAt, 'artifact.createdAt');
  requiredCanonicalIso(value.createdAt, 'transaction.createdAt');
  if (value.createdAt !== value.artifact.createdAt) {
    throw new Error('basic growth transaction timestamps are inconsistent');
  }
  requireSafeId(value.token, 'transaction token');

  assertExactKeys(value.storedArtifact, [
    'schemaVersion',
    'enterpriseId',
    'businessProjectId',
    'runId',
    'skillId',
    'artifactId',
    'version',
    'createdAt',
    'revisionReason',
    'upstreamArtifacts',
    'payload',
  ], 'basic growth stored artifact');
  if (
    value.storedArtifact.schemaVersion !== 1
    || value.storedArtifact.enterpriseId !== identity.enterpriseId
    || value.storedArtifact.businessProjectId !== identity.businessProjectId
    || value.storedArtifact.runId !== identity.runId
    || value.storedArtifact.artifactId !== artifactId
    || value.storedArtifact.version !== value.artifact.version
    || value.storedArtifact.createdAt !== value.artifact.createdAt
  ) {
    throw new Error('basic growth stored artifact conflicts with transaction');
  }
  requireSafeId(value.storedArtifact.skillId, 'stored artifact skillId');
  if (!Array.isArray(value.storedArtifact.upstreamArtifacts)) {
    throw new Error('basic growth stored artifact upstreamArtifacts is invalid');
  }
  const storedStageIndex = nextManifest.stages.findIndex(
    (stage) => stage.skillId === value.storedArtifact.skillId,
  );
  const expectedUpstreamArtifacts = previousManifest.stages
    .slice(0, storedStageIndex)
    .map((stage) => stage.artifacts.at(-1));
  if (
    storedStageIndex < 0
    || expectedUpstreamArtifacts.some((item) => !item)
    || !plainDataEqual(
      value.storedArtifact.upstreamArtifacts,
      expectedUpstreamArtifacts,
    )
  ) {
    throw new Error('basic growth stored artifact upstream binding mismatch');
  }
  const serializedArtifact = serializeJson(value.storedArtifact);
  const actualDigest = createHash('sha256')
    .update(serializedArtifact)
    .digest('hex');
  if (actualDigest !== value.artifact.sha256) {
    throw new Error('basic growth transaction artifact content hash mismatch');
  }
  const artifactFile = path.join(
    paths.artifactDirectory,
    artifactId,
    `v${value.artifact.version}.json`,
  );
  const expectedRelative = relativePath(projectRoot, artifactFile);
  if (value.artifact.relativePath !== expectedRelative) {
    throw new Error('basic growth transaction artifact path mismatch');
  }
  const nextStage = nextManifest.stages.find(
    (stage) => stage.artifactId === artifactId,
  );
  const latest = nextStage?.artifacts.at(-1);
  if (
    !nextStage
    || nextStage.status !== 'completed'
    || nextStage.latestVersion !== value.artifact.version
    || JSON.stringify(latest) !== JSON.stringify(value.artifact)
  ) {
    throw new Error('basic growth transaction next manifest is inconsistent');
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: value.kind,
    identity: jsonSafeClone(value.identity),
    previousManifest,
    nextManifest,
    artifact: jsonSafeClone(value.artifact),
    storedArtifact: jsonSafeClone(value.storedArtifact),
    serializedArtifact,
    artifactFile,
    createdAt: value.createdAt,
    token: value.token,
  });
}

async function recoverBasicTransaction({ projectRoot, paths, identity }) {
  const raw = await readOptionalBasicTransaction(
    projectRoot,
    paths.transactionFile,
  );
  if (raw === null) return null;
  const transaction = validateBasicTransaction(
    raw,
    identity,
    paths,
    projectRoot,
  );
  const artifactDetails = await lstat(transaction.artifactFile).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (artifactDetails === null) {
    await writeImmutableSerializedJson(
      projectRoot,
      transaction.artifactFile,
      transaction.serializedArtifact,
    );
  } else {
    await assertBoundedPath(projectRoot, transaction.artifactFile);
    const actualDigest = await sha256File(transaction.artifactFile);
    if (actualDigest !== transaction.artifact.sha256) {
      throw new Error('basic growth recovery artifact hash conflict');
    }
  }

  const currentManifest = await readRequiredManifest(
    projectRoot,
    paths.manifestFile,
    identity,
  );
  if (plainDataEqual(currentManifest, transaction.previousManifest)) {
    await writeMutableJson(
      projectRoot,
      paths.manifestFile,
      transaction.nextManifest,
    );
  } else if (!plainDataEqual(currentManifest, transaction.nextManifest)) {
    throw new Error('basic growth recovery manifest conflicts with transaction');
  }
  await deleteBasicTransaction({
    projectRoot,
    transactionFile: paths.transactionFile,
    identity,
    token: transaction.token,
    paths,
  });
  return transaction.nextManifest;
}

async function readOptionalBasicTransaction(projectRoot, transactionFile) {
  await assertBoundedPath(projectRoot, transactionFile, { allowMissing: true });
  const details = await lstat(transactionFile).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (details === null) return null;
  return readStrictJson(transactionFile, {
    label: 'basic growth transaction',
    maxBytes: 4 * 1024 * 1024,
  });
}

async function deleteBasicTransaction({
  projectRoot,
  transactionFile,
  identity,
  token,
  paths,
}) {
  const current = await readOptionalBasicTransaction(projectRoot, transactionFile);
  if (current === null) return;
  const runtimePaths = paths ?? {
    artifactDirectory: path.join(path.dirname(transactionFile), 'artifacts'),
  };
  const validated = validateBasicTransaction(
    current,
    identity,
    runtimePaths,
    projectRoot,
  );
  if (validated.token !== token) {
    throw new Error('basic growth transaction token changed before delete');
  }
  await unlink(transactionFile);
}

function createAcceptTransaction({ identity, previousManifest, createdAt }) {
  return deepFreeze({
    schemaVersion: 1,
    kind: 'accept-run',
    identity: jsonSafeClone(identity),
    previousManifest: jsonSafeClone(previousManifest),
    createdAt,
    token: `basic-accept-transaction-${randomUUID()}`,
  });
}

function validateAcceptTransaction(value, identity) {
  assertPlainData(value, 'basic growth accept transaction', {
    maxDepth: 28,
    maxNodes: 20_000,
    maxArrayLength: 1_000,
  });
  assertExactKeys(value, [
    'schemaVersion',
    'kind',
    'identity',
    'previousManifest',
    'createdAt',
    'token',
  ], 'basic growth accept transaction');
  if (value.schemaVersion !== 1 || value.kind !== 'accept-run') {
    throw new Error('basic growth accept transaction version or kind is invalid');
  }
  assertExactKeys(value.identity, [
    'enterpriseId',
    'businessProjectId',
    'runId',
  ], 'basic growth accept transaction identity');
  for (const field of ['enterpriseId', 'businessProjectId', 'runId']) {
    if (value.identity[field] !== identity[field]) {
      throw new Error(`basic growth accept transaction identity mismatch: ${field}`);
    }
  }
  const previousManifest = validateManifest(value.previousManifest, identity);
  if (previousManifest.acceptedAt !== null) {
    throw new Error('basic growth accept transaction already contains acceptance');
  }
  requiredCanonicalIso(value.createdAt, 'accept transaction createdAt');
  requireSafeId(value.token, 'accept transaction token');
  return deepFreeze({
    schemaVersion: 1,
    kind: value.kind,
    identity: jsonSafeClone(value.identity),
    previousManifest,
    createdAt: value.createdAt,
    token: value.token,
  });
}

async function readOptionalAcceptTransaction(projectRoot, transactionFile) {
  await assertBoundedPath(projectRoot, transactionFile, { allowMissing: true });
  const details = await lstat(transactionFile).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (details === null) return null;
  return readStrictJson(transactionFile, {
    label: 'basic growth accept transaction',
    maxBytes: 2 * 1024 * 1024,
  });
}

async function recoverAcceptTransaction({
  projectRoot,
  paths,
  identity,
  store,
  run,
  manifest,
}) {
  const raw = await readOptionalAcceptTransaction(
    projectRoot,
    paths.acceptTransactionFile,
  );
  if (raw === null) return { run, manifest };
  const transaction = validateAcceptTransaction(raw, identity);
  if (run.state === 'reviewing') {
    run = await store.transition(identity, {
      expectedState: 'reviewing',
      nextState: 'completed',
    });
  } else if (run.state !== 'completed') {
    throw new Error('basic growth accept recovery state conflicts with transaction');
  }
  const nextManifest = validateManifest({
    ...transaction.previousManifest,
    revision: transaction.previousManifest.revision + 1,
    updatedAt: run.updatedAt,
    acceptedAt: run.updatedAt,
  }, identity);
  if (plainDataEqual(manifest, transaction.previousManifest)) {
    await writeMutableJson(projectRoot, paths.manifestFile, nextManifest);
    manifest = nextManifest;
  } else if (!plainDataEqual(manifest, nextManifest)) {
    throw new Error('basic growth accept recovery manifest conflicts with transaction');
  }
  await ensureAcceptedSeal({
    projectRoot,
    sealFile: paths.acceptedSealFile,
    identity,
    manifest,
  });
  await deleteAcceptTransaction({
    projectRoot,
    transactionFile: paths.acceptTransactionFile,
    identity,
    token: transaction.token,
  });
  return { run, manifest };
}

async function deleteAcceptTransaction({
  projectRoot,
  transactionFile,
  identity,
  token,
}) {
  const current = await readOptionalAcceptTransaction(projectRoot, transactionFile);
  if (current === null) return;
  const validated = validateAcceptTransaction(current, identity);
  if (validated.token !== token) {
    throw new Error('basic growth accept transaction token changed before delete');
  }
  await unlink(transactionFile);
}

function basicPaths(workspacePaths, identity) {
  const run = workspacePaths.run(identity);
  return Object.freeze({
    ...run,
    manifestFile: path.join(run.root, MANIFEST_FILE),
    transactionFile: path.join(run.root, TRANSACTION_FILE),
    acceptTransactionFile: path.join(run.root, ACCEPT_TRANSACTION_FILE),
    acceptedSealFile: path.join(run.root, ACCEPTED_SEAL_FILE),
    artifactDirectory: path.join(run.root, 'artifacts'),
    handoffDirectory: path.join(run.root, 'handoffs'),
  });
}

function acceptedSealDocument(identity, manifest) {
  return {
    schemaVersion: 1,
    kind: 'accepted-growth-run',
    identity: jsonSafeClone(identity),
    taskId: manifest.taskId,
    acceptedAt: manifest.acceptedAt,
    manifestRevision: manifest.revision,
    manifestSha256: createHash('sha256')
      .update(serializeJson(manifest))
      .digest('hex'),
  };
}

async function ensureAcceptedSeal({
  projectRoot,
  sealFile,
  identity,
  manifest,
}) {
  const expected = acceptedSealDocument(identity, manifest);
  await assertBoundedPath(projectRoot, sealFile, { allowMissing: true });
  let handle;
  try {
    handle = await open(sealFile, 'wx');
    await handle.writeFile(serializeJson(expected), 'utf8');
    await handle.sync();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    await verifyAcceptedSeal({
      projectRoot,
      sealFile,
      identity,
      manifest,
    });
  } finally {
    await handle?.close();
  }
}

async function verifyAcceptedSeal({
  projectRoot,
  sealFile,
  identity,
  manifest,
}) {
  const value = await readStrictJson(sealFile, {
    label: 'basic growth accepted seal',
    maxBytes: 64 * 1024,
  }).catch((error) => {
    throw new Error(`basic growth accepted seal is missing or invalid: ${error.message}`, {
      cause: error,
    });
  });
  assertExactKeys(value, [
    'schemaVersion',
    'kind',
    'identity',
    'taskId',
    'acceptedAt',
    'manifestRevision',
    'manifestSha256',
  ], 'basic growth accepted seal');
  assertExactKeys(value.identity, [
    'enterpriseId',
    'businessProjectId',
    'runId',
  ], 'basic growth accepted seal identity');
  const expected = acceptedSealDocument(identity, manifest);
  if (!plainDataEqual(value, expected)) {
    throw new Error('basic growth accepted seal does not match the accepted manifest');
  }
  return deepFreeze(jsonSafeClone(value));
}

function normalizeIdentity(value) {
  return Object.freeze({
    enterpriseId: requireEnterpriseId(value?.enterpriseId),
    businessProjectId: requireBusinessProjectId(value?.businessProjectId),
    runId: requireSafeId(value?.runId, 'runId'),
  });
}

function normalizePayload(value) {
  assertPlainData(value, 'basic growth artifact payload', {
    maxDepth: 24,
    maxNodes: 5_000,
    maxArrayLength: 500,
  });
  return jsonSafeClone(value);
}

function validateManifest(value, identity) {
  assertPlainData(value, 'basic growth manifest', {
    maxDepth: 24,
    maxNodes: 10_000,
    maxArrayLength: 1_000,
  });
  if (value.schemaVersion !== 1) {
    throw new Error('basic growth manifest schemaVersion must be 1');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error('basic growth manifest revision must be positive');
  }
  for (const field of ['enterpriseId', 'businessProjectId', 'runId']) {
    if (value[field] !== identity[field]) {
      throw new Error(`basic growth manifest identity mismatch: ${field}`);
    }
  }
  requiredText(value.taskId, 'basic growth manifest taskId', 160);
  requiredText(value.request, 'basic growth manifest request', 20_000);
  if (!Array.isArray(value.stages) || value.stages.length === 0) {
    throw new Error('basic growth manifest stages are required');
  }
  for (const stage of value.stages) {
    requireSafeId(stage.skillId, 'manifest skillId');
    requireSafeId(stage.artifactId, 'manifest artifactId');
    if (!['pending', 'completed'].includes(stage.status)) {
      throw new Error('basic growth manifest stage status is invalid');
    }
    if (!Number.isSafeInteger(stage.latestVersion) || stage.latestVersion < 0) {
      throw new Error('basic growth manifest latestVersion is invalid');
    }
    if (!Array.isArray(stage.artifacts)) {
      throw new Error('basic growth manifest artifacts must be an array');
    }
  }
  return deepFreeze(jsonSafeClone(value));
}

async function readOptionalManifest(projectRoot, manifestFile) {
  await assertBoundedPath(projectRoot, manifestFile, { allowMissing: true });
  const details = await lstat(manifestFile).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (details === null) return null;
  const value = await readStrictJson(manifestFile, {
    label: 'basic growth manifest',
    maxBytes: 2 * 1024 * 1024,
  });
  return value;
}

async function readRequiredManifest(projectRoot, manifestFile, identity) {
  const value = await readOptionalManifest(projectRoot, manifestFile);
  if (value === null) throw new Error('basic growth manifest not found');
  return validateManifest(value, identity);
}

async function writeMutableJson(projectRoot, filePath, value) {
  await assertBoundedPath(projectRoot, filePath, { allowMissing: true });
  await mkdir(path.dirname(filePath), { recursive: true });
  await assertBoundedPath(projectRoot, filePath, { allowMissing: true });
  await writeJsonAtomic(filePath, value);
}

async function writeImmutableJson(projectRoot, filePath, value) {
  return writeImmutableSerializedJson(
    projectRoot,
    filePath,
    serializeJson(value),
  );
}

async function writeImmutableSerializedJson(projectRoot, filePath, serialized) {
  await assertBoundedPath(projectRoot, filePath, { allowMissing: true });
  await mkdir(path.dirname(filePath), { recursive: true });
  await assertBoundedPath(projectRoot, filePath, { allowMissing: true });
  const handle = await open(filePath, 'wx').catch((error) => {
    if (error?.code === 'EEXIST') {
      throw new Error('immutable growth artifact already exists');
    }
    throw error;
  });
  try {
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function serializeJson(value) {
  return `${JSON.stringify(jsonSafeClone(value), null, 2)}\n`;
}

async function assertBoundedPath(projectRoot, targetPath, {
  allowMissing = false,
} = {}) {
  const relative = path.relative(projectRoot, path.resolve(targetPath));
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error('basic growth path escapes projectRoot');
  }
  const segments = relative.split(path.sep).filter(Boolean);
  let current = projectRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const details = await lstat(current).catch((error) => {
      if (error?.code === 'ENOENT' && allowMissing) return null;
      throw error;
    });
    if (details === null) return;
    if (details.isSymbolicLink()) {
      throw new Error('basic growth path must not traverse a link');
    }
    if (index < segments.length - 1 && !details.isDirectory()) {
      throw new Error('basic growth path ancestor must be a directory');
    }
    if (index === segments.length - 1 && !details.isFile()) {
      throw new Error('basic growth target must be a regular file');
    }
  }
}

function publicStatus(run, manifest) {
  const nextStage = manifest.stages.find((stage) => stage.status === 'pending');
  return deepFreeze({
    schemaVersion: 1,
    enterpriseId: manifest.enterpriseId,
    businessProjectId: manifest.businessProjectId,
    taskId: manifest.taskId,
    runId: manifest.runId,
    request: manifest.request,
    mode: manifest.mode,
    state: run.state,
    sequence: run.sequence,
    revision: manifest.revision,
    nextSkillId: nextStage?.skillId ?? null,
    stages: jsonSafeClone(manifest.stages),
    safety: jsonSafeClone(manifest.safety),
    acceptedAt: manifest.acceptedAt,
  });
}

function relativePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function requiredText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new Error(`${label} exceeds size limit`);
  return result;
}

function requiredCanonicalIso(value, label) {
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} fields are incomplete or unexpected`);
  }
}

function plainDataEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function withRunLock(identity, callback) {
  const key = [
    identity.enterpriseId,
    identity.businessProjectId,
    identity.runId,
  ].join('/');
  const prior = RUN_LOCKS.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  RUN_LOCKS.set(key, current);
  await prior.catch(() => {});
  try {
    return await callback();
  } finally {
    release();
    if (RUN_LOCKS.get(key) === current) RUN_LOCKS.delete(key);
  }
}
