// kling 合同测试（纯函数，无网络）
// 版本目录自动取 plugins/tasks/kling/ 下最新的 semver：打了新 patch 后测试不必手改路径，
// 否则很容易出现「新版本已发布、测试还指向旧版本」的假绿。
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, "../../plugins/tasks/kling");
const VERSION = readdirSync(PLUGIN_DIR)
  .filter(function (name) { return /^\d+\.\d+\.\d+$/.test(name); })
  .sort(function (a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  })
  .pop();
const plugin = await import(resolve(PLUGIN_DIR, VERSION, "plugin.js"));

let passed = 0;
let failed = 0;
// 用例级输出：test-runner 解析 `✓/✗ label` 生成报告并做跨版本回归比对，勿删。
function mark(kind, name) { console.log("  " + kind + " " + name); }
function ok(cond, name) {
  if (cond) { passed += 1; mark("✓", name); }
  else {
    failed += 1;
    mark("✗", name);
    console.error("FAIL: " + name);
  }
}
function throws(fn, name, expectFragment) {
  try {
    fn();
    failed += 1;
    mark("✗", name);
    console.error("FAIL (no throw): " + name);
  } catch (e) {
    if (expectFragment && String(e.message).indexOf(expectFragment) < 0) {
      failed += 1;
      mark("✗", name);
      console.error("FAIL (wrong message): " + name + " -> " + e.message);
    } else { passed += 1; mark("✓", name); }
  }
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

const meta = plugin.meta;
const BASE = "https://tokenhub.tencentmaas.com";

// ---- meta / 仓库约定 ----
ok(meta.author && meta.author.name === "Jushenzhidao", "author = Jushenzhidao");
ok(Array.isArray(meta.channelTypes) && meta.channelTypes[0] === 10008, "channelTypes = [10008]");
ok(meta.version === VERSION, "version matches directory");
ok(meta.key === "kling", "key");
ok(meta.models.length === 6, "six models");
ok(meta.models.indexOf("kling-video-o1") >= 0 && meta.models.indexOf("kling-video-v2.6") >= 0, "o1 + v2.6 registered");
ok(meta.fetchMode === "per_task", "fetchMode per_task");
// 宿主硬校验：每条 usageExamples 的事实集必须覆盖 usageSchema 的全部键
const schemaKeys = Object.keys(meta.usageSchema).sort();
meta.usageExamples.forEach(function (example) {
  const factKeys = Object.keys(example.facts).sort();
  ok(eq(factKeys, schemaKeys), "usageExamples[" + meta.usageExamples.indexOf(example) + "] facts cover usageSchema");
  Object.keys(example.facts).forEach(function (key) {
    ok(hasOwn(meta.usageSchema, key), "usageExamples key in schema: " + key);
  });
});
meta.routes.forEach(function (route) {
  if (route.type === "submit") {
    ok(Boolean(route.decode) && Boolean(route.render), "submit route " + route.path + " has decode+render");
    ok(typeof plugin.native[route.decode] === "function", "decode hook exists: " + route.decode);
    ok(typeof plugin.native[route.render] === "function", "render hook exists: " + route.render);
  } else {
    ok(!route.decode && Boolean(route.render), "query route has render only");
    ok(route.path.indexOf(":" + route.taskIdParam) > 0, "query taskIdParam matches placeholder");
  }
});
ok(typeof plugin.protocols.openai_responses.decodeRequest === "function", "openai_responses decodeRequest");
ok(typeof plugin.protocols.openai_responses.renderEvents === "function", "openai_responses renderEvents");
ok(typeof plugin.protocols.openai_responses.renderFinal === "function", "openai_responses renderFinal");
ok(typeof plugin.protocols.openai_video.decodeRequest === "function", "openai_video decodeRequest");
ok(typeof plugin.protocols.openai_video.render === "function", "openai_video render");

// ---- 入口 helper ----
// 插件不再有「按 body.model 分发」的通用入口：模型与端点都由路由路径锁定。
// 测试里保留一个便利函数，按 body 形状与 model 别名反查该走哪条路由，
// 这样既能复用大量既有断言，又如实走了路径锁定的入口。
const ENTRY_BY_MODEL = {
  "kling-video-v3": { text: "textVideoV3", image: "imageVideoV3" },
  "kling-video-v3-turbo": { text: "textVideoV3Turbo", image: "imageVideoV3Turbo" },
  "kling-video-v2.6": { text: "textVideoV26", image: "imageVideoV26" },
  "kling-video-v2.5-turbo": { text: "textVideoV25Turbo", image: "imageVideoV25Turbo" },
  "kling-video-v3-omni": { omni: "omniVideoV3Omni" },
  "kling-video-o1": { omni: "omniVideoO1" },
};
const MODEL_ALIAS = {
  "kling-v3": "kling-video-v3",
  "kling-v3-turbo": "kling-video-v3-turbo",
  "kling-v2.6": "kling-video-v2.6",
  "kling-v2.5-turbo": "kling-video-v2.5-turbo",
  "kling-o1": "kling-video-o1",
  "kling-v3-omni": "kling-video-v3-omni",
};
function entryFor(body) {
  const raw = String((body && body.model) || "").toLowerCase();
  const model = MODEL_ALIAS[raw] || raw;
  const entries = ENTRY_BY_MODEL[model];
  if (!entries) return "textVideoV3"; // 未知模型：借任一入口，让插件自己拒绝
  if (entries.omni) return entries.omni;
  const hasImage =
    hasOwn(body, "image") ||
    hasOwn(body, "image_tail") ||
    (Array.isArray(body.contents) &&
      body.contents.some(function (c) {
        return c && c.type !== "prompt";
      }));
  return hasImage ? entries.image : entries.text;
}
function decodeNative(body, fn) {
  return plugin.native[fn || entryFor(body)]({ body: { kind: "json", value: body } });
}
function send(intent, extra) {
  return plugin.buildSubmitRequest(
    Object.assign({ requestBody: intent.requestBody, apiKey: "KEY", baseUrl: BASE }, extra || {})
  );
}
function decodeSend(body, fn, extra) {
  return send(decodeNative(body, fn), extra);
}

// ---- 1. 同构：厂商原生形状 ----
const iso = decodeNative({
  model: "kling-video-v3",
  contents: [
    { type: "prompt", text: "a girl on a train" },
    { type: "first_frame", url: "https://img/a.jpg" },
  ],
  settings: { duration: 10, resolution: "1080p", audio: "native", multi_shot: false },
  options: { external_task_id: "ext-1" },
});
ok(iso.kind === "submit" && iso.model === "kling-video-v3", "isomorphic canonical intent");
ok(eq(Object.keys(iso), ["kind", "model", "action", "requestBody"]), "decoder returns only canonical intent fields");
ok(iso.requestBody.adapterMode === "isomorphic", "adapterMode isomorphic");
ok(iso.requestBody.payload.endpoint === "image-to-video", "endpoint from contents");
ok(iso.action === "image_to_video", "action image_to_video");
const isoReq = send(iso);
ok(isoReq.url === BASE + "/v1/wand/kling/image-to-video", "image-to-video url");
ok(isoReq.method === "POST" && isoReq.headers.Authorization === "Bearer KEY", "method + bearer auth");
ok(isoReq.body.settings.duration === 10 && isoReq.body.settings.resolution === "1080p", "settings preserved");
ok(isoReq.body.settings.audio === "native" && isoReq.body.settings.multi_shot === false, "explicit false preserved");
ok(isoReq.body.options.external_task_id === "ext-1", "options preserved");
ok(eq(isoReq.body.contents[0], { type: "prompt", text: "a girl on a train" }), "contents order preserved");

// 同构未知字段保真透传
const isoUnknown = decodeSend({
  model: "kling-video-v3",
  prompt: "hello",
  settings: { duration: 5, vendor_future_flag: "x" },
  unknown_root: 1,
});
ok(isoUnknown.body.unknown_root === 1, "isomorphic keeps unknown root field");
ok(isoUnknown.body.settings.vendor_future_flag === "x", "isomorphic keeps unknown settings field");
ok(isoUnknown.url.endsWith("/text-to-video"), "prompt-only -> text-to-video");

// contents 只含 prompt 且命中 text-to-video 路由：收敛成顶层 prompt
const isoPromptContents = decodeSend(
  { model: "kling-video-v3", contents: [{ type: "prompt", text: "only prompt" }] },
  "textVideoV3"
);
ok(isoPromptContents.url.endsWith("/text-to-video"), "text route with prompt-only contents");
ok(isoPromptContents.body.prompt === "only prompt" && isoPromptContents.body.contents === undefined, "contents folded into prompt");
throws(function () {
  decodeSend(
    { model: "kling-video-v3", contents: [{ type: "prompt", text: "p" }, { type: "first_frame", url: "https://i/a.jpg" }] },
    "textVideoV3"
  );
}, "image contents on text route rejected", "does not accept first_frame");

// 顶层 prompt 与 contents 合并
const isoMerge = decodeSend({ model: "kling-video-v3", prompt: "top", contents: [{ type: "first_frame", url: "https://i/a.jpg" }] });
ok(eq(isoMerge.body.contents[0], { type: "prompt", text: "top" }), "top-level prompt merged into contents");
ok(isoMerge.body.prompt === undefined, "top-level prompt removed for contents endpoints");

// ---- 2. 异构：通用形状 ----
const het = decodeSend({ model: "kling-video-v3", prompt: "a cat", image: "https://img/a.jpg", duration: 10, size: "1080p" });
ok(het.url === BASE + "/v1/wand/kling/image-to-video", "heterogeneous image-to-video url");
ok(eq(het.body.contents, [
  { type: "prompt", text: "a cat" },
  { type: "first_frame", url: "https://img/a.jpg" },
]), "heterogeneous contents whitelist");
ok(het.body.settings.duration === 10 && het.body.settings.resolution === "1080p", "heterogeneous settings");
ok(het.body.settings.aspect_ratio === undefined, "image-to-video drops aspect_ratio");
ok(het.body.settings.audio === undefined && het.body.settings.multi_shot === undefined, "no fabricated settings");

const hetText = decodeSend({ model: "kling-video-v3", prompt: "a cat", seconds: 8, resolution: "720p" });
ok(hetText.url.endsWith("/text-to-video") && hetText.body.prompt === "a cat", "heterogeneous text-to-video");
ok(hetText.body.contents === undefined, "text-to-video has no contents");
ok(hetText.body.settings.duration === 8, "seconds mapped to duration");

// 客户端未知字段不外泄
const leak = decodeSend({ model: "kling-video-v3", prompt: "p", secret_field: "x" });
ok(!("secret_field" in leak.body), "unknown client field not leaked");

// 模型别名与大写（路由路径写的是规范名，别名解析仍供协议入口使用）
ok(decodeSend({ model: "Kling-Video-O1", prompt: "p" }).body.model === "kling-video-o1", "Kling-Video-O1 alias");
ok(decodeSend({ model: "Kling-Video-V3-omni", prompt: "p" }).body.model === "kling-video-v3-omni", "omni alias");

// 路径模型是唯一模型来源：body.model 无论写什么都被覆盖，不会改变端点或能力校验
const overridden = decodeSend({ model: "kling-video-v99", prompt: "p" }, "textVideoV3");
ok(overridden.body.model === "kling-video-v3", "path model overrides bogus body.model");
ok(overridden.url.endsWith("/text-to-video"), "path endpoint unaffected by body.model");
const noModel = decodeSend({ prompt: "p" }, "textVideoV26");
ok(noModel.body.model === "kling-video-v2.6", "path model fills in when body.model absent");
const crossModel = decodeSend({ model: "kling-video-o1", prompt: "p", seconds: 15 }, "textVideoV3");
ok(crossModel.body.model === "kling-video-v3" && crossModel.body.settings.duration === 15, "v3 route allows 15s regardless of body.model");
throws(
  function () { decodeSend({ model: "kling-video-v3", prompt: "p", seconds: 15 }, "omniVideoO1"); },
  "o1 route enforces o1 duration cap",
  "duration"
);

// ---- 3. 端点与模型能力 ----
ok(decodeSend({ model: "kling-video-v3-omni", prompt: "p" }).url.endsWith("/omni-video"), "omni always omni-video");
ok(decodeSend({ model: "kling-video-o1", prompt: "p" }).url.endsWith("/omni-video"), "o1 always omni-video");
ok(decodeSend({ model: "kling-video-o1", prompt: "p" }).body.settings.aspect_ratio === "16:9", "omni without frame gets default ratio");
const omniFrame = decodeSend({
  model: "kling-video-v3-omni",
  prompt: "p",
  metadata: { first_frame_image: "https://i/a.jpg" },
});
ok(omniFrame.body.contents[1].type === "first_frame", "omni first_frame via metadata");
ok(omniFrame.body.settings.aspect_ratio === undefined, "omni with first_frame has no forced ratio");
const omniEdit = decodeSend({
  model: "kling-video-v3-omni",
  prompt: "change colour",
  metadata: { base_video: "https://v/a.mp4" },
  settings: { audio: "original" },
});
ok(omniEdit.body.contents[1].type === "base_video", "base_video mapped");
ok(omniEdit.body.settings.audio === "original", "omni audio original");
throws(function () {
  decodeSend({ model: "kling-video-v3", prompt: "p", metadata: { base_video: "https://v/a.mp4" } });
}, "video input on non-omni rejected", "text-to-video does not accept");
// 路径已锁定模型：body.model 被忽略，不再有跨模型越界的可能
const routePinned = decodeSend({ model: "kling-video-v3", prompt: "p", image: "https://i/a.jpg" }, "omniVideoV3Omni");
ok(routePinned.body.model === "kling-video-v3-omni", "omni route pins model regardless of body.model");
throws(function () {
  decodeSend({ model: "kling-video-v3", prompt: "p", metadata: { base_video: "https://v/a.mp4" } }, "textVideoV3");
}, "reference video on v3 text route rejected", "text-to-video does not accept");
// 非全能模型的图生端点收到参考视频：由素材校验拦截（端点已锁定，无推断兜底）
throws(function () {
  decodeSend(
    { model: "kling-video-v3", prompt: "p", image: "https://i/a.jpg", metadata: { base_video: "https://v/a.mp4" } },
    "imageVideoV3"
  );
}, "reference video on non-omni image route rejected", "does not support content type base_video");

// ---- 4. 时长 / 分辨率 / 音频 / 多镜头 ----
throws(function () { decodeSend({ model: "kling-video-v3", prompt: "p", duration: 2 }); }, "v3 duration 2 rejected", "between 3 and 15");
throws(function () { decodeSend({ model: "kling-video-v3", prompt: "p", duration: 16 }); }, "v3 duration 16 rejected");
throws(function () { decodeSend({ model: "kling-video-v3", prompt: "p", duration: 5.5 }); }, "v3 fractional duration rejected");
ok(decodeSend({ model: "kling-video-v3", prompt: "p", duration: 15 }).body.settings.duration === 15, "v3 duration 15 ok");
throws(function () { decodeSend({ model: "kling-video-v2.6", prompt: "p", duration: 6 }); }, "v2.6 duration 6 rejected", "must be one of 5, 10");
ok(decodeSend({ model: "kling-video-v2.6", prompt: "p", duration: 10 }).body.settings.duration === 10, "v2.6 duration 10 ok");
throws(function () { decodeSend({ model: "kling-video-v2.5-turbo", prompt: "p", duration: 7 }); }, "v2.5-turbo duration 7 rejected");
throws(function () { decodeSend({ model: "kling-video-o1", prompt: "p", duration: 12 }); }, "o1 duration 12 rejected", "between 3 and 10");
ok(decodeSend({ model: "kling-video-o1", prompt: "p", duration: 8 }).body.settings.duration === 8, "o1 duration 8 ok");
const o1Frame = { model: "kling-video-o1", prompt: "p", duration: 8, image: "https://i/a.jpg" };
throws(function () { decodeSend(o1Frame); }, "o1 first_frame-only duration 8 rejected", "duration 5 or 10");
ok(decodeSend({ model: "kling-video-o1", prompt: "p", duration: 10, image: "https://i/a.jpg" }).body.settings.duration === 10, "o1 first_frame-only 10 ok");

ok(decodeSend({ model: "kling-video-v3", prompt: "p", resolution: "4k" }).body.settings.resolution === "4k", "v3 4k ok");
throws(function () { decodeSend({ model: "kling-video-v3-turbo", prompt: "p", resolution: "4k" }); }, "turbo 4k rejected", "must be one of 720p, 1080p");
throws(function () { decodeSend({ model: "kling-video-o1", prompt: "p", resolution: "4k" }); }, "o1 4k rejected");
throws(function () { decodeSend({ model: "kling-video-v3", prompt: "p", resolution: "2k" }); }, "unknown resolution rejected");
ok(decodeSend({ model: "kling-video-v3", prompt: "p", resolution: "1080" }).body.settings.resolution === "1080p", "1080 normalized");
ok(decodeSend({ model: "kling-video-v3", prompt: "p" }).body.settings.duration === 5, "default duration 5");
ok(decodeSend({ model: "kling-video-v3", prompt: "p" }).body.settings.resolution === "720p", "default resolution 720p");

ok(decodeSend({ model: "kling-video-v3", prompt: "p", audio: "native" }).body.settings.audio === "native", "v3 audio native");
ok(decodeSend({ model: "kling-video-v3-turbo", prompt: "p", audio: "off" }).body.settings.audio === undefined, "turbo audio off dropped");
throws(function () { decodeSend({ model: "kling-video-v3-turbo", prompt: "p", audio: "native" }); }, "turbo audio native rejected", "does not support audio=native");
const v25Off = decodeSend({ model: "kling-video-v2.5-turbo", prompt: "p", audio: "off", image: "https://i/a.jpg", image_tail: "https://i/b.jpg" });
ok(v25Off.body.settings.audio === undefined, "v2.5-turbo audio off dropped");
throws(function () {
  decodeSend({ model: "kling-video-v2.5-turbo", prompt: "p", resolution: "720p", image: "https://i/a.jpg", image_tail: "https://i/b.jpg" });
}, "v2.5-turbo frames at 720p rejected", "only supports 1080p");
ok(decodeSend({ model: "kling-video-v2.5-turbo", prompt: "p", image: "https://i/a.jpg", image_tail: "https://i/b.jpg" }).body.settings.resolution === "1080p", "v2.5-turbo frames default 1080p");
throws(function () { decodeSend({ model: "kling-video-v2.6", prompt: "p", audio: "native" }); }, "v2.6 native audio needs 1080p", "only supports 1080p");
ok(decodeSend({ model: "kling-video-v2.6", prompt: "p", audio: "native", resolution: "1080p" }).body.settings.audio === "native", "v2.6 native audio 1080p ok");
throws(function () { decodeSend({ model: "kling-video-v2.6", prompt: "p", image: "https://i/a.jpg", image_tail: "https://i/b.jpg", resolution: "1080p" }); }, "v2.6 frames need 720p", "only supports 720p");

ok(decodeSend({ model: "kling-video-v3", prompt: "p", multi_shot: true }).body.settings.multi_shot === true, "v3 multi_shot");
ok(decodeSend({ model: "kling-video-v3-turbo", prompt: "p", multi_shot: false }).body.settings.multi_shot === undefined, "turbo multi_shot false dropped");
throws(function () { decodeSend({ model: "kling-video-v3-turbo", prompt: "p", multi_shot: true }); }, "turbo multi_shot true rejected", "does not support multi_shot");

// ---- 5. contents 组合约束 ----
throws(function () {
  decodeSend({ model: "kling-video-v3", prompt: "p", image_tail: "https://i/b.jpg" });
}, "last_frame without first_frame rejected", "requires first_frame");
throws(function () {
  decodeSend({ model: "kling-video-v3-turbo", prompt: "p", image: "https://i/a.jpg", image_tail: "https://i/b.jpg" });
}, "turbo last_frame rejected", "does not support content type last_frame");
throws(function () {
  decodeSend({ model: "kling-video-v3", prompt: "p", image: "https://i/a.jpg", metadata: { refer_images: ["https://i/c.jpg"] } });
}, "v3 refer_image rejected", "does not support content type refer_image");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { base_video: "https://v/a.mp4", feature_video: "https://v/b.mp4" } });
}, "two reference videos rejected", "at most one reference video");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { base_video: "https://v/a.mp4", first_frame_image: "https://i/a.jpg" } });
}, "base_video with frames rejected", "cannot be combined");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { feature_video: "https://v/a.mp4", first_frame_image: "https://i/a.jpg", last_frame_image: "https://i/b.jpg" } });
}, "feature_video with last_frame rejected", "cannot be combined");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { feature_video: "https://v/a.mp4" }, settings: { audio: "native" } });
}, "feature_video audio rejected", "requires audio=off");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { feature_video: "https://v/a.mp4" }, settings: { multi_shot: false } });
}, "feature_video multi_shot rejected", "requires multi_shot=true");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { base_video: "https://v/a.mp4" }, settings: { audio: "native" } });
}, "base_video native audio rejected", "does not support audio=native");
throws(function () {
  decodeSend({ model: "kling-video-o1", prompt: "p", metadata: { first_frame_image: "https://i/a.jpg", refer_images: ["https://i/c.jpg"] } });
}, "o1 frames + refer_image rejected", "cannot combine frames");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { voice_id: "v1" }, settings: { audio: "off" } });
}, "voice with audio off rejected", "requires audio other than off");
const voiceOk = decodeSend({ model: "kling-video-v3-omni", prompt: "hi @voice1", metadata: { voice_id: "v1" }, settings: { audio: "native" } });
ok(voiceOk.body.contents[1].voice_id === "v1" && voiceOk.body.contents[1].id === "voice1", "voice mapped with id");
throws(function () {
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { voice_ids: ["a", "b", "c"] }, settings: { audio: "native" } });
}, "three voices rejected", "at most 2 voices");
const elementOk = decodeSend({ model: "kling-video-v3", prompt: "hi @hero", image: "https://i/a.jpg", metadata: { element_id: "123" } });
ok(elementOk.body.contents[2].element_id === "123", "element mapped");
throws(function () {
  decodeSend({ model: "kling-video-v3", prompt: "p", image: "https://i/a.jpg", metadata: { element_ids: ["1", "2", "3", "4"] } });
}, "four elements rejected", "at most 3 elements");
throws(function () {
  const refer = [];
  for (let i = 0; i < 8; i++) refer.push("https://i/" + i + ".jpg");
  decodeSend({ model: "kling-video-v3-omni", prompt: "p", metadata: { refer_images: refer } });
}, "eight refer_images rejected", "must not exceed 7");
throws(function () { decodeSend({ model: "kling-video-v3", prompt: "   " }); }, "blank prompt rejected");
throws(function () { decodeSend({ model: "kling-video-v3", image: "https://i/a.jpg" }, "imageVideoV3"); }, "missing prompt rejected", "a prompt is required");
throws(function () { decodeSend({ model: "kling-video-v3", prompt: "p" }, "imageVideoV3"); }, "image-to-video without image rejected", "requires a first_frame");
throws(function () { plugin.native.textVideoV3({ body: { kind: "form", value: {} } }); }, "non-json body rejected");

// 文件占位对象必须原样透传
const fileRef = { __fileRef: "request_file:input_reference", encoding: "dataUrl", maxBytes: 52428800 };
ok(decodeSend({ model: "kling-video-v3", prompt: "p", image: fileRef }).body.contents[1].url.__fileRef === "request_file:input_reference", "file placeholder preserved");

// ---- 6. 提交 / 查询上游契约 ----
const submitBody = {
  code: 0,
  message: "SUCCEED",
  request_id: "r1",
  data: { id: "task_1", status: "submitted", create_time: 1, update_time: 1 },
};
const parsedSubmit = plugin.parseSubmitResponse({}, { status: 200, body: submitBody });
ok(parsedSubmit.taskId === "task_1", "taskId = data.id");
ok(parsedSubmit.taskData === submitBody, "envelope persisted");
ok(eq(Object.keys(parsedSubmit), ["taskId", "taskData"]), "parseSubmitResponse returns only allowed fields");
throws(function () { plugin.parseSubmitResponse({}, { body: { code: 1201, message: "Invalid parameters" } }); }, "submit envelope error rejected", "Invalid parameters");
throws(function () { plugin.parseSubmitResponse({}, { body: { code: 0, data: {} } }); }, "missing id rejected", "missing data.id");
throws(function () { plugin.parseSubmitResponse({}, { status: 500, body: submitBody }); }, "submit 5xx throws for retry");
throws(function () { plugin.parseSubmitResponse({}, { status: 429, body: submitBody }); }, "submit 429 throws for retry");

const q = plugin.buildQueryRequest({ taskId: "a/b", apiKey: "KEY", baseUrl: BASE });
ok(q.url === BASE + "/v1/wand/kling/tasks/a%2Fb", "query url encodes task id");
ok(q.method === "GET" && q.headers.Authorization === "Bearer KEY", "query method/auth");

function parse(body, http) {
  return plugin.parseTaskResult({ taskId: "t" }, body, { status: http === undefined ? 200 : http });
}
const doneEnvelope = {
  code: 0,
  message: "SUCCEED",
  request_id: "r",
  data: [
    {
      id: "task_1",
      status: "succeeded",
      message: "",
      outputs: [{ duration: "10.041", id: "o1", type: "video", url: "https://cos/x.mp4" }],
    },
  ],
  tokenhub_usage: { total_tokens: 600000 },
};
const succ = parse(doneEnvelope);
ok(succ.status === "SUCCESS" && succ.url === "https://cos/x.mp4" && succ.progress === "100%", "succeeded -> SUCCESS with url");
ok(parse({ code: 0, data: [{ status: "processing" }] }).status === "IN_PROGRESS", "processing -> IN_PROGRESS");
ok(parse({ code: 0, data: [{ status: "submitted" }] }).status === "QUEUED", "submitted -> QUEUED");
ok(parse({ code: 0, data: [{ status: "queued" }] }).status === "QUEUED", "queued -> QUEUED");
const fail = parse({ code: 0, data: [{ status: "failed", message: "policy violation" }] });
ok(fail.status === "FAILURE" && fail.reason === "policy violation", "failed carries reason");
ok(parse({ code: 1301, message: "sensitive word" }).status === "FAILURE", "envelope error -> FAILURE");
ok(parse({ code: 0, data: [{ status: "not_completed" }] }).status !== "SUCCESS", "not_completed never SUCCESS");
ok(parse({ code: 0, data: [{ status: "unpaid" }] }).status !== "FAILURE", "unpaid not substring-matched to failure");
ok(parse({ code: 0, data: [{ status: "weird" }] }).status === "QUEUED", "unknown status -> QUEUED, never UNKNOWN");
ok(parse({ code: 0, data: [{ message: "boom" }] }).status === "FAILURE", "failure signal beats missing status");
ok(parse({ code: 0, data: [{ outputs: [{ type: "video", url: "https://cos/y.mp4" }] }] }).status === "SUCCESS", "result url fallback");
ok(parse(JSON.stringify(doneEnvelope)).status === "SUCCESS", "string body parsed");
throws(function () { parse({}, 500); }, "5xx throws for retry");
throws(function () { parse({}, 429); }, "429 throws for retry");
throws(function () { parse({}, 408); }, "408 throws for retry");

// ---- 7. artifact ----
const doneTask = { status: "SUCCESS", task_id: "pub-1", url: "https://cos/x.mp4", data: doneEnvelope };
const arts = plugin.listArtifacts(doneTask);
ok(arts.length === 1 && arts[0].key === "video" && arts[0].mimeType === "video/mp4", "artifact listed");
ok(!("url" in arts[0]), "listArtifacts does not leak url");
ok(plugin.listArtifacts({ status: "IN_PROGRESS", data: doneEnvelope }).length === 0, "no artifacts before success");
const content = plugin.buildContentRequest({ data: doneEnvelope, artifactKey: "video", clientRequest: { method: "GET" } });
ok(content.url === "https://cos/x.mp4" && content.credentialless === true && !content.headers, "credentialless, no channel auth");
ok(plugin.buildContentRequest({ data: doneEnvelope, artifactKey: "video", clientRequest: { method: "HEAD" } }).method === "HEAD", "HEAD passthrough");
throws(function () { plugin.buildContentRequest({ data: doneEnvelope, artifactKey: "x", clientRequest: { method: "GET" } }); }, "unknown artifact key");

// ---- 8. usage ----
const usageText = plugin.extractUsage({ requestBody: decodeNative({ model: "kling-video-v3", prompt: "p", duration: 10, size: "1080p" }).requestBody });
ok(eq(usageText, { seconds: 10, resolution: "1080p", input_images: 0, input_videos: 0 }), "usage text-to-video");
ok(eq(Object.keys(usageText).sort(), schemaKeys), "extractUsage facts cover usageSchema");
const usageImage = plugin.extractUsage({
  requestBody: decodeNative({ model: "kling-video-v3", prompt: "p", image: "https://i/a.jpg", image_tail: "https://i/b.jpg" }).requestBody,
});
ok(usageImage.input_images === 2, "usage counts frames");
const usageOmni = plugin.extractUsage({
  requestBody: decodeNative({ model: "kling-video-v3-omni", prompt: "p", metadata: { base_video: "https://v/a.mp4" } }).requestBody,
});
ok(usageOmni.input_videos === 1, "usage counts videos");
ok(plugin.extractUsage({ requestBody: {}, usagePurpose: "billing_ratios" }) === null, "billing_ratios null");
const usageBroken = plugin.extractUsage({ requestBody: { adapterMode: "heterogeneous", payload: { endpoint: "text-to-video", body: { model: "kling-video-v3" } } } });
ok(usageBroken.seconds === 5 && usageBroken.resolution === "720p", "usage falls back to defaults on invalid body");
ok(!hasOwn(usageBroken, "tokens"), "tokens is not a usage fact");
const onComplete = plugin.extractUsageOnComplete({}, {}, doneEnvelope);
ok(eq(Object.keys(onComplete), ["seconds"]) && onComplete.seconds === 10.041, "usage on complete backfills real duration only");
ok(plugin.extractUsageOnComplete({}, {}, { code: 0, data: [{ status: "processing" }] }) === null, "no usage before success");

// ---- 9. native renderer ----
const created = plugin.native.createdVideo({}, { task_id: "pub-1", status: "QUEUED", data: submitBody });
ok(created.data.id === "pub-1" && created.data.status === "submitted", "createdVideo submitted");
ok(created.code === 0 && created.message === "SUCCEED", "createdVideo envelope");
const queried = plugin.native.queryVideo({}, doneTask);
ok(queried.data[0].id === "pub-1" && queried.data[0].status === "succeeded" && queried.data[0].url === "https://cos/x.mp4", "queryVideo succeeded");
ok(queried.tokenhub_usage.total_tokens === 600000, "queryVideo exposes tokenhub_usage");

// ---- 10. OpenAI 协议 ----
const respIntent = plugin.protocols.openai_responses.decodeRequest({
  body: { kind: "json", value: { model: "kling-video-v3", input: "a cat", seconds: 10, size: "1080p" } },
  upstreamModel: "kling-video-v3",
});
ok(respIntent.kind === "submit" && respIntent.requestBody.adapterMode === "heterogeneous", "responses heterogeneous intent");
const respReq = send(respIntent);
ok(respReq.url.endsWith("/text-to-video") && respReq.body.settings.duration === 10, "responses text-to-video");
const respImage = plugin.protocols.openai_responses.decodeRequest({
  body: {
    kind: "json",
    value: {
      model: "kling-video-v3",
      input: [
        { type: "input_text", text: "move" },
        { type: "input_image", image_url: { url: "https://i/a.jpg" } },
      ],
    },
  },
  upstreamModel: "kling-video-v3",
});
ok(send(respImage).url.endsWith("/image-to-video"), "responses image-to-video");
ok(send(respImage).body.contents[1].url === "https://i/a.jpg", "responses image mapped to first_frame");
throws(function () {
  plugin.protocols.openai_responses.decodeRequest({ body: { kind: "json", value: { model: "kling-video-v3" } }, upstreamModel: "kling-video-v3" });
}, "responses empty input rejected", "input is required");
throws(function () {
  plugin.protocols.openai_responses.decodeRequest({ body: { kind: "json", value: {} } });
}, "responses missing model rejected");

const events = plugin.protocols.openai_responses.renderEvents({ artifacts: { video: { url: "https://cos/x.mp4" } } }, { status: "SUCCESS", url: "https://cos/x.mp4" }, null);
ok(events.done === true && events.events[0].data.indexOf("<video") === 0, "renderEvents emits video tag");
ok(plugin.protocols.openai_responses.renderEvents({}, { status: "SUCCESS", url: "u" }, { status: "SUCCESS" }).events.length === 0, "no duplicate success event");
ok(plugin.protocols.openai_responses.renderEvents({}, { status: "FAILURE", reason: "boom" }, null).events[0].code === "task_failed", "failure event");
ok(plugin.protocols.openai_responses.renderEvents({}, { status: "IN_PROGRESS" }, null).done === false, "progress not done");
const final = plugin.protocols.openai_responses.renderFinal({ artifacts: { video: { url: "https://cos/x.mp4" } } }, { status: "SUCCESS" });
ok(final.output[0].content[0].text.indexOf("<video") === 0 && final.metadata.vendor === "kling", "renderFinal shape");

const videoIntent = plugin.protocols.openai_video.decodeRequest({
  body: { kind: "json", value: { model: "kling-video-v3", prompt: "p", input_reference: "https://i/a.jpg", seconds: "6" } },
  upstreamModel: "kling-video-v3",
});
const videoReq = send(videoIntent);
ok(videoReq.url.endsWith("/image-to-video") && videoReq.body.settings.duration === 6, "openai_video image-to-video");
const videoMultipart = plugin.protocols.openai_video.decodeRequest({
  body: {
    kind: "multipart",
    fields: { model: ["kling-video-v3"], prompt: ["p"], seconds: ["10"] },
    files: [{ field: "input_reference" }],
  },
  upstreamModel: "kling-video-v3",
});
ok(videoMultipart.requestBody.payload.body.firstFrame.__fileRef === "request_file:input_reference", "multipart file ref");
throws(function () {
  plugin.protocols.openai_video.decodeRequest({ body: { kind: "multipart", fields: {}, files: [{ field: "other" }] }, upstreamModel: "kling-video-v3" });
}, "unexpected multipart field rejected", "unexpected file field");
const videoRender = plugin.protocols.openai_video.render({ artifacts: { video: { url: "https://cos/x.mp4" } } }, {
  task_id: "t",
  model: "kling-video-v3",
  status: "SUCCESS",
  progress: "100%",
  url: "https://cos/x.mp4",
});
ok(videoRender.object === "video" && videoRender.status === "completed" && videoRender.url === "https://cos/x.mp4", "openai_video render");

// ---- 路由矩阵：模型名直接写在端点上 ----
// 每条 POST 路径 = /kling/<endpoint>/<规范模型名>，端点与模型都由路径锁定。
const MODEL_ROUTES = [
  ["/kling/text-to-video/kling-video-v3", "text-to-video", "kling-video-v3"],
  ["/kling/text-to-video/kling-video-v3-turbo", "text-to-video", "kling-video-v3-turbo"],
  ["/kling/text-to-video/kling-video-v2.6", "text-to-video", "kling-video-v2.6"],
  ["/kling/text-to-video/kling-video-v2.5-turbo", "text-to-video", "kling-video-v2.5-turbo"],
  ["/kling/image-to-video/kling-video-v3", "image-to-video", "kling-video-v3"],
  ["/kling/image-to-video/kling-video-v3-turbo", "image-to-video", "kling-video-v3-turbo"],
  ["/kling/image-to-video/kling-video-v2.6", "image-to-video", "kling-video-v2.6"],
  ["/kling/image-to-video/kling-video-v2.5-turbo", "image-to-video", "kling-video-v2.5-turbo"],
  ["/kling/omni-video/kling-video-v3-omni", "omni-video", "kling-video-v3-omni"],
  ["/kling/omni-video/kling-video-o1", "omni-video", "kling-video-o1"],
];

MODEL_ROUTES.forEach(function (item) {
  const path = item[0];
  const endpoint = item[1];
  const model = item[2];
  const route = meta.routes.filter(function (r) {
    return r.path === path && r.method === "POST";
  })[0];
  ok(!!route, "route declared: " + path);
  if (!route) return;
  ok(typeof plugin.native[route.decode] === "function", "decode exported: " + path);
  ok(path === "/kling/" + endpoint + "/" + model, "path spells endpoint + canonical model: " + path);

  // 故意在 body 里塞一个不相干的 model，验证路径值胜出
  const body = { model: "kling-video-v2.5-turbo", prompt: "a cat" };
  if (endpoint === "image-to-video") {
    body.contents = [
      { type: "prompt", text: "a cat" },
      { type: "first_frame", url: "https://x/a.jpg" },
    ];
    delete body.prompt;
  }
  if (endpoint === "omni-video") {
    body.contents = [
      { type: "prompt", text: "a cat" },
      { type: "base_video", url: "https://x/a.mp4" },
    ];
    delete body.prompt;
  }
  const decoded = plugin.native[route.decode]({
    body: { kind: "json", value: body },
  });
  ok(decoded.kind === "submit", "decode kind: " + path);
  ok(decoded.model === model, "path locks model " + model + ": " + path);
  ok(decoded.requestBody.payload.endpoint === endpoint, "path locks endpoint " + endpoint + ": " + path);
  ok(decoded.requestBody.payload.body.model === model, "path rewrites body.model: " + path);
  ok(
    decoded.requestBody.adapterMode === "isomorphic" || decoded.requestBody.adapterMode === "heterogeneous",
    "adapterMode valid: " + path
  );
});

ok(MODEL_ROUTES.length === 10, "route matrix covers 10 submit paths");
// 每个模型都至少有一条路由，六个模型全覆盖
const routedModels = MODEL_ROUTES.map(function (r) {
  return r[2];
}).filter(function (m, i, arr) {
  return arr.indexOf(m) === i;
}).sort();
ok(eq(routedModels, meta.models.slice().sort()), "routes cover exactly meta.models");

// 路由形状唯一，且 GET 查询只有一条。
const shapes = meta.routes.map(function (r) {
  return r.method + " " + r.path.replace(/:[^/]+/g, ":x");
});
ok(new Set(shapes).size === shapes.length, "no duplicate route shapes");
ok(
  meta.routes.filter(function (r) {
    return r.method === "GET";
  }).length === 1,
  "single query route"
);
ok(meta.routes.length === 11, "11 routes total (10 submit + 1 query)");

console.log("\npassed=" + passed + " failed=" + failed);
if (failed > 0) process.exit(1);
