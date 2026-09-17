export const meta = {
  apiVersion: 1,
  key: "aivideomaker",
  name: "AI Video Maker",
  icon: "Video.Color",
  description: {
    en: "aivideomaker.ai video generation. MiniMax H3 over the openai protocols, plus a Volcengine Ark Seedance native entry covering all eight upstream models (t2v, i2v, minimax, t2v_v3, i2v_v3, seedance20, wan27, happyhorse).",
    zh: "aivideomaker.ai 视频生成。MiniMax H3 走 openai 协议；火山方舟 Seedance 原生入口覆盖上游全部八个模型（t2v、i2v、minimax、t2v_v3、i2v_v3、seedance20、wan27、happyhorse）。",
  },
  version: "1.0.1",
  author: { name: "Jushenzhidao" },
  channelTypes: [10009],
  models: [
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
  ],
  fetchMode: "per_task",
  usageSchema: {
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Requested video duration in seconds (the allowed set depends on the upstream model).",
        zh: "请求的视频时长，单位为秒（允许的取值随上游模型而定）。",
      },
    },
    resolution: {
      enum: ["480p", "720p", "1080p", "unspecified"],
      description: {
        en: "Requested output video resolution; \"unspecified\" for the upstream models that have no resolution field (t2v, i2v, t2v_v3, i2v_v3).",
        zh: "请求的输出视频分辨率；上游没有分辨率字段的模型（t2v、i2v、t2v_v3、i2v_v3）记为 \"unspecified\"。",
      },
    },
  },
  // usageSchema 只放提交期即可确定的计费维度，示例事实集与之逐键对齐（宿主硬校验覆盖）。
  // 厂商积分是任务完成后才返回的连续值，不进 schema，仍随任务原始数据持久化供对账。
  // 最后一条必须留着：t2v / i2v / t2v_v3 / i2v_v3 四个模型上游没有分辨率字段，实际就是
  // 产出 "unspecified"。不列出来，用户在倍率表里只会看到 480p/720p/1080p 三行，
  // 这四个模型就永远匹配不到行——配置时看不出这个值是可能的。
  usageExamples: [
    { label: "5s 480p", facts: { duration: 5, resolution: "480p" } },
    { label: "5s 720p", facts: { duration: 5, resolution: "720p" } },
    { label: "10s 1080p", facts: { duration: 10, resolution: "1080p" } },
    {
      label: "5s unspecified (models without a resolution field)",
      facts: { duration: 5, resolution: "unspecified" },
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/aivideomaker/api/v3/contents/generations/tasks",
      type: "submit",
      decode: "createTask",
      render: "taskCreated",
    },
    {
      method: "GET",
      path: "/aivideomaker/api/v3/contents/generations/tasks/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "taskStatus",
    },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

// ---------------------------------------------------------------------------
// 上游契约（aivideomaker.ai，两种凭据形态，按渠道密钥自动判定）
//
//   1. 官方 API：密钥以 "ak_" 开头
//      POST /api/v1/generate/{model}   header: key
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
//
// 1.0.1 新增：火山方舟 Seedance 原生入口（覆盖上游全部 8 个模型）
//
//   入站（客户端侧）= 火山方舟 Seedance 原生格式
//     POST /aivideomaker/api/v3/contents/generations/tasks
//     GET  /aivideomaker/api/v3/contents/generations/tasks/:task_id
//
//   上游（厂商侧）= aivideomaker 官方 API 的 8 个生成端点
//     POST /api/v1/generate/{model}，model ∈ t2v | i2v | minimax | t2v_v3 |
//                                              i2v_v3 | seedance20 | wan27 | happyhorse
//
//   两端字段、层级、媒体表达、枚举与缺省语义都不同，属异构适配：先由入站 decoder
//   归一为内部规范模型，再由按模型分派的唯一 encoder 按上游 schema 白名单重建请求体。
//
// 上游 8 个模型的契约（来源：用户提供的厂商 API 接口文档；站点公开文档
// /docs、llms.txt 与 OpenAPI 1.0.15 目前只覆盖 minimax，其余 7 个模型未公开）
//
//   | model      | 必填                                  | duration            | resolution        | ratio                          | 素材 |
//   | ---------- | ------------------------------------- | ------------------- | ----------------- | ------------------------------ | ---- |
//   | t2v        | prompt, aspectRatio, duration          | "5" / "8"           | 无该字段          | 16:9 / 9:16 / 1:1              | 无   |
//   | i2v        | image, duration                        | "5" / "8"           | 无该字段          | 无该字段                       | 图 1 |
//   | minimax    | content                                | 5~20（默认 5）      | 720p / 1080p      | auto/21:9/16:9/4:3/1:1/3:4/9:16| 首尾帧或参考素材 |
//   | t2v_v3     | prompt, aspectRatio, duration          | "5"/"10"/"15"/"20"  | 无该字段          | 16:9 / 9:16 / 1:1              | 无   |
//   | i2v_v3     | image, duration                        | "5"/"10"/"15"/"20"  | 无该字段          | 无该字段                       | 图 1 |
//   | seedance20 | duration, resolution, ratio            | 4~15（number）      | 480 / 720（数字） | 16:9 / 9:16 / 1:1              | 图/视频/音频各 1 |
//   | wan27      | prompt, duration, resolution, ratio     | "5"/"10"/"15"       | 720P / 1080P      | 16:9/9:16/1:1/4:3/3:4          | 图 1（可选） |
//   | happyhorse | prompt, duration, resolution            | 3~15（number）      | 720P / 1080P      | 16:9/9:16/3:4/4:3/1:1（默认 16:9）| 图 1 或多张（r2v） |
//
//   seedance20 额外约束：prompt / image / video 至少一个，audio 不能单独使用。
//
// 两端差异（逐项判定，不靠 native 名称猜同构）
//
//   | 语义      | 火山原生（入站）                      | aivideomaker（上游）              |
//   | --------- | ------------------------------------- | --------------------------------- |
//   | 文本      | content[].type="text"，可多条          | 单 prompt/content，多条按换行合并  |
//   | 图片      | content[].type="image_url"，带 role    | 单个 image/imageUrl（多数模型无 role）|
//   | 视频      | content[].type="video_url"            | 仅 seedance20 有 video（单个）     |
//   | 音频      | content[].type="audio_url"            | 仅 seedance20 有 audio（单个）     |
//   | ratio     | 缺省 adaptive，枚举含 21:9            | 各模型枚举更窄，且多数为必填        |
//   | resolution| "480p"/"720p"/"1080p"/"4k"            | 表达不一：数字 480/720 或 720P/1080P|
//   | duration  | 秒（模型相关）                         | 多数必填，取值集合或区间随模型而定  |
//   | watermark | 缺省不加水印                           | 8 个端点均无该参数                 |
//   | 提交响应  | {id}                                  | {status, taskId, responseUrl, ...} |
//   | 查询结果  | content.video_url                     | output.url（官方 Task 形状）       |
//   | 查询状态  | queued/running/succeeded/failed       | SUBMITTED/PROGRESS/COMPLETED/FAILED/CANCEL |
//
// 有意保留的偏差（不静默夹紧、不静默丢弃）
//
//   1. 必填字段缺失即报错，并列出该模型允许的取值。火山缺省 duration/ratio 并不等于
//      上游有同样的缺省：静默替客户端选一个时长或画幅会产出错误产物。
//   2. 模型不支持的字段被显式使用时报错（如 t2v 传 resolution、i2v 传 ratio），
//      因为静默忽略会让客户端以为该参数生效了。
//   3. resolution 枚举不做夹紧：seedance20 只收 480/720，客户端传 1080p 就照实报错，
//      而不是偷偷降到 720p（隐性少扣费／画质不符）。
//   4. 上游 8 个端点都没有 watermark 参数：客户端要求 watermark=true 时报错，
//      不写或写 false 时按上游默认出片（不谎称支持该开关）。
//   5. 网页会话凭据（cookie+userId）只覆盖 minimax 端点（tRPC 端点只有 ai.minimaxH3），
//      用网页凭据调其余 7 个模型会显式报错，而不是发一个不存在的上游请求。
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
const IMAGE_ROLES = ["first_frame", "last_frame", "reference"];

const DEFAULT_DURATION = 5;
const MIN_DURATION = 5;
const MAX_DURATION = 20;
const DEFAULT_RESOLUTION = "720p";
// 上游部分模型没有分辨率维度，计费事实里用这个值明确表示「该模型不存在该维度」。
const UNSPECIFIED_RESOLUTION = "unspecified";
// 上游只有 minimax / seedance20 / wan27 / happyhorse 有分辨率字段，这四个没有。
// 用量维度必须按「上游有没有这个字段」判定，不能只看 payload 有没有值：
// openai 入口会替缺失字段补默认值，只看 payload 会把默认 720p 记成上游真实存在的维度，
// 于是同一个 t2v 任务走火山入口记 unspecified、走 openai 入口记 720p，倍率表对不上。
const MODELS_WITHOUT_RESOLUTION = ["t2v", "i2v", "t2v_v3", "i2v_v3"];
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_TIER = "turbo";
const CLIENT_MODEL = "minimax-h3";

// 上游 8 个生成端点，以及客户端可见模型名到上游模型的别名。
const UPSTREAM_MODELS = ["t2v", "i2v", "minimax", "t2v_v3", "i2v_v3", "seedance20", "wan27", "happyhorse"];
const MODEL_ALIASES = {
  "minimax-h3": "minimax",
  // 火山官方 Seedance 模型名，与 senseaudio-video 渠道同名，两条渠道可互为备份。
  "doubao-seedance-2-0-260128": "seedance20",
};

const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_AUDIOS = 2;

// 火山入口按 role 决定素材语义，上游多数模型只有一个图片位。
const DEFAULT_ROLE_WITHOUT_REFERENCE = ["first_frame", "last_frame"];

// 上游图片地址白名单（实测：data URL 会被拒，且被报成误导性的 500）。
const IMAGE_PROTOCOLS = ["http://", "https://", "s3://", "r2://"];

// 火山方舟侧状态取值。
const ARK_STATUS = {
  QUEUED: "queued",
  IN_PROGRESS: "running",
  SUCCESS: "succeeded",
  FAILURE: "failed",
};

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
  if (value === undefined || value === null || trimmed(value) === "") return undefined;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  const raw = trimmed(value).toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(name + " must be a boolean");
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
    throw new Error("missing adapter mode");
  }
  return value;
}

function requirePayload(ctx) {
  const request = requireAdapterRequest(ctx);
  if (!isObject(request.payload)) throw new Error("missing adapter payload");
  return request.payload;
}

// ---------------------------------------------------------------------------
// 内部规范模型
//
//   {
//     model,                       // 客户端模型名（展示/计费身份）
//     prompt,                      // 文本，多条已按换行合并
//     images: [{ url, role }],     // role ∈ first_frame | last_frame | reference
//     videos: [url],               // 上游仅 seedance20 消费
//     audios: [url],               // 上游仅 seedance20 消费
//     duration, resolution,        // 归一后的时长（秒）与分辨率（如 "720p"）
//     aspectRatio,                 // 归一后的画幅，如 "16:9"
//     tier,                        // minimax 专用
//     promptExtend,                // wan27 专用
//     durationGiven, resolutionGiven, aspectRatioGiven,   // 客户端是否显式提供
//     action,
//   }
//
// durationGiven / resolutionGiven / aspectRatioGiven 是必需的：上游多数模型把这些字段
// 标为必填、另一些模型根本没有该字段，插件必须能区分「客户端没写」和「客户端写了默认值」，
// 否则要么把缺省值当成用户意图，要么无法对不支持的字段给出明确报错。
// ---------------------------------------------------------------------------

function upstreamModelOf(ctx, canonical) {
  const raw =
    trimmed(ctx && ctx.upstreamModel) ||
    trimmed(canonical && canonical.model) ||
    trimmed(ctx && ctx.model) ||
    CLIENT_MODEL;
  return MODEL_ALIASES[raw] || raw;
}

function assertSupportedModel(upstream) {
  if (UPSTREAM_MODELS.indexOf(upstream) < 0) {
    throw new Error("unsupported model: " + upstream + " (supported: " + UPSTREAM_MODELS.join(", ") + ")");
  }
  return upstream;
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

// 火山侧的 resolution 可能是 "480p" / "480P" / 480 / "4k"，统一成小写带 p 的写法；
// 合法性不在这里判断，由各模型的 encoder 按自己的枚举校验。
function normalizeArkResolution(value) {
  const raw = trimmed(value).toLowerCase();
  if (!raw) return "";
  if (/^[0-9]+$/.test(raw)) return raw + "p";
  return raw;
}

// 火山侧的 ratio 可能是 "16x9"，统一成 "16:9"；合法性同样交给 encoder。
function normalizeArkRatio(value) {
  const raw = trimmed(value).toLowerCase().replace("*", "x");
  const parts = raw.split("x");
  if (parts.length === 2 && trimmed(parts[0]) && trimmed(parts[1])) {
    return trimmed(parts[0]) + ":" + trimmed(parts[1]);
  }
  return raw;
}

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

/** 入站图片项 -> {url, role}；宿主文件占位符会被内联成 data url，上游不接受，显式拒绝。 */
function imageItem(raw, role) {
  if (typeof raw === "string") return { url: imageUrl(raw), role: role };
  if (!isObject(raw)) throw new Error("image entries must be strings or objects");
  if (trimmed(raw.__fileRef)) {
    throw new Error(
      "file uploads are not supported: upstream only accepts http/https/s3/r2 image urls, " +
        "while the host would inline the uploaded file as a data url",
    );
  }
  const url = trimmed(raw.url) || trimmed(raw.image_url) || trimmed(raw.imageUrl);
  return { url: imageUrl(url), role: role };
}

function imageList(value) {
  const images = [];
  const source = Array.isArray(value) ? value : trimmed(value) ? [value] : [];
  for (const item of source) {
    images.push(imageItem(item, ""));
  }
  return images;
}

/** 按位置补全 role：1 张=首帧，2 张=首帧+尾帧，≥3 张=首帧+参考图（与 1.0.0 的槽位语义一致）。 */
function roleList(urls) {
  const images = [];
  for (let i = 0; i < urls.length; i += 1) {
    let role = "reference";
    if (i === 0) role = "first_frame";
    else if (urls.length === 2 && i === 1) role = "last_frame";
    images.push({ url: urls[i], role: role });
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
  const images = roleList(imageList(rawImages).map(function (item) {
    return item.url;
  }));
  if (!prompt && images.length === 0) throw new Error("prompt or images is required");

  const durationInput = req.duration !== undefined ? req.duration : req.seconds;
  const ratioInput = req.aspectRatio !== undefined ? req.aspectRatio : req.size;
  const canonical = {
    model: model,
    prompt: prompt,
    images: images,
    videos: [],
    audios: [],
    duration: normalizeDuration(durationInput),
    resolution: normalizeResolution(req.resolution),
    aspectRatio: normalizeAspectRatio(ratioInput),
    tier: normalizeTier(req.tier),
    durationGiven: trimmed(durationInput) !== "",
    resolutionGiven: trimmed(req.resolution) !== "",
    aspectRatioGiven: trimmed(ratioInput) !== "",
  };

  const promptExtend = optionalBool(req.promptExtend !== undefined ? req.promptExtend : req.prompt_extend, "promptExtend");
  if (promptExtend !== undefined) canonical.promptExtend = promptExtend;

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
// 各上游模型的请求体 encoder（白名单重建，绝不透传入站对象）
// ---------------------------------------------------------------------------

function ensureNoAssets(canonical, model) {
  if (canonical.images.length > 0 || canonical.videos.length > 0 || canonical.audios.length > 0) {
    throw new Error(model + " does not accept image, video or audio input");
  }
}

function ensureNoVideoAudio(canonical, model) {
  if (canonical.videos.length > 0 || canonical.audios.length > 0) {
    throw new Error(model + " does not accept video or audio input");
  }
}

function ensureNoResolution(canonical, model) {
  if (canonical.resolutionGiven) {
    throw new Error(model + " has no resolution field, remove it instead of relying on a silent fallback");
  }
}

function ensureNoRatio(canonical, model) {
  if (canonical.aspectRatioGiven) {
    throw new Error(model + " has no ratio field, remove it instead of relying on a silent fallback");
  }
}

function requirePrompt(canonical, model) {
  const prompt = trimmed(canonical.prompt);
  if (!prompt) throw new Error(model + " requires a text prompt");
  return prompt;
}

function requireEnumDuration(canonical, model, allowed) {
  if (!canonical.durationGiven) {
    throw new Error(model + " requires duration, one of " + allowed.join(" / ") + " seconds");
  }
  const seconds = Number(canonical.duration);
  if (!Number.isInteger(seconds) || allowed.indexOf(seconds) < 0) {
    throw new Error(model + " supports duration " + allowed.join(" / ") + " seconds, got " + canonical.duration);
  }
  return seconds;
}

function requireRangeDuration(canonical, model, min, max) {
  if (!canonical.durationGiven) {
    throw new Error(model + " requires duration between " + min + " and " + max + " seconds");
  }
  const seconds = Number(canonical.duration);
  if (!Number.isInteger(seconds) || seconds < min || seconds > max) {
    throw new Error(model + " supports duration between " + min + " and " + max + " seconds, got " + canonical.duration);
  }
  return seconds;
}

function requireResolution(canonical, model, allowed) {
  if (!canonical.resolutionGiven) {
    throw new Error(model + " requires resolution, one of " + allowed.join(" / "));
  }
  const value = normalizeArkResolution(canonical.resolution);
  if (allowed.indexOf(value) < 0) {
    throw new Error(model + " supports resolution " + allowed.join(" / ") + ", got " + trimmed(canonical.resolution));
  }
  return value;
}

function requireRatio(canonical, model, allowed) {
  if (!canonical.aspectRatioGiven) {
    throw new Error(model + " requires ratio, one of " + allowed.join(" / "));
  }
  const value = normalizeArkRatio(canonical.aspectRatio);
  if (allowed.indexOf(value) < 0) {
    throw new Error(model + " supports ratio " + allowed.join(" / ") + ", got " + trimmed(canonical.aspectRatio));
  }
  return value;
}

function optionalRatio(canonical, model, allowed, fallback) {
  if (!canonical.aspectRatioGiven) return fallback;
  const value = normalizeArkRatio(canonical.aspectRatio);
  if (allowed.indexOf(value) < 0) {
    throw new Error(model + " supports ratio " + allowed.join(" / ") + ", got " + trimmed(canonical.aspectRatio));
  }
  return value;
}

/** 单图位模型的公共取图逻辑：最多一张，且不接受尾帧语义。 */
function singleImage(canonical, model) {
  const images = canonical.images;
  if (images.length === 0) return null;
  if (images.length > 1) {
    throw new Error(model + " accepts a single image, got " + images.length);
  }
  if (images[0].role === "last_frame") {
    throw new Error(model + " has no last-frame slot, pass the image without a last_frame role");
  }
  return images[0].url;
}

function pickImageUrl(images, role) {
  for (const item of images) {
    if (item.role === role) return item.url;
  }
  return null;
}

function referenceImageUrls(images) {
  const urls = [];
  for (const item of images) {
    if (item.role === "reference") urls.push(item.url);
  }
  // 上游 referenceImageUrls 上限 4；1.0.0 起就按该上限截断，行为保持不变。
  return urls.slice(0, MAX_REFERENCE_IMAGES);
}

/** minimax：content + 首尾帧/参考素材 + aspectRatio/duration/resolution/tier。 */
function encodeMinimaxBody(canonical) {
  const images = canonical.images;
  const hasReference =
    images.some(function (item) {
      return item.role === "reference";
    }) ||
    canonical.videos.length > 0 ||
    canonical.audios.length > 0;
  // 上游声明的互斥指的是「尾帧」不能与参考素材并存。1.0.0 起
  // imageUrl（首帧）+ referenceImageUrls（≥3 张图时的参考位）是合法用法，不能在这里拦掉。
  if (pickImageUrl(images, "last_frame") && hasReference) {
    throw new Error("minimax: lastFrameUrl cannot be combined with reference image, video or audio assets");
  }
  if (canonical.videos.length > 1) {
    throw new Error("minimax accepts a single reference video, got " + canonical.videos.length);
  }
  if (canonical.audios.length > MAX_REFERENCE_AUDIOS) {
    throw new Error("minimax supports at most " + MAX_REFERENCE_AUDIOS + " reference audios, got " + canonical.audios.length);
  }
  const body = {
    content: trimmed(canonical.prompt),
    imageUrl: pickImageUrl(images, "first_frame"),
    lastFrameUrl: pickImageUrl(images, "last_frame"),
    referenceImageUrls: referenceImageUrls(images),
    aspectRatio: canonical.aspectRatioGiven ? canonical.aspectRatio : DEFAULT_ASPECT_RATIO,
    // 火山入口不会替客户端填默认值（见 canonical 的 *Given 约定），这里必须回落到
    // 上游自己的默认值，否则会往上游发一个空字符串。
    duration: canonical.durationGiven ? canonical.duration : DEFAULT_DURATION,
    resolution: canonical.resolutionGiven ? canonical.resolution : DEFAULT_RESOLUTION,
    tier: canonical.tier,
  };
  // 1.0.0 的请求体里没有这两个字段，只在真的带了参考视频/音频时才补，
  // 免得升级后已上线渠道发往上游的请求形状发生变化。
  if (canonical.videos.length) body.referenceVideoUrl = canonical.videos[0];
  if (canonical.audios.length) body.referenceAudioUrls = canonical.audios;
  return body;
}

/** t2v：仅文生视频，duration 只收 "5" / "8"，比例只收 16:9 / 9:16 / 1:1。 */
function encodeT2vBody(canonical) {
  ensureNoAssets(canonical, "t2v");
  ensureNoResolution(canonical, "t2v");
  return {
    prompt: requirePrompt(canonical, "t2v"),
    aspectRatio: requireRatio(canonical, "t2v", ["16:9", "9:16", "1:1"]),
    duration: String(requireEnumDuration(canonical, "t2v", [5, 8])),
  };
}

/** i2v：单图生视频，无 ratio / resolution 字段。 */
function encodeI2vBody(canonical) {
  ensureNoVideoAudio(canonical, "i2v");
  ensureNoResolution(canonical, "i2v");
  ensureNoRatio(canonical, "i2v");
  const image = singleImage(canonical, "i2v");
  if (!image) throw new Error("i2v requires an image");
  const body = {
    image: image,
    duration: String(requireEnumDuration(canonical, "i2v", [5, 8])),
  };
  const prompt = trimmed(canonical.prompt);
  if (prompt) body.prompt = prompt;
  return body;
}

/** t2v_v3：与 t2v 同形，但时长集合更宽。 */
function encodeT2vV3Body(canonical) {
  ensureNoAssets(canonical, "t2v_v3");
  ensureNoResolution(canonical, "t2v_v3");
  return {
    prompt: requirePrompt(canonical, "t2v_v3"),
    aspectRatio: requireRatio(canonical, "t2v_v3", ["16:9", "9:16", "1:1"]),
    duration: String(requireEnumDuration(canonical, "t2v_v3", [5, 10, 15, 20])),
  };
}

/** i2v_v3：单图生视频，时长集合更宽，无 ratio / resolution 字段。 */
function encodeI2vV3Body(canonical) {
  ensureNoVideoAudio(canonical, "i2v_v3");
  ensureNoResolution(canonical, "i2v_v3");
  ensureNoRatio(canonical, "i2v_v3");
  const image = singleImage(canonical, "i2v_v3");
  if (!image) throw new Error("i2v_v3 requires an image");
  const body = {
    image: image,
    duration: String(requireEnumDuration(canonical, "i2v_v3", [5, 10, 15, 20])),
  };
  const prompt = trimmed(canonical.prompt);
  if (prompt) body.prompt = prompt;
  return body;
}

/** seedance20：图/视频/音频各一个槽位，resolution 是数字 480 / 720，三者均必填。 */
function encodeSeedance20Body(canonical) {
  const images = canonical.images;
  if (images.length > 1) throw new Error("seedance20 accepts a single image, got " + images.length);
  if (images.length === 1 && images[0].role === "last_frame") {
    throw new Error("seedance20 has no last-frame slot, pass the image without a last_frame role");
  }
  if (canonical.videos.length > 1) throw new Error("seedance20 accepts a single video");
  if (canonical.audios.length > 1) throw new Error("seedance20 accepts a single audio");

  const prompt = trimmed(canonical.prompt);
  const image = images.length ? images[0].url : null;
  const video = canonical.videos.length ? canonical.videos[0] : null;
  const audio = canonical.audios.length ? canonical.audios[0] : null;
  if (!prompt && !image && !video) {
    throw new Error("seedance20 requires at least one of prompt, image or video (audio cannot be used alone)");
  }
  if (audio && !prompt && !image && !video) {
    throw new Error("seedance20: audio must be combined with prompt, image or video");
  }

  const resolution = requireResolution(canonical, "seedance20", ["480p", "720p"]);
  return {
    prompt: prompt,
    image: image,
    video: video,
    audio: audio,
    duration: requireRangeDuration(canonical, "seedance20", 4, 15),
    // 上游这里要数字，不是 "480p"。
    resolution: Number(resolution.replace("p", "")),
    ratio: requireRatio(canonical, "seedance20", ["16:9", "9:16", "1:1"]),
  };
}

/** wan27：单图可选（传图即图生视频），resolution 写成 720P / 1080P。 */
function encodeWan27Body(canonical) {
  ensureNoVideoAudio(canonical, "wan27");
  const resolution = requireResolution(canonical, "wan27", ["720p", "1080p"]);
  const body = {
    prompt: requirePrompt(canonical, "wan27"),
    image: singleImage(canonical, "wan27"),
    duration: String(requireEnumDuration(canonical, "wan27", [5, 10, 15])),
    resolution: resolution.toUpperCase(),
    ratio: requireRatio(canonical, "wan27", ["16:9", "9:16", "1:1", "4:3", "3:4"]),
  };
  if (canonical.promptExtend !== undefined) body.promptExtend = canonical.promptExtend;
  return body;
}

/** happyhorse：单图=图生视频，多图=r2v；ratio 可省略，上游默认 16:9。 */
function encodeHappyhorseBody(canonical) {
  ensureNoVideoAudio(canonical, "happyhorse");
  const images = canonical.images;
  for (const item of images) {
    if (item.role === "last_frame") {
      // 火山格式里两张裸 image_url 的语义是「首帧 + 尾帧」，而 happyhorse 的多图是
      // r2v 参考图。客户端想传多图参考就必须显式写 role:"reference"，不能靠位置猜。
      throw new Error(
        'happyhorse has no last-frame slot: two bare image_url items mean first+last frame in the Ark format, ' +
          'mark the extra images with role "reference" for multi-image (r2v) input',
      );
    }
  }
  let image = null;
  if (images.length === 1) image = images[0].url;
  else if (images.length > 1) {
    image = images.map(function (item) {
      return item.url;
    });
  }
  const resolution = requireResolution(canonical, "happyhorse", ["720p", "1080p"]);
  return {
    prompt: requirePrompt(canonical, "happyhorse"),
    image: image,
    duration: requireRangeDuration(canonical, "happyhorse", 3, 15),
    resolution: resolution.toUpperCase(),
    ratio: optionalRatio(canonical, "happyhorse", ["16:9", "9:16", "3:4", "4:3", "1:1"], DEFAULT_ASPECT_RATIO),
  };
}

const BODY_ENCODERS = {
  minimax: encodeMinimaxBody,
  t2v: encodeT2vBody,
  i2v: encodeI2vBody,
  t2v_v3: encodeT2vV3Body,
  i2v_v3: encodeI2vV3Body,
  seedance20: encodeSeedance20Body,
  wan27: encodeWan27Body,
  happyhorse: encodeHappyhorseBody,
};

const GENERATE_PATHS = {
  minimax: "/api/v1/generate/minimax",
  t2v: "/api/v1/generate/t2v",
  i2v: "/api/v1/generate/i2v",
  t2v_v3: "/api/v1/generate/t2v_v3",
  i2v_v3: "/api/v1/generate/i2v_v3",
  seedance20: "/api/v1/generate/seedance20",
  wan27: "/api/v1/generate/wan27",
  happyhorse: "/api/v1/generate/happyhorse",
};

// 上游 8 个端点都没有水印开关。客户端要求加水印时无法满足，必须报错而不是静默出无水印的片；
// 不写或写 false 时按上游默认出片（aivideomaker 的付费 API 产物本身不带水印）。
function assertWatermark(canonical) {
  if (canonical.watermark === true) {
    throw new Error(
      "watermark=true is not supported: none of the aivideomaker generation endpoints expose a watermark switch",
    );
  }
}

function encodeUpstreamBody(upstream, canonical) {
  const encoder = BODY_ENCODERS[upstream];
  if (!encoder) throw new Error("unsupported model: " + upstream);
  assertWatermark(canonical);
  return encoder(canonical);
}

// ---------------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------------

export function buildSubmitRequest(ctx) {
  const cred = credentials(ctx);
  const canonical = requirePayload(ctx);
  const upstream = assertSupportedModel(upstreamModelOf(ctx, canonical));
  const model = ctx.upstreamModel || canonical.model || CLIENT_MODEL;

  if (cred.mode === "api") {
    return {
      url: upstreamBase(ctx) + GENERATE_PATHS[upstream],
      method: "POST",
      headers: apiHeaders(cred),
      body: encodeUpstreamBody(upstream, canonical),
      action: canonical.action,
      model: model,
    };
  }

  // 网页会话只有 MiniMax H3 一个 tRPC 端点，其余模型没有对应的网页接口。
  if (upstream !== "minimax") {
    throw new Error(
      "web session credentials only cover the minimax model (the site exposes /api/ai.minimaxH3 only); " +
        "use an ak_ API key to call " +
        upstream,
    );
  }

  // 网页会话形态只验证过 minimax 的文字/首尾帧/参考图路径。参考视频与参考音频没有
  // 已验证的 tRPC 端点，而下面的信封会把它们硬编码成 null/[]，等于静默丢弃客户端素材，
  // 所以这里直接报错，不假装支持。
  if (canonical.videos.length || canonical.audios.length) {
    throw new Error("web session credentials do not support reference video or audio input, use an ak_ API key");
  }

  // 网页会话：tRPC 批量信封。token 恒为 null——订阅账号的 model.needsCaptcha
  // 返回 false，非 null 的无效 token 会被直接拒绝，而 null 表示「无需验证码」。
  const json = Object.assign({}, encodeUpstreamBody("minimax", canonical), {
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
    model: model,
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
  // 官方 Task 失败时把原因放在 output.error 里（output.url 只在成功时出现）。
  if (isObject(record.output) && trimmed(record.output.error)) return trimmed(record.output.error);
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
  const duration = Number.isInteger(payload.duration) ? payload.duration : DEFAULT_DURATION;
  // 上游只有 minimax / seedance20 / wan27 / happyhorse 有分辨率维度，t2v / i2v / t2v_v3 /
  // i2v_v3 没有该字段（真实联调确认：t2v 的完成期回填里根本没有 resolution）。
  // 不能凭空填一个默认 720p，否则倍率表会出现一条上游并不存在的分辨率行。
  // 判据是「上游模型有没有这个字段」，不是「payload 里有没有值」——openai 入口会补默认值。
  const upstream = upstreamModelOf(ctx, payload);
  const hasResolutionField = MODELS_WITHOUT_RESOLUTION.indexOf(upstream) < 0;
  const resolution =
    hasResolutionField && RESOLUTIONS.indexOf(payload.resolution) >= 0
      ? payload.resolution
      : UNSPECIFIED_RESOLUTION;
  return { duration: duration, resolution: resolution };
}

// 只回填 usageSchema 内的维度（真实出片时长/分辨率）。厂商积分是连续值，不进
// 事实集，仍留在任务原始数据里供对账。
// 官方 Task schema 顶层没有 duration/resolution，请求参数回显在 input 里；网页会话记录
// 则直接带顶层值。两种形态都必须能取到，否则完成期回填会静默回退到提交期的值。
function recordField(record, key) {
  if (!isObject(record)) return "";
  if (record[key] !== undefined && record[key] !== null && trimmed(record[key]) !== "") return record[key];
  if (isObject(record.input) && record.input[key] !== undefined && record.input[key] !== null) {
    return record.input[key];
  }
  return "";
}

function recordDuration(record) {
  return recordField(record, "duration");
}

function recordResolution(record) {
  const value = recordField(record, "resolution");
  const raw = trimmed(value).toLowerCase();
  if (!raw) return "";
  // 上游部分模型把分辨率写成数字（seedance20 是 480 / 720）。
  return /^[0-9]+$/.test(raw) ? raw + "p" : raw;
}

function recordRatio(record) {
  return trimmed(recordField(record, "ratio")) || trimmed(recordField(record, "aspectRatio"));
}

export function extractUsageOnComplete(task, taskResult, body) {
  // 优先用查询命中的那条记录（网页会话下只有它归属明确），其次才是原始响应体。
  const record = firstRecord(taskResult && taskResult.data, task && task.data, taskRecordFromBody(body));
  const facts = {};
  const duration = Number(recordDuration(record));
  if (Number.isFinite(duration) && duration > 0) facts.duration = Math.round(duration);
  const resolution = recordResolution(record);
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
// native：火山方舟 Seedance 原生入口
// ---------------------------------------------------------------------------

function contentUrl(item, nestedKey, flatKey) {
  const nested = item[nestedKey];
  if (typeof nested === "string") return trimmed(nested);
  if (isObject(nested)) return trimmed(nested.url);
  return trimmed(item[flatKey]);
}

function normalizeContent(content) {
  const texts = [];
  const images = [];
  const videos = [];
  const audios = [];

  for (let i = 0; i < content.length; i += 1) {
    const raw = content[i];
    if (!isObject(raw)) throw new Error("content items must be objects");
    const type = trimmed(raw.type).toLowerCase();

    if (type === "draft_task") {
      throw new Error("draft_task content is not supported by aivideomaker");
    }
    if (type === "text") {
      const text = trimmed(raw.text);
      if (text) texts.push(text);
      continue;
    }
    if (type === "image_url" || type === "image") {
      const url = contentUrl(raw, "image_url", "url");
      if (!isHttpUrl(url) && !/^data:/i.test(url)) {
        throw new Error("image content requires an http(s) or data url");
      }
      const role = trimmed(raw.role).toLowerCase();
      if (role && IMAGE_ROLES.indexOf(role) < 0) throw new Error("unsupported image role: " + role);
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

  return { texts: texts, images: images, videos: videos, audios: audios };
}

// 火山原生里裸 image_url 表示首帧；上游多数模型只有一个图片位、没有 role 概念，
// 所以这里把 role 显式补全，不依赖任何一端的缺省语义。
function resolveImageRoles(parsed) {
  const hasReferenceRole = parsed.images.some(function (item) {
    return item.role === "reference";
  });
  let bareSeen = 0;
  return parsed.images.map(function (item) {
    if (item.role) return item;
    if (hasReferenceRole) return { url: item.url, role: "reference" };
    if (bareSeen < DEFAULT_ROLE_WITHOUT_REFERENCE.length) {
      const role = DEFAULT_ROLE_WITHOUT_REFERENCE[bareSeen];
      bareSeen += 1;
      return { url: item.url, role: role };
    }
    throw new Error("image content without role must declare it explicitly when more than two images are given");
  });
}

function arkActionOf(canonical) {
  const hasReference =
    canonical.audios.length > 0 ||
    canonical.videos.length > 0 ||
    canonical.images.some(function (item) {
      return item.role === "reference";
    });
  if (hasReference) return "reference_to_video";
  if (canonical.images.length > 1) return "first_tail_to_video";
  if (canonical.images.length === 1) return "image_to_video";
  return "text_to_video";
}

export const native = {
  createTask(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const input = ctx.body.value;
    if (!isObject(input)) throw new Error("request body must be an object");

    const model = trimmed(input.model) || trimmed(ctx.model);
    if (!model) throw new Error("model is required");
    const upstream = assertSupportedModel(upstreamModelOf(ctx, { model: model }));

    if (!Array.isArray(input.content)) throw new Error("content must be an array");
    if (input.content.length === 0) throw new Error("content is required");

    const parsed = normalizeContent(input.content);
    const images = resolveImageRoles(parsed);
    if (images.length === 0 && parsed.videos.length === 0 && parsed.audios.length === 0 && parsed.texts.length === 0) {
      throw new Error("content is required");
    }

    const durationInput = input.duration;
    const resolutionInput = input.resolution;
    const ratioInput = input.ratio;
    const watermark = optionalBool(input.watermark, "watermark");
    const promptExtend = optionalBool(
      input.promptExtend !== undefined ? input.promptExtend : input.prompt_extend,
      "promptExtend",
    );

    const canonical = {
      model: model,
      // 上游只接受单个 prompt/content，多条 text 按换行合并，语义等价。
      prompt: parsed.texts.join("\n"),
      images: images,
      videos: parsed.videos,
      audios: parsed.audios,
      duration: trimmed(durationInput) === "" ? undefined : Number(durationInput),
      resolution: normalizeArkResolution(resolutionInput),
      aspectRatio: normalizeArkRatio(ratioInput),
      tier: DEFAULT_TIER,
      durationGiven: trimmed(durationInput) !== "",
      resolutionGiven: trimmed(resolutionInput) !== "",
      aspectRatioGiven: trimmed(ratioInput) !== "",
    };
    if (watermark !== undefined) canonical.watermark = watermark;
    if (promptExtend !== undefined) canonical.promptExtend = promptExtend;
    canonical.action = arkActionOf(canonical);

    return {
      kind: "submit",
      model: model,
      action: canonical.action,
      requestBody: adapterRequest("heterogeneous", canonical),
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
      model: trimmed(task && task.model) || trimmed(data.model),
      status: ARK_STATUS[state] || "queued",
    };

    const videoUrl = resultUrl(data);
    if (videoUrl) output.content = { video_url: videoUrl };
    const resolution = recordResolution(data);
    if (resolution) {
      output.content = output.content || {};
      output.content.resolution = resolution;
    }
    const ratio = recordRatio(data);
    if (ratio) output.ratio = ratio;
    const duration = Number(recordDuration(data));
    if (Number.isFinite(duration) && duration > 0) output.duration = Math.round(duration);
    const progress = Number(String((task && task.progress) || "0").replace("%", ""));
    if (Number.isFinite(progress)) output.progress = progress;
    const createdAt = unixSeconds(data.createdAt);
    if (createdAt) output.created_at = createdAt;
    const completedAt = unixSeconds(data.completedAt);
    if (completedAt) output.completed_at = completedAt;
    if (state === "FAILURE") output.error = { message: failureReason(data) || "aivideomaker task failed" };
    return output;
  },

  error(_ctx, error) {
    return { error: { code: error && error.code, message: error && error.message } };
  },
};

function unixSeconds(value) {
  const raw = trimmed(value);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor(parsed / 1000);
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
      promptExtend: req.promptExtend,
      metadata: isObject(req.metadata) ? req.metadata : undefined,
    },
    model,
  );
  return { kind: "submit", model: model, action: canonical.action, requestBody: adapterRequest("heterogeneous", canonical) };
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
  return { kind: "submit", model: model, action: canonical.action, requestBody: adapterRequest("heterogeneous", canonical) };
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
