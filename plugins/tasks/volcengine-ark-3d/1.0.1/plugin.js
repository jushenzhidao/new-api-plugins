export const meta = {
  apiVersion: 1,
  key: "volcengine-ark-3d",
  name: "Volcengine Ark 3D",
  icon: "Cube.Color",
  description: {
    en: "Volcengine Ark 3D generation (Seed3D, Hyper3D-Gen2, HiTem3D) with native isomorphic passthrough",
    zh: "火山引擎方舟 3D 生成（Seed3D、Hyper3D-Gen2、数美 3D），原生同构直通",
  },
  version: "1.0.1",
  author: { name: "Jushenzhidao" },
  channelTypes: [10001],
  models: [
    "doubao-seed3d-2-0-260328",
    "hyper3d-gen2-260112",
    "hitem3d-2-0-251223",
  ],
  fetchMode: "per_task",
  usageSchema: {
    output_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Output tokens consumed.", zh: "消耗的输出 token 数量。" },
    },
  },
  usageExamples: [
    { label: "Seed3D 1x", facts: { output_tokens: 1 } },
    { label: "Hyper3D 1x", facts: { output_tokens: 30000 } },
    { label: "HiTem3D 1x", facts: { output_tokens: 1 } },
  ],
  routes: [
    {
      method: "POST",
      path: "/volcengine/3d/api/v3/contents/generations/tasks",
      type: "submit",
      decode: "create3D",
      render: "created3D",
    },
    {
      method: "GET",
      path: "/volcengine/3d/api/v3/contents/generations/tasks/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "query3D",
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

export const native = {
  create3D(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") {
      throw new Error("JSON body required");
    }
    const input = ctx.body.value;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("request body must be an object");
    }
    const model = trimmed(input.model || ctx.model);
    if (!model) throw new Error("model is required");
    if (
      !meta.models.includes(model) &&
      model !== "doubao-seed3d" &&
      model !== "doubao-seed3d-2-0" &&
      model !== "hyper3d-gen2" &&
      model !== "hitem3d-2-0"
    ) {
      throw new Error("unsupported Ark 3D model: " + model);
    }
    return {
      kind: "submit",
      model: model,
      action: "image_to_3d",
      requestBody: adapterRequest("isomorphic", Object.assign({}, input)),
    };
  },
  created3D(_ctx, task) {
    const data =
      task.data && typeof task.data === "object" ? task.data : {};
    return Object.assign({}, data, {
      id: task.task_id || data.id,
      status:
        task.status === "SUCCESS"
          ? "succeeded"
          : task.status === "FAILURE"
          ? "failed"
          : task.status === "IN_PROGRESS"
          ? "processing"
          : "queued",
    });
  },
  query3D(_ctx, task) {
    const data =
      task.data && typeof task.data === "object" ? task.data : {};
    return Object.assign({}, data, {
      id: task.task_id || data.id,
      task_id: task.task_id || data.task_id,
      status:
        task.status === "SUCCESS"
          ? "succeeded"
          : task.status === "FAILURE"
          ? "failed"
          : task.status === "IN_PROGRESS"
          ? "processing"
          : "queued",
    });
  },
};

export function buildSubmitRequest(ctx) {
  const request = requireAdapterRequest(ctx);
  const payload = request.payload || {};
  const body = Object.assign({}, payload);
  const upstreamModel = ctx.upstreamModel || ctx.model;
  if (upstreamModel) body.model = upstreamModel;
  delete body.new_api_internal;
  return {
    url: ctx.baseUrl + "/api/v3/contents/generations/tasks",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
    body: body,
    action: "image_to_3d",
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

export function parseSubmitResponse(_ctx, resp) {
  const body = parseJSONBody(resp.body || {});
  if (body.code !== undefined && Number(body.code) !== 0) {
    throw new Error(body.message || "ark 3d submit failed");
  }
  const taskId = trimmed(body.id);
  if (!taskId) throw new Error("missing task id");
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url:
      ctx.baseUrl +
      "/api/v3/contents/generations/tasks/" +
      encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
  };
}

const STATUS_TABLE = {
  QUEUED: ["not_start", "submitted", "queued", "pending", "waiting"],
  IN_PROGRESS: [
    "preparing",
    "queueing",
    "processing",
    "in_progress",
    "running",
    "generating",
    "rendering",
  ],
  SUCCESS: [
    "success",
    "succeed",
    "succeeded",
    "completed",
    "complete",
    "done",
    "finished",
  ],
  FAILURE: [
    "fail",
    "failed",
    "failure",
    "cancelled",
    "canceled",
    "expired",
    "timeout",
    "rejected",
    "error",
  ],
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

function normalizeStatus(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, "_");
}

function validURL(value) {
  const url = trimmed(value);
  return /^https?:\/\//.test(url) ? url : "";
}

function resultURL(task) {
  const t = task || {};
  const content = t.content && typeof t.content === "object" ? t.content : {};
  const candidates = [
    t.url,
    t.result_url,
    t.output_url,
    content.url,
    content.result_url,
  ];
  if (Array.isArray(content.parts)) {
    content.parts.forEach(function (part) {
      if (part && typeof part === "object") {
        candidates.push(part.url, part.content_url, part.file_url);
      }
    });
  }
  return (
    candidates
      .map(trimmed)
      .filter(function (u) {
        return /^https?:\/\//.test(u);
      })[0] || ""
  );
}

function hasFailureSignal(task) {
  const t = task || {};
  const err = t.error && typeof t.error === "object" ? t.error : {};
  return !!(
    trimmed(t.fail_reason) ||
    trimmed(t.err_msg) ||
    trimmed(err.message) ||
    trimmed(err.msg)
  );
}

function failureReason(task) {
  const t = task || {};
  const err = t.error && typeof t.error === "object" ? t.error : {};
  return (
    trimmed(t.fail_reason) ||
    trimmed(t.err_msg) ||
    trimmed(err.message) ||
    trimmed(err.msg) ||
    "ark 3d task failed"
  );
}

function statusResult(task) {
  const t = task || {};
  const raw = normalizeStatus(t.status || t.task_status);
  const declared = STATUS_MAP[raw];
  if (declared === "SUCCESS") {
    return { status: "SUCCESS", progress: "100%", url: resultURL(t) };
  }
  if (declared === "FAILURE") {
    return { status: "FAILURE", progress: "100%", reason: failureReason(t) };
  }
  if (declared) {
    return {
      status: declared,
      progress: declared === "IN_PROGRESS" ? "50%" : "0%",
    };
  }
  if (PREFIX.SUCCESS.some(function (p) { return raw.indexOf(p) === 0; })) {
    return { status: "SUCCESS", progress: "100%", url: resultURL(t) };
  }
  if (PREFIX.FAILURE.some(function (p) { return raw.indexOf(p) === 0; })) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(t) };
  }
  if (PREFIX.IN_PROGRESS.some(function (p) { return raw.indexOf(p) === 0; })) {
    return { status: "IN_PROGRESS", progress: "50%" };
  }
  if (PREFIX.QUEUED.some(function (p) { return raw.indexOf(p) === 0; })) {
    return { status: "QUEUED", progress: "0%" };
  }
  const url = resultURL(t);
  if (url && !hasFailureSignal(t)) {
    return { status: "SUCCESS", progress: "100%", url: url };
  }
  if (hasFailureSignal(t)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(t) };
  }
  return { status: "QUEUED", progress: "0%" };
}

export function parseTaskResult(_ctx, body) {
  body = parseJSONBody(body);
  if (body && body.code !== undefined && Number(body.code) !== 0) {
    const httpStatus = _ctx && _ctx.response && _ctx.response.status;
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
      throw new Error(body.message || "ark 3d request failed, retryable");
    }
    return {
      code: body.code,
      status: "FAILURE",
      progress: "100%",
      reason: body.message || "ark 3d task failed",
    };
  }
  return Object.assign({ code: 0 }, statusResult(body));
}

function urlFieldType(key) {
  const name = trimmed(key).toLowerCase();
  if (name.indexOf("file") >= 0 || name.indexOf("3d") >= 0) return "file";
  if (name === "url" || name.indexOf("content_url") >= 0) return "file";
  return "";
}

function scalarArtifact(item, hint) {
  if (typeof item === "string") {
    const url = validURL(item);
    const type = urlFieldType(hint);
    return url && type ? { type: type, mimeType: "", url: url } : null;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const url = validURL(
    item.url || item.content_url || item.file_url || item.file
  );
  // Ark 3D only emits 3D model files, so a valid URL without an explicit
  // type is always a file artifact.
  const type =
    trimmed(item.type) || urlFieldType(hint) || (url ? "file" : "");
  return url ? { key: trimmed(item.key), type: type, mimeType: trimmed(item.mime_type || item.mimeType), url: url } : null;
}

function artifactCandidates(data) {
  const root = data && typeof data === "object" ? data : {};
  const found = [];
  const visited = [];
  function walk(value, hint, depth) {
    if (depth > 8 || value === null || value === undefined) return;
    const isContainer =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !trimmed(value.type) &&
      !trimmed(hint) &&
      !validURL(
        value.url ||
          value.content_url ||
          value.file_url ||
          value.file
      );
    const direct = isContainer ? null : scalarArtifact(value, hint);
    if (direct) found.push(direct);
    if (typeof value !== "object") return;
    if (visited.indexOf(value) >= 0) return;
    visited.push(value);
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        walk(item, hint, depth + 1);
      });
      return;
    }
    Object.keys(value).forEach(function (key) {
      const child = value[key];
      const keyType = urlFieldType(key);
      if (keyType && typeof child === "string") walk(child, key, depth + 1);
      else if (keyType && child && typeof child === "object")
        walk(child, key, depth + 1);
      else if (
        key === "outputs" ||
        key === "output" ||
        key === "files" ||
        key === "artifacts" ||
        key === "data" ||
        key === "result" ||
        key === "content" ||
        key === "parts"
      )
        walk(child, hint, depth + 1);
    });
  }
  walk(root, "", 0);
  return found;
}

function artifactList(data) {
  const found = artifactCandidates(data);
  const counts = {};
  const urls = {};
  return found
    .filter(function (item) {
      if (urls[item.url]) return false;
      urls[item.url] = true;
      return true;
    })
    .map(function (item) {
      const base = item.key || item.type;
      counts[base] = (counts[base] || 0) + 1;
      const key = counts[base] === 1 ? base : base + "_" + counts[base];
      return Object.assign({}, item, { key: key });
    });
}

function findArtifact(data, key) {
  const wanted = trimmed(key).toLowerCase();
  return (
    artifactList(data).find(function (item) {
      return item.key.toLowerCase() === wanted || item.type === wanted;
    }) || null
  );
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  const data = task.data && typeof task.data === "object" ? task.data : {};
  return artifactList(data).map(function (item) {
    return {
      key: item.key,
      type: item.type,
      mimeType:
        item.mimeType ||
        (item.type === "file" ? "model/gltf-binary" : "application/octet-stream"),
    };
  });
}

export function buildContentRequest(ctx) {
  const key = trimmed(ctx && ctx.artifactKey).toLowerCase();
  const data = ctx && ctx.data && typeof ctx.data === "object" ? ctx.data : {};
  const artifact = findArtifact(data, key);
  const url =
    validURL(ctx && ctx.url) ||
    (artifact && artifact.url) ||
    (key === "file" ? resultURL(data) : "");
  if (!url) throw new Error("artifact_not_found");
  return {
    url: url,
    method: ctx.clientRequest.method,
    credentialless: true,
  };
}

export function extractUsage(ctx) {
  const req = ctx.requestBody && ctx.requestBody.payload || {};
  const model = trimmed(ctx.upstreamModel || ctx.model || req.model);
  if (model === "hyper3d-gen2-260112" || model === "hyper3d-gen2") {
    return { output_tokens: 30000 };
  }
  return { output_tokens: 1 };
}
