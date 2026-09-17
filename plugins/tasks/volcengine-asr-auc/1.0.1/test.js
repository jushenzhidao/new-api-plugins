// Contract tests for volcengine-asr-auc plugin
import * as plugin from "./plugin.js";

const meta = plugin.meta;
let pass = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  pass += 1;
  console.log("\u2713 " + msg);
}

// ============================================================================
// Meta & Convention Checks
// ============================================================================
ok(meta.author.name === "Jushenzhidao", "author.name = Jushenzhidao");
ok(Array.isArray(meta.channelTypes) && meta.channelTypes[0] === 10003, "channelTypes = [10003]");
ok(meta.version === "1.0.1", "version = 1.0.1");
ok(meta.key === "volcengine-asr-auc", "key = volcengine-asr-auc");
ok(meta.fetchMode === "per_task", "fetchMode = per_task");
ok(meta.routes.length === 2, "declares submit + query routes");

// ============================================================================
// Native Decode - Isomorphic passthrough
// ============================================================================
console.log("\n--- Native Decode ---");
const decodeCtx = {
  model: "volc.seedasr.auc",
  body: {
    kind: "json",
    value: {
      audio: { url: "https://example.com/a.mp3", format: "mp3", rate: 16000, bits: 16, channel: 1 },
      request: { model_name: "bigmodel", enable_itn: true, enable_punc: false, show_utterances: false },
    },
  },
};
const decoded = plugin.native.createASR(decodeCtx);
ok(decoded.kind === "submit", "decode returns kind=submit");
ok(decoded.model === "volc.seedasr.auc", "decode preserves model");
ok(decoded.action === "audio_to_text", "decode action = audio_to_text");
ok(decoded.requestBody.adapterMode === "isomorphic", "decode adapterMode = isomorphic");
ok(decoded.requestBody.payload.audio.url === "https://example.com/a.mp3", "payload preserves audio.url");
ok(decoded.requestBody.payload.request.enable_punc === false, "payload preserves false value");

// Missing audio.url
try { plugin.native.createASR({ model: "x", body: { kind: "json", value: { audio: {}, request: { model_name: "bigmodel" } } } }); throw new Error("no throw"); }
catch (e) { ok(e.message.indexOf("audio.url") >= 0, "rejects missing audio.url"); }
// Missing request.model_name
try { plugin.native.createASR({ model: "x", body: { kind: "json", value: { audio: { url: "https://x/a.mp3" }, request: {} } } }); throw new Error("no throw"); }
catch (e) { ok(e.message.indexOf("model_name") >= 0, "rejects missing request.model_name"); }

// ============================================================================
// Build Submit Request
// ============================================================================
console.log("\n--- Build Submit Request ---");
const submitCtx = {
  baseUrl: "https://openspeech.bytedance.com",
  apiKey: "test-key",
  model: "volc.seedasr.auc",
  upstreamModel: "volc.seedasr.auc",
  requestBody: { adapterMode: "isomorphic", payload: { audio: { url: "https://x/a.mp3", format: "mp3" }, request: { model_name: "bigmodel" }, new_api_internal: { drop: 1 } } },
};
const sreq = plugin.buildSubmitRequest(submitCtx);
ok(sreq.url === "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit", "submit URL correct");
ok(sreq.method === "POST", "submit method POST");
ok(sreq.headers["X-Api-Key"] === "test-key", "submit X-Api-Key set");
ok(sreq.headers["X-Api-Resource-Id"] === "volc.seedasr.auc", "submit X-Api-Resource-Id = model");
ok(sreq.headers["X-Api-Sequence"] === "-1", "submit X-Api-Sequence = -1");
ok(/^[0-9a-f-]{36}$/.test(sreq.headers["X-Api-Request-Id"]), "submit generates uuid X-Api-Request-Id");
ok(sreq.body.new_api_internal === undefined, "submit strips new_api_internal");
ok(sreq.body.model === undefined, "submit does NOT inject model into body (model is a header)");
ok(sreq.body.audio.url === "https://x/a.mp3", "submit preserves audio body");

// ============================================================================
// Parse Submit Response (status code in HEADER)
// ============================================================================
console.log("\n--- Parse Submit Response ---");
const psOK = plugin.parseSubmitResponse({}, {
  headers: { "X-Api-Status-Code": ["20000000"], "X-Api-Message": ["OK"], "X-Api-Request-Id": ["req-uuid-123"] },
  body: { task_id: "task-abc" },
});
ok(psOK.taskId === "task-abc", "submit taskId from body.task_id");
ok(psOK.taskData.task_id === "task-abc", "submit taskData preserved");

// task_id fallback to X-Api-Request-Id header
const psFallback = plugin.parseSubmitResponse({}, {
  headers: { "X-Api-Status-Code": ["20000000"], "X-Api-Request-Id": ["req-uuid-xyz"] },
  body: {},
});
ok(psFallback.taskId === "req-uuid-xyz", "submit taskId falls back to X-Api-Request-Id header");

// submit error via header code
try {
  plugin.parseSubmitResponse({}, { headers: { "X-Api-Status-Code": ["45000001"], "X-Api-Message": ["invalid param"] }, body: {} });
  throw new Error("no throw");
} catch (e) { ok(e.message.indexOf("invalid param") >= 0, "submit throws on non-success header code"); }

// ============================================================================
// Build Query Request (empty body, id in header)
// ============================================================================
console.log("\n--- Build Query Request ---");
const qreq = plugin.buildQueryRequest({ baseUrl: "https://openspeech.bytedance.com", apiKey: "k", model: "volc.seedasr.auc", taskId: "task-abc" });
ok(qreq.url === "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query", "query URL correct");
ok(qreq.method === "POST", "query method POST");
ok(JSON.stringify(qreq.body) === "{}", "query body is empty object");
ok(qreq.headers["X-Api-Request-Id"] === "task-abc", "query X-Api-Request-Id = taskId");
ok(qreq.headers["X-Api-Resource-Id"] === "volc.seedasr.auc", "query X-Api-Resource-Id = model");

// ============================================================================
// Parse Task Result (status from HEADER)
// ============================================================================
console.log("\n--- Parse Task Result (header-driven status) ---");
// SUCCESS via 3rd-arg response.headers
const rSuccess = plugin.parseTaskResult({}, { result: { text: "hello" } }, { status: 200, headers: { "X-Api-Status-Code": "20000000", "X-Api-Message": "OK" } });
ok(rSuccess.status === "SUCCESS" && rSuccess.progress === "100%", "20000000 header -> SUCCESS");

// IN_PROGRESS
const rProc = plugin.parseTaskResult({}, {}, { status: 200, headers: { "X-Api-Status-Code": "20000001" } });
ok(rProc.status === "IN_PROGRESS", "20000001 header -> IN_PROGRESS");

// QUEUED
const rQueue = plugin.parseTaskResult({}, {}, { status: 200, headers: { "X-Api-Status-Code": "20000002" } });
ok(rQueue.status === "QUEUED", "20000002 header -> QUEUED");

// silent audio -> FAILURE with reason
const rSilent = plugin.parseTaskResult({}, {}, { status: 200, headers: { "X-Api-Status-Code": "20000003" } });
ok(rSilent.status === "FAILURE" && rSilent.reason.indexOf("silent") >= 0, "20000003 -> FAILURE (silent)");

// param error -> FAILURE
const rParam = plugin.parseTaskResult({}, {}, { status: 200, headers: { "X-Api-Status-Code": "45000001" } });
ok(rParam.status === "FAILURE", "45000001 -> FAILURE");

// server busy 55xxxxxx -> retryable throw (no vendor message -> default text)
try {
  plugin.parseTaskResult({}, {}, { status: 200, headers: { "X-Api-Status-Code": "55000031" } });
  throw new Error("no throw");
} catch (e) { ok(e.message.indexOf("retryable") >= 0, "55000031 -> throws retryable"); }
// server code WITH vendor message -> throws the vendor message (still retryable branch)
try {
  plugin.parseTaskResult({}, {}, { status: 200, headers: { "X-Api-Status-Code": "55000031", "X-Api-Message": "busy" } });
  throw new Error("no throw");
} catch (e) { ok(e.message === "busy", "55000031 with message -> throws vendor message"); }

// 5xx HTTP -> retryable
try {
  plugin.parseTaskResult({}, {}, { status: 502, headers: {} });
  throw new Error("no throw");
} catch (e) { ok(e.message.indexOf("retryable") >= 0, "HTTP 502 -> throws retryable"); }

// legacy ctx.response fallback
const rLegacy = plugin.parseTaskResult({ response: { status: 200, headers: { "X-Api-Status-Code": "20000000" } } }, { result: { text: "x" } });
ok(rLegacy.status === "SUCCESS", "legacy ctx.response.headers still works");

// no code, but text present -> SUCCESS
const rNoCode = plugin.parseTaskResult({}, { result: { text: "recognized" } }, { status: 200, headers: {} });
ok(rNoCode.status === "SUCCESS", "no code + result.text -> SUCCESS");

// no code, no text -> safe default QUEUED (never UNKNOWN)
const rDefault = plugin.parseTaskResult({}, {}, { status: 200, headers: {} });
ok(rDefault.status === "QUEUED", "no code, no text -> QUEUED (never UNKNOWN)");

// body-echoed X-Api-Status-Code (submit-style body) also works
const rBodyCode = plugin.parseTaskResult({}, { "X-Api-Status-Code": "20000000", result: { text: "y" } }, undefined);
ok(rBodyCode.status === "SUCCESS", "body-echoed status code works when header absent");

// ============================================================================
// Native Renderers
// ============================================================================
console.log("\n--- Native Renderers ---");
const created = plugin.native.createdASR({}, { task_id: "t1", status: "QUEUED", data: { task_id: "t1" } });
ok(created.status === "queued" && created.id === "t1", "createdASR maps status + id");
const queried = plugin.native.queryASR({}, { task_id: "t2", status: "SUCCESS", data: { result: { text: "hi" } } });
ok(queried.status === "succeeded" && queried.result.text === "hi", "queryASR passes through text + maps status");

// ============================================================================
// Usage
// ============================================================================
console.log("\n--- Usage ---");
const u1 = plugin.extractUsageOnComplete({}, {}, { audio_info: { duration: 6312 } });
ok(u1.audio_seconds === 7, "usage rounds 6312ms up to 7s");
const u2 = plugin.extractUsageOnComplete({}, {}, { result: { additions: { duration: "2499" } } });
ok(u2.audio_seconds === 3, "usage falls back to result.additions.duration");
const u3 = plugin.extractUsageOnComplete({}, {}, {});
ok(Object.keys(u3).length === 0, "usage empty when duration unknown");

console.log("\n========================================");
console.log("\u2705 ALL " + pass + " CONTRACT ASSERTIONS PASSED");
console.log("Plugin: volcengine-asr-auc v1.0.0  ChannelType: 10003");
console.log("Adapter: Isomorphic | Status source: X-Api-Status-Code header");
console.log("========================================");
