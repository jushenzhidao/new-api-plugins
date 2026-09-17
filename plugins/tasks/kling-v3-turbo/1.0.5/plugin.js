export const meta = {
  apiVersion: 1,
  key: "kling-v3",
  name: "Kling Video 3",
  icon: "Kling.Color",
  description: {
    en: "Convert TokenHub Kling V3 image/video requests to the native Kling API format",
    zh: "将 TokenHub Kling V3 文/图/视频请求转换为官方原生格式",
  },
  version: "1.0.5",
  author: { name: "Jushenzhidao" },
  channelTypes: [10000],
  models: ["kling-video-v3", "kling-video-v3-omni", "kling-video-v3-turbo"],
  fetchMode: "per_task",
  usageSchema: {
    seconds: { type: "number", unit: "second", description: { en: "Video duration in seconds.", zh: "视频时长，单位为秒。" } },
    resolution: { enum: ["720p", "1080p"], description: { en: "Output resolution.", zh: "输出分辨率。" } },
    input_images: { type: "number", unit: "count", description: { en: "Number of input images.", zh: "输入图片数量。" } },
  },
  usageExamples: [
    { label: "720p 5s", facts: { seconds: 5, resolution: "720p", input_images: 1 } },
    { label: "1080p 10s", facts: { seconds: 10, resolution: "1080p", input_images: 1 } },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
  routes: [
    { method: "POST", path: "/kling/text-to-video/kling-3.0", type: "submit", decode: "createVideo", render: "createdVideo" },
    { method: "POST", path: "/kling/image-to-video/kling-3.0", type: "submit", decode: "createVideo", render: "createdVideo" },
    { method: "POST", path: "/kling/image-to-video/kling-3.0-turbo", type: "submit", decode: "createVideo", render: "createdVideo" },
    { method: "POST", path: "/kling/image-to-video/kling-3.0-omni", type: "submit", decode: "createVideo", render: "createdVideo" },
    { method: "GET", path: "/kling/tasks/:external_task_ids", type: "query", taskIdParam: "external_task_ids", render: "queryVideo" },
  ],
};

const DEFAULT_DURATION = 5;
const MODEL_MAP = {
  "kling-video-v3": "kling-v3",
  "kling-video-v3-omni": "kling-v3-omni",
  "kling-video-v3-turbo": "kling-v3-turbo",
};
const MODELS = Object.keys(MODEL_MAP);
const MIN_DURATION = 3;
const MAX_DURATION = 15;

function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function metadataOf(req) {
  return req && req.metadata && typeof req.metadata === "object" && !Array.isArray(req.metadata) ? req.metadata : {};
}

function contentItems(req) {
  const contents = req && Array.isArray(req.contents) ? req.contents : [];
  const meta = metadataOf(req);
  const prompt = contents.find(function (item) { return item && item.type === "prompt"; });
  const first = contents.find(function (item) { return item && item.type === "first_frame"; });
  const last = contents.find(function (item) { return item && item.type === "last_frame"; });
  return {
    prompt: text(prompt && prompt.text) || text(req && req.prompt) || text(meta.prompt),
    first: text(first && first.url) || text(req && req.image) || text(meta.first_frame_image),
    last: text(last && last.url) || text(req && req.image_tail) || text(meta.last_frame_image),
  };
}

function duration(req) {
  const raw = req && req.settings && req.settings.duration !== undefined ? req.settings.duration : req && req.duration;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_DURATION;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_DURATION || value > MAX_DURATION) throw new Error("kling-video-v3-turbo duration must be an integer between 3 and 15 seconds");
  return value;
}

function resolution(req) {
  const settings = req && req.settings || {};
  const raw = text(settings.resolution) || text(req && req.resolution) || text(req && req.size) || "720p";
  const value = raw.toLowerCase().replace("p", "");
  if (value === "720") return "720p";
  if (value === "1080") return "1080p";
  if (value === "4k" || value === "4096") {
    if (text(req && req.model) === "kling-video-v3-turbo") throw new Error("kling-video-v3-turbo does not support 4k");
    return "4k";
  }
  throw new Error("Kling resolution must be 720p, 1080p, or 4k");
}

function nativeBody(req) {
  const model = text(req && req.model) || "kling-video-v3-turbo";
  if (!MODEL_MAP[model] && !Object.values(MODEL_MAP).includes(model)) throw new Error("unsupported Kling model: " + model);
  const canonicalModel = MODEL_MAP[model] ? model : Object.keys(MODEL_MAP).find(function (key) { return MODEL_MAP[key] === model; });
  const settings = Object.assign({}, req && req.settings || {});
  const options = Object.assign({}, req && req.options || {});
  const contents = Array.isArray(req && req.contents) ? req.contents.slice() : [];
  const prompt = text(req && req.prompt);
  if (prompt && !contents.some(function (item) { return item && item.type === "prompt"; })) contents.unshift({ type: "prompt", text: prompt });
  if (!contents.some(function (item) { return item && item.type === "prompt"; }) && canonicalModel !== "kling-video-v3-omni") throw new Error("Kling request requires a prompt");
  const first = text(req && req.image) || text((req && req.metadata || {}).first_frame_image);
  if (first && !contents.some(function (item) { return item && item.type === "first_frame"; })) contents.push({ type: "first_frame", url: first });
  const last = text(req && req.image_tail) || text((req && req.metadata || {}).last_frame_image);
  if (last && !contents.some(function (item) { return item && item.type === "last_frame"; })) contents.push({ type: "last_frame", url: last });
  const durationValue = req && req.duration !== undefined ? req.duration : settings.duration;
  if (durationValue !== undefined) settings.duration = Number(durationValue);
  if (settings.resolution === undefined && req && req.resolution !== undefined) settings.resolution = req.resolution;
  if (settings.resolution === undefined) settings.resolution = "720p";
  if (canonicalModel === "kling-video-v3-turbo") {
    if (contents.some(function (item) { return item && item.type === "last_frame"; })) throw new Error("kling-video-v3-turbo does not support last_frame");
    delete settings.audio;
    delete settings.multi_shot;
  }
  return { model: canonicalModel, contents: contents, settings: settings, options: options };
}

export function buildSubmitRequest(ctx) {
  const incoming = ctx.requestBody || {};
  const requestBody = Object.assign({}, incoming);
  if (!text(requestBody.model) && text(ctx.upstreamModel)) requestBody.model = text(ctx.upstreamModel);
  if (!text(requestBody.model) && text(ctx.model)) requestBody.model = text(ctx.model);
  const nativeBodyValue = nativeBody(requestBody);
  const model = text(ctx.upstreamModel) || text(requestBody.model) || "kling-video-v3-turbo";
  const hasVideo = Array.isArray(nativeBodyValue.contents) && nativeBodyValue.contents.some(function (item) { return item && (item.type === "video" || item.type === "reference_video"); });
  const hasImage = Array.isArray(nativeBodyValue.contents) && nativeBodyValue.contents.some(function (item) { return item && (item.type === "first_frame" || item.type === "last_frame"); });
  const endpoint = hasVideo ? "video-to-video/kling-3.0-omni" : hasImage ? (model === "kling-video-v3-turbo" ? "image-to-video/kling-3.0-turbo" : model === "kling-video-v3-omni" ? "image-to-video/kling-3.0-omni" : "image-to-video/kling-3.0") : "text-to-video/kling-3.0";
  return {
    url: ctx.baseUrl + "/v1/wand/kling/" + (hasImage ? "image-to-video" : "text-to-video"),
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: nativeBodyValue,
    action: hasVideo ? "video_to_video" : hasImage ? "image_to_video" : "text_to_video",
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = parseJSONBody(resp.body || {});
  if (body.code !== undefined && Number(body.code) !== 0) throw new Error(body.message || "kling submit failed");
  const taskId = text(body.data && (body.data.task_id || body.data.id)) || text(body.task_id);
  if (!taskId) throw new Error("missing task_id");
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/wand/kling/tasks/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

function parseJSONBody(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) return body;
  if (typeof body !== "string") return {};
  try { return JSON.parse(body); } catch (_error) { return { message: body }; }
}

function queryData(body) {
  body = parseJSONBody(body);
  if (Array.isArray(body && body.data)) return body.data[0] || {};
  return body && body.data && typeof body.data === "object" ? body.data : body || {};
}

function outputURL(data) {
  const outputs = Array.isArray(data && data.outputs) ? data.outputs : [];
  const candidates = [data && data.video_url, data && data.url, data && data.videoUrl, data && data.output_url].concat(outputs.map(function (item) { return item && (item.url || item.video_url); }));
  if (Array.isArray(data.videos) && data.videos[0]) candidates.push(data.videos[0].url || data.videos[0].video_url);
  if (Array.isArray(data.output) && data.output[0]) candidates.push(data.output[0].url || data.output[0].video_url);
  return candidates.map(text).find(Boolean) || "";
}

export function parseTaskResult(_ctx, body) {
  body = parseJSONBody(body);
  if (body && body.code !== undefined && Number(body.code) !== 0) return { code: body.code, status: "FAILURE", progress: "100%", reason: body.message || "kling task failed" };
  const data = queryData(body);
  const raw = text(data.task_status || data.status).toLowerCase();
  const videoUrl = outputURL(data);
  if (["succeed", "success", "succeeded", "completed"].includes(raw)) return { code: 0, status: "SUCCESS", progress: "100%", url: videoUrl };
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(raw)) return { code: 0, status: "FAILURE", progress: "100%", reason: text(data.fail_reason || data.message) || "kling task failed" };
  if (["processing", "running", "in_progress"].includes(raw)) return { code: 0, status: "IN_PROGRESS", progress: "50%" };
  return { code: 0, status: "QUEUED", progress: "0%" };
}

export function extractUsage(ctx) {
  const req = ctx.requestBody || {};
  return { seconds: duration(req), resolution: resolution(req), input_images: 1 };
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" && task.url ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video" || !ctx.url) throw new Error("artifact_not_found");
  return { url: ctx.url, method: ctx.clientRequest.method, credentialless: true };
}

export const protocols = {
  openai_responses: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      if (text(req.model_name)) {
        const nativeModel = text(req.model_name);
        if (!Object.values(MODEL_MAP).includes(nativeModel)) throw new Error("unsupported native Kling model_name: " + nativeModel);
        const requestBody = Object.assign({}, req, { model: Object.keys(MODEL_MAP).find(function (key) { return MODEL_MAP[key] === nativeModel; }) });
        return { kind: "submit", model: requestBody.model, action: req.video ? "video_to_video" : req.image ? "image_to_video" : "text_to_video", requestBody: requestBody };
      }
      const model = text(req.model) || text(ctx.upstreamModel) || text(ctx.model) || "kling-video-v3-turbo";
      if (!MODELS.includes(model)) throw new Error("unsupported Kling model: " + model);
      const prompts = [];
      const images = [];
      const input = req.input;
      if (typeof input === "string") prompts.push(input);
      else if (Array.isArray(input)) input.forEach(function (item) {
        if (typeof item === "string") prompts.push(item);
        else if (item && typeof item === "object") {
          if (typeof item.text === "string") prompts.push(item.text);
          const image = item.image_url && typeof item.image_url === "object" ? item.image_url.url : item.image_url;
          if (text(image)) images.push(text(image));
        }
      });
      if (text(req.prompt)) prompts.push(req.prompt);
      if (text(req.image)) images.unshift(text(req.image));
      if (Array.isArray(req.images)) req.images.forEach(function (image) { if (text(image)) images.push(text(image)); });
      const metadata = Object.assign({}, req.metadata || {});
      const requestBody = { model: model, prompt: prompts.map(text).filter(Boolean).join("\\n"), metadata: metadata };
      if (images.length) {
        requestBody.contents = [{ type: "first_frame", url: images[0] }];
        if (requestBody.prompt) requestBody.contents.unshift({ type: "prompt", text: requestBody.prompt });
      }
      if (req.duration !== undefined) requestBody.duration = req.duration;
      if (req.seconds !== undefined) requestBody.duration = req.seconds;
      if (req.resolution !== undefined) requestBody.resolution = req.resolution;
      return { kind: "submit", model: model, action: images.length ? "image_to_video" : "text_to_video", requestBody: requestBody };
    },
    renderEvents(ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      if (status === "SUCCESS") {
        if (previousState && previousState.status === status) return { events: [], state: { status: status, progress: 100 }, done: true };
        return { events: [{ type: "output", data: '<video controls src="' + text(task.url) + '"></video>' }], state: { status: status, progress: 100 }, done: true };
      }
      if (status === "FAILURE") return { events: [{ type: "error", code: "task_failed", message: task.reason || "task failed" }], state: { status: status, progress: 100 }, done: true };
      return { events: [{ type: "progress", message: status.toLowerCase(), progress: status === "IN_PROGRESS" ? 50 : 0 }], state: { status: status, progress: status === "IN_PROGRESS" ? 50 : 0 }, done: false };
    },
    renderFinal(ctx, task) {
      return { output: [{ type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: '<video controls src="' + text(task.url) + '"></video>', annotations: [], logprobs: [] }] }], metadata: { vendor: "kling" } };
    },
  },
  openai_video: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      return { kind: "submit", model: req.model || ctx.upstreamModel || ctx.model || "kling-video-v3-turbo", action: req.image || req.input_reference ? "image_to_video" : "text_to_video", requestBody: req };
    },
    render(ctx, task) { return { id: task.task_id, object: "video", model: task.model || "", status: task.status === "SUCCESS" ? "completed" : task.status === "FAILURE" ? "failed" : "in_progress", progress: Number(String(task.progress || "0").replace("%", "")), url: task.url, error: task.reason ? { message: task.reason } : undefined }; },
  },
};
export const native = {
  createVideo(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const req = ctx.body.value;
    if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
    const model = text(req.model) || text(req.model_name) || text(ctx.upstreamModel) || text(ctx.model) || "kling-video-v3-turbo";
    if (!MODELS.includes(model) && !Object.values(MODEL_MAP).includes(model)) throw new Error("unsupported Kling model: " + model);
    const requestBody = Object.assign({}, req, { model: model });
    const convertedModel = Object.values(MODEL_MAP).includes(model) ? model : model;
    if (convertedModel === "kling-v3" || convertedModel === "kling-v3-omni" || convertedModel === "kling-v3-turbo") requestBody.model_name = convertedModel;
    return { kind: "submit", model: model, action: requestBody.video ? "video_to_video" : requestBody.image ? "image_to_video" : "text_to_video", requestBody: requestBody };
  },
  createdVideo(_ctx, task) {
    const data = task.data && typeof task.data === "object" ? task.data : {};
    const result = task.status === "SUCCESS" ? data : {};
    return Object.assign({}, data, { id: task.task_id || data.id, status: task.status === "SUCCESS" ? "succeeded" : task.status === "FAILURE" ? "failed" : "processing", url: task.url || outputURL(result) });
  },
  queryVideo(_ctx, task) {
    const data = task.data && typeof task.data === "object" ? task.data : {};
    return { id: task.task_id || data.id, status: task.status === "SUCCESS" ? "succeeded" : task.status === "FAILURE" ? "failed" : "processing", url: task.url || outputURL(data), error: task.fail_reason ? { message: task.fail_reason } : undefined };
  },
};
