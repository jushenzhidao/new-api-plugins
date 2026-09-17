export const meta = {
  apiVersion: 1,
  key: "aivideomaker",
  name: "AI Video Maker",
  icon: "Video.Color",
  description: {
    en: "aivideomaker.ai MiniMax H3 video generation (text-to-video, image-to-video, first/last frame, reference assets)",
    zh: "aivideomaker.ai MiniMax H3 视频生成（文生视频、图生视频、首尾帧、参考素材）",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10009],
  models: ["minimax-h3"],
  fetchMode: "per_task",
  usageSchema: {
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Requested video duration in seconds (MiniMax H3 allows 5 to 20).",
        zh: "请求的视频时长，单位为秒（MiniMax H3 允许 5 到 20）。",
      },
    },
    resolution: {
      enum: ["480p", "720p", "1080p"],
      description: { en: "Requested output video resolution.", zh: "请求的输出视频分辨率。" },
    },
  },
  // usageSchema 只放提交期即可确定的计费维度，示例事实集与之逐键对齐（宿主硬校验覆盖）。
  // 厂商积分是任务完成后才返回的连续值，不进 schema，仍随任务原始数据持久化供对账。
  usageExamples: [
    { label: "5s 480p", facts: { duration: 5, resolution: "480p" } },
    { label: "5s 720p", facts: { duration: 5, resolution: "720p" } },
    { label: "10s 1080p", facts: { duration: 10, resolution: "1080p" } },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

// ---------------------------------------------------------------------------
// 上游契约（aivideomaker.ai，两种凭据形态，按渠道密钥自动判定）
//
//   1. 官方 API：密钥以 "ak_" 开头
//      POST /api/v1/generate/minimax   header: key
//      GET  /api/v1/tasks/{task_id}
//
//   2. 网页会话：密钥是 JSON {"cookie":"...","userId":"...","visitorId":"?"}
//      POST /api/ai.minimaxH3?batch=1  body: {"0":{"json":{...}}}（tRPC 批量信封）
//      GET  /api/model.listModel?batch=1&input=...（按下文说明）
//
// 为什么查询用 model.listModel 而不是 model-status：
//   model-status 是两步握手（先换一个 300s 签名 token，再读 SSE 流），而
//   buildQueryRequest 只能发出一个请求，插件运行时也没有 fetch()。
//   model.listModel 是单请求且返回完整记录，parseTaskResult 再按 id 定位。
//   注意：userId 必填，缺失时该端点会返回其他用户的公开视频。
//
// 站内页面事实（/zh/ai-video-generator）：模型 MiniMax H3，输入方式「仅文字 /
// 首尾帧 / 参考素材」，参数 16:9、480P、5s、快速（turbo）。
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://aivideomaker.ai";
const DEFAULT_VISITOR_ID = "00000000000000000000000000000000";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const PAGE_PATH = "/zh/ai-video-generator";
const LIST_PATH = "/zh/generations";
const LIST_LIMIT = 40;

const ASPECT_RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const RESOLUTIONS = ["480p", "720p", "1080p"];
const TIERS = ["turbo", "base"];
const ACTIONS = ["text_to_video", "image_to_video", "first_tail_to_video", "reference_to_video"];

const DEFAULT_DURATION = 5;
const MIN_DURATION = 5;
const MAX_DURATION = 20;
const DEFAULT_RESOLUTION = "720p";
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_TIER = "turbo";
const CLIENT_MODEL = "minimax-h3";

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(trimmed(value));
}

function normalizeStatusValue(value) {
  return trimmed(value).toLowerCase().replace(/[\s\-]+/g, "_");
}

function startsWithAny(value, prefixes) {
  for (const prefix of prefixes) {
    if (value.indexOf(prefix) === 0) return true;
  }
  return false;
}

function upstreamBase(ctx) {
  return String((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// 凭据
// ---------------------------------------------------------------------------

function credentials(ctx) {
  const raw = trimmed(ctx && ctx.apiKey);
  if (!raw) throw new Error("channel key is empty");
  if (raw.indexOf("ak_") === 0) return { mode: "api", key: raw };
  if (raw.charAt(0) === "{") {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error("channel key looks like JSON but failed to parse: " + err.message);
    }
    const cookie = trimmed(parsed.cookie);
    const userId = trimmed(parsed.userId);
    if (!cookie) throw new Error('web credential requires "cookie"');
    if (!userId) {
      throw new Error(
        'web credential requires "userId" (resolve it via GET /api/auth.user). ' +
          "Without it /api/model.listModel returns other users' public videos.",
      );
    }
    return {
      mode: "web",
      cookie: cookie,
      userId: userId,
      visitorId: trimmed(parsed.visitorId) || DEFAULT_VISITOR_ID,
    };
  }
  throw new Error(
    'channel key must start with "ak_" (official API) or be JSON {"cookie":"...","userId":"..."} (web session)',
  );
}

function apiHeaders(cred) {
  return { "Content-Type": "application/json", Accept: "application/json", key: cred.key };
}

function webHeaders(cred, referer) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Cookie: cred.cookie,
    "User-Agent": DEFAULT_USER_AGENT,
    Referer: DEFAULT_BASE_URL + referer,
    Origin: DEFAULT_BASE_URL,
  };
}

/** 拆 tRPC 信封：[{result:{data:{json:x}}}] / [{error:{json:{message}}}]. */
function unwrapTrpc(body) {
  if (!Array.isArray(body) || body.length === 0) return undefined;
  const first = body[0];
  if (first && first.error) {
    const message = (first.error.json && first.error.json.message) || "upstream error";
    const error = new Error(message);
    error.isTrpcError = true;
    throw error;
  }
  if (first && first.result && first.result.data) return first.result.data.json;
  return undefined;
}

/** 同 unwrapTrpc，但错误信封返回 undefined，供 artifact 回源等旁路场景使用。 */
function unwrapTrpcSafe(body) {
  try {
    return unwrapTrpc(body);
  } catch (_err) {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 内部规范模型
//   { prompt, images: [...], duration, resolution, aspectRatio, tier, action }
// ---------------------------------------------------------------------------

function adapterRequest(payload) {
  return { adapterMode: "heterogeneous", payload: payload };
}

function requirePayload(ctx) {
  const value = ctx && ctx.requestBody;
  if (!value || value.adapterMode !== "heterogeneous" || !isObject(value.payload)) {
    throw new Error("missing adapter mode");
  }
  return value.payload;
}

function normalizeAspectRatio(value) {
  const raw = trimmed(value).toLowerCase();
  for (const candidate of ASPECT_RATIOS) {
    if (candidate === raw) return candidate;
  }
  // 兼容 "16x9" / "16*9" 写法
  const parts = raw.replace("*", "x").split("x");
  if (parts.length === 2) {
    const candidate = trimmed(parts[0]) + ":" + trimmed(parts[1]);
    if (ASPECT_RATIOS.indexOf(candidate) >= 0) return candidate;
  }
  return DEFAULT_ASPECT_RATIO;
}

function normalizeResolution(value) {
  const raw = trimmed(value).toLowerCase();
  return RESOLUTIONS.indexOf(raw) >= 0 ? raw : DEFAULT_RESOLUTION;
}

function normalizeTier(value) {
  const raw = trimmed(value).toLowerCase();
  return TIERS.indexOf(raw) >= 0 ? raw : DEFAULT_TIER;
}

function normalizeDuration(value) {
  if (value === undefined || value === null || trimmed(value) === "") return DEFAULT_DURATION;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_DURATION;
  // MiniMax H3 接受 5~20 秒，取整后夹紧到区间内。
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(seconds)));
}

// 上游只接受 http/https/s3/r2 的图片地址（实测：data URL 会被拒，
// 报文是 first_frame_url[0] must use http, https, s3, or r2，且被报成 500
// INTERNAL_SERVER_ERROR，很像是服务端故障其实是参数问题），这里提前挡掉。
const IMAGE_PROTOCOLS = ["http://", "https://", "s3://", "r2://"];

function imageUrl(raw) {
  const value = trimmed(raw);
  const lower = value.toLowerCase();
  if (lower.indexOf("data:") === 0) {
    throw new Error(
      "image must be an http(s) url, not a data url (upstream first_frame_url only accepts http, https, s3, or r2)",
    );
  }
  for (const protocol of IMAGE_PROTOCOLS) {
    if (lower.indexOf(protocol) === 0) return value;
  }
  throw new Error("image url must use http, https, s3, or r2: " + value.slice(0, 48));
}

function imageList(value) {
  const images = [];
  const source = Array.isArray(value) ? value : [];
  for (const item of source) {
    if (typeof item === "string") {
      if (trimmed(item)) images.push(imageUrl(item));
      continue;
    }
    if (!isObject(item)) continue;
    // 宿主文件占位符会被内联成 base64/dataUrl，而上游不接受 data url，
    // 所以文件上传这条路走不通，必须显式说明而不是让上游回一个 500。
    if (trimmed(item.__fileRef)) {
      throw new Error(
        "file uploads are not supported: upstream only accepts http/https/s3/r2 image urls, " +
          "while the host would inline the uploaded file as a data url",
      );
    }
    if (trimmed(item.url)) images.push(imageUrl(item.url));
  }
  return images;
}

function actionFor(canonical) {
  const images = canonical.images.length;
  if (images === 0) return "text_to_video";
  if (images === 1) return "image_to_video";
  if (images === 2) return "first_tail_to_video";
  return "reference_to_video";
}

/** 把通用入站请求归一为内部规范模型；未知语义显式报错，不静默丢弃。 */
function canonicalFromGeneric(req, model) {
  // content 只在是字符串时等价于 prompt；数组形态由各协议 decoder 自行展开。
  const prompt = trimmed(req.prompt) || (typeof req.content === "string" ? trimmed(req.content) : "");
  // multipart 表单里 images 只会是单个字符串，统一按数组处理。
  const rawImages = Array.isArray(req.images) ? req.images : trimmed(req.images) ? [req.images] : [];
  const images = imageList(rawImages);
  if (!prompt && images.length === 0) throw new Error("prompt or images is required");

  const canonical = {
    model: model,
    prompt: prompt,
    images: images,
    duration: normalizeDuration(req.duration !== undefined ? req.duration : req.seconds),
    resolution: normalizeResolution(req.resolution),
    aspectRatio: normalizeAspectRatio(req.aspectRatio !== undefined ? req.aspectRatio : req.size),
    tier: normalizeTier(req.tier),
  };

  if (isObject(req.metadata) && trimmed(req.metadata.action)) {
    const action = trimmed(req.metadata.action);
    if (ACTIONS.indexOf(action) < 0) throw new Error("unsupported metadata.action: " + action);
    canonical.action = action;
  } else {
    canonical.action = actionFor(canonical);
  }
  return canonical;
}

// ---------------------------------------------------------------------------
// 唯一 encoder：内部规范模型 -> 上游白名单 body
// ---------------------------------------------------------------------------

function imageSlots(canonical) {
  const images = canonical.images;
  if (images.length === 0) return { imageUrl: null, lastFrameUrl: null, referenceImageUrls: [] };
  if (images.length === 1) return { imageUrl: images[0], lastFrameUrl: null, referenceImageUrls: [] };
  if (images.length === 2) return { imageUrl: images[0], lastFrameUrl: images[1], referenceImageUrls: [] };
  // 首页「参考素材」最多 4 张：首帧作为主图，其余进参考位。
  return { imageUrl: images[0], lastFrameUrl: null, referenceImageUrls: images.slice(1, 5) };
}

function encodeVendorBody(canonical) {
  const slots = imageSlots(canonical);
  return {
    content: canonical.prompt,
    imageUrl: slots.imageUrl,
    lastFrameUrl: slots.lastFrameUrl,
    referenceImageUrls: slots.referenceImageUrls,
    aspectRatio: canonical.aspectRatio,
    duration: canonical.duration,
    resolution: canonical.resolution,
    tier: canonical.tier,
  };
}

// ---------------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------------

export function buildSubmitRequest(ctx) {
  const cred = credentials(ctx);
  const canonical = requirePayload(ctx);
  const payload = encodeVendorBody(canonical);

  if (cred.mode === "api") {
    return {
      url: upstreamBase(ctx) + "/api/v1/generate/minimax",
      method: "POST",
      headers: apiHeaders(cred),
      body: payload,
      action: canonical.action,
      model: ctx.upstreamModel || canonical.model || CLIENT_MODEL,
    };
  }

  // 网页会话：tRPC 批量信封。token 恒为 null——订阅账号的 model.needsCaptcha
  // 返回 false，非 null 的无效 token 会被直接拒绝，而 null 表示「无需验证码」。
  const json = Object.assign({}, payload, {
    referenceVideoUrl: null,
    referenceAudioUrls: [],
    promptEnrichment: false,
    visitorId: cred.visitorId,
    token: null,
  });
  return {
    url: upstreamBase(ctx) + "/api/ai.minimaxH3?batch=1",
    method: "POST",
    headers: webHeaders(cred, PAGE_PATH),
    body: { 0: { json: json } },
    action: canonical.action,
    model: ctx.upstreamModel || canonical.model || CLIENT_MODEL,
  };
}

/** 提交失败时把上游 errorCode/message 带出来，避免只剩一句「没有 taskId」。 */
function submitErrorMessage(body, fallback) {
  if (isObject(body)) {
    const code = trimmed(body.errorCode);
    const message = failureReason(body);
    if (code) return "[" + code + "] " + (message || "upstream error");
    if (message) return message;
  }
  return fallback;
}

export function parseSubmitResponse(ctx, resp) {
  const cred = credentials(ctx);
  const body = resp && resp.body;

  if (cred.mode === "api") {
    const id = trimmed(body && (body.taskId || body.id));
    if (!id) throw new Error(submitErrorMessage(body, "missing taskId in submit response"));
    return { taskId: id, taskData: body };
  }

  const taskId = trimmed(unwrapTrpc(body));
  if (!taskId) {
    throw new Error(submitErrorMessage(body, "submit returned no task id (captcha required or session expired)"));
  }
  return { taskId: taskId, taskData: body };
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

function listInput(cred, limit) {
  return JSON.stringify({
    0: {
      json: { createdAt: null, offset: 0, limit: limit, createAtSort: "desc", userId: cred.userId },
      meta: { values: { createdAt: ["undefined"] }, v: 1 },
    },
  });
}

export function buildQueryRequest(ctx) {
  const cred = credentials(ctx);
  if (cred.mode === "api") {
    return {
      url: upstreamBase(ctx) + "/api/v1/tasks/" + encodeURIComponent(ctx.taskId),
      method: "GET",
      headers: apiHeaders(cred),
    };
  }
  const input = listInput(cred, LIST_LIMIT);
  return {
    url: upstreamBase(ctx) + "/api/model.listModel?batch=1&input=" + encodeURIComponent(input),
    method: "GET",
    headers: webHeaders(cred, LIST_PATH),
  };
}

/** 上游记录定位：api 模式是单条对象，web 模式是 {models:[...]} 列表里按 id 命中。 */
function taskRecord(ctx, body) {
  const cred = credentials(ctx);
  if (cred.mode === "api") return isObject(body) ? body : {};

  const payload = unwrapTrpc(body);
  const models = (payload && payload.models) || [];
  for (const item of models) {
    if (item && String(item.id) === String(ctx.taskId)) return item;
  }
  return null;
}

function resultUrl(record) {
  if (!isObject(record)) return "";
  const candidates = [record.url, record.videoUrl, record.video_url, record.result_url];
  if (isObject(record.output)) candidates.push(record.output.url);
  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) return trimmed(candidate);
  }
  return "";
}

function failureReason(record) {
  if (!isObject(record)) return "";
  // 官方 Error schema 里 error 是 string（与 message 并列），嵌套对象形态是另一种厂商写法，
  // 两种都要取，否则 401/402 这类只带 error 字段的错误会退化成「只有码没有原因」。
  const direct = [
    record.fail_reason,
    record.err_msg,
    record.error_message,
    record.taskStatusMsg,
    record.message,
    typeof record.error === "string" ? record.error : "",
  ];
  for (const candidate of direct) {
    if (trimmed(candidate)) return trimmed(candidate);
  }
  if (isObject(record.error)) {
    const nested = trimmed(record.error.message || record.error.msg);
    if (nested) return nested;
  }
  return "";
}

// 真实上游记录没有 progress 字段（已实测），缺失时必须退回按状态推导的默认值：
// 不能把 undefined 当 0，否则成功任务会显示 0%。
function progressValue(record, fallback) {
  if (!isObject(record)) return fallback;
  const raw = record.progress;
  if (raw === undefined || raw === null || trimmed(raw) === "") return fallback;
  const number = Number(String(raw).replace("%", ""));
  if (!Number.isFinite(number) || number < 0 || number > 100) return fallback;
  return String(Math.round(number)) + "%";
}

// 六层阶梯：错误 envelope -> 文档枚举 -> 前缀兜底 -> 失败信号 ->
// 结果 URL 兜底 -> 安全默认 QUEUED。禁止子串匹配，永不返回 UNKNOWN。
function statusResult(record) {
  const url = resultUrl(record);
  const reason = failureReason(record);
  const raw = normalizeStatusValue(isObject(record) ? record.status || record.taskStatus : "");

  if (raw === "succeed" || raw === "success" || raw === "succeeded" || raw === "completed" || raw === "complete" || raw === "done") {
    return { status: "SUCCESS", progress: progressValue(record, "100%"), url: url };
  }
  // 以下两组来自官方 OpenAPI 的 TaskStatus 枚举（SUBMITTED/PROGRESS/COMPLETED/FAILED/CANCEL）。
  // 它们本可以靠下层前缀兜底命中，但官方声明式枚举必须走精确层：CANCEL 一旦掉到
  // 默认 QUEUED，上游不会再变，任务就永远卡在轮询里。
  if (raw === "failed" || raw === "fail" || raw === "failure" || raw === "error" || raw === "cancelled" || raw === "canceled" || raw === "cancel") {
    return { status: "FAILURE", progress: "100%", reason: reason || "aivideomaker task failed" };
  }
  if (raw === "processing" || raw === "running" || raw === "in_progress" || raw === "generating" || raw === "rendering" || raw === "progress") {
    return { status: "IN_PROGRESS", progress: progressValue(record, "50%") };
  }
  if (raw === "submitted" || raw === "pending" || raw === "queued" || raw === "queueing" || raw === "waiting") {
    return { status: "QUEUED", progress: progressValue(record, "0%") };
  }
  if (startsWithAny(raw, ["success", "succ", "ok", "okay", "comp"])) {
    return { status: "SUCCESS", progress: progressValue(record, "100%"), url: url };
  }
  if (startsWithAny(raw, ["erro", "fail", "cancel", "expire", "timeout", "reject", "abort"])) {
    return { status: "FAILURE", progress: "100%", reason: reason || "aivideomaker task failed" };
  }
  if (startsWithAny(raw, ["run", "process", "progress", "generat", "render"])) {
    return { status: "IN_PROGRESS", progress: progressValue(record, "50%") };
  }
  if (startsWithAny(raw, ["queue", "pend", "submit", "wait"])) {
    return { status: "QUEUED", progress: progressValue(record, "0%") };
  }
  if (reason) return { status: "FAILURE", progress: "100%", reason: reason };
  if (url) return { status: "SUCCESS", progress: "100%", url: url };
  return { status: "QUEUED", progress: "0%" };
}

function queryHttpStatus(response) {
  if (!isObject(response)) return 0;
  const value = Number(response.status === undefined ? response.statusCode : response.status);
  return Number.isFinite(value) ? value : 0;
}

export function parseTaskResult(ctx, body, response) {
  const httpStatus = queryHttpStatus(response);
  // 传输层错误抛错让宿主重试，不落终态（否则用户拿不到退款）。
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    throw new Error("aivideomaker query failed with HTTP " + httpStatus);
  }

  const record = taskRecord(ctx, body);

  // 层 0：上游业务错误 envelope（探测到的真实形状）
  //   {"status":"FAILED","errorCode":"AUTH_FAILED","message":"Invalid API key. ..."}
  // 与任务终态失败同形但语义不同：errorCode 是渠道/参数问题，带上码便于排障。
  if (isObject(record) && trimmed(record.errorCode)) {
    return {
      code: 0,
      status: "FAILURE",
      progress: "100%",
      reason: "[" + trimmed(record.errorCode) + "] " + (failureReason(record) || "upstream error"),
    };
  }

  if (!record) {
    // 网页会话列表窗口里暂时没有该任务（刚提交或超出 limit），按排队处理，
    // 让轮询继续，而不是判失败。
    return { code: 0, status: "QUEUED", progress: "0%", reason: "task not present in listModel window" };
  }
  // data 回带命中的整条上游记录：网页会话是列表端点，只有这里能确定「哪一条是本任务」，
  // 完成期回填真实时长与对账都依赖它（批量结果同样允许带 data）。
  return Object.assign({ code: 0, data: record }, statusResult(record));
}

// ---------------------------------------------------------------------------
// 用量
// ---------------------------------------------------------------------------

export function extractUsage(ctx) {
  if (ctx && ctx.usagePurpose === "billing_ratios") return null;
  const payload = requirePayload(ctx);
  return { duration: payload.duration, resolution: payload.resolution };
}

// 只回填 usageSchema 内的维度（真实出片时长/分辨率）。厂商积分是连续值，不进
// 事实集，仍留在任务原始数据里供对账。
// 官方 Task schema 顶层没有 duration，请求参数回显在 input 里；网页会话记录则直接
// 带顶层 duration（字符串）。两种形态都必须能取到，否则 api 模式会静默回退到提交期的值。
function recordDuration(record) {
  if (!isObject(record)) return "";
  if (record.duration !== undefined && record.duration !== null && trimmed(record.duration) !== "") {
    return record.duration;
  }
  if (isObject(record.input) && record.input.duration !== undefined && record.input.duration !== null) {
    return record.input.duration;
  }
  return "";
}

export function extractUsageOnComplete(task, taskResult, body) {
  // 优先用查询命中的那条记录（网页会话下只有它归属明确），其次才是原始响应体。
  const record = firstRecord(taskResult && taskResult.data, task && task.data, taskRecordFromBody(body));
  const facts = {};
  const duration = Number(recordDuration(record));
  if (Number.isFinite(duration) && duration > 0) facts.duration = Math.round(duration);
  const resolution = trimmed(record && record.resolution).toLowerCase();
  if (RESOLUTIONS.indexOf(resolution) >= 0) facts.resolution = resolution;
  return Object.keys(facts).length ? facts : null;
}

function firstRecord() {
  for (const candidate of arguments) {
    if (isObject(candidate)) return candidate;
  }
  return null;
}

/** 完成时回填只拿得到原始响应体，这里兼容 api 单条与 web 信封两种形状。 */
function taskRecordFromBody(body) {
  const payload = Array.isArray(body) ? unwrapTrpcSafe(body) : body;
  if (isObject(payload) && Array.isArray(payload.models)) {
    // 批量信封没有请求上下文可定位，只在唯一命中时采用。
    const done = payload.models.filter(function (item) {
      return isObject(item);
    });
    return done.length === 1 ? done[0] : null;
  }
  return isObject(payload) ? payload : null;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

function artifactData(source) {
  const data = (source && source.data) || {};
  if (Array.isArray(data)) return unwrapTrpcSafe(data) || {};
  return data;
}

function artifactUrl(task) {
  const direct = trimmed(task && task.url);
  if (isHttpUrl(direct)) return direct;
  const data = artifactData(task);
  if (isObject(data) && !Array.isArray(data.models)) return resultUrl(data);
  if (isObject(data) && Array.isArray(data.models)) {
    for (const item of data.models) {
      const candidate = resultUrl(item);
      if (candidate) return candidate;
    }
  }
  return "";
}

export function listArtifacts(task) {
  if (String(task && task.status).toUpperCase() !== "SUCCESS") return [];
  if (!artifactUrl(task)) return [];
  return [{ key: "video", type: "video", mimeType: "video/mp4" }];
}

export function buildContentRequest(ctx) {
  if (trimmed(ctx && ctx.artifactKey) !== "video") throw new Error("artifact_not_found");
  const url = trimmed(ctx && ctx.url) || artifactUrl(ctx);
  if (!isHttpUrl(url)) throw new Error("artifact_not_found");
  // 成片在 static.img2video.ai 公有 CDN 上，回源不能带渠道鉴权。
  return {
    url: url,
    method: ctx && ctx.clientRequest ? ctx.clientRequest.method : "GET",
    credentialless: true,
  };
}

// ---------------------------------------------------------------------------
// 协议：openai_responses / openai_video
// ---------------------------------------------------------------------------

function escapeAttr(value) {
  return trimmed(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function videoTag(url) {
  return '<video controls src="' + escapeAttr(url) + '"></video>';
}

function responseVideoUrl(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url) || trimmed(ctx && ctx.url) || artifactUrl(ctx);
  if (!isHttpUrl(url)) throw new Error("video artifact is unavailable");
  return url;
}

function decodeResponsesBody(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const req = ctx.body.value;
  if (!isObject(req)) throw new Error("request body must be an object");
  const model = trimmed(req.model) || CLIENT_MODEL;

  let prompt = trimmed(req.prompt);
  const images = [];
  if (!prompt && typeof req.input === "string") prompt = trimmed(req.input);
  if (Array.isArray(req.input)) {
    for (const part of req.input) {
      if (typeof part === "string") {
        if (!prompt) prompt = trimmed(part);
        continue;
      }
      if (!isObject(part)) continue;
      // 标准形态是 {role, content:[{type,text}]}；也兼容被摊平的 {type, text/image_url}。
      const inner = Array.isArray(part.content)
        ? part.content
        : isObject(part.content)
          ? [part.content]
          : [part];
      for (const piece of inner) {
        if (!isObject(piece)) continue;
        if ((piece.type === "input_text" || piece.type === "text") && !prompt) prompt = trimmed(piece.text);
        if (piece.type === "input_image" || piece.type === "image_url") {
          let image = piece.image_url;
          if (isObject(image)) image = image.url;
          if (trimmed(image)) images.push(trimmed(image));
        }
      }
    }
  }

  const seconds = req.duration !== undefined ? req.duration : req.seconds;
  const canonical = canonicalFromGeneric(
    {
      prompt: prompt,
      // input 里采集到的图片优先；没有 input 图片时兼容请求体自带的 images。
      images: images.length ? images : req.images,
      duration: seconds,
      resolution: req.resolution,
      aspectRatio: req.aspectRatio !== undefined ? req.aspectRatio : req.size,
      tier: req.tier,
      metadata: isObject(req.metadata) ? req.metadata : undefined,
    },
    model,
  );
  return { kind: "submit", model: model, action: canonical.action, requestBody: adapterRequest(canonical) };
}

function decodeVideoBody(ctx) {
  if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) {
    throw new Error("JSON or multipart body required");
  }
  let req;
  if (ctx.body.kind === "json") {
    if (!isObject(ctx.body.value)) throw new Error("JSON object required");
    req = Object.assign({}, ctx.body.value);
  } else {
    req = {};
    const fields = ctx.body.fields || {};
    for (const name of Object.keys(fields)) {
      const values = fields[name] || [];
      if (values.length > 1) throw new Error(name + " must be provided once");
      req[name] = values[0];
    }
    if (ctx.body.files && ctx.body.files.length) throw new Error("file uploads are not supported by this plugin");
  }
  const model = trimmed(ctx.upstreamModel || ctx.model) || CLIENT_MODEL;
  const canonical = canonicalFromGeneric(req, model);
  return { kind: "submit", model: model, action: canonical.action, requestBody: adapterRequest(canonical) };
}

export const protocols = {
  openai_responses: {
    decodeRequest: decodeResponsesBody,

    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "QUEUED").toUpperCase();
      const state = { status: status };
      if (status === "SUCCESS") {
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: videoTag(responseVideoUrl(ctx)) }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE") {
        return {
          events: [{ type: "error", code: "task_failed", message: trimmed(task.fail_reason) || "task failed" }],
          state: state,
          done: true,
        };
      }
      if (previousState && previousState.status === status) return { events: [], state: state, done: false };
      return { events: [{ type: "progress", message: status.toLowerCase() }], state: state, done: false };
    },

    renderFinal: function (ctx) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: videoTag(responseVideoUrl(ctx)), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "aivideomaker" },
      };
    },
  },

  openai_video: {
    decodeRequest: decodeVideoBody,

    render: function (ctx, task) {
      const statusMap = {
        NOT_START: "queued",
        SUBMITTED: "queued",
        QUEUED: "queued",
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      const output = {
        id: task.task_id,
        object: "video",
        model: trimmed(task.model) || CLIENT_MODEL,
        status: statusMap[task.status] || "queued",
        progress: Number(String(task.progress || "0").replace("%", "")) || 0,
        created_at: task.created_at,
      };
      if (task.updated_at) output.completed_at = task.updated_at;
      if (task.status === "FAILURE") {
        output.error = { message: trimmed(task.fail_reason) || "task failed", code: "task_failed" };
      }
      return output;
    },
  },
};
