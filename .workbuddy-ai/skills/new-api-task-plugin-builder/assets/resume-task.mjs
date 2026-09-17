// 续查已有任务（跨插件通用模板）：不重新提交、不重复扣费，接着轮询一个已存在的 task id。
//
// 为什么需要它：live-harness 只能「提交 → 轮询」一次性跑完，没有「只查已存在的任务」的入口。
// 当 --poll-max 用尽而任务还在跑（有些上游模型的完成时延是其他模型的十倍）时，唯一不重复扣费的
// 办法就是接着查同一个 task id —— 重新提交等于再付一次钱。
//
// 用法：
//   LIVE_KEY='ak_xxx' node resume-task.mjs <plugin.js 路径> <task_id> [model] [下载路径]
// 例：
//   LIVE_KEY='ak_xxx' node resume-task.mjs \
//     ../../plugins/tasks/aivideomaker/1.0.1/plugin.js cmu4cuvrl000az9uy2imvqsck i2v_v3 /tmp/out.mp4
//
// 它同时是一份「终态 render 形状」的真实取样器：任务完成后会用插件自己的 render hook 渲染一遍，
// 拿真实上游响应验证入站契约（这是离线测试做不到的）。
//
// 通用性来自插件的两个 hook：buildQueryRequest / parseTaskResult 都是标准合同，
// 模板不假设任何厂商字段。ctx 只放最小字段（apiKey/baseUrl/model/taskId），
// 若某插件还需要别的 ctx 字段（userId 等），按 --dry-run 报错补进 CTX_EXTRA。

import fs from "node:fs";
import path from "node:path";

const PLUGIN_PATH = process.argv[2];
const TASK_ID = process.argv[3];
const MODEL = process.argv[4] || "";
const OUT = process.argv[5] || "";

if (!PLUGIN_PATH || !TASK_ID) {
  console.error(
    "用法: LIVE_KEY=... node resume-task.mjs <plugin.js 路径> <task_id> [model] [下载路径]",
  );
  process.exit(2);
}
const apiKey = process.env.LIVE_KEY;
if (!apiKey) {
  console.error("LIVE_KEY 未设置（凭据只走环境变量，不要写进文件）");
  process.exit(2);
}

const abs = path.resolve(PLUGIN_PATH);
const plugin = await import(abs);
const BASE = process.env.LIVE_BASE || "";

// 有的插件需要额外 ctx 字段（如网页会话类需要 userId）。用 CTX_EXTRA 传 JSON。
const CTX_EXTRA = process.env.CTX_EXTRA ? JSON.parse(process.env.CTX_EXTRA) : {};
const ctx = Object.assign(
  {
    apiKey: apiKey,
    baseUrl: BASE,
    upstreamModel: MODEL,
    model: MODEL,
    taskId: TASK_ID,
    task_id: TASK_ID,
  },
  CTX_EXTRA,
);

const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 30000);
const POLL_MAX = Number(process.env.POLL_MAX || 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const missing = ["buildQueryRequest", "parseTaskResult"].filter(
  (h) => typeof plugin[h] !== "function",
);
if (missing.length) {
  console.error("插件缺少必备 hook: " + missing.join(", "));
  process.exit(2);
}

console.log("plugin=" + abs + " taskId=" + TASK_ID + " model=" + (MODEL || "(默认)"));
console.log("base=" + (BASE || "(插件默认)") + " 轮询 " + POLL_INTERVAL + "ms × " + POLL_MAX);

let parsed = null;
let body = null;
let terminal = false;
for (let i = 1; i <= POLL_MAX; i += 1) {
  const query = plugin.buildQueryRequest(ctx);
  const res = await fetch(query.url, { method: query.method, headers: query.headers });
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch (_e) {
    body = text;
  }
  try {
    parsed = plugin.parseTaskResult(ctx, body, { status: res.status });
  } catch (err) {
    // 传输层错误（408/429/5xx）按设计抛错让宿主重试，这里也继续重试而不是判失败。
    console.log("poll#" + i + " 传输错误（继续重试）: " + err.message);
    await sleep(POLL_INTERVAL);
    continue;
  }
  console.log(
    "poll#" + i + " http=" + res.status + " -> " + parsed.status + " " + (parsed.progress || ""),
  );
  if (parsed.status === "SUCCESS" || parsed.status === "FAILURE") {
    terminal = true;
    break;
  }
  await sleep(POLL_INTERVAL);
}
if (!terminal) {
  console.log("\n轮询次数用尽仍是 " + (parsed && parsed.status) + "。");
  console.log("先直连上游把该任务的原始 status 打出来确认它是否真的还在跑（不是映射漏枚举），");
  console.log("确认还在跑就加大 POLL_MAX 再跑一次，不要重新提交（会重复扣费）。");
}

// 宿主 task 记录形状：{ task_id, model, status, progress, data: <上游原始记录> }
const task = Object.assign({ task_id: TASK_ID, model: MODEL }, parsed || {});

const queryRoute = (plugin.meta && plugin.meta.routes ? plugin.meta.routes : []).find(
  (r) => r.type === "query",
);
if (queryRoute && plugin.native && typeof plugin.native[queryRoute.render] === "function") {
  console.log("\n=== 入站 render（" + queryRoute.render + "）真实终态形状 ===");
  console.log(JSON.stringify(plugin.native[queryRoute.render](ctx, task), null, 2));
}

if (typeof plugin.listArtifacts === "function") {
  console.log("\n=== listArtifacts ===");
  console.log(JSON.stringify(plugin.listArtifacts(task), null, 2));
}

if (typeof plugin.extractUsageOnComplete === "function") {
  console.log("\n=== extractUsageOnComplete ===");
  try {
    console.log(JSON.stringify(plugin.extractUsageOnComplete(task, parsed, body)));
  } catch (err) {
    console.log("抛错: " + err.message);
  }
}

console.log("\n=== 上游原始记录 ===");
console.log(JSON.stringify(parsed && parsed.data));

if (OUT) {
  const artifacts =
    typeof plugin.listArtifacts === "function" ? plugin.listArtifacts(task) || [] : [];
  const first = artifacts[0];
  const url =
    first && (first.url || first.src)
      ? first.url || first.src
      : parsed && parsed.data && parsed.data.output && parsed.data.output.url;
  if (!url) {
    console.log("\n没有可回源的制品 URL，跳过下载");
  } else {
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(OUT, buf);
    console.log("\n已下载 " + OUT + " (" + buf.length + " bytes)");
    console.log("用 media-probe.py 核对真实时长/分辨率/音轨，别只看状态码。");
  }
}
