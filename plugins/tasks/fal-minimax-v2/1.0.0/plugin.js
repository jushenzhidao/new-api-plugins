export const meta = {
  apiVersion: 1,
  key: "fal-minimax-v2",
  name: "fal MiniMax /v2 Bridge",
  icon: "MiniMax.Color",
  description: {
    en: "MiniMax /v2 video generation API surface bridged to fal.ai MiniMax H3 Max upstream",
    zh: "MiniMax /v2 视频生成接口入口，异构转换到 fal.ai MiniMax H3 Max 上游",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10006],
  models: ["MiniMax-H3-Max"],
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: {
        en: "Requested video duration in seconds (MiniMax-H3-Max allows 5 to 15).",
        zh: "请求的视频时长，单位为秒（MiniMax-H3-Max 允许 5 到 15）。",
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
    { label: "480P 15s", facts: { seconds: 15, resolution: "480P" } },
  ],
  routes: [
    // 原生异构：路径保真 MiniMax /v2 官方契约（/{biz}=/fal-minimax + 厂商原生路径），
    // 但 body 需要 content[] -> fal input schema 的结构转换，因此 adapterMode 恒为 heterogeneous
    {
      method: "POST",
      path: "/fal-minimax/v2/video_generation",
      type: "submit",
      models: ["MiniMax-H3-Max"],
      decode: "createVideo",
      render: "createdVideo",
    },
    {
      method: "GET",
      path: "/fal-minimax/v2/query/video_generation/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "queryVideo",
    },
  ],
};

// ---------------------------------------------------------------------------
// 入站契约：MiniMax 开放平台 /v2 视频生成
//   POST /v2/video_generation  { model, content[], resolution, duration, ratio?, callback_url?, aigc_watermark? }
//   GET  /v2/query/video_generation/{task_id} -> { task: { id, status, content:{url}, usage, ... } }
//   status 枚举：queued / running / succeeded / failed / cancelled
// 上游契约：fal.ai 队列（queue.fal.run），端点 minimax/h3-max/{text,image,reference}-to-video
//   鉴权 "Authorization: Key"；轮询 response 端点：进行中 = 400 + detail.type=request_in_progress，
//   成功 = 200 + { video: { url } }，失败/过期 = 4xx + FalErrorResponse
// 语义缺口（显式拒绝，不静默丢弃）：
//   - resolution 2K / duration 4：fal h3-max 不支持（480P/768P，5~15s）
//   - callback_url：fal 回调是提交期 webhookUrl 查询参数且推送体为 fal 形状，无法复刻 MiniMax challenge 验证语义
//   - aigc_watermark: true：fal 无对应参数
// ---------------------------------------------------------------------------

const QUEUE_APP = "minimax/h3-max";
const CLIENT_MODEL = "MiniMax-H3-Max";

const ENDPOINTS = {
  "minimax/h3-max/text-to-video": { action: "text_to_video" },
  "minimax/h3-max/image-to-video": { action: "image_to_video" },
  "minimax/h3-max/reference-to-video": { action: "reference_to_video" },
};

const MIN_DURATION = 5;
const MAX_DURATION = 15;
const DEFAULT_DURATION = 5;
const DEFAULT_RESOLUTION = "768P";
const RESOLUTIONS = ["480P", "768P"];
const CONCRETE_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
// MiniMax 各类型上限（首帧1/尾帧1/参考图9/参考视频3/参考音频3）与 fal 参考总数上限 12 同时生效
const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_VIDEOS = 3;
const MAX_REFERENCE_AUDIOS = 3;
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

function adapterRequest(endpoint, payload) {
  if (!isEndpoint(endpoint)) throw new Error("invalid fal endpoint: " + String(endpoint));
  return { adapterMode: "heterogeneous", endpoint: endpoint, payload: payload };
}

function requireAdapterRequest(ctx) {
  const value = ctx && ctx.requestBody;
  if (!value || value.adapterMode !== "heterogeneous") throw new Error("missing adapter mode");
  return value;
}

// ---------------------------------------------------------------------------
// MiniMax content[] -> 内部规范模型
// ---------------------------------------------------------------------------

function mediaSource(item, type) {
  // MiniMax content 项形如 { type: "image_url", image_url: { url }, role }；
  // 兼容直接字符串 URL 与宿主文件占位符对象
  const holder = item[type];
  if (holder && typeof holder === "object" && !Array.isArray(holder)) {
    if (holder.__fileRef) return holder;
    if (isMediaValue(holder.url)) return typeof holder.url === "object" ? holder.url : trimmed(holder.url);
    throw new Error(type + " requires an http(s)/data url");
  }
  if (isMediaValue(holder)) return trimmed(holder);
  throw new Error(type + " requires an http(s)/data url");
}

function normalizeContent(content) {
  if (!Array.isArray(content) || content.length === 0) throw new Error("content must be a non-empty array");
  const texts = [];
  const media = { firstFrame: "", lastFrame: "", referenceImages: [], referenceVideos: [], referenceAudios: [] };
  for (const item of content) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("content items must be objects");
    const type = trimmed(item.type);
    const role = trimmed(item.role);
    if (type === "text") {
      if (trimmed(item.text)) texts.push(trimmed(item.text));
      continue;
    }
    if (type === "image_url") {
      const url = mediaSource(item, "image_url");
      if (!role || role === "first_frame") {
        if (media.firstFrame) throw new Error("content accepts at most one first_frame image");
        media.firstFrame = url;
      } else if (role === "last_frame") {
        if (media.lastFrame) throw new Error("content accepts at most one last_frame image");
        media.lastFrame = url;
      } else if (role === "reference_image") {
        media.referenceImages.push(url);
      } else {
        throw new Error("unsupported image_url role: " + role);
      }
      continue;
    }
    if (type === "video_url") {
      if (role && role !== "reference_video") throw new Error("unsupported video_url role: " + role);
      media.referenceVideos.push(mediaSource(item, "video_url"));
      continue;
    }
    if (type === "audio_url") {
      if (role && role !== "reference_audio") throw new Error("unsupported audio_url role: " + role);
      media.referenceAudios.push(mediaSource(item, "audio_url"));
      continue;
    }
    throw new Error("unsupported content type: " + type);
  }
  if (!texts.length) throw new Error("content requires a non-empty text item");
  const refs = media.referenceImages.length + media.referenceVideos.length + media.referenceAudios.length;
  const frames = (media.firstFrame ? 1 : 0) + (media.lastFrame ? 1 : 0);
  if (refs && frames) throw new Error("frame images and reference media are mutually exclusive");
  if (media.referenceImages.length > MAX_REFERENCE_IMAGES) throw new Error("at most " + MAX_REFERENCE_IMAGES + " reference images");
  if (media.referenceVideos.length > MAX_REFERENCE_VIDEOS) throw new Error("at most " + MAX_REFERENCE_VIDEOS + " reference videos");
  if (media.referenceAudios.length > MAX_REFERENCE_AUDIOS) throw new Error("at most " + MAX_REFERENCE_AUDIOS + " reference audios");
  if (refs > MAX_REFERENCE_FILES) throw new Error("reference files must add up to at most " + MAX_REFERENCE_FILES + " (fal upstream limit)");
  if (media.referenceAudios.length && media.referenceImages.length + media.referenceVideos.length === 0)
    throw new Error("reference audio cannot be the only reference input");
  return { prompt: texts.join("\n"), media: media, refs: refs, frames: frames };
}

function normalizeDuration(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_DURATION;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < MIN_DURATION || seconds > MAX_DURATION) {
    throw new Error(CLIENT_MODEL + " duration must be an integer between " + MIN_DURATION + " and " + MAX_DURATION + " seconds (4s is MiniMax-H3 only, not supported by fal upstream)");
  }
  return seconds;
}

function normalizeResolution(raw) {
  const value = trimmed(raw).toUpperCase();
  if (!value) return DEFAULT_RESOLUTION;
  if (value === "2K") throw new Error("resolution 2K is MiniMax-H3 only; fal MiniMax H3 Max upstream supports " + RESOLUTIONS.join("/"));
  if (value.indexOf("480") >= 0) return "480P";
  if (value.indexOf("768") >= 0) return "768P";
  throw new Error("resolution must be one of " + RESOLUTIONS.join(", "));
}

// ratio 语义按 MiniMax 文档区分场景：
//   t2va 必填且非 adaptive；i2va 恒 adaptive（其他值忽略）；r2va 可选默认 adaptive
function normalizeRatio(raw, endpoint) {
  const ratio = trimmed(raw);
  if (endpoint === "minimax/h3-max/text-to-video") {
    if (!ratio) throw new Error("ratio is required for text-to-video");
    if (ratio === "adaptive") throw new Error("ratio adaptive is not allowed for text-to-video");
    if (CONCRETE_RATIOS.indexOf(ratio) < 0) throw new Error("ratio must be one of " + CONCRETE_RATIOS.join(", "));
    return ratio;
  }
  if (endpoint === "minimax/h3-max/image-to-video") {
    // MiniMax：图生视频 ratio 恒 adaptive，其他值不报错但被忽略；fal i2v 没有 aspect_ratio 字段
    if (ratio && ratio !== "adaptive" && CONCRETE_RATIOS.indexOf(ratio) < 0)
      throw new Error("ratio must be adaptive or one of " + CONCRETE_RATIOS.join(", "));
    return "";
  }
  // reference-to-video
  if (!ratio || ratio === "adaptive") return "adaptive";
  if (CONCRETE_RATIOS.indexOf(ratio) < 0) throw new Error("ratio must be adaptive or one of " + CONCRETE_RATIOS.join(", "));
  return ratio;
}

function chooseEndpoint(parsedContent) {
  if (parsedContent.refs > 0) return "minimax/h3-max/reference-to-video";
  if (parsedContent.frames > 0) return "minimax/h3-max/image-to-video";
  return "minimax/h3-max/text-to-video";
}

// ---------------------------------------------------------------------------
// 唯一 encoder：内部规范模型 -> fal input schema（白名单，客户端字段不外泄）
// ---------------------------------------------------------------------------

function encodeFalRequest(normalized) {
  const endpoint = normalized.endpoint;
  const media = normalized.media;
  const body = { prompt: normalized.prompt, duration: normalized.duration, resolution: normalized.resolution };
  if (endpoint === "minimax/h3-max/text-to-video") {
    body.aspect_ratio = normalized.ratio;
  }
  if (endpoint === "minimax/h3-max/image-to-video") {
    // MiniMax 允许「仅尾帧」；fal 只有 image_url（首帧）+ end_image_url（尾帧）。
    // 仅尾帧无法在 fal 上游表达，normalizeForEndpoint 已提前拒绝。
    if (media.firstFrame) body.image_url = media.firstFrame;
    if (media.lastFrame) body.end_image_url = media.lastFrame;
  }
  if (endpoint === "minimax/h3-max/reference-to-video") {
    if (normalized.ratio) body.aspect_ratio = normalized.ratio;
    if (media.referenceImages.length) body.reference_image_urls = media.referenceImages;
    if (media.referenceVideos.length) body.reference_video_urls = media.referenceVideos;
    if (media.referenceAudios.length) body.reference_audio_urls = media.referenceAudios;
  }
  return body;
}

// ---------------------------------------------------------------------------
// 原生异构 decode：MiniMax /v2 请求 -> 内部规范模型
// ---------------------------------------------------------------------------

function decodeCreateVideo(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const req = ctx.body.value;
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  const model = trimmed(req.model);
  if (model !== CLIENT_MODEL) {
    throw new Error("model must be " + CLIENT_MODEL + (model === "MiniMax-H3" ? " (MiniMax-H3 is not served by the fal upstream)" : ""));
  }
  // 语义缺口显式拒绝，不静默丢弃
  if (trimmed(req.callback_url)) throw new Error("callback_url is not supported by the fal upstream bridge");
  if (req.aigc_watermark === true) throw new Error("aigc_watermark is not supported by the fal upstream bridge");

  const parsedContent = normalizeContent(req.content);
  const endpoint = chooseEndpoint(parsedContent);
  // fal i2v 尾帧只能配合首帧（end_image_url 服务于首尾帧关键帧生成）；仅尾帧无法表达
  if (endpoint === "minimax/h3-max/image-to-video" && parsedContent.media.lastFrame && !parsedContent.media.firstFrame) {
    throw new Error("last_frame-only generation is not supported by the fal upstream (provide a first_frame image as well)");
  }
  const normalized = {
    endpoint: endpoint,
    prompt: parsedContent.prompt,
    media: parsedContent.media,
    duration: normalizeDuration(req.duration),
    resolution: normalizeResolution(req.resolution),
    ratio: normalizeRatio(req.ratio, endpoint),
  };
  return {
    kind: "submit",
    model: CLIENT_MODEL,
    action: ENDPOINTS[endpoint].action,
    requestBody: adapterRequest(endpoint, normalized),
  };
}

// ---------------------------------------------------------------------------
// driver hooks：与 fal 上游对话（同 fal-minimax-h3-max 已验证契约）
// ---------------------------------------------------------------------------

function queueBase(ctx) {
  return String(ctx.baseUrl || "https://queue.fal.run").replace(/\/+$/, "");
}

export function buildSubmitRequest(ctx) {
  const request = requireAdapterRequest(ctx);
  // ctx.upstreamModel 若被渠道映射为具体 fal endpoint id，则以其为准
  const mapped = trimmed(ctx.upstreamModel);
  const endpoint = isEndpoint(mapped) ? mapped : request.endpoint;
  const normalized = Object.assign({}, request.payload, { endpoint: endpoint });
  return {
    url: queueBase(ctx) + "/" + endpoint,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Key " + ctx.apiKey },
    body: encodeFalRequest(normalized),
    action: ENDPOINTS[endpoint].action,
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = resp.body || {};
  const detail = falDetail(body);
  if (detail.message && !trimmed(body.request_id)) throw new Error(detail.message);
  const requestId = trimmed(body.request_id);
  if (!requestId) throw new Error("missing request_id in fal submit response");
  return { taskId: requestId, taskData: body };
}

export function buildQueryRequest(ctx) {
  // fal 对子路径端点的 requests URL 只保留 {owner}/{app}，不含 route 段；路径固定，无需模型字段
  return {
    url: queueBase(ctx) + "/" + QUEUE_APP + "/requests/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Key " + ctx.apiKey },
  };
}

// ---------------------------------------------------------------------------
// fal 状态判定（response 端点：HTTP 状态 + FalErrorResponse.detail 分派）
// ---------------------------------------------------------------------------

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
  if (trimmed(b.error)) return { type: trimmed(b.error_type), message: trimmed(b.error) };
  return { type: "", message: "" };
}

function resultVideoURL(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const video = b.video && typeof b.video === "object" && !Array.isArray(b.video) ? b.video : {};
  const url = trimmed(video.url);
  if (/^https?:\/\//.test(url) || /^data:/.test(url)) return url;
  return "";
}

function normalizeStatus(value) {
  return trimmed(value).toLowerCase().replace(/[\s\-.]+/g, "_");
}

const STATUS_MAP = { in_queue: "QUEUED", in_progress: "IN_PROGRESS" };

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

  // 层 4（前置为主判据）：200 + video.url 且无失败信号
  const url = resultVideoURL(body);
  if (url && !detail.message) return { status: "SUCCESS", progress: "100%", url: url };

  // status 端点形态防御
  const raw = normalizeStatus(body && body.status);
  if (raw === "completed") {
    if (detail.message) return { status: "FAILURE", progress: "100%", reason: detail.message };
    return { status: "IN_PROGRESS", progress: "90%" };
  }
  if (STATUS_MAP[raw]) return { status: STATUS_MAP[raw], progress: STATUS_MAP[raw] === "IN_PROGRESS" ? "50%" : "0%" };

  // 层 3：前缀模糊兜底（仅前缀，禁子串）
  for (const state of ["FAILURE", "IN_PROGRESS", "QUEUED"]) {
    for (const prefix of PREFIX[state]) {
      if (raw.indexOf(prefix) === 0) {
        if (state === "FAILURE") return { status: "FAILURE", progress: "100%", reason: detail.message || "upstream task failed" };
        return { status: state, progress: state === "IN_PROGRESS" ? "50%" : "0%" };
      }
    }
  }

  // 层 5：HTTP 4xx + 失败信号
  if (httpCode >= 400 && detail.message) return { status: "FAILURE", progress: "100%", reason: detail.message };

  // 层 6：安全默认
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
  // 408/429/5xx：抛错让宿主重试，不落终态
  if (httpCode === 408 || httpCode === 429 || httpCode >= 500) {
    throw new Error(detail.message || "fal upstream error (http " + httpCode + ")");
  }
  return Object.assign({ code: 0 }, statusResult(parsed, httpCode));
}

// ---------------------------------------------------------------------------
// 用量：提交时按规范模型预估；fal 结果不回报用量
// ---------------------------------------------------------------------------

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const payload = requireAdapterRequest(ctx).payload || {};
  return {
    seconds: payload.duration !== undefined ? payload.duration : DEFAULT_DURATION,
    resolution: payload.resolution || DEFAULT_RESOLUTION,
  };
}

// ---------------------------------------------------------------------------
// Artifact：fal 成功结果 body.video.url（公共 CDN，credentialless 回源）
// ---------------------------------------------------------------------------

function artifactData(source) {
  const data = (source && source.data) || {};
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
  return { url: video.url, method: ctx.clientRequest.method, credentialless: true };
}

// ---------------------------------------------------------------------------
// 原生 renderer：把宿主任务状态还原成 MiniMax /v2 官方响应形状
// ---------------------------------------------------------------------------

// 宿主内部状态 -> MiniMax /v2 status 枚举（queued/running/succeeded/failed/cancelled）
const MINIMAX_STATUS = {
  NOT_START: "queued",
  SUBMITTED: "queued",
  QUEUED: "queued",
  IN_PROGRESS: "running",
  SUCCESS: "succeeded",
  FAILURE: "failed",
};

function epochSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // 宿主时间戳可能是毫秒，MiniMax 用秒
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

export const native = {
  createVideo: decodeCreateVideo,

  // MiniMax /v2 创建响应：{ task_id }
  createdVideo(_ctx, task) {
    return { task_id: task.task_id };
  },

  // MiniMax /v2 查询响应：{ task: { id, model, status, content: { url }, ... } }
  queryVideo(_ctx, task) {
    const data = artifactData(task);
    const out = {
      id: task.task_id,
      model: task.properties && task.properties.origin_model_name ? task.properties.origin_model_name : CLIENT_MODEL,
      status: MINIMAX_STATUS[task.status] || "queued",
      task_type: "generation",
      modality: "video",
    };
    const created = epochSeconds(task.created_at);
    const updated = epochSeconds(task.updated_at);
    if (created !== undefined) out.created_at = created;
    if (updated !== undefined) out.updated_at = updated;
    if (task.status === "SUCCESS") {
      const video = artifactVideo(task);
      const url = video ? video.url : trimmed(task.url);
      if (url) out.content = { url: url };
      // fal 不回报用量，按提交口径无法在查询期取回；仅回传 fal 附带的 seed 供复现
      if (data.seed !== undefined) out.seed = data.seed;
    }
    if (task.status === "FAILURE") {
      out.error = { message: task.fail_reason || "task failed" };
    }
    return { task: out };
  },
};
