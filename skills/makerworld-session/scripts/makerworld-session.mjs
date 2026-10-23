#!/usr/bin/env node
// makerworld-session.mjs — MakerWorld 登录态（固定 profile + 有头浏览器）
// 用法: node makerworld-session.mjs check|login|open|close [--timeout 600]
// 输出: 最后一行 KEY=VALUE（STATE=LOGGED_IN|NEED_LOGIN|LOGIN_OK|OPEN|CLOSED / URL=... / ERR=...）
// 退出码: 0 成功态 / 1 需要人工介入
//
// 关键：playwright-cli 的 open（headed）会一直阻塞到浏览器关闭，所以必须脱离进程树启动；
// 其余命令通过同一个 session 名 attach 到那个浏览器。
// 不再需要 Powershell 版的 `ping` 保活：open 本身活到浏览器关闭为止，close 之后它自己就退出了。

import { exec, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const PROFILE = join(homedir(), '.mw-browser');
const SESSION = 'mw';
const URL_DEFAULT = 'https://makerworld.com.cn/zh/my/models/publish?type=original';
const IS_WIN = process.platform === 'win32';

const args = process.argv.slice(2);
const action = args[0] || 'check';
const timeoutIdx = args.indexOf('--timeout');
const TIMEOUT = timeoutIdx >= 0 ? +args[timeoutIdx + 1] : 600;

function runCli(cliArgs) {
  // 用 exec（整串命令）而不是 execFile+shell：后者在 Node 24 会报 DEP0190
  // （带 shell 传 args 数组 = 拼接未转义）。这里的 cliArgs 都是内部常量，无注入面。
  const cmd = `npx --yes --package @playwright/cli playwright-cli -s=${SESSION} ${cliArgs.join(' ')}`;
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 32 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      resolve(`${stdout || ''}${stderr || ''}`);
    });
  });
}

function pageUrl(text) {
  const m = text.match(/Page URL:\s*(\S+)/);
  return m ? m[1] : '';
}

async function isAlive() {
  const t = await runCli(['snapshot']);
  return /Page URL:/.test(t);
}

function spawnDetached() {
  if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });
  const inner = `npx --yes --package @playwright/cli playwright-cli -s=${SESSION} open "${URL_DEFAULT}" --headed --persistent --profile "${PROFILE}"`;
  if (IS_WIN) {
    // 不要直接 spawn('cmd.exe', ['/c', 一整行])：引号会在 cmd 里被吃掉，浏览器根本起不来。
    // 写成 .cmd 文件再启动，与 PowerShell 版验证过的路径一致。
    const cmdPath = join(tmpdir(), 'mw-session-open.cmd');
    const logPath = join(tmpdir(), 'mw-session-open.log');
    writeFileSync(cmdPath, `@echo off\r\ncd /d "${tmpdir()}"\r\n${inner} > "${logPath}" 2>&1\r\n`, 'ascii');
    const child = spawn('cmd.exe', ['/c', cmdPath], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => console.error('spawn error: ' + e.message));
    child.unref();
  } else {
    const [cmd, ...rest] = inner.split(' ').filter(Boolean);
    const child = spawn(cmd, rest, { detached: true, stdio: 'ignore' });
    child.on('error', (e) => console.error('spawn error: ' + e.message));
    child.unref();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureOpen() {
  if (await isAlive()) return true;
  spawnDetached();
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (await isAlive()) return true;
  }
  return false;
}

function out(state, extra = {}) {
  console.log(`STATE=${state}`);
  for (const [k, v] of Object.entries(extra)) if (v) console.log(`${k}=${v}`);
}

async function main() {
  if (action === 'close') {
    await runCli(['close']);
    await sleep(1000);
    out('CLOSED');
    return 0;
  }

  if (action === 'open') {
    const ok = await ensureOpen();
    out('OPEN', ok ? { URL: pageUrl(await runCli(['snapshot'])) } : { ERR: 'browser_open_timeout' });
    return ok ? 0 : 1;
  }

  if (action === 'check') {
    if (!(await ensureOpen())) { out('NEED_LOGIN', { ERR: 'browser_open_timeout' }); return 1; }
    const url = pageUrl(await runCli(['snapshot']));
    if (/sign-in/.test(url)) { out('NEED_LOGIN', { URL: url }); return 1; }
    if (/makerworld\.com\.cn/.test(url)) { out('LOGGED_IN', { URL: url }); return 0; }
    out('NEED_LOGIN', { URL: url });
    return 1;
  }

  if (action === 'login') {
    if (!(await ensureOpen())) { out('NEED_LOGIN', { ERR: 'browser_open_timeout' }); return 1; }
    const deadline = Date.now() + TIMEOUT * 1000;
    while (Date.now() < deadline) {
      const url = pageUrl(await runCli(['snapshot']));
      if (/makerworld\.com\.cn/.test(url) && !/sign-in/.test(url)) { out('LOGIN_OK', { URL: url }); return 0; }
      await sleep(5000);
    }
    out('NEED_LOGIN', { ERR: 'timeout_waiting_for_login' });
    return 1;
  }

  out('NEED_LOGIN', { ERR: `unknown_action:${action}` });
  return 2;
}

main().then((code) => process.exit(code));
