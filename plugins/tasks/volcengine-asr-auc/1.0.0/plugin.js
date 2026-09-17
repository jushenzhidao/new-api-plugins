export const meta = {
  apiVersion: 1,
  key: "volcengine-asr-auc",
  name: "Volcengine Doubao Audio Recognition",
  icon: "AudioLines.Color",
  description: {
    en: "Volcengine Doubao recording-file ASR (volc.seedasr.auc / volc.bigasr.auc, api/v3/auc/bigmodel) with native isomorphic passthrough",
    zh: "火山引擎豆包录音文件识别标准版（volc.seedasr.auc / volc.bigasr.auc，api/v3/auc/bigmodel），原生同构直通",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10003],
  // The model version is carried by the X-Api-Resource-Id header. We expose the
  // two resource ids as model names so channel model_mapping selects the version.
  models: ["volc.seedasr.auc", "volc.bigasr.auc"],
  fetchMode: "per_task",
  usageSchema: {
    audio_seconds: {
      type: "number",
      unit: "second",
      description: {
        en: "Audio duration recognized, in seconds (rounded up).",
        zh: "识别的音频时长（秒，向上取整）。",
      },
    },
  },
  usageExamples: [
    { label: "Short clip", facts: { audio_seconds: 7 } },
    { label: "10 min call", facts: { audio_seconds: 600 } },
  ],
  routes: [
    {
      method: "POST",
      path: "/volc/auc/v3/submit",
      type: "submit",
      decode: "createASR",
      render: "createdASR",
    },
    {
      method: "GET",
      path: "/volc/auc/v3/query/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "queryASR",
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
  // The model version is a header (X-Api-Resource-Id), not a body field.
  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model));
  return model || "volc.seedasr.auc";
}

// Submit uses a freshly generated X-Api-Request-Id (which BECOMES the task id)
// plus the fixed X-Api-Sequence: -1.
function submitHeaders(ctx) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Api-Key": ctx.apiKey,
    "X-Api-Resource-Id": resourceId(ctx),
    "X-Api-Request-Id": genRequestId(),
    "X-Api-Sequence": "-1",
  };
}

// Query IDENTIFIES the task via X-Api-Request-Id == the persisted task id.
// This is the key difference from the TTS plugin, whose query carries the task
// id in the body. Here the id MUST be the header and MUST equal ctx.taskId.
function queryHeaders(ctx) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Api-Key": ctx.apiKey,
    "X-Api-Resource-Id": resourceId(ctx),
    "X-Api-Request-Id": trimmed(ctx.taskId),
  };
}

export const native = {
  createASR(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") {
      throw new Error("JSON body required");
    }
    const input = ctx.body.value;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("request body must be an object");
    }
    const model = trimmed(ctx.model || resourceId(ctx));
    if (!model) throw new Error("model is required");
    // Body shape: { user?, audio:{ url, format, ... }, request:{ model_name, ... } }.
    const audio = input.audio;
    if (!audio || typeof audio !== "object" || Array.isArray(audio)) {
      throw new Error("audio is required");
    }
    if (!trimmed(audio.url)) throw new Error("audio.url is required");
    const request = input.request;
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("request is required");
    }
    if (!trimmed(request.model_name)) {
      throw new Error("request.model_name is required");
    }
    return {
      kind: "submit",
      model: model,
      action: "audio_to_text",
      requestBody: adapterRequest("isomorphic", Object.assign({}, input)),
    };
  },
  createdASR(_ctx, task) {
    const saved = task.data && typeof task.data === "object" ? task.data : {};
    return Object.assign({}, saved, {
      id: task.task_id,
      task_id: task.task_id,
      status: hostStatusLabel(task.status),
    });
  },
  queryASR(_ctx, task) {
    const saved = task.data && typeof task.data === "object" ? task.data : {};
    return Object.assign({}, saved, {
      id: task.task_id,
      task_id: task.task_id,
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
    url: ctx.baseUrl + "/api/v3/auc/bigmodel/submit",
    method: "POST",
    headers: submitHeaders(ctx),
    body: body,
    action: "audio_to_text",
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

// Case-insensitive header lookup that tolerates both string and string[] values
// (parseSubmitResponse gets Record<string, string[]>, parseTaskResult gets
// Record<string, string>).
function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const wanted = String(name).toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === wanted) {
      const v = headers[keys[i]];
      if (Array.isArray(v)) return trimmed(v[0]);
      return trimmed(v);
    }
  }
  return "";
}

// The ASR API delivers the task status in the X-Api-Status-Code HTTP header.
// Success is 20000000 (NOT 0).
const SUCCESS_CODE = "20000000";
const IN_PROGRESS_CODE = "20000001"; // 正在处理中
const QUEUED_CODE = "20000002"; // 任务在队列中

// Read the status code from the response header first, then fall back to the
// body (the submit sample echoes X-Api-Status-Code inside the JSON body).
function statusCodeOf(headers, body) {
  return (
    headerValue(headers, "X-Api-Status-Code") ||
    trimmed(body && body["X-Api-Status-Code"]) ||
    trimmed(body && body.code)
  );
}

function messageOf(headers, body) {
  return (
    headerValue(headers, "X-Api-Message") ||
    trimmed(body && body["X-Api-Message"]) ||
    trimmed(body && body.message)
  );
}

export function parseSubmitResponse(_ctx, resp) {
  const headers = resp && resp.headers;
  const body = parseJSONBody(resp && resp.body);
  const code = statusCodeOf(headers, body);
  const message = messageOf(headers, body);
  if (code && code !== SUCCESS_CODE) {
    throw new Error(message || "volcengine asr submit failed: " + code);
  }
  // task_id is echoed in the submit body; fall back to the request id header
  // the vendor mirrors back (which equals the id we generated).
  const taskId =
    trimmed(body.task_id) || headerValue(headers, "X-Api-Request-Id");
  if (!taskId) throw new Error("missing task id");
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  // Query is POST with an EMPTY json body; the task id travels in the
  // X-Api-Request-Id header (set by queryHeaders).
  return {
    url: ctx.baseUrl + "/api/v3/auc/bigmodel/query",
    method: "POST",
    headers: queryHeaders(ctx),
    body: {},
  };
}

function resultText(body) {
  const result = body && body.result && typeof body.result === "object" ? body.result : {};
  return trimmed(result.text);
}

function codeReason(code, message) {
  if (message) return message;
  if (code === "20000003") return "silent audio (no speech detected)";
  if (/^45/.test(code)) return "invalid request or audio: " + code;
  return "volcengine asr task failed: " + code;
}

export function parseTaskResult(ctx, body, response) {
  body = parseJSONBody(body);
  // The 3rd arg carries the upstream {status, headers}; older host builds put
  // it on ctx.response. Support both so header status is always available.
  const headers =
    (response && response.headers) ||
    (ctx && ctx.response && ctx.response.headers) ||
    null;
  const httpStatus =
    (response && response.status) ||
    (ctx && ctx.response && ctx.response.status) ||
    0;
  const code = statusCodeOf(headers, body);
  const message = messageOf(headers, body);

  // Non-terminal task states (still processing / still queued).
  if (code === IN_PROGRESS_CODE) {
    return { code: 0, status: "IN_PROGRESS", progress: "50%" };
  }
  if (code === QUEUED_CODE) {
    return { code: 0, status: "QUEUED", progress: "0%" };
  }

  // Terminal success: the recognized text lives in body.result.text and is
  // surfaced to clients through the native query presenter (no media artifact).
  if (code === SUCCESS_CODE) {
    return { code: 0, status: "SUCCESS", progress: "100%" };
  }

  // Server-side codes (55xxxxxx / 550xxxx, e.g. 55000031 服务器繁忙) are
  // transient — throw so the host increments PollFailures and retries instead
  // of settling a terminal FAILURE prematurely.
  if (/^5/.test(code) || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    throw new Error(message || "volcengine asr query failed, retryable: " + code);
  }

  // Any other recognized code (20000003 silent, 45xxxxxx param/audio errors,
  // etc.) is a terminal failure with a clear reason.
  if (code) {
    return {
      code: code,
      status: "FAILURE",
      progress: "100%",
      reason: codeReason(code, message),
    };
  }

  // No status code available: fall back to the result field, then a safe
  // default. Never return UNKNOWN.
  if (resultText(body)) {
    return { code: 0, status: "SUCCESS", progress: "100%" };
  }
  return { code: 0, status: "QUEUED", progress: "0%" };
}

// Duration-based usage is only known once the task completes; the query result
// carries audio_info.duration (milliseconds).
function audioSeconds(source) {
  const t = source && typeof source === "object" ? source : {};
  const info = t.audio_info && typeof t.audio_info === "object" ? t.audio_info : {};
  let ms = Number(info.duration);
  if (!Number.isFinite(ms) || ms <= 0) {
    const result = t.result && typeof t.result === "object" ? t.result : {};
    const add = result.additions && typeof result.additions === "object" ? result.additions : {};
    ms = Number(add.duration);
  }
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 1000);
}

export function extractUsageOnComplete(_task, _result, data) {
  const seconds = audioSeconds(parseJSONBody(data));
  if (seconds > 0) return { audio_seconds: seconds };
  return {};
}
