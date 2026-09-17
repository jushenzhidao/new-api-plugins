// fal-minimax-v2 1.0.0 合同测试（纯函数，无网络）
import * as plugin from "./plugin.js";

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL: " + name);
  }
}
function throws(fn, name, expectFragment) {
  try {
    fn();
    failed += 1;
    console.error("FAIL (no throw): " + name);
  } catch (e) {
    if (expectFragment && String(e.message).indexOf(expectFragment) < 0) {
      failed += 1;
      console.error("FAIL (wrong message): " + name + " -> " + e.message);
    } else passed += 1;
  }
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const meta = plugin.meta;

// ---- meta / 仓库约定 ----
ok(meta.author && meta.author.name === "Jushenzhidao", "author = Jushenzhidao");
ok(Array.isArray(meta.channelTypes) && meta.channelTypes[0] === 10006, "channelTypes = [10006]");
ok(meta.version === "1.0.0", "version matches directory");
ok(meta.key === "fal-minimax-v2", "key");
ok(deepEqual(meta.models, ["MiniMax-H3-Max"]), "models exposes MiniMax client model name");
const submitRoute = meta.routes.find(function (r) { return r.type === "submit"; });
const queryRoute = meta.routes.find(function (r) { return r.type === "query"; });
ok(submitRoute.path === "/fal-minimax/v2/video_generation", "submit path mirrors MiniMax /v2");
ok(queryRoute.path === "/fal-minimax/v2/query/video_generation/:task_id" && queryRoute.taskIdParam === "task_id", "query path mirrors MiniMax /v2");
ok(!queryRoute.decode, "query route has no decode");
ok(submitRoute.decode && submitRoute.render, "submit route has decode+render");

// ---- decode: 文生视频 ----
function decode(body) {
  return plugin.native.createVideo({ body: { kind: "json", value: body } });
}
function encode(decoded, ctxExtra) {
  return plugin.buildSubmitRequest(Object.assign({ requestBody: decoded.requestBody, apiKey: "K", baseUrl: "https://queue.fal.run" }, ctxExtra || {}));
}

const t2v = decode({
  model: "MiniMax-H3-Max",
  content: [{ type: "text", text: "a cat walking" }],
  resolution: "768P",
  duration: 6,
  ratio: "16:9",
});
ok(t2v.kind === "submit" && t2v.model === "MiniMax-H3-Max", "t2v canonical intent");
ok(t2v.action === "text_to_video", "t2v action");
ok(t2v.requestBody.adapterMode === "heterogeneous", "adapterMode heterogeneous");
ok(t2v.requestBody.endpoint === "minimax/h3-max/text-to-video", "t2v endpoint");
ok(deepEqual(Object.keys(t2v), ["kind", "model", "action", "requestBody"]), "decoder returns only canonical intent fields");
const t2vReq = encode(t2v);
ok(t2vReq.url === "https://queue.fal.run/minimax/h3-max/text-to-video", "t2v url");
ok(t2vReq.headers.Authorization === "Key K", "fal Key auth (not Bearer)");
ok(deepEqual(t2vReq.body, { prompt: "a cat walking", duration: 6, resolution: "768P", aspect_ratio: "16:9" }), "t2v encoded body");

// 多个 text 项拼接
const multiText = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "line1" }, { type: "text", text: "line2" }], resolution: "768P", duration: 5, ratio: "1:1" });
ok(encode(multiText).body.prompt === "line1\nline2", "multiple text items joined");

// ---- decode: 图生视频 ----
const i2vFirst = decode({
  model: "MiniMax-H3-Max",
  content: [{ type: "text", text: "move" }, { type: "image_url", image_url: { url: "https://img/a.jpg" }, role: "first_frame" }],
  resolution: "480P",
  duration: 5,
});
ok(i2vFirst.requestBody.endpoint === "minimax/h3-max/image-to-video", "i2v endpoint from first_frame");
const i2vFirstReq = encode(i2vFirst);
ok(deepEqual(i2vFirstReq.body, { prompt: "move", duration: 5, resolution: "480P", image_url: "https://img/a.jpg" }), "i2v encoded body");
ok(!("aspect_ratio" in i2vFirstReq.body), "i2v has no aspect_ratio (follows input image)");

// role 缺省即首帧
const i2vNoRole = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "https://img/a.jpg" } }], resolution: "768P", duration: 5 });
ok(i2vNoRole.requestBody.endpoint === "minimax/h3-max/image-to-video", "absent role defaults to first_frame");

// 首尾帧
const i2vBoth = decode({
  model: "MiniMax-H3-Max",
  content: [
    { type: "text", text: "p" },
    { type: "image_url", image_url: { url: "https://img/a.jpg" }, role: "first_frame" },
    { type: "image_url", image_url: { url: "https://img/b.jpg" }, role: "last_frame" },
  ],
  resolution: "768P",
  duration: 5,
});
const i2vBothReq = encode(i2vBoth);
ok(i2vBothReq.body.image_url === "https://img/a.jpg" && i2vBothReq.body.end_image_url === "https://img/b.jpg", "first+last frame mapped");

// i2v 传具体 ratio：MiniMax 语义是忽略而非报错
const i2vRatio = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "https://img/a.jpg" } }], resolution: "768P", duration: 5, ratio: "16:9" });
ok(!("aspect_ratio" in encode(i2vRatio).body), "i2v concrete ratio ignored, not rejected");

// 仅尾帧：fal 无法表达，显式拒绝
throws(function () {
  decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "https://img/b.jpg" }, role: "last_frame" }], resolution: "768P", duration: 5 });
}, "last_frame-only rejected", "last_frame-only");

// ---- decode: 参考生视频 ----
const r2v = decode({
  model: "MiniMax-H3-Max",
  content: [
    { type: "text", text: "Image 1 is her" },
    { type: "image_url", image_url: { url: "https://img/1.jpg" }, role: "reference_image" },
    { type: "image_url", image_url: { url: "https://img/2.jpg" }, role: "reference_image" },
    { type: "video_url", video_url: { url: "https://v/1.mp4" }, role: "reference_video" },
    { type: "audio_url", audio_url: { url: "https://a/1.mp3" }, role: "reference_audio" },
  ],
  resolution: "768P",
  duration: 10,
});
ok(r2v.requestBody.endpoint === "minimax/h3-max/reference-to-video", "r2v endpoint");
const r2vReq = encode(r2v);
ok(deepEqual(r2vReq.body.reference_image_urls, ["https://img/1.jpg", "https://img/2.jpg"]), "reference images order preserved");
ok(deepEqual(r2vReq.body.reference_video_urls, ["https://v/1.mp4"]), "reference videos mapped");
ok(deepEqual(r2vReq.body.reference_audio_urls, ["https://a/1.mp3"]), "reference audios mapped");
ok(r2vReq.body.aspect_ratio === "adaptive", "r2v defaults to adaptive");
const r2vConcrete = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "https://i/1.jpg" }, role: "reference_image" }], resolution: "768P", duration: 5, ratio: "9:16" });
ok(encode(r2vConcrete).body.aspect_ratio === "9:16", "r2v concrete ratio kept");

// video/audio role 缺省视为参考
const r2vNoRole = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "video_url", video_url: { url: "https://v/1.mp4" } }], resolution: "768P", duration: 5 });
ok(r2vNoRole.requestBody.endpoint === "minimax/h3-max/reference-to-video", "video_url without role -> r2v");

// 媒体形态兼容：直接字符串、宿主文件占位符
const strMedia = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: "https://img/a.jpg" }], resolution: "768P", duration: 5 });
ok(encode(strMedia).body.image_url === "https://img/a.jpg", "plain string image_url accepted");
const fileRef = { __fileRef: "request_file:image", encoding: "dataUrl" };
const fileMedia = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: fileRef }], resolution: "768P", duration: 5 });
ok(encode(fileMedia).body.image_url.__fileRef === "request_file:image", "host file placeholder preserved");
const dataURI = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }], resolution: "768P", duration: 5 });
ok(encode(dataURI).body.image_url.indexOf("data:") === 0, "data uri accepted");

// 客户端未知字段不外泄
const leak = decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5, ratio: "1:1", secret_field: "x" });
ok(!("secret_field" in encode(leak).body), "unknown client field not leaked");

// ---- 语义缺口显式拒绝 ----
throws(function () { decode({ model: "MiniMax-H3", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5, ratio: "1:1" }); }, "MiniMax-H3 rejected", "MiniMax-H3 is not served");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "2K", duration: 5, ratio: "1:1" }); }, "2K rejected", "2K is MiniMax-H3 only");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 4, ratio: "1:1" }); }, "duration 4 rejected", "between 5 and 15");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 16, ratio: "1:1" }); }, "duration 16 rejected");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5, ratio: "1:1", callback_url: "https://cb" }); }, "callback_url rejected", "callback_url is not supported");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5, ratio: "1:1", aigc_watermark: true }); }, "aigc_watermark true rejected", "aigc_watermark is not supported");
// aigc_watermark: false 等价默认，应放行
ok(decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5, ratio: "1:1", aigc_watermark: false }).action === "text_to_video", "aigc_watermark false allowed");

// ---- 校验反例 ----
throws(function () { decode({ model: "MiniMax-H3-Max", content: [], resolution: "768P", duration: 5, ratio: "1:1" }); }, "empty content rejected");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "image_url", image_url: { url: "https://i/1.jpg" } }], resolution: "768P", duration: 5 }); }, "missing text rejected", "non-empty text");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "   " }], resolution: "768P", duration: 5, ratio: "1:1" }); }, "blank text rejected");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5 }); }, "t2v missing ratio rejected", "ratio is required");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5, ratio: "adaptive" }); }, "t2v adaptive rejected", "not allowed for text-to-video");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }], resolution: "768P", duration: 5, ratio: "5:4" }); }, "invalid ratio rejected");
throws(function () {
  decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "https://i/1.jpg" }, role: "first_frame" }, { type: "image_url", image_url: { url: "https://i/2.jpg" }, role: "reference_image" }], resolution: "768P", duration: 5 });
}, "frame + reference mix rejected", "mutually exclusive");
throws(function () {
  decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "https://i/1.jpg" }, role: "first_frame" }, { type: "image_url", image_url: { url: "https://i/2.jpg" }, role: "first_frame" }], resolution: "768P", duration: 5 });
}, "two first_frame rejected");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "audio_url", audio_url: { url: "https://a/1.mp3" }, role: "reference_audio" }], resolution: "768P", duration: 5 }); }, "audio-only reference rejected", "only reference input");
throws(function () {
  const items = [{ type: "text", text: "p" }];
  for (let i = 0; i < 10; i++) items.push({ type: "image_url", image_url: { url: "https://i/" + i + ".jpg" }, role: "reference_image" });
  decode({ model: "MiniMax-H3-Max", content: items, resolution: "768P", duration: 5 });
}, "10 reference images rejected", "at most 9");
throws(function () {
  const items = [{ type: "text", text: "p" }];
  for (let i = 0; i < 4; i++) items.push({ type: "video_url", video_url: { url: "https://v/" + i + ".mp4" }, role: "reference_video" });
  decode({ model: "MiniMax-H3-Max", content: items, resolution: "768P", duration: 5 });
}, "4 reference videos rejected", "at most 3");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "ftp://x" } }], resolution: "768P", duration: 5 }); }, "non-http url rejected");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "image_url", image_url: { url: "https://i/1.jpg" }, role: "weird" }], resolution: "768P", duration: 5 }); }, "unknown image role rejected");
throws(function () { decode({ model: "MiniMax-H3-Max", content: [{ type: "text", text: "p" }, { type: "file_url", file_url: { url: "https://f/1" } }], resolution: "768P", duration: 5 }); }, "unknown content type rejected");
throws(function () { plugin.native.createVideo({ body: { kind: "form", value: {} } }); }, "non-json body rejected");
throws(function () { plugin.buildSubmitRequest({ requestBody: { prompt: "p" }, apiKey: "K" }); }, "missing envelope rejected");

// upstreamModel 覆盖端点
const pinned = plugin.buildSubmitRequest({ requestBody: t2v.requestBody, upstreamModel: "minimax/h3-max/text-to-video", apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(pinned.url.endsWith("/minimax/h3-max/text-to-video"), "upstreamModel pins endpoint");

// ---- submit / query 上游契约 ----
const receipt = { request_id: "764cabcf-b745", response_url: "https://queue.fal.run/minimax/h3-max/requests/764cabcf/response", queue_position: 0 };
const parsedSubmit = plugin.parseSubmitResponse({}, { body: receipt });
ok(parsedSubmit.taskId === "764cabcf-b745", "taskId = fal request_id");
ok(parsedSubmit.taskData === receipt, "receipt persisted");
throws(function () { plugin.parseSubmitResponse({}, { body: { detail: "Invalid API key" } }); }, "submit error rejected");
throws(function () { plugin.parseSubmitResponse({}, { body: {} }); }, "missing request_id rejected");

const q = plugin.buildQueryRequest({ taskId: "a/b", apiKey: "K", baseUrl: "https://queue.fal.run" });
ok(q.url === "https://queue.fal.run/minimax/h3-max/requests/a%2Fb", "query url = app + encoded id, no route segment");
ok(q.method === "GET" && q.headers.Authorization === "Key K", "query method/auth");

// ---- parseTaskResult ----
function parse(body, http) {
  return plugin.parseTaskResult({ taskId: "t" }, body, { status: http });
}
ok(parse({ detail: { type: "request_in_progress" } }, 400).status === "IN_PROGRESS", "400 request_in_progress -> IN_PROGRESS");
const succ = parse({ video: { url: "https://v3b.fal.media/x.mp4", content_type: "video/mp4" } }, 200);
ok(succ.status === "SUCCESS" && succ.url === "https://v3b.fal.media/x.mp4" && succ.progress === "100%", "success");
const fail = parse({ detail: { type: "generation_failed", msg: "policy violation" } }, 422);
ok(fail.status === "FAILURE" && fail.reason === "policy violation", "4xx failure with reason");
ok(parse({ detail: "request expired" }, 410).status === "FAILURE", "string detail failure");
ok(parse({ detail: [{ type: "value_error", msg: "bad" }] }, 400).reason === "bad", "array detail failure");
throws(function () { parse({}, 500); }, "5xx throws for retry");
throws(function () { parse({}, 429); }, "429 throws for retry");
throws(function () { parse({}, 408); }, "408 throws for retry");
ok(parse({ status: "IN_QUEUE" }, 200).status === "QUEUED", "IN_QUEUE -> QUEUED");
ok(parse({ status: "COMPLETED", error: "boom" }, 200).status === "FAILURE", "COMPLETED+error -> FAILURE");
ok(parse({ status: "COMPLETED" }, 200).status === "IN_PROGRESS", "COMPLETED without payload keeps polling");
ok(parse({ status: "not_completed" }, 200).status !== "SUCCESS", "not_completed never SUCCESS");
ok(parse({ video: { url: "bad" } }, 200).status !== "SUCCESS", "invalid url not success");
ok(parse({ status: "WEIRD" }, 200).status === "QUEUED", "unknown -> QUEUED (never UNKNOWN)");
ok(parse(JSON.stringify({ video: { url: "https://v/x.mp4" } }), 200).status === "SUCCESS", "string body parsed");
ok(plugin.parseTaskResult({ response: { status: 400 } }, { detail: { type: "request_in_progress" } }).status === "IN_PROGRESS", "legacy ctx.response fallback");

// ---- usage ----
ok(deepEqual(plugin.extractUsage({ requestBody: t2v.requestBody, usagePurpose: "" }), { seconds: 6, resolution: "768P" }), "usage from normalized model");
ok(plugin.extractUsage({ requestBody: t2v.requestBody, usagePurpose: "billing_ratios" }) === null, "billing_ratios null");
ok(deepEqual(plugin.extractUsage({ requestBody: i2vFirst.requestBody, usagePurpose: "" }), { seconds: 5, resolution: "480P" }), "usage 480P");

// ---- artifacts ----
const doneTask = { status: "SUCCESS", task_id: "t1", data: { video: { url: "https://v3b.fal.media/x.mp4", content_type: "video/mp4" }, seed: 7 } };
const arts = plugin.listArtifacts(doneTask);
ok(arts.length === 1 && arts[0].key === "video" && arts[0].mimeType === "video/mp4", "artifact listed");
ok(!("url" in arts[0]), "listArtifacts does not leak url");
ok(plugin.listArtifacts({ status: "IN_PROGRESS", data: doneTask.data }).length === 0, "no artifacts before success");
ok(plugin.listArtifacts({ status: "SUCCESS", data: { video: { url: "data:video/mp4;base64,AA" } } }).length === 0, "data uri not an artifact");
ok(plugin.listArtifacts({ status: "SUCCESS", data: { task_id: "t", data: doneTask.data } }).length === 1, "nested envelope");
const content = plugin.buildContentRequest(Object.assign({}, doneTask, { artifactKey: "video", clientRequest: { method: "GET" } }));
ok(content.url === "https://v3b.fal.media/x.mp4" && content.credentialless === true && !content.headers, "credentialless, no channel auth");
ok(plugin.buildContentRequest(Object.assign({}, doneTask, { artifactKey: "video", clientRequest: { method: "HEAD" } })).method === "HEAD", "HEAD passthrough");
throws(function () { plugin.buildContentRequest(Object.assign({}, doneTask, { artifactKey: "x", clientRequest: { method: "GET" } })); }, "unknown artifact key");

// ---- MiniMax /v2 响应形状 ----
const created = plugin.native.createdVideo({}, { task_id: "pub-1", data: receipt });
ok(deepEqual(created, { task_id: "pub-1" }), "create response is exactly { task_id }");
ok(!("request_id" in created) && !("response_url" in created), "fal receipt internals not exposed");

const qSucc = plugin.native.queryVideo({}, Object.assign({}, doneTask, { created_at: 1785125529, updated_at: 1785125946 }));
ok(qSucc.task && qSucc.task.id === "t1", "query wraps in task object");
ok(qSucc.task.status === "succeeded", "MiniMax status succeeded");
ok(qSucc.task.content && qSucc.task.content.url === "https://v3b.fal.media/x.mp4", "content.url present");
ok(qSucc.task.model === "MiniMax-H3-Max" && qSucc.task.task_type === "generation" && qSucc.task.modality === "video", "MiniMax descriptive fields");
ok(qSucc.task.created_at === 1785125529 && qSucc.task.updated_at === 1785125946, "epoch seconds passthrough");
// 毫秒时间戳归一为秒
ok(plugin.native.queryVideo({}, { task_id: "t", status: "QUEUED", data: {}, created_at: 1785125529000 }).task.created_at === 1785125529, "ms timestamp normalized to seconds");
ok(plugin.native.queryVideo({}, { task_id: "t", status: "QUEUED", data: {} }).task.status === "queued", "QUEUED -> queued");
ok(plugin.native.queryVideo({}, { task_id: "t", status: "IN_PROGRESS", data: {} }).task.status === "running", "IN_PROGRESS -> running");
const qFail = plugin.native.queryVideo({}, { task_id: "t", status: "FAILURE", fail_reason: "boom", data: {} });
ok(qFail.task.status === "failed" && qFail.task.error.message === "boom", "FAILURE -> failed with error");
ok(!("content" in qFail.task), "failed task has no content");
ok(!("content" in plugin.native.queryVideo({}, { task_id: "t", status: "IN_PROGRESS", data: {} }).task), "pending task has no content");
// 原始模型名透传
ok(plugin.native.queryVideo({}, { task_id: "t", status: "QUEUED", data: {}, properties: { origin_model_name: "MiniMax-H3-Max" } }).task.model === "MiniMax-H3-Max", "origin model name");

console.log("\npassed=" + passed + " failed=" + failed);
if (failed > 0) process.exit(1);
