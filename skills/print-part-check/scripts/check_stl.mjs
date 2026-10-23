#!/usr/bin/env node
// check_stl.mjs — 判断 STL 能不能打（Node 版，零依赖）
// 用法: node check_stl.mjs <file.stl|dir> [more...] [--bed 240] [--density 1.24] [--out check.json]
// 退出码: 0 全通过 / 1 有失败 / 2 没找到 STL
// 输出字段与 check_stl.py 完全一致（两版并行跑过等价性对比）

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';

function readStl(path) {
  const buf = readFileSync(path);
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (buf.length === 84 + n * 50) {
      const tris = new Array(n);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        tris[i] = [
          [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)],
          [buf.readFloatLE(o + 12), buf.readFloatLE(o + 16), buf.readFloatLE(o + 20)],
          [buf.readFloatLE(o + 24), buf.readFloatLE(o + 28), buf.readFloatLE(o + 32)],
        ];
      }
      return { tris, format: 'binary' };
    }
  }
  // ASCII 兜底
  const text = buf.toString('utf8');
  const vals = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m;
  while ((m = re.exec(text))) vals.push([+m[1], +m[2], +m[3]]);
  const tris = [];
  for (let i = 0; i + 2 < vals.length; i += 3) tris.push([vals[i], vals[i + 1], vals[i + 2]]);
  return { tris, format: 'ascii' };
}

function analyze(path, bedMm, density) {
  const { tris, format } = readStl(path);

  // 焊点：按 0.001mm 量化成整数微米键，避免 float32 抖动把同点拆开
  const key2idx = new Map();
  const verts = [];
  const idxTris = tris.map((t) =>
    t.map((v) => {
      const k = `${Math.round(v[0] * 1000)},${Math.round(v[1] * 1000)},${Math.round(v[2] * 1000)}`;
      let i = key2idx.get(k);
      if (i === undefined) {
        i = verts.length;
        key2idx.set(k, i);
        verts.push([v[0], v[1], v[2]]);
      }
      return i;
    })
  );

  const edgeCount = new Map();
  let area = 0;
  let zeroArea = 0;
  let vol6 = 0;

  for (let t = 0; t < tris.length; t++) {
    const ids = idxTris[t];
    const [v0, v1, v2] = tris[t];
    const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
    const wx = v2[0] - v0[0], wy = v2[1] - v0[1], wz = v2[2] - v0[2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    const ar = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    area += ar;
    if (ar < 1e-9) zeroArea++;
    vol6 +=
      v0[0] * (v1[1] * v2[2] - v1[2] * v2[1]) -
      v0[1] * (v1[0] * v2[2] - v1[2] * v2[0]) +
      v0[2] * (v1[0] * v2[1] - v1[1] * v2[0]);
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }

  const xs = verts.map((v) => v[0]);
  const ys = verts.map((v) => v[1]);
  const zs = verts.map((v) => v[2]);
  const bbox = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)];

  let boundary = 0;
  let nonman = 0;
  for (const c of edgeCount.values()) {
    if (c === 1) boundary++;
    else if (c > 2) nonman++;
  }

  const volume = Math.abs(vol6) / 6 / 1000; // mm^3 -> cm^3
  const areaCm2 = area / 100; // mm^2 -> cm^2
  const shell = Math.min(volume, areaCm2 * 0.16);
  const grams = (shell + Math.max(0, volume - shell) * 0.15) * density;

  const reasons = [];
  if (nonman) reasons.push(`nonmanifold_edges=${nonman}（共享边 >2 面，布尔/倒角常这么坏）`);
  if (boundary) reasons.push(`boundary_edges=${boundary}（有洞，网格没闭合）`);
  if (Math.max(...bbox) > bedMm) {
    reasons.push(`bbox ${bbox[0].toFixed(1)}×${bbox[1].toFixed(1)}×${bbox[2].toFixed(1)} 超过打印床 ${bedMm}`);
  }

  return {
    file: resolve(path),
    format,
    tris: tris.length,
    verts: verts.length,
    bbox_mm: bbox.map((x) => Math.round(x * 1000) / 1000),
    volume_cm3: Math.round(volume * 100) / 100,
    area_cm2: Math.round(areaCm2 * 10) / 10,
    grams_est: Math.round(grams),
    nonmanifold_edges: nonman,
    boundary_edges: boundary,
    zero_area_faces: zeroArea,
    watertight: boundary === 0 && nonman === 0,
    fits_bed: Math.max(...bbox) <= bedMm + 1e-6,
    pass: reasons.length === 0,
    reasons,
  };
}

function expand(paths) {
  const out = [];
  for (const p of paths) {
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      for (const f of readdirSync(p, { recursive: true })) {
        const full = join(p, f.toString());
        if (extname(full).toLowerCase() === '.stl' && statSync(full).isFile()) out.push(full);
      }
    } else if (extname(p).toLowerCase() === '.stl') {
      out.push(p);
    }
  }
  return out.sort();
}

function main(argv) {
  const paths = [];
  let bedMm = 240, density = 1.24, out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bed') bedMm = +argv[++i];
    else if (a === '--density') density = +argv[++i];
    else if (a === '--out') out = argv[++i];
    else paths.push(a);
  }
  const files = expand(paths);
  if (!files.length) {
    console.log(JSON.stringify({ pass: false, error: '没有找到 .stl' }, null, 2));
    return 2;
  }
  const results = files.map((f) => {
    try { return analyze(f, bedMm, density); }
    catch (e) { return { file: resolve(f), pass: false, reasons: [`解析失败: ${e.message}`] }; }
  });
  const report = {
    generated: new Date().toISOString().replace('Z', '+00:00'),
    bed_mm: bedMm,
    density_g_cm3: density,
    pass: results.every((r) => r.pass),
    files: results,
  };
  const text = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, text, 'utf8');
  console.log(text);
  return report.pass ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
