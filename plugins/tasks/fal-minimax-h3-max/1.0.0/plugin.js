export const meta = {
  apiVersion: 1,
  key: "fal-minimax-h3-max",
  name: "fal MiniMax H3 Max Video",
  icon: "MiniMax.Color",
  description: {
    en: "fal.ai MiniMax H3 Max video generation (text/image/reference to video)",
    zh: "fal.ai MiniMax H3 Max 视频生成（文生/图生/参考生视频）",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10005],
  models: [
    "minimax/h3-max/text-to-video",
    "minimax/h3-max/image-to-video",
    "minimax/h3-max/reference-to-video",
  ],
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: {
        en: "Requested video duration in seconds (fal default is 5).",
        zh: "请求的视频时长，单位为秒（fal 默认 5 秒）。",
      },
    },
    resolution: {
      enum: ["480P", "768P"],
      description: { en: "Requested output video resolution.", zh: "请求的输出视频分辨率。" },
    },
  },
  usageExamples: [
    { label: "768P 5s", facts: { seconds: 5, resolution: "768P" } },
    { label: "768P 10s", facts: { seconds: 10, resolution: "768P" } },
    { label: "480P 5s", facts: { seconds: 5, resolution: "480P" } },
  ],
  protocols: ["openai_video"],
  routes: [
    // 原生同构：/{biz}=/fal + fal 队列原生路径 /{endpoint_id}，body 与 fal input schema 逐字段一致
    {
      method: "POST",
      path: "/fal/minimax/h3-max/text-to-video",
      type: "submit",
      models: ["minimax/h3-max/text-to-video"],
      decode: "createTextToVideo",
      render: "createdVideo",
    },
    {
      method: "POST",
      path: "/fal/minimax/h3-max/image-to-video",
      type: "submit",
      models: ["minimax/h3-max/image-to-video"],
      decode: "createImageToVideo",
      render: "createdVideo",
    },
    {
      method: "POST",
      path: "/fal/minimax/h3-max/reference-to-video",
      type: "submit",
      models: ["minimax/h3-max/reference-to-video"],
      decode: "createReferenceToVideo",
      render: "createdVideo",
    },
    // fal 队列查询原生路径 /{app}/requests/{request_id}（response 端点）；
    // fal 对子路径端点的 requests URL 只保留 {owner}/{app}，不含 route 段
    {
      method: "GET",
      path: "/fal/minimax/h3-max/requests/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "queryVideo",
    },
  ],
};

// ---------------------------------------------------------------------------
// fal 队列契约（https://docs.fal.ai）：
// - 提交：POST https://queue.fal.run/{endpoint_id}，鉴权 "Authorization: Key <FAL_KEY>"，
//   响应 { request_id, status_url, response_url, cancel_url, queue_position }。
// - 轮询：本插件直接 GET /{app}/requests/{request_id}（response 端点）。
//   未完成时返回 HTTP 400 且 detail.type === "request_in_progress"；
//   失败/取消/过期返回对应 4xx/5xx + FalErrorResponse；
//   成功返回 200，body 为 { video: { url, content_type, file_name, file_size }, ... }。
// - status 端点只有 IN_QUEUE / IN_PROGRESS / COMPLETED 三态，失败也以 COMPLETED + error 呈现；
//   response 端点一次拿到终态结果，无需二段查询，因此轮询固定打 response 端点。
// - director 端点是 WebRTC 实时会话（realtime contract），不属于异步任务，无法由本插件接入。
// ---------------------------------------------------------------------------

const QUEUE_APP = "minimax/h3-max";

const ENDPOINTS = {
  "minimax/h3-max/text-to-video": { action: "text_to_video" },
  "minimax/h3-max/image-to-video": { action: "image_to_video" },
  "minimax/h3-max/reference-to-video": { action: "reference_to_video" },
};

const DEFAULT_DURATION = 5;
const DEFAULT_RESOLUTION = "768P";
const RESOLUTIONS = ["480P", "768P"];
const T2V_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const R2V_RATIOS = ["adaptive"].concat(T2V_RATIOS);
const MAX_REFERENCE_FILES = 12;

function trimmed(value) {
  return String(value || "").trim();
}

function isEndpoint(value) {
  return Object.prototype.hasOwnProperty.call(ENDPOINTS, value);
}

function isMediaValue(value) {
  // 宿主文件占位符保持对象；字符串必须是 http(s) URL 或 data URI（fal 两者都接受）
  if (value && typeof value === "object" && !Array.isArray(value)) return true;
  const s = trimmed(value);
  return /^https?:\/\//.test(s) || /^data:/.test(s);
}

// ---------------------------------------------------------------------------
// 请求适配 envelope：{ adapterMode, endpoint, payload }
// - isomorphic：payload 为保真复制的 fal 原生 input body（原生路由）
// - heterogeneous：payload 为内部规范模型（openai_video 协议入口）
// ---------------------------------------------------------------------------

function adapterRequest(mode, endpoint, payload) {
  if (mode !== "isomorphic" && mode !== "heterogeneous") throw new Error("invalid adapter mode");
  if (!isEndpoint(endpoint)) throw new Error("invalid fal endpoint: " + String(endpoint));
  return { adapterMode: mode, endpoint: endpoint, payload: payload };
}

function requireAdapterRequest(ctx) {
  const value = ctx && ctx.requestBody;
  if (!value || (value.adapterMode !== "isomorphic" && value.adapterMode !== "heterogeneous")) {
    throw new Error("missing adapter mode");
  }
  return value;
}

// ---------------------------------------------------------------------------
// 原生同构入口：只做容器与必填校验，浅复制保真透传
// ---------------------------------------------------------------------------

function decodeNativeIsomorphic(ctx, endpoint) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const input = ctx.body.value;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("request body must be an object");
  if (!trimmed(input.prompt)) throw new Error("prompt is required");
  return {
    kind: "submit",
    model: endpoint,
    action: ENDPOINTS[endpoint].action,
    requestBody: adapterRequest("isomorphic", endpoint, Object.assign({}, input)),
  };
}

// 同构模式的最小修正清单：仅删除 body 内的 model（fal input schema 没有 model 字段，
// 端点身份由 URL 承载）。保留未知厂商扩展字段、false/0/null 与数组顺序。
function buildIsomorphicBody(request) {
  const body = Object.assign({}, request.payload || {});
  delete body.model;
  return body;
}

// ---------------------------------------------------------------------------
// 异构入口（openai_video）：协议解码 -> 内部规范模型 -> 单一 encoder 白名单重建
// ---------------------------------------------------------------------------

function normalizeResolution(raw) {
  const value = trimmed(raw).toUpperCase();
  if (!value) return "";
  if (value.indexOf("480") >= 0) return "480P";
  if (value.indexOf("768") >= 0) return "768P";
  throw new Error("resolution must be one of " + RESOLUTIONS.join(", "));
}

function normalizeDuration(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error("duration must be a positive integer of seconds");
  return seconds;
}

function mediaURLList(raw, name) {
  if (raw === undefined || raw === null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const list = [];
  for (const value of values) {
    if (value === undefined || value === null || trimmed(value) === "" && typeof value !== "object") continue;
    if (!isMediaValue(value)) throw new Error(name + " must contain http(s)/data URLs");
    list.push(value && typeof value === "object" ? value : trimmed(value));
  }
  return list;
}

// 端点选择优先级：显式模型（渠道映射/客户端指定）> 媒体形态推断
function chooseEndpoint(explicitModel, media) {
  if (isEndpoint(explicitModel)) return explicitModel;
  const refs = media.referenceImages.length + media.referenceVideos.length + media.referenceAudios.length;
  if (refs > 0) return "minimax/h3-max/reference-to-video";
  if (media.firstFrame) return "minimax/h3-max/image-to-video";
  return "minimax/h3-max/text-to-video";
}

function validateNormalized(normalized) {
  const endpoint = normalized.endpoint;
  const media = normalized.media;
  const refs = media.referenceImages.length + media.referenceVideos.length + media.referenceAudios.length;
  if (!trimmed(normalized.prompt)) throw new Error("prompt is required");
  if (endpoint === "minimax/h3-max/text-to-video") {
    if (media.firstFrame || media.lastFrame || refs) throw new Error("text-to-video does not accept image or reference inputs");
    if (normalized.generation.aspectRatio && T2V_RATIOS.indexOf(normalized.generation.aspectRatio) < 0)
      throw new Error("aspect_ratio must be one of " + T2V_RATIOS.join(", "));
  }
  if (endpoint === "minimax/h3-max/image-to-video") {
    if (refs) throw new Error("image-to-video does not accept reference media");
    if (normalized.generation.aspectRatio) throw new Error("image-to-video does not accept aspect_ratio (it follows the input image)");
  }
  if (endpoint === "minimax/h3-max/reference-to-video") {
    if (media.firstFrame || media.lastFrame) throw new Error("reference-to-video does not accept frame images");
    if (refs === 0) throw new Error("reference-to-video requires at least one reference image or video");
    if (media.referenceImages.length + media.referenceVideos.length === 0)
      throw new Error("reference audio cannot be the only reference input");
    if (refs > MAX_REFERENCE_FILES) throw new Error("reference files must add up to at most " + MAX_REFERENCE_FILES);
    if (normalized.generation.aspectRatio && R2V_RATIOS.indexOf(normalized.generation.aspectRatio) < 0)
      throw new Error("aspect_ratio must be one of " + R2V_RATIOS.join(", "));
  }
  if (normalized.generation.resolution && RESOLUTIONS.indexOf(normalized.generation.resolution) < 0)
    throw new Error("resolution must be one of " + RESOLUTIONS.join(", "));
}

// 唯一 encoder：按 fal 各端点 input schema 白名单重建 body，客户端私有字段不外泄
function encodeFalRequest(normalized) {
  const endpoint = normalized.endpoint;
  const generation = normalized.generation;
  const media = normalized.media;
  const vendor = normalized.vendorOptions || {};
  const body = { prompt: normalized.prompt };
  if (generation.duration !== undefined) body.duration = generation.duration;
  if (generation.resolution) body.resolution = generation.resolution;
  if (vendor.seed !== undefined) body.seed = vendor.seed;
  if (vendor.enable_safety_checker !== undefined) body.enable_safety_checker = vendor.enable_safety_checker;
  if (vendor.prompt_expansion_mode !== undefined) body.prompt_expansion_mode = vendor.prompt_expansion_mode;
  if (vendor.sync_mode !== undefined) body.sync_mode = vendor.sync_mode;
  if (endpoint === "minimax/h3-max/text-to-video") {
    if (generation.aspectRatio) body.aspect_ratio = generation.aspectRatio;
  }
  if (endpoint === "minimax/h3-max/image-to-video") {
    if (media.firstFrame) body.image_url = media.firstFrame;
    if (media.lastFrame) body.end_image_url = media.lastFrame;
  }
  if (endpoint === "minimax/h3-max/reference-to-video") {
    if (generation.aspectRatio) body.aspect_ratio = generation.aspectRatio;
    if (media.referenceImages.length) body.reference_image_urls = media.referenceImages;
    if (media.referenceVideos.length) body.reference_video_urls = media.referenceVideos;
    if (media.referenceAudios.length) body.reference_audio_urls = media.referenceAudios;
  }
  return body;
}

// ---------------------------------------------------------------------------
// driver hooks：只消费 ctx.requestBody（canonical envelope），不按客户端入口分支
// ---------------------------------------------------------------------------

function submitEndpoint(ctx, request) {
  // ctx.upstreamModel 是渠道映射后的厂商模型（即 fal endpoint id），优先于 decoder 记录的端点
  const mapped = trimmed(ctx.upstreamModel);
  if (mapped && isEndpoint(mapped)) return mapped;
  return request.endpoint;
}

function upstreamHeaders(ctx) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: "Key " + ctx.apiKey,
  };
}

function queueBase(ctx) {
  return String(ctx.baseUrl || "https://queue.fal.run").replace(/\/+$/, "");
}

export function buildSubmitRequest(ctx) {
  const request = requireAdapterRequest(ctx);
  const endpoint = submitEndpoint(ctx, request);
  let body;
  if (request.adapterMode === "isomorphic") {
    body = buildIsomorphicBody(request);
  } else {
    const normalized = Object.assign({}, request.payload, { endpoint: endpoint });
    validateNormalized(normalized);
    body = encodeFalRequest(normalized);
  }
  return {
    url: queueBase(ctx) + "/" + endpoint,
    method: "POST",
    headers: upstreamHeaders(ctx),
    body: body,
    action: ENDPOINTS[endpoint].action,
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = resp.body || {};
  const detail = falDetail(body);
  if (detail.message && !trimmed(body.request_id)) throw new Error(detail.message);
  const requestId = trimmed(body.request_id);
  if (!requestId) throw new Error("missing request_id in fal submit response");
  // 持久化完整提交回执（含 status_url/response_url/queue_position），供原生 render 透传
  return { taskId: requestId, taskData: body };
}

export function buildQueryRequest(ctx) {
  // 单一上游 app：fal 对子路径端点的 requests URL 固定为 {app}/requests/{id}，
  // 不依赖轮询上下文中可能为空的模型字段
  return {
    url: queueBase(ctx) + "/" + QUEUE_APP + "/requests/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Key " + ctx.apiKey },
  };
}

// ---------------------------------------------------------------------------
// 状态判定：轮询 response 端点，依 HTTP 状态 + FalErrorResponse.detail 分派
// ---------------------------------------------------------------------------

// FalErrorResponse.detail 兼容三种形态：字符串、对象 {type,msg}、FastAPI 校验数组 [{type,msg,loc}]
function falDetail(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const detail = b.detail;
  if (typeof detail === "string") return { type: "", message: trimmed(detail) };
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (first && typeof first === "object") {
      return { type: trimmed(first.type), message: trimmed(first.msg || first.message) || "upstream validation error" };
    }
    return { type: "", message: detail.length ? "upstream validation error" : "" };
  }
  if (detail && typeof detail === "object") {
    return { type: trimmed(detail.type), message: trimmed(detail.msg || detail.message || detail.detail) };
  }
  // status 端点形态的失败：COMPLETED + error/error_type
  if (trimmed(b.error)) return { type: trimmed(b.error_type), message: trimmed(b.error) };
  return { type: "", message: "" };
}

function resultVideoURL(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const video = b.video && typeof b.video === "object" && !Array.isArray(b.video) ? b.video : {};
  const url = trimmed(video.url);
  // sync_mode 下 fal 可能返回 data URI；成功判定两者都认，制品回源只认 http(s)
  if (/^https?:\/\//.test(url) || /^data:/.test(url)) return url;
  return "";
}

function normalizeStatus(value) {
  return trimmed(value).toLowerCase().replace(/[\s\-.]+/g, "_");
}

// fal 队列文档声明的状态枚举（status 端点形态防御性覆盖）
const STATUS_MAP = {
  in_queue: "QUEUED",
  in_progress: "IN_PROGRESS",
};

const PREFIX = {
  FAILURE: ["erro", "fail", "cancel", "expire", "timeout", "reject", "abort"],
  IN_PROGRESS: ["run", "process", "progress", "generat", "render"],
  QUEUED: ["queue", "pend", "submit", "wait"],
};

function statusResult(body, httpCode) {
  const detail = falDetail(body);
  const detailType = normalizeStatus(detail.type);

  // 层 1：response 端点文档声明——进行中即 400 + request_in_progress
  if (detailType === "request_in_progress") return { status: "IN_PROGRESS", progress: "50%" };
  if (detailType === "request_pending" || detailType === "request_in_queue" || detailType === "request_queued")
    return { status: "QUEUED", progress: "0%" };

  // 层 4（前置为主判据）：response 端点成功即 200 + video.url，且无失败信号
  const url = resultVideoURL(body);
  if (url && !detail.message) return { status: "SUCCESS", progress: "100%", url: url };

  // status 端点形态防御：COMPLETED + error 即失败；COMPLETED 无结果说明还没拿到 response
  const raw = normalizeStatus(body && body.status);
  if (raw === "completed") {
    if (detail.message) return { status: "FAILURE", progress: "100%", reason: detail.message };
    return { status: "IN_PROGRESS", progress: "90%" };
  }
  if (STATUS_MAP[raw]) {
    return { status: STATUS_MAP[raw], progress: STATUS_MAP[raw] === "IN_PROGRESS" ? "50%" : "0%" };
  }

  // 层 3：前缀模糊兜底（仅前缀，禁子串）
  for (const state of ["FAILURE", "IN_PROGRESS", "QUEUED"]) {
    for (const prefix of PREFIX[state]) {
      if (raw.indexOf(prefix) === 0) {
        if (state === "FAILURE") return { status: "FAILURE", progress: "100%", reason: detail.message || "upstream task failed" };
        return { status: state, progress: state === "IN_PROGRESS" ? "50%" : "0%" };
      }
    }
  }

  // 层 5：HTTP 4xx + 失败信号（失败/取消/过期返回对应状态码 + FalErrorResponse）
  if (httpCode >= 400 && httpCode < 500 && detail.message) {
    return { status: "FAILURE", progress: "100%", reason: detail.message };
  }
  if (detail.message && httpCode >= 400) {
    return { status: "FAILURE", progress: "100%", reason: detail.message };
  }

  // 层 6：安全默认，绝不 UNKNOWN
  return { status: "QUEUED", progress: "0%" };
}

function queryHTTPStatus(ctx, response) {
  if (response && Number.isFinite(Number(response.status))) return Number(response.status);
  if (ctx && ctx.response && Number.isFinite(Number(ctx.response.status))) return Number(ctx.response.status);
  return 0;
}

export function parseTaskResult(ctx, body, response) {
  let parsed = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      parsed = {};
    }
  }
  const httpCode = queryHTTPStatus(ctx, response);
  const detail = falDetail(parsed);
  // 408/429/5xx：抛错让宿主重试，不落终态（fal runner 故障会自动重排队重试）
  if (httpCode === 408 || httpCode === 429 || httpCode >= 500) {
    throw new Error(detail.message || "fal upstream error (http " + httpCode + ")");
  }
  return Object.assign({ code: 0 }, statusResult(parsed, httpCode));
}

// ---------------------------------------------------------------------------
// 用量：提交时按请求的时长/分辨率保守预估；fal 结果不回报用量，完成后不改写
// ---------------------------------------------------------------------------

function usageFacts(request) {
  const payload = request.payload || {};
  if (request.adapterMode === "isomorphic") {
    const duration = Number(payload.duration);
    let resolution = DEFAULT_RESOLUTION;
    try {
      resolution = normalizeResolution(payload.resolution) || DEFAULT_RESOLUTION;
    } catch (_) {
      resolution = DEFAULT_RESOLUTION;
    }
    return {
      seconds: Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION,
      resolution: resolution,
    };
  }
  const generation = payload.generation || {};
  return {
    seconds: generation.duration !== undefined ? generation.duration : DEFAULT_DURATION,
    resolution: generation.resolution || DEFAULT_RESOLUTION,
  };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  return usageFacts(requireAdapterRequest(ctx));
}

// ---------------------------------------------------------------------------
// Artifact：成功结果 body.video.url（fal.media 公共 CDN，credentialless 回源）
// ---------------------------------------------------------------------------

function artifactData(source) {
  const data = (source && source.data) || {};
  // 宿主可能把厂商响应再包一层 { task_id, data: {...} }
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data) && data.data.video) return data.data;
  return data;
}

function artifactVideo(source) {
  const data = artifactData(source);
  const video = data.video && typeof data.video === "object" && !Array.isArray(data.video) ? data.video : {};
  const url = trimmed(video.url);
  if (!/^https?:\/\//.test(url)) return null;
  return { url: url, mimeType: trimmed(video.content_type) || "video/mp4" };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const video = artifactVideo(task);
  if (!video) return [];
  return [{ key: "video", type: "video", mimeType: video.mimeType }];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const video = artifactVideo(ctx);
  if (!video) throw new Error("artifact_not_found");
  // fal.media 输出 URL 公开可访问且有有效期，严禁携带渠道密钥回源
  return { url: video.url, method: ctx.clientRequest.method, credentialless: true };
}

// ---------------------------------------------------------------------------
// 原生路由（同构直通）
// ---------------------------------------------------------------------------

export const native = {
  createTextToVideo(ctx) {
    return decodeNativeIsomorphic(ctx, "minimax/h3-max/text-to-video");
  },
  createImageToVideo(ctx) {
    return decodeNativeIsomorphic(ctx, "minimax/h3-max/image-to-video");
  },
  createReferenceToVideo(ctx) {
    return decodeNativeIsomorphic(ctx, "minimax/h3-max/reference-to-video");
  },

  createdVideo(_ctx, task) {
    const data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    // 透传 fal 提交回执（request_id/status_url/response_url/queue_position），并附宿主公开任务 ID
    return Object.assign({}, data, { id: task.task_id, request_id: trimmed(data.request_id) || task.task_id });
  },

  queryVideo(_ctx, task) {
    const data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    if (data.video) {
      // 已持久化最终结果：按 fal response 形态透传，补公开 ID 与状态
      return Object.assign({}, data, { id: task.task_id, status: "COMPLETED" });
    }
    const statusMap = {
      NOT_START: "IN_QUEUE",
      SUBMITTED: "IN_QUEUE",
      QUEUED: "IN_QUEUE",
      IN_PROGRESS: "IN_PROGRESS",
      SUCCESS: "COMPLETED",
      FAILURE: "COMPLETED",
    };
    const output = { id: task.task_id, request_id: trimmed(data.request_id) || task.task_id, status: statusMap[task.status] || "IN_QUEUE" };
    if (task.status === "FAILURE") output.error = task.fail_reason || "task failed";
    return output;
  },
};

// ---------------------------------------------------------------------------
// openai_video 协议（异构）：OpenAI Video 请求 -> 内部规范模型 -> fal encoder
// 字段映射：seconds -> duration；size -> resolution（480P/768P）；
// input_reference（URL 或文件）-> image_url（i2v 首帧）；
// metadata.{end_image_url, reference_image_urls, reference_video_urls,
//   reference_audio_urls, aspect_ratio, seed, enable_safety_checker,
//   prompt_expansion_mode} -> 同名/对应 fal 字段（白名单）
// ---------------------------------------------------------------------------

function decodeOpenAIVideo(ctx) {
  if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
  let req;
  let firstFrameFile = null;
  if (ctx.body.kind === "json") {
    if (!ctx.body.value || typeof ctx.body.value !== "object" || Array.isArray(ctx.body.value)) throw new Error("JSON object required");
    req = Object.assign({}, ctx.body.value);
  } else {
    req = {};
    const fields = ctx.body.fields || {};
    for (const name of Object.keys(fields)) {
      const values = fields[name] || [];
      if (values.length > 1) throw new Error(name + " must be provided once");
      req[name] = values[0];
    }
    for (const file of ctx.body.files || []) {
      if (file.field !== "input_reference") throw new Error("unexpected file field: " + file.field);
      if (firstFrameFile) throw new Error("input_reference must be provided once");
      firstFrameFile = { __fileRef: "request_file:input_reference", encoding: "dataUrl", maxBytes: 20971520 };
    }
    if (req.metadata !== undefined) {
      let parsedMetadata;
      try {
        parsedMetadata = JSON.parse(req.metadata);
      } catch (_) {
        throw new Error("metadata must be a JSON object string");
      }
      if (!parsedMetadata || typeof parsedMetadata !== "object" || Array.isArray(parsedMetadata)) throw new Error("metadata must be a JSON object string");
      req.metadata = parsedMetadata;
    }
  }
  if (req.metadata !== undefined && (!req.metadata || typeof req.metadata !== "object" || Array.isArray(req.metadata)))
    throw new Error("metadata must be an object");
  const metadata = req.metadata || {};

  // 字段来源优先级固定：显式协议字段 > metadata 兼容字段；不依赖对象覆盖顺序
  const prompt = trimmed(req.prompt);
  const duration = normalizeDuration(req.seconds !== undefined ? req.seconds : req.duration);
  const resolution = normalizeResolution(req.size !== undefined ? req.size : req.resolution);
  const aspectRatio = trimmed(metadata.aspect_ratio);
  const firstFrame = firstFrameFile || (isMediaValue(req.input_reference) ? trimmed(req.input_reference) || req.input_reference : "") || (isMediaValue(req.image) ? trimmed(req.image) || req.image : "");
  const media = {
    firstFrame: firstFrame || "",
    lastFrame: isMediaValue(metadata.end_image_url) ? metadata.end_image_url : "",
    referenceImages: mediaURLList(metadata.reference_image_urls, "reference_image_urls"),
    referenceVideos: mediaURLList(metadata.reference_video_urls, "reference_video_urls"),
    referenceAudios: mediaURLList(metadata.reference_audio_urls, "reference_audio_urls"),
  };
  const vendorOptions = {};
  if (metadata.seed !== undefined && metadata.seed !== null) vendorOptions.seed = Number(metadata.seed);
  if (metadata.enable_safety_checker !== undefined && metadata.enable_safety_checker !== null)
    vendorOptions.enable_safety_checker = Boolean(metadata.enable_safety_checker);
  if (trimmed(metadata.prompt_expansion_mode)) vendorOptions.prompt_expansion_mode = trimmed(metadata.prompt_expansion_mode);

  const endpoint = chooseEndpoint(trimmed(ctx.upstreamModel) || trimmed(req.model) || trimmed(ctx.model), media);
  const normalized = {
    endpoint: endpoint,
    prompt: prompt,
    media: media,
    generation: { duration: duration, resolution: resolution || "", aspectRatio: aspectRatio },
    vendorOptions: vendorOptions,
  };
  validateNormalized(normalized);
  return {
    kind: "submit",
    model: trimmed(req.model) || ctx.model || endpoint,
    action: ENDPOINTS[endpoint].action,
    requestBody: adapterRequest("heterogeneous", endpoint, normalized),
  };
}

export const protocols = {
  openai_video: {
    decodeRequest: decodeOpenAIVideo,
    render: function (_ctx, task) {
      const statuses = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
      const output = {
        id: task.task_id,
        object: "video",
        model: task.properties && task.properties.origin_model_name ? task.properties.origin_model_name : "",
        status: statuses[task.status] || "queued",
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: task.created_at,
      };
      if (task.updated_at) output.completed_at = task.updated_at;
      if (task.status === "FAILURE") output.error = { message: task.fail_reason || "task failed", code: "task_failed" };
      return output;
    },
  },
};
