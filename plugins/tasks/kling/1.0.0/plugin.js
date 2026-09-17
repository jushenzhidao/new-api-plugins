export const meta = {
  apiVersion: 1,
  key: "kling",
  name: "Kling Video",
  icon: "Kling.Color",
  description: {
    en: "Tencent Cloud TokenHub Kling video generation: V3, V3-omni, V3-turbo, O1, V2.6 and V2.5-turbo",
    zh: "腾讯云 TokenHub 可灵视频生成：V3、V3-omni、V3-turbo、O1、V2.6、V2.5-turbo",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10008],
  models: [
    "kling-video-v3",
    "kling-video-v3-omni",
    "kling-video-v3-turbo",
    "kling-video-o1",
    "kling-video-v2.6",
    "kling-video-v2.5-turbo",
  ],
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: {
        en: "Requested video duration in seconds.",
        zh: "请求的视频时长，单位为秒。",
      },
    },
    resolution: {
      enum: ["720p", "1080p", "4k"],
      description: {
        en: "Requested output resolution. 4k is only available on kling-video-v3 and kling-video-v3-omni.",
        zh: "请求的输出分辨率。4k 仅 kling-video-v3 与 kling-video-v3-omni 支持。",
      },
    },
    input_images: {
      type: "number",
      unit: "count",
      description: {
        en: "Number of input images (first_frame, last_frame, refer_image).",
        zh: "输入图片数量（first_frame、last_frame、refer_image）。",
      },
    },
    input_videos: {
      type: "number",
      unit: "count",
      description: {
        en: "Number of input videos (feature_video, base_video).",
        zh: "输入视频数量（feature_video、base_video）。",
      },
    },
    tokens: {
      type: "number",
      unit: "token",
      description: {
        en: "Tokens reported by the vendor after completion (tokenhub_usage.total_tokens). Reported as 0 at submit and replaced with the real value once the task succeeds.",
        zh: "任务完成后厂商返回的 token 消耗（tokenhub_usage.total_tokens）。提交期为 0，成功后回填真实值。",
      },
    },
  },
  // 宿主要求每条示例的事实集覆盖 usageSchema 的全部键，tokens 在提交期恒为 0。
  usageExamples: [
    { label: "V3 720p 5s", facts: { seconds: 5, resolution: "720p", input_images: 0, input_videos: 0, tokens: 0 } },
    { label: "V3 1080p 10s 图生", facts: { seconds: 10, resolution: "1080p", input_images: 1, input_videos: 0, tokens: 0 } },
    { label: "V3 4k 10s 首尾帧", facts: { seconds: 10, resolution: "4k", input_images: 2, input_videos: 0, tokens: 0 } },
    { label: "V3-turbo 720p 5s 图生", facts: { seconds: 5, resolution: "720p", input_images: 1, input_videos: 0, tokens: 0 } },
    { label: "V3-omni 1080p 5s 视频编辑", facts: { seconds: 5, resolution: "1080p", input_images: 0, input_videos: 1, tokens: 0 } },
    { label: "O1 720p 10s", facts: { seconds: 10, resolution: "720p", input_images: 0, input_videos: 0, tokens: 0 } },
    { label: "V2.6 1080p 10s", facts: { seconds: 10, resolution: "1080p", input_images: 0, input_videos: 0, tokens: 0 } },
    { label: "V2.5-turbo 720p 5s 图生", facts: { seconds: 5, resolution: "720p", input_images: 1, input_videos: 0, tokens: 0 } },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
  routes: [
    { method: "POST", path: "/kling/text-to-video", type: "submit", decode: "createTextVideo", render: "createdVideo" },
    { method: "POST", path: "/kling/image-to-video", type: "submit", decode: "createImageVideo", render: "createdVideo" },
    { method: "POST", path: "/kling/omni-video", type: "submit", decode: "createOmniVideo", render: "createdVideo" },
    { method: "GET", path: "/kling/tasks/:task_id", type: "query", taskIdParam: "task_id", render: "queryVideo" },
  ],
};

// ---------------------------------------------------------------------------
// 结构化日志
//
// 插件跑在宿主 JS 沙箱里，console.log 是唯一可观测出口。宿主默认不转发插件
// 日志（仅 DEBUG=true 时收集），所以这里只记录关键跃迁，且全程 try/catch：
// 日志绝不能把插件主流程打挂。
// ---------------------------------------------------------------------------
var LOG_ENABLED = typeof console !== "undefined" && typeof console.log === "function";

function logStr(value, max) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return "[object]";
  return String(value).slice(0, max || 160);
}

function logEvent(event, data) {
  if (!LOG_ENABLED) return;
  var d = data || {};
  var line = "";
  try {
    line = JSON.stringify({
      ts: Date.now(),
      plugin: "kling",
      event: logStr(event, 48),
      model: logStr(d.model, 64),
      endpoint: logStr(d.endpoint, 32),
      taskId: logStr(d.taskId, 96),
      status: logStr(d.status, 24),
      rawStatus: logStr(d.rawStatus, 48),
      mode: logStr(d.mode, 24),
      key: logStr(d.key, 32),
      error: d.error ? logStr(d.error.message || d.error, 200) : "",
    });
  } catch (_err) {
    return;
  }
  try {
    console.log(line);
  } catch (_err) {}
}

// 轮询是热路径：同一 key 在冷却窗口内只打一次，避免日志被刷屏。
var logCooldown = {};
function shouldLog(key, cooldownMs) {
  var now = Date.now();
  var slot = "k:" + String(key);
  var last = Number(logCooldown[slot]) || 0;
  if (now - last < cooldownMs) return false;
  logCooldown[slot] = now;
  return true;
}

logEvent("plugin_loaded", {});

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------
function text(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(target, key) {
  return Boolean(target) && Object.prototype.hasOwnProperty.call(target, key);
}

function defined(value) {
  return value !== undefined && value !== null && value !== "";
}

// 图片/视频字段既可能是 URL 字符串、Base64 字符串，也可能是宿主待解析的
// 文件占位对象（{ __fileRef: ... }），对象必须原样透传。
function hasValue(value) {
  if (isObject(value)) return true;
  return text(value) !== "";
}

function firstDefined() {
  for (var i = 0; i < arguments.length; i += 1) {
    if (defined(arguments[i])) return arguments[i];
  }
  return undefined;
}

function firstValue() {
  for (var i = 0; i < arguments.length; i += 1) {
    if (hasValue(arguments[i])) return arguments[i];
  }
  return undefined;
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function filterValues(values) {
  var out = [];
  for (var i = 0; i < values.length; i += 1) {
    if (hasValue(values[i])) out.push(values[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 模型能力表（逐条对齐腾讯云 TokenHub Kling 调用指南）
// ---------------------------------------------------------------------------
var DEFAULT_DURATION = 5;
var DEFAULT_ASPECT_RATIO = "16:9";
var ASPECT_RATIOS = ["16:9", "9:16", "1:1"];
var IMAGE_CONTENT_TYPES = ["first_frame", "last_frame", "refer_image"];
var VIDEO_CONTENT_TYPES = ["feature_video", "base_video"];
var MAX_ELEMENTS = 3;
var MAX_VOICES = 2;
var MAX_REFER_WITHOUT_VIDEO = 7;
var MAX_REFER_WITH_VIDEO = 4;
var MAX_INPUT_FILE_BYTES = 52428800;

var OMNI_CONTENTS = [
  "prompt",
  "first_frame",
  "last_frame",
  "refer_image",
  "feature_video",
  "base_video",
  "element",
  "voice",
];

var CAPS = {
  "kling-video-v3": {
    endpoints: ["text-to-video", "image-to-video"],
    contents: ["prompt", "first_frame", "last_frame", "element"],
    minDuration: 3,
    maxDuration: 15,
    allowedDurations: null,
    resolutions: ["720p", "1080p", "4k"],
    audio: ["native", "off"],
    multiShot: true,
    promptLimit: 3072,
  },
  "kling-video-v3-turbo": {
    endpoints: ["text-to-video", "image-to-video"],
    contents: ["prompt", "first_frame"],
    minDuration: 3,
    maxDuration: 15,
    allowedDurations: null,
    resolutions: ["720p", "1080p"],
    audio: [],
    multiShot: false,
    promptLimit: 2500,
  },
  "kling-video-v3-omni": {
    endpoints: ["omni-video"],
    contents: OMNI_CONTENTS,
    minDuration: 3,
    maxDuration: 15,
    allowedDurations: null,
    resolutions: ["720p", "1080p", "4k"],
    audio: ["native", "original", "off"],
    multiShot: true,
    promptLimit: 3072,
  },
  "kling-video-o1": {
    endpoints: ["omni-video"],
    contents: OMNI_CONTENTS,
    minDuration: 3,
    maxDuration: 10,
    allowedDurations: null,
    resolutions: ["720p", "1080p"],
    audio: ["original", "off"],
    multiShot: false,
    promptLimit: 2500,
  },
  "kling-video-v2.6": {
    endpoints: ["text-to-video", "image-to-video"],
    contents: ["prompt", "first_frame", "last_frame", "voice"],
    minDuration: 5,
    maxDuration: 10,
    allowedDurations: [5, 10],
    resolutions: ["720p", "1080p"],
    audio: ["native", "off"],
    multiShot: false,
    promptLimit: 2500,
  },
  "kling-video-v2.5-turbo": {
    endpoints: ["text-to-video", "image-to-video"],
    contents: ["prompt", "first_frame", "last_frame"],
    minDuration: 5,
    maxDuration: 10,
    allowedDurations: [5, 10],
    resolutions: ["720p", "1080p"],
    audio: [],
    multiShot: false,
    promptLimit: 2500,
  },
};

var MODELS = Object.keys(CAPS);

// 客户端可能沿用历史短名或大写名，统一收敛到厂商 model 取值。
var MODEL_ALIASES = {
  "kling-v3": "kling-video-v3",
  "kling-v3-omni": "kling-video-v3-omni",
  "kling-v3-turbo": "kling-video-v3-turbo",
  "kling-o1": "kling-video-o1",
  "kling-v2-6": "kling-video-v2.6",
  "kling-v2.5-turbo": "kling-video-v2.5-turbo",
};

function canonicalModel(value) {
  var raw = lower(value).replace(/\s+/g, "");
  if (!raw) throw new Error("kling: model is required");
  if (hasOwn(CAPS, raw)) return raw;
  if (hasOwn(MODEL_ALIASES, raw)) return MODEL_ALIASES[raw];
  throw new Error("kling: unsupported model " + text(value) + " (supported: " + MODELS.join(", ") + ")");
}

function capsOf(model) {
  return CAPS[canonicalModel(model)];
}

function supports(model, endpoint) {
  return capsOf(model).endpoints.indexOf(endpoint) >= 0;
}

// ---------------------------------------------------------------------------
// 规范模型与适配信封
// ---------------------------------------------------------------------------
function adapterRequest(mode, payload) {
  if (mode !== "isomorphic" && mode !== "heterogeneous") throw new Error("kling: invalid adapter mode");
  return { adapterMode: mode, payload: payload };
}

// 规范模型即厂商原生语义模型：model + endpoint + contents + settings + options。
// 同构入口直接透传原始 body，异构入口先归一到这个结构，两者共用同一个 encoder
// 与同一套校验（finalizeBody）。
function emptyCanonical(model, endpoint) {
  return {
    model: model,
    endpoint: endpoint || "",
    prompt: "",
    firstFrame: undefined,
    lastFrame: undefined,
    referImages: [],
    featureVideo: undefined,
    baseVideo: undefined,
    elements: [],
    voices: [],
    duration: undefined,
    resolution: undefined,
    aspectRatio: undefined,
    audio: undefined,
    multiShot: undefined,
    externalTaskId: undefined,
    watermarkInfo: undefined,
  };
}

// 只对通用入口出现的字段做判断：厂商原生形状是 model / contents / settings /
// options，通用形状则把素材摊平在 image、metadata、duration 等顶层字段上。
var GENERIC_ONLY_FIELDS = [
  "image",
  "images",
  "image_url",
  "image_tail",
  "first_frame_image",
  "last_frame_image",
  "input_reference",
  "input",
  "seconds",
  "size",
  "duration",
  "resolution",
  "aspect_ratio",
  "audio",
  "multi_shot",
  "metadata",
];

function isUpstreamShaped(req) {
  if (!isObject(req)) return false;
  if (Array.isArray(req.contents)) return true;
  for (var i = 0; i < GENERIC_ONLY_FIELDS.length; i += 1) {
    if (hasOwn(req, GENERIC_ONLY_FIELDS[i])) return false;
  }
  return isObject(req.settings) || isObject(req.options);
}

function contentTypesOf(body) {
  var types = [];
  if (!isObject(body) || !Array.isArray(body.contents)) return types;
  for (var i = 0; i < body.contents.length; i += 1) {
    var item = body.contents[i];
    if (isObject(item)) types.push(text(item.type));
  }
  return types;
}

function hasMediaType(body, types) {
  var found = contentTypesOf(body);
  for (var i = 0; i < found.length; i += 1) {
    if (types.indexOf(found[i]) >= 0) return true;
  }
  return false;
}

// 无路由提示时按内容推断端点：全能模型恒走 omni-video；有视频素材但模型不支持
// 直接报错；有图片/元素/音色走 image-to-video；其余走 text-to-video。
function inferEndpoint(model, body) {
  var canonical = canonicalModel(model);
  var caps = CAPS[canonical];
  if (caps.endpoints.length === 1) return caps.endpoints[0];
  if (hasMediaType(body, VIDEO_CONTENT_TYPES)) {
    throw new Error(
      "kling: " + canonical + " does not accept reference videos; use kling-video-v3-omni or kling-video-o1"
    );
  }
  if (hasMediaType(body, ["first_frame", "last_frame", "refer_image", "element", "voice"])) return "image-to-video";
  return "text-to-video";
}

function actionFor(body, endpoint) {
  if (endpoint !== "text-to-video" && hasMediaType(body, VIDEO_CONTENT_TYPES)) return "video_to_video";
  if (endpoint !== "text-to-video" && hasMediaType(body, IMAGE_CONTENT_TYPES)) return "image_to_video";
  return "text_to_video";
}

// ---------------------------------------------------------------------------
// 异构入口：通用请求 -> 规范模型
// ---------------------------------------------------------------------------
function metadataOf(req) {
  var meta = req && req.metadata;
  return isObject(meta) ? meta : {};
}

function settingsOf(req) {
  return isObject(req && req.settings) ? req.settings : {};
}

function optionsOf(req) {
  return isObject(req && req.options) ? req.options : {};
}

// 首帧与尾帧分别成列：不要把尾帧混进首帧候选，否则「仅尾帧」会被静默提升成首帧。
function collectFrames(req, meta) {
  var first = filterValues([
    meta.first_frame_image,
    req.first_frame_image,
    req.first_frame,
    req.image,
    req.image_url,
    req.input_reference,
  ]);
  var last = filterValues([meta.last_frame_image, req.last_frame_image, req.last_frame, req.image_tail]);
  var rest = [];
  toArray(req.images).forEach(function (image) {
    if (hasValue(image)) rest.push(image);
  });
  return { first: first, last: last, rest: rest };
}

function canonicalFromGeneric(req, model) {
  var canonical = canonicalModel(model);
  var meta = metadataOf(req);
  var settings = settingsOf(req);
  var options = optionsOf(req);
  var out = emptyCanonical(canonical, "");

  out.prompt = text(firstValue(req.prompt, req.input_text, meta.prompt));

  var frames = collectFrames(req, meta);
  out.firstFrame = frames.first.length ? frames.first[0] : frames.rest[0];
  out.lastFrame = frames.last.length ? frames.last[0] : frames.rest[1];
  // 多出来的图片：全能模型可作参考图，其余模型不支持，交由 finalizeBody 显式报错。
  var extras = frames.first
    .slice(1)
    .concat(frames.last.slice(1), frames.rest.slice(2));
  for (var i = 0; i < extras.length; i += 1) out.referImages.push(extras[i]);
  toArray(meta.refer_images).forEach(function (image) {
    if (hasValue(image)) out.referImages.push(image);
  });
  toArray(req.refer_images).forEach(function (image) {
    if (hasValue(image)) out.referImages.push(image);
  });

  out.featureVideo = firstValue(meta.feature_video, req.feature_video, meta.reference_video, req.reference_video);
  out.baseVideo = firstValue(meta.base_video, req.base_video, meta.video, req.video);

  toArray(firstDefined(meta.element_ids, meta.element_id, req.element_ids, req.element_id)).forEach(function (id) {
    if (defined(id)) out.elements.push({ element_id: id });
  });
  toArray(req.elements).forEach(function (element) {
    if (isObject(element) && defined(element.element_id)) out.elements.push({ element_id: element.element_id });
  });
  toArray(firstDefined(meta.voice_ids, meta.voice_id, req.voice_ids, req.voice_id)).forEach(function (id, index) {
    if (defined(id)) out.voices.push({ voice_id: id, id: "voice" + (index + 1) });
  });
  toArray(req.voices).forEach(function (voice, index) {
    if (isObject(voice) && defined(voice.voice_id)) {
      out.voices.push({ voice_id: voice.voice_id, id: text(voice.id) || "voice" + (index + 1) });
    }
  });

  out.duration = firstDefined(settings.duration, req.duration, req.seconds, meta.duration, meta.seconds);
  out.resolution = firstDefined(settings.resolution, req.resolution, req.size, meta.resolution, meta.size);
  out.aspectRatio = firstDefined(settings.aspect_ratio, req.aspect_ratio, meta.aspect_ratio);
  out.audio = firstDefined(settings.audio, req.audio, meta.audio);
  out.multiShot = firstDefined(settings.multi_shot, req.multi_shot, meta.multi_shot);
  out.externalTaskId = firstDefined(options.external_task_id, req.external_task_id, meta.external_task_id);
  out.watermarkInfo = firstDefined(options.watermark_info, req.watermark_info, meta.watermark_info);
  return out;
}

// ---------------------------------------------------------------------------
// encoder：规范模型 -> 厂商 body（白名单重建）
// ---------------------------------------------------------------------------
function encodeCanonical(c) {
  var body = { model: c.model };
  if (c.endpoint === "text-to-video") {
    body.prompt = c.prompt;
  } else {
    var contents = [];
    if (text(c.prompt)) contents.push({ type: "prompt", text: c.prompt });
    if (hasValue(c.firstFrame)) contents.push({ type: "first_frame", url: c.firstFrame });
    if (hasValue(c.lastFrame)) contents.push({ type: "last_frame", url: c.lastFrame });
    for (var i = 0; i < c.referImages.length; i += 1) {
      contents.push({ type: "refer_image", url: c.referImages[i] });
    }
    if (hasValue(c.featureVideo)) contents.push({ type: "feature_video", url: c.featureVideo });
    if (hasValue(c.baseVideo)) contents.push({ type: "base_video", url: c.baseVideo });
    for (var j = 0; j < c.elements.length; j += 1) {
      contents.push({ type: "element", element_id: c.elements[j].element_id });
    }
    for (var k = 0; k < c.voices.length; k += 1) {
      contents.push({ type: "voice", voice_id: c.voices[k].voice_id, id: c.voices[k].id });
    }
    body.contents = contents;
  }

  var settings = {};
  if (defined(c.duration)) settings.duration = c.duration;
  if (defined(c.resolution)) settings.resolution = c.resolution;
  if (defined(c.aspectRatio)) settings.aspect_ratio = c.aspectRatio;
  if (defined(c.audio)) settings.audio = c.audio;
  if (c.multiShot !== undefined && c.multiShot !== null) settings.multi_shot = c.multiShot;
  if (Object.keys(settings).length) body.settings = settings;

  var options = {};
  if (defined(c.externalTaskId)) options.external_task_id = c.externalTaskId;
  if (defined(c.watermarkInfo)) options.watermark_info = c.watermarkInfo;
  if (Object.keys(options).length) body.options = options;
  return body;
}

// 同构入口：保真浅复制 + 最小修正（只改模型与端点相关结构）。
function copyIsomorphic(raw, model) {
  var body = {};
  for (var key in raw) {
    if (hasOwn(raw, key)) body[key] = raw[key];
  }
  body.model = model;
  if (Array.isArray(raw.contents)) body.contents = raw.contents.slice();
  if (isObject(raw.settings)) {
    var settings = {};
    for (var skey in raw.settings) {
      if (hasOwn(raw.settings, skey)) settings[skey] = raw.settings[skey];
    }
    body.settings = settings;
  }
  return body;
}

// ---------------------------------------------------------------------------
// 校验与默认值（同构 / 异构共用，作用在最终 body 上）
// ---------------------------------------------------------------------------
function countType(contents, type) {
  var count = 0;
  for (var i = 0; i < contents.length; i += 1) {
    if (isObject(contents[i]) && text(contents[i].type) === type) count += 1;
  }
  return count;
}

function validateContents(contents, model, endpoint) {
  var caps = capsOf(model);
  for (var i = 0; i < contents.length; i += 1) {
    var item = contents[i];
    if (!isObject(item)) throw new Error("kling: contents[" + i + "] must be an object");
    var type = text(item.type);
    if (!type) throw new Error("kling: contents[" + i + "] requires a type");
    if (caps.contents.indexOf(type) < 0) {
      throw new Error("kling: " + model + " does not support content type " + type);
    }
    if (type === "prompt") {
      if (!text(item.text)) throw new Error("kling: prompt content requires a non-empty text");
      if (item.text.length > caps.promptLimit) {
        throw new Error("kling: " + model + " prompt exceeds " + caps.promptLimit + " characters");
      }
    } else if (type === "element") {
      if (!defined(item.element_id)) throw new Error("kling: element content requires element_id");
    } else if (type === "voice") {
      if (!defined(item.voice_id)) throw new Error("kling: voice content requires voice_id");
      if (!defined(item.id)) throw new Error("kling: voice content requires id");
    } else if (!hasValue(item.url)) {
      throw new Error("kling: " + type + " content requires a url");
    }
  }

  var firstFrames = countType(contents, "first_frame");
  var lastFrames = countType(contents, "last_frame");
  var referImages = countType(contents, "refer_image");
  var featureVideos = countType(contents, "feature_video");
  var baseVideos = countType(contents, "base_video");
  var elements = countType(contents, "element");
  var voices = countType(contents, "voice");
  var videos = featureVideos + baseVideos;

  if (lastFrames > 0 && firstFrames === 0) throw new Error("kling: last_frame requires first_frame");
  if (firstFrames > 1) throw new Error("kling: at most one first_frame is allowed");
  if (lastFrames > 1) throw new Error("kling: at most one last_frame is allowed");
  if (videos > 1) throw new Error("kling: at most one reference video is allowed");
  if (elements > MAX_ELEMENTS) throw new Error("kling: at most " + MAX_ELEMENTS + " elements are allowed");
  if (voices > MAX_VOICES) throw new Error("kling: at most " + MAX_VOICES + " voices are allowed");
  if (referImages + elements > (videos > 0 ? MAX_REFER_WITH_VIDEO : MAX_REFER_WITHOUT_VIDEO)) {
    throw new Error(
      "kling: refer_image + element must not exceed " +
        (videos > 0 ? MAX_REFER_WITH_VIDEO : MAX_REFER_WITHOUT_VIDEO) +
        " items"
    );
  }
  if (baseVideos > 0 && (firstFrames > 0 || lastFrames > 0)) {
    throw new Error("kling: base_video cannot be combined with first_frame or last_frame");
  }
  if (featureVideos > 0 && lastFrames > 0) throw new Error("kling: feature_video cannot be combined with last_frame");
  if (model === "kling-video-o1" && (firstFrames > 0 || lastFrames > 0) && (referImages > 0 || elements > 0)) {
    throw new Error("kling: kling-video-o1 cannot combine frames with refer_image or element");
  }
  if (endpoint === "image-to-video" && firstFrames === 0) {
    throw new Error("kling: image-to-video requires a first_frame");
  }
  if (endpoint !== "text-to-video" && countType(contents, "prompt") === 0 && videos === 0) {
    throw new Error("kling: a prompt is required");
  }
  return {
    firstFrames: firstFrames,
    lastFrames: lastFrames,
    referImages: referImages,
    featureVideos: featureVideos,
    baseVideos: baseVideos,
    elements: elements,
    voices: voices,
    videos: videos,
  };
}

function normalizeDuration(model, raw, flags) {
  var caps = capsOf(model);
  if (!defined(raw)) return DEFAULT_DURATION;
  var value = Number(raw);
  if (!Number.isFinite(value)) throw new Error("kling: duration must be a number");
  if (caps.allowedDurations) {
    if (caps.allowedDurations.indexOf(value) < 0) {
      throw new Error(
        "kling: " + model + " duration must be one of " + caps.allowedDurations.join(", ") + " seconds"
      );
    }
    return value;
  }
  if (!Number.isInteger(value) || value < caps.minDuration || value > caps.maxDuration) {
    throw new Error(
      "kling: " + model + " duration must be an integer between " + caps.minDuration + " and " + caps.maxDuration
    );
  }
  // O1 仅用首帧且无其他参考时只支持 5 / 10 秒。
  if (
    model === "kling-video-o1" &&
    flags.firstFrames > 0 &&
    flags.lastFrames === 0 &&
    flags.videos === 0 &&
    flags.referImages === 0 &&
    flags.elements === 0 &&
    value !== 5 &&
    value !== 10
  ) {
    throw new Error("kling: kling-video-o1 with only a first_frame supports duration 5 or 10 seconds");
  }
  return value;
}

function defaultResolution(model, flags) {
  if (model === "kling-video-v2.5-turbo" && flags.firstFrames > 0 && flags.lastFrames > 0) return "1080p";
  return "720p";
}

function normalizeResolution(model, raw, flags) {
  var caps = capsOf(model);
  if (!defined(raw)) return defaultResolution(model, flags);
  var value = lower(raw).replace(/\s+/g, "");
  if (value === "4k" || value === "4096" || value === "2160") value = "4k";
  else if (value === "1080" || value === "1080p") value = "1080p";
  else if (value === "720" || value === "720p") value = "720p";
  if (caps.resolutions.indexOf(value) < 0) {
    throw new Error("kling: " + model + " resolution must be one of " + caps.resolutions.join(", "));
  }
  return value;
}

function normalizeAspectRatio(raw) {
  var value = lower(raw).replace(/\s+/g, "");
  if (!value) return "";
  if (value === "16：9" || value === "16/9") value = "16:9";
  if (value === "9：16" || value === "9/16") value = "9:16";
  if (value === "1：1" || value === "1/1") value = "1:1";
  if (ASPECT_RATIOS.indexOf(value) < 0) {
    throw new Error("kling: aspect_ratio must be one of " + ASPECT_RATIOS.join(", "));
  }
  return value;
}

function normalizeAudio(model, raw, flags) {
  var caps = capsOf(model);
  var value = lower(raw);
  if (!value) return "";
  if (caps.audio.indexOf(value) < 0) {
    // off 是厂商默认语义，模型不支持时静默丢弃即可；其余语义无法复刻，显式报错。
    if (value === "off") return "";
    throw new Error("kling: " + model + " does not support audio=" + value);
  }
  if (flags.voices > 0 && value === "off") throw new Error("kling: a voice reference requires audio other than off");
  return value;
}

function normalizeMultiShot(model, raw) {
  var caps = capsOf(model);
  if (raw === undefined || raw === null) return undefined;
  var value = raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : undefined;
  if (value === undefined) throw new Error("kling: multi_shot must be a boolean");
  if (!caps.multiShot) {
    if (value) throw new Error("kling: " + model + " does not support multi_shot");
    return undefined;
  }
  return value;
}

// 文档声明的组合约束：V2.6 原生音频仅 1080p、首尾帧仅 720p；V2.5-turbo 首尾帧
// 仅 1080p；V3-omni 特征视频要求 audio=off 且 multi_shot=true；base_video 不支持
// 原生音频。约束来自厂商文档，命中即报明确错误，不静默改写用户意图。
function validateCombination(model, endpoint, settings, flags) {
  if (model === "kling-video-v2.6") {
    if (settings.audio === "native" && settings.resolution !== "1080p") {
      throw new Error("kling: kling-video-v2.6 with audio=native only supports 1080p");
    }
    if (flags.firstFrames > 0 && flags.lastFrames > 0 && settings.resolution !== "720p") {
      throw new Error("kling: kling-video-v2.6 first+last frame generation only supports 720p");
    }
  }
  if (
    model === "kling-video-v2.5-turbo" &&
    flags.firstFrames > 0 &&
    flags.lastFrames > 0 &&
    settings.resolution !== "1080p"
  ) {
    throw new Error("kling: kling-video-v2.5-turbo first+last frame generation only supports 1080p");
  }
  if (model === "kling-video-v3-omni" && flags.featureVideos > 0) {
    if (settings.audio && settings.audio !== "off") {
      throw new Error("kling: kling-video-v3-omni with feature_video requires audio=off");
    }
    if (settings.multi_shot === false) {
      throw new Error("kling: kling-video-v3-omni with feature_video requires multi_shot=true");
    }
  }
  if (flags.baseVideos > 0 && settings.audio === "native") {
    throw new Error("kling: base_video does not support audio=native");
  }
  if (flags.baseVideos > 0 && settings.multi_shot === true) {
    throw new Error("kling: base_video does not support multi_shot");
  }
}

// 唯一的终点校验器：同构与异构最终都跑这段，保证两侧语义完全一致。
function finalizeBody(body, model, endpoint) {
  var canonical = canonicalModel(model);
  var caps = CAPS[canonical];
  if (caps.endpoints.indexOf(endpoint) < 0) {
    throw new Error("kling: " + canonical + " only supports " + caps.endpoints.join(", "));
  }

  if (endpoint === "text-to-video") {
    // 同构入口可能带着 contents 进来：只含 prompt 时收敛成顶层 prompt，
    // 含图片/视频素材则说明端点选择有误，直接报错而不是静默丢素材。
    if (Array.isArray(body.contents)) {
      var mediaOnly = [];
      var promptOnly = "";
      for (var c = 0; c < body.contents.length; c += 1) {
        var entry = body.contents[c];
        if (!isObject(entry)) throw new Error("kling: contents[" + c + "] must be an object");
        if (text(entry.type) === "prompt") {
          if (!promptOnly) promptOnly = text(entry.text);
        } else {
          mediaOnly.push(text(entry.type));
        }
      }
      if (mediaOnly.length) {
        throw new Error("kling: text-to-video does not accept " + mediaOnly.join(", "));
      }
      if (promptOnly && !text(body.prompt)) body.prompt = promptOnly;
      delete body.contents;
    }
    if (typeof body.prompt !== "string" || !text(body.prompt)) {
      throw new Error("kling: text-to-video requires a non-empty prompt");
    }
    if (body.prompt.length > caps.promptLimit) {
      throw new Error("kling: " + canonical + " prompt exceeds " + caps.promptLimit + " characters");
    }
  } else {
    // 顶层 prompt 与 contents 并存时合并进 contents，避免厂商侧语义冲突。
    if (body.prompt !== undefined) {
      if (!Array.isArray(body.contents)) body.contents = [];
      var hasPrompt = false;
      for (var i = 0; i < body.contents.length; i += 1) {
        if (isObject(body.contents[i]) && text(body.contents[i].type) === "prompt") hasPrompt = true;
      }
      if (!hasPrompt && text(body.prompt)) {
        body.contents.unshift({ type: "prompt", text: String(body.prompt) });
      }
      delete body.prompt;
    }
    if (!Array.isArray(body.contents) || !body.contents.length) {
      throw new Error("kling: " + endpoint + " requires a non-empty contents array");
    }
  }

  var flags = endpoint === "text-to-video" ? null : validateContents(body.contents, canonical, endpoint);
  if (flags === null) {
    flags = {
      firstFrames: 0,
      lastFrames: 0,
      referImages: 0,
      featureVideos: 0,
      baseVideos: 0,
      elements: 0,
      voices: 0,
      videos: 0,
    };
  }

  var rawSettings = isObject(body.settings) ? body.settings : {};
  var settings = {};
  for (var key in rawSettings) {
    if (hasOwn(rawSettings, key)) settings[key] = rawSettings[key];
  }

  settings.duration = normalizeDuration(canonical, rawSettings.duration, flags);
  settings.resolution = normalizeResolution(canonical, rawSettings.resolution, flags);

  // 图生视频画幅跟随输入图片，厂商无此参数。
  if (endpoint === "image-to-video") {
    delete settings.aspect_ratio;
  } else {
    var ratio = normalizeAspectRatio(rawSettings.aspect_ratio);
    if (ratio) settings.aspect_ratio = ratio;
    else if (endpoint === "omni-video" && flags.firstFrames === 0 && flags.videos === 0) {
      settings.aspect_ratio = DEFAULT_ASPECT_RATIO;
    } else {
      delete settings.aspect_ratio;
    }
  }

  var audio = normalizeAudio(canonical, rawSettings.audio, flags);
  if (audio) settings.audio = audio;
  else delete settings.audio;

  var multiShot = normalizeMultiShot(canonical, rawSettings.multi_shot);
  if (multiShot === undefined) delete settings.multi_shot;
  else settings.multi_shot = multiShot;

  validateCombination(canonical, endpoint, settings, flags);
  body.settings = settings;
  body.model = canonical;
  return body;
}

// ---------------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------------
// 同构 / 异构共用的一条解析链：拿到厂商 body + 端点，后续校验与发送只认这个结果。
function resolveEnvelope(envelope, model) {
  var wrapped = isObject(envelope) ? envelope : {};
  var mode = text(wrapped.adapterMode);
  var payload = isObject(wrapped.payload) ? wrapped.payload : {};
  var endpoint = text(payload.endpoint);
  var body;
  if (mode === "isomorphic") {
    body = copyIsomorphic(isObject(payload.body) ? payload.body : {}, model);
  } else if (mode === "heterogeneous") {
    var canonical = isObject(payload.body) ? payload.body : emptyCanonical(model, endpoint);
    canonical.model = model;
    canonical.endpoint = endpoint || inferEndpoint(model, encodeCanonical(canonical));
    body = encodeCanonical(canonical);
    endpoint = canonical.endpoint;
  } else {
    // 兜底：宿主未携带适配信封时，按异构把原始 body 归一成规范模型。
    var generic = canonicalFromGeneric(wrapped, model);
    generic.endpoint = inferEndpoint(model, encodeCanonical(generic));
    body = encodeCanonical(generic);
    endpoint = generic.endpoint;
  }
  if (!endpoint) endpoint = inferEndpoint(model, body);
  return { model: model, endpoint: endpoint, body: body, mode: mode };
}

function envelopeModel(ctx) {
  var envelope = isObject(ctx.requestBody) ? ctx.requestBody : {};
  var payload = isObject(envelope.payload) ? envelope.payload : {};
  var fromBody = isObject(payload.body) ? payload.body.model : "";
  return canonicalModel(ctx.upstreamModel || fromBody || ctx.model);
}

export function buildSubmitRequest(ctx) {
  var resolved = resolveEnvelope(ctx.requestBody, envelopeModel(ctx));
  logEvent("submit_start", { model: resolved.model, endpoint: resolved.endpoint, mode: resolved.mode });
  try {
    finalizeBody(resolved.body, resolved.model, resolved.endpoint);
  } catch (err) {
    logEvent("submit_invalid", { model: resolved.model, endpoint: resolved.endpoint, error: err });
    throw err;
  }
  return {
    url: ctx.baseUrl + "/v1/wand/kling/" + resolved.endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
    body: resolved.body,
    action: actionFor(resolved.body, resolved.endpoint),
  };
}

function parseJSONBody(body) {
  if (isObject(body)) return body;
  if (typeof body !== "string") return {};
  try {
    var parsed = JSON.parse(body);
    return isObject(parsed) ? parsed : {};
  } catch (_err) {
    return { message: body };
  }
}

export function parseSubmitResponse(_ctx, resp) {
  var response = isObject(resp) ? resp : {};
  var status = Number(response.status || response.statusCode || 0);
  if (status === 408 || status === 429 || status >= 500) {
    logEvent("submit_http_error", { status: String(status) });
    throw new Error("kling: submit failed with HTTP " + status);
  }
  var body = parseJSONBody(response.body);
  if (defined(body.code) && Number(body.code) !== 0) {
    throw new Error(text(body.message) || "kling: submit failed");
  }
  var data = isObject(body.data) ? body.data : {};
  var taskId = text(data.id || data.task_id);
  if (!taskId) throw new Error("kling: submit response is missing data.id");
  logEvent("submit_done", { taskId: taskId });
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/wand/kling/tasks/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

// ---------------------------------------------------------------------------
// 查询与结果解析
// ---------------------------------------------------------------------------
function queryTaskObject(envelope) {
  if (Array.isArray(envelope.data)) return isObject(envelope.data[0]) ? envelope.data[0] : {};
  if (isObject(envelope.data)) return envelope.data;
  return isObject(envelope) ? envelope : {};
}

function outputsOf(task) {
  if (!isObject(task) || !Array.isArray(task.outputs)) return [];
  return task.outputs.filter(function (item) {
    return isObject(item) && hasValue(item.url);
  });
}

function outputURL(task) {
  var outputs = outputsOf(task);
  for (var i = 0; i < outputs.length; i += 1) {
    if (lower(outputs[i].type) === "video" || !text(outputs[i].type)) return text(outputs[i].url);
  }
  return outputs.length ? text(outputs[0].url) : "";
}

function normalizeStatusValue(value) {
  return lower(value).replace(/[\s\-]+/g, "_");
}

function startsWithAny(value, prefixes) {
  for (var i = 0; i < prefixes.length; i += 1) {
    if (value.indexOf(prefixes[i]) === 0) return true;
  }
  return false;
}

function failureReason(task) {
  return text(task.message || task.fail_reason || task.task_status_msg || task.err_msg);
}

// 六层阶梯：错误 envelope -> 文档枚举 -> 精确枚举 -> 前缀兜底 -> 失败信号 ->
// 结果 URL 兜底 -> 安全默认 QUEUED。禁止子串匹配，永不返回 UNKNOWN。
function statusResult(envelope) {
  var task = queryTaskObject(envelope);
  var raw = normalizeStatusValue(firstDefined(task.status, task.task_status));
  var url = outputURL(task);

  if (raw === "succeeded" || raw === "succeed" || raw === "success" || raw === "completed") {
    return { code: 0, status: "SUCCESS", progress: "100%", url: url };
  }
  if (raw === "failed" || raw === "failure" || raw === "error" || raw === "cancelled" || raw === "canceled") {
    return { code: 0, status: "FAILURE", progress: "100%", reason: failureReason(task) || "kling task failed" };
  }
  if (raw === "processing" || raw === "running" || raw === "in_progress") {
    return { code: 0, status: "IN_PROGRESS", progress: "50%" };
  }
  if (raw === "submitted" || raw === "queued" || raw === "pending" || raw === "waiting") {
    return { code: 0, status: "QUEUED", progress: "0%" };
  }
  if (startsWithAny(raw, ["success", "succ", "ok", "okay", "comp"])) {
    return { code: 0, status: "SUCCESS", progress: "100%", url: url };
  }
  if (startsWithAny(raw, ["erro", "fail", "cancel", "expire", "timeout", "reject", "abort"])) {
    return { code: 0, status: "FAILURE", progress: "100%", reason: failureReason(task) || "kling task failed" };
  }
  if (startsWithAny(raw, ["run", "process", "progress", "generat", "render"])) {
    return { code: 0, status: "IN_PROGRESS", progress: "50%" };
  }
  if (startsWithAny(raw, ["queue", "pend", "submit", "wait", "not_start"])) {
    return { code: 0, status: "QUEUED", progress: "0%" };
  }
  if (failureReason(task)) {
    return { code: 0, status: "FAILURE", progress: "100%", reason: failureReason(task) };
  }
  if (url) return { code: 0, status: "SUCCESS", progress: "100%", url: url };
  return { code: 0, status: "QUEUED", progress: "0%" };
}

export function parseTaskResult(_ctx, body, response) {
  var resp = isObject(response) ? response : {};
  var httpStatus = Number(resp.status || resp.statusCode || 0);
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    logEvent("query_http_error", { status: String(httpStatus) });
    throw new Error("kling: query failed with HTTP " + httpStatus);
  }
  var envelope = parseJSONBody(body);
  if (defined(envelope.code) && Number(envelope.code) !== 0) {
    return {
      code: Number(envelope.code),
      status: "FAILURE",
      progress: "100%",
      reason: text(envelope.message) || "kling task failed",
    };
  }
  var result = statusResult(envelope);
  var rawStatus = normalizeStatusValue(queryTaskObject(envelope).status);
  if (shouldLog("status:" + result.status + ":" + rawStatus, 30000)) {
    logEvent("task_status", { status: result.status, rawStatus: rawStatus });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------
function artifactList(task) {
  var items = [];
  var outputs = outputsOf(queryTaskObject(task));
  for (var i = 0; i < outputs.length; i += 1) {
    var type = lower(outputs[i].type) || "video";
    items.push({
      key: i === 0 ? type : type + "_" + (i + 1),
      type: type === "image" ? "image" : type === "audio" ? "audio" : type === "video" ? "video" : "file",
      url: text(outputs[i].url),
      index: i,
    });
  }
  return items;
}

function mimeFor(type) {
  if (type === "video") return "video/mp4";
  if (type === "image") return "image/*";
  if (type === "audio") return "audio/*";
  return "application/octet-stream";
}

export function listArtifacts(task) {
  if (!isObject(task) || task.status !== "SUCCESS") return [];
  return artifactList(task.data).map(function (item) {
    return { key: item.key, type: item.type, mimeType: mimeFor(item.type) };
  });
}

export function buildContentRequest(ctx) {
  var wanted = lower(ctx && ctx.artifactKey);
  var items = artifactList((ctx && ctx.data) || {});
  var fallbackIndex = wanted === "video" || wanted === "" ? 0 : -1;
  var url = text(ctx && ctx.url);
  for (var i = 0; i < items.length; i += 1) {
    if (lower(items[i].key) === wanted || (i === fallbackIndex && !url)) {
      url = url || items[i].url;
    }
  }
  if (!url) throw new Error("artifact_not_found");
  // 结果地址是公有 COS 临时地址，回源不能带渠道鉴权。
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

// ---------------------------------------------------------------------------
// 用量
// ---------------------------------------------------------------------------
function cloneBodyForUsage(body) {
  var copy = {};
  for (var key in body) {
    if (hasOwn(body, key)) copy[key] = body[key];
  }
  if (Array.isArray(body.contents)) copy.contents = body.contents.slice();
  if (isObject(body.settings)) {
    var settings = {};
    for (var skey in body.settings) {
      if (hasOwn(body.settings, skey)) settings[skey] = body.settings[skey];
    }
    copy.settings = settings;
  }
  return copy;
}

// 提交期的事实集保持与 usageSchema 同键：tokens 提交时为 0，成功后由
// extractUsageOnComplete 用 tokenhub_usage.total_tokens 覆盖。
function usageFacts(ctx) {
  var facts = { seconds: DEFAULT_DURATION, resolution: "720p", input_images: 0, input_videos: 0, tokens: 0 };
  var model;
  try {
    model = envelopeModel(ctx);
  } catch (_err) {
    return facts;
  }
  var finalized;
  try {
    var parts = resolveEnvelope(ctx.requestBody, model);
    finalized = finalizeBody(cloneBodyForUsage(parts.body), model, parts.endpoint);
  } catch (_err) {
    // 用量不得阻塞计费链路：解析失败时退回文档默认口径。
    return facts;
  }
  var settings = isObject(finalized.settings) ? finalized.settings : {};
  if (Number.isFinite(settings.duration)) facts.seconds = settings.duration;
  if (text(settings.resolution)) facts.resolution = settings.resolution;
  var contents = Array.isArray(finalized.contents) ? finalized.contents : [];
  facts.input_images =
    countType(contents, "first_frame") + countType(contents, "last_frame") + countType(contents, "refer_image");
  facts.input_videos = countType(contents, "feature_video") + countType(contents, "base_video");
  return facts;
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  return usageFacts(ctx);
}

// 查询响应带 tokenhub_usage.total_tokens 与真实时长，完成后回填真实用量。
export function extractUsageOnComplete(_task, _taskResult, body) {
  var envelope = parseJSONBody(body);
  var facts = {};
  var usage = isObject(envelope.tokenhub_usage) ? envelope.tokenhub_usage : {};
  var tokens = Number(usage.total_tokens);
  if (Number.isFinite(tokens) && tokens >= 0) facts.tokens = tokens;
  var outputs = outputsOf(queryTaskObject(envelope));
  if (outputs.length) {
    var seconds = Number(outputs[0].duration);
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 20) facts.seconds = Math.round(seconds * 1000) / 1000;
  }
  return Object.keys(facts).length ? facts : null;
}

// ---------------------------------------------------------------------------
// native 路由
// ---------------------------------------------------------------------------
function decodeNative(ctx, endpointHint) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  var req = ctx.body.value;
  if (!isObject(req)) throw new Error("request body must be an object");
  var model = canonicalModel(ctx.upstreamModel || req.model || ctx.model);
  if (isUpstreamShaped(req)) {
    var raw = copyIsomorphic(req, model);
    var endpoint = endpointHint || inferEndpoint(model, raw);
    return {
      kind: "submit",
      model: model,
      action: actionFor(raw, endpoint),
      requestBody: adapterRequest("isomorphic", { endpoint: endpoint, body: raw }),
    };
  }
  var canonical = canonicalFromGeneric(req, model);
  canonical.endpoint = endpointHint || inferEndpoint(model, encodeCanonical(canonical));
  return {
    kind: "submit",
    model: model,
    action: actionFor(encodeCanonical(canonical), canonical.endpoint),
    requestBody: adapterRequest("heterogeneous", { endpoint: canonical.endpoint, body: canonical }),
  };
}

function vendorStatus(hostStatus, fallback) {
  var status = text(hostStatus).toUpperCase();
  if (status === "SUCCESS") return "succeeded";
  if (status === "FAILURE") return "failed";
  if (status === "IN_PROGRESS") return "processing";
  return text(fallback) || "submitted";
}

export const native = {
  createTextVideo: function (ctx) {
    return decodeNative(ctx, "text-to-video");
  },
  createImageVideo: function (ctx) {
    return decodeNative(ctx, "image-to-video");
  },
  createOmniVideo: function (ctx) {
    return decodeNative(ctx, "omni-video");
  },
  createVideo: function (ctx) {
    return decodeNative(ctx, "");
  },

  createdVideo: function (_ctx, task) {
    var data = isObject(task.data) ? task.data : {};
    var inner = isObject(data.data) && !Array.isArray(data.data) ? data.data : {};
    return {
      code: data.code === undefined ? 0 : data.code,
      message: text(data.message) || "SUCCEED",
      request_id: text(data.request_id),
      data: Object.assign({}, inner, {
        id: text(task.task_id) || text(inner.id),
        status: vendorStatus(task.status, inner.status),
        message: text(task.fail_reason) || text(inner.message),
        url: text(task.url) || outputURL(inner),
      }),
    };
  },

  queryVideo: function (_ctx, task) {
    var data = isObject(task.data) ? task.data : {};
    var item = queryTaskObject(data);
    return {
      code: data.code === undefined ? 0 : data.code,
      message: text(data.message) || "SUCCEED",
      request_id: text(data.request_id),
      data: [
        Object.assign({}, item, {
          id: text(task.task_id) || text(item.id),
          task_id: text(task.task_id) || text(item.task_id),
          status: vendorStatus(task.status, item.status),
          message: text(task.fail_reason) || text(item.message),
          url: text(task.url) || outputURL(item),
        }),
      ],
      tokenhub_usage: isObject(data.tokenhub_usage) ? data.tokenhub_usage : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// OpenAI 协议入口
// ---------------------------------------------------------------------------
function responsesInput(req) {
  var texts = [];
  var images = [];
  var input = req.input;
  if (typeof input === "string") texts.push(input);
  else if (Array.isArray(input)) {
    for (var i = 0; i < input.length; i += 1) {
      var item = input[i];
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      if (!isObject(item)) continue;
      var parts = item.content === undefined ? [item] : toArray(item.content);
      for (var j = 0; j < parts.length; j += 1) {
        var part = parts[j];
        if (typeof part === "string") {
          texts.push(part);
          continue;
        }
        if (!isObject(part)) continue;
        if ((part.type === "input_text" || part.type === "text") && typeof part.text === "string") texts.push(part.text);
        if (part.type === "input_image" || part.type === "image_url") {
          var image = part.image_url;
          if (isObject(image)) image = image.url;
          if (hasValue(image)) images.push(image);
        }
      }
    }
  }
  return { prompt: texts.filter(Boolean).join("\n"), images: images };
}

function submitIntent(model, canonical, action) {
  return {
    kind: "submit",
    model: model,
    action: action,
    requestBody: adapterRequest("heterogeneous", { endpoint: canonical.endpoint, body: canonical }),
  };
}

function videoTag(url) {
  var escaped = String(url)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

function responsesVideoURL(ctx, task) {
  var artifacts = isObject(ctx && ctx.artifacts) ? ctx.artifacts : {};
  var artifact = artifacts.video || artifacts.video_1;
  return text(isObject(artifact) ? artifact.url : artifact) || text(task && task.url);
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      var req = ctx.body.value;
      if (!isObject(req)) throw new Error("request body must be an object");
      var model = canonicalModel(ctx.upstreamModel || req.model || ctx.model);
      var parsed = responsesInput(req);
      var prompt = text(parsed.prompt) || text(req.prompt);
      var images = parsed.images.slice();
      if (hasValue(req.image) && typeof req.image !== "object") images.unshift(req.image);
      toArray(req.images).forEach(function (image) {
        if (hasValue(image)) images.push(image);
      });
      if (!prompt && !images.length) throw new Error("input is required");
      var generic = {
        model: model,
        prompt: prompt,
        images: images,
        metadata: isObject(req.metadata) ? req.metadata : {},
        duration: firstDefined(req.seconds, req.duration),
        resolution: firstDefined(req.size, req.resolution),
        aspect_ratio: req.aspect_ratio,
        audio: req.audio,
        multi_shot: req.multi_shot,
      };
      var canonical = canonicalFromGeneric(generic, model);
      canonical.endpoint = inferEndpoint(model, encodeCanonical(canonical));
      return submitIntent(model, canonical, actionFor(encodeCanonical(canonical), canonical.endpoint));
    },

    renderEvents: function (ctx, task, previousState) {
      var status = text(task.status).toUpperCase();
      var progress = status === "SUCCESS" || status === "FAILURE" ? 100 : status === "IN_PROGRESS" ? 50 : 0;
      var state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        var events = previousState && previousState.status === status ? [] : [{ type: "output", data: videoTag(responsesVideoURL(ctx, task)) }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE") {
        return { events: [{ type: "error", code: "task_failed", message: text(task.reason) || "task failed" }], state: state, done: true };
      }
      if (previousState && previousState.status === status && previousState.progress === progress) {
        return { events: [], state: state, done: false };
      }
      return { events: [{ type: "progress", message: status.toLowerCase(), progress: progress }], state: state, done: false };
    },

    renderFinal: function (ctx, task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: videoTag(responsesVideoURL(ctx, task)), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "kling" },
      };
    },
  },

  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body) throw new Error("JSON or multipart body required");
      var req;
      if (ctx.body.kind === "json") {
        if (!isObject(ctx.body.value)) throw new Error("JSON object required");
        req = ctx.body.value;
      } else if (ctx.body.kind === "multipart") {
        var fields = isObject(ctx.body.fields) ? ctx.body.fields : {};
        req = {};
        for (var name in fields) {
          if (!hasOwn(fields, name)) continue;
          var values = fields[name];
          if (Array.isArray(values)) {
            if (values.length > 1) throw new Error(name + " must be provided once");
            req[name] = values[0];
          } else {
            req[name] = values;
          }
        }
        var files = Array.isArray(ctx.body.files) ? ctx.body.files : [];
        for (var i = 0; i < files.length; i += 1) {
          var file = files[i];
          if (!isObject(file) || file.field !== "input_reference") {
            throw new Error("unexpected file field: " + text(isObject(file) ? file.field : file));
          }
          req.image = { __fileRef: "request_file:input_reference", encoding: "dataUrl", maxBytes: MAX_INPUT_FILE_BYTES };
        }
        if (req.metadata !== undefined) {
          var parsed;
          try {
            parsed = JSON.parse(req.metadata);
          } catch (_err) {
            throw new Error("metadata must be a JSON object string");
          }
          if (!isObject(parsed)) throw new Error("metadata must be a JSON object string");
          req.metadata = parsed;
        }
        if (req.seconds !== undefined) req.seconds = Number(req.seconds);
        if (req.duration !== undefined) req.duration = Number(req.duration);
      } else {
        throw new Error("JSON or multipart body required");
      }
      var model = canonicalModel(ctx.upstreamModel || req.model || ctx.model);
      var generic = {
        model: model,
        prompt: req.prompt,
        image: firstValue(req.input_reference, req.image, req.image_url),
        image_tail: firstValue(req.image_tail, req.last_frame_image),
        metadata: isObject(req.metadata) ? req.metadata : {},
        duration: firstDefined(req.seconds, req.duration),
        resolution: firstDefined(req.size, req.resolution),
        aspect_ratio: req.aspect_ratio,
        audio: req.audio,
        multi_shot: req.multi_shot,
      };
      var canonical = canonicalFromGeneric(generic, model);
      canonical.endpoint = inferEndpoint(model, encodeCanonical(canonical));
      return submitIntent(model, canonical, actionFor(encodeCanonical(canonical), canonical.endpoint));
    },

    render: function (ctx, task) {
      var status = text(task.status).toUpperCase();
      return {
        id: text(task.task_id),
        object: "video",
        model: text(task.model),
        status: status === "SUCCESS" ? "completed" : status === "FAILURE" ? "failed" : "in_progress",
        progress: Number(text(task.progress).replace("%", "")) || 0,
        url: responsesVideoURL(ctx, task),
        error: text(task.reason) ? { message: text(task.reason) } : undefined,
      };
    },
  },
};
