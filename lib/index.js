/**
 * dsh-makerworld — MakerWorld 出货流水线的 skill 包，内置进 DeepSeek Harness。
 *
 * 挂载本插件会在 `ctx.skills` 上注册一个 provider，把包内 `skills/` 目录里的
 * skill 直接提供给 agent。六个 skill 一挂即出现在技能目录里，**不需要往
 * `~/.agents/skills` 或 `~/.dsh/skills` 拷任何文件**。
 *
 * 这里不依赖任何其它包：provider 接口就是普通对象，所以本插件没有运行时依赖，
 * 装的时候不会撞 peer 版本。
 *
 * @module dsh-makerworld
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBundledSkillProvider, PROVIDER_NAME } from './provider.js';

/** Cordis plugin name. */
export const name = PROVIDER_NAME;

/** Directory holding the bundled skills, relative to this module. */
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

/**
 * Emit a warning through whatever logging surface the host context exposes.
 * The context shape differs between host versions, so this never throws.
 * @param {object} ctx - cordis context.
 * @param {string} message - warning text.
 */
function warn(ctx, message) {
  try {
    const logger = typeof ctx?.logger === 'function' ? ctx.logger(PROVIDER_NAME) : ctx?.logger;
    if (logger && typeof logger.warn === 'function') {
      logger.warn(message);
      return;
    }
  } catch {
    /* fall through to the console */
  }
  try {
    console.warn(`[${PROVIDER_NAME}] ${message}`);
  } catch {
    /* nothing left to report to */
  }
}

/**
 * Register the bundled skill provider.
 * @param {object} ctx - cordis context.
 * @param {object} [config] - loader row config.
 * @param {string[]} [config.enabledSkills] - when non-empty, only these bundled skills are served.
 */
export function apply(ctx, config = {}) {
  const settings = config && typeof config === 'object' ? config : {};
  const providerOptions = {
    skillsDir: SKILLS_DIR,
    enabledSkills: settings.enabledSkills,
    onWarn: (message) => warn(ctx, message),
  };

  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.registerProvider(() => createBundledSkillProvider(providerOptions));
  });
}
