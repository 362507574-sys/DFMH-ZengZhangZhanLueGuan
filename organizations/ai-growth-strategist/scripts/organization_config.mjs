import path from 'node:path';

import { deepFreeze, readStrictJson } from './strict_json.mjs';

const FIELDS = new Set([
  'schemaVersion',
  'id',
  'displayName',
  'systemName',
  'deploymentMode',
  'status',
  'acceptsFormalTasks',
  'rootControllerRegistration',
  'formalTaskRouting',
  'peerOrganizationCalls',
  'coreSkills',
  'publicSkillDependencies',
]);
const CORE = [
  ['growth-opportunity-analysis', '增长机会分析'],
  ['competitive-benchmark-analysis', '竞争对标拆解'],
  ['content-customer-growth', '内容与客户增长'],
];
const PUBLIC = ['public.promotional-poster', 'public.taobao-ecommerce-image-set'];

export async function loadOrganizationConfig({ projectRoot } = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw new TypeError('projectRoot must be an absolute path');
  }
  const filePath = path.join(
    projectRoot,
    'organizations',
    'ai-growth-strategist',
    'config',
    'organization.json',
  );
  const value = await readStrictJson(filePath, {
    label: 'AI growth strategist config',
    allowedKeys: FIELDS,
  });
  for (const field of FIELDS) {
    if (!Object.hasOwn(value, field)) throw new Error(`organization config missing field: ${field}`);
  }
  if (value.schemaVersion !== 1
    || value.id !== 'ai-growth-strategist'
    || value.displayName !== 'AI增长战略官'
    || value.systemName !== '增长获客系统'
    || value.deploymentMode !== 'same_project_organization_module') {
    throw new Error('organization identity or deployment mode drifted');
  }
  if (value.status !== 'designing' || value.acceptsFormalTasks !== false) {
    throw new Error('designing organization cannot claim operational or formal availability');
  }
  if (value.rootControllerRegistration !== 'registered_designing'
    || value.formalTaskRouting !== 'fallback_existing'
    || value.peerOrganizationCalls !== 'contract_only') {
    throw new Error('organization routing or collaboration state is overstated');
  }
  if (!Array.isArray(value.coreSkills) || value.coreSkills.length !== 3) {
    throw new Error('organization must declare exactly three core skills');
  }
  value.coreSkills.forEach((skill, index) => {
    const expected = CORE[index];
    if (!skill
      || Object.keys(skill).sort().join(',') !== 'id,name,status'
      || skill.id !== expected[0]
      || skill.name !== expected[1]
      || skill.status !== 'designing') {
      throw new Error(`core skill identity or status is invalid: ${expected[0]}`);
    }
  });
  if (!Array.isArray(value.publicSkillDependencies)
    || value.publicSkillDependencies.length !== 2
    || value.publicSkillDependencies.some(
      (item, index) => !item
        || Object.keys(item).sort().join(',') !== 'id,mode'
        || item.id !== PUBLIC[index]
        || item.mode !== 'via-control-center',
    )) {
    throw new Error('public skill dependencies are invalid');
  }
  return deepFreeze(value);
}
