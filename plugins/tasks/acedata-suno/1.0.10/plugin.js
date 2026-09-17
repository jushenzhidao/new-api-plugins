export const meta = {
  apiVersion: 1,
  key: "acedata-suno",
  name: "AceData Suno Bridge",
  icon: "Suno",
  description: {
    en: "New API Suno task surface (submit/:action, batch fetch, fetch by id) bridged to AceDataCloud Suno upstream",
    zh: "New API Suno 任务接口（提交生成/歌词/拼接、批量查询、单任务查询），异构转换到 AceDataCloud Suno 上游",
  },
  version: "1.0.10",
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
    // 跨协议异构：对外对齐 New API Suno 官方三条路由（与官方 sunoapi 插件形状一致，因此加载本
    // 插件前必须停用/卸载官方 sunoapi，否则宿主按「method + 规范化路径形状」判定路由冲突）。
    // body 由 New API Suno 形状转换为 AceDataCloud /suno/audios|/suno/lyrics，
    // adapterMode 恒为 heterogeneous。
    {
      // :action 通配：music / lyrics / concat（大小写不敏感）；
      // 具体路径 /suno/submit/music、/suno/submit/lyrics、/suno/submit/concat 同样命中。
      method: "POST",
      path: "/suno/submit/:action",
      type: "submit",
      decode: "submitAction",
      render: "submitted",
    },
    // New API Suno 批量查询：POST /suno/fetch { ids: string[], action?: MUSIC|LYRICS }
    // 宿主 dynamic 路由：decode 返回 { kind:"query", taskIds }，宿主解析归属后把任务数组交给 render。
    {
      method: "POST",
      path: "/suno/fetch",
      type: "dynamic",
      decode: "fetchBatch",
      render: "fetchTasks",
    },
    // New API Suno 单查询：GET /suno/fetch/{task_id}
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
//   POST /suno/submit/:action  action ∈ music | lyrics | concat（大小写不敏感）
//     music  { prompt, tags, title, mv, make_instrumental, gpt_description_prompt,
//              task_id, continue_at, continue_clip_id, notify_hook }
//     lyrics { prompt, notify_hook }
//     concat { clip_id, is_infill }
//   POST /suno/fetch          { ids: string[], action?: MUSIC|LYRICS } -> data: 任务对象数组
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
//   - POST /suno/uploads/audio-url：acedata 无对应「上传音频返回任务」端点（voices 是声音克隆，
//     语义不同），不提供该路由
//   - concat 的 is_infill: true：acedata concat 无 infill 语义（infill 属 replace_section 范畴）
// 已知偏差（有意为之）：
//   - notify_hook -> acedata callback_url：/suno/audios 文档「异步回调」有该参数，故转发而不是
//     拒绝请求（1.0.8 及更早对 notify_hook 显式报错 400，实测会打断正常客户端）。偏差在于回调由
//     上游直连客户端，推送体是 acedata 形状而非 Suno-API 形状；/suno/lyrics 未声明该参数，
//     歌词任务只校验 URL 格式后忽略，客户端仍需轮询 /suno/fetch/{task_id}。
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

// Suno-API notify_hook -> acedata callback_url（/suno/audios 文档「异步回调」章节：需要回调结果的 URL）。
// 回调由上游直连客户端的服务，推送体是 acedata 形状而非 Suno-API 形状——这是已知偏差，
// 但字段本身有上游语义对应，因此转发而不是拒绝请求。
function normalizeNotifyHook(value) {
  const url = trimmed(value);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) throw new Error("notify_hook must be an absolute http(s) URL");
  return url;
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
  const notifyHook = normalizeNotifyHook(req.notify_hook);

  const mv = normalizeChirpModel(req.mv);
  const limits = textLimits(mv);
  const instrumental = req.make_instrumental === true;
  const prompt = trimmed(req.prompt);
  const gptPrompt = trimmed(req.gpt_description_prompt);
  const continueClipId = trimmed(req.continue_clip_id);

  const normalized = { kind: "music", mv: mv, instrumental: instrumental };
  if (notifyHook) normalized.notifyHook = notifyHook;

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
  // /suno/lyrics 文档未声明 callback_url，没有白名单依据可转发：只做格式校验后忽略，
  // 不拦截请求（歌词仍会正常生成，客户端请轮询 /suno/fetch/{task_id}）。
  normalizeNotifyHook(req.notify_hook);
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
  const notifyHook = normalizeNotifyHook(req.notify_hook);
  const clipId = trimmed(req.clip_id);
  if (!clipId) throw new Error("clip_id is required");
  // acedata concat 无 infill 语义（infill 属 replace_section 范畴）：显式拒绝而非静默丢弃
  if (req.is_infill === true) throw new Error("is_infill is not supported by the acedata upstream bridge");
  return {
    kind: "submit",
    model: MUSIC_MODEL,
    action: "concat",
    requestBody: adapterRequest({ kind: "music", operation: "concat", audioId: clipId, notifyHook: notifyHook || undefined }),
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
    if (payload.notifyHook) body.callback_url = payload.notifyHook;
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
  if (payload.notifyHook) body.callback_url = payload.notifyHook;
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

// 显式错误对象：只认 error{code,message}，用于区分「查询自身出错」（抛错让宿主重试）
// 与「任务终态失败」（success=false，判 FAILURE 并退款）。不要混用。
function envelopeError(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const err = b.error && typeof b.error === "object" && !Array.isArray(b.error) ? b.error : {};
  return trimmed(err.message) || trimmed(err.code);
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

// acedata 任务响应有两种形状，都要认：
//   1) /suno/tasks 检索包裹体：{ id, request, response: { success, data }, created_at, started_at, finished_at }
//   2) 顶层平铺体（部分端点与异步回调直推）：{ success, task_id, trace_id, data: [...] }
// 取不到响应体时返回 null，交给下面的时间字段兜底。
function responseOf(envelope) {
  const e = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : {};
  if (e.response && typeof e.response === "object" && !Array.isArray(e.response)) return e.response;
  if (e.success !== undefined || e.data !== undefined) return e;
  return null;
}

// 成功前缀（与 FAIL_PREFIX 对称，仅用于「无 success 标记 + 有产物」时确认已进入终态，
// 避免把 state=streaming 这类中间态误判为成功）
const SUCCESS_PREFIX = ["succeed", "success", "complete", "finish", "done"];

function itemsTerminalSuccess(items) {
  const withState = items.filter(function (item) { return !!trimmed(item.state || item.status); });
  if (!withState.length) return true; // 没有状态字段，按结果字段兜底
  return withState.every(function (item) {
    const state = normalizeState(item.state || item.status);
    return SUCCESS_PREFIX.some(function (p) { return state.indexOf(p) === 0; });
  });
}

function statusResult(envelope) {
  const e = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : {};
  const response = responseOf(e);

  if (response) {
    const respError = acedataError(response);
    if (respError) return { status: "FAILURE", progress: "100%", reason: respError };
    const items = taskItems(response);
    const itemFail = itemFailureReason(items);
    // 结果兜底让位于失败信号：有失败项时一律判失败
    if (itemFail) return { status: "FAILURE", progress: "100%", reason: itemFail };
    const url = firstAudioURL(items);
    const lyrics = hasLyricsText(items);
    if (response.success === true) {
      if (url) return { status: "SUCCESS", progress: "100%", url: url };
      if (lyrics) return { status: "SUCCESS", progress: "100%" };
      // success=true 但尚无产物（如仍在 streaming）：继续轮询
      return { status: "IN_PROGRESS", progress: "90%" };
    }
    // 层 4 结果字段兜底：没有 success 标记，但产物已就绪且状态已终态
    if ((url || lyrics) && itemsTerminalSuccess(items)) {
      return url ? { status: "SUCCESS", progress: "100%", url: url } : { status: "SUCCESS", progress: "100%" };
    }
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
  // 只有显式 error 对象才是查询自身错误（抛错重试）；
  // 顶层 success=false 属任务终态失败，交给 statusResult 判 FAILURE。
  const topError = envelopeError(parsed);
  if (topError && !responseOf(parsed)) throw new Error(topError);
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
  // Host passes the latest upstream snapshot in either task.data (task object)
  // or ctx.data (content hook context). Accept both object and direct envelope
  // forms, because native fetch output is not the same shape as Task.Data.
  const root = source && typeof source === "object" ? source : {};
  const d = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data
    : root;
  if (d.response && typeof d.response === "object" && !Array.isArray(d.response)) return d.response;
  if (d.data && typeof d.data === "object" && !Array.isArray(d.data) && d.data.response) return d.data.response;
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

// 宿主任务 -> New API Suno 任务对象（单查询与批量查询复用同一个渲染，保证两种查询形状一致）
function nativeTaskView(task) {
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
  return out;
}

// 分派依据是动作语义本身，不是客户端路径；driver hook 仍只消费 requestBody
function submitActionName(ctx) {
  const params = (ctx && ctx.params) || {};
  return String(params.action || ctx.action || "").trim().toUpperCase();
}

export const native = {
  // POST /suno/submit/:action
  submitAction(ctx) {
    const action = submitActionName(ctx);
    if (action === "MUSIC") return decodeSubmitMusic(ctx);
    if (action === "LYRICS") return decodeSubmitLyrics(ctx);
    if (action === "CONCAT") return decodeSubmitConcat(ctx);
    throw new Error("action must be one of music, lyrics, concat");
  },
  // 具名入口保留，便于复用与回归测试
  submitMusic: decodeSubmitMusic,
  submitLyrics: decodeSubmitLyrics,
  submitConcat: decodeSubmitConcat,

  // POST /suno/fetch（dynamic）：只声明要查询的公开任务 ID，宿主校验归属后交给 fetchTasks
  fetchBatch(ctx) {
    const req = requireJSONObject(ctx);
    const ids = req.ids;
    if (!Array.isArray(ids)) throw new Error("ids must be an array of task ids");
    const taskIds = [];
    for (const id of ids) {
      const value = trimmed(id);
      if (value) taskIds.push(value);
    }
    if (!taskIds.length) throw new Error("ids must contain at least one task id");
    const action = trimmed(req.action).toUpperCase();
    if (action && action !== "MUSIC" && action !== "LYRICS") throw new Error("action must be MUSIC or LYRICS");
    return { kind: "query", taskIds: taskIds };
  },

  // New API Suno 提交响应：{ code, message, data: <公开任务 ID 字符串> }
  submitted(_ctx, task) {
    return { code: "success", message: "", data: task.task_id };
  },

  // GET /suno/fetch/{task_id}：{ code, message, data: 任务对象 }
  fetchTask(_ctx, task) {
    return { code: "success", message: "", data: nativeTaskView(task) };
  },

  // POST /suno/fetch：{ code, message, data: 任务对象数组 }
  fetchTasks(_ctx, tasks) {
    const list = Array.isArray(tasks) ? tasks : tasks ? [tasks] : [];
    return { code: "success", message: "", data: list.map(nativeTaskView) };
  },
};
