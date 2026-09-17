export const meta = {
  apiVersion: 1,
  key: "senseaudio-video",
  name: "SenseAudio Video",
  icon: "Video.Color",
  description: {
    en: "SenseAudio Seedance video generation, exposed in Volcengine Ark native format (text-to-video, first/last frame, reference assets)",
    zh: "SenseAudio Seedance 视频生成，对外提供火山方舟 Seedance 原生格式（文生视频、首尾帧、参考素材）",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10010],
  models: ["doubao-seedance-2-0-260128"],
  fetchMode: "per_task",
  usageSchema: {
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Requested video duration in seconds (SenseAudio allows 4 to 15).",
        zh: "请求的视频时长，单位为秒（SenseAudio 允许 4 到 15）。",
      },
    },
    resolution: {
      enum: ["480p", "720p", "1080p"],
      description: {
        en: "Requested output video resolution.",
        zh: "请求的输出视频分辨率。",
      },
    },
  },
  // usageSchema 只放提交期即可确定的计费维度，示例事实集与之逐键对齐（宿主会硬校验覆盖）。
  // 上游按积分计费，积分要任务完成后才返回，是连续值，不进 schema，随任务原始数据持久化供对账。
  usageExamples: [
    { label: "4s 480p", facts: { duration: 4, resolution: "480p" } },
    { label: "10s 720p", facts: { duration: 10, resolution: "720p" } },
    { label: "15s 1080p", facts: { duration: 15, resolution: "1080p" } },
  ],
  routes: [
    {
      method: "POST",
      path: "/senseaudio/api/v3/contents/generations/tasks",
      type: "submit",
      decode: "createTask",
      render: "taskCreated",
    },
    {
      method: "GET",
      path: "/senseaudio/api/v3/contents/generations/tasks/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "taskStatus",
    },
  ],
};

// ---------------------------------------------------------------------------
// 契约方向
//
//   入站（客户端侧）= 火山方舟 Seedance 原生格式
//     POST /senseaudio/api/v3/contents/generations/tasks
//     GET  /senseaudio/api/v3/contents/generations/tasks/:task_id
//
//   上游（厂商侧）= SenseAudio 开放平台视频生成
//     POST https://api.senseaudio.cn/v1/video/create   鉴权 Bearer <API_KEY>
//     GET  https://api.senseaudio.cn/v1/video/status?id=<task_id>
//
//   两端字段、层级、媒体表达与缺省语义都不同，属于异构适配：先解码为内部规范模型，
//   再由唯一 encoder 按上游 schema 白名单重建请求体。
//
// 上游契约（docs.senseaudio.cn，create/status 两页）
//
//   create 请求体：model / content[] / duration / resolution / ratio /
//                  timeout? / watermark? / provider_specific?
//   content 元素：{type:"text", text} | {type:"image", url, role} |
//                 {type:"audio", audio_url} | {type:"video", video_url}
//   create 响应：{task_id}
//   status 响应：{id, model, task_id, status, progress, video_url, duration,
//                 is_new, error_message, created_at, completed_at, prompt,
//                 resolution, ratio, content[], provider_specific}
//   status 枚举：pending / processing / completed / failed
//   错误信封（已实测，HTTP + {code, message, ref_code?, ref_scope?}）：
//     401 {"code":"authentication_error","message":"incorrect API key provided"}
//     400 {"code":"图片链接无效","message":"图片链接无效","ref_code":400000}
//     404 {"code":"notfound","message":"未找到资源","ref_code":404000,"ref_scope":"common"}
//   code 是字符串 slug（有时直接就是中文提示），ref_code 才是数字码；成功体不带 code。
//   见 upstreamError()。
//
// 实测补充（2026-09-16）
//   * 提交响应确实只有 {task_id}；查询响应字段与文档一致，`duration` 回显请求时长。
//   * `pending` 状态下 `progress` 就已经是 50，所以 QUEUED 也会带 50%——照实透出，
//     不按状态反推覆盖上游自己的数字。
//   * 上游在 create 阶段就校验素材可达性（example.com 占位图直接 400 图片链接无效），
//     插件无法预取素材，只能让上游明确拒绝。
//
// 两端差异（逐项判定，不靠 native 名称猜同构）
//
//   | 语义      | 火山原生                              | SenseAudio                    |
//   | --------- | ------------------------------------- | ----------------------------- |
//   | 图片      | {type:"image_url", image_url:{url}}   | {type:"image", url}           |
//   | 视频      | {type:"video_url", video_url:{url}}   | {type:"video", video_url}     |
//   | 音频      | {type:"audio_url", audio_url:{url}}   | {type:"audio", audio_url}     |
//   | 文本      | {type:"text", text}（可多条）          | 最多 1 条，多条按换行合并       |
//   | role      | image_url 的 role                     | 同名字段，取值相同             |
//   | ratio     | adaptive / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 | 仅 16:9 / 4:3 / 1:1 / 3:4 / 9:16 |
//   | resolution| 480p / 720p / 1080p / 4k              | 480p / 720p / 1080p           |
//   | duration  | 秒，模型相关                           | 4~15 整数，必填               |
//   | watermark | 缺省不加                               | 缺省**加**水印                |
//   | 音频开关   | 无对应字段                             | provider_specific.generate_audio |
//   | 提交响应   | {id}                                  | {task_id}                     |
//   | 查询结果   | content.video_url                     | 顶层 video_url                |
//   | 查询状态   | queued/running/succeeded/failed       | pending/processing/completed/failed |
//   | 草稿任务   | content[].type = "draft_task"         | 不支持                        |
//
// 有意保留的偏差（不静默夹紧）
//
//   1. ratio 缺失或 adaptive：上游文档标为必填，插件无法从首帧图推断比例，
//      故显式报错而不是默认成 16:9——静默选比例会产出错误画幅。
//   2. resolution=4k：官方枚举没有 4k，插件照传让上游明确拒绝，不静默降到 1080p。
//   3. watermark 缺省：客户端不写时显式补 false，保持火山侧「不加」的可观察行为。
//   4. provider_specific 是上游声明的厂商扩展袋，按原样转发（未识别键上游会忽略），
//      另外额外接受顶层 generate_audio 并归并进去。
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://api.senseaudio.cn";
const CREATE_PATH = "/v1/video/create";
const STATUS_PATH = "/v1/video/status";

const ASPECT_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16"];
const RESOLUTIONS = ["480p", "720p", "1080p"];
const IMAGE_ROLES = ["first_frame", "last_frame", "reference"];
const DEFAULT_ROLE_WITHOUT_REFERENCE = ["first_frame", "last_frame"];

const MIN_DURATION = 4;
const MAX_DURATION = 15;
const DEFAULT_DURATION = 5;
const DEFAULT_RESOLUTION = "720p";

const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_AUDIOS = 3;
const MAX_REFERENCE_VIDEOS = 3;

const TIMEOUT_MIN = 3600;
const TIMEOUT_MAX = 172800;

const RETRYABLE_HTTP = [408, 429];

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

function isDataUrl(value) {
  return /^data:/i.test(trimmed(value));
}

function normalizeStatusValue(value) {
  return trimmed(value).toLowerCase().replace(/[\s\-.]+/g, "_");
}

function startsWithAny(value, prefixes) {
  for (let i = 0; i < prefixes.length; i += 1) {
    if (value.indexOf(prefixes[i]) === 0) return true;
  }
  return false;
}

function upstreamBase(ctx) {
  return String((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function parseJSONBody(body) {
  if (isObject(body)) return body;
  if (typeof body !== "string") return {};
  try {
    return JSON.parse(body);
  } catch (_error) {
    return { message: body };
  }
}

function optionalBool(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  const raw = trimmed(value).toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(name + " must be a boolean");
}

// ---------------------------------------------------------------------------
// 适配信封（宿主 canonical intent 约定）
// ---------------------------------------------------------------------------

function adapterRequest(mode, payload) {
  if (mode !== "isomorphic" && mode !== "heterogeneous") {
    throw new Error("invalid adapter mode");
  }
  return { adapterMode: mode, payload: payload };
}

function requireAdapterRequest(ctx) {
  const value = ctx && ctx.requestBody;
  if (!value || (value.adapterMode !== "isomorphic" && value.adapterMode !== "heterogeneous")) {
    throw new Error("missing or invalid adapter mode");
  }
  return value;
}

// ---------------------------------------------------------------------------
// 入站解码：火山原生 body -> 内部规范模型
// ---------------------------------------------------------------------------

// 上游信封错误。官方只给了 HTTP + ref_code 表，没给响应体示例，
// 所以按形状逐个探测并保持宽容，绝不把成功体误判成错误。
const OK_CODES = ["", "0", "200", "ok", "success"];

function upstreamError(body) {
  if (!isObject(body)) return "";
  const err = body.error;
  if (typeof err === "string") return trimmed(err);
  if (isObject(err)) {
    const message = trimmed(err.message) || trimmed(err.msg);
    if (message) return message;
    if (trimmed(err.code)) return "senseaudio error: " + trimmed(err.code);
  }
  const code = trimmed(body.code).toLowerCase();
  if (code && OK_CODES.indexOf(code) < 0) {
    return trimmed(body.message) || trimmed(body.msg) || "senseaudio error code " + code;
  }
  if (trimmed(body.ref_code)) {
    return trimmed(body.message) || trimmed(body.msg) || "senseaudio error " + trimmed(body.ref_code);
  }
  return "";
}

// 图片/视频/音频在两端用不同的嵌套表达：
//   火山原生  {type:"image_url", image_url:{url:"..."}}
//   SenseAudio {type:"image", url:"..."}
// 同名字段既可能是对象也可能是字符串，两种都接受。
function contentUrl(item, nestedKey, flatKey) {
  const nested = item[nestedKey];
  if (typeof nested === "string") return trimmed(nested);
  if (isObject(nested)) return trimmed(nested.url);
  return trimmed(item[flatKey]);
}

function normalizeContent(content) {
  const texts = [];
  const images = [];
  const audios = [];
  const videos = [];

  for (let i = 0; i < content.length; i += 1) {
    const raw = content[i];
    if (!isObject(raw)) throw new Error("content items must be objects");
    const type = trimmed(raw.type).toLowerCase();

    if (type === "draft_task") {
      throw new Error("draft_task content is not supported by SenseAudio");
    }

    if (type === "text") {
      const text = trimmed(raw.text);
      if (text) texts.push(text);
      continue;
    }

    if (type === "image_url" || type === "image") {
      const url = contentUrl(raw, "image_url", "url");
      if (!isHttpUrl(url) && !isDataUrl(url)) {
        throw new Error("image content requires an http(s) or data url");
      }
      const role = trimmed(raw.role).toLowerCase();
      if (role && IMAGE_ROLES.indexOf(role) < 0) {
        throw new Error("unsupported image role: " + role);
      }
      images.push({ url: url, role: role });
      continue;
    }

    if (type === "video_url" || type === "video") {
      const url = contentUrl(raw, "video_url", "video_url");
      if (!isHttpUrl(url)) throw new Error("video content requires an http(s) url");
      videos.push(url);
      continue;
    }

    if (type === "audio_url" || type === "audio") {
      const url = contentUrl(raw, "audio_url", "audio_url");
      if (!isHttpUrl(url)) throw new Error("audio content requires an http(s) url");
      audios.push(url);
      continue;
    }

    throw new Error("unsupported content type: " + trimmed(raw.type));
  }

  return { texts: texts, images: images, audios: audios, videos: videos };
}

function resolveImageRoles(parsed) {
  const hasReferenceRole = parsed.images.some(function (item) {
    return item.role === "reference";
  });
  let bareSeen = 0;
  return parsed.images.map(function (item) {
    if (item.role) return item;
    if (hasReferenceRole) return { url: item.url, role: "reference" };
    // 火山原生里裸 image_url 表示首帧。SenseAudio 的 role 是可选字段，
    // 缺省语义文档没写，所以显式补全，不依赖上游缺省值。
    if (bareSeen < DEFAULT_ROLE_WITHOUT_REFERENCE.length) {
      const role = DEFAULT_ROLE_WITHOUT_REFERENCE[bareSeen];
      bareSeen += 1;
      return { url: item.url, role: role };
    }
    throw new Error("image content without role must declare it explicitly when more than two images are given");
  });
}

function validateComposition(images, audios, videos) {
  const hasFrame = images.some(function (item) {
    return item.role === "first_frame" || item.role === "last_frame";
  });
  const referenceImages = images.filter(function (item) {
    return item.role === "reference";
  }).length;
  const hasReferenceAsset = referenceImages > 0 || audios.length > 0 || videos.length > 0;

  if (hasFrame && hasReferenceAsset) {
    throw new Error(
      'first/last frame content cannot be mixed with reference assets; mark reference images with role "reference"',
    );
  }
  if (audios.length > 0 && images.length === 0 && videos.length === 0) {
    throw new Error("audio content requires at least one image or video");
  }
  if (referenceImages > MAX_REFERENCE_IMAGES) {
    throw new Error("at most " + MAX_REFERENCE_IMAGES + " reference images are supported");
  }
  if (audios.length > MAX_REFERENCE_AUDIOS) {
    throw new Error("at most " + MAX_REFERENCE_AUDIOS + " audio references are supported");
  }
  if (videos.length > MAX_REFERENCE_VIDEOS) {
    throw new Error("at most " + MAX_REFERENCE_VIDEOS + " video references are supported");
  }
}

function readDuration(value) {
  if (value === undefined || value === null || trimmed(value) === "") return DEFAULT_DURATION;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MIN_DURATION || seconds > MAX_DURATION) {
    throw new Error("duration must be an integer between " + MIN_DURATION + " and " + MAX_DURATION);
  }
  return seconds;
}

function readResolution(value) {
  const raw = trimmed(value).toLowerCase();
  if (!raw) return DEFAULT_RESOLUTION;
  if (RESOLUTIONS.indexOf(raw) < 0) {
    throw new Error("unsupported resolution: " + raw + " (supported: " + RESOLUTIONS.join(", ") + ")");
  }
  return raw;
}

function readRatio(value) {
  const raw = trimmed(value).toLowerCase();
  if (!raw) {
    throw new Error(
      "ratio is required: SenseAudio cannot infer the aspect ratio, pass one of " + ASPECT_RATIOS.join(", "),
    );
  }
  if (raw === "adaptive") {
    throw new Error(
      'SenseAudio does not support ratio "adaptive", pass one of ' + ASPECT_RATIOS.join(", "),
    );
  }
  if (ASPECT_RATIOS.indexOf(raw) < 0) {
    throw new Error("unsupported ratio: " + raw + " (supported: " + ASPECT_RATIOS.join(", ") + ")");
  }
  return raw;
}

function readTimeout(value) {
  if (value === undefined || value === null || trimmed(value) === "") return undefined;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < TIMEOUT_MIN || seconds > TIMEOUT_MAX) {
    throw new Error("timeout must be an integer between " + TIMEOUT_MIN + " and " + TIMEOUT_MAX);
  }
  return seconds;
}

// provider_specific 是上游自己声明的厂商扩展袋，原样转发；
// 另外额外接受顶层 generate_audio（火山侧习惯的写法）并归并进去。
function readProviderSpecific(input) {
  const vendor = isObject(input.provider_specific) ? input.provider_specific : null;
  const topLevel = optionalBool(input.generate_audio, "generate_audio");
  if (!vendor) {
    if (topLevel === undefined) return undefined;
    return { generate_audio: topLevel };
  }
  const merged = Object.assign({}, vendor);
  if (merged.generate_audio !== undefined) {
    merged.generate_audio = optionalBool(merged.generate_audio, "provider_specific.generate_audio");
  } else if (topLevel !== undefined) {
    merged.generate_audio = topLevel;
  }
  return merged;
}

function actionOf(payload) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const audios = Array.isArray(payload.audios) ? payload.audios : [];
  const videos = Array.isArray(payload.videos) ? payload.videos : [];
  const hasReference =
    audios.length > 0 ||
    videos.length > 0 ||
    images.some(function (item) {
      return item.role === "reference";
    });
  if (hasReference) return "reference_to_video";
  if (images.length > 1) return "first_tail_to_video";
  if (images.length === 1) return "image_to_video";
  return "text_to_video";
}

export const native = {
  createTask(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const input = ctx.body.value;
    if (!isObject(input)) throw new Error("request body must be an object");

    const model = trimmed(input.model) || trimmed(ctx.model);
    if (!model) throw new Error("model is required");

    if (!Array.isArray(input.content)) throw new Error("content must be an array");
    if (input.content.length === 0) throw new Error("content is required");

    const parsed = normalizeContent(input.content);
    const images = resolveImageRoles(parsed);
    validateComposition(images, parsed.audios, parsed.videos);
    if (images.length === 0 && parsed.audios.length === 0 && parsed.videos.length === 0 && parsed.texts.length === 0) {
      throw new Error("content is required");
    }

    const payload = {
      model: model,
      // SenseAudio 只接受 1 条 text，多条按换行合并，语义等价。
      prompt: parsed.texts.join("\n"),
      images: images,
      audios: parsed.audios,
      videos: parsed.videos,
      duration: readDuration(input.duration),
      resolution: readResolution(input.resolution),
      ratio: readRatio(input.ratio),
      // 火山缺省「不加」，SenseAudio 缺省「加」，客户端没写时显式补 false。
      watermark: optionalBool(input.watermark, "watermark") === true,
    };

    const timeout = readTimeout(input.timeout);
    if (timeout !== undefined) payload.timeout = timeout;
    const providerSpecific = readProviderSpecific(input);
    if (providerSpecific !== undefined) payload.provider_specific = providerSpecific;

    return {
      kind: "submit",
      model: model,
      action: actionOf(payload),
      requestBody: adapterRequest("heterogeneous", payload),
    };
  },

  taskCreated(_ctx, task) {
    // 火山原生提交响应只有 {id}，且必须是网关公开 ID（客户端拿它来查询）。
    return { id: trimmed(task && task.task_id) };
  },

  taskStatus(_ctx, task) {
    const data = isObject(task && task.data) ? task.data : {};
    const state = trimmed(task && task.status).toUpperCase();
    const output = {
      id: trimmed(task && task.task_id),
      model: trimmed(data.model),
      status: ARK_STATUS[state] || "queued",
      content: {},
    };
    if (isHttpUrl(data.video_url)) output.content.video_url = trimmed(data.video_url);
    if (trimmed(data.resolution)) output.content.resolution = trimmed(data.resolution);
    if (trimmed(data.ratio)) output.ratio = trimmed(data.ratio);
    const duration = Number(data.duration);
    if (Number.isFinite(duration) && duration > 0) output.duration = duration;
    const progress = Number(data.progress);
    if (Number.isFinite(progress) && progress >= 0 && progress <= 100) output.progress = Math.round(progress);
    if (Number.isFinite(Number(data.created_at))) output.created_at = Number(data.created_at);
    if (Number.isFinite(Number(data.completed_at))) output.completed_at = Number(data.completed_at);
    if (state === "FAILURE") output.error = { message: failureReason(data) };
    return output;
  },

  error(_ctx, error) {
    return { error: { code: error && error.code, message: error && error.message } };
  },
};

// ---------------------------------------------------------------------------
// 上游请求构建
// ---------------------------------------------------------------------------

export function buildSubmitRequest(ctx) {
  const request = requireAdapterRequest(ctx);
  const payload = isObject(request.payload) ? request.payload : {};

  // 按上游 schema 白名单重建，绝不透传入站对象。
  const content = [];
  if (trimmed(payload.prompt)) content.push({ type: "text", text: trimmed(payload.prompt) });
  (Array.isArray(payload.images) ? payload.images : []).forEach(function (item) {
    content.push({ type: "image", url: item.url, role: item.role });
  });
  (Array.isArray(payload.audios) ? payload.audios : []).forEach(function (url) {
    content.push({ type: "audio", audio_url: url });
  });
  (Array.isArray(payload.videos) ? payload.videos : []).forEach(function (url) {
    content.push({ type: "video", video_url: url });
  });

  const body = {
    model: trimmed(ctx.upstreamModel) || trimmed(payload.model) || trimmed(ctx.model),
    content: content,
    duration: payload.duration,
    resolution: payload.resolution,
    ratio: payload.ratio,
    watermark: payload.watermark,
  };
  if (payload.timeout !== undefined) body.timeout = payload.timeout;
  if (isObject(payload.provider_specific)) body.provider_specific = payload.provider_specific;

  return {
    url: upstreamBase(ctx) + CREATE_PATH,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
    body: body,
    action: actionOf(payload),
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = parseJSONBody(resp && resp.body);
  const message = upstreamError(body);
  if (message) throw new Error(message);
  const taskId = trimmed(body.task_id) || trimmed(body.id);
  if (!taskId) throw new Error("missing task id in submit response");
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: upstreamBase(ctx) + STATUS_PATH + "?id=" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
  };
}

// ---------------------------------------------------------------------------
// 状态映射六层阶梯
// ---------------------------------------------------------------------------

const STATUS_TABLE = {
  QUEUED: ["pending", "queued", "not_start", "not_started", "waiting", "submitted", "created"],
  IN_PROGRESS: [
    "processing",
    "in_progress",
    "running",
    "generating",
    "rendering",
    "preparing",
    "queueing",
  ],
  SUCCESS: ["completed", "complete", "succeeded", "succeed", "success", "done", "finished"],
  FAILURE: ["failed", "fail", "failure", "error", "cancelled", "canceled", "expired", "timeout", "rejected"],
};

const STATUS_MAP = Object.keys(STATUS_TABLE).reduce(function (acc, state) {
  STATUS_TABLE[state].forEach(function (value) {
    acc[value] = state;
  });
  return acc;
}, {});

const PREFIX = {
  SUCCESS: ["success", "succ", "ok", "okay", "comp"],
  FAILURE: ["erro", "fail", "cancel", "expire", "timeout", "reject", "abort"],
  IN_PROGRESS: ["run", "process", "progress", "generat", "render"],
  QUEUED: ["queue", "pend", "submit", "wait", "not_start"],
};

const ARK_STATUS = {
  QUEUED: "queued",
  IN_PROGRESS: "running",
  SUCCESS: "succeeded",
  FAILURE: "failed",
};

function resultURL(body) {
  const t = isObject(body) ? body : {};
  const output = isObject(t.output) ? t.output : {};
  const data = isObject(t.data) ? t.data : {};
  const candidates = [
    t.video_url,
    t.url,
    t.result_url,
    t.output_url,
    output.video_url,
    output.url,
    data.video_url,
    data.url,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    if (isHttpUrl(candidates[i])) return trimmed(candidates[i]);
  }
  return "";
}

function hasFailureSignal(body) {
  const t = isObject(body) ? body : {};
  const err = isObject(t.error) ? t.error : {};
  return !!(
    trimmed(t.fail_reason) ||
    trimmed(t.err_msg) ||
    trimmed(t.error_message) ||
    trimmed(err.message) ||
    trimmed(err.msg)
  );
}

function failureReason(body) {
  const t = isObject(body) ? body : {};
  const err = isObject(t.error) ? t.error : {};
  return (
    trimmed(t.error_message) ||
    trimmed(t.fail_reason) ||
    trimmed(t.err_msg) ||
    trimmed(err.message) ||
    trimmed(err.msg) ||
    "senseaudio video task failed"
  );
}

function progressOf(body, state) {
  if (state === "SUCCESS" || state === "FAILURE") return "100%";
  const value = Number(isObject(body) ? body.progress : NaN);
  if (Number.isFinite(value) && value >= 0 && value <= 100) return Math.round(value) + "%";
  return state === "IN_PROGRESS" ? "50%" : "0%";
}

function statusResult(body) {
  const raw = normalizeStatusValue(body.status || body.task_status || body.state);
  const declared = STATUS_MAP[raw];

  if (declared === "SUCCESS") {
    return { status: "SUCCESS", progress: progressOf(body, "SUCCESS"), url: resultURL(body) };
  }
  if (declared === "FAILURE") {
    return { status: "FAILURE", progress: "100%", reason: failureReason(body) };
  }
  if (declared) return { status: declared, progress: progressOf(body, declared) };

  if (startsWithAny(raw, PREFIX.SUCCESS)) {
    return { status: "SUCCESS", progress: progressOf(body, "SUCCESS"), url: resultURL(body) };
  }
  if (startsWithAny(raw, PREFIX.FAILURE)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(body) };
  }
  if (startsWithAny(raw, PREFIX.IN_PROGRESS)) {
    return { status: "IN_PROGRESS", progress: progressOf(body, "IN_PROGRESS") };
  }
  if (startsWithAny(raw, PREFIX.QUEUED)) {
    return { status: "QUEUED", progress: progressOf(body, "QUEUED") };
  }

  const url = resultURL(body);
  if (url && !hasFailureSignal(body)) {
    return { status: "SUCCESS", progress: "100%", url: url };
  }
  if (hasFailureSignal(body)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(body) };
  }
  return { status: "QUEUED", progress: "0%" };
}

export function parseTaskResult(ctx, body, response) {
  const payload = parseJSONBody(body);
  const message = upstreamError(payload);
  if (message) {
    // 查询请求本身失败（超时/限流/服务端故障）抛错让宿主重试，
    // 不要误判成任务终态失败——那会让用户拿不到应得的退款路径。
    const httpStatus =
      Number((response && response.status) || (ctx && ctx.response && ctx.response.status)) || 0;
    if (RETRYABLE_HTTP.indexOf(httpStatus) >= 0 || httpStatus >= 500) throw new Error(message);
    return { status: "FAILURE", progress: "100%", reason: message };
  }
  return statusResult(payload);
}

// ---------------------------------------------------------------------------
// 制品与用量
// ---------------------------------------------------------------------------

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  const data = isObject(task.data) ? task.data : {};
  if (!resultURL(data)) return [];
  return [{ key: "video", type: "video", mimeType: "video/mp4" }];
}

export function buildContentRequest(ctx) {
  const data = isObject(ctx && ctx.data) ? ctx.data : {};
  const url = isHttpUrl(ctx && ctx.url) ? trimmed(ctx.url) : resultURL(data);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

export function extractUsage(ctx) {
  if (ctx && ctx.usagePurpose === "billing_ratios") return null;
  const request = ctx && ctx.requestBody;
  const payload = isObject(request && request.payload) ? request.payload : {};
  const duration = Number.isInteger(payload.duration) ? payload.duration : DEFAULT_DURATION;
  const resolution = RESOLUTIONS.indexOf(payload.resolution) >= 0 ? payload.resolution : DEFAULT_RESOLUTION;
  return { duration: duration, resolution: resolution };
}

export function extractUsageOnComplete(_task, _taskResult, body) {
  const payload = parseJSONBody(body);
  if (normalizeStatusValue(payload.status) !== "completed") return {};
  const facts = {};
  const duration = Number(payload.duration);
  if (Number.isInteger(duration) && duration > 0) facts.duration = duration;
  const resolution = trimmed(payload.resolution).toLowerCase();
  if (RESOLUTIONS.indexOf(resolution) >= 0) facts.resolution = resolution;
  return facts;
}
