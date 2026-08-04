import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { optionalImport } from './helpers.mjs';

const loaded = await optionalImport('scripts/knowledge_preflight_adapter.mjs');

test('知识前置适配器暴露组织入口', () => {
  assert.equal(
    typeof loaded.module?.runOrganizationKnowledgePreflight,
    'function',
    loaded.error?.message ?? 'runOrganizationKnowledgePreflight missing',
  );
});

test('matched、no_hit 和 degraded 均保存固定凭证并继续', async (t) => {
  if (!loaded.module) return;
  for (const status of ['matched', 'no_hit', 'degraded']) {
    const root = await createRoot(t);
    const task = createTask();
    const evidence = await loaded.module.runOrganizationKnowledgePreflight({
      projectRoot: root,
      task,
      executeCli: async ({ input, evidenceAbsolutePath }) => {
        await mkdir(path.dirname(evidenceAbsolutePath), { recursive: true });
        await writeFile(evidenceAbsolutePath, `${JSON.stringify({
          requestId: input.requestId,
          capabilityId: input.capabilityId,
          status,
          sources: status === 'matched' ? [{
            spaceName: '老雷知识库',
            title: '测试资料',
            url: 'https://example.invalid/wiki/test',
            excerpt: '只用于自动测试的正文摘录。',
          }] : [],
          degradedReason: status === 'degraded' ? 'test timeout' : '',
        }, null, 2)}\n`, 'utf8');
      },
    });
    assert.equal(evidence.status, status);
    assert.equal(evidence.requestId, task.taskId);
  }
});

test('正式增长任务拒绝 skipped_non_business 和越界 evidencePath', async (t) => {
  if (!loaded.module) return;
  const root = await createRoot(t);
  const task = createTask();
  await assert.rejects(
    loaded.module.runOrganizationKnowledgePreflight({
      projectRoot: root,
      task: { ...task, evidencePath: '../escape.json' },
      executeCli: async () => {},
    }),
    /fixed|path|evidence/u,
  );
  await assert.rejects(
    loaded.module.runOrganizationKnowledgePreflight({
      projectRoot: root,
      task,
      executeCli: async ({ input, evidenceAbsolutePath }) => {
        await mkdir(path.dirname(evidenceAbsolutePath), { recursive: true });
        await writeFile(evidenceAbsolutePath, `${JSON.stringify({
          requestId: input.requestId,
          capabilityId: input.capabilityId,
          status: 'skipped_non_business',
          sources: [],
        })}\n`, 'utf8');
      },
    }),
    /skipped_non_business/u,
  );
});

function createTask() {
  return {
    taskId: '20260728-001-knowledge-test',
    requestId: '20260728-001-knowledge-test',
    enterpriseId: 'demo-enterprise',
    text: '分析下一季度增长机会并建立可追踪证据。',
    summary: '增长机会分析测试',
    capabilityId: 'growth-opportunity-analysis',
  };
}

async function createRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'growth-knowledge-'));
  await mkdir(path.join(root, 'organizations', 'ai-growth-strategist'), {
    recursive: true,
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
