#!/usr/bin/env node
// lint_listing.mjs — 发布前把 MakerWorld 文案卡在合规线上（Node 版，零依赖）
// 用法: node lint_listing.mjs <project.json> [--out lint.json]
// 退出码: 0 全绿 / 1 有 errors
// 规则与 lint_listing.py 完全一致

import { readFileSync, writeFileSync } from 'node:fs';

const TITLE_MAX = 50;
const DESC_MIN_PARA = 4;
const DESC_REC_PARA = 6;
const DESC_MAX_PARA = 8;
const PARA_MAX = 200;
const DESC_TOTAL_MAX = 2000;
const PHOTOS_MIN = 3;
const PHOTOS_MAX = 16;
const RENDERS_MAX = 16;
const TAGS_MAX = 50;
const TAGS_REC = [8, 10];

const LICENSES = {
  'CC-BY-NC': 'CC 风格：可改编、不可商用',
  'FULL-OPEN': '全开源：改编/商用/再分发都允许',
  'NO-DERIV': '保留所有权利：只许下载打印',
};

const MD_PATTERNS = [
  [/\*\*[^*]+\*\*/, '加粗语法 **x**（富文本会原样显示星号）'],
  [/^#{1,6}\s/m, '标题语法 # （富文本无标题语义）'],
  [/^\s*[-*+]\s+/m, '列表符号 - （富文本会显示成破折号）'],
  [/`{1,3}[^`]+`{1,3}/, '行内代码/代码块'],
  [/!\[[^\]]*\]\([^)]*\)/, 'Markdown 图片语法'],
  [/\[[^\]]+\]\([^)]+\)/, 'Markdown 链接语法'],
];

function isMd(p) {
  for (const [re, why] of MD_PATTERNS) if (re.test(p)) return why;
  return null;
}

function lint(doc) {
  const errors = [];
  const warns = [];
  const stats = {};

  const rawTitle = doc.title || '';
  const title = rawTitle.trim();
  stats.title_len = [...title].length;
  if (!title) errors.push('title 为空');
  else if (stats.title_len > TITLE_MAX) errors.push(`title ${stats.title_len} 字，超过 ${TITLE_MAX}`);
  if (title !== rawTitle) warns.push('title 首尾有空白');
  const tmd = isMd(title);
  if (tmd) errors.push(`title 含 Markdown：${tmd}`);

  const cat = (doc.category || '').trim();
  if (!cat) errors.push('category 为空（发布页必填）');

  const lic = (doc.license || '').trim();
  if (!(lic in LICENSES)) errors.push(`license=${JSON.stringify(lic)} 不在允许集合 ${JSON.stringify(Object.keys(LICENSES))} 里`);
  else stats.license_meaning = LICENSES[lic];

  const tags = doc.tags || [];
  stats.tags = tags.length;
  if (!tags.length) errors.push('tags 为空（至少要能被搜到）');
  if (tags.length > TAGS_MAX) errors.push(`tags ${tags.length} 个，超过 ${TAGS_MAX}`);
  if (tags.length < TAGS_REC[0] || tags.length > TAGS_REC[1]) {
    warns.push(`tags ${tags.length} 个，建议 ${TAGS_REC[0]}–${TAGS_REC[1]}`);
  }
  if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) errors.push('tags 有重复');
  if (tags.some((t) => [...t].length > 30)) warns.push('有标签超过 30 字，容易被平台截断');

  const desc = doc.desc || [];
  stats.desc_paras = desc.length;
  stats.desc_chars = desc.reduce((a, p) => a + [...p].length, 0);
  if (desc.length < DESC_MIN_PARA) {
    errors.push(`描述只有 ${desc.length} 段，至少 ${DESC_MIN_PARA} 段（平台是富文本，段落才好读）`);
  } else if (desc.length < DESC_REC_PARA) {
    warns.push(`描述 ${desc.length} 段，建议 ${DESC_REC_PARA} 段（讲清定位/打印/结构/装配/注意/收尾）`);
  } else if (desc.length > DESC_MAX_PARA) {
    warns.push(`描述 ${desc.length} 段，超过建议的 ${DESC_MAX_PARA} 段`);
  }
  desc.forEach((p, idx) => {
    const i = idx + 1;
    if (!p.trim()) { errors.push(`描述第 ${i} 段是空的`); return; }
    if ([...p].length > PARA_MAX) errors.push(`描述第 ${i} 段 ${[...p].length} 字，超过 ${PARA_MAX}（手机上一坨）`);
    const why = isMd(p);
    if (why) errors.push(`描述第 ${i} 段含 ${why}`);
  });
  if (stats.desc_chars > DESC_TOTAL_MAX) errors.push(`描述总计 ${stats.desc_chars} 字，超过 ${DESC_TOTAL_MAX}`);

  const media = doc.media || {};
  const photos = media.photos || [];
  const renders = media.renders || [];
  stats.photos = photos.length;
  stats.renders = renders.length;
  if (photos.length < PHOTOS_MIN) {
    errors.push(`实拍图 ${photos.length} 张，平台硬性要求 ≥${PHOTOS_MIN}（且要覆盖 3 个视图）`);
  }
  if (photos.length > PHOTOS_MAX) errors.push(`实拍图 ${photos.length} 张，超过上限 ${PHOTOS_MAX}`);
  if (renders.length > RENDERS_MAX) errors.push(`模型图片 ${renders.length} 张，超过上限 ${RENDERS_MAX}`);
  const cover = media.cover;
  if (!cover) warns.push('没指定 cover（发布时要单独裁 4:3 封面）');
  else if (!photos.includes(cover)) errors.push(`cover=${JSON.stringify(cover)} 不是实拍图（平台要求封面必须实拍）`);

  const geo = doc.geometry || {};
  if (!(geo.stl || []).length) errors.push('geometry.stl 为空（发布第 1 步就要传模型文件）');

  return { pass: errors.length === 0, errors, warnings: warns, stats };
}

function main(argv) {
  if (!argv.length) {
    console.log(JSON.stringify({ pass: false, error: '用法: lint_listing.mjs <project.json> [--out lint.json]' }));
    return 2;
  }
  const path = argv[0];
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? argv[outIdx + 1] : null;
  const doc = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); // 容忍 PowerShell 写的 BOM
  const report = { ...lint(doc), file: path };
  const text = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, text, 'utf8');
  console.log(text);
  return report.pass ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
