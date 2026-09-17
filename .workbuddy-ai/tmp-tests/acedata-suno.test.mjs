// acedata-suno 1.0.11 合同测试（纯函数，无网络）
import * as P from "../../plugins/tasks/acedata-suno/1.0.11/plugin.js";

let passed = 0;
const failures = [];
// 用例级输出：test-runner 解析 `✓/✗ label` 生成报告并做跨版本回归比对，勿删。
function mark(kind, name) { console.log("  " + kind + " " + name); }
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; mark("✓", name); } else { failures.push(name + "\n  expected: " + b + "\n  actual:   " + a); mark("✗", name); }
}
function ok(cond, name) { if (cond) { passed++; mark("✓", name); } else { failures.push(name); mark("✗", name); } }
function throws(fn, re, name) {
  try { fn(); failures.push(name + " (did not throw)"); mark("✗", name); }
  catch (e) {
    if (re.test(String(e.message))) { passed++; mark("✓", name); }
    else { failures.push(name + " (wrong message: " + e.message + ")"); mark("✗", name); }
  }
}
function jsonCtx(value) { return { body: { kind: "json", value: value } }; }

// ---------- meta 约定 ----------
ok(P.meta.author.name === "Jushenzhidao", "meta.author");
ok(P.meta.channelTypes[0] === 10007, "meta.channelType 10007");
ok(P.meta.version === "1.0.11", "meta.version matches dir");
ok(P.meta.fetchMode === "batch", "meta.fetchMode batch");
ok(P.meta.usageSchema.clips.unit === "count", "usageSchema clips unit");
// 三条官方路由：submit(:action) / dynamic(批量 fetch) / query(单 fetch)
const routeMap = {};
for (const r of P.meta.routes) routeMap[r.type + " " + r.method + " " + r.path] = r;
ok(!!routeMap["submit POST /suno/submit/:action"], "route: POST /suno/submit/:action (submit)");
ok(!!routeMap["dynamic POST /suno/fetch"], "route: POST /suno/fetch (dynamic batch query)");
ok(!!routeMap["query GET /suno/fetch/:task_id"], "route: GET /suno/fetch/:task_id (query)");
ok(routeMap["submit POST /suno/submit/:action"].decode === "submitAction", "submit route decode hook");
ok(routeMap["dynamic POST /suno/fetch"].decode === "fetchBatch", "dynamic route has decode");
ok(routeMap["dynamic POST /suno/fetch"].render === "fetchTasks", "dynamic route has render");
ok(routeMap["query GET /suno/fetch/:task_id"].decode === undefined, "query route prohibits decode");
ok(!P.meta.routes.some(r => r.models), "native Suno routes do not require top-level model");
ok(P.meta.routes.filter(r => r.type === "query").every(r => r.path.includes(":task_id")), "query route has :task_id");

// ---------- :action 分派 ----------
function actionCtx(action, value) { return { params: { action: action }, body: { kind: "json", value: value } }; }
eq(P.native.submitAction(actionCtx("music", { prompt: "la", mv: "chirp-v4" })).requestBody.payload.operation, "generate", ":action music -> generate");
eq(P.native.submitAction(actionCtx("MUSIC", { prompt: "la", mv: "chirp-v4" })).requestBody.payload.operation, "generate", ":action case-insensitive");
eq(P.native.submitAction(actionCtx("lyrics", { prompt: "dance" })).requestBody.payload.kind, "lyrics", ":action lyrics");
eq(P.native.submitAction(actionCtx("concat", { clip_id: "c-1" })).requestBody.payload.operation, "concat", ":action concat");
throws(() => P.native.submitAction(actionCtx("cover", {})), /action must be one of/, "unknown action rejected");
throws(() => P.native.submitAction(actionCtx("music", {})), /prompt/, "music action still validates body");

// ---------- POST /suno/fetch 批量查询（dynamic） ----------
eq(P.native.fetchBatch(jsonCtx({ ids: ["a", " b ", "", "c"] })), { kind: "query", taskIds: ["a", "b", "c"] }, "batch decode normalizes ids");
eq(P.native.fetchBatch(jsonCtx({ ids: ["a"], action: "MUSIC" })).taskIds, ["a"], "batch decode accepts MUSIC action");
eq(P.native.fetchBatch(jsonCtx({ ids: ["a"], action: "lyrics" })).taskIds, ["a"], "batch decode accepts lowercase action");
throws(() => P.native.fetchBatch(jsonCtx({})), /ids must be an array/, "batch requires ids array");
throws(() => P.native.fetchBatch(jsonCtx({ ids: [] })), /at least one task id/, "batch rejects empty ids");
throws(() => P.native.fetchBatch(jsonCtx({ ids: "a" })), /ids must be an array/, "batch rejects string ids");
throws(() => P.native.fetchBatch(jsonCtx({ ids: ["a"], action: "VIDEO" })), /action must be MUSIC or LYRICS/, "batch rejects bad action");
throws(() => P.native.fetchBatch({ body: { kind: "none" } }), /JSON body required/, "batch requires json body");

// ---------- decode: 自定义模式（音乐） ----------
const custom = P.native.submitMusic(jsonCtx({ prompt: "[Verse]\nhello", tags: "emotional punk", title: "City Lights", mv: "chirp-v4" }));
eq(custom.kind, "submit", "custom kind");
eq(custom.model, "suno_music", "custom model");
eq(custom.action, "generate", "custom action");
eq(custom.requestBody.adapterMode, "heterogeneous", "custom adapterMode");
eq(custom.requestBody.payload, { kind: "music", mv: "chirp-v4", instrumental: false, operation: "generate", custom: true, lyric: "[Verse]\nhello", title: "City Lights", style: "emotional punk", extras: {} }, "custom normalized");

// 灵感模式
const inspo = P.native.submitMusic(jsonCtx({ gpt_description_prompt: "a song for christmas" }));
eq(inspo.requestBody.payload, { kind: "music", mv: "", instrumental: false, operation: "generate", custom: false, prompt: "a song for christmas", extras: {} }, "inspiration normalized");

// 互斥：prompt + gpt_description_prompt
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", gpt_description_prompt: "y" })), /mutually exclusive/, "prompt+gpt mutually exclusive");

// 纯音乐（灵感缺省歌词允许）
const inst = P.native.submitMusic(jsonCtx({ make_instrumental: true }));
eq(inst.requestBody.payload.instrumental, true, "instrumental true");
eq(inst.requestBody.payload.custom, true, "instrumental custom mode");

// 续写
const ext = P.native.submitMusic(jsonCtx({ continue_clip_id: "clip-1", continue_at: 42.5, task_id: "t-1", prompt: "more lyrics", title: "T", tags: "pop" }));
eq(ext.action, "extend", "extend action");
eq(ext.requestBody.payload, { kind: "music", mv: "", instrumental: false, operation: "extend", audioId: "clip-1", continueAt: 42.5, lyric: "more lyrics", title: "T", style: "pop", extras: {} }, "extend normalized");
eq(P.native.submitMusic(jsonCtx({ continue_clip_id: "clip-1" })).requestBody.payload.continueAt, undefined, "extend continue_at optional");
throws(() => P.native.submitMusic(jsonCtx({ continue_clip_id: "clip-1", continue_at: -1 })), /continue_at/, "extend negative continue_at");

// mv 枚举
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", mv: "chirp-v9" })), /mv must be one of/, "bad mv rejected");
// notify_hook -> acedata callback_url：/suno/audios 有该参数，转发而不是 400 拒绝
const hookMusic = P.native.submitMusic(jsonCtx({ prompt: "x", notify_hook: "https://cb.example/hook" }));
eq(hookMusic.requestBody.payload.notifyHook, "https://cb.example/hook", "notify_hook accepted (music)");
eq(P.native.submitMusic(jsonCtx({ prompt: "x", notify_hook: " http://cb.example/hook " })).requestBody.payload.notifyHook, "http://cb.example/hook", "notify_hook trimmed");
// /suno/lyrics 未声明 callback_url：接受但不转发，也不拦截请求
const hookLyrics = P.native.submitLyrics(jsonCtx({ prompt: "x", notify_hook: "https://cb.example/hook" }));
eq(hookLyrics.requestBody.payload.notifyHook, undefined, "lyrics notify_hook not forwarded");
// 只有非 URL 的垃圾值才报错
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", notify_hook: "ftp://cb" })), /absolute http\(s\) URL/, "bad notify_hook rejected (music)");
throws(() => P.native.submitLyrics(jsonCtx({ prompt: "x", notify_hook: "not-a-url" })), /absolute http\(s\) URL/, "bad notify_hook rejected (lyrics)");
// 缺输入
throws(() => P.native.submitMusic(jsonCtx({})), /prompt/, "empty music rejected");
throws(() => P.native.submitLyrics(jsonCtx({})), /prompt is required/, "empty lyrics rejected");
throws(() => P.native.submitMusic({ body: { kind: "text", value: "x" } }), /JSON body required/, "non-json rejected");

// ---------- decode: 歌词 ----------
const lyr = P.native.submitLyrics(jsonCtx({ prompt: "dance" }));
eq(lyr.model, "suno_lyrics", "lyrics model");
eq(lyr.requestBody.payload, { kind: "lyrics", operation: "lyrics", prompt: "dance" }, "lyrics normalized");

// ---------- decode: 拼接 ----------
const cat = P.native.submitConcat(jsonCtx({ clip_id: "clip-9", is_infill: false }));
eq(cat.model, "suno_music", "concat model");
eq(cat.action, "concat", "concat action");
eq(cat.requestBody.payload, { kind: "music", operation: "concat", audioId: "clip-9" }, "concat normalized");
throws(() => P.native.submitConcat(jsonCtx({})), /clip_id is required/, "concat requires clip_id");
throws(() => P.native.submitConcat(jsonCtx({ clip_id: "c", is_infill: true })), /is_infill/, "is_infill rejected");
eq(P.native.submitConcat(jsonCtx({ clip_id: "c", notify_hook: "https://cb.example/hook" })).requestBody.payload.notifyHook, "https://cb.example/hook", "notify_hook accepted (concat)");
throws(() => P.native.submitConcat(jsonCtx({ clip_id: "c", notify_hook: "ftp://cb" })), /absolute http\(s\) URL/, "bad notify_hook rejected (concat)");

// ---------- encoder / buildSubmitRequest（白名单，客户端字段不泄漏） ----------
function submitCtx(decoded) { return { requestBody: decoded.requestBody, apiKey: "KEY", baseUrl: "" }; }

const r1 = P.buildSubmitRequest(submitCtx(custom));
eq(r1.url, "https://api.acedata.cloud/suno/audios", "music submit url");
eq(r1.method, "POST", "music submit method");
eq(r1.headers.Authorization, "Bearer KEY", "bearer auth");
eq(r1.body, { action: "generate", async: true, model: "chirp-v4", custom: true, lyric: "[Verse]\nhello", title: "City Lights", style: "emotional punk" }, "custom encoded body");

// notify_hook 编码：/suno/audios 分支转 callback_url，/suno/lyrics 分支不转发
eq(P.buildSubmitRequest(submitCtx(hookMusic)).body.callback_url, "https://cb.example/hook", "notify_hook encoded as callback_url");
eq(P.buildSubmitRequest(submitCtx(hookLyrics)).body.callback_url, undefined, "lyrics body has no callback_url");
eq(P.buildSubmitRequest(submitCtx(P.native.submitConcat(jsonCtx({ clip_id: "c", notify_hook: "https://cb.example/hook" })))).body, { action: "concat", audio_id: "c", async: true, callback_url: "https://cb.example/hook" }, "concat encoded with callback_url");

// 用户实际失败请求：New API prompt 作为歌词映射到 AceData lyric，chirp-v5-5 放行 5000 字符限制
const cityLights = P.native.submitMusic(jsonCtx({
  prompt: "[Verse]\nWalking down the streets\nBeneath the city lights\nNeon signs flickering\nLighting up the night\nHeart beating faster\nLike a drum in my chest\nI'm alive in this moment\nFeeling so blessed\n\n[Verse 2]\nConcrete jungle shining\nWith its dazzling glow\nEvery corner hiding secrets that only locals know\nA symphony of chaos\nBut it's music to my ears\nThe hustle and the bustle\nWiping away my fears",
  tags: "emotional punk",
  mv: "chirp-v5-5",
  title: "City Lights",
}));
const cityLightsBody = P.buildSubmitRequest(submitCtx(cityLights)).body;
ok(cityLightsBody.custom === true, "real request custom mode");
ok(cityLightsBody.model === "chirp-v5-5", "real request model");
ok(cityLightsBody.lyric.indexOf("Walking down the streets") >= 0, "real request prompt mapped to lyric");
ok(cityLightsBody.prompt === undefined, "real custom request does not send prompt");

const r2 = P.buildSubmitRequest(submitCtx(inspo));
eq(r2.body, { action: "generate", async: true, custom: false, prompt: "a song for christmas" }, "inspiration encoded body");

const r3 = P.buildSubmitRequest(submitCtx(ext));
eq(r3.body, { action: "extend", async: true, audio_id: "clip-1", continue_at: 42.5, lyric: "more lyrics", title: "T", style: "pop" }, "extend encoded body");

const r4 = P.buildSubmitRequest(submitCtx(lyr));
eq(r4.url, "https://api.acedata.cloud/suno/lyrics", "lyrics submit url");
eq(r4.body, { prompt: "dance", async: true }, "lyrics encoded body");

const r5 = P.buildSubmitRequest(submitCtx(cat));
eq(r5.url, "https://api.acedata.cloud/suno/audios", "concat submit url");
eq(r5.body, { action: "concat", audio_id: "clip-9", async: true }, "concat encoded body");

// 未知客户端字段不泄漏
const leak = P.native.submitMusic(jsonCtx({ prompt: "x", evil_field: "boom", tags: "pop", title: "t" }));
ok(!("evil_field" in P.buildSubmitRequest(submitCtx(leak)).body), "unknown client field not leaked");

// baseUrl 覆盖
eq(P.buildSubmitRequest({ requestBody: lyr.requestBody, apiKey: "K", baseUrl: "https://proxy.example.com/" }).url, "https://proxy.example.com/suno/lyrics", "baseUrl override");

// missing adapter mode
throws(() => P.buildSubmitRequest({ requestBody: { adapterMode: "isomorphic", payload: {} } }), /missing adapter mode/, "isomorphic rejected");

// ---------- parseSubmitResponse ----------
eq(P.parseSubmitResponse({}, { body: { success: true, task_id: "task-abc", trace_id: "t" } }).taskId, "task-abc", "submit taskId");
throws(() => P.parseSubmitResponse({}, { body: { error: { code: "used_up", message: "no balance" } } }), /no balance/, "submit error surfaced");
throws(() => P.parseSubmitResponse({}, { body: {} }), /missing task_id/, "submit missing task_id");

// ---------- buildQueryRequest（POST /suno/tasks，不是 GET path param） ----------
const q = P.buildQueryRequest({ taskId: "task-abc", apiKey: "K", baseUrl: "" });
eq(q.url, "https://api.acedata.cloud/suno/tasks", "query url");
eq(q.method, "POST", "query method");
eq(q.body, { id: "task-abc", action: "retrieve" }, "query body retrieve");

// ---------- parseTaskResult 状态阶梯 ----------
const httpOK = { status: 200, headers: {} };

// 排队：无 started_at 无 response
eq(P.parseTaskResult({}, { id: "t", created_at: 1 }, httpOK), { code: 0, status: "QUEUED", progress: "0%" }, "queued");
// 进行中：started_at 已出现、无 response
eq(P.parseTaskResult({}, { id: "t", created_at: 1, started_at: 2 }, httpOK), { code: 0, status: "IN_PROGRESS", progress: "50%" }, "in progress");
// 成功：response.success + audio_url
const successEnv = { id: "t", started_at: 2, finished_at: 3, elapsed: 1, response: { success: true, task_id: "t", data: [{ id: "a", audio_url: "https://cdn.acedata.cloud/a.mp3", image_url: "https://cdn.acedata.cloud/a.png", state: "succeeded" }] } };
eq(P.parseTaskResult({}, successEnv, httpOK), { code: 0, status: "SUCCESS", progress: "100%", url: "https://cdn.acedata.cloud/a.mp3" }, "success music");
// 歌词成功：无 audio_url 但有 text
const lyricEnv = { id: "t", finished_at: 3, response: { success: true, data: [{ text: "la la", title: "T", status: "complete" }] } };
eq(P.parseTaskResult({}, lyricEnv, httpOK), { code: 0, status: "SUCCESS", progress: "100%" }, "success lyrics");
// 失败：response.error
eq(P.parseTaskResult({}, { id: "t", response: { success: false, error: { code: "api_error", message: "fetch failed" } } }, httpOK), { code: 0, status: "FAILURE", progress: "100%", reason: "fetch failed" }, "failure envelope");
// 失败信号优先于结果字段：item state=failed 时即使有 url 也不判成功
const failItems = { id: "t", finished_at: 3, response: { success: true, data: [{ state: "failed", audio_url: "https://cdn.acedata.cloud/a.mp3", metadata: { error_message: "moderation" } }] } };
eq(P.parseTaskResult({}, failItems, httpOK).status, "FAILURE", "item failure beats result url");
eq(P.parseTaskResult({}, failItems, httpOK).reason, "moderation", "item failure reason");
// 前缀而非子串：state=not_completed 不得判失败/成功 -> success=true 无产物 -> IN_PROGRESS
const notCompleted = { id: "t", response: { success: true, data: [{ state: "not_completed" }] } };
eq(P.parseTaskResult({}, notCompleted, httpOK).status, "IN_PROGRESS", "not_completed not fuzzy-matched");
// success=true 但 streaming 无 URL：继续轮询
eq(P.parseTaskResult({}, { id: "t", response: { success: true, data: [{ state: "streaming", audio_url: "" }] } }, httpOK).status, "IN_PROGRESS", "streaming keeps polling");
// 非法 URL 不算命中
eq(P.parseTaskResult({}, { id: "t", response: { success: true, data: [{ audio_url: "not-a-url" }] } }, httpOK).status, "IN_PROGRESS", "invalid url not success");
// 层 0：408/429/5xx 抛错
throws(() => P.parseTaskResult({}, { error: { message: "busy" } }, { status: 500 }), /busy/, "500 throws");
throws(() => P.parseTaskResult({}, {}, { status: 429 }), /http 429/, "429 throws");
throws(() => P.parseTaskResult({}, { error: { code: "invalid_token", message: "bad token" } }, { status: 401 }), /bad token/, "401 throws (query error, not task failure)");
// 字符串 body
eq(P.parseTaskResult({}, JSON.stringify(successEnv), httpOK).status, "SUCCESS", "string body parsed");

// ---------- 顶层平铺响应（无 request/response 包裹）：真实 acedata 获取任务结构 ----------
const flatEnv = {
  success: true,
  task_id: "e72fb249-bd5b-4e2a-b20c-8a06fea5ac14",
  trace_id: "7dbc5b6a-b2c0-4d85-9d39-fa8a8a785ccf",
  data: [
    { id: "b481b17a", title: "Under the Mistletoe", image_url: "https://cdn.acedata.cloud/e724d7f13d.png?example=image-001", lyric: "[Verse]\nla", audio_url: "https://platform2.cdn.acedata.cloud/fish/5ade0339.mp3", video_url: "", created_at: "2025-06-17T15:59:32.468Z", model: "chirp-auk", state: "succeeded", prompt: "A song for Christmas", style: "holiday, cheerful, male vocals", duration: 154.92 },
    { id: "fbf22dab", title: "Under the Mistletoe", image_url: "https://cdn.acedata.cloud/e724d7f13d.png?example=image-002", lyric: "[Verse]\nla", audio_url: "https://platform2.cdn.acedata.cloud/fish/5ade0339.mp3", video_url: "", created_at: "2025-06-17T15:59:32.468Z", model: "chirp-auk", state: "succeeded", prompt: "A song for Christmas", style: "holiday, cheerful, male vocals", duration: 158.48 },
  ],
};
eq(P.parseTaskResult({}, flatEnv, httpOK), { code: 0, status: "SUCCESS", progress: "100%", url: "https://platform2.cdn.acedata.cloud/fish/5ade0339.mp3" }, "flat top-level success shape");
eq(P.parseTaskResult({}, { success: false, task_id: "t", data: [] }, httpOK).status, "FAILURE", "flat top-level success=false");
// 无 success 标记但有终态产物：层 4 结果字段兜底
eq(P.parseTaskResult({}, { task_id: "t", data: [{ state: "succeeded", audio_url: "https://cdn.acedata.cloud/a.mp3" }] }, httpOK).status, "SUCCESS", "flat terminal items without success flag");
// 中间态不得被兜底提升为成功
eq(P.parseTaskResult({}, { task_id: "t", data: [{ state: "streaming", audio_url: "https://cdn.acedata.cloud/a.mp3" }] }, httpOK).status, "QUEUED", "streaming not promoted by fallback");
// 顶层 error envelope 仍然抛错（查询自身错误）
throws(() => P.parseTaskResult({}, { error: { code: "api_error", message: "boom" }, trace_id: "x" }, httpOK), /boom/, "flat error envelope throws");
// 平铺形状下的制品与渲染
const flatTask = { task_id: "task-pub", status: "SUCCESS", progress: "100%", data: flatEnv };
eq(P.listArtifacts(flatTask).map(a => a.key), ["audio", "image", "image_2"], "flat artifacts: duplicate audio_url deduped, empty video_url skipped");
const flatRender = P.native.fetchTask({}, flatTask);
eq(flatRender.data.action, "MUSIC", "flat render action MUSIC");
eq(flatRender.data.data.length, 2, "flat render 2 songs");
eq(flatRender.data.data[0].major_model_version, "auk", "flat major_model_version derived");
eq(flatRender.data.data[0].metadata.tags, "holiday, cheerful, male vocals", "flat style -> metadata tags");
eq(flatRender.data.data[0].image_large_url, "https://cdn.acedata.cloud/e724d7f13d.png?example=image-001", "flat image_large_url fallback");

// ---------- extractUsage ----------
eq(P.extractUsage({ usagePurpose: "billing_ratios" }), null, "billing_ratios null");
eq(P.extractUsage({ requestBody: custom.requestBody }), { clips: 2, operation: "generate" }, "usage generate");
eq(P.extractUsage({ requestBody: ext.requestBody }), { clips: 2, operation: "extend" }, "usage extend");
eq(P.extractUsage({ requestBody: lyr.requestBody }), { clips: 2, operation: "lyrics" }, "usage lyrics");
eq(P.extractUsage({ requestBody: cat.requestBody }), { clips: 1, operation: "concat" }, "usage concat");

// ---------- artifacts ----------
const doneTask = {
  status: "SUCCESS",
  task_id: "task-abc",
  data: {
    id: "task-abc",
    response: {
      success: true,
      data: [
        { id: "a", audio_url: "https://cdn.acedata.cloud/a.mp3", image_url: "https://cdn.acedata.cloud/a.png", video_url: "https://cdn.acedata.cloud/a.mp4" },
        { id: "b", audio_url: "https://cdn.acedata.cloud/b.mp3", image_url: "https://cdn.acedata.cloud/a.png", video_url: "" },
      ],
    },
  },
};
const arts = P.listArtifacts(doneTask);
eq(arts, [
  { key: "audio", type: "audio", mimeType: "audio/mpeg" },
  { key: "image", type: "image", mimeType: "image/png" },
  { key: "video", type: "video", mimeType: "video/mp4" },
  { key: "audio_2", type: "audio", mimeType: "audio/mpeg" },
], "artifact list stable keys + dedupe (shared image deduped)");
ok(!JSON.stringify(arts).includes("https://"), "listArtifacts leaks no URL");
eq(P.listArtifacts({ status: "IN_PROGRESS", data: doneTask.data }), [], "no artifacts before success");
eq(P.listArtifacts({ status: "SUCCESS", data: { response: { success: true, data: [{ audio_url: "ftp://x" }] } } }), [], "non-http url ignored");

const content = P.buildContentRequest(Object.assign({ artifactKey: "audio_2", clientRequest: { method: "GET" } }, doneTask));
eq(content, { url: "https://cdn.acedata.cloud/b.mp3", method: "GET", credentialless: true }, "content request credentialless");
const headReq = P.buildContentRequest(Object.assign({ artifactKey: "video", clientRequest: { method: "HEAD" } }, doneTask));
eq(headReq.method, "HEAD", "HEAD passthrough");
throws(() => P.buildContentRequest(Object.assign({ artifactKey: "nope", clientRequest: { method: "GET" } }, doneTask)), /artifact_not_found/, "unknown artifact key");

// 提交期 taskData（无 response 包裹）也可发现
const submitShaped = { status: "SUCCESS", data: { success: true, task_id: "t", data: [{ audio_url: "https://cdn.acedata.cloud/s.mp3" }] } };
eq(P.listArtifacts(submitShaped)[0].key, "audio", "submit-shaped envelope artifact");

// 真实 AceData 查询响应：顶层 data 直接是 New API 任务对象，必须从 data.data[] 解析 2 组制品
const realNewApiTask = {
  status: "SUCCESS",
  task_id: "task_lWEm5efFX82ePUX4SNgdVdbEoebzmwRR",
  data: {
    action: "MUSIC",
    data: [
      { audio_url: "https://cdn.acedata2.cloud/suno/one.mp3", image_url: "https://cdn2.suno.ai/image_one.jpeg", image_large_url: "https://cdn2.suno.ai/image_large_one.jpeg", video_url: "https://cdn1.suno.ai/one.mp4" },
      { audio_url: "https://cdn.acedata2.cloud/suno/two.mp3", image_url: "https://cdn2.suno.ai/image_two.jpeg", image_large_url: "https://cdn2.suno.ai/image_large_two.jpeg", video_url: "https://cdn1.suno.ai/two.mp4" },
    ],
    status: "SUCCESS",
  },
};
const realArts = P.listArtifacts(realNewApiTask);
eq(realArts, [
  { key: "audio", type: "audio", mimeType: "audio/mpeg" },
  { key: "image", type: "image", mimeType: "image/jpeg" },
  { key: "video", type: "video", mimeType: "video/mp4" },
  { key: "audio_2", type: "audio", mimeType: "audio/mpeg" },
  { key: "image_2", type: "image", mimeType: "image/jpeg" },
  { key: "video_2", type: "video", mimeType: "video/mp4" },
], "real task lists 2 audio image video groups");
eq(P.buildContentRequest({ data: realNewApiTask.data, artifactKey: "video_2", clientRequest: { method: "GET" } }), { url: "https://cdn1.suno.ai/two.mp4", method: "GET", credentialless: true }, "content context uses ctx.data snapshot");
eq(P.native.submitted({}, { task_id: "task-pub" }), { code: "success", message: "", data: "task-pub" }, "submitted render");

// 音乐查询渲染
const musicTask = {
  task_id: "task-pub", status: "SUCCESS", progress: "100%", created_at: 1716191749000,
  data: {
    id: "task-abc", created_at: 1716191749.077, started_at: 1716191786.1, finished_at: 1716191800.5,
    request: { action: "generate", prompt: "x" },
    response: { success: true, data: [{ id: "a", title: "T", state: "succeeded", model: "chirp-v4", style: "pop", lyric: "la", prompt: "x", duration: 154.4, audio_url: "https://cdn.acedata.cloud/a.mp3", image_url: "https://cdn.acedata.cloud/a.png", video_url: "" }] },
  },
};
const mr = P.native.fetchTask({}, musicTask);
eq(mr.code, "success", "fetch code");
eq(mr.data.action, "MUSIC", "fetch action MUSIC");
eq(mr.data.status, "SUCCESS", "fetch status mapped");
eq(mr.data.task_id, "task-pub", "fetch uses public task id");
eq(mr.data.submit_time, 1716191749, "submit_time seconds");
eq(mr.data.finish_time, 1716191800, "finish_time seconds");
ok(Array.isArray(mr.data.data) && mr.data.data[0].audio_url === "https://cdn.acedata.cloud/a.mp3", "song array rendered");
eq(mr.data.data[0].metadata.tags, "pop", "song metadata tags");
eq(mr.data.data[0].major_model_version, "v4", "major_model_version derived");
eq(mr.data.data[0].image_large_url, "https://cdn.acedata.cloud/a.png", "image_large_url fallback");

// 歌词查询渲染
const lyricsTask = {
  task_id: "task-lyr", status: "SUCCESS", progress: "100%",
  data: { id: "x", request: { prompt: "dance" }, started_at: 1, finished_at: 2, response: { success: true, data: [{ text: "la la", title: "Dance", status: "complete" }, { text: "other", title: "B", status: "complete" }] } },
};
const lr = P.native.fetchTask({}, lyricsTask);
eq(lr.data.action, "LYRICS", "fetch action LYRICS");
ok(!Array.isArray(lr.data.data), "lyrics data is object");
eq(lr.data.data.text, "la la", "lyrics text");

// 进行中渲染（文档枚举无 SUBMITTED：排队/进行中均渲染 IN_PROGRESS）
const pend = P.native.fetchTask({}, { task_id: "t", status: "IN_PROGRESS", progress: "50%", data: { id: "x", started_at: 1 } });
eq(pend.data.status, "IN_PROGRESS", "pending status");
eq(pend.data.data, null, "pending no data");
eq(pend.data.finish_time, 0, "pending finish_time 0");
const queued = P.native.fetchTask({}, { task_id: "t", status: "QUEUED", progress: "0%", data: {} });
eq(queued.data.status, "IN_PROGRESS", "queued rendered as IN_PROGRESS (doc enum has no SUBMITTED)");

// 失败渲染
const failR = P.native.fetchTask({}, { task_id: "t", status: "FAILURE", fail_reason: "moderation", data: {} });
eq(failR.data.status, "FAIL", "failure mapped to FAIL");
eq(failR.data.fail_reason, "moderation", "fail_reason rendered");

// 批量查询渲染（POST /suno/fetch）：data 为任务对象数组，单项形状与单查询完全一致
const batchOut = P.native.fetchTasks({}, [musicTask, lyricsTask]);
eq(batchOut.code, "success", "batch code");
ok(Array.isArray(batchOut.data), "batch data is array");
eq(batchOut.data.length, 2, "batch renders every task");
eq(batchOut.data[0].task_id, "task-pub", "batch first task id");
eq(batchOut.data[0].action, "MUSIC", "batch first action MUSIC");
eq(batchOut.data[1].action, "LYRICS", "batch second action LYRICS");
eq(JSON.stringify(batchOut.data[0]), JSON.stringify(P.native.fetchTask({}, musicTask).data), "batch item shape equals single query");
eq(P.native.fetchTasks({}, []).data, [], "empty batch renders empty array");

// ---------- acedata 扩展字段（白名单 + 逐项校验） ----------
// 全量扩展字段透传
const rich = P.native.submitMusic(jsonCtx({
  prompt: "la", tags: "pop", title: "T", mv: "chirp-v5",
  negative_tags: "metal", vocal_gender: "F", variation_category: "High",
  weirdness: 0.7, style_influence: 0.3, duration: 120, persona_id: "p-1",
}));
eq(rich.requestBody.payload.extras, { negativeTags: "metal", vocalGender: "f", variationCategory: "high", weirdness: 0.7, styleInfluence: 0.3, duration: 120, personaId: "p-1" }, "extras normalized");
const richBody = P.buildSubmitRequest(submitCtx(rich)).body;
eq(richBody.negative_tags, "metal", "extras encoded negative_tags");
eq(richBody.vocal_gender, "f", "extras encoded vocal_gender");
eq(richBody.variation_category, "high", "extras encoded variation_category");
eq(richBody.weirdness, 0.7, "extras encoded weirdness");
eq(richBody.style_influence, 0.3, "extras encoded style_influence");
eq(richBody.duration, 120, "extras encoded duration");
eq(richBody.persona_id, "p-1", "extras encoded persona_id");

// 版本门槛
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", mv: "chirp-v4", vocal_gender: "m" })), /chirp-v4-5 or later/, "vocal_gender needs v4-5+");
ok(P.native.submitMusic(jsonCtx({ prompt: "x", mv: "chirp-v4-5", vocal_gender: "m" })).requestBody.payload.extras.vocalGender === "m", "vocal_gender ok on v4-5");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", mv: "chirp-v4-5", variation_category: "high" })), /chirp-v5 or later/, "variation_category needs v5+");
// 缺省模型 = chirp-v4：vocal_gender 拒绝
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", vocal_gender: "m" })), /chirp-v4-5 or later/, "vocal_gender rejected on default model");
// 枚举/范围
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", mv: "chirp-v5", vocal_gender: "x" })), /'m' or 'f'/, "bad vocal_gender");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", weirdness: 1.5 })), /between 0 and 1/, "weirdness range");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", style_influence: -0.1 })), /between 0 and 1/, "style_influence range");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", duration: 5 })), /between 10 and 360/, "duration range low");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", duration: 120.5 })), /integer/, "duration integer");
// 灵感模式限制（negative_tags/weirdness/style_influence/duration 仅自定义模式）
throws(() => P.native.submitMusic(jsonCtx({ gpt_description_prompt: "x", negative_tags: "metal" })), /custom mode/, "negative_tags custom only");
throws(() => P.native.submitMusic(jsonCtx({ gpt_description_prompt: "x", weirdness: 0.5 })), /custom mode/, "weirdness custom only");
throws(() => P.native.submitMusic(jsonCtx({ gpt_description_prompt: "x", duration: 60 })), /custom mode/, "duration custom only");
// lyric_prompt：仅 custom 且歌词为空
const lp = P.native.submitMusic(jsonCtx({ lyric_prompt: "a story about rain", tags: "pop", title: "Rain" }));
eq(lp.requestBody.payload.extras.lyricPrompt, "a story about rain", "lyric_prompt accepted without prompt");
eq(P.buildSubmitRequest(submitCtx(lp)).body.lyric_prompt, "a story about rain", "lyric_prompt encoded");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "la", lyric_prompt: "x" })), /prompt \(lyrics\) is empty/, "lyric_prompt conflicts with prompt");
throws(() => P.native.submitMusic(jsonCtx({ gpt_description_prompt: "x", lyric_prompt: "y" })), /custom mode/, "lyric_prompt custom only");

// 字符上限按模型档位
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x".repeat(3001), mv: "chirp-v4" })), /3000 characters/, "lyric limit v4");
ok(P.native.submitMusic(jsonCtx({ prompt: "x".repeat(3001), mv: "chirp-v4-5" })).requestBody.payload.lyric.length === 3001, "lyric 3001 ok on v4-5");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x".repeat(5001), mv: "chirp-v5-5" })), /5000 characters/, "lyric limit v5-5");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", tags: "y".repeat(201), mv: "chirp-v4" })), /200 characters/, "style limit v4");
throws(() => P.native.submitMusic(jsonCtx({ prompt: "x", title: "y".repeat(81), mv: "chirp-v4" })), /80 characters/, "title limit v4");
throws(() => P.native.submitMusic(jsonCtx({ gpt_description_prompt: "y".repeat(501) })), /500 characters/, "gpt prompt limit 500");

// extend：extras 也可用（如 persona_id），未知字段仍不泄漏
const ext2 = P.native.submitMusic(jsonCtx({ continue_clip_id: "clip-1", persona_id: "p-9", evil: 1 }));
eq(ext2.requestBody.payload.extras, { personaId: "p-9" }, "extend extras");
const ext2Body = P.buildSubmitRequest(submitCtx(ext2)).body;
eq(ext2Body, { action: "extend", async: true, audio_id: "clip-1", persona_id: "p-9" }, "extend without continue_at encoded (optional)");

// ---------- 批量查询（fetchMode: batch / retrieve_batch） ----------
const itemA = {
  _id: "66d2add5550a4144a5a88dfe", id: "eae26f89-b64b-404d-a80c-761996660b1c",
  created_at: 1725083093.077, started_at: 1725083093.137, finished_at: 1725083131.537, elapsed: 38.4,
  request: { action: "generate", prompt: "A song for Christmas" },
  response: { success: true, task_id: "eae26f89-b64b-404d-a80c-761996660b1c", data: [
    { id: "b8a4f691", title: "Holiday Wishes", audio_url: "https://platform2.cdn.acedata.cloud/fish/5ade0339.mp3", video_url: "https://platform2.cdn.acedata.cloud/gemini/04a043bd.mp4", image_url: "https://cdn.acedata.cloud/e724d7f13d.png", model: "chirp-v3.5", style: "pop", duration: 154.44, lyric: "l", prompt: "A song for Christmas" },
    { id: "1a3343b2", title: "Holiday Wishes", audio_url: "https://platform2.cdn.acedata.cloud/fish/5ade0339.mp3", video_url: "https://platform2.cdn.acedata.cloud/gemini/04a043bd.mp4", image_url: "https://cdn.acedata.cloud/e724d7f13d.png", model: "chirp-v3.5", style: "pop", duration: 147.16, lyric: "l", prompt: "A song for Christmas" },
  ] },
};
const itemB = {
  _id: "66d2b03c550a4144a5a8d93d", id: "0d3ed03b-912b-4f7d-941b-8441323cb77b",
  created_at: 1725083708.53, started_at: 1725083708.59, finished_at: 1725083746.99,
  request: { prompt: "la la la" },
  response: { success: true, task_id: "0d3ed03b-912b-4f7d-941b-8441323cb77b", data: [{ id: "b4f498b2", text: "la la", title: "La La La", status: "complete" }] },
};

// 请求：action=retrieve_batch + ids
const batchReq = P.buildBatchQueryRequest({ apiKey: "KEY", baseUrl: "" }, [{ taskId: "eae26f89" }, { taskId: "0d3ed03b" }, { taskId: "  " }]);
eq(batchReq.url, "https://api.acedata.cloud/suno/tasks", "batch query url");
eq(batchReq.method, "POST", "batch query method");
eq(batchReq.body, { action: "retrieve_batch", ids: ["eae26f89", "0d3ed03b"] }, "batch query body drops empty ids");

// 响应：真实批量结构 { items, count }
const batchBody = { items: [itemA, itemB], count: 2 };
const batchParsed = P.parseBatchResult({}, batchBody, httpOK);
eq(batchParsed.length, 2, "batch returns one result per item");
eq(batchParsed.map(r => r.taskId), ["eae26f89-b64b-404d-a80c-761996660b1c", "0d3ed03b-912b-4f7d-941b-8441323cb77b"], "batch taskIds from items[].id");
eq(batchParsed.map(r => r.status), ["SUCCESS", "SUCCESS"], "batch statuses");
eq(batchParsed.map(r => r.action), ["generate", "lyrics"], "batch action: request.action or lyrics");
eq(batchParsed[0].progress, "100%", "batch progress");
eq(batchParsed[0].submitTime, 1725083093, "batch submit_time seconds");
eq(batchParsed[0].finishTime, 1725083131, "batch finish_time seconds");
ok(batchParsed[0].data.response.success === true, "batch persists whole envelope");

// 顺序无关：上游打乱返回顺序，结果仍按 id 归属
const shuffled = P.parseBatchResult({}, { items: [itemB, itemA], count: 2 }, httpOK);
eq(shuffled[0].taskId, "0d3ed03b-912b-4f7d-941b-8441323cb77b", "batch order independent (1)");
eq(shuffled[1].action, "generate", "batch order independent (2)");

// 批量结果里的 data 直接喂给制品与渲染（与单查路径一致）
const batchTask = { task_id: "task-pub", status: batchParsed[0].status, progress: "100%", data: batchParsed[0].data };
eq(P.listArtifacts(batchTask).map(a => a.key), ["audio", "image", "video"], "batch artifacts from persisted item");
eq(P.native.fetchTask({}, batchTask).data.action, "MUSIC", "batch render MUSIC");

// 批量端点自身错误 -> 抛错重试，不把整批判成任务失败
throws(() => P.parseBatchResult({}, { error: { code: "too_many_requests", message: "rate limited" } }, httpOK), /rate limited/, "batch error envelope throws");
throws(() => P.parseBatchResult({}, {}, { status: 429 }), /http 429/, "batch 429 throws");
// 无 id 的脏数据跳过；上游退化成单包裹体时按单元素处理
eq(P.parseBatchResult({}, { items: [{ response: { success: true } }, itemA], count: 1 }, httpOK).length, 1, "batch skips item without id");
eq(P.parseBatchResult({}, itemA, httpOK).map(r => r.taskId), ["eae26f89-b64b-404d-a80c-761996660b1c"], "batch falls back to single envelope");

// ---------- 汇总 ----------
if (failures.length) {
  console.log("FAILED " + failures.length + " (passed " + passed + ")");
  failures.forEach(f => console.log("✗ " + f));
  process.exit(1);
}
console.log("ALL PASS: " + passed + " assertions");
