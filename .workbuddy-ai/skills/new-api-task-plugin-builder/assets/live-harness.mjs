// 真实端到端联调脚手架（跨插件通用模板，不绑定任何具体厂商）
//
// 复制后只改下面 CONFIG 三行，其余通用：
//   cp .../assets/live-harness.mjs .workbuddy-ai/tmp-tests/<key>.live.mjs
//
// 首选通用入口 --raw：直接给入站 body，跨插件语义由插件自己的 decoder 解释，模板不做任何厂商假设。
//   LIVE_KEY='ak_xxx' node <key>.live.mjs --raw '{"model":"m","prompt":"..."}' --download out.bin
//
// --prompt / --image 只是多媒体类任务的便利快捷方式，拼装规则是「常见约定」而非通用契约；
// 不同插件入站字段可能叫 prompt/text/input、image/images/image_url，拿不准就用 --raw。
//   LIVE_KEY='{"cookie":"...","userId":"..."}' node <key>.live.mjs --prompt "..." --image https://.../a.jpg
//
// 覆盖 Base URL：LIVE_BASE=https://other.example.com
// 覆盖模型：     --model vendor_model
// 切换入口：     --entry native|openai（默认 openai）
//   native 入口的 decode 成员名自动从 meta.routes 的 submit 路由读取，
//   不需要因为插件把成员命名成 createTask / create3D 而改模板。
//
// 流程：decode → submit → poll → usage → artifacts → 回源下载 → render
// 制品 key、结果字段一律从插件自身 listArtifacts / parseTaskResult 推导，模板不硬编码 "video" 等具体 key。
// 注意：会真实消耗上游额度/积分。

const PLUGIN_PATH = "../../plugins/tasks/<key>/<semver>/plugin.js"; // ← 改
const DEFAULT_BASE = "https://<upstream-host>";                     // ← 改
const DEFAULT_MODEL = "<upstream_model>";                            // ← 改

import fs from "node:fs";

// testkit 的路径在两种位置都成立：复制到 .workbuddy-ai/tmp-tests/ 后走 ../skills/...；
// 万一在 assets/ 原地跑则回退到同目录。
const testkit = await import(
  new URL("../skills/new-api-task-plugin-builder/assets/testkit.mjs", import.meta.url).href
).catch(() => import("./testkit.mjs"));
const createSuite = testkit.createSuite;

// ---------- 参数 ----------
function parseArgs(argv) {
  const args = {
    raw: "",
    prompt: "",
    images: [],
    model: DEFAULT_MODEL,
    pollInterval: 15000,
    pollMax: 40,
    download: "",
    entry: "openai",
    artifact: "",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--dry-run") {
      args.dryRun = true;
      continue; // 布尔标志，不吞后面的参数
    }
    if (flag === "--raw") args.raw = next;
    else if (flag === "--prompt") args.prompt = next;
    else if (flag === "--image") args.images.push(next);
    else if (flag === "--model") args.model = next;
    else if (flag === "--poll-interval") args.pollInterval = Number(next);
    else if (flag === "--poll-max") args.pollMax = Number(next);
    else if (flag === "--download") args.download = next;
    else if (flag === "--entry") args.entry = next;
    else if (flag === "--artifact") args.artifact = next;
    else if (String(flag).indexOf("--") !== 0) continue;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.LIVE_KEY;

// ---------- 用例级结果 ----------
// 闸门 test-runner 会解析结构化结果块。关键点：**失败必须记成失败用例再退出**，
// 不能只 process.exit(1) —— 静默退出会被解析成「零用例、零失败」，闸门据此判 PASS，
// 等于真实层根本没被守住。所以下面所有失败分支都走 fail()。
const suiteIdentity = (function () {
  const m = /plugins\/tasks\/([^/]+)\/(\d+\.\d+\.\d+)\//.exec(String(PLUGIN_PATH));
  return { key: m ? m[1] : "unknown", version: m ? m[2] : "unknown" };
})();
const t = createSuite({ key: suiteIdentity.key, version: suiteIdentity.version, layer: "live" });

function fail(label, detail) {
  t.ok(false, label, detail);
  t.done();
}

function mask(secret) {
  const s = String(secret || "");
  if (s.length <= 8) return "***(" + s.length + ")";
  return s.slice(0, 3) + "***" + s.slice(-2) + "(" + s.length + ")";
}

if (!apiKey) {
  console.log(
    "需要真实凭据：\n" +
      "  LIVE_KEY='ak_xxx'                                  # api key / token\n" +
      "  LIVE_KEY='{\"cookie\":\"...\",\"userId\":\"...\"}'  # 网页会话类\n" +
      "可选：LIVE_BASE=" +
      DEFAULT_BASE +
      "（覆盖 Base URL）",
  );
  process.exit(0);
}

const BASE = process.env.LIVE_BASE || DEFAULT_BASE;
console.log("base=" + BASE + " key=" + mask(apiKey) + " model=" + args.model);

// ---------- 加载插件（放在凭据检查之后，路径错时也能看到用法提示） ----------
let plugin;
try {
  plugin = await import(new URL(PLUGIN_PATH, import.meta.url).href);
} catch (err) {
  console.error(
    "\n加载插件失败：请先确认本文件已复制到 .workbuddy-ai/tmp-tests/ 且头部 PLUGIN_PATH 已改成真实路径。\n" +
      "  PLUGIN_PATH=" +
      PLUGIN_PATH +
      "\n  " +
      err.message,
  );
  fail("加载插件", "PLUGIN_PATH=" + PLUGIN_PATH + " → " + err.message);
}

const ctx = { apiKey: apiKey, baseUrl: BASE, upstreamModel: args.model, model: args.model };

// ---------- 入站 body ----------
let inbound;
if (args.raw) {
  try {
    inbound = JSON.parse(args.raw);
  } catch (_err) {
    console.error("--raw 不是合法 JSON");
    fail("解析 --raw 入站 body", "--raw 不是合法 JSON");
  }
} else {
  inbound = { model: args.model, prompt: args.prompt };
  // 常见约定用 images 数组（单个 image 字段多数 decoder 不认，会静默丢图）。
  // 这只是便利拼装，不是通用契约；插件若用 image_url 等别的字段名，请用 --raw 自己给 body。
  if (args.images.length) inbound.images = args.images;
}
inbound.model = inbound.model || args.model;

// ---------- 1) decode（与线上客户端同一条入口） ----------
// 原生入口的 decode 成员名从 meta.routes 里那条 submit 路由读，不写死 native.submit——
// 真实插件普遍按路由语义命名（native.createTask / native.textVideoV3 / native.create3D）。
// 该成员返回的是宿主 canonical intent（{kind, model, action, requestBody}），
// 不是请求对象；请求一律由 buildSubmitRequest 从 ctx.requestBody 构建。
function nativeSubmitDecode() {
  const routes = (plugin.meta && plugin.meta.routes) || [];
  const route = routes.find(function (item) {
    return item && item.type === "submit" && item.decode;
  });
  return (route && route.decode) || "submit";
}

if (args.entry === "native") {
  const decodeName = nativeSubmitDecode();
  if (!plugin.native || typeof plugin.native[decodeName] !== "function") {
    fail("native 入口 decode 成员存在", "该插件未导出 native." + decodeName + "（由 meta.routes 的 submit 路由 decode 推导）");
  }
  ctx.body = { kind: "json", value: inbound };
  const intent = plugin.native[decodeName](ctx);
  if (!intent || !intent.requestBody) {
    fail("native decode 返回 canonical intent", "native." + decodeName + " 未返回 requestBody");
  }
  ctx.requestBody = intent.requestBody;
  console.log(
    "decode=native." +
      decodeName +
      " action=" +
      intent.action +
      " adapterMode=" +
      (intent.requestBody || {}).adapterMode,
  );
  t.ok(true, "native decode 成功（native." + decodeName + "）");
} else {
  const decoder = plugin.protocols && plugin.protocols.openai_responses && plugin.protocols.openai_responses.decodeRequest;
  if (!decoder) {
    fail("openai_responses decodeRequest 存在", "该插件无 openai_responses.decodeRequest；用 --entry native，或手工构造 ctx.requestBody 后运行");
  }
  const decoded = decoder({ body: { kind: "json", value: inbound } });
  ctx.requestBody = decoded.requestBody;
  console.log("action=" + decoded.action + " adapterMode=" + (decoded.requestBody || {}).adapterMode);
  t.ok(true, "协议 decode 成功（openai_responses）");
}
if (plugin.extractUsage) console.log("usage(submit)=" + JSON.stringify(plugin.extractUsage(ctx)));

// ---------- 素材预检（仅当传了 --image 时执行；纯文本/音频类插件不会走到这里） ----------
// 上游常见坑：体积超限、扩展名与实际格式不符（.jpg 实为 PNG）被严格校验的上游拒收。
for (const url of args.images) {
  const head = await fetch(url, { method: "GET", headers: { Range: "bytes=0-31" } });
  const buffer = Buffer.from(await head.arrayBuffer());
  const isPng = buffer.length > 3 && buffer[0] === 0x89 && buffer[1] === 0x50;
  const isJpeg = buffer.length > 1 && buffer[0] === 0xff && buffer[1] === 0xd8;
  const size = Number((head.headers.get("content-range") || "").split("/")[1] || head.headers.get("content-length") || 0);
  console.log(
    "image: " +
      url +
      "\n  http=" +
      head.status +
      " type=" +
      (head.headers.get("content-type") || "-") +
      " size=" +
      (size / 1024).toFixed(1) +
      "KB 实际格式=" +
      (isPng ? "PNG" : isJpeg ? "JPEG" : "未知"),
  );
  if (isPng && /\.jpe?g(\?|$)/i.test(url)) console.log("  ! 扩展名 .jpg 但内容是 PNG，严格校验的上游可能拒收");
  if (size > 5 * 1024 * 1024) console.log("  ! 超过 5MB，建议先压缩");
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function request(req) {
  const response = await fetch(req.url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : JSON.stringify(req.body) });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (_err) {
    /* 保持字符串，便于看上游原文 */
  }
  return { status: response.status, body: body };
}

// ---------- 2) 提交 ----------
if (typeof plugin.buildSubmitRequest !== "function") {
  fail("buildSubmitRequest 存在", "该插件未导出 buildSubmitRequest，无法构建上游请求");
}
const submitReq = plugin.buildSubmitRequest(ctx);

// dry-run：不联网、不消耗额度，只确认 hook 链齐全且请求拼装正确
if (args.dryRun) {
  const headers = {};
  for (const name of Object.keys(submitReq.headers || {})) {
    headers[name] = String(submitReq.headers[name]).indexOf(String(apiKey)) >= 0 ? "***(redacted)" : submitReq.headers[name];
  }
  console.log("\n[dry-run] 不发起请求，只检查拼装：");
  console.log("  " + submitReq.method + " " + submitReq.url);
  console.log("  headers=" + JSON.stringify(headers));
  console.log("  body=" + JSON.stringify(submitReq.body));
  t.section("dry-run 拼装");
  t.ok(!!submitReq.url && !!submitReq.method, "上游请求有 method + url");
  const missingHooks = ["parseSubmitResponse", "buildQueryRequest", "parseTaskResult"].filter(
    (hook) => typeof plugin[hook] !== "function",
  );
  t.ok(missingHooks.length === 0, "必备 hook 齐全", "缺少: " + missingHooks.join(", "));
  t.warn("dry-run 不联网", "本次未提交真实任务，只证明拼装正确");
  t.done();
  // done() 只在有失败时退出，dry-run 必须自己收尾，否则会继续往下真的提交任务（烧额度）。
  process.exit(0);
}

console.log("\nsubmit: " + submitReq.method + " " + submitReq.url);
const submit = await request(submitReq);
console.log("submit http=" + submit.status + " body=" + JSON.stringify(submit.body).slice(0, 600));

let submitted;
try {
  submitted = plugin.parseSubmitResponse(ctx, submit);
} catch (err) {
  console.error("\n提交失败: " + err.message + "\n上游原文: " + JSON.stringify(submit.body).slice(0, 600));
  fail("提交上游被接受", "http=" + submit.status + " " + err.message + " 上游原文: " + JSON.stringify(submit.body).slice(0, 300));
}
const taskId = submitted.taskId;
console.log("taskId=" + taskId);
t.section("真实端到端");
t.ok(!!taskId, "提交拿到上游 task id");

// ---------- 3) 轮询到终态 ----------
let result = null;
let lastBody = null;
for (let i = 1; i <= args.pollMax; i += 1) {
  const qctx = Object.assign({}, ctx, { taskId: taskId, task_id: taskId });
  const query = plugin.buildQueryRequest(qctx);
  const response = await fetch(query.url, { method: query.method, headers: query.headers });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (_err) {
    /* 保持字符串 */
  }
  lastBody = body;
  let parsed;
  try {
    parsed = plugin.parseTaskResult(qctx, body, { status: response.status });
  } catch (err) {
    console.log("poll #" + i + " http=" + response.status + " 传输错误: " + err.message + "（继续重试）");
    await sleep(args.pollInterval);
    continue;
  }
  result = parsed;
  console.log("poll #" + i + " http=" + response.status + " -> " + parsed.status + (parsed.progress ? " " + parsed.progress : ""));
  if (parsed.status === "SUCCESS" || parsed.status === "FAILURE") break;
  await sleep(args.pollInterval);
}

if (!result) {
  console.error("\n轮询未拿到终态，最后上游原文: " + JSON.stringify(lastBody).slice(0, 600));
  fail("轮询拿到终态", "轮询 " + args.pollMax + " 次仍未终态，最后上游原文: " + JSON.stringify(lastBody).slice(0, 300));
}
if (result.status === "FAILURE") {
  console.error("\n任务失败: " + (result.reason || "unknown") + "\n上游原文: " + JSON.stringify(lastBody).slice(0, 600));
  fail("任务终态为 SUCCESS", "任务失败: " + (result.reason || "unknown"));
}
if (result.status !== "SUCCESS") {
  console.error("\n超出轮询次数，最后状态: " + result.status + "（注意：可能是状态映射漏了，也可能任务还在跑）");
  fail("任务终态为 SUCCESS", "轮询结束仍是 " + result.status + "（可能是状态映射漏枚举，也可能任务还在跑）");
}
t.ok(true, "轮询走到终态 SUCCESS");

// ---------- 4) 结果、用量、制品、回源 ----------
console.log("\nresult url=" + (result.url || "-"));
if (plugin.extractUsageOnComplete) {
  console.log("usage(onComplete)=" + JSON.stringify(plugin.extractUsageOnComplete({ taskId: taskId, task_id: taskId }, result, lastBody)));
}

const task = { status: result.status, url: result.url, data: lastBody, task_id: taskId, taskId: taskId };

// 制品 key 一律从插件自身的 listArtifacts 推导，不假设 "video"/"audio"/"image"
const artifacts = plugin.listArtifacts ? plugin.listArtifacts(task) || [] : [];
console.log("artifacts=" + JSON.stringify(artifacts));
// 制品条目不一定自带 url（有的插件只在条目里给 key/type/mimeType，url 要从任务结果取），
// 所以 key 只看有没有 key，url 一律回退到 result.url，不能因为缺 url 就认为没有制品。
const fallbackUrl = result.url || task.url || "";
const artifactMap = {};
for (const item of artifacts) {
  if (item && item.key) artifactMap[item.key] = { url: item.url || fallbackUrl };
}
const firstArtifact = artifacts.find(function (item) {
  return item && item.key;
});
const artifactKey = args.artifact || (firstArtifact ? firstArtifact.key : "");
console.log("artifactKey=" + (artifactKey || "-（无制品，纯文本类任务可忽略）"));

// 结果 URL：媒体类必须有，纯文本类可能没有 —— 后者记告警而不是失败
if (result.url) {
  t.ok(/^https?:\/\//.test(result.url), "终态给出可访问的结果 URL", result.url);
} else {
  t.warn("终态没有结果 URL", "纯文本类任务属正常；媒体类要查 parseTaskResult 的结果字段提取");
}

if (artifacts.length) {
  t.ok(true, "listArtifacts 返回制品（" + artifacts.length + " 个）");
} else {
  t.warn("listArtifacts 返回空", "纯文本类任务属正常；媒体类要查制品提取是否依赖了错误的字段");
}

if (artifactKey && plugin.buildContentRequest) {
  const target = artifactMap[artifactKey] || { url: fallbackUrl };
  const content = plugin.buildContentRequest({ artifactKey: artifactKey, url: target.url, data: task.data, clientRequest: { method: "GET" } });
  console.log("content request url=" + content.url + " credentialless=" + content.credentialless);
  t.ok(content.credentialless === true, "回源请求 credentialless（不携带渠道鉴权）");
  if (args.download) {
    const media = await fetch(content.url, { method: content.method || "GET", headers: content.headers });
    const buf = Buffer.from(await media.arrayBuffer());
    fs.writeFileSync(args.download, buf);
    console.log("downloaded -> " + args.download + " (" + media.status + ", " + buf.length + " bytes, " + (media.headers.get("content-type") || "-") + ")");
    t.ok(media.status === 200 && buf.length > 0, "回源下载落盘", "http=" + media.status + " bytes=" + buf.length);
  }
} else if (!artifactKey) {
  t.warn("没有可回源的制品", "listArtifacts 为空且未指定 --artifact，跳过回源下载");
}

const renderer = plugin.protocols && plugin.protocols.openai_responses && plugin.protocols.openai_responses.renderFinal;
if (renderer) {
  // artifacts 用插件自己列出的 key 构造，不写死 video
  console.log("renderFinal=" + JSON.stringify(renderer({ url: result.url, artifacts: artifactMap })).slice(0, 400));
}

console.log("\n端到端通过：提交→轮询→终态→制品→回源 全链路 OK");
t.done();
