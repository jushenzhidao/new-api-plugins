// aivideomaker 合同测试（纯函数，无网络）
//
// 版本目录自动发现：不硬编码 semver，始终测 plugins/tasks/aivideomaker/ 下最大的版本目录，
// 避免「新 patch 已发布、测试仍指向旧版本」的假绿（同时保留 meta.version 必须与目录一致的检查）。
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";

const ROOT = new URL("../../plugins/tasks/aivideomaker/", import.meta.url);

function cmpSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

const VERSIONS = readdirSync(ROOT)
  .filter(function (name) {
    return /^\d+\.\d+\.\d+$/.test(name);
  })
  .sort(cmpSemver);
const LATEST = VERSIONS[VERSIONS.length - 1];
const SOURCE_PATH = new URL(LATEST + "/plugin.js", ROOT);
const plugin = await import(SOURCE_PATH.href);

let passed = 0;
let failed = 0;
// 用例级输出：test-runner 解析 `✓/✗ label` 生成报告并做跨版本回归比对，勿删。
function mark(kind, name) { console.log("  " + kind + " " + name); }
function ok(cond, name) {
  if (cond) { passed += 1; mark("✓", name); }
  else {
    failed += 1;
    mark("✗", name);
    console.error("FAIL: " + name);
  }
}
function throws(fn, name, expectFragment) {
  try {
    fn();
    failed += 1;
    mark("✗", name);
    console.error("FAIL (no throw): " + name);
  } catch (e) {
    if (expectFragment && String(e.message).indexOf(expectFragment) < 0) {
      failed += 1;
      mark("✗", name);
      console.error("FAIL (wrong message): " + name + " -> " + e.message);
    } else { passed += 1; mark("✓", name); }
  }
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const meta = plugin.meta;
const API_KEY = "ak_test_key";
const WEB_KEY = JSON.stringify({ cookie: "sid=abc", userId: "u-1" });
const BASE = "https://aivideomaker.ai";

// ---- meta / 仓库约定 ----
ok(meta.author && meta.author.name === "Jushenzhidao", "author = Jushenzhidao");
ok(Array.isArray(meta.channelTypes) && meta.channelTypes[0] === 10009, "channelTypes = [10009]");
ok(meta.version === LATEST, "version matches directory");
ok(meta.key === "aivideomaker", "key");
ok(meta.fetchMode === "per_task", "fetchMode");
ok(
  eq(meta.models, [
    "minimax-h3",
    "minimax",
    "t2v",
    "i2v",
    "t2v_v3",
    "i2v_v3",
    "seedance20",
    "wan27",
    "happyhorse",
    "doubao-seedance-2-0-260128",
  ]),
  "models",
);

// usageExamples 键集合必须完全覆盖 usageSchema
const schemaKeys = Object.keys(meta.usageSchema).sort();
ok(eq(schemaKeys, ["duration", "resolution"]), "usageSchema keys");
for (const example of meta.usageExamples) {
  ok(eq(Object.keys(example.facts).sort(), schemaKeys), "usageExample covers schema: " + example.label);
  ok(meta.usageSchema.resolution.enum.indexOf(example.facts.resolution) >= 0, "resolution in enum: " + example.label);
}
// t2v / i2v / t2v_v3 / i2v_v3 实际产出 "unspecified"。示例里必须有一条，
// 否则用户在倍率表里只看到 480p/720p/1080p 三行，这四个模型永远匹配不到行。
ok(
  meta.usageExamples.some(function (example) {
    return example.facts.resolution === "unspecified";
  }),
  "usageExamples covers the unspecified resolution case",
);

// protocols 声明的 hook 必须存在
const declared = meta.protocols.map(function (p) {
  return typeof p === "string" ? p : p.name;
});
ok(declared.indexOf("openai_responses") >= 0 && declared.indexOf("openai_video") >= 0, "protocols declared");
ok(typeof plugin.protocols.openai_responses.decodeRequest === "function", "responses.decodeRequest");
ok(typeof plugin.protocols.openai_responses.renderEvents === "function", "responses.renderEvents");
ok(typeof plugin.protocols.openai_responses.renderFinal === "function", "responses.renderFinal");
ok(typeof plugin.protocols.openai_video.decodeRequest === "function", "video.decodeRequest");
ok(typeof plugin.protocols.openai_video.render === "function", "video.render");

// ---- 路由结构：hook 必须都能解析到 native 成员，否则那条路由是死的 ----
const native = plugin.native || {};
ok(meta.routes.length >= 2, "routes declared");
for (const route of meta.routes) {
  const label = route.method + " " + route.path;
  ok(typeof native[route.render] === "function", "route render resolvable: " + label);
  if (route.type === "submit" || route.type === "dynamic") {
    ok(typeof native[route.decode] === "function", "route decode resolvable: " + label);
  } else {
    // query 路由不得配 decode（宿主约定）
    ok(route.decode === undefined, "query route has no decode: " + label);
  }
  if (route.taskIdParam) {
    ok(route.path.indexOf(":" + route.taskIdParam) >= 0, "taskIdParam placeholder present: " + label);
  }
}
const routeShapes = meta.routes.map(function (route) {
  return route.method + " " + route.path.replace(/:[^/]+/g, ":param");
});
ok(new Set(routeShapes).size === routeShapes.length, "route shapes unique after dedup");
ok(
  meta.routes.filter(function (route) {
    return route.type === "query";
  }).length === 1,
  "exactly one query route",
);

// 宿主同步语法硬限制：源码不得出现真实 async/await/import token
const source = readFileSync(SOURCE_PATH, "utf8");
const stripped = source
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, "``");
for (const keyword of ["async", "await", "import"]) {
  ok(!new RegExp("\\b" + keyword + "\\b").test(stripped), "no " + keyword + " token");
}

// ---- 凭据 ----
throws(function () {
  plugin.buildSubmitRequest({ apiKey: "", baseUrl: BASE, requestBody: { adapterMode: "heterogeneous", payload: { prompt: "x", images: [], duration: 5, resolution: "720p", aspectRatio: "16:9", tier: "turbo", action: "text_to_video" } } });
}, "empty key rejected", "channel key is empty");
throws(function () {
  plugin.buildSubmitRequest({ apiKey: "plain-secret", baseUrl: BASE, requestBody: { adapterMode: "heterogeneous", payload: { prompt: "x", images: [] } } });
}, "unknown key rejected", 'must start with "ak_"');
throws(function () {
  plugin.buildSubmitRequest({ apiKey: '{"cookie":"sid=1"}', baseUrl: BASE, requestBody: { adapterMode: "heterogeneous", payload: { prompt: "x", images: [] } } });
}, "web key without userId rejected", "userId");
throws(function () {
  plugin.buildSubmitRequest({ apiKey: API_KEY, baseUrl: BASE, requestBody: null });
}, "driver rejects missing adapter request", "missing adapter mode");

// ---- openai_responses 入口 ----
function responsesCtx(value) {
  return { body: { kind: "json", value: value }, apiKey: API_KEY, baseUrl: BASE };
}

const t2v = plugin.protocols.openai_responses.decodeRequest(responsesCtx({ model: "minimax-h3", prompt: "a cat" }));
ok(t2v.kind === "submit" && t2v.action === "text_to_video", "t2v action");
ok(t2v.requestBody.adapterMode === "heterogeneous", "adapterMode");
ok(t2v.requestBody.payload.duration === 5, "default duration 5");
ok(t2v.requestBody.payload.resolution === "720p", "default resolution 720p");
ok(t2v.requestBody.payload.aspectRatio === "16:9", "default aspect 16:9");
ok(t2v.requestBody.payload.tier === "turbo", "default tier turbo");
ok(eq(t2v.requestBody.payload.images, []), "no images");

const i2v = plugin.protocols.openai_responses.decodeRequest(
  responsesCtx({
    model: "minimax-h3",
    input: [
      { type: "input_text", text: "walk" },
      { type: "input_image", image_url: { url: "https://cdn.test/a.png" } },
    ],
    duration: 10,
    resolution: "1080p",
    size: "9:16",
    tier: "base",
  }),
);
ok(i2v.action === "image_to_video", "i2v action");
ok(i2v.requestBody.payload.prompt === "walk", "prompt from input parts");
ok(eq(i2v.requestBody.payload.images, [{ url: "https://cdn.test/a.png", role: "first_frame" }]), "image from input parts");
ok(i2v.requestBody.payload.duration === 10, "duration passthrough");
ok(i2v.requestBody.payload.resolution === "1080p", "resolution passthrough");
ok(i2v.requestBody.payload.aspectRatio === "9:16", "size maps to aspectRatio");
ok(i2v.requestBody.payload.tier === "base", "tier passthrough");

const firstTail = plugin.protocols.openai_responses.decodeRequest(
  responsesCtx({ prompt: "x", images: ["https://cdn.test/1.png", "https://cdn.test/2.png"] }),
);
ok(firstTail.action === "first_tail_to_video", "two images -> first_tail");
ok(
  eq(firstTail.requestBody.payload.images, [
    { url: "https://cdn.test/1.png", role: "first_frame" },
    { url: "https://cdn.test/2.png", role: "last_frame" },
  ]),
  "two images -> first/last roles",
);

const refs = plugin.protocols.openai_responses.decodeRequest(
  responsesCtx({ prompt: "x", images: ["https://cdn.test/a.png", "https://cdn.test/b.png", "https://cdn.test/c.png"] }),
);
ok(refs.action === "reference_to_video", "three images -> reference");

// 图片协议：上游只接受 http/https/s3/r2，data url 与宿主文件占位符必须显式拒绝
ok(
  eq(
    plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", images: [{ url: "s3://bucket/key.png" }] }))
      .requestBody.payload.images,
    [{ url: "s3://bucket/key.png", role: "first_frame" }],
  ),
  "s3 url accepted",
);
ok(
  eq(
    plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", images: ["R2://bucket/k.png"] }))
      .requestBody.payload.images,
    [{ url: "R2://bucket/k.png", role: "first_frame" }],
  ),
  "r2 url accepted",
);
throws(function () {
  plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", images: ["data:image/png;base64,AAAA"] }));
}, "data url rejected", "not a data url");
throws(function () {
  plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", images: ["ftp://host/a.png"] }));
}, "ftp url rejected", "must use http, https, s3, or r2");
throws(function () {
  plugin.protocols.openai_responses.decodeRequest(
    responsesCtx({ prompt: "x", images: [{ __fileRef: "request_file:input_reference", encoding: "dataUrl" }] }),
  );
}, "host file placeholder rejected", "file uploads are not supported");

const clamped = plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", duration: 999 }));
ok(clamped.requestBody.payload.duration === 20, "duration clamped to 20");
const clampedLow = plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", duration: 1 }));
ok(clampedLow.requestBody.payload.duration === 5, "duration clamped to 5");

const ratioAlt = plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", aspectRatio: "16x9" }));
ok(ratioAlt.requestBody.payload.aspectRatio === "16:9", "16x9 normalized");
const ratioUnknown = plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", aspectRatio: "7:2" }));
ok(ratioUnknown.requestBody.payload.aspectRatio === "16:9", "unknown ratio falls back");

throws(function () {
  plugin.protocols.openai_responses.decodeRequest(responsesCtx({}));
}, "empty request rejected", "prompt or images is required");
throws(function () {
  plugin.protocols.openai_responses.decodeRequest(responsesCtx({ prompt: "x", metadata: { action: "nope" } }));
}, "unknown action rejected", "unsupported metadata.action");
throws(function () {
  plugin.protocols.openai_responses.decodeRequest({ body: { kind: "text", value: "x" } });
}, "non-json body rejected", "JSON body required");

// ---- 提交：官方 API ----
const submitApi = plugin.buildSubmitRequest({
  apiKey: API_KEY,
  baseUrl: BASE,
  requestBody: t2v.requestBody,
  upstreamModel: "minimax-h3",
});
ok(submitApi.url === BASE + "/api/v1/generate/minimax", "api submit url");
ok(submitApi.method === "POST", "api submit method");
ok(submitApi.headers.key === API_KEY, "api submit auth header");
ok(submitApi.body.content === "a cat", "api body content");
ok(submitApi.body.imageUrl === null && submitApi.body.lastFrameUrl === null, "api body empty slots");
ok(eq(submitApi.body.referenceImageUrls, []), "api body no refs");
ok(submitApi.body.duration === 5 && submitApi.body.resolution === "720p", "api body params");

const submitRefs = plugin.buildSubmitRequest({
  apiKey: API_KEY,
  baseUrl: BASE,
  requestBody: plugin.protocols.openai_responses.decodeRequest(
  responsesCtx({
    prompt: "x",
    images: [
      "https://cdn.test/1.png",
      "https://cdn.test/2.png",
      "https://cdn.test/3.png",
      "https://cdn.test/4.png",
      "https://cdn.test/5.png",
    ],
  }),
).requestBody,
});
ok(submitRefs.body.imageUrl === "https://cdn.test/1.png", "first image is main slot");
ok(
  eq(submitRefs.body.referenceImageUrls, [
    "https://cdn.test/2.png",
    "https://cdn.test/3.png",
    "https://cdn.test/4.png",
    "https://cdn.test/5.png",
  ]),
  "reference slots capped at 4",
);

// 客户端未知字段不得泄漏到上游 body
const leaked = plugin.buildSubmitRequest({
  apiKey: API_KEY,
  baseUrl: BASE,
  requestBody: plugin.protocols.openai_responses.decodeRequest(
    responsesCtx({ prompt: "x", seconds: 6, weirdField: 1, model: "minimax-h3" }),
  ).requestBody,
});
ok(!Object.prototype.hasOwnProperty.call(leaked.body, "weirdField"), "unknown client field dropped");
ok(!Object.prototype.hasOwnProperty.call(leaked.body, "model"), "model handled by driver only");
ok(leaked.body.duration === 6, "seconds maps to duration");

// ---- 提交：网页会话 ----
const submitWeb = plugin.buildSubmitRequest({ apiKey: WEB_KEY, baseUrl: BASE, requestBody: t2v.requestBody });
ok(submitWeb.url === BASE + "/api/ai.minimaxH3?batch=1", "web submit url");
ok(submitWeb.headers.Cookie === "sid=abc", "web cookie header");
ok(submitWeb.headers.Referer === BASE + "/zh/ai-video-generator", "web referer");
ok(submitWeb.body["0"].json.visitorId === "00000000000000000000000000000000", "default visitorId");
ok(submitWeb.body["0"].json.token === null, "token null (no captcha)");
ok(eq(submitWeb.body["0"].json.referenceAudioUrls, []), "web referenceAudioUrls");
ok(submitWeb.body["0"].json.promptEnrichment === false, "promptEnrichment off");

// ---- 提交响应 ----
const apiSubmitted = plugin.parseSubmitResponse({ apiKey: API_KEY }, { body: { taskId: "tid-1", status: "queueing" } });
ok(apiSubmitted.taskId === "tid-1", "api taskId");
const webSubmitted = plugin.parseSubmitResponse({ apiKey: WEB_KEY }, { body: [{ result: { data: { json: "tid-2" } } }] });
ok(webSubmitted.taskId === "tid-2", "web taskId from trpc");
throws(function () {
  plugin.parseSubmitResponse({ apiKey: API_KEY }, { body: {} });
}, "missing api taskId", "missing taskId");
throws(function () {
  plugin.parseSubmitResponse({ apiKey: WEB_KEY }, { body: [{ error: { json: { message: "captcha required" } } }] });
}, "trpc error surfaces", "captcha required");
// 提交阶段的业务错误 envelope 必须带出 errorCode，而不是只剩「没有 taskId」
throws(function () {
  plugin.parseSubmitResponse({ apiKey: API_KEY }, { body: { status: "FAILED", errorCode: "AUTH_FAILED", message: "Invalid API key." } });
}, "submit surfaces errorCode", "[AUTH_FAILED] Invalid API key.");
throws(function () {
  plugin.parseSubmitResponse({ apiKey: WEB_KEY }, { body: { status: "FAILED", errorCode: "AUTH_FAILED", message: "Invalid API key." } });
}, "web submit surfaces errorCode", "[AUTH_FAILED] Invalid API key.");

// ---- 查询 ----
const apiQuery = plugin.buildQueryRequest({ apiKey: API_KEY, baseUrl: BASE, taskId: "tid-1" });
ok(apiQuery.url === BASE + "/api/v1/tasks/tid-1" && apiQuery.method === "GET", "api query url");
const webQuery = plugin.buildQueryRequest({ apiKey: WEB_KEY, baseUrl: BASE, taskId: "tid-2" });
ok(webQuery.url.indexOf(BASE + "/api/model.listModel?batch=1&input=") === 0, "web query url");
ok(decodeURIComponent(webQuery.url).indexOf('"userId":"u-1"') > 0, "web query carries userId");
ok(webQuery.headers.Referer === BASE + "/zh/generations", "web query referer");
ok(plugin.buildQueryRequest({ apiKey: API_KEY, baseUrl: BASE, taskId: "a b" }).url.indexOf("a%20b") > 0, "task id encoded");

// ---- 状态阶梯 ----
function apiResult(body, response) {
  return plugin.parseTaskResult({ apiKey: API_KEY, baseUrl: BASE, taskId: "tid-1" }, body, response);
}
ok(apiResult({ status: "succeed", url: "https://cdn.test/v.mp4" }).status === "SUCCESS", "succeed -> SUCCESS");
ok(apiResult({ taskStatus: "SUCCESS", url: "https://cdn.test/v.mp4" }).status === "SUCCESS", "taskStatus fallback field");
ok(apiResult({ status: "failed", message: "boom" }).status === "FAILURE", "failed -> FAILURE");
ok(apiResult({ status: "failed", message: "boom" }).reason === "boom", "failure reason");
ok(apiResult({ status: "processing" }).status === "IN_PROGRESS", "processing -> IN_PROGRESS");
ok(apiResult({ status: "queueing" }).status === "QUEUED", "queueing -> QUEUED");
ok(apiResult({ status: "completed_ok" }).status === "SUCCESS", "prefix success");
ok(apiResult({ status: "not_completed" }).status !== "SUCCESS", "no substring success (not_completed)");
ok(apiResult({ status: "timeout" }).status === "FAILURE", "prefix failure");
ok(apiResult({ status: "generating" }).status === "IN_PROGRESS", "prefix in progress");
ok(apiResult({ status: "pending" }).status === "QUEUED", "prefix queued");
ok(apiResult({ status: "weird_state" }).status === "QUEUED", "unknown -> QUEUED, never UNKNOWN");
ok(apiResult({ status: "weird", url: "https://cdn.test/v.mp4" }).status === "SUCCESS", "url fallback");
// 失败信号优先于结果 URL
const signal = apiResult({ status: "weird", url: "https://cdn.test/v.mp4", fail_reason: "nsfw" });
ok(signal.status === "FAILURE" && signal.reason === "nsfw", "failure signal beats url");
ok(apiResult({ status: "processing", progress: "42%" }).progress === "42%", "vendor progress passthrough");
// 上游真实错误 envelope（探测所得）：{"status":"FAILED","errorCode":"AUTH_FAILED","message":"..."}
const authEnvelope = apiResult({ status: "FAILED", errorCode: "AUTH_FAILED", message: "Invalid API key." }, { status: 401 });
ok(authEnvelope.status === "FAILURE", "auth envelope -> FAILURE");
ok(authEnvelope.reason === "[AUTH_FAILED] Invalid API key.", "errorCode carried in reason", authEnvelope.reason);
ok(apiResult({}).status === "QUEUED", "empty body -> QUEUED");
// 真实上游记录没有 progress 字段：缺失时必须退回状态推导值，不能当成 0
ok(apiResult({ status: "succeed", url: "https://cdn.test/v.mp4" }).progress === "100%", "no progress -> 100% on success");
ok(apiResult({ status: "processing" }).progress === "50%", "no progress -> 50% while running");
ok(apiResult({ status: "queueing" }).progress === "0%", "no progress -> 0% while queued");
ok(apiResult({ status: "processing", progress: "" }).progress === "50%", "empty progress string ignored");
ok(apiResult({ status: "processing", progress: null }).progress === "50%", "null progress ignored");
throws(function () {
  apiResult({ status: "processing" }, { status: 429 });
}, "429 throws for retry", "HTTP 429");
throws(function () {
  apiResult({ status: "processing" }, { status: 500 });
}, "500 throws for retry", "HTTP 500");

// 官方 OpenAPI TaskStatus 枚举必须走精确层，不能只靠前缀兜底：
// CANCEL 一旦掉到默认 QUEUED，上游不会再变，任务就永远卡在轮询里。
const officialStatus = {
  SUBMITTED: "QUEUED",
  PROGRESS: "IN_PROGRESS",
  COMPLETED: "SUCCESS",
  FAILED: "FAILURE",
  CANCEL: "FAILURE",
};
for (const code of Object.keys(officialStatus)) {
  ok(apiResult({ id: "tid-1", status: code }).status === officialStatus[code], "official TaskStatus " + code);
}
ok(apiResult({ status: "CANCEL" }).status !== "QUEUED", "CANCEL never falls through to QUEUED");
ok(apiResult({ taskStatus: "progress" }).status === "IN_PROGRESS", "lowercase progress via taskStatus");
// 官方 Error schema 里 error 是 string（与 message 并列），字符串形态也要能取到
ok(
  apiResult({ status: "FAILED", errorCode: "BUDGET_EXCEEDED", error: "budget guard exceeded" }).reason ===
    "[BUDGET_EXCEEDED] budget guard exceeded",
  "string error field carried in reason",
);
ok(apiResult({ status: "failed", error: "plain string error" }).reason === "plain string error", "string error without code");
// 官方 Error schema 列出的 errorCode 样例全部要能带出
for (const code of ["AUTH_FAILED", "BUDGET_EXCEEDED", "IDEMPOTENCY_CONFLICT", "INSUFFICIENT_CREDITS", "RATE_LIMITED"]) {
  const got = apiResult({ status: "FAILED", errorCode: code, message: "x" });
  ok(got.status === "FAILURE" && got.reason.indexOf("[" + code + "]") === 0, "errorCode sample " + code);
}
// 官方 Task 失败时把原因放在 output.error 里
ok(apiResult({ status: "FAILED", output: { error: "content rejected" } }).reason === "content rejected", "output.error carried in reason");

// 网页会话：列表里按 id 定位
function webResult(models, response) {
  return plugin.parseTaskResult(
    { apiKey: WEB_KEY, baseUrl: BASE, taskId: "tid-2" },
    [{ result: { data: { json: { models: models } } } }],
    response,
  );
}
const webOk = webResult([
  { id: "tid-9", taskStatus: "succeed", url: "https://cdn.test/other.mp4" },
  { id: "tid-2", taskStatus: "succeed", url: "https://cdn.test/v.mp4" },
]);
ok(webOk.status === "SUCCESS" && webOk.url === "https://cdn.test/v.mp4", "web picks task by id");
ok(webResult([{ id: "tid-3", taskStatus: "failed", taskStatusMsg: "nsfw" }]).status === "QUEUED", "absent task stays queued");
ok(webResult([{ id: "tid-2", taskStatus: "failed", taskStatusMsg: "nsfw" }]).reason === "nsfw", "web failure reason");

// ---- 用量 ----
const usage = plugin.extractUsage({ apiKey: API_KEY, requestBody: t2v.requestBody });
ok(eq(Object.keys(usage).sort(), schemaKeys), "usage keys match schema");
ok(usage.duration === 5 && usage.resolution === "720p", "usage values");
ok(plugin.extractUsage({ usagePurpose: "billing_ratios", requestBody: t2v.requestBody }) === null, "billing_ratios -> null");
const completeUsage = plugin.extractUsageOnComplete(null, null, { duration: 10, resolution: "1080P", credits: 30 });
ok(completeUsage.duration === 10 && completeUsage.resolution === "1080p", "onComplete fills schema dims");
ok(completeUsage.credits === undefined, "credits stays out of facts");
ok(plugin.extractUsageOnComplete(null, null, { credits: 30 }) === null, "no schema dims -> null");
// 真实记录形状：duration 是字符串 "5"，taskStatusMsg 为 null
const realRecord = {
  id: "psdbqvfu6j4yeob",
  taskStatus: "succeed",
  taskStatusMsg: null,
  duration: "5",
  aspectRatio: "1:1",
  credits: 1,
  aiModel: "minimax-h3",
  url: "https://static.img2video.ai/x.mp4",
};
ok(plugin.extractUsageOnComplete(null, { data: realRecord }, null).duration === 5, "string duration from record");
ok(plugin.extractUsageOnComplete({ data: realRecord }, null, null).duration === 5, "record from task.data");
ok(plugin.extractUsageOnComplete(null, null, realRecord).duration === 5, "record from raw body");
// 查询命中必须回带整条记录，网页会话下这是唯一能确定归属的数据
const webData = webResult([{ id: "tid-2", taskStatus: "succeed", url: "https://cdn.test/v.mp4", duration: "5" }]);
ok(webData.data && webData.data.id === "tid-2", "query result carries record");

// 官方 Task schema 形状（api 模式）：顶层没有 duration/resolution，入参回显在 input 里，
// 结果在 output.url。真实时长与分辨率必须能从 input 回显取到，否则会静默回退到提交期的值。
const apiRecord = {
  id: "tid-1",
  status: "COMPLETED",
  input: { content: "a cat", duration: 10, resolution: "1080p" },
  output: { url: "https://cdn.test/v.mp4" },
  creditsCharged: 12,
  creditsRefunded: 0,
  listValueCents: 1200,
};
const apiUsage = plugin.extractUsageOnComplete(null, { data: apiRecord }, null);
ok(apiUsage && apiUsage.duration === 10, "api record duration from input echo");
ok(apiRecord.resolution === undefined, "api record has no top-level resolution");
ok(apiUsage.resolution === "1080p", "api record resolution from input echo");
ok(apiUsage.creditsCharged === undefined, "credits fields stay out of facts");
ok(apiResult(apiRecord).status === "SUCCESS", "official Task -> SUCCESS");
ok(apiResult(apiRecord).url === "https://cdn.test/v.mp4", "official Task output.url");
// 顶层 duration 优先于 input 回显（网页会话记录带顶层值）
ok(
  plugin.extractUsageOnComplete(null, { data: { duration: "5", input: { duration: 10 } } }, null).duration === 5,
  "top-level duration wins over input echo",
);
// 上游部分模型把分辨率写成数字（seedance20 是 480 / 720）
ok(
  plugin.extractUsageOnComplete(null, { data: { duration: 5, resolution: 480 } }, null).resolution === "480p",
  "numeric resolution normalized",
);

// ---- artifact ----
const doneTask = { status: "SUCCESS", url: "https://cdn.test/v.mp4", data: { url: "https://cdn.test/v.mp4" } };
ok(eq(plugin.listArtifacts(doneTask), [{ key: "video", type: "video", mimeType: "video/mp4" }]), "listArtifacts");
ok(eq(plugin.listArtifacts({ status: "IN_PROGRESS" }), []), "no artifact while running");
ok(eq(plugin.listArtifacts({ status: "SUCCESS" }), []), "no artifact without url");
const content = plugin.buildContentRequest({
  artifactKey: "video",
  url: "https://cdn.test/v.mp4",
  data: { url: "https://cdn.test/v.mp4" },
  clientRequest: { method: "GET" },
});
ok(content.url === "https://cdn.test/v.mp4" && content.credentialless === true, "credentialless CDN fetch");
throws(function () {
  plugin.buildContentRequest({ artifactKey: "audio", url: "https://cdn.test/v.mp4", clientRequest: { method: "GET" } });
}, "unknown artifact rejected", "artifact_not_found");
// 官方 Task 形状下的成片（output.url）也必须能被制品层识别
ok(
  eq(plugin.listArtifacts({ status: "SUCCESS", data: apiRecord }), [{ key: "video", type: "video", mimeType: "video/mp4" }]),
  "artifact from official Task output.url",
);

// ---- openai_video ----
const videoDecoded = plugin.protocols.openai_video.decodeRequest({
  body: { kind: "json", value: { model: "minimax-h3", prompt: "run", duration: 8 } },
  upstreamModel: "minimax-h3",
});
ok(videoDecoded.kind === "submit" && videoDecoded.action === "text_to_video", "video decode");
ok(videoDecoded.requestBody.payload.duration === 8, "video duration");
const multipart = plugin.protocols.openai_video.decodeRequest({
  body: { kind: "multipart", fields: { prompt: ["run"], images: ["https://cdn.test/a.png"] }, files: [] },
  model: "minimax-h3",
});
ok(multipart.action === "image_to_video", "multipart decode");
throws(function () {
  plugin.protocols.openai_video.decodeRequest({ body: { kind: "multipart", fields: { prompt: ["a", "b"] }, files: [] } });
}, "duplicate multipart field rejected", "must be provided once");
throws(function () {
  plugin.protocols.openai_video.decodeRequest({ body: { kind: "multipart", fields: {}, files: [{ name: "f" }] } });
}, "file upload rejected", "file uploads are not supported");

const rendered = plugin.protocols.openai_video.render({}, { task_id: "pub-1", status: "SUCCESS", progress: "100%", created_at: 1, updated_at: 2, model: "minimax-h3" });
ok(rendered.object === "video" && rendered.status === "completed" && rendered.progress === 100, "video render success");
ok(
  plugin.protocols.openai_video.render({}, { task_id: "pub-1", status: "IN_PROGRESS", progress: "50%" }).status === "in_progress",
  "video render in progress",
);
ok(plugin.protocols.openai_video.render({}, { task_id: "pub-1", status: "FAILURE", fail_reason: "nsfw" }).error.message === "nsfw", "video render error");

// ---- responses renderer ----
const responsesCtxDone = {
  url: "https://cdn.test/v.mp4",
  artifacts: { video: { url: "https://cdn.test/v.mp4" } },
};
const events = plugin.protocols.openai_responses.renderEvents(responsesCtxDone, { status: "SUCCESS" }, null);
ok(events.done === true && events.events[0].data.indexOf("<video") === 0, "renderEvents emits video");
ok(plugin.protocols.openai_responses.renderEvents(responsesCtxDone, { status: "SUCCESS" }, { status: "SUCCESS" }).events.length === 0, "no duplicate output");
ok(plugin.protocols.openai_responses.renderEvents({}, { status: "IN_PROGRESS" }, null).done === false, "progress not done");
ok(plugin.protocols.openai_responses.renderEvents({}, { status: "FAILURE", fail_reason: "nsfw" }, null).events[0].message === "nsfw", "failure event");
const final = plugin.protocols.openai_responses.renderFinal(responsesCtxDone);
ok(final.output[0].content[0].text.indexOf("<video") === 0, "renderFinal video");
throws(function () {
  plugin.protocols.openai_responses.renderFinal({});
}, "renderFinal without url throws", "video artifact is unavailable");

// ===========================================================================
// 火山方舟 Seedance 原生入口（1.0.1 新增）
// ===========================================================================

function arkCtx(body, extra) {
  return Object.assign({ body: { kind: "json", value: body }, apiKey: API_KEY, baseUrl: BASE }, extra || {});
}
function arkDecode(body, extra) {
  return plugin.native.createTask(arkCtx(body, extra));
}
function arkSubmit(body, extra) {
  return plugin.buildSubmitRequest(
    Object.assign({ apiKey: API_KEY, baseUrl: BASE, requestBody: arkDecode(body, extra).requestBody }, extra || {}),
  );
}
function arkThrows(body, name, fragment) {
  throws(function () {
    arkSubmit(body);
  }, name, fragment);
}
const TXT = function (text) {
  return { type: "text", text: text };
};
const IMG = function (url, role) {
  const item = { type: "image_url", image_url: { url: url } };
  if (role) item.role = role;
  return item;
};

// ---- 入站解码 ----
const arkText = arkDecode({ model: "seedance20", content: [TXT("a cat")], duration: 8, resolution: "720p", ratio: "16:9" });
ok(arkText.kind === "submit" && arkText.action === "text_to_video", "ark decode kind/action");
ok(arkText.requestBody.adapterMode === "heterogeneous", "ark adapterMode");
ok(arkText.requestBody.payload.durationGiven === true, "ark durationGiven set");
ok(arkText.requestBody.payload.resolutionGiven === true, "ark resolutionGiven set");
ok(arkText.requestBody.payload.aspectRatioGiven === true, "ark aspectRatioGiven set");
const arkDefault = arkDecode({ model: "minimax", content: [TXT("a cat")] });
ok(arkDefault.requestBody.payload.durationGiven === false, "ark omitted duration marked as not given");
ok(arkDefault.requestBody.payload.resolutionGiven === false, "ark omitted resolution marked as not given");
ok(arkDefault.requestBody.payload.aspectRatioGiven === false, "ark omitted ratio marked as not given");
// 多条 text 合并成单个 prompt（上游只接受一个文本字段）
ok(arkDecode({ model: "minimax", content: [TXT("a"), TXT("b")] }).requestBody.payload.prompt === "a\nb", "ark multiple texts merged");
// 扁平写法也接受
ok(
  arkDecode({ model: "i2v", content: [{ type: "image", url: "https://cdn.test/a.jpg" }], duration: 5 }).requestBody.payload.images[0].url ===
    "https://cdn.test/a.jpg",
  "ark flat image form accepted",
);
throws(function () {
  plugin.native.createTask({ body: { kind: "json", value: { content: [TXT("x")] } } });
}, "ark model required when ctx has none", "model is required");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "t2v" }));
}, "ark content array required", "content must be an array");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "t2v", content: [] }));
}, "ark empty content rejected", "content is required");
throws(function () {
  plugin.native.createTask({ body: { kind: "multipart", fields: {} } });
}, "ark json body required", "JSON body required");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "t2v", content: [{ type: "draft_task", draft_task: {} }] }));
}, "ark draft_task rejected", "draft_task content is not supported");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "t2v", content: [{ type: "weird" }] }));
}, "ark unknown content type rejected", "unsupported content type");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "t2v", content: [IMG("https://cdn.test/a.jpg", "bogus_role")] }));
}, "ark unknown image role rejected", "unsupported image role");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "t2v", content: [{ type: "video_url", video_url: { url: "not-a-url" } }] }));
}, "ark video url validated", "video content requires an http(s) url");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "t2v", content: [{ type: "audio_url", audio_url: { url: "not-a-url" } }] }));
}, "ark audio url validated", "audio content requires an http(s) url");
// 裸 image_url 的 role 补全：1 张=首帧，2 张=首帧+尾帧，>2 张必须显式声明
ok(arkDecode({ model: "minimax", content: [IMG("https://cdn.test/a.jpg")] }).requestBody.payload.images[0].role === "first_frame", "ark bare image -> first_frame");
ok(
  eq(
    arkDecode({ model: "minimax", content: [IMG("https://cdn.test/a.jpg"), IMG("https://cdn.test/b.jpg")] }).requestBody.payload.images,
    [
      { url: "https://cdn.test/a.jpg", role: "first_frame" },
      { url: "https://cdn.test/b.jpg", role: "last_frame" },
    ],
  ),
  "ark two bare images -> first/last frame",
);
ok(
  arkDecode({ model: "minimax", content: [IMG("https://cdn.test/a.jpg"), IMG("https://cdn.test/b.jpg", "reference")] }).requestBody
    .payload.images[0].role === "reference",
  "ark bare image becomes reference when a reference role is present",
);
throws(function () {
  plugin.native.createTask(
    arkCtx({
      model: "minimax",
      content: [IMG("https://cdn.test/a.jpg"), IMG("https://cdn.test/b.jpg"), IMG("https://cdn.test/c.jpg")],
    }),
  );
}, "ark third bare image requires explicit role", "must declare it explicitly");
throws(function () {
  plugin.native.createTask(arkCtx({ model: "minimax", content: [TXT("x")], watermark: "maybe" }));
}, "ark watermark must be boolean", "watermark must be a boolean");

// ---- 8 个上游模型的请求构建 ----
const t2vBody = arkSubmit({ model: "t2v", content: [TXT("a cat")], duration: 8, ratio: "16:9" });
ok(t2vBody.url === BASE + "/api/v1/generate/t2v" && t2vBody.method === "POST", "ark t2v url");
ok(t2vBody.headers.key === API_KEY, "ark t2v auth header");
ok(eq(t2vBody.body, { prompt: "a cat", aspectRatio: "16:9", duration: "8" }), "ark t2v body");

const i2vBody = arkSubmit({ model: "i2v", content: [IMG("https://cdn.test/a.jpg"), TXT("go")], duration: "5" });
ok(i2vBody.url === BASE + "/api/v1/generate/i2v", "ark i2v url");
ok(eq(i2vBody.body, { image: "https://cdn.test/a.jpg", duration: "5", prompt: "go" }), "ark i2v body");

const t2vV3Body = arkSubmit({ model: "t2v_v3", content: [TXT("a cat")], duration: 15, ratio: "9:16" });
ok(t2vV3Body.url === BASE + "/api/v1/generate/t2v_v3", "ark t2v_v3 url");
ok(eq(t2vV3Body.body, { prompt: "a cat", aspectRatio: "9:16", duration: "15" }), "ark t2v_v3 body");

const i2vV3Body = arkSubmit({ model: "i2v_v3", content: [IMG("https://cdn.test/a.jpg")], duration: 20 });
ok(i2vV3Body.url === BASE + "/api/v1/generate/i2v_v3", "ark i2v_v3 url");
ok(eq(i2vV3Body.body, { image: "https://cdn.test/a.jpg", duration: "20" }), "ark i2v_v3 body");

const seedBody = arkSubmit({
  model: "seedance20",
  content: [TXT("a cat"), IMG("https://cdn.test/a.jpg", "first_frame")],
  duration: 8,
  resolution: "720p",
  ratio: "16:9",
});
ok(seedBody.url === BASE + "/api/v1/generate/seedance20", "ark seedance20 url");
ok(
  eq(seedBody.body, {
    prompt: "a cat",
    image: "https://cdn.test/a.jpg",
    video: null,
    audio: null,
    duration: 8,
    resolution: 720,
    ratio: "16:9",
  }),
  "ark seedance20 body",
);
// 火山官方 Seedance 模型名走同一条上游端点（与 senseaudio-video 渠道同名，可互为备份）
const aliasBody = arkSubmit({ model: "doubao-seedance-2-0-260128", content: [TXT("a cat")], duration: 4, resolution: 480, ratio: "1:1" });
ok(aliasBody.url === BASE + "/api/v1/generate/seedance20", "ark seedance alias url");
ok(aliasBody.body.resolution === 480 && aliasBody.body.duration === 4, "ark seedance alias body");
ok(aliasBody.body.ratio === "1:1", "ark seedance numeric resolution input accepted");

const wanBody = arkSubmit({
  model: "wan27",
  content: [TXT("a cat"), IMG("https://cdn.test/a.jpg")],
  duration: 10,
  resolution: "1080p",
  ratio: "4:3",
  promptExtend: true,
});
ok(wanBody.url === BASE + "/api/v1/generate/wan27", "ark wan27 url");
ok(
  eq(wanBody.body, {
    prompt: "a cat",
    image: "https://cdn.test/a.jpg",
    duration: "10",
    resolution: "1080P",
    ratio: "4:3",
    promptExtend: true,
  }),
  "ark wan27 body",
);
ok(arkSubmit({ model: "wan27", content: [TXT("x")], duration: 5, resolution: "720p", ratio: "16:9" }).body.promptExtend === undefined, "ark wan27 promptExtend omitted when absent");

const hhT2v = arkSubmit({ model: "happyhorse", content: [TXT("a cat")], duration: 6, resolution: "720p" });
ok(hhT2v.url === BASE + "/api/v1/generate/happyhorse", "ark happyhorse url");
ok(eq(hhT2v.body, { prompt: "a cat", image: null, duration: 6, resolution: "720P", ratio: "16:9" }), "ark happyhorse t2v body");
const hhR2v = arkSubmit({
  model: "happyhorse",
  content: [TXT("a cat"), IMG("https://cdn.test/a.jpg", "reference"), IMG("https://cdn.test/b.jpg", "reference")],
  duration: 6,
  resolution: "1080p",
  ratio: "9:16",
});
ok(eq(hhR2v.body.image, ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"]), "ark happyhorse r2v image array");
ok(hhR2v.action === "reference_to_video", "ark happyhorse r2v action");

const miniBody = arkSubmit({ model: "minimax", content: [TXT("a cat")], duration: 12, resolution: "1080p", ratio: "21:9" });
ok(miniBody.url === BASE + "/api/v1/generate/minimax", "ark minimax url");
ok(miniBody.body.content === "a cat", "ark minimax body content");
ok(miniBody.body.resolution === "1080p" && miniBody.body.duration === 12, "ark minimax body params");
// 火山入口不替客户端填默认值，缺省时必须回落到上游自己的默认值，而不是发空字符串
const miniDefault = arkSubmit({ model: "minimax", content: [TXT("a cat")] });
ok(miniDefault.body.resolution === "720p", "ark minimax default resolution");
ok(miniDefault.body.duration === 5, "ark minimax default duration");
ok(miniDefault.body.aspectRatio === "16:9", "ark minimax default aspect ratio");
ok(miniDefault.body.tier === "turbo", "ark minimax default tier");
const miniFrames = arkSubmit({
  model: "minimax",
  content: [TXT("x"), IMG("https://cdn.test/a.jpg", "first_frame"), IMG("https://cdn.test/b.jpg", "last_frame")],
});
ok(miniFrames.body.imageUrl === "https://cdn.test/a.jpg" && miniFrames.body.lastFrameUrl === "https://cdn.test/b.jpg", "ark minimax frames");
ok(miniFrames.action === "first_tail_to_video", "ark minimax frames action");
const miniRef = arkSubmit({ model: "minimax", content: [TXT("x"), IMG("https://cdn.test/a.jpg", "reference")] });
ok(eq(miniRef.body.referenceImageUrls, ["https://cdn.test/a.jpg"]), "ark minimax reference image");
// 1.0.0 的请求体里没有这两个字段：没有参考素材时不得凭空多出来
ok(miniRef.body.referenceVideoUrl === undefined && miniRef.body.referenceAudioUrls === undefined, "ark minimax omits empty reference slots");
const miniRefAv = arkSubmit({
  model: "minimax",
  content: [
    TXT("x"),
    IMG("https://cdn.test/a.jpg", "reference"),
    { type: "video_url", video_url: { url: "https://cdn.test/v.mp4" } },
    { type: "audio_url", audio_url: { url: "https://cdn.test/a.mp3" } },
  ],
});
ok(miniRefAv.body.referenceVideoUrl === "https://cdn.test/v.mp4", "ark minimax reference video");
ok(eq(miniRefAv.body.referenceAudioUrls, ["https://cdn.test/a.mp3"]), "ark minimax reference audio");
ok(miniRefAv.action === "reference_to_video", "ark minimax reference action");

// ---- 显式报错（不静默夹紧、不静默丢弃）----
arkThrows({ model: "t2v", content: [TXT("x")], duration: 5, ratio: "16:9", resolution: "720p" }, "ark t2v rejects resolution", "has no resolution field");
arkThrows({ model: "t2v", content: [TXT("x")], duration: 6, ratio: "16:9" }, "ark t2v rejects duration 6", "supports duration 5 / 8");
arkThrows({ model: "t2v", content: [TXT("x")], duration: 5 }, "ark t2v requires ratio", "requires ratio");
arkThrows({ model: "t2v", content: [IMG("https://cdn.test/a.jpg")], duration: 5, ratio: "16:9" }, "ark t2v rejects image input", "does not accept image");
arkThrows({ model: "i2v", content: [TXT("x")], duration: 5 }, "ark i2v requires image", "requires an image");
arkThrows({ model: "i2v", content: [IMG("https://cdn.test/a.jpg")], duration: 5, ratio: "16:9" }, "ark i2v rejects ratio", "has no ratio field");
arkThrows({ model: "i2v", content: [IMG("https://cdn.test/a.jpg"), IMG("https://cdn.test/b.jpg")], duration: 5 }, "ark i2v rejects two images", "accepts a single image");
arkThrows({ model: "t2v_v3", content: [TXT("x")], duration: 8, ratio: "16:9" }, "ark t2v_v3 rejects duration 8", "supports duration 5 / 10 / 15 / 20");
arkThrows({ model: "seedance20", content: [TXT("x")], duration: 8, resolution: "1080p", ratio: "16:9" }, "ark seedance20 rejects 1080p", "supports resolution 480p / 720p");
arkThrows({ model: "seedance20", content: [TXT("x")], duration: 8, ratio: "16:9" }, "ark seedance20 requires resolution", "requires resolution");
arkThrows({ model: "seedance20", content: [TXT("x")], duration: 20, resolution: "720p", ratio: "16:9" }, "ark seedance20 rejects duration 20", "between 4 and 15");
arkThrows(
  { model: "seedance20", content: [{ type: "audio_url", audio_url: { url: "https://cdn.test/a.mp3" } }], duration: 8, resolution: "720p", ratio: "16:9" },
  "ark seedance20 rejects audio alone",
  "audio cannot be used alone",
);
arkThrows(
  { model: "seedance20", content: [TXT("x"), IMG("https://cdn.test/a.jpg"), IMG("https://cdn.test/b.jpg", "reference")], duration: 8, resolution: "720p", ratio: "16:9" },
  "ark seedance20 rejects two images",
  "accepts a single image",
);
arkThrows({ model: "seedance20", content: [TXT("x")], duration: 8, resolution: "720p" }, "ark seedance20 requires ratio", "requires ratio");
arkThrows({ model: "wan27", content: [TXT("x")], duration: 8, resolution: "720p", ratio: "16:9" }, "ark wan27 rejects duration 8", "supports duration 5 / 10 / 15");
arkThrows({ model: "wan27", content: [TXT("x")], duration: 5, resolution: "480p", ratio: "16:9" }, "ark wan27 rejects 480p", "supports resolution 720p / 1080p");
arkThrows({ model: "wan27", content: [TXT("x")], duration: 5, resolution: "720p", ratio: "21:9" }, "ark wan27 rejects 21:9", "supports ratio");
arkThrows({ model: "happyhorse", content: [TXT("x")], duration: 6, resolution: "720p", ratio: "21:9" }, "ark happyhorse rejects 21:9", "supports ratio");
arkThrows({ model: "happyhorse", content: [TXT("x")], duration: 20, resolution: "720p" }, "ark happyhorse rejects duration 20", "between 3 and 15");
arkThrows(
  { model: "happyhorse", content: [TXT("x"), IMG("https://cdn.test/a.jpg"), IMG("https://cdn.test/b.jpg")], duration: 6, resolution: "720p" },
  "ark happyhorse bare pair is first/last frame",
  "mark the extra images with role",
);
arkThrows(
  { model: "minimax", content: [TXT("x"), IMG("https://cdn.test/a.jpg", "last_frame"), IMG("https://cdn.test/b.jpg", "reference")] },
  "ark minimax rejects last frame plus reference",
  "lastFrameUrl cannot be combined",
);
arkThrows({ model: "nosuchmodel", content: [TXT("x")] }, "ark unknown model rejected", "unsupported model");
arkThrows({ model: "seedance20", content: [TXT("x")], duration: 8, resolution: "720p", ratio: "16:9", watermark: true }, "ark watermark=true rejected", "watermark=true is not supported");
ok(
  arkSubmit({ model: "seedance20", content: [TXT("x")], duration: 8, resolution: "720p", ratio: "16:9", watermark: false }).body.watermark === undefined,
  "ark watermark=false is not forwarded",
);
// 网页会话凭据只覆盖 minimax 端点
throws(function () {
  const decoded = arkDecode({ model: "t2v", content: [TXT("x")], duration: 5, ratio: "16:9" });
  plugin.buildSubmitRequest({ apiKey: WEB_KEY, baseUrl: BASE, requestBody: decoded.requestBody });
}, "ark web credentials limited to minimax", "web session credentials only cover the minimax model");
throws(function () {
  const decoded = arkDecode({
    model: "minimax",
    content: [TXT("x"), { type: "video_url", video_url: { url: "https://cdn.test/v.mp4" } }],
  });
  plugin.buildSubmitRequest({ apiKey: WEB_KEY, baseUrl: BASE, requestBody: decoded.requestBody });
}, "ark web credentials reject reference video", "do not support reference video or audio");
// 客户端模型名经上游重定向后仍按上游模型分派
const redirected = arkSubmit({ model: "t2v", content: [TXT("x")], duration: 5, ratio: "16:9" }, { upstreamModel: "t2v_v3" });
ok(redirected.url === BASE + "/api/v1/generate/t2v_v3", "ark upstreamModel override wins");

// ---- 火山入口的用量 ----
// 真实联调确认：t2v 的完成期回填里根本没有 resolution（上游没有该字段）。
// 提交期不能凭空填一个默认 720p，否则倍率表会出现一条上游不存在的分辨率行。
ok(meta.usageSchema.resolution.enum.indexOf("unspecified") >= 0, "unspecified resolution in schema enum");
const arkT2vUsage = plugin.extractUsage({
  requestBody: arkDecode({ model: "t2v", content: [TXT("x")], duration: 5, ratio: "16:9" }).requestBody,
});
ok(arkT2vUsage.resolution === "unspecified", "ark usage marks missing resolution dimension");
ok(eq(Object.keys(arkT2vUsage).sort(), schemaKeys), "ark usage keys match schema");
ok(arkT2vUsage.duration === 5, "ark usage duration");
const arkSeedUsage = plugin.extractUsage({
  requestBody: arkDecode({ model: "seedance20", content: [TXT("x")], duration: 4, resolution: "480p", ratio: "16:9" }).requestBody,
});
ok(arkSeedUsage.resolution === "480p", "ark usage keeps real resolution");
// 完成期只回填真实拿到的维度，不补齐占位值
ok(
  eq(plugin.extractUsageOnComplete(null, null, { duration: 5 }), { duration: 5 }),
  "ark onComplete omits absent resolution",
);
// 用量维度按「上游模型有没有该字段」判定，不能按「payload 里有没有值」——
// openai 入口会替缺失字段补默认值，只看 payload 会把默认 720p 记成上游真实存在的维度，
// 于是同一个 t2v 任务走火山入口记 unspecified、走 openai 入口记 720p，倍率表对不上。
function openaiUsage(model, extra) {
  const ctx = responsesCtx(Object.assign({ model: model, prompt: "x" }, extra || {}));
  return plugin.extractUsage({
    apiKey: API_KEY,
    requestBody: plugin.protocols.openai_responses.decodeRequest(ctx).requestBody,
  });
}
ok(openaiUsage("t2v").resolution === "unspecified", "openai entry marks missing resolution dimension");
ok(openaiUsage("i2v_v3").resolution === "unspecified", "openai entry unspecified for i2v_v3");
ok(openaiUsage("t2v").duration === 5, "openai entry usage duration");
ok(openaiUsage("happyhorse").resolution === "720p", "openai entry keeps resolution when upstream has it");
ok(openaiUsage("seedance20", { resolution: "480p" }).resolution === "480p", "openai entry keeps explicit 480p");
// ctx.upstreamModel 优先于请求体里的 model（与 buildSubmitRequest 同一优先级），
// 否则模型重定向后用量维度会按客户端展示名算，与实际上游模型不符。
ok(
  plugin.extractUsage({
    apiKey: API_KEY,
    upstreamModel: "i2v",
    requestBody: plugin.protocols.openai_responses.decodeRequest(
      responsesCtx({ model: "minimax-h3", prompt: "x" }),
    ).requestBody,
  }).resolution === "unspecified",
  "upstreamModel wins over body model for usage dimension",
);

// ---- 火山 render ----
const created = plugin.native.taskCreated({}, { task_id: "pub-1" });
ok(eq(created, { id: "pub-1" }), "ark taskCreated shape");
const arkStatus = plugin.native.taskStatus(
  {},
  {
    task_id: "pub-1",
    model: "seedance20",
    status: "SUCCESS",
    progress: "100%",
    data: { id: "up-1", model: "seedance20", status: "COMPLETED", output: { url: "https://cdn.test/v.mp4" }, input: { duration: 8, resolution: 720, ratio: "16:9" } },
  },
);
ok(arkStatus.id === "pub-1" && arkStatus.status === "succeeded", "ark taskStatus success status");
ok(arkStatus.content.video_url === "https://cdn.test/v.mp4", "ark taskStatus content.video_url");
ok(arkStatus.content.resolution === "720p", "ark taskStatus content.resolution");
ok(arkStatus.ratio === "16:9", "ark taskStatus ratio");
ok(arkStatus.duration === 8, "ark taskStatus duration");
ok(arkStatus.progress === 100, "ark taskStatus progress");
ok(
  plugin.native.taskStatus({}, { task_id: "p", status: "IN_PROGRESS", progress: "50%", data: {} }).status === "running",
  "ark taskStatus running",
);
ok(plugin.native.taskStatus({}, { task_id: "p", status: "QUEUED", progress: "0%", data: {} }).status === "queued", "ark taskStatus queued");
const arkFailed = plugin.native.taskStatus({}, { task_id: "p", status: "FAILURE", progress: "100%", data: { output: { error: "content rejected" } } });
ok(arkFailed.status === "failed" && arkFailed.error.message === "content rejected", "ark taskStatus failure error");
ok(plugin.native.taskStatus({}, { task_id: "p", status: "QUEUED", data: {} }).status === "queued", "ark taskStatus never unknown");
ok(plugin.native.error({}, { code: 1, message: "x" }).error.message === "x", "ark error renderer");

// ---------------------------------------------------------------------------
// 全链路流程（本地 mock 上游 + 真实 fetch，走完提交→轮询→制品回源→渲染）
//
// 这块原先是独立的 `aivideomaker.e2e.mjs`，但它**不联网**（全部走 127.0.0.1 上的 mock 服务），
// 按 skill 的约定不能占「真实层」名额——那会让闸门把一个 mock 当成「上游认了」，
// 正是「离线全绿只证明函数对」要防的假绿。运行器按文件名后缀判层，而
// `<key>.<别的名字>.test.mjs` 会把插件 key 推错，所以并进这里（contract 层）。
// 真实上游那一层由 aivideomaker.live.mjs 负责。
// ---------------------------------------------------------------------------

// 带 detail 的断言：失败时把实际值打到 stderr，便于定位（用例名仍与 ok() 同粒度）。
function okFlow(cond, name, extra) {
  ok(cond, name);
  if (!cond && extra !== undefined) console.error("  detail: " + JSON.stringify(extra));
}

const MP4 = Buffer.from("fake-mp4");
const received = [];
const state = { apiPolls: 0, webPolls: 0 };

function envelope(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
const AUTH_FAIL = {
  status: "FAILED",
  errorCode: "AUTH_FAILED",
  message: "Invalid API key. Please check your API key.",
};

const server = http.createServer(function (req, res) {
  let raw = "";
  req.on("data", function (chunk) {
    raw += chunk;
  });
  req.on("end", function () {
    const url = new URL(req.url, "http://127.0.0.1");
    const entry = { method: req.method, path: url.pathname, query: url.search, headers: req.headers, body: raw };
    received.push(entry);
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (_err) {
      body = null;
    }

    // 官方 API：提交
    if (req.method === "POST" && url.pathname === "/api/v1/generate/minimax") {
      if (req.headers.key !== "ak_test") return envelope(res, 401, AUTH_FAIL);
      const required = ["content", "imageUrl", "lastFrameUrl", "referenceImageUrls", "aspectRatio", "duration", "resolution", "tier"];
      for (const field of required) {
        if (!(field in (body || {}))) {
          return envelope(res, 400, { status: "FAILED", errorCode: "VALIDATION_ERROR", message: "missing " + field });
        }
      }
      if (!String(body.content).trim()) {
        return envelope(res, 400, { status: "FAILED", errorCode: "VALIDATION_ERROR", message: "empty content" });
      }
      if (body.duration < 5 || body.duration > 20) {
        return envelope(res, 400, { status: "FAILED", errorCode: "VALIDATION_ERROR", message: "bad duration" });
      }
      return envelope(res, 200, {
        taskId: "task-api-1",
        status: "queueing",
        duration: body.duration,
        resolution: body.resolution,
        credits: 0,
      });
    }

    // 官方 API：查询
    if (req.method === "GET" && url.pathname.indexOf("/api/v1/tasks/") === 0) {
      if (req.headers.key !== "ak_test") return envelope(res, 401, AUTH_FAIL);
      const id = url.pathname.slice("/api/v1/tasks/".length);
      if (id !== "task-api-1") return envelope(res, 404, { status: "FAILED", errorCode: "NOT_FOUND", message: "task not found" });
      state.apiPolls += 1;
      if (state.apiPolls === 1) {
        return envelope(res, 200, { taskId: id, status: "processing", progress: "40%" });
      }
      return envelope(res, 200, {
        taskId: id,
        status: "succeed",
        url: origin + "/cdn/video.mp4",
        duration: 5,
        resolution: "480p",
        credits: 12,
      });
    }

    // 网页会话：提交（tRPC 信封）
    if (req.method === "POST" && url.pathname === "/api/ai.minimaxH3") {
      if (req.headers.cookie !== "sid=abc") return envelope(res, 401, AUTH_FAIL);
      const json = body && body["0"] && body["0"].json;
      if (!json) {
        return envelope(res, 500, {
          error: { json: { message: "Cannot destructure property 'json' of 'e' as it is null.", code: -32603 } },
        });
      }
      return envelope(res, 200, [{ result: { data: { json: "task-web-1" } } }]);
    }

    // 网页会话：查询（列表端点，按 id 定位）
    if (req.method === "GET" && url.pathname === "/api/model.listModel") {
      if (req.headers.cookie !== "sid=abc") return envelope(res, 401, AUTH_FAIL);
      const input = JSON.parse(decodeURIComponent(url.searchParams.get("input") || "{}"));
      if (!input["0"] || !input["0"].json || input["0"].json.userId !== "u-1") {
        return envelope(res, 200, [{ result: { data: { json: { models: [{ id: "someone-else", taskStatus: "succeed", url: origin + "/cdn/other.mp4" }] } } } }]);
      }
      state.webPolls += 1;
      const record =
        state.webPolls === 1
          ? { id: "task-web-1", taskStatus: "processing" }
          : { id: "task-web-1", taskStatus: "succeed", url: origin + "/cdn/video.mp4", duration: 5, resolution: "480p", credits: 12 };
      return envelope(res, 200, [{ result: { data: { json: { models: [record] } } } }]);
    }

    // 公有 CDN：回源不得带渠道鉴权
    if (req.method === "GET" && url.pathname === "/cdn/video.mp4") {
      if (req.headers.key || req.headers.cookie || req.headers.authorization) {
        res.writeHead(400);
        return res.end("credential leaked");
      }
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": MP4.length });
      return res.end(MP4);
    }

    res.writeHead(404);
    res.end("not found");
  });
});

await new Promise(function (resolve) {
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
const origin = "http://127.0.0.1:" + port;
const VIDEO_URL = origin + "/cdn/video.mp4";

async function call(request) {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" ? undefined : JSON.stringify(request.body),
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    /* 保持字符串 */
  }
  return { status: response.status, body: parsed };
}

async function runFlow(label, apiKey, expectedTaskId, scenario) {
  const ctx = { apiKey: apiKey, baseUrl: origin, upstreamModel: "minimax-h3" };
  state.apiPolls = 0;
  state.webPolls = 0;

  // 1) 协议 decode
  const decoded = plugin.protocols.openai_responses.decodeRequest({
    body: { kind: "json", value: scenario.request },
  });
  ctx.requestBody = decoded.requestBody;
  okFlow(decoded.action === scenario.action, label + " action", decoded.action);

  // 2) 提交期用量
  const usage = plugin.extractUsage(ctx);
  okFlow(usage.duration === scenario.duration && usage.resolution === scenario.resolution, label + " usage", usage);

  // 3) 提交（真实 HTTP）
  const submit = plugin.buildSubmitRequest(ctx);
  const submitted = await call(submit);
  okFlow(submitted.status === 200, label + " submit http 200", submitted);

  // 真实序列化后服务端收到的 body：图片必须落在正确的槽位上
  const submitPath = new URL(submit.url).pathname;
  const submitEntry = received
    .filter(function (entry) {
      return entry.method === "POST" && entry.path === submitPath;
    })
    .pop();
  const rawSent = JSON.parse(submitEntry.body);
  const sent = rawSent && rawSent["0"] && rawSent["0"].json ? rawSent["0"].json : rawSent;
  okFlow(sent.imageUrl === scenario.slots.imageUrl, label + " imageUrl slot", sent.imageUrl);
  okFlow(sent.lastFrameUrl === scenario.slots.lastFrameUrl, label + " lastFrameUrl slot", sent.lastFrameUrl);
  okFlow(eq(sent.referenceImageUrls, scenario.slots.referenceImageUrls), label + " referenceImageUrls slot", sent.referenceImageUrls);
  const parsedSubmit = plugin.parseSubmitResponse(ctx, submitted);
  okFlow(parsedSubmit.taskId === expectedTaskId, label + " task id", parsedSubmit.taskId);

  // 4) 轮询直到终态
  let result = null;
  let lastBody = null;
  for (let i = 0; i < 5; i += 1) {
    const query = plugin.buildQueryRequest(Object.assign({}, ctx, { taskId: parsedSubmit.taskId }));
    const response = await call(query);
    lastBody = response.body;
    result = plugin.parseTaskResult(Object.assign({}, ctx, { taskId: parsedSubmit.taskId }), response.body, { status: response.status });
    if (result.status === "SUCCESS" || result.status === "FAILURE") break;
  }
  okFlow(result.status === "SUCCESS", label + " reaches SUCCESS", result);
  okFlow(result.url === VIDEO_URL, label + " result url", result.url);

  // 5) 制品与回源（credentialless）
  const task = { status: result.status, url: result.url, data: lastBody, task_id: "pub-1" };
  const artifacts = plugin.listArtifacts(task);
  okFlow(artifacts.length === 1 && artifacts[0].key === "video", label + " artifacts", artifacts);
  const contentRequest = plugin.buildContentRequest({
    artifactKey: "video",
    url: task.url,
    data: task.data,
    clientRequest: { method: "GET" },
  });
  okFlow(contentRequest.credentialless === true, label + " credentialless");
  const media = await call(contentRequest);
  okFlow(media.status === 200 && media.body === MP4.toString(), label + " media fetched", media.status);

  // 6) 完成期用量回填
  const complete = plugin.extractUsageOnComplete(task, result, lastBody);
  okFlow(complete && complete.duration === 5 && complete.resolution === "480p", label + " onComplete usage", complete);

  // 7) 渲染
  const final = plugin.protocols.openai_responses.renderFinal({ url: task.url, artifacts: { video: { url: task.url } } });
  okFlow(final.output[0].content[0].text.indexOf('<video controls src="' + VIDEO_URL + '">') === 0, label + " renderFinal", final.output[0].content[0].text);

  return parsedSubmit.taskId;
}

// 真实待测图片（实测 2560x1440，16:9）
const IMAGE = "https://s3ai.cn/cdn/20260901/53bbd0874ac247549beb8cb0226b5e66.jpg";

const SCENARIOS = {
  text: {
    request: { model: "minimax-h3", prompt: "a cat riding a bike", duration: 5, resolution: "480p" },
    action: "text_to_video",
    duration: 5,
    resolution: "480p",
    slots: { imageUrl: null, lastFrameUrl: null, referenceImageUrls: [] },
  },
  image: {
    request: { model: "minimax-h3", prompt: "slow push in, cinematic", images: [IMAGE], duration: 5, resolution: "480p" },
    action: "image_to_video",
    duration: 5,
    resolution: "480p",
    slots: { imageUrl: IMAGE, lastFrameUrl: null, referenceImageUrls: [] },
  },
  firstTail: {
    request: { model: "minimax-h3", prompt: "morph between frames", images: [IMAGE, IMAGE + "?tail=1"], duration: 5, resolution: "480p" },
    action: "first_tail_to_video",
    duration: 5,
    resolution: "480p",
    slots: { imageUrl: IMAGE, lastFrameUrl: IMAGE + "?tail=1", referenceImageUrls: [] },
  },
};

await runFlow("api/text", "ak_test", "task-api-1", SCENARIOS.text);
await runFlow("web/text", WEB_KEY, "task-web-1", SCENARIOS.text);
await runFlow("api/image", "ak_test", "task-api-1", SCENARIOS.image);
await runFlow("web/image", WEB_KEY, "task-web-1", SCENARIOS.image);
await runFlow("api/first-tail", "ak_test", "task-api-1", SCENARIOS.firstTail);

// ---- 真实错误 envelope（上游探测到的 AUTH_FAILED 形状）----
const authFailed = plugin.parseTaskResult(
  { apiKey: "ak_test", baseUrl: origin, taskId: "task-api-1" },
  { status: "FAILED", errorCode: "AUTH_FAILED", message: "Invalid API key. Please check your API key." },
  { status: 401 },
);
okFlow(authFailed.status === "FAILURE", "auth envelope -> FAILURE", authFailed);
okFlow(authFailed.reason.indexOf("[AUTH_FAILED]") === 0, "reason carries errorCode", authFailed.reason);

// ---- 传输层错误必须抛错让宿主重试，不能落终态 ----
let retried = false;
try {
  plugin.parseTaskResult({ apiKey: "ak_test", baseUrl: origin, taskId: "task-api-1" }, { status: "processing" }, { status: 503 });
} catch (_err) {
  retried = true;
}
okFlow(retried, "503 throws for retry");

// ---- 提交阶段鉴权失败：无 task id，必须抛错 ----
let submitBlocked = false;
try {
  plugin.parseSubmitResponse({ apiKey: "ak_bad", baseUrl: origin }, { status: 401, body: AUTH_FAIL });
} catch (_err) {
  submitBlocked = true;
}
okFlow(submitBlocked, "submit without task id throws");

// ---- 回源请求确实没带渠道凭据 ----
const cdnHits = received.filter(function (entry) {
  return entry.path === "/cdn/video.mp4";
});
okFlow(cdnHits.length === 5, "one cdn fetch per flow", cdnHits.length);
okFlow(
  cdnHits.every(function (entry) {
    return !entry.headers.key && !entry.headers.cookie;
  }),
  "cdn fetched without channel credentials",
);

server.close();

console.log("\npassed=" + passed + " failed=" + failed);
if (failed > 0) process.exit(1);
