export const meta = {
  apiVersion: 1,
  key: "acedata-suno",
  name: "AceData Suno Bridge",
  icon: "Suno",
  description: {
    en: "New API Suno task surface (submit/music, submit/lyrics, fetch) bridged to AceDataCloud Suno upstream",
    zh: "New API Suno 任务接口入口（生成歌曲/歌词、查询任务），异构转换到 AceDataCloud Suno 上游",
  },
  version: "1.0.6",
  author: { name: "Jushenzhidao" },
  channelTypes: [10007],
  models: ["suno_music", "suno_lyrics"],
  fetchMode: "per_task",
  usageSchema: {
    clips: {
      type: "number",
      unit: "count",
      description: {
        en: "Number of generated candidates (Suno returns 2 songs per music task, 2 lyric drafts per lyrics task).",
        zh: "生成候选数量（Suno 每次音乐任务返回 2 首歌，歌词任务返回 2 份歌词草稿）。",
      },
    },
    operation: {
      enum: ["generate", "extend", "concat", "lyrics"],
      description: { en: "Requested Suno operation.", zh: "请求的 Suno 操作类型。" },
    },
  },
  usageExamples: [
    { label: "generate 2 songs", facts: { clips: 2, operation: "generate" } },
    { label: "extend a song", facts: { clips: 2, operation: "extend" } },
    { label: "concat clips", facts: { clips: 1, operation: "concat" } },
    { label: "generate lyrics", facts: { clips: 2, operation: "lyrics" } },
  ],
  routes: [
    // 跨协议异构：对外恢复 New API Suno 官方路径；body 由 New API Suno 形状转换为
    // AceDataCloud /suno/audios|/suno/lyrics，adapterMode 恒为 heterogeneous。
    {
      method: "POST",
      // The official sunoapi plugin already owns /suno/*; use an explicit namespace
      // for this AceData bridge to avoid a host-level route conflict.
      path: "/suno/submit/music",
      type: "submit",
      decode: "submitMusic",
      render: "submitted",
    },
    {
      method: "POST",
      path: "/suno/submit/lyrics",
      type: "submit",
      decode: "submitLyrics",
      render: "submitted",
    },
    // 歌曲拼接：New API Suno /suno/submit/concat -> acedata /suno/audios action=concat
    {
      method: "POST",
      path: "/suno/submit/concat",
      type: "submit",
      decode: "submitConcat",
      render: "submitted",
    },
    // New API Suno 单查询：GET /suno/fetch/{task_id}；批量 POST /suno/fetch 因宿主 query 路由
    // 合同要求 :task_id 占位符出现在 path 中而无法声明，明确不支持（客户端请逐个单查）。
    {
      method: "GET",
      path: "/suno/fetch/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "fetchTask",
    },
  ],
};

// ---------------------------------------------------------------------------
// 入站契约：New API Suno 任务格式（基于开源 Suno-API 代理协议，参考用户提供的完整中文文档）
//   POST /suno/submit/music  { prompt, tags, title, mv, make_instrumental, gpt_description_prompt,
//                              task_id, continue_at, continue_clip_id, notify_hook }
//   POST /suno/submit/lyrics { prompt, notify_hook }
//   POST /suno/submit/concat { clip_id, is_infill }
//   GET  /suno/fetch/{task_id} -> { code, message, data: { task_id, action, status, fail_reason,
//                              submit_time, start_time, finish_time, progress, data } }
//   status 枚举（文档声明式）：IN_PROGRESS / SUCCESS / FAIL —— 排队期也渲染为 IN_PROGRESS
//   （文档批量查询示例即 status=IN_PROGRESS + progress "0%"）
// 上游契约：AceDataCloud Suno（https://api.acedata.cloud）
//   POST /suno/audios  { action(generate/extend/concat/...), model, custom, prompt|lyric, title,
//                        style, instrumental, audio_id, continue_at, async, ... }  Bearer 鉴权
//   POST /suno/lyrics  { prompt, async }
//   POST /suno/tasks   { id, action: "retrieve" } -> { id, request, response, created_at,
//                        started_at, finished_at?, elapsed? }
//   注意：tasks 响应没有显式状态枚举——完成与否靠 finished_at/response 判断，
//   成功靠 response.success === true + data 内容，失败靠 response.error。
// 语义缺口（显式拒绝，不静默丢弃）：
//   - notify_hook：acedata callback_url 推送的是 acedata 形状且无 Suno-API 回调语义，无法复刻
//   - POST /suno/fetch 批量查询：宿主 query 路由合同要求 :task_id 占位符，无法声明该路径
//   - POST /suno/uploads/audio-url：acedata 无对应「上传音频返回任务」端点（voices 是声音克隆，
//     语义不同），不提供该路由
//   - concat 的 is_infill: true：acedata concat 无 infill 语义（infill 属 replace_section 范畴）
// 已知偏差（有意为之）：
//   - mv 缺省时不注入模型，交由 acedata 默认（chirp-v4）；文档写默认 chirp-v3-0 属 Suno-API
//     旧默认，且其自身示例已用 chirp-v4。mv 枚举放宽为 acedata 支持的全部 chirp 模型。
//   - 在 New API Suno 契约之外白名单放行 acedata 扩展可选字段（negative_tags、vocal_gender、
//     variation_category、weirdness、style_influence、duration、lyric_prompt、persona_id），
//     逐项按 acedata 文档校验类型/范围/模型版本限制后编码，绝不整包透传。
// ---------------------------------------------------------------------------

const MUSIC_MODEL = "suno_music";
const LYRICS_MODEL = "suno_lyrics";
const DEFAULT_BASE = "https://api.acedata.cloud";
const SONGS_PER_TASK = 2;

// acedata /suno/audios 支持的 chirp 模型枚举（入站 mv 直接对齐该枚举）
const CHIRP_MODELS = ["chirp-v5-5", "chirp-v5", "chirp-v4-5-plus", "chirp-v4-5", "chirp-v4", "chirp-v3-5", "chirp-v3-0"];
// 模型分级（acedata 文档的两档字符上限 + 参数版本门槛）
const V45_PLUS_MODELS = ["chirp-v4-5", "chirp-v4-5-plus", "chirp-v5", "chirp-v5-5"];
const V5_PLUS_MODELS = ["chirp-v5", "chirp-v5-5"];
const DEFAULT_CHIRP = "chirp-v4"; // acedata 文档声明的缺省模型
const PROMPT_MAX = 500; // 灵感模式 prompt 上限（不分版本）

function isV45Plus(model) {
  return V45_PLUS_MODELS.indexOf(model || DEFAULT_CHIRP) >= 0;
}
function isV5Plus(model) {
  return V5_PLUS_MODELS.indexOf(model || DEFAULT_CHIRP) >= 0;
}
// 按模型档位取字符上限：{ lyric, style, title }
function textLimits(model) {
  return isV45Plus(model) ? { lyric: 5000, style: 1000, title: 100 } : { lyric: 3000, style: 200, title: 80 };
}

function trimmed(value) {
  return String(value || "").trim();
}

function adapterRequest(payload) {
  return { adapterMode: "heterogeneous", payload: payload };
}

function requireAdapterRequest(ctx) {
  const value = ctx && ctx.requestBody;
  if (!value || value.adapterMode !== "heterogeneous") throw new Error("missing adapter mode");
  return value;
}

function requireJSONObject(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const input = ctx.body.value;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("request body must be an object");
  return input;
}

// ---------------------------------------------------------------------------
// 异构 decode：New API Suno 请求 -> 内部规范模型
//   operation 判定优先级（互斥可判定，不做猜测）：
//     continue_clip_id 存在 -> extend；gpt_description_prompt 存在 -> generate 灵感模式；
//     否则 -> generate 自定义模式（prompt 即歌词，必填）
// ---------------------------------------------------------------------------

function normalizeChirpModel(raw) {
  const mv = trimmed(raw);
  if (!mv) return ""; // 缺省交给 acedata 默认（chirp-v4）
  if (CHIRP_MODELS.indexOf(mv) < 0) throw new Error("mv must be one of " + CHIRP_MODELS.join(", "));
  return mv;
}

function limitedText(value, max, field) {
  const text = trimmed(value);
  if (text.length > max) throw new Error(field + " must be at most " + max + " characters for this model");
  return text;
}

function unitRange(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(field + " must be a number between 0 and 1");
  return n;
}

// acedata 扩展可选字段（New API Suno 契约之外，同名白名单放行 + 逐项校验）
function normalizeExtras(req, mv, mode) {
  // mode: "custom" | "inspiration" | "extend"
  const extras = {};
  if (req.negative_tags !== undefined && trimmed(req.negative_tags)) {
    if (mode === "inspiration") throw new Error("negative_tags is only effective in custom mode");
    extras.negativeTags = trimmed(req.negative_tags);
  }
  if (req.vocal_gender !== undefined && trimmed(req.vocal_gender)) {
    const g = trimmed(req.vocal_gender).toLowerCase();
    if (g !== "m" && g !== "f") throw new Error("vocal_gender must be 'm' or 'f'");
    if (!isV45Plus(mv)) throw new Error("vocal_gender requires chirp-v4-5 or later (set mv accordingly)");
    extras.vocalGender = g;
  }
  if (req.variation_category !== undefined && trimmed(req.variation_category)) {
    const v = trimmed(req.variation_category).toLowerCase();
    if (["high", "normal", "subtle"].indexOf(v) < 0) throw new Error("variation_category must be high, normal or subtle");
    if (!isV5Plus(mv)) throw new Error("variation_category requires chirp-v5 or later (set mv accordingly)");
    extras.variationCategory = v;
  }
  if (req.weirdness !== undefined && req.weirdness !== null && req.weirdness !== "") {
    if (mode === "inspiration") throw new Error("weirdness is only effective in custom mode");
    extras.weirdness = unitRange(req.weirdness, "weirdness");
  }
  if (req.style_influence !== undefined && req.style_influence !== null && req.style_influence !== "") {
    if (mode === "inspiration") throw new Error("style_influence is only effective in custom mode");
    extras.styleInfluence = unitRange(req.style_influence, "style_influence");
  }
  if (req.duration !== undefined && req.duration !== null && req.duration !== "") {
    const d = Number(req.duration);
    if (!Number.isInteger(d) || d < 10 || d > 360) throw new Error("duration must be an integer between 10 and 360 seconds");
    if (mode === "inspiration") throw new Error("duration is only effective in custom mode");
    extras.duration = d;
  }
  if (req.lyric_prompt !== undefined && trimmed(req.lyric_prompt)) {
    // acedata：仅 custom=true 且 lyric 为空时生效
    if (mode !== "custom") throw new Error("lyric_prompt is only effective in custom mode");
    if (trimmed(req.prompt)) throw new Error("lyric_prompt is only effective when prompt (lyrics) is empty");
    extras.lyricPrompt = trimmed(req.lyric_prompt);
  }
  if (req.persona_id !== undefined && trimmed(req.persona_id)) {
    extras.personaId = trimmed(req.persona_id);
  }
  return extras;
}

function decodeSubmitMusic(ctx) {
  const req = requireJSONObject(ctx);
  // 语义缺口显式拒绝：acedata 回调推送体是 acedata 形状，无法复刻 Suno-API notify_hook 语义
  if (trimmed(req.notify_hook)) throw new Error("notify_hook is not supported by the acedata upstream bridge; poll /suno/fetch/{task_id} instead");

  const mv = normalizeChirpModel(req.mv);
  const limits = textLimits(mv);
  const instrumental = req.make_instrumental === true;
  const prompt = trimmed(req.prompt);
  const gptPrompt = trimmed(req.gpt_description_prompt);
  const continueClipId = trimmed(req.continue_clip_id);

  const normalized = { kind: "music", mv: mv, instrumental: instrumental };

  if (continueClipId) {
    // 续写：Suno-API 用 continue_clip_id + continue_at（task_id 仅作客户端关联，acedata 不需要）
    // acedata extend：audio_id 必填、continue_at 可选（缺省由上游决定边界）
    normalized.operation = "extend";
    normalized.audioId = continueClipId;
    if (req.continue_at !== undefined && req.continue_at !== null && req.continue_at !== "") {
      const at = Number(req.continue_at);
      if (!Number.isFinite(at) || at < 0) throw new Error("continue_at must be a non-negative number for extend");
      normalized.continueAt = at;
    }
    // extend 的 lyric/style 只引导边界之后的新内容
    if (prompt) normalized.lyric = limitedText(prompt, limits.lyric, "prompt (lyrics)");
    if (trimmed(req.title)) normalized.title = limitedText(req.title, limits.title, "title");
    if (trimmed(req.tags)) normalized.style = limitedText(req.tags, limits.style, "tags (style)");
    normalized.extras = normalizeExtras(req, mv, "extend");
  } else if (gptPrompt) {
    // 灵感模式：gpt_description_prompt -> acedata prompt（custom=false，上限 500 字符）
    if (prompt) throw new Error("prompt and gpt_description_prompt are mutually exclusive (custom vs inspiration mode)");
    normalized.operation = "generate";
    normalized.custom = false;
    normalized.prompt = limitedText(gptPrompt, PROMPT_MAX, "gpt_description_prompt");
    normalized.extras = normalizeExtras(req, mv, "inspiration");
  } else {
    // 自定义模式：prompt 即歌词 -> acedata lyric（custom=true）
    // 无 prompt 时也可用 lyric_prompt 让上游自动写词，或 instrumental 纯伴奏
    if (!prompt && !instrumental && !trimmed(req.lyric_prompt)) {
      throw new Error("prompt (lyrics), lyric_prompt or gpt_description_prompt is required");
    }
    normalized.operation = "generate";
    normalized.custom = true;
    if (prompt) normalized.lyric = limitedText(prompt, limits.lyric, "prompt (lyrics)");
    if (trimmed(req.title)) normalized.title = limitedText(req.title, limits.title, "title");
    if (trimmed(req.tags)) normalized.style = limitedText(req.tags, limits.style, "tags (style)");
    normalized.extras = normalizeExtras(req, mv, "custom");
  }

  return {
    kind: "submit",
    model: MUSIC_MODEL,
    action: normalized.operation,
    requestBody: adapterRequest(normalized),
  };
}

function decodeSubmitLyrics(ctx) {
  const req = requireJSONObject(ctx);
  if (trimmed(req.notify_hook)) throw new Error("notify_hook is not supported by the acedata upstream bridge; poll /suno/fetch/{task_id} instead");
  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("prompt is required");
  return {
    kind: "submit",
    model: LYRICS_MODEL,
    action: "lyrics",
    requestBody: adapterRequest({ kind: "lyrics", operation: "lyrics", prompt: prompt }),
  };
}

function decodeSubmitConcat(ctx) {
  const req = requireJSONObject(ctx);
  if (trimmed(req.notify_hook)) throw new Error("notify_hook is not supported by the acedata upstream bridge; poll /suno/fetch/{task_id} instead");
  const clipId = trimmed(req.clip_id);
  if (!clipId) throw new Error("clip_id is required");
  // acedata concat 无 infill 语义（infill 属 replace_section 范畴）：显式拒绝而非静默丢弃
  if (req.is_infill === true) throw new Error("is_infill is not supported by the acedata upstream bridge");
  return {
    kind: "submit",
    model: MUSIC_MODEL,
    action: "concat",
    requestBody: adapterRequest({ kind: "music", operation: "concat", audioId: clipId }),
  };
}

// ---------------------------------------------------------------------------
// 唯一 encoder：内部规范模型 -> acedata body（白名单，客户端字段不外泄）
// ---------------------------------------------------------------------------

function encodeAcedataRequest(payload) {
  if (payload.kind === "lyrics") {
    // POST /suno/lyrics：{ prompt, async }。以计算属性保留上游字段，避免宿主同步语法扫描器把 async: 误判为插件异步语法。
    const body = { prompt: payload.prompt };
    body["async"] = true;
    return body;
  }
  // POST /suno/audios：恒 async，靠 /suno/tasks 轮询
  if (payload.operation === "concat") {
    // concat 只需 audio_id（extend 产物的歌曲 ID）
    const body = { action: "concat", audio_id: payload.audioId };
    body["async"] = true;
    return body;
  }
  const body = { action: payload.operation === "extend" ? "extend" : "generate" };
  body["async"] = true;
  if (payload.mv) body.model = payload.mv;
  if (payload.instrumental) body.instrumental = true;
  if (payload.operation === "extend") {
    body.audio_id = payload.audioId;
    if (payload.continueAt !== undefined) body.continue_at = payload.continueAt;
    if (payload.lyric) body.lyric = payload.lyric;
  } else {
    body.custom = payload.custom === true;
      // New API body.prompt is the user's lyric text for this bridge; AceData custom mode expects it as lyric.
      if (payload.custom) {
        if (payload.lyric) body.lyric = payload.lyric;
      } else {
        body.prompt = payload.prompt;
      }
  }
  if (payload.title) body.title = payload.title;
  if (payload.style) body.style = payload.style;
  // acedata 扩展可选字段（decode 期已按文档校验，白名单编码）
  const extras = payload.extras || {};
  if (extras.negativeTags) body.negative_tags = extras.negativeTags;
  if (extras.vocalGender) body.vocal_gender = extras.vocalGender;
  if (extras.variationCategory) body.variation_category = extras.variationCategory;
  if (extras.weirdness !== undefined) body.weirdness = extras.weirdness;
  if (extras.styleInfluence !== undefined) body.style_influence = extras.styleInfluence;
  if (extras.duration !== undefined) body.duration = extras.duration;
  if (extras.lyricPrompt) body.lyric_prompt = extras.lyricPrompt;
  if (extras.personaId) body.persona_id = extras.personaId;
  return body;
}

// ---------------------------------------------------------------------------
// driver hooks：与 acedata 上游对话
// ---------------------------------------------------------------------------

function apiBase(ctx) {
  return String(ctx.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

function upstreamHeaders(ctx) {
  return { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey };
}

export function buildSubmitRequest(ctx) {
  const request = requireAdapterRequest(ctx);
  const payload = request.payload || {};
  const path = payload.kind === "lyrics" ? "/suno/lyrics" : "/suno/audios";
  return {
    url: apiBase(ctx) + path,
    method: "POST",
    headers: upstreamHeaders(ctx),
    body: encodeAcedataRequest(payload),
    action: payload.operation || ctx.action,
  };
}

function acedataError(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const err = b.error && typeof b.error === "object" && !Array.isArray(b.error) ? b.error : {};
  return trimmed(err.message) || trimmed(err.code) || (b.success === false ? "acedata upstream error" : "");
}

export function parseSubmitResponse(_ctx, resp) {
  let body = resp.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  const taskId = trimmed(body.task_id);
  const message = acedataError(body);
  if (!taskId) throw new Error(message || "missing task_id in acedata submit response");
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  // acedata 任务查询是 POST /suno/tasks + body { id, action: "retrieve" }（不是 GET path param）；
  // 宿主路由的 :task_id 只用于满足 query 路由合同。lyrics/music 走同一查询端点，路径固定。
  return {
    url: apiBase(ctx) + "/suno/tasks",
    method: "POST",
    headers: upstreamHeaders(ctx),
    body: { id: ctx.taskId, action: "retrieve" },
  };
}

// ---------------------------------------------------------------------------
// 状态判定：acedata /suno/tasks 无显式状态枚举（文档明确只有字段存在性判断）
//   层 0：查询 envelope 错误（HTTP 408/429/5xx 抛错重试；其余 4xx 也视为查询期错误抛错，
//         acedata tasks 的 4xx 均为鉴权/参数类错误，与任务本身终态无关）
//   完成信号：finished_at/elapsed 存在 或 response 出现
//   成功：response.success === true 且能提取到有效产物（audio_url 或歌词 text）
//   失败：response.error / response.success === false / data 项 state 前缀命中失败词
//   进行中：started_at 已出现；排队：都没有
// ---------------------------------------------------------------------------

const FAIL_PREFIX = ["erro", "fail", "cancel", "expire", "timeout", "reject", "abort"];

function normalizeState(value) {
  return trimmed(value).toLowerCase().replace(/[\s\-.]+/g, "_");
}

function taskItems(response) {
  const data = response && response.data;
  if (Array.isArray(data)) return data.filter(function (item) { return item && typeof item === "object" && !Array.isArray(item); });
  if (data && typeof data === "object") return [data];
  return [];
}

function firstAudioURL(items) {
  for (const item of items) {
    const url = trimmed(item.audio_url);
    if (/^https?:\/\//.test(url)) return url;
  }
  return "";
}

function hasLyricsText(items) {
  return items.some(function (item) { return !!trimmed(item.text); });
}

function itemFailureReason(items) {
  for (const item of items) {
    const state = normalizeState(item.state || item.status);
    if (FAIL_PREFIX.some(function (p) { return state.indexOf(p) === 0; })) {
      const meta = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      return trimmed(meta.error_message) || trimmed(item.error_message) || "upstream generation failed (state: " + state + ")";
    }
  }
  return "";
}

function statusResult(envelope) {
  const e = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : {};
  const response = e.response && typeof e.response === "object" && !Array.isArray(e.response) ? e.response : null;

  if (response) {
    const respError = acedataError(response);
    if (respError) return { status: "FAILURE", progress: "100%", reason: respError };
    const items = taskItems(response);
    const itemFail = itemFailureReason(items);
    if (response.success === true) {
      const url = firstAudioURL(items);
      // 结果兜底让位于失败信号：全部候选失败时不判成功
      if (url && !itemFail) return { status: "SUCCESS", progress: "100%", url: url };
      if (hasLyricsText(items) && !itemFail) return { status: "SUCCESS", progress: "100%" };
      if (itemFail) return { status: "FAILURE", progress: "100%", reason: itemFail };
      // success=true 但尚无产物（如仍在 streaming）：继续轮询
      return { status: "IN_PROGRESS", progress: "90%" };
    }
    if (itemFail) return { status: "FAILURE", progress: "100%", reason: itemFail };
  }

  // 尚无 response：finished_at 未出现说明任务未完成（文档：未完成时不返回该字段）
  const started = Number(e.started_at);
  if (Number.isFinite(started) && started > 0) return { status: "IN_PROGRESS", progress: "50%" };
  // 安全默认（绝不 UNKNOWN）
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
  if (httpCode >= 400) {
    // tasks 端点的 4xx/5xx 都是查询自身的错误（token、限流、内部错误），不是任务终态
    throw new Error(acedataError(parsed) || "acedata tasks query error (http " + httpCode + ")");
  }
  const topError = acedataError(parsed);
  if (topError && !parsed.response) throw new Error(topError);
  return Object.assign({ code: 0 }, statusResult(parsed));
}

// ---------------------------------------------------------------------------
// 用量：提交时按操作口径预估；acedata 不在任务结果中回报用量
// ---------------------------------------------------------------------------

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const payload = requireAdapterRequest(ctx).payload || {};
  const operation = payload.operation || "generate";
  // concat 产出 1 条拼接结果；generate/extend/lyrics 均为 2 个候选
  return { clips: operation === "concat" ? 1 : SONGS_PER_TASK, operation: operation };
}

// ---------------------------------------------------------------------------
// Artifact：音乐任务成功后 response.data[] 每首歌的 audio/image/video URL（CDN，credentialless）
//   歌词任务是纯文本产物：不注册 artifact，由 fetch renderer 透传 text
// ---------------------------------------------------------------------------

function persistedEnvelope(source) {
  // task.data 可能是 tasks retrieve envelope（{ id, request, response, ... }）
  // 或提交期 taskData（{ success, task_id, data }，async 提交时无 data）
  const d = (source && source.data) || {};
  if (d.response && typeof d.response === "object" && !Array.isArray(d.response)) return d.response;
  return d;
}

function mimeByKind(kind, url) {
  if (kind === "audio") return /\.wav(\?|$)/i.test(url) ? "audio/wav" : "audio/mpeg";
  if (kind === "image") return /\.jpe?g(\?|$)/i.test(url) ? "image/jpeg" : "image/png";
  return "video/mp4";
}

function artifactCandidates(source) {
  const items = taskItems(persistedEnvelope(source));
  const seen = {};
  const out = [];
  const counters = { audio: 0, image: 0, video: 0 };
  for (const item of items) {
    const fields = [
      { kind: "audio", url: trimmed(item.audio_url) },
      { kind: "image", url: trimmed(item.image_url) },
      { kind: "video", url: trimmed(item.video_url) },
    ];
    for (const f of fields) {
      if (!/^https?:\/\//.test(f.url) || seen[f.url]) continue;
      seen[f.url] = true;
      counters[f.kind] += 1;
      const key = counters[f.kind] === 1 ? f.kind : f.kind + "_" + counters[f.kind];
      out.push({ key: key, type: f.kind, mimeType: mimeByKind(f.kind, f.url), url: f.url });
    }
  }
  return out;
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  return artifactCandidates(task).map(function (a) {
    return { key: a.key, type: a.type, mimeType: a.mimeType };
  });
}

export function buildContentRequest(ctx) {
  const found = artifactCandidates(ctx).filter(function (a) { return a.key === ctx.artifactKey; })[0];
  if (!found) throw new Error("artifact_not_found");
  // acedata / suno CDN 公共签名 URL：credentialless 回源，严禁携带渠道 Authorization
  return { url: found.url, method: ctx.clientRequest.method, credentialless: true };
}

// ---------------------------------------------------------------------------
// 原生 renderer：把宿主任务状态还原成 New API Suno 官方响应形状
// ---------------------------------------------------------------------------

// 宿主内部状态 -> New API Suno status 枚举
// 文档声明式枚举只有 IN_PROGRESS / SUCCESS / FAIL（无 SUBMITTED/QUEUED），
// 排队期按文档批量查询示例的口径渲染为 IN_PROGRESS + progress "0%"
const SUNO_STATUS = {
  NOT_START: "IN_PROGRESS",
  SUBMITTED: "IN_PROGRESS",
  QUEUED: "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  SUCCESS: "SUCCESS",
  FAILURE: "FAIL",
};

function epochSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function isLyricsEnvelope(envelope, items) {
  const req = envelope && envelope.request && typeof envelope.request === "object" ? envelope.request : {};
  // 音乐任务的 request 带 action（generate/extend）；歌词任务 request 只有 prompt。
  // 再用产物形状兜底：有 text 且无 audio_url 即歌词。
  if (trimmed(req.action)) return false;
  return items.some(function (item) { return !!trimmed(item.text) && !trimmed(item.audio_url); });
}

function renderSongItem(item) {
  const song = {
    id: trimmed(item.id),
    title: trimmed(item.title),
    status: trimmed(item.state || item.status) || "complete",
    metadata: {
      tags: trimmed(item.style),
      prompt: item.lyric === undefined ? null : item.lyric,
      duration: item.duration === undefined ? null : item.duration,
      error_type: null,
      error_message: null,
      audio_prompt_id: null,
      gpt_description_prompt: trimmed(item.prompt) || null,
    },
    audio_url: trimmed(item.audio_url),
    image_url: trimmed(item.image_url),
    video_url: trimmed(item.video_url),
    model_name: trimmed(item.model),
    image_large_url: trimmed(item.image_large_url || item.image_url),
    major_model_version: majorModelVersion(item.model),
  };
  return song;
}

// chirp-v4-5-plus -> v4-5-plus（文档歌曲对象带 major_model_version，如 "v3"）
function majorModelVersion(model) {
  const m = trimmed(model);
  return m.indexOf("chirp-") === 0 ? m.slice(6) : m;
}

function renderLyricsItem(items, taskId) {
  const first = items.filter(function (item) { return !!trimmed(item.text); })[0] || {};
  return {
    id: trimmed(first.id) || taskId,
    text: first.text || "",
    title: trimmed(first.title),
    status: trimmed(first.status || first.state) || "complete",
  };
}

export const native = {
  submitMusic: decodeSubmitMusic,
  submitLyrics: decodeSubmitLyrics,
  submitConcat: decodeSubmitConcat,

  // New API Suno 提交响应：{ code, message, data: <公开任务 ID 字符串> }
  submitted(_ctx, task) {
    return { code: "success", message: "", data: task.task_id };
  },

  // New API Suno 查询响应：{ code, message, data: 任务对象 }
  fetchTask(_ctx, task) {
    const envelope = (task && task.data) || {};
    const response = persistedEnvelope(task);
    const items = taskItems(response);
    const lyrics = isLyricsEnvelope(envelope, items);
    const status = SUNO_STATUS[task.status] || "IN_PROGRESS";
    const out = {
      task_id: task.task_id,
      notify_hook: "",
      action: lyrics ? "LYRICS" : "MUSIC",
      status: status,
      fail_reason: task.status === "FAILURE" ? (task.fail_reason || "task failed") : "",
      submit_time: epochSeconds(envelope.created_at || task.created_at),
      start_time: epochSeconds(envelope.started_at),
      finish_time: epochSeconds(envelope.finished_at),
      progress: task.progress || (task.status === "SUCCESS" || task.status === "FAILURE" ? "100%" : "0%"),
      data: null,
    };
    if (items.length) {
      out.data = lyrics ? renderLyricsItem(items, task.task_id) : items.map(renderSongItem);
    }
    return { code: "success", message: "", data: out };
  },
};
