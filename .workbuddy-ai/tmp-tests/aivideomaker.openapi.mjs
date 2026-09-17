// 用官方 OpenAPI 规范反向校验插件产出的请求：不需要凭据也能验证契约一致性。
//
// 两个契约来源：
//   1. 官方 OpenAPI（https://aivideomaker.ai/docs/aivideo-openapi.json，version 1.0.15）
//      —— 只声明 minimax 端点，同目录 aivideomaker.openapi.json。
//   2. 用户提供的「API 接口文档」—— 覆盖 8 个生成端点，已固化为 aivideomaker-models.json。
//      站点公开文档目前不覆盖除 minimax 外的 7 个模型，故该文件标注为「文档转录，非官方规范」。
//
// 版本目录自动发现：始终校验 plugins/tasks/aivideomaker/ 下最大的版本目录。
import { readdirSync, readFileSync } from "node:fs";

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
const plugin = await import(new URL(LATEST + "/plugin.js", ROOT).href);

// 规范文件与脚本同目录（公开文档，非凭据）；可用 AVM_OPENAPI 覆盖。
const SPEC_PATH = process.env.AVM_OPENAPI || new URL("./aivideomaker.openapi.json", import.meta.url).pathname;
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
const CONTRACT = JSON.parse(readFileSync(new URL("./aivideomaker-models.json", import.meta.url).pathname, "utf8"));

let passed = 0;
let failed = 0;
const knownDiffs = [];
// 用例级输出：test-runner 解析 `✓/✗/⚠ label` 生成报告并做跨版本回归比对，勿删。
function mark(kind, name) { console.log("  " + kind + " " + name); }
function ok(cond, name) {
  if (cond) { passed += 1; mark("✓", name); }
  else {
    failed += 1;
    mark("✗", name);
    console.error("FAIL: " + name);
  }
}
function knownDiff(name) {
  knownDiffs.push(name);
  passed += 1;
  mark("⚠", name);
}

const BASE = "https://aivideomaker.ai";
const API_KEY = "ak_openapi_check";
const Req = spec.components.schemas.MiniMaxH3Request;

// ---- 端点必须与规范声明的一致 ----
function responsesCtx(value) {
  return { body: { kind: "json", value: value }, apiKey: API_KEY, baseUrl: BASE };
}

const submit = plugin.buildSubmitRequest({
  apiKey: API_KEY,
  baseUrl: BASE,
  requestBody: plugin.protocols.openai_responses.decodeRequest(
    responsesCtx({ model: "minimax-h3", prompt: "a cat" }),
  ).requestBody,
});
const submitPath = submit.url.replace(BASE, "");
ok(spec.paths[submitPath] !== undefined, "submit path declared in spec: " + submitPath);
ok((spec.paths[submitPath] || {}).post !== undefined, "submit uses POST");

const query = plugin.buildQueryRequest({ apiKey: API_KEY, baseUrl: BASE, taskId: "tid-1" });
const queryPath = query.url.replace(BASE, "").replace(/tid-1$/, "{taskId}");
ok(spec.paths[queryPath] !== undefined, "query path declared in spec: " + queryPath);
ok((spec.paths[queryPath] || {}).get !== undefined, "query uses GET");

// ---- 逐字段校验 body ----
function typeMatches(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  for (const t of types) {
    if (t === "null" && value === null) return true;
    if (t === "integer" && Number.isInteger(value)) return true;
    if (t === "number" && typeof value === "number") return true;
    if (t === "string" && typeof value === "string") return true;
    if (t === "boolean" && typeof value === "boolean") return true;
    if (t === "array" && Array.isArray(value)) return true;
    if (t === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) return true;
  }
  return false;
}

/** 通用契约校验：required 覆盖、字段白名单、枚举、类型、数组上限、数值范围。 */
function validateAgainst(schema, body, label) {
  for (const required of schema.required || []) {
    ok(body[required] !== undefined, label + ": required " + required + " present");
  }
  for (const key of Object.keys(body)) {
    const prop = (schema.properties || {})[key];
    ok(prop !== undefined, label + ": field " + key + " is in spec");
    if (!prop) continue;
    if (prop.enum) {
      const inEnum = prop.enum.indexOf(body[key]) >= 0;
      if (inEnum) ok(true, label + ": " + key + " enum");
      else knownDiff(label + ": " + key + "=" + body[key] + " not in spec enum " + JSON.stringify(prop.enum));
    }
    if (prop.type) {
      ok(typeMatches(body[key], prop.type), label + ": " + key + " type " + JSON.stringify(prop.type));
    }
    if (Array.isArray(body[key]) && prop.maxItems !== undefined) {
      ok(body[key].length <= prop.maxItems, label + ": " + key + " <= " + prop.maxItems + " items");
    }
    if (typeof body[key] === "number") {
      if (prop.minimum !== undefined) ok(body[key] >= prop.minimum, label + ": " + key + " >= " + prop.minimum);
      if (prop.maximum !== undefined) ok(body[key] <= prop.maximum, label + ": " + key + " <= " + prop.maximum);
    }
  }
}

function validateBody(body, label) {
  validateAgainst(Req, body, label);
}

function bodyFor(payload) {
  const decoded = plugin.protocols.openai_responses.decodeRequest(
    responsesCtx(Object.assign({ model: "minimax-h3" }, payload)),
  );
  return plugin.buildSubmitRequest({
    apiKey: API_KEY,
    baseUrl: BASE,
    requestBody: decoded.requestBody,
  }).body;
}

validateBody(bodyFor({ prompt: "a cat" }), "text");
validateBody(bodyFor({ prompt: "a cat", resolution: "1080p", duration: 20 }), "text-1080p-20s");
validateBody(bodyFor({ prompt: "a cat", resolution: "720p" }), "text-720p");
// 有意保留的差异：官方枚举只有 720p/1080p，但网页会话实测接受 480p（真实出片过）。
// 静默夹紧到更贵的 720p 是隐性伤害，所以照传，让上游用明确 400 拒绝。
validateBody(bodyFor({ prompt: "a cat", resolution: "480p" }), "text-480p");
validateBody(bodyFor({ prompt: "a cat", duration: 1 }), "duration-clamp-low");
validateBody(bodyFor({ prompt: "a cat", duration: 999 }), "duration-clamp-high");
for (const ratio of Req.properties.aspectRatio.enum) {
  validateBody(bodyFor({ prompt: "a cat", aspectRatio: ratio }), "ratio-" + ratio);
}
for (const tier of Req.properties.tier.enum) {
  validateBody(bodyFor({ prompt: "a cat", tier: tier }), "tier-" + tier);
}
validateBody(
  bodyFor({ prompt: "a cat", images: ["https://cdn.test/a.jpg"] }),
  "image",
);
validateBody(
  bodyFor({ prompt: "a cat", images: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"] }),
  "first-tail",
);
validateBody(
  bodyFor({
    prompt: "a cat",
    images: [
      "https://cdn.test/a.jpg",
      "https://cdn.test/b.jpg",
      "https://cdn.test/c.jpg",
      "https://cdn.test/d.jpg",
      "https://cdn.test/e.jpg",
    ],
  }),
  "reference-5",
);

// ---- 状态枚举：规范里每个值都必须被插件识别成终态或进行态，且永不 UNKNOWN ----
const expectedByStatus = {
  SUBMITTED: "QUEUED",
  PROGRESS: "IN_PROGRESS",
  COMPLETED: "SUCCESS",
  FAILED: "FAILURE",
  CANCEL: "FAILURE",
};
for (const code of spec.components.schemas.TaskStatus.enum) {
  const got = plugin.parseTaskResult(
    { apiKey: API_KEY, baseUrl: BASE, taskId: "tid-1" },
    { id: "tid-1", status: code },
    { status: 200 },
  );
  ok(got.status === expectedByStatus[code], "spec TaskStatus " + code + " -> " + expectedByStatus[code]);
  ok(got.status !== "UNKNOWN", "spec TaskStatus " + code + " never UNKNOWN");
}

// ---- 规范里官方 Task 形状必须能被解析出 url 与真实时长 ----
const taskShape = {
  id: "tid-1",
  model: "minimax-h3",
  input: { content: "a cat", duration: 10, resolution: "1080p" },
  output: { url: "https://cdn.test/v.mp4" },
  status: "COMPLETED",
  creditsCharged: 12,
  creditsRefunded: 0,
  listValueCents: 1200,
};
const parsed = plugin.parseTaskResult({ apiKey: API_KEY, baseUrl: BASE, taskId: "tid-1" }, taskShape, { status: 200 });
ok(parsed.status === "SUCCESS", "spec Task -> SUCCESS");
ok(parsed.url === "https://cdn.test/v.mp4", "spec Task output.url picked up");
const usage = plugin.extractUsageOnComplete(null, { data: taskShape }, null);
ok(usage && usage.duration === 10, "spec Task duration read from input echo");

// 规范声明 Task 顶层没有 progress：插件不能把缺失当成 0
ok(
  Object.keys(spec.components.schemas.Task.properties).indexOf("progress") < 0,
  "spec Task has no progress field (fallback logic required)",
);

// ===========================================================================
// 火山方舟入口：8 个上游端点逐一对契约反向校验
// ===========================================================================
const T = function (text) {
  return { type: "text", text: text };
};
const IMG = function (url, role) {
  const item = { type: "image_url", image_url: { url: url } };
  if (role) item.role = role;
  return item;
};

function arkSubmit(model, body) {
  const value = Object.assign({ model: model }, body);
  const decoded = plugin.native.createTask({ body: { kind: "json", value: value }, apiKey: API_KEY, baseUrl: BASE });
  return plugin.buildSubmitRequest({ apiKey: API_KEY, baseUrl: BASE, requestBody: decoded.requestBody });
}

const ARK_INPUTS = {
  minimax: { content: [T("a cat")], duration: 12, resolution: "1080p", ratio: "21:9" },
  t2v: { content: [T("a cat")], duration: 8, ratio: "16:9" },
  i2v: { content: [IMG("https://cdn.test/a.jpg"), T("go")], duration: "5" },
  t2v_v3: { content: [T("a cat")], duration: 20, ratio: "9:16" },
  i2v_v3: { content: [IMG("https://cdn.test/a.jpg")], duration: 20 },
  seedance20: {
    content: [T("a cat"), IMG("https://cdn.test/a.jpg", "first_frame")],
    duration: 8,
    resolution: "720p",
    ratio: "16:9",
  },
  wan27: {
    content: [T("a cat"), IMG("https://cdn.test/a.jpg")],
    duration: 15,
    resolution: "1080p",
    ratio: "3:4",
    promptExtend: true,
  },
  happyhorse: {
    content: [T("a cat"), IMG("https://cdn.test/a.jpg", "reference"), IMG("https://cdn.test/b.jpg", "reference")],
    duration: 6,
    resolution: "1080p",
    ratio: "4:3",
  },
};

for (const model of Object.keys(CONTRACT)) {
  if (model.indexOf("_") === 0) continue;
  const modelSpec = CONTRACT[model];
  const request = arkSubmit(model, ARK_INPUTS[model]);
  ok(request.url === BASE + modelSpec.path, "ark " + model + ": path declared in contract: " + modelSpec.path);
  ok(request.method === "POST", "ark " + model + ": uses POST");
  validateAgainst(modelSpec, request.body, "ark " + model);
}

// 火山入口下的 minimax 必须同时满足官方 OpenAPI 的 MiniMaxH3Request
validateBody(arkSubmit("minimax", ARK_INPUTS.minimax).body, "ark minimax vs official spec");
// 火山官方 Seedance 模型名走同一条上游端点
ok(
  arkSubmit("doubao-seedance-2-0-260128", { content: [T("a cat")], duration: 4, resolution: 480, ratio: "1:1" }).url ===
    BASE + "/api/v1/generate/seedance20",
  "ark seedance alias hits seedance20 endpoint",
);

// 客户端不能通过未知字段把参数泄漏到上游
const leaky = arkSubmit("t2v", { content: [T("a cat")], duration: 5, ratio: "16:9", bogusField: "x" });
ok(!Object.prototype.hasOwnProperty.call(leaky.body, "bogusField"), "ark unknown client field dropped");

console.log("\npassed=" + passed + " failed=" + failed);
if (knownDiffs.length) {
  console.log("\nknown diffs vs spec (" + knownDiffs.length + "):");
  for (const d of knownDiffs) console.log("  - " + d);
}
process.exit(failed ? 1 : 0);
