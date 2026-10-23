#!/usr/bin/env node
// check.mjs — makerworld-ship bundle 的不变量检查（ESM）
// 用法: node check.mjs
// 退出码: 0 全过 / 1 有硬错误

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const yml = readFileSync(join(here, 'cordis.patch.yml'), 'utf8');
const profilePkg = resolve(process.env.USERPROFILE || process.env.HOME, '.dsh/profiles/desktop/package.json');

const errors = [];
const warns = [];
const norm = yml.replace(/\r\n/g, '\n');

// 1) 阶段工具名唯一
const toolNames = [...norm.matchAll(/toolName:\s*(\S+)/g)].map((m) => m[1]);
const dup = toolNames.filter((n, i) => toolNames.indexOf(n) !== i);
if (!toolNames.length) errors.push('没有找到任何 toolName（委派平面缺失？）');
if (dup.length) errors.push(`toolName 重复: ${[...new Set(dup)].join(', ')}`);

// 2) 每个阶段子代理必须是 spawn + maxDepth 1 + persona 非空
// 只保留真正的阶段块：subagent-service / subagent-spawn 也是 - id: subagent-*，但不是阶段
const blocks = norm.split(/- id: subagent-/).slice(1).filter((b) => /name:\s*'@deepseek-ai\/dsh-tool-subagent'/.test(b));
if (blocks.length !== toolNames.length) {
  warns.push(`subagent 块数(${blocks.length}) 与 toolName 数(${toolNames.length}) 不一致`);
}
for (const b of blocks) {
  const name = (b.match(/toolName:\s*(\S+)/) || [, '?'])[1];
  if (!/provider:\s*spawn/.test(b)) errors.push(`${name}: provider 不是 spawn`);
  if (!/maxDepth:\s*1/.test(b)) errors.push(`${name}: 缺 maxDepth: 1（会被递归委派）`);
  const pm = b.match(/persona:\s*\|-\n([\s\S]*?)(?=\n\s+- id:|\n\s{0,2}#|$)/);
  if (!pm || pm[1].trim().length < 40) errors.push(`${name}: persona 缺失或过短（<40 字符）`);
}

// 3) 包可解析（先从 desktop profile 解析；解析不到再退到本机 DSH 安装自带的 node_modules）
const dshGlobal = resolve(
  process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData/Roaming'),
  'npm/node_modules/@deepseek-ai/dsh/package.json'
);
if (!existsSync(profilePkg)) {
  warns.push(`profile package.json 不存在，跳过包解析: ${profilePkg}`);
} else {
  const roots = [profilePkg];
  if (existsSync(dshGlobal)) roots.push(dshGlobal);
  const pkgs = [...norm.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
  const uniq = [...new Set(pkgs)].filter((p) => !p.startsWith('cordis:'));
  for (const p of uniq) {
    const root = p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p;
    let ok = false;
    let lastErr = '';
    for (const r of roots) {
      const req = createRequire(r);
      try {
        req.resolve(root + '/package.json');
        ok = true;
        break;
      } catch (e) {
        if (String(e.code) === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
          try { req.resolve(root); ok = true; break; } catch { /* keep trying */ }
        }
        lastErr = String(e.code || e.message);
      }
    }
    if (!ok) errors.push(`包解析不到: ${p} (${lastErr})`);
  }
}

// 3b) 委派服务由 profile / host 提供，preset 里禁止再挂
//     实测：preset 内挂 @deepseek-ai/dsh-subagent 会报
//     `service "subagents" has been registered at <SubagentRuntime>`，整个模式加载失败。
//     正确做法：preset 只声明 tool-subagent 工具，provider（spawn/fork）由 profile 提供。
if (/name:\s*'@deepseek-ai\/dsh-subagent'/.test(norm)) {
  errors.push("preset 里不要挂 @deepseek-ai/dsh-subagent：subagents 服务由 profile 提供，重复注册会失败");
}
if (/name:\s*'@deepseek-ai\/dsh-subagent-(spawn|fork)-in-process'/.test(norm)) {
  warns.push("preset 里挂了 subagent backend：若 profile 已提供会重复注册（本机 profile 已提供 spawn）");
}
const providers = [...norm.matchAll(/provider:\s*(\w+)/g)].map((m) => m[1]);
if (providers.length && !/cordis:group/.test(norm)) {
  errors.push("有 provider 但没挂 cordis:group 委派平面");
}
// 4) 单模式 bundle
const presets = (norm.match(/@deepseek-ai\/dsh-agent-preset/g) || []).length;
if (presets !== 1) warns.push(`preset 行数=${presets}（本 bundle 设计为 1 个模式）`);

// 5) publish 子代理必须独占浏览器会话
if (!/独占浏览器会话/.test(norm)) warns.push('persona 里没有写「独占浏览器会话」约束');

// 6) 脚本语言约定：只剩 Blender 骨架允许 .py，其它一律 .mjs
if (/\.ps1/.test(norm)) warns.push('persona 里仍提到 .ps1（登录态已改 .mjs，本地不再有 .ps1）');

for (const w of warns) console.log(`⚠️  ${w}`);
if (errors.length) {
  for (const e of errors) console.log(`❌ ${e}`);
  console.log(`\n合计: ${errors.length} errors, ${warns.length} warnings`);
  process.exit(1);
}
console.log(`✅ 全部通过（${toolNames.length} 个阶段子代理，${warns.length} warnings）`);
console.log(`   toolName: ${toolNames.join(', ')}`);