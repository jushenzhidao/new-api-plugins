export const meta = {
  apiVersion: 1,
  key: "volcengine-tts-async",
  name: "Volcengine Doubao Async TTS",
  icon: "AudioLines.Color",
  description: {
    en: "Volcengine Doubao async long-text TTS (seed-tts-2.0 / seed-icl-2.0, api/v3/tts) with native isomorphic passthrough",
    zh: "火山引擎豆包异步长文本语音合成（seed-tts-2.0 / seed-icl-2.0，api/v3/tts），原生同构直通",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10002],
  models: ["seed-tts-2.0", "seed-icl-2.0"],
  fetchMode: "per_task",
  usageSchema: {
    text_characters: {
      type: "number",
      unit: "character",
      description: {
        en: "Characters consumed for synthesis (including punctuation).",
        zh: "合成消耗的字符数（含标点）。",
      },
    },
  },
  usageExamples: [
    { label: "Short text", facts: { text_characters: 9 } },
    { label: "Long text", facts: { text_characters: 5000 } },
  ],
  routes: [
    {
      method: "POST",
      path: "/volc/tts/v3/submit",
      type: "submit",
      decode: "createTTS",
      render: "createdTTS",
    },
    {
      method: "GET",
      path: "/volc/tts/v3/query/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "queryTTS",
    },
  ],
};

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function adapterRequest(mode, payload) {
  if (mode !== "isomorphic" && mode !== "heterogeneous") {
    throw new Error("invalid adapter mode");
  }
  return { adapterMode: mode, payload: payload };
}

function requireAdapterRequest(ctx) {
  const value = ctx && ctx.requestBody;
  if (
    !value ||
    (value.adapterMode !== "isomorphic" &&
      value.adapterMode !== "heterogeneous")
  ) {
    throw new Error("missing or invalid adapter mode");
  }
  return value;
}

// Sandbox is not guaranteed to expose crypto.randomUUID; build a v4-ish id.
function genRequestId() {
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += "-";
    const r = Math.floor(Math.random() * 16);
    if (i === 12) out += "4";
    else if (i === 16) out += ((r & 0x3) | 0x8).toString(16);
    else out += r.toString(16);
  }
  return out;
}

function resourceId(ctx) {
  // The model version is carried by the X-Api-Resource-Id header, not the body.
  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model));
  return model || "seed-tts-2.0";
}

function upstreamHeaders(ctx) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Api-Key": ctx.apiKey,
    "X-Api-Resource-Id": resourceId(ctx),
    "X-Api-Request-Id": genRequestId(),
  };
}

export const native = {
  createTTS(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") {
      throw new Error("JSON body required");
    }
    const input = ctx.body.value;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("request body must be an object");
    }
    const model = trimmed(ctx.model || resourceId(ctx));
    if (!model) throw new Error("model is required");
    // v3 body shape: { user?, unique_id?, req_params:{ text, speaker, ... } }.
    const reqParams = input.req_params;
    if (!reqParams || typeof reqParams !== "object" || Array.isArray(reqParams)) {
      throw new Error("req_params is required");
    }
    if (!trimmed(reqParams.text)) throw new Error("req_params.text is required");
    if (!trimmed(reqParams.speaker)) {
      throw new Error("req_params.speaker is required");
    }
    return {
      kind: "submit",
      model: model,
      action: "text_to_speech",
      requestBody: adapterRequest("isomorphic", Object.assign({}, input)),
    };
  },
  createdTTS(_ctx, task) {
    const saved = task.data && typeof task.data === "object" ? task.data : {};
    const inner = saved.data && typeof saved.data === "object" ? saved.data : {};
    return Object.assign({}, saved, {
      id: task.task_id || inner.task_id,
      status: hostStatusLabel(task.status),
    });
  },
  queryTTS(_ctx, task) {
    const saved = task.data && typeof task.data === "object" ? task.data : {};
    const inner = saved.data && typeof saved.data === "object" ? saved.data : {};
    return Object.assign({}, saved, {
      id: task.task_id || inner.task_id,
      task_id: task.task_id || inner.task_id,
      status: hostStatusLabel(task.status),
    });
  },
};

function hostStatusLabel(status) {
  if (status === "SUCCESS") return "succeeded";
  if (status === "FAILURE") return "failed";
  if (status === "IN_PROGRESS") return "processing";
  return "queued";
}

export function buildSubmitRequest(ctx) {
  const request = requireAdapterRequest(ctx);
  const payload = request.payload || {};
  // Isomorphic passthrough: preserve the vendor body verbatim; the model
  // version is a header (X-Api-Resource-Id), not a body field, so we do NOT
  // inject `model` into the body. Only strip New API internal control fields.
  const body = Object.assign({}, payload);
  delete body.new_api_internal;
  return {
    url: ctx.baseUrl + "/api/v3/tts/submit",
    method: "POST",
    headers: upstreamHeaders(ctx),
    body: body,
    action: "text_to_speech",
  };
}

function parseJSONBody(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) return body;
  if (typeof body !== "string") return {};
  try {
    return JSON.parse(body);
  } catch (_error) {
    return { message: body };
  }
}

// v3 success envelope code is 20000000 (NOT 0).
const SUCCESS_CODE = 20000000;

export function parseSubmitResponse(_ctx, resp) {
  const body = parseJSONBody(resp.body || {});
  if (body.code !== undefined && Number(body.code) !== SUCCESS_CODE) {
    throw new Error(body.message || "volcengine tts submit failed");
  }
  const data = body.data && typeof body.data === "object" ? body.data : {};
  const taskId = trimmed(data.task_id);
  if (!taskId) throw new Error("missing task id");
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  // v3 query is POST with a JSON body { task_id }, not a GET path param.
  return {
    url: ctx.baseUrl + "/api/v3/tts/query",
    method: "POST",
    headers: upstreamHeaders(ctx),
    body: { task_id: ctx.taskId },
  };
}

function validURL(value) {
  const url = trimmed(value);
  return /^https?:\/\//.test(url) ? url : "";
}

function resultURL(data) {
  const t = data || {};
  return validURL(t.audio_url) || validURL(t.url);
}

function hasFailureSignal(data) {
  const t = data || {};
  const err = t.error && typeof t.error === "object" ? t.error : {};
  return !!(
    trimmed(t.fail_reason) ||
    trimmed(t.err_msg) ||
    trimmed(err.message) ||
    trimmed(err.msg)
  );
}

function failureReason(data) {
  const t = data || {};
  const err = t.error && typeof t.error === "object" ? t.error : {};
  return (
    trimmed(t.fail_reason) ||
    trimmed(t.err_msg) ||
    trimmed(err.message) ||
    trimmed(err.msg) ||
    "volcengine tts task failed"
  );
}

// v3 does not publish a task_status enum table, and its numeric values are
// semantically DIFFERENT from the v1 small-model API (v1: 0-processing /
// 1-success / 2-failure; v3 observed: submit -> 1, done -> 2). We therefore
// treat the presence of a valid audio_url plus the envelope code as the
// authoritative success/failure signal, and use task_status only as a
// progress hint — never as a terminal decision.
function statusResult(data) {
  const t = data || {};
  const url = resultURL(t);
  if (url && !hasFailureSignal(t)) {
    return { status: "SUCCESS", progress: "100%", url: url };
  }
  if (hasFailureSignal(t)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(t) };
  }
  // No result yet, no failure signal: the async task is still being processed.
  return { status: "IN_PROGRESS", progress: "50%" };
}

export function parseTaskResult(ctx, body) {
  body = parseJSONBody(body);
  if (body.code !== undefined && Number(body.code) !== SUCCESS_CODE) {
    const httpStatus = ctx && ctx.response && ctx.response.status;
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
      throw new Error(body.message || "volcengine tts query failed, retryable");
    }
    return {
      code: body.code,
      status: "FAILURE",
      progress: "100%",
      reason: body.message || "volcengine tts task failed",
    };
  }
  const data = body.data && typeof body.data === "object" ? body.data : {};
  return Object.assign({ code: 0 }, statusResult(data));
}

function taskData(task) {
  const saved = task && task.data && typeof task.data === "object" ? task.data : {};
  // Persisted envelope may be { code, data:{...}, message }. Prefer inner data.
  if (saved.data && typeof saved.data === "object") return saved.data;
  return saved;
}

function audioMimeFromURL(url) {
  const u = trimmed(url).toLowerCase();
  if (u.indexOf(".wav") >= 0) return "audio/wav";
  if (u.indexOf(".ogg") >= 0 || u.indexOf("opus") >= 0) return "audio/ogg";
  if (u.indexOf(".pcm") >= 0) return "audio/L16";
  if (u.indexOf(".mp3") >= 0) return "audio/mpeg";
  return "audio/mpeg";
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  const data = taskData(task);
  const url = resultURL(data);
  if (!url) return [];
  return [
    {
      key: "audio",
      type: "audio",
      mimeType: audioMimeFromURL(url),
    },
  ];
}

export function buildContentRequest(ctx) {
  const data = ctx && ctx.data && typeof ctx.data === "object" ? ctx.data : {};
  const inner = data.data && typeof data.data === "object" ? data.data : data;
  const url = validURL(ctx && ctx.url) || resultURL(inner);
  if (!url) throw new Error("artifact_not_found");
  return {
    url: url,
    method: ctx.clientRequest.method,
    // Signed CDN URL (bytespeech.com) must not carry the channel Authorization.
    credentialless: true,
  };
}

export function extractUsage(ctx) {
  // Prefer the actual synthesized length from the query result; fall back to
  // the requested text length; both are reported by the vendor.
  const result = ctx && ctx.result && typeof ctx.result === "object" ? ctx.result : {};
  const data = result.data && typeof result.data === "object" ? result.data : result;
  const synth = Number(data.synthesize_text_length);
  if (Number.isFinite(synth) && synth > 0) return { text_characters: synth };
  const reqLen = Number(data.req_text_length);
  if (Number.isFinite(reqLen) && reqLen > 0) return { text_characters: reqLen };
  return {};
}
