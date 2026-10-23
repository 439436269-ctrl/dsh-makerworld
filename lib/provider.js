/**
 * 内置 skill provider。
 *
 * DSH 通过 `ctx.skills` 的 provider 注册表解析 skill。也可以挂
 * `@deepseek-ai/dsh-skill-filesystem` 配 `bundledSkillDir`，但那会让安装方
 * 多一处必须配对（配错就静默没技能）。在这里注册 provider 让插件自包含：
 * skill 随包走，挂上就出现，不需要任何拷贝步骤。
 *
 * 发现深度为一层，与 skill 的写法一致：`<skillsDir>/<name>/SKILL.md` 目录包
 * （可自带 `references/` / `scripts/`）与扁平的 `<skillsDir>/<name>.md`。
 * 候选用 bundled rank 上报，安装方自己的项目/用户 skill 在重名时胜出，
 * 不会被本包遮蔽。
 *
 * @module dsh-makerworld/provider
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { invocationPolicy, parseFrontmatter } from './frontmatter.js';

/** Precedence rank for packaged skill providers and local bundled roots. */
export const BUNDLED_SKILL_RANK = 600;

/** Provider name registered on `ctx.skills`. */
export const PROVIDER_NAME = 'dsh-makerworld';

/** File name of a directory-bundle skill. */
export const SKILL_FILE = 'SKILL.md';

/** Public skill-name grammar: lowercase kebab-case. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Return whether a string is a valid kebab-case skill name.
 * @param {unknown} value - candidate name.
 * @returns {boolean} whether the name is usable.
 */
export function isSkillName(value) {
  return typeof value === 'string' && SKILL_NAME_RE.test(value);
}

/**
 * Enumerate the skill files under a bundled skills directory.
 * @param {string} skillsDir - absolute path to the bundled skills root.
 * @param {(message: string) => void} warn - warning sink.
 * @returns {Array<{ dir: string, file: string }>} discovered skill files.
 */
function discover(skillsDir, warn) {
  let dirents;
  try {
    dirents = readdirSync(skillsDir, { withFileTypes: true });
  } catch (error) {
    warn(`cannot read bundled skills directory ${skillsDir}: ${error.message}`);
    return [];
  }

  const found = [];
  for (const dirent of dirents) {
    const full = join(skillsDir, dirent.name);
    if (dirent.isDirectory()) {
      const file = join(full, SKILL_FILE);
      try {
        if (statSync(file).isFile()) found.push({ dir: full, file });
      } catch {
        warn(`skipping ${dirent.name}: no ${SKILL_FILE}`);
      }
      continue;
    }
    if (dirent.isFile() && dirent.name.endsWith('.md') && dirent.name !== SKILL_FILE) {
      found.push({ dir: skillsDir, file: full });
    }
  }
  return found;
}

/**
 * Read and validate one skill file into a provider candidate.
 * @param {{ dir: string, file: string }} entry - discovered skill file.
 * @param {(message: string) => void} warn - warning sink.
 * @returns {object | undefined} a candidate, or `undefined` when the file is unusable.
 */
function readCandidate(entry, warn) {
  let parsed;
  try {
    parsed = parseFrontmatter(readFileSync(entry.file, 'utf8'));
  } catch (error) {
    warn(`skipping ${entry.file}: ${error.message}`);
    return undefined;
  }

  const { attrs } = parsed;
  const name = typeof attrs.name === 'string' ? attrs.name.trim() : '';
  if (!isSkillName(name)) {
    warn(`skipping ${entry.file}: name must be kebab-case, got ${JSON.stringify(attrs.name)}`);
    return undefined;
  }
  const directoryName = basename(entry.dir);
  if (entry.file === join(entry.dir, SKILL_FILE) && directoryName !== name) {
    warn(`${name}: directory name ${directoryName} differs from frontmatter name (frontmatter wins)`);
  }

  const description = typeof attrs.description === 'string' ? attrs.description.trim() : '';
  if (!description) {
    warn(`skipping ${name}: description is required`);
    return undefined;
  }

  const { policy, error } = invocationPolicy(attrs);
  if (error) {
    warn(`skipping ${name}: ${error}`);
    return undefined;
  }

  const whenToUse = typeof attrs.whenToUse === 'string' ? attrs.whenToUse.trim() : undefined;
  const metadata = attrs.metadata && typeof attrs.metadata === 'object' && !Array.isArray(attrs.metadata)
    ? attrs.metadata
    : undefined;

  return {
    name,
    description,
    whenToUse,
    invocation: policy,
    source: 'bundled',
    provider: PROVIDER_NAME,
    path: entry.file,
    resourceBase: { kind: 'directory', path: entry.dir },
    rank: BUNDLED_SKILL_RANK,
    locator: entry.file,
    metadata,
  };
}

/**
 * Create the bundled skill provider registered on `ctx.skills`.
 * @param {object} options - provider options.
 * @param {string} options.skillsDir - absolute path to the bundled skills root.
 * @param {string[]} [options.enabledSkills] - when non-empty, only these skill names are served.
 * @param {(message: string) => void} [options.onWarn] - warning sink.
 * @returns {{ name: string, list: Function, get: Function }} the provider.
 */
export function createBundledSkillProvider(options = {}) {
  const { skillsDir, enabledSkills = [], onWarn } = options;
  const warn = typeof onWarn === 'function' ? onWarn : () => {};
  const allowed = new Set((Array.isArray(enabledSkills) ? enabledSkills : []).map(String));
  let catalog;

  /**
   * Build (once) the validated catalog of candidates.
   * @returns {object[]} candidates sorted by name.
   */
  function candidates() {
    if (catalog) return catalog;
    catalog = discover(skillsDir, warn)
      .map((entry) => readCandidate(entry, warn))
      .filter(Boolean)
      .filter((candidate) => allowed.size === 0 || allowed.has(candidate.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return catalog;
  }

  return {
    name: PROVIDER_NAME,

    /**
     * List every bundled skill for the current lookup.
     * @param {{ signal?: AbortSignal }} [lookup] - lookup options.
     * @returns {Promise<object[]>} provider candidates.
     */
    async list(lookup) {
      if (lookup?.signal?.aborted) return [];
      return candidates();
    },

    /**
     * Load one bundled skill body.
     * @param {object} candidate - a candidate previously returned by `list`.
     * @param {{ signal?: AbortSignal }} [lookup] - lookup options.
     * @returns {Promise<object | undefined>} the full definition, or `undefined` when unreadable.
     */
    async get(candidate, lookup) {
      if (lookup?.signal?.aborted) return undefined;
      let parsed;
      try {
        parsed = parseFrontmatter(readFileSync(candidate.locator, 'utf8'));
      } catch (error) {
        warn(`cannot load ${candidate.name}: ${error.message}`);
        return undefined;
      }
      const { policy } = invocationPolicy(parsed.attrs);
      return {
        name: candidate.name,
        description: candidate.description,
        whenToUse: candidate.whenToUse,
        invocation: policy ?? candidate.invocation,
        source: 'bundled',
        provider: PROVIDER_NAME,
        path: candidate.path,
        resourceBase: candidate.resourceBase,
        metadata: candidate.metadata,
        content: parsed.body.replace(/^\s*\n/, ''),
      };
    },
  };
}
