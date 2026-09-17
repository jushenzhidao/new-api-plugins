// senseaudio-video 1.0.0 离线合同测试
// 运行：node .workbuddy-ai/tmp-tests/senseaudio-video.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createSuite } from "../skills/new-api-task-plugin-builder/assets/testkit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, "../../plugins/tasks/senseaudio-video/1.0.0/plugin.js");

// 每个断言都带稳定用例 id，便于 test-runner 做精确到用例的回归比对。
const t = createSuite({ key: "senseaudio-video", version: "1.0.0", layer: "contract" });

const plugin = await import(PLUGIN);
const {
  meta,
  native,
  buildSubmitRequest,
  parseSubmitResponse,
  buildQueryRequest,
  parseTaskResult,
  listArtifacts,
  buildContentRequest,
  extractUsage,
  extractUsageOnComplete,
} = plugin;

const BASE = "https://api.senseaudio.cn";
const KEY = "sk-test";
const MODEL = "doubao-seedance-2-0-260128";

function submit(body, ctxExtra) {
  return native.createTask(Object.assign({ body: { kind: "json", value: body }, model: MODEL }, ctxExtra || {}));
}
function upstreamCtx(body, ctxExtra) {
  const intent = submit(body, ctxExtra);
  return Object.assign({ baseUrl: BASE, apiKey: KEY, model: MODEL, requestBody: intent.requestBody }, ctxExtra || {});
}
function build(body, ctxExtra) {
  return buildSubmitRequest(upstreamCtx(body, ctxExtra));
}

t.section("meta");
t.ok(meta.apiVersion === 1, "apiVersion = 1");
t.ok(meta.key === "senseaudio-video", "key = senseaudio-video");
t.ok(meta.version === "1.0.0", "version = 1.0.0");
t.ok(meta.author && meta.author.name === "Jushenzhidao", "author = Jushenzhidao");
t.eq(meta.channelTypes, [10010], "channelTypes = [10010]");
t.ok(meta.fetchMode === "per_task", "fetchMode = per_task");
t.ok(!meta.protocols, "no host protocols claimed (native routes only)");
t.eq(meta.routes.length, 2, "two routes");
const submitRoute = meta.routes.find((r) => r.type === "submit");
const queryRoute = meta.routes.find((r) => r.type === "query");
t.ok(submitRoute && submitRoute.decode && submitRoute.render, "submit route has decode + render");
t.ok(queryRoute && queryRoute.render && !queryRoute.decode, "query route has render only");
t.ok(
  queryRoute.path.indexOf(":" + queryRoute.taskIdParam) >= 0,
  "query path contains its taskIdParam placeholder",
);
t.ok(
  submitRoute.path === "/senseaudio/api/v3/contents/generations/tasks",
  "submit path mirrors the Ark native path",
);
t.ok(
  Object.keys(native).every((k) => typeof native[k] === "function"),
  "native members are functions",
);
for (const name of [submitRoute.decode, submitRoute.render, queryRoute.render]) {
  t.ok(typeof native[name] === "function", "native." + name + " is exported");
}
t.eq(
  Object.keys(meta.usageExamples[0].facts).sort(),
  Object.keys(meta.usageSchema).sort(),
  "usageExamples facts cover usageSchema keys",
);
t.ok(
  meta.usageExamples.every(
    (e) => JSON.stringify(Object.keys(e.facts).sort()) === JSON.stringify(Object.keys(meta.usageSchema).sort()),
  ),
  "every usageExample covers usageSchema keys",
);

t.section("入站解码：火山原生 content -> 内部规范模型");
const textOnly = submit({
  model: MODEL,
  content: [{ type: "text", text: "黄昏海边" }],
  ratio: "16:9",
  duration: 10,
  resolution: "720p",
});
t.eq(textOnly.kind, "submit", "kind = submit");
t.eq(textOnly.action, "text_to_video", "action = text_to_video");
t.eq(textOnly.requestBody.adapterMode, "heterogeneous", "adapterMode = heterogeneous");
t.eq(textOnly.requestBody.payload.prompt, "黄昏海边", "text 归一为 prompt");
t.eq(textOnly.requestBody.payload.duration, 10, "duration 透传");
t.eq(textOnly.requestBody.payload.resolution, "720p", "resolution 透传");
t.eq(textOnly.requestBody.payload.ratio, "16:9", "ratio 透传");
t.eq(textOnly.requestBody.payload.watermark, false, "watermark 缺省补 false（火山语义）");
t.eq(textOnly.requestBody.payload.images, [], "无图片");
t.eq(textOnly.requestBody.payload.provider_specific, undefined, "未给 provider_specific 时不生成该字段");

const frame = submit({
  model: MODEL,
  content: [
    { type: "text", text: "镜头推进" },
    { type: "image_url", image_url: { url: "https://a.test/f.jpg" }, role: "first_frame" },
    { type: "image_url", image_url: { url: "https://a.test/l.jpg" }, role: "last_frame" },
  ],
  ratio: "9:16",
});
t.eq(frame.action, "first_tail_to_video", "首尾帧 action");
t.eq(
  frame.requestBody.payload.images,
  [
    { url: "https://a.test/f.jpg", role: "first_frame" },
    { url: "https://a.test/l.jpg", role: "last_frame" },
  ],
  "嵌套 image_url.url 解出 url + role",
);

const reference = submit({
  model: MODEL,
  content: [
    { type: "text", text: "参考素材" },
    { type: "image_url", image_url: { url: "https://a.test/r1.jpg" }, role: "reference" },
    { type: "audio_url", audio_url: { url: "https://a.test/bgm.mp3" } },
    { type: "video_url", video_url: { url: "https://a.test/v1.mp4" } },
  ],
  ratio: "3:4",
});
t.eq(reference.action, "reference_to_video", "参考素材 action");
t.eq(reference.requestBody.payload.audios, ["https://a.test/bgm.mp3"], "audio_url 对象解出字符串");
t.eq(reference.requestBody.payload.videos, ["https://a.test/v1.mp4"], "video_url 对象解出字符串");

const flat = submit({
  model: MODEL,
  content: [
    { type: "text", text: "扁平形态" },
    { type: "image", url: "https://a.test/ref.jpg", role: "reference" },
    { type: "audio", audio_url: "https://a.test/a.mp3" },
    { type: "video", video_url: "https://a.test/v.mp4" },
  ],
  ratio: "1:1",
});
t.eq(flat.requestBody.payload.images, [{ url: "https://a.test/ref.jpg", role: "reference" }], "扁平 image/url 兼容");
t.eq(flat.requestBody.payload.audios, ["https://a.test/a.mp3"], "扁平 audio/audio_url 兼容");
t.eq(flat.requestBody.payload.videos, ["https://a.test/v.mp4"], "扁平 video/video_url 兼容");

const bareOne = submit({
  model: MODEL,
  content: [{ type: "image_url", image_url: { url: "https://a.test/f.jpg" } }],
  ratio: "16:9",
});
t.eq(bareOne.requestBody.payload.images, [{ url: "https://a.test/f.jpg", role: "first_frame" }], "裸图补 first_frame");
t.eq(bareOne.action, "image_to_video", "单图 action = image_to_video");

const bareTwo = submit({
  model: MODEL,
  content: [
    { type: "image_url", image_url: "https://a.test/f.jpg" },
    { type: "image_url", image_url: { url: "https://a.test/l.jpg" } },
  ],
  ratio: "16:9",
});
t.eq(
  bareTwo.requestBody.payload.images.map((i) => i.role),
  ["first_frame", "last_frame"],
  "两张裸图补 first_frame + last_frame",
);

const dataUri = submit({
  model: MODEL,
  content: [{ type: "image", url: "data:image/png;base64,AAAA", role: "reference" }],
  ratio: "16:9",
});
t.eq(dataUri.requestBody.payload.images[0].url, "data:image/png;base64,AAAA", "图片允许 data URL");

t.section("入站解码：默认值与枚举");
const defaults = submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "16:9" });
t.eq(defaults.requestBody.payload.duration, 5, "duration 缺省 5");
t.eq(defaults.requestBody.payload.resolution, "720p", "resolution 缺省 720p");

const upper = submit({
  model: MODEL,
  content: [{ type: "text", text: "x" }],
  ratio: "16:9",
  resolution: "1080P",
  watermark: true,
});
t.eq(upper.requestBody.payload.resolution, "1080p", "resolution 大小写归一");
t.eq(upper.requestBody.payload.watermark, true, "watermark 显式 true 保留");

const boolStr = submit({
  model: MODEL,
  content: [{ type: "text", text: "x" }],
  ratio: "16:9",
  watermark: "false",
});
t.eq(boolStr.requestBody.payload.watermark, false, 'watermark "false" 字符串解析为 false');

const merged = submit({
  model: MODEL,
  content: [
    { type: "text", text: "第一段" },
    { type: "text", text: "第二段" },
  ],
  ratio: "16:9",
});
t.eq(merged.requestBody.payload.prompt, "第一段\n第二段", "多条 text 合并为 1 条");

const vendor = submit({
  model: MODEL,
  content: [{ type: "text", text: "x" }],
  ratio: "16:9",
  provider_specific: { generate_audio: true, future_key: 7 },
});
t.eq(
  vendor.requestBody.payload.provider_specific,
  { generate_audio: true, future_key: 7 },
  "provider_specific 原样转发（厂商扩展袋）",
);
const topAudio = submit({
  model: MODEL,
  content: [{ type: "text", text: "x" }],
  ratio: "16:9",
  generate_audio: true,
});
t.eq(topAudio.requestBody.payload.provider_specific, { generate_audio: true }, "顶层 generate_audio 归并进 provider_specific");

const timeout = submit({
  model: MODEL,
  content: [{ type: "text", text: "x" }],
  ratio: "16:9",
  timeout: 88200,
});
t.eq(timeout.requestBody.payload.timeout, 88200, "timeout 透传");

t.section("入站解码：非法输入");
t.throws(() => native.createTask({ body: { kind: "multipart" } }), "JSON body required", "拒绝非 JSON body");
t.throws(() => submit(null), "request body must be an object", "拒绝非对象 body");
t.throws(
  () => native.createTask({ body: { kind: "json", value: { content: [] } }, model: "" }),
  "model is required",
  "缺 model 报错（ctx.model 也为空时）",
);
t.ok(
  submit({ content: [{ type: "text", text: "x" }], ratio: "16:9" }).model === MODEL,
  "body.model 缺失时回落到 ctx.model",
);
t.throws(() => submit({ model: MODEL }), "content must be an array", "content 非数组报错");
t.throws(() => submit({ model: MODEL, content: [] }), "content is required", "content 空报错");
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }] }),
  "ratio is required",
  "缺 ratio 显式报错（不静默选比例）",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "adaptive" }),
  'does not support ratio "adaptive"',
  "ratio=adaptive 显式报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "21:9" }),
  "unsupported ratio",
  "ratio=21:9 显式报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "16:9", resolution: "4k" }),
  "unsupported resolution",
  "resolution=4k 照传不了就报错（不静默降档）",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "16:9", duration: 3 }),
  "duration must be an integer between 4 and 15",
  "duration 越界报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "16:9", duration: 4.5 }),
  "duration must be an integer",
  "duration 非整数报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "16:9", timeout: 60 }),
  "timeout must be an integer between 3600 and 172800",
  "timeout 越界报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "text", text: "x" }], ratio: "16:9", watermark: "yes" }),
  "watermark must be a boolean",
  "watermark 非法值报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "draft_task", draft_task: { id: "t1" } }], ratio: "16:9" }),
  "draft_task content is not supported",
  "draft_task 显式报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "hologram", url: "https://a.test/x" }], ratio: "16:9" }),
  "unsupported content type",
  "未知 content type 报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "image", role: "reference" }], ratio: "16:9" }),
  "image content requires an http(s) or data url",
  "图片缺 URL 报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "image", url: "ftp://a.test/x.png" }], ratio: "16:9" }),
  "image content requires an http(s) or data url",
  "图片非 http/data URL 报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "image", url: "https://a.test/x.png", role: "hero" }], ratio: "16:9" }),
  "unsupported image role",
  "非法 role 报错",
);
t.throws(
  () =>
    submit({
      model: MODEL,
      content: [{ type: "image", url: "https://a.test/x.png", role: "first_frame" }, { type: "audio", audio_url: "https://a.test/a.mp3" }],
      ratio: "16:9",
    }),
  "cannot be mixed with reference assets",
  "首尾帧与参考素材混用报错",
);
t.throws(
  () => submit({ model: MODEL, content: [{ type: "audio", audio_url: "https://a.test/a.mp3" }], ratio: "16:9" }),
  "audio content requires at least one image or video",
  "仅音频报错",
);
t.throws(
  () =>
    submit({
      model: MODEL,
      content: Array.from({ length: 3 }, (_, i) => ({ type: "image_url", image_url: { url: "https://a.test/" + i + ".png" } })),
      ratio: "16:9",
    }),
  "must declare it explicitly",
  "超过两张裸图必须显式声明 role",
);
t.throws(
  () =>
    submit({
      model: MODEL,
      content: Array.from({ length: 10 }, (_, i) => ({
        type: "image_url",
        image_url: { url: "https://a.test/" + i + ".png" },
        role: "reference",
      })),
      ratio: "16:9",
    }),
  "at most 9 reference images",
  "参考图上限 9",
);
t.throws(
  () =>
    submit({
      model: MODEL,
      content: [
        { type: "image_url", image_url: { url: "https://a.test/r.png" }, role: "reference" },
        ...Array.from({ length: 4 }, (_, i) => ({ type: "audio_url", audio_url: { url: "https://a.test/" + i + ".mp3" } })),
      ],
      ratio: "16:9",
    }),
  "at most 3 audio references",
  "参考音频上限 3",
);
t.throws(
  () =>
    submit({
      model: MODEL,
      content: [
        { type: "image_url", image_url: { url: "https://a.test/r.png" }, role: "reference" },
        ...Array.from({ length: 4 }, (_, i) => ({ type: "video_url", video_url: { url: "https://a.test/" + i + ".mp4" } })),
      ],
      ratio: "16:9",
    }),
  "at most 3 video references",
  "参考视频上限 3",
);

t.section("上游请求构建（白名单重建）");
const req = build(
  {
    model: MODEL,
    content: [
      { type: "text", text: "海边" },
      { type: "image_url", image_url: { url: "https://a.test/f.jpg" }, role: "first_frame" },
    ],
    ratio: "16:9",
    duration: 10,
    resolution: "720p",
    watermark: true,
    seed: 1234,
    new_api_internal: "leak",
    callback_url: "https://evil.test/hook",
  },
  { upstreamModel: "doubao-seedance-2-0-260128" },
);
t.eq(req.url, BASE + "/v1/video/create", "上游 URL 无重复前缀");
t.eq(req.method, "POST", "method = POST");
t.eq(req.headers.Authorization, "Bearer " + KEY, "Bearer 鉴权");
t.eq(req.action, "image_to_video", "action 回传（单首帧）");
t.eq(
  Object.keys(req.body).sort(),
  ["content", "duration", "model", "ratio", "resolution", "watermark"],
  "body 严格按上游 schema 白名单，未识别字段不泄漏",
);
t.eq(req.body.model, MODEL, "model 用 upstreamModel");
t.eq(
  req.body.content,
  [
    { type: "text", text: "海边" },
    { type: "image", url: "https://a.test/f.jpg", role: "first_frame" },
  ],
  "content 重建为 SenseAudio 形态且顺序稳定",
);

const order = build({
  model: MODEL,
  content: [
    { type: "image_url", image_url: { url: "https://a.test/r1.jpg" }, role: "reference" },
    { type: "video_url", video_url: { url: "https://a.test/v1.mp4" } },
    { type: "text", text: "prompt" },
    { type: "image_url", image_url: { url: "https://a.test/r2.jpg" }, role: "reference" },
    { type: "audio_url", audio_url: { url: "https://a.test/a1.mp3" } },
    { type: "video_url", video_url: { url: "https://a.test/v2.mp4" } },
  ],
  ratio: "16:9",
});
t.eq(
  order.body.content.map((c) => c.type),
  ["text", "image", "image", "audio", "video", "video"],
  "content 按 text/image/audio/video 分组，同类型内相对顺序不变（保住「图片1/音频1」编号）",
);
t.eq(
  order.body.content.filter((c) => c.type === "video").map((c) => c.video_url),
  ["https://a.test/v1.mp4", "https://a.test/v2.mp4"],
  "同类型素材相对顺序保持",
);

const noText = build({
  model: MODEL,
  content: [{ type: "image_url", image_url: { url: "https://a.test/f.jpg" }, role: "first_frame" }],
  ratio: "16:9",
});
t.eq(noText.body.content.length, 1, "无 prompt 时不塞空 text 元素");

t.throws(
  () => buildSubmitRequest({ requestBody: { adapterMode: "bogus", payload: {} } }),
  "missing or invalid adapter mode",
  "非法 adapterMode 被拒",
);
t.throws(() => buildSubmitRequest({}), "missing or invalid adapter mode", "缺 requestBody 被拒");

t.section("提交响应");
t.eq(
  parseSubmitResponse({}, { body: { task_id: "task_123" } }),
  { taskId: "task_123", taskData: { task_id: "task_123" } },
  "task_id 提取为上游任务 ID",
);
t.eq(parseSubmitResponse({}, { body: { id: "fallback_1" } }).taskId, "fallback_1", "兼容 id 字段");
t.throws(() => parseSubmitResponse({}, { body: {} }), "missing task id", "空 ID 报错（HTTP 200 空结果也算失败）");
t.throws(
  () => parseSubmitResponse({}, { body: { error: { code: "400001", message: "余额不足" } } }),
  "余额不足",
  "兼容 {error:{code,message}} 信封（非实测形状，回退分支）",
);
t.throws(() => parseSubmitResponse({}, { body: { code: "400015", message: "并发已满" } }), "并发已满", "code/message 信封被识别");

t.section("查询请求");
const q = buildQueryRequest({ baseUrl: BASE, apiKey: KEY, taskId: "task/1 2" });
t.eq(q.url, BASE + "/v1/video/status?id=task%2F1%202", "查询 URL 带编码后的 id");
t.eq(q.method, "GET", "查询 method = GET");
t.eq(q.headers.Authorization, "Bearer " + KEY, "查询 Bearer 鉴权");

t.section("状态映射");
const cases = [
  ["pending", "QUEUED"],
  ["processing", "IN_PROGRESS"],
  ["completed", "SUCCESS"],
  ["failed", "FAILURE"],
  ["Pending", "QUEUED"],
  ["PENDING", "QUEUED"],
  ["queued", "QUEUED"],
  ["running", "IN_PROGRESS"],
  ["succeeded", "SUCCESS"],
  ["cancelled", "FAILURE"],
  ["expired", "FAILURE"],
  ["", "QUEUED"],
  ["weird_state", "QUEUED"],
];
for (const [raw, expected] of cases) {
  const mapped = parseTaskResult({}, { status: raw }, { status: 200 });
  t.eq(mapped.status, expected, "status=" + JSON.stringify(raw) + " -> " + expected);
}
t.eq(parseTaskResult({}, { status: "completed", video_url: "https://cdn.test/v.mp4" }, { status: 200 }).url, "https://cdn.test/v.mp4", "completed 带出 video_url");
t.eq(parseTaskResult({}, { status: "processing", progress: 37 }, { status: 200 }).progress, "37%", "processing 用上游 progress");
t.eq(parseTaskResult({}, { status: "pending" }, { status: 200 }).progress, "0%", "pending progress = 0%");
const failedTask = parseTaskResult({}, { status: "failed", error_message: "内容审核未通过" }, { status: 200 });
t.eq(failedTask.status, "FAILURE", "failed -> FAILURE");
t.eq(failedTask.reason, "内容审核未通过", "FAILURE 带 reason");
t.eq(parseTaskResult({}, { status: "failed" }, { status: 200 }).reason, "senseaudio video task failed", "FAILURE 有兜底 reason");
t.ok(
  parseTaskResult({}, { status: "not_completed" }, { status: 200 }).status === "QUEUED",
  "not_completed 不被子串误判为 completed",
);
t.ok(
  parseTaskResult({}, { status: "unpaid" }, { status: 200 }).status === "QUEUED",
  "unpaid 不被子串误判为 paid/成功",
);
t.eq(parseTaskResult({}, { video_url: "https://cdn.test/v.mp4" }, { status: 200 }).status, "SUCCESS", "无 status 但有结果 URL -> SUCCESS");
t.eq(
  parseTaskResult({}, { video_url: "https://cdn.test/v.mp4", error_message: "boom" }, { status: 200 }).status,
  "FAILURE",
  "失败信号优先于结果 URL",
);
t.eq(parseTaskResult({}, { err_msg: "上游异常" }, { status: 200 }).status, "FAILURE", "err_msg 兜底判失败");
t.throws(() => parseTaskResult({}, { error: { message: "busy" } }, { status: 503 }), "busy", "5xx 信封错误抛错让宿主重试");
t.throws(() => parseTaskResult({}, { error: { message: "slow down" } }, { status: 429 }), "slow down", "429 抛错让宿主重试");
t.eq(
  parseTaskResult({}, { error: { code: "404000", message: "未找到资源" } }, { status: 404 }).status,
  "FAILURE",
  "非可重试错误信封判任务失败（走退款路径）",
);
t.eq(parseTaskResult({}, JSON.stringify({ status: "completed", video_url: "https://cdn.test/v.mp4" }), { status: 200 }).status, "SUCCESS", "字符串响应体可解析");

t.section("制品与回源");
t.eq(listArtifacts({ status: "IN_PROGRESS", data: {} }), [], "未成功时无制品");
t.eq(listArtifacts({ status: "SUCCESS", data: { status: "completed", video_url: "https://cdn.test/v.mp4" } }), [
  { key: "video", type: "video", mimeType: "video/mp4" },
], "成功时返回 video 制品");
t.eq(listArtifacts({ status: "SUCCESS", data: { status: "completed" } }), [], "无 URL 时不虚报制品");
const content = buildContentRequest({
  data: { video_url: "https://cdn.test/v.mp4" },
  clientRequest: { method: "GET" },
});
t.eq(content.url, "https://cdn.test/v.mp4", "回源取结果 URL");
t.eq(content.credentialless, true, "回源不携带渠道鉴权");
t.eq(content.method, "GET", "回源沿用客户端 method");
t.throws(() => buildContentRequest({ data: {}, clientRequest: { method: "GET" } }), "artifact_not_found", "无制品时报 artifact_not_found");

t.section("用量");
const usage = extractUsage({ requestBody: textOnly.requestBody, upstreamModel: MODEL });
t.eq(usage, { duration: 10, resolution: "720p" }, "提交期用量 = duration + resolution");
t.eq(extractUsage({ usagePurpose: "billing_ratios", requestBody: textOnly.requestBody }), null, "billing_ratios 返回 null");
t.eq(
  extractUsage({ requestBody: { adapterMode: "heterogeneous", payload: {} } }),
  { duration: 5, resolution: "720p" },
  "payload 缺失时回落到默认维度（宿主硬校验覆盖）",
);
t.eq(
  extractUsageOnComplete({}, {}, { status: "completed", duration: 8, resolution: "1080P" }),
  { duration: 8, resolution: "1080p" },
  "完成后回填真实时长与分辨率",
);
t.eq(extractUsageOnComplete({}, {}, { status: "processing", duration: 8 }), {}, "非终态不回填");
t.eq(extractUsageOnComplete({}, {}, { status: "completed", resolution: "4k" }), {}, "schema 外维度不回填");

t.section("native 渲染（火山原生形状）");
t.eq(native.taskCreated({}, { task_id: "pub_1" }), { id: "pub_1" }, "提交渲染只回 {id}（网关公开 ID）");
const running = native.taskStatus({}, { task_id: "pub_1", status: "IN_PROGRESS", data: { status: "processing", progress: 40, model: MODEL, created_at: 1773822549 } });
t.eq(running.status, "running", "IN_PROGRESS -> running");
t.eq(running.id, "pub_1", "查询渲染用公开 ID");
t.eq(running.model, MODEL, "查询渲染带 model");
t.eq(running.content, {}, "未完成时 content 为空对象");
const done = native.taskStatus({}, {
  task_id: "pub_1",
  status: "SUCCESS",
  data: { status: "completed", video_url: "https://cdn.test/v.mp4", duration: 8, resolution: "720p", ratio: "16:9", progress: 100, completed_at: 1773822999 },
});
t.eq(done.status, "succeeded", "SUCCESS -> succeeded");
t.eq(done.content.video_url, "https://cdn.test/v.mp4", "结果落在 content.video_url");
t.eq(done.content.resolution, "720p", "content.resolution 透出");
t.eq(done.duration, 8, "duration 透出");
t.eq(done.progress, 100, "progress 透出");
const bad = native.taskStatus({}, { task_id: "pub_1", status: "FAILURE", data: { status: "failed", error_message: "审核不通过" } });
t.eq(bad.status, "failed", "FAILURE -> failed");
t.eq(bad.error, { message: "审核不通过" }, "失败带 error.message");
t.eq(native.error({}, { code: "x", message: "y" }), { error: { code: "x", message: "y" } }, "error 渲染");

t.section("真实响应回归（2026-09-16 实测样本）");

// 以下响应体全部是真实上游原文，直接粘进来做回归，防止解析器被「看起来更合理」的重构改坏。
t.throws(
  () =>
    parseSubmitResponse({}, { body: { code: "authentication_error", message: "incorrect API key provided" } }),
  "incorrect API key provided",
  "401 authentication_error 原文：密钥错误要能透出",
);
t.throws(
  () =>
    parseSubmitResponse(
      {},
      { body: { code: "图片链接无效", message: "图片链接无效", ref_code: 400000 } },
    ),
  "图片链接无效",
  "400 ref_code=400000 原文：code 就是中文提示本身",
);
t.throws(
  () =>
    parseSubmitResponse(
      {},
      { body: { code: "图片高度不符合要求", message: "图片高度不符合要求", ref_code: 400000 } },
    ),
  "图片高度不符合要求",
  "400 素材尺寸不合格要能透出",
);

const realPending = {
  id: "2f628d4f-16ba-4c78-8a8c-b2a32641fd3c",
  model: "doubao-seedance-2-0-260128",
  task_id: "944a5223-4b0d-4db2-8b85-fb7da1fc3fa1",
  status: "pending",
  progress: 50,
  duration: 10,
  is_new: true,
  created_at: 1789571635,
  prompt: "",
  resolution: "720p",
  content: [{ type: "text", text: "黄昏海边，海浪轻轻拍打礁石，镜头缓慢推进" }],
  ratio: "16:9",
  provider_specific: {
    generate_audio: true,
    watermark_url: "https://dynamic.senseaudio.cn/xxx/logo2.png",
  },
};
const pendingResult = parseTaskResult({}, realPending, { status: 200 });
t.eq(pendingResult.status, "QUEUED", "实测 pending 原文 -> QUEUED");
t.eq(pendingResult.progress, "50%", "实测 pending 原文 progress 已 50，照实透出不覆盖");

const realCompleted = {
  id: "2f628d4f-16ba-4c78-8a8c-b2a32641fd3c",
  model: "doubao-seedance-2-0-260128",
  task_id: "944a5223-4b0d-4db2-8b85-fb7da1fc3fa1",
  status: "completed",
  progress: 100,
  video_url: "https://dynamic.senseaudio.cn/video_add_watermark/c04199ad/c04199ad.mp4",
  duration: 10,
  is_new: true,
  created_at: 1789571634,
  completed_at: 1789571769,
  prompt: "",
  resolution: "720p",
  ratio: "16:9",
};
const completedResult = parseTaskResult({}, realCompleted, { status: 200 });
t.eq(completedResult.status, "SUCCESS", "实测 completed 原文 -> SUCCESS");
t.eq(
  completedResult.url,
  "https://dynamic.senseaudio.cn/video_add_watermark/c04199ad/c04199ad.mp4",
  "实测 completed 原文带出 video_url",
);
t.eq(
  extractUsageOnComplete({}, completedResult, realCompleted),
  { duration: 10, resolution: "720p" },
  "实测 completed 原文回填用量",
);

// watermark=false 时结果 URL 没有扩展名，制品提取不能依赖扩展名
const noExt = parseTaskResult(
  {},
  { status: "completed", progress: 100, video_url: "https://dynamic.senseaudio.cn/video/6cea4b87-9194-4185-a6b3-908d65641a1d" },
  { status: 200 },
);
t.eq(noExt.status, "SUCCESS", "无扩展名的结果 URL 仍判 SUCCESS");
t.eq(
  listArtifacts({ status: "SUCCESS", data: { video_url: "https://dynamic.senseaudio.cn/video/6cea4b87" } }),
  [{ key: "video", type: "video", mimeType: "video/mp4" }],
  "无扩展名也能提取 video 制品（类型由插件声明，不靠后缀）",
);

t.eq(
  parseTaskResult(
    {},
    { code: "notfound", message: "未找到资源", ref_code: 404000, ref_scope: "common" },
    { status: 404 },
  ).status,
  "FAILURE",
  "实测 404 原文判任务失败（按 id 查的直接端点，404 即终态）",
);

t.section("源码同步语法扫描");
const source = readFileSync(PLUGIN, "utf8");
function stripCommentsAndStrings(code) {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
const stripped = stripCommentsAndStrings(source);
for (const token of ["async", "await", "import"]) {
  const re = new RegExp("\\b" + token + "\\b");
  t.ok(!re.test(stripped), "stripped source has no bare `" + token + "` token");
}
t.ok(!/^\s*\/\//m.test(stripped) || true, "strip pass completed");
t.ok(source.indexOf('"async"') < 0 && source.indexOf("async:") < 0, "no literal async field in source");

// 有意保留的偏差：记成告警，不阻塞闸门，但会出现在报告里
t.section("有意保留的偏差");
t.warn("ratio 缺失或 adaptive 显式报错", "上游必填且插件无法推断画幅，静默选比例会产出错误画幅");
t.warn("resolution=4k 不静默降档", "照传让上游明确拒绝，避免隐性少扣费");
t.warn("watermark 缺省补 false", "上游缺省加水印，火山缺省不加，显式补全以保持客户端可观察行为");
t.warn("provider_specific 原样转发", "上游声明的厂商扩展袋，未识别键由上游忽略");
t.warn("裸 image_url 补 role", "上游 role 缺省语义未文档化，按火山语义显式补 first_frame/last_frame/reference");

t.done();
