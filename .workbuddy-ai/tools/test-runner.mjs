#!/usr/bin/env node
// new-api-plugins 测试运行器：跑测试 → 生成报告 → 更新倒排索引 → 与历史报告比对 → 输出闸门结论
//
// 闭环：
//   1. 每次运行都落一份带时间戳的测试报告（不可变，历史永存）
//   2. index.json / INDEX.md 按时间倒排，LATEST.md 指向最新一份 → agent 一次读取即拿最新
//   3. 逐用例与「历史报告」比对，任何曾经通过、现在失败的用例判为 REGRESSION（致命）
//   4. 层覆盖不得退化：历史上验过的真实层，新版本必须复验，否则 verdict=INCOMPLETE（不算完成）
//
// 用法：
//   node .workbuddy-ai/tools/test-runner.mjs                    # 跑全部插件的离线层
//   node .workbuddy-ai/tools/test-runner.mjs --key kling        # 只跑 kling
//   node .workbuddy-ai/tools/test-runner.mjs --include-live     # 连真实层一起跑（需 LIVE_KEY）
//   node .workbuddy-ai/tools/test-runner.mjs --json             # 额外打印机器可读摘要
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // .workbuddy-ai/tools
const AI_DIR = path.resolve(HERE, ".."); // .workbuddy-ai
const ROOT = path.resolve(AI_DIR, ".."); // 仓库根
const REPORTS_DIR = path.join(AI_DIR, "test-reports");
const INDEX_JSON = path.join(REPORTS_DIR, "index.json");
const INDEX_MD = path.join(REPORTS_DIR, "INDEX.md");
const LATEST_MD = path.join(REPORTS_DIR, "LATEST.md");

const MARK_BEGIN = "===NEWAPI-TEST-RESULT-BEGIN===";
const MARK_END = "===NEWAPI-TEST-RESULT-END===";
const SCHEMA = 1;

// 文件名后缀 → 层级。offline 层默认跑，real 层需要显式开启且要有凭据。
const LAYER_BY_SUFFIX = [
  [".test.mjs", "contract"],
  [".spec.mjs", "spec"],
  [".openapi.mjs", "spec"],
  [".live.mjs", "live"],
  [".e2e.mjs", "e2e"],
];
const OFFLINE_LAYERS = ["contract", "spec"];
const REAL_LAYERS = ["live", "e2e"];
// 闸门要求的层组：contract 组必须有，real 组（live 或 e2e 任一）必须有才算「完成」
const REQUIRED_GROUPS = { contract: ["contract"], real: REAL_LAYERS };

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const opt = {
    keys: [],
    layers: [],
    dirs: [],
    includeLive: false,
    offlineOnly: false,
    require: null,
    timeoutMs: 600000,
    write: true,
    json: false,
    allowIncomplete: false,
    liveArgs: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--key") opt.keys.push(next());
    else if (a === "--layer") opt.layers.push(next());
    else if (a === "--dir") opt.dirs.push(path.resolve(ROOT, next()));
    else if (a === "--include-live" || a === "--all") opt.includeLive = true;
    else if (a === "--offline-only") opt.offlineOnly = true;
    else if (a === "--require") opt.require = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--timeout") opt.timeoutMs = Number(next());
    else if (a === "--live-arg") opt.liveArgs.push(next());
    else if (a === "--no-index") opt.write = false;
    else if (a === "--json") opt.json = true;
    else if (a === "--allow-incomplete") opt.allowIncomplete = true;
    else if (a === "-h" || a === "--help") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).join("\n"));
      process.exit(0);
    } else {
      console.error(`未知参数：${a}（--help 查看用法）`);
      process.exit(64);
    }
  }
  return opt;
}

const OPT = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------- 发现测试脚本

function discover() {
  const scanDirs = OPT.dirs.length
    ? OPT.dirs
    : [path.join(AI_DIR, "tests"), path.join(AI_DIR, "tmp-tests")];
  const found = new Map(); // basename → abs，避免同一脚本在两处被重复执行
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".mjs")) continue;
      const hit = LAYER_BY_SUFFIX.find(([sfx]) => name.endsWith(sfx));
      if (!hit) continue;
      if (found.has(name)) continue;
      found.set(name, { abs: path.join(dir, name), name, layer: hit[1] });
    }
  }
  return [...found.values()];
}

function deriveKey(name) {
  const hit = LAYER_BY_SUFFIX.find(([sfx]) => name.endsWith(sfx));
  return hit ? name.slice(0, -hit[0].length) : name.replace(/\.mjs$/, "");
}

// 被测插件版本：优先从脚本源码里抓 plugins/tasks/<key>/<semver>/plugin.js，
// 抓不到时回退到该插件下最大 semver，并标记 inferred。
function resolveTarget(key, src) {
  const m = new RegExp(`plugins/tasks/${key}/(\\d+\\.\\d+\\.\\d+)/plugin\\.js`).exec(src);
  if (m) return { version: m[1], inferred: false };
  const dir = path.join(ROOT, "plugins", "tasks", key);
  if (fs.existsSync(dir)) {
    const vers = fs.readdirSync(dir).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
    vers.sort(cmpSemver);
    if (vers.length) return { version: vers[vers.length - 1], inferred: true };
  }
  return { version: "unknown", inferred: true };
}

function cmpSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------- 执行 + 解析

function runScript(abs, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [abs, ...OPT.liveArgs], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: err + String(e), durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, durationMs: Date.now() - started, timedOut });
    });
  });
}

// 解析三种历史遗留输出格式，越精确越好：
//   ① 用例级：`✓/✗/⚠ label`（首选，回归比对可精确到用例）
//   ② 用例级（旧）：失败写 stderr 的 `FAIL: label`，成功静默
//   ③ 仅聚合：`ALL PASS: N assertions` / `FAILED n (passed m)` / `passed=n failed=m`
//   另有可选的结构化块（见 assets/testkit.mjs），出现时优先级最高。
function parseOutput(text, errText) {
  const rows = [];
  const structured = parseStructuredBlock(text);
  let section = "(未分组)";
  for (const raw of text.split(/\r?\n/)) {
    const sec = /^\s*==+\s*(.+?)\s*==+\s*$/.exec(raw);
    if (sec) {
      section = sec[1];
      continue;
    }
    const m = /^\s*([✓✔✗✘⚠])\s+(.+?)\s*$/.exec(raw);
    if (m) {
      const outcome = m[1] === "⚠" ? "warn" : "✓✔".includes(m[1]) ? "pass" : "fail";
      rows.push({ label: m[2], outcome, section });
    }
  }
  // 没有用例级输出时，退回解析 stderr 的 FAIL 行
  if (!rows.length && errText) {
    for (const raw of errText.split(/\r?\n/)) {
      const m = /^\s*FAIL(?:\s*\(([^)]*)\))?\s*:\s*(.+?)\s*$/.exec(raw);
      if (m) rows.push({ label: (m[1] ? `[${m[1]}] ` : "") + m[2], outcome: "fail", section });
    }
  }

  let cases;
  let granularity;
  if (structured && Array.isArray(structured.cases) && structured.cases.length) {
    cases = structured.cases.map((c, i) => ({
      id: String(c.id || c.label || `case-${i}`),
      label: String(c.label || c.id || `case-${i}`),
      outcome: c.outcome === "fail" ? "fail" : c.outcome === "warn" ? "warn" : "pass",
      section: String(c.section || "(未分组)"),
    }));
    granularity = "case";
  } else if (rows.length) {
    const seen = new Map();
    cases = rows.map((r) => {
      const n = (seen.get(r.label) || 0) + 1;
      seen.set(r.label, n);
      return { ...r, id: n === 1 ? r.label : `${r.label}#${n}` };
    });
    granularity = "case";
  } else {
    cases = [];
    granularity = "aggregate";
  }
  return { cases, granularity, aggregate: parseAggregate(text), structured };
}

function parseStructuredBlock(text) {
  const begin = text.indexOf(MARK_BEGIN);
  const end = text.indexOf(MARK_END);
  if (begin < 0 || end < 0 || end < begin) return null;
  try {
    return JSON.parse(text.slice(begin + MARK_BEGIN.length, end));
  } catch {
    return null;
  }
}

function parseAggregate(text) {
  const agg = {};
  for (const line of text.split(/\r?\n/)) {
    let m = /ALL PASS:\s*(\d+)\s*assertions?/i.exec(line);
    if (m) {
      agg.passed = Number(m[1]);
      agg.failed = 0;
      agg.total = Number(m[1]);
      continue;
    }
    m = /FAILED\s+(\d+)\s*\(passed\s+(\d+)\)/i.exec(line);
    if (m) {
      agg.failed = Number(m[1]);
      agg.passed = Number(m[2]);
      agg.total = Number(m[1]) + Number(m[2]);
      continue;
    }
    m = /\bpassed\s*=\s*(\d+)\b[\s\S]*?\bfailed\s*=\s*(\d+)\b/i.exec(line);
    if (m) {
      agg.passed = Number(m[1]);
      agg.failed = Number(m[2]);
      agg.total = Number(m[1]) + Number(m[2]);
    }
  }
  return agg;
}

function summarize(cases, aggregate, granularity) {
  if (granularity === "case") {
    return {
      total: cases.length,
      passed: cases.filter((c) => c.outcome === "pass").length,
      failed: cases.filter((c) => c.outcome === "fail").length,
      warned: cases.filter((c) => c.outcome === "warn").length,
    };
  }
  const p = aggregate.passed || 0;
  const f = aggregate.failed || 0;
  return { total: aggregate.total || p + f, passed: p, failed: f, warned: 0 };
}

// ---------------------------------------------------------------- 历史与回归

function loadIndex() {
  if (!fs.existsSync(INDEX_JSON)) return { schema: SCHEMA, reports: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
    if (!Array.isArray(parsed.reports)) return { schema: SCHEMA, reports: [] };
    return parsed;
  } catch {
    return { schema: SCHEMA, reports: [] };
  }
}

function historyFor(reports, key, layer) {
  return reports
    .filter((r) => r.key === key && r.layer === layer)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // 倒排：最新在前
}

function pickBaseline(reports, key, layer, version) {
  const hist = historyFor(reports, key, layer);
  return hist.find((r) => r.version === version) || hist[0] || null;
}

function diffCases(cases, baseline) {
  const now = new Map(cases.map((c) => [c.id, c]));
  const before = new Map((baseline?.cases || []).map((c) => [c.id, c]));
  const regressions = [];
  const fixed = [];
  const stillFailing = [];
  const vanished = [];
  let unchanged = 0;
  let added = 0;

  for (const c of cases) {
    const b = before.get(c.id);
    if (!b) {
      added += 1;
      continue;
    }
    if (b.outcome === "pass" && c.outcome === "fail") regressions.push(c);
    else if (b.outcome === "fail" && c.outcome === "pass") fixed.push(c);
    else if (b.outcome === "fail" && c.outcome === "fail") stillFailing.push(c);
    else unchanged += 1;
  }
  for (const b of baseline?.cases || []) if (!now.has(b.id)) vanished.push(b);
  return { regressions, fixed, stillFailing, vanished, unchanged, added };
}

// 只有聚合数字可比时（老脚本不输出用例名）的降级比对：通过数下降 / 失败数上升都算回归
function diffAggregate(nowSum, baseline) {
  const out = { regressions: [], fixed: [], stillFailing: [], vanished: [], unchanged: 0, added: 0 };
  if (!baseline) return out;
  const bp = baseline.passed || 0;
  const bf = baseline.failed || 0;
  if (nowSum.failed > bf) {
    out.regressions.push({
      label: `聚合回归：失败数 ${bf} → ${nowSum.failed}（老脚本只输出总数，无法定位到具体用例；建议迁移到 testkit 用例级输出）`,
      section: "(聚合)",
    });
  }
  if (nowSum.passed < bp) {
    out.regressions.push({
      label: `聚合回归：通过数 ${bp} → ${nowSum.passed}（同上，建议迁移到 testkit）`,
      section: "(聚合)",
    });
  }
  if (nowSum.passed > bp) out.fixed.push({ label: `通过数 ${bp} → ${nowSum.passed}`, section: "(聚合)" });
  if (nowSum.failed === bf && nowSum.passed === bp) out.unchanged = nowSum.total;
  return out;
}

// 该插件历史上「有过非失败结论」的层级集合，用于报告里的层覆盖对照
function coverageGroups(reports, key) {
  const ever = new Set();
  for (const r of reports) {
    if (r.key !== key) continue;
    if (r.verdict === "FAIL") continue;
    ever.add(r.layer);
  }
  return ever;
}

// ---------------------------------------------------------------- 渲染

function fmtLocal(d) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${oh}${om}`;
}

function stampLocal(d) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

function renderReport(rec) {
  const L = [];
  const verdictText = { PASS: "PASS", INCOMPLETE: "INCOMPLETE（不算完成）", FAIL: "FAIL" }[rec.verdict];
  L.push(`# 测试报告 · ${rec.key} ${rec.version} · ${rec.layer}`);
  L.push("");
  L.push(`> **插件闸门结论：${verdictText}** — 本层（${rec.layer}）通过 ${rec.passed} / 失败 ${rec.failed} / 告警 ${rec.warned} / 用例 ${rec.total}；回归 ${rec.regressions.length} 条`);
  L.push(">");
  L.push(`> 本层自身结论：**${rec.layerVerdict}**。闸门结论由该插件本次运行的全部层级合并判定：${rec.coveredLayers.map((l) => "`" + l + "`").join("、")}。`);
  L.push("");
  L.push("## 元信息");
  L.push("");
  L.push(`| 字段 | 值 |`);
  L.push(`| --- | --- |`);
  L.push(`| 报告 ID | \`${rec.id}\` |`);
  L.push(`| 时间 | ${rec.atLocal} |`);
  L.push(`| 插件 | \`${rec.key}@${rec.version}\`${rec.versionInferred ? "（版本为推断值，脚本未写死目标版本）" : ""} |`);
  L.push(`| 层级 | \`${rec.layer}\` — ${rec.layerNote} |`);
  L.push(`| 断言粒度 | ${rec.granularity === "case" ? "用例级（可精确定位回归用例）" : "仅聚合（脚本不输出用例名，回归只能靠总数变化判断）"} |`);
  L.push(`| 测试脚本 | \`${rec.script}\` |`);
  L.push(`| 脚本 sha256 | \`${rec.scriptSha256.slice(0, 16)}…\` |`);
  L.push(`| 被测源码 | \`${rec.pluginPath}\` |`);
  L.push(`| 源码 sha256 | \`${rec.pluginSha256 ? rec.pluginSha256.slice(0, 16) + "…" : "n/a"}\` |`);
  L.push(`| 命令 | \`${rec.command}\` |`);
  L.push(`| 退出码 | ${rec.exitCode}${rec.timedOut ? "（超时被杀）" : ""} |`);
  L.push(`| 耗时 | ${rec.durationMs} ms |`);
  L.push("");
  if (rec.regressions.length || rec.stillFailing.length) {
    L.push("## 阻塞项");
    L.push("");
    for (const c of rec.regressions) L.push(`- **回归** \`${c.section}\` → ${esc(c.label)}（上一份报告通过，本次失败）`);
    for (const c of rec.stillFailing) L.push(`- **仍未修复** \`${c.section}\` → ${esc(c.label)}`);
    L.push("");
  }
  L.push("## 与历史报告比对");
  L.push("");
  if (!rec.baseline) {
    L.push("无历史基线（该插件该层的第一份报告），全部用例计为新增。");
  } else {
    L.push(`- 基线报告：\`${rec.baseline.id}\`（${rec.baseline.version} · ${rec.baseline.verdict} · ${rec.baseline.atLocal}）`);
    L.push(`- 回归：**${rec.regressions.length}** ｜ 已修复：${rec.fixed.length} ｜ 仍失败：${rec.stillFailing.length} ｜ 新增用例：${rec.added} ｜ 未变：${rec.unchanged} ｜ 消失用例：${rec.vanished.length}`);
    if (rec.vanished.length) {
      L.push("");
      L.push("消失用例（基线有、本次没有，通常是测试被改写，需人工确认不是漏测）：");
      for (const c of rec.vanished.slice(0, 20)) L.push(`- ${esc(c.label)}`);
      if (rec.vanished.length > 20) L.push(`- … 其余 ${rec.vanished.length - 20} 条见 index.json`);
    }
  }
  L.push("");
  if (rec.history.length) {
    L.push("### 该插件该层历史（倒排，最新在上）");
    L.push("");
    L.push("| 报告 ID | 时间 | 版本 | 结论 | 通过/失败 | 回归 |");
    L.push("| --- | --- | --- | --- | --- | --- |");
    for (const h of rec.history.slice(0, 15)) {
      L.push(`| \`${h.id}\` | ${h.atLocal} | ${h.version} | ${h.verdict} | ${h.passed}/${h.failed} | ${h.regressions} |`);
    }
    if (rec.history.length > 15) L.push(`| … | | | | | 其余 ${rec.history.length - 15} 份见 index.json |`);
    L.push("");
  }
  L.push("## 层覆盖");
  L.push("");
  L.push(`- 本次已跑层级：${rec.coveredLayers.length ? rec.coveredLayers.map((l) => "`" + l + "`").join("、") : "（无）"}`);
  L.push(`- 该插件历史已验证层级：${rec.everLayers.length ? rec.everLayers.map((l) => "`" + l + "`").join("、") : "（无）"}`);
  L.push(`- 闸门要求：${rec.requiredGroups.map((g) => "`" + g + "`").join("、")}`);
  if (rec.missing.length) {
    L.push("");
    L.push("## 未验证（导致结论不是 PASS）");
    L.push("");
    for (const m of rec.missing) L.push(`- ${m}`);
  }
  if (rec.skipped.length) {
    L.push("");
    L.push("## 跳过");
    L.push("");
    for (const s of rec.skipped) L.push(`- \`${s.script}\`：${s.reason}`);
  }
  L.push("");
  L.push("## 用例明细");
  L.push("");
  if (!rec.cases.length) {
    L.push("该脚本只输出聚合数字（`passed=n failed=m`），无逐条用例可列。");
    L.push("");
    L.push(`聚合：通过 ${rec.passed} ｜ 失败 ${rec.failed} ｜ 合计 ${rec.total}`);
    L.push("");
    L.push("> 迁移到 `.workbuddy-ai/skills/new-api-task-plugin-builder/assets/testkit.mjs` 可拿到用例级输出与精确回归定位。");
  }
  const bySection = new Map();
  for (const c of rec.cases) {
    if (!bySection.has(c.section)) bySection.set(c.section, []);
    bySection.get(c.section).push(c);
  }
  const mark = { pass: "✓", fail: "✗", warn: "⚠" };
  for (const [section, list] of bySection) {
    const f = list.filter((c) => c.outcome === "fail").length;
    L.push(`### ${section}（${list.length} 项${f ? `，${f} 失败` : ""}）`);
    L.push("");
    L.push("| 结果 | 用例 |");
    L.push("| --- | --- |");
    for (const c of list) L.push(`| ${mark[c.outcome]} | ${esc(c.label)} |`);
    L.push("");
  }
  if (rec.stdoutTail) {
    L.push("## 原始输出（尾部）");
    L.push("");
    L.push("```text");
    L.push(rec.stdoutTail.trimEnd());
    L.push("```");
    L.push("");
  }
  if (rec.stderrTail) {
    L.push("## stderr（尾部）");
    L.push("");
    L.push("```text");
    L.push(rec.stderrTail.trimEnd());
    L.push("```");
    L.push("");
  }
  return L.join("\n");
}

const LAYER_NOTE = {
  contract: "离线纯函数合同测试，不联网",
  spec: "用厂商官方规范反向校验，不联网",
  live: "真实上游联调（消耗额度）",
  e2e: "真实端到端（消耗额度）",
};

// ---------------------------------------------------------------- 主流程

async function main() {
  const all = discover();
  if (!all.length) {
    console.error("未找到任何测试脚本。扫描目录：.workbuddy-ai/tests、.workbuddy-ai/tmp-tests");
    process.exit(64);
  }
  const wantLayers = OPT.layers.length
    ? OPT.layers
    : OPT.includeLive
      ? [...OFFLINE_LAYERS, ...REAL_LAYERS]
      : OFFLINE_LAYERS;
  const byKey = all.filter((t) => !OPT.keys.length || OPT.keys.includes(deriveKey(t.name)));
  const selected = byKey.filter((t) => wantLayers.includes(t.layer));
  if (!selected.length) {
    console.error(`没有匹配的测试脚本（--key ${OPT.keys.join(",") || "*"} / --layer ${wantLayers.join(",")}）`);
    process.exit(64);
  }

  const hasLiveCred = Boolean(process.env.LIVE_KEY || process.env.LIVE_BASE);

  // 跳过清单按插件分组并写进报告：「为什么没验真实层」必须一眼可见
  const skippedByKey = new Map();
  const addSkip = (key, script, reason) => {
    if (!skippedByKey.has(key)) skippedByKey.set(key, []);
    skippedByKey.get(key).push({ script, reason });
  };
  const runnable = [];
  for (const t of byKey) {
    const key = deriveKey(t.name);
    const rel = path.relative(ROOT, t.abs);
    if (!wantLayers.includes(t.layer)) {
      if (REAL_LAYERS.includes(t.layer)) addSkip(key, rel, "真实层未开启（需要 --include-live）");
      else addSkip(key, rel, `层级 ${t.layer} 未选中（--layer）`);
      continue;
    }
    if (REAL_LAYERS.includes(t.layer) && !hasLiveCred) {
      addSkip(key, rel, "缺凭据：环境变量 LIVE_KEY / LIVE_BASE 未设置，无法访问真实上游");
      continue;
    }
    runnable.push(t);
  }

  const prior = loadIndex();
  const now = new Date();
  const raw = [];

  for (const t of runnable) {
    const baseKey = deriveKey(t.name);
    const src = fs.readFileSync(t.abs, "utf8");
    const srcTarget = resolveTarget(baseKey, src);
    process.stderr.write(`▶ ${baseKey} [${t.layer}] …\n`);
    const res = await runScript(t.abs, OPT.timeoutMs);
    let { cases, granularity, aggregate, structured } = parseOutput(res.out, res.err);
    // 结构化块里声明的 key/version/layer 是权威值（脚本自己知道在测什么），
    // 文件名与源码正则只是兜底推断。
    const key = structured && structured.key ? String(structured.key) : baseKey;
    const version = structured && structured.version ? String(structured.version) : srcTarget.version;
    const layer = structured && structured.layer ? String(structured.layer) : t.layer;
    const inferred = !(structured && structured.version) && srcTarget.inferred;
    let sum = summarize(cases, aggregate, granularity);
    if (granularity === "aggregate" && sum.total === 0) {
      cases.push({
        id: "__process__",
        label: `进程未产生任何可解析结果（exit=${res.code}${res.timedOut ? "，超时" : ""}）`,
        outcome: "fail",
        section: "(进程级)",
      });
      granularity = "case";
    }
    if (granularity === "case" && res.code !== 0 && sum.failed === 0) {
      cases.push({
        id: "__exit_code__",
        label: `退出码非 0（${res.code}）但用例全通过，检查脚本末尾的 process.exit`,
        outcome: "fail",
        section: "(进程级)",
      });
    }
    sum = summarize(cases, aggregate, granularity);

    const pluginAbs = fs.existsSync(path.join(ROOT, "plugins", "tasks", key, version, "plugin.js"))
      ? path.join(ROOT, "plugins", "tasks", key, version, "plugin.js")
      : null;
    const baseline = pickBaseline(prior.reports, key, layer, version);
    const d = granularity === "case" ? diffCases(cases, baseline) : diffAggregate(sum, baseline);

    raw.push({
      key,
      version,
      versionInferred: inferred,
      layer,
      layerNote: LAYER_NOTE[layer] || "",
      script: path.relative(ROOT, t.abs),
      scriptSha256: sha256(src),
      pluginPath: pluginAbs ? path.relative(ROOT, pluginAbs) : `plugins/tasks/${key}/${version}/plugin.js（不存在）`,
      pluginSha256: pluginAbs ? sha256(fs.readFileSync(pluginAbs)) : null,
      command: `node ${path.relative(ROOT, t.abs)}`,
      exitCode: res.code,
      timedOut: res.timedOut,
      durationMs: res.durationMs,
      ...sum,
      granularity,
      aggregate,
      layerVerdict: sum.failed || d.regressions.length ? "FAIL" : "PASS",
      regressions: d.regressions,
      fixed: d.fixed,
      stillFailing: d.stillFailing,
      vanished: d.vanished,
      unchanged: d.unchanged,
      added: d.added,
      baseline: baseline
        ? { id: baseline.id, version: baseline.version, verdict: baseline.verdict, atLocal: baseline.atLocal }
        : null,
      history: historyFor(prior.reports, key, layer),
      cases,
      stdoutTail: res.out.split(/\r?\n/).slice(-25).join("\n"),
      stderrTail: res.err.split(/\r?\n/).slice(-15).join("\n"),
    });
  }

  // 闸门按「插件」聚合判定，不按单层：同一次运行里该插件跑过的所有层合并计算。
  // 否则 aivideomaker 的 spec 层会因为「没跑 contract」被判 INCOMPLETE，属于误报。
  const gateKeys = [...new Set(raw.map((r) => r.key))];
  const gates = new Map();
  for (const key of gateKeys) {
    const mine = raw.filter((r) => r.key === key);
    const coveredNow = [...new Set(mine.map((r) => r.layer))];
    const everLayers = [...coverageGroups(prior.reports, key)];
    const hasRealScript = all.some((t) => deriveKey(t.name) === key && REAL_LAYERS.includes(t.layer));
    const required = OPT.require || (OPT.offlineOnly ? ["contract"] : Object.keys(REQUIRED_GROUPS));
    const missing = [];
    for (const g of required) {
      const layers = REQUIRED_GROUPS[g] || [g];
      if (layers.some((l) => coveredNow.includes(l))) continue;
      if (g === "real") {
        const sk = skippedByKey.get(key) || [];
        const why = sk.some((s) => s.reason.includes("缺凭据"))
          ? "缺凭据（LIVE_KEY / LIVE_BASE）"
          : !hasRealScript
            ? "该插件还没有真实层脚本（按 skill 的 live-harness 新建 <key>.live.mjs）"
            : "真实层未开启（--include-live）";
        missing.push(`真实端到端层未覆盖：${why} → 离线全绿只证明「函数对」，证明不了「上游认」`);
      } else {
        missing.push(`离线层 \`${g}\` 未覆盖`);
      }
    }
    const anyFail = mine.some((r) => r.layerVerdict === "FAIL");
    gates.set(key, {
      gate: anyFail ? "FAIL" : missing.length ? "INCOMPLETE" : "PASS",
      coveredNow,
      everLayers,
      missing,
      skipped: skippedByKey.get(key) || [],
      required,
    });
  }

  const runs = raw.map((r) => {
    const g = gates.get(r.key);
    return {
      ...r,
      id: "",
      at: now.toISOString(),
      atLocal: fmtLocal(now),
      verdict: g.gate,
      missing: g.missing,
      skipped: g.skipped,
      coveredLayers: g.coveredNow,
      everLayers: g.everLayers,
      requiredGroups: g.required,
    };
  });

  // 写报告 + 重建索引
  const stamp = stampLocal(now);
  for (const rec of runs) {
    const dir = path.join(REPORTS_DIR, rec.key);
    fs.mkdirSync(dir, { recursive: true });
    let base = `${stamp}-${rec.key}-${rec.version}-${rec.layer}`;
    let n = 2;
    while (fs.existsSync(path.join(dir, base + ".md"))) base = `${stamp}-${rec.key}-${rec.version}-${rec.layer}-${n++}`;
    rec.id = base;
    rec.file = `${rec.key}/${base}.md`;
    if (OPT.write) fs.writeFileSync(path.join(dir, base + ".md"), renderReport(rec) + "\n");
  }

  // 索引自愈：报告文件已不在磁盘上的历史条目直接剔除，避免索引指向幽灵报告
  const priorAlive = prior.reports.filter((p) => p.file && fs.existsSync(path.join(REPORTS_DIR, p.file)));
  const pruned = prior.reports.length - priorAlive.length;
  const merged = [
    ...runs.map((r) => stripHeavy(r)),
    ...priorAlive.filter((p) => !runs.some((r) => r.id === p.id)),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // 倒排：最新在最上

  if (OPT.write) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(INDEX_JSON, JSON.stringify({ schema: SCHEMA, generatedAt: now.toISOString(), reports: merged }, null, 2) + "\n");
    fs.writeFileSync(INDEX_MD, renderIndex(merged) + "\n");
    fs.writeFileSync(LATEST_MD, renderLatest(merged, runs) + "\n");
    rebuildPerKeyLatest(merged);
  }

  // 汇总
  const worst = runs.some((r) => r.verdict === "FAIL")
    ? "FAIL"
    : runs.some((r) => r.verdict === "INCOMPLETE")
      ? "INCOMPLETE"
      : "PASS";
  console.log("");
  console.log(`闸门结论：${worst}`);
  for (const key of gateKeys) {
    const g = gates.get(key);
    const mine = runs.filter((r) => r.key === key);
    const version = mine[0].version;
    console.log(
      `  ${g.gate.padEnd(11)} ${key}@${version}  层[${g.coveredNow.join(",")}]  通过 ${mine.reduce((a, r) => a + r.passed, 0)}/${mine.reduce((a, r) => a + r.total, 0)}  失败 ${mine.reduce((a, r) => a + r.failed, 0)}  回归 ${mine.reduce((a, r) => a + r.regressions.length, 0)}`,
    );
    for (const m of mine) console.log(`              报告 ${m.file}`);
    for (const m of g.missing) console.log(`              ! ${m}`);
  }
  const allSkipped = [...skippedByKey.values()].flat();
  if (allSkipped.length) for (const s of allSkipped) console.log(`  跳过        ${s.script}：${s.reason}`);
  if (OPT.write) console.log(`\n最新报告：${path.relative(ROOT, LATEST_MD)} ｜ 倒排索引：${path.relative(ROOT, INDEX_MD)}`);
  if (pruned) console.log(`索引自愈：剔除 ${pruned} 条报告文件已不存在的历史条目`);
  if (OPT.json) console.log("\n" + JSON.stringify({ verdict: worst, reports: runs.map(stripHeavy) }, null, 2));

  const code = worst === "FAIL" ? 1 : worst === "INCOMPLETE" ? (OPT.allowIncomplete ? 0 : 2) : 0;
  process.exit(code);
}

// index.json 里保留完整 cases（供回归比对），但打印用的摘要去掉大字段
function stripHeavy(r) {
  return {
    id: r.id,
    at: r.at,
    atLocal: r.atLocal,
    key: r.key,
    version: r.version,
    versionInferred: r.versionInferred,
    layer: r.layer,
    script: r.script,
    scriptSha256: r.scriptSha256,
    pluginPath: r.pluginPath,
    pluginSha256: r.pluginSha256,
    command: r.command,
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    durationMs: r.durationMs,
    verdict: r.verdict,
    layerVerdict: r.layerVerdict,
    granularity: r.granularity,
    aggregate: r.aggregate,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    warned: r.warned,
    regressions: (r.regressions || []).length,
    regressionCases: (r.regressions || []).map((c) => c.label),
    fixed: (r.fixed || []).length,
    stillFailing: (r.stillFailing || []).length,
    vanished: (r.vanished || []).length,
    added: r.added,
    unchanged: r.unchanged,
    baseline: r.baseline,
    coveredLayers: r.coveredLayers,
    everLayers: r.everLayers,
    requiredGroups: r.requiredGroups,
    missing: r.missing,
    file: r.file,
    cases: r.cases,
  };
}

function renderIndex(reports) {
  const L = [];
  L.push("# 测试报告倒排索引");
  L.push("");
  L.push("> 本文件由 `.workbuddy-ai/tools/test-runner.mjs` 生成，请勿手工编辑。");
  L.push("> 按时间**倒排**（最新在最上）。取最新报告优先读 `LATEST.md` 或 `index.json` 的 `reports[0]`。");
  L.push("");
  const counts = { PASS: 0, INCOMPLETE: 0, FAIL: 0 };
  for (const r of reports) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  L.push(`共 ${reports.length} 份报告 — PASS ${counts.PASS || 0} ｜ INCOMPLETE ${counts.INCOMPLETE || 0} ｜ FAIL ${counts.FAIL || 0}`);
  L.push("");
  L.push("| # | 时间 | 插件 | 版本 | 层级 | 结论 | 通过/失败 | 回归 | 报告 |");
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  reports.forEach((r, i) => {
    L.push(`| ${i + 1} | ${r.atLocal} | \`${r.key}\` | ${r.version} | ${r.layer} | **${r.verdict}** | ${r.passed}/${r.failed} | ${r.regressions} | [${r.id}](${encodeURI(r.file)}) |`);
  });
  L.push("");
  L.push("## 各插件最新一份（按层）");
  L.push("");
  L.push("| 插件 | 层级 | 最新报告 | 时间 | 插件闸门 | 本层 | 被测源码 sha256 |");
  L.push("| --- | --- | --- | --- | --- | --- | --- |");
  const seen = new Set();
  for (const r of reports) {
    const k = `${r.key}|${r.layer}`;
    if (seen.has(k)) continue;
    seen.add(k);
    L.push(`| \`${r.key}\` | ${r.layer} | [${r.id}](${encodeURI(r.file)}) | ${r.atLocal} | **${r.verdict}** | ${r.layerVerdict || "-"} | \`${(r.pluginSha256 || "n/a").slice(0, 12)}\` |`);
  }
  L.push("");
  return L.join("\n");
}

function renderLatest(reports, runs) {
  const L = [];
  L.push("# 最新测试报告");
  L.push("");
  L.push("> 由 test-runner 生成，按插件分组取**最新一份**。逐用例全文见各插件目录下的报告文件。");
  L.push("");
  L.push(`生成时间：${fmtLocal(new Date())}`);
  L.push("");
  for (const r of runs) {
    L.push(`## ${r.key} @ ${r.version} · ${r.layer} — ${r.verdict}`);
    L.push("");
    L.push(`- 报告：\`${r.file}\` ｜ 时间 ${r.atLocal}`);
    L.push(`- 通过 ${r.passed}/${r.total} ｜ 失败 ${r.failed} ｜ 告警 ${r.warned} ｜ 回归 ${r.regressions.length}`);
    L.push(`- 被测源码：\`${r.pluginPath}\`（sha256 \`${(r.pluginSha256 || "n/a").slice(0, 16)}…\`）`);
    if (r.missing.length) L.push(`- **未验证**：${r.missing.join("；")}`);
    if (r.regressions.length) for (const c of r.regressions) L.push(`- **回归**：${c.label}`);
    L.push("");
  }
  L.push("## 全部插件最新状态（倒排）");
  L.push("");
  L.push("| 插件 | 层级 | 时间 | 结论 | 通过/失败 | 回归 | 报告 |");
  L.push("| --- | --- | --- | --- | --- | --- | --- |");
  const seen = new Set();
  for (const r of reports) {
    const k = `${r.key}|${r.layer}`;
    if (seen.has(k)) continue;
    seen.add(k);
    L.push(`| \`${r.key}\` | ${r.layer} | ${r.atLocal} | **${r.verdict}** | ${r.passed}/${r.failed} | ${r.regressions} | [${r.id}](${encodeURI(r.file)}) |`);
  }
  L.push("");
  return L.join("\n");
}

function rebuildPerKeyLatest(reports) {
  const keys = new Set(reports.map((r) => r.key));
  for (const key of keys) {
    const dir = path.join(REPORTS_DIR, key);
    if (!fs.existsSync(dir)) continue;
    const list = reports.filter((r) => r.key === key);
    // 每层各留一份全文
    const layers = [...new Set(list.map((r) => r.layer))];
    for (const layer of layers) {
      const newest = list.find((r) => r.layer === layer);
      if (!newest) continue;
      const src = path.join(REPORTS_DIR, newest.file);
      if (!fs.existsSync(src)) continue;
      fs.writeFileSync(
        path.join(dir, `LATEST-${layer}.md`),
        `<!-- 自动生成：${layer} 层最新报告副本，原文 ${newest.file} -->\n\n` + fs.readFileSync(src, "utf8"),
      );
    }
    const newestAny = list[0];
    const src = path.join(REPORTS_DIR, newestAny.file);
    if (fs.existsSync(src)) {
      const lines = layers
        .map((l) => {
          const n = list.find((r) => r.layer === l);
          return `- ${l}：\`${n.id}\`（${n.verdict}，${n.atLocal}）→ \`LATEST-${l}.md\``;
        })
        .join("\n");
      fs.writeFileSync(
        path.join(dir, "LATEST.md"),
        `# ${key} 最新测试报告\n\n> 自动生成，勿手改。各层最新：\n${lines}\n\n---\n\n` + fs.readFileSync(src, "utf8"),
      );
    }
  }
}

main().catch((e) => {
  console.error("test-runner 内部错误：", e);
  process.exit(70);
});
