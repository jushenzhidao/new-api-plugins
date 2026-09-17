// fal-minimax-h3-max 1.0.0 合同测试（纯函数，无网络）
import * as plugin from "./plugin.js";

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error("FAIL: " + name);
  }
}
function throws(fn, name) {
  try {
    fn();
    failed += 1;
    console.error("FAIL (no throw): " + name);
  } catch (_) {
    passed += 1;
  }
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const meta = plugin.meta;

// ---- meta / 仓库约定 ----
ok(meta.author && meta.author.name === "Jushenzhidao", "author = Jushenzhidao");
ok(Array.isArray(meta.channelTypes) && meta.channelTypes[0] === 10005, "channelTypes = [10005]");
ok(meta.version === "1.0.0", "version matches directory");
ok(meta.key === "fal-minimax-h3-max", "key");
// query 路由必须包含 :task_id 占位符
const queryRoute = meta.routes.find(function (r) { return r.type === "query"; });
ok(queryRoute && queryRoute.path.indexOf(":task_id") >= 0 && queryRoute.taskIdParam === "task_id", "query route placeholder");
ok(meta.routes.filter(function (r) { return r.type === "submit"; }).every(function (r) { return r.decode && r.render; }), "submit routes have decode+render");
ok(!queryRoute.decode, "query route has no decode");

// ---- 原生同构 decode：保真 ----
const isoInput = {
  prompt: "a cat",
  duration: 0,
  resolution: "480P",
  enable_safety_checker: false,
  seed: 0,
  sync_mode: false,
  aspect_ratio: "9:16",
  unknown_vendor_field: { nested: [1, 2, 3], keep: null },
  explicit_null: null,
};
const isoDecoded = plugin.native.createTextToVideo({ body: { kind: "json", value: isoInput } });
ok(isoDecoded.kind === "submit" && isoDecoded.model === "minimax/h3-max/text-to-video", "iso decode intent");
ok(isoDecoded.action === "text_to_video", "iso decode action");
ok(isoDecoded.requestBody.adapterMode === "isomorphic", "iso adapterMode");
ok(deepEqual(Object.keys(isoDecoded), ["kind", "model", "action", "requestBody"]), "decoder returns only canonical intent fields");

// buildSubmitRequest 同构：深度相等 + 允许差异清单（仅删 model）
const isoSubmit = plugin.buildSubmitRequest({
  requestBody: isoDecoded.requestBody,
  upstreamModel: "minimax/h3-max/text-to-video",
  apiKey: "FAKE",
  baseUrl: "https://queue.fal.run",
});
ok(isoSubmit.url === "https://queue.fal.run/minimax/h3-max/text-to-video", "iso submit url");
ok(isoSubmit.method === "POST", "iso submit method");
ok(isoSubmit.headers.Authorization === "Key FAKE", "fal Key auth scheme");
ok(deepEqual(isoSubmit.body, isoInput), "iso body deep-equal (false/0/null/unknown fields preserved)");
ok(isoSubmit.body.duration === 0 && isoSubmit.body.enable_safety_checker === false && isoSubmit.body.explicit_null === null, "falsy values preserved");

// 同构 body 中携带 model 时应被剥离（fal input schema 无 model 字段）
const isoWithModel = plugin.native.createImageToVideo({ body: { kind: "json", value: { prompt: "p", model: "x", image_url: "https://a/b.jpg" } } });
const isoWithModelSubmit = plugin.buildSubmitRequest({ requestBody: isoWithModel.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(!("model" in isoWithModelSubmit.body), "model stripped from iso body");
ok(isoWithModelSubmit.url.endsWith("/minimax/h3-max/image-to-video"), "iso i2v endpoint from decoder when no upstreamModel");

// 无 prompt 拒绝
throws(function () { plugin.native.createTextToVideo({ body: { kind: "json", value: { duration: 5 } } }); }, "iso requires prompt");
throws(function () { plugin.native.createTextToVideo({ body: { kind: "form", value: {} } }); }, "iso requires json");

// ---- 异构 openai_video decode ----
function decodeOV(value, ctxExtra) {
  return plugin.protocols.openai_video.decodeRequest(Object.assign({ body: { kind: "json", value: value }, model: "" }, ctxExtra || {}));
}

// t2v：纯文本
const ovT2V = decodeOV({ prompt: "hello", seconds: 10, size: "768P", metadata: { aspect_ratio: "16:9", seed: 42, prompt_expansion_mode: "quality" } });
ok(ovT2V.requestBody.adapterMode === "heterogeneous", "ov heterogeneous");
ok(ovT2V.requestBody.endpoint === "minimax/h3-max/text-to-video", "ov t2v endpoint inference");
const ovT2VBody = plugin.buildSubmitRequest({ requestBody: ovT2V.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(deepEqual(ovT2VBody.body, { prompt: "hello", duration: 10, resolution: "768P", seed: 42, prompt_expansion_mode: "quality", aspect_ratio: "16:9" }), "ov t2v encoded body");
ok(ovT2VBody.action === "text_to_video", "ov t2v action");

// i2v：input_reference URL -> image_url
const ovI2V = decodeOV({ prompt: "move", input_reference: "https://img.example/a.jpg", seconds: 5 });
ok(ovI2V.requestBody.endpoint === "minimax/h3-max/image-to-video", "ov i2v endpoint inference");
const ovI2VBody = plugin.buildSubmitRequest({ requestBody: ovI2V.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(ovI2VBody.body.image_url === "https://img.example/a.jpg" && !("aspect_ratio" in ovI2VBody.body), "ov i2v image_url mapped, no aspect_ratio");
ok(ovI2VBody.url.endsWith("/minimax/h3-max/image-to-video"), "ov i2v url");

// i2v end_image_url
const ovI2V2 = decodeOV({ prompt: "p", input_reference: "https://a/1.jpg", metadata: { end_image_url: "https://a/2.jpg" } });
const ovI2V2Body = plugin.buildSubmitRequest({ requestBody: ovI2V2.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(ovI2V2Body.body.end_image_url === "https://a/2.jpg", "ov end_image_url mapped");

// r2v：参考图
const ovR2V = decodeOV({ prompt: "Image 1 is her", metadata: { reference_image_urls: ["https://a/1.jpg", "https://a/2.jpg"], aspect_ratio: "adaptive" } });
ok(ovR2V.requestBody.endpoint === "minimax/h3-max/reference-to-video", "ov r2v endpoint inference");
const ovR2VBody = plugin.buildSubmitRequest({ requestBody: ovR2V.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(deepEqual(ovR2VBody.body.reference_image_urls, ["https://a/1.jpg", "https://a/2.jpg"]), "ov r2v reference images");
ok(ovR2VBody.body.aspect_ratio === "adaptive", "ov r2v adaptive ratio allowed");

// 显式模型优先于媒体形态
const ovExplicit = decodeOV({ prompt: "p", model: "minimax/h3-max/text-to-video" });
ok(ovExplicit.requestBody.endpoint === "minimax/h3-max/text-to-video", "explicit model wins");
// upstreamModel 在 buildSubmitRequest 覆盖 decoder 记录的端点
const ovMapped = plugin.buildSubmitRequest({ requestBody: ovT2V.requestBody, upstreamModel: "minimax/h3-max/text-to-video", apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(ovMapped.url.endsWith("/minimax/h3-max/text-to-video"), "upstreamModel pins endpoint");

// 未知客户端字段不泄漏
const ovLeak = decodeOV({ prompt: "p", secret_client_field: "x", metadata: { internal: "y" } });
const ovLeakBody = plugin.buildSubmitRequest({ requestBody: ovLeak.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(!("secret_client_field" in ovLeakBody.body) && !("internal" in ovLeakBody.body), "no client field leak");

// 反例
throws(function () { decodeOV({ seconds: 5 }); }, "ov requires prompt");
throws(function () { decodeOV({ prompt: "p", size: "1080P" }); }, "ov invalid resolution");
throws(function () { decodeOV({ prompt: "p", seconds: 2.5 }); }, "ov non-integer duration");
throws(function () { decodeOV({ prompt: "p", metadata: { reference_audio_urls: ["https://a/1.mp3"] } }); }, "audio-only reference rejected");
throws(function () { decodeOV({ prompt: "p", input_reference: "https://a/1.jpg", metadata: { reference_image_urls: ["https://a/2.jpg"] } }); }, "frame+reference mix rejected");
throws(function () { decodeOV({ prompt: "p", model: "minimax/h3-max/text-to-video", input_reference: "https://a/1.jpg" }); }, "t2v with image rejected");
throws(function () { decodeOV({ prompt: "p", metadata: { reference_image_urls: ["not-a-url"] } }); }, "non-url reference rejected");
throws(function () {
  const urls = [];
  for (let i = 0; i < 13; i++) urls.push("https://a/" + i + ".jpg");
  decodeOV({ prompt: "p", metadata: { reference_image_urls: urls } });
}, "13 reference files rejected");
throws(function () { decodeOV({ prompt: "p", metadata: { aspect_ratio: "adaptive" } }); }, "t2v adaptive ratio rejected");

// multipart：input_reference 文件占位符
const ovMultipart = plugin.protocols.openai_video.decodeRequest({
  model: "",
  body: { kind: "multipart", fields: { prompt: ["p"], seconds: ["5"] }, files: [{ field: "input_reference" }] },
});
ok(ovMultipart.requestBody.endpoint === "minimax/h3-max/image-to-video", "multipart file -> i2v");
const ovMPBody = plugin.buildSubmitRequest({ requestBody: ovMultipart.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(ovMPBody.body.image_url && ovMPBody.body.image_url.__fileRef === "request_file:input_reference", "file placeholder preserved");

// driver 缺 envelope 报错
throws(function () { plugin.buildSubmitRequest({ requestBody: { prompt: "p" }, apiKey: "K" }); }, "missing adapter mode rejected");

// ---- parseSubmitResponse ----
const submitReceipt = {
  request_id: "764cabcf-b745-4b3e-ae38-1200304cf45b",
  response_url: "https://queue.fal.run/minimax/h3-max/requests/764cabcf/response",
  status_url: "https://queue.fal.run/minimax/h3-max/requests/764cabcf/status",
  queue_position: 0,
};
const parsedSubmit = plugin.parseSubmitResponse({}, { body: submitReceipt });
ok(parsedSubmit.taskId === "764cabcf-b745-4b3e-ae38-1200304cf45b", "submit taskId = request_id");
ok(parsedSubmit.taskData === submitReceipt, "full receipt persisted");
throws(function () { plugin.parseSubmitResponse({}, { body: { detail: "Invalid API key" } }); }, "submit error rejected");
throws(function () { plugin.parseSubmitResponse({}, { body: {} }); }, "missing request_id rejected");

// ---- buildQueryRequest ----
const query = plugin.buildQueryRequest({ taskId: "abc/123", apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(query.url === "https://queue.fal.run/minimax/h3-max/requests/abc%2F123", "query url uses base app + encoded id");
ok(query.method === "GET" && query.headers.Authorization === "Key K", "query method/auth");

// ---- parseTaskResult 状态阶梯 ----
function parse(body, http) {
  return plugin.parseTaskResult({ taskId: "t" }, body, { status: http });
}
// 层 1：response 端点 400 + request_in_progress
const rInProgress = parse({ detail: { type: "request_in_progress", msg: "still running" } }, 400);
ok(rInProgress.status === "IN_PROGRESS", "400 request_in_progress -> IN_PROGRESS");
// 成功：200 + video.url
const rSuccess = parse({ video: { url: "https://v3b.fal.media/files/b/x.mp4", content_type: "video/mp4" }, seed: 1 }, 200);
ok(rSuccess.status === "SUCCESS" && rSuccess.progress === "100%" && rSuccess.url === "https://v3b.fal.media/files/b/x.mp4", "success with url+progress");
// 失败：4xx + FalErrorResponse
const rFail = parse({ detail: { type: "generation_failed", msg: "content policy violation" } }, 422);
ok(rFail.status === "FAILURE" && rFail.reason === "content policy violation", "4xx failure with reason");
// 字符串 detail
const rFailStr = parse({ detail: "request expired" }, 410);
ok(rFailStr.status === "FAILURE" && rFailStr.reason === "request expired", "string detail failure");
// FastAPI 数组 detail
const rFailArr = parse({ detail: [{ type: "value_error", msg: "bad input", loc: ["body"] }] }, 400);
ok(rFailArr.status === "FAILURE" && rFailArr.reason === "bad input", "array detail failure");
// 5xx / 408 / 429 抛错重试
throws(function () { parse({ detail: "internal error" }, 500); }, "5xx throws for retry");
throws(function () { parse({}, 429); }, "429 throws for retry");
throws(function () { parse({}, 408); }, "408 throws for retry");
// status 端点形态防御：IN_QUEUE / IN_PROGRESS / COMPLETED+error
ok(parse({ status: "IN_QUEUE", queue_position: 2 }, 200).status === "QUEUED", "IN_QUEUE -> QUEUED");
ok(parse({ status: "IN_PROGRESS" }, 200).status === "IN_PROGRESS", "IN_PROGRESS -> IN_PROGRESS");
const rStatusFail = parse({ status: "COMPLETED", error: "worker crashed", error_type: "generation_failed" }, 200);
ok(rStatusFail.status === "FAILURE" && rStatusFail.reason === "worker crashed", "COMPLETED+error -> FAILURE");
ok(parse({ status: "COMPLETED" }, 200).status === "IN_PROGRESS", "COMPLETED without payload keeps polling");
// 层 3 前缀反例：not_completed 不得 SUCCESS
const rNotCompleted = parse({ status: "not_completed" }, 200);
ok(rNotCompleted.status !== "SUCCESS", "not_completed never SUCCESS");
// 层 4 反例：非法 URL 不算成功
ok(parse({ video: { url: "not-a-url" } }, 200).status !== "SUCCESS", "invalid video url not success");
// 200 但有失败信号时不判成功
ok(parse({ video: { url: "https://v/x.mp4" }, error: "failed" }, 200).status !== "SUCCESS", "url + error not success");
// 层 6：完全未知 -> QUEUED，绝不 UNKNOWN
const rUnknown = parse({ status: "SOMETHING_ELSE" }, 200);
ok(rUnknown.status === "QUEUED", "unknown -> QUEUED (never UNKNOWN)");
// 字符串 body 兼容
ok(parse(JSON.stringify({ video: { url: "https://v/x.mp4" } }), 200).status === "SUCCESS", "string json body parsed");
// 老宿主兼容：第三参缺失时读 ctx.response
const rLegacy = plugin.parseTaskResult({ taskId: "t", response: { status: 400 } }, { detail: { type: "request_in_progress" } });
ok(rLegacy.status === "IN_PROGRESS", "legacy ctx.response fallback");

// ---- usage ----
const usageIso = plugin.extractUsage({ requestBody: isoDecoded.requestBody, usagePurpose: "" });
ok(usageIso.seconds === DEFAULT_OR(isoInput.duration) && usageIso.resolution === "480P", "iso usage from payload");
function DEFAULT_OR(d) { return Number.isFinite(Number(d)) && Number(d) > 0 ? Number(d) : 5; }
const usageHet = plugin.extractUsage({ requestBody: ovT2V.requestBody, usagePurpose: "" });
ok(usageHet.seconds === 10 && usageHet.resolution === "768P", "het usage from normalized model");
ok(plugin.extractUsage({ requestBody: ovT2V.requestBody, usagePurpose: "billing_ratios" }) === null, "billing_ratios null");
const usageDefault = plugin.extractUsage({ requestBody: plugin.native.createTextToVideo({ body: { kind: "json", value: { prompt: "p" } } }).requestBody, usagePurpose: "" });
ok(usageDefault.seconds === 5 && usageDefault.resolution === "768P", "defaults 5s/768P");

// ---- artifacts ----
const doneTask = { status: "SUCCESS", task_id: "t1", data: { video: { url: "https://v3b.fal.media/files/x.mp4", content_type: "video/mp4", file_size: 100 }, seed: 7 } };
const artifacts = plugin.listArtifacts(doneTask);
ok(artifacts.length === 1 && artifacts[0].key === "video" && artifacts[0].mimeType === "video/mp4", "artifact listed");
ok(!("url" in artifacts[0]), "listArtifacts does not leak url");
ok(plugin.listArtifacts({ status: "IN_PROGRESS", data: doneTask.data }).length === 0, "no artifacts before success");
ok(plugin.listArtifacts({ status: "SUCCESS", data: {} }).length === 0, "no artifacts without url");
ok(plugin.listArtifacts({ status: "SUCCESS", data: { video: { url: "data:video/mp4;base64,AAAA" } } }).length === 0, "data uri not listed as artifact");
// 嵌套 envelope { task_id, data: {...} }
ok(plugin.listArtifacts({ status: "SUCCESS", data: { task_id: "t", data: doneTask.data } }).length === 1, "nested envelope artifact");
const content = plugin.buildContentRequest(Object.assign({}, doneTask, { artifactKey: "video", clientRequest: { method: "GET" } }));
ok(content.url === "https://v3b.fal.media/files/x.mp4" && content.credentialless === true && !content.headers, "content credentialless, no channel auth");
const contentHead = plugin.buildContentRequest(Object.assign({}, doneTask, { artifactKey: "video", clientRequest: { method: "HEAD" } }));
ok(contentHead.method === "HEAD", "HEAD passthrough");
throws(function () { plugin.buildContentRequest(Object.assign({}, doneTask, { artifactKey: "nope", clientRequest: { method: "GET" } })); }, "unknown artifact key");

// ---- native renderers ----
const created = plugin.native.createdVideo({}, { task_id: "pub-1", data: submitReceipt });
ok(created.id === "pub-1" && created.request_id === submitReceipt.request_id && created.status_url === submitReceipt.status_url, "created render passthrough + public id");
const queried = plugin.native.queryVideo({}, { task_id: "pub-1", status: "SUCCESS", data: doneTask.data });
ok(queried.id === "pub-1" && queried.status === "COMPLETED" && queried.video.url === doneTask.data.video.url, "query render passthrough with result");
const queriedPending = plugin.native.queryVideo({}, { task_id: "pub-1", status: "IN_PROGRESS", data: { request_id: "r" } });
ok(queriedPending.status === "IN_PROGRESS" && queriedPending.id === "pub-1", "query render pending");
const queriedFailed = plugin.native.queryVideo({}, { task_id: "pub-1", status: "FAILURE", fail_reason: "boom", data: {} });
ok(queriedFailed.status === "COMPLETED" && queriedFailed.error === "boom", "query render failure fal-style");

// ---- openai_video render ----
const ovRender = plugin.protocols.openai_video.render({}, { task_id: "pub-1", status: "SUCCESS", progress: "100%", created_at: 1, updated_at: 2 });
ok(ovRender.status === "completed" && ovRender.progress === 100 && ovRender.object === "video", "openai_video render success");
const ovRenderFail = plugin.protocols.openai_video.render({}, { task_id: "pub-1", status: "FAILURE", fail_reason: "bad", created_at: 1 });
ok(ovRenderFail.status === "failed" && ovRenderFail.error.message === "bad", "openai_video render failure");

console.log("\npassed=" + passed + " failed=" + failed);
if (failed > 0) process.exit(1);
