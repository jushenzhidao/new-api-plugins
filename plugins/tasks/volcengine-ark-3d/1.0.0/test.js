// Contract tests for volcengine-ark-3d plugin
import * as plugin from "./plugin.js";

const meta = plugin.meta;

// ============================================================================
// Meta & Convention Checks
// ============================================================================

console.log("✓ Meta check: author.name =", meta.author.name);
if (meta.author.name !== "Jushenzhidao") {
  throw new Error("FAIL: meta.author.name must be 'Jushenzhidao'");
}

console.log("✓ Meta check: channelTypes =", meta.channelTypes);
if (!Array.isArray(meta.channelTypes) || meta.channelTypes[0] !== 10001) {
  throw new Error("FAIL: channelTypes must be [10001]");
}

console.log("✓ Meta check: version =", meta.version);
if (meta.version !== "1.0.0") {
  throw new Error("FAIL: version must be 1.0.0");
}

console.log("✓ Meta check: key =", meta.key);
if (meta.key !== "volcengine-ark-3d") {
  throw new Error("FAIL: key mismatch");
}

// ============================================================================
// Native Decode - Isomorphic Mode
// ============================================================================

console.log("\n--- Native Decode Tests ---");

const minimalCtx = {
  body: {
    kind: "json",
    value: {
      model: "doubao-seed3d-2-0-260328",
      content: [
        {
          type: "text",
          text: "--subdivisionlevel medium --fileformat glb",
        },
        {
          type: "image_url",
          image_url: {
            url: "https://example.com/input.png",
          },
        },
      ],
    },
  },
  model: "doubao-seed3d-2-0-260328",
};

const decodeResult = plugin.native.create3D(minimalCtx);
console.log("✓ Decode result:", JSON.stringify(decodeResult, null, 2));

if (decodeResult.kind !== "submit") {
  throw new Error("FAIL: decode must return kind=submit");
}
if (decodeResult.model !== "doubao-seed3d-2-0-260328") {
  throw new Error("FAIL: decode must preserve model");
}
if (decodeResult.action !== "image_to_3d") {
  throw new Error("FAIL: decode action must be image_to_3d");
}
if (!decodeResult.requestBody || decodeResult.requestBody.adapterMode !== "isomorphic") {
  throw new Error("FAIL: decode must return adapterMode=isomorphic in requestBody");
}

const payload = decodeResult.requestBody.payload;
if (!payload.content || !Array.isArray(payload.content)) {
  throw new Error("FAIL: isomorphic payload must preserve content array");
}
if (payload.content.length !== 2) {
  throw new Error("FAIL: isomorphic payload must preserve all content items");
}

console.log("✓ Isomorphic decode preserves structure");

// Test unknown field preservation
const withUnknownCtx = {
  body: {
    kind: "json",
    value: {
      model: "hyper3d-gen2-260112",
      content: [{ type: "text", text: "test prompt" }],
      seed: 8648,
      callback_url: "https://example.com/callback",
      vendor_extension: { custom: true },
    },
  },
  model: "hyper3d-gen2-260112",
};

const unknownResult = plugin.native.create3D(withUnknownCtx);
const unknownPayload = unknownResult.requestBody.payload;
if (unknownPayload.seed !== 8648) {
  throw new Error("FAIL: must preserve seed field");
}
if (!unknownPayload.callback_url) {
  throw new Error("FAIL: must preserve callback_url");
}
if (!unknownPayload.vendor_extension || !unknownPayload.vendor_extension.custom) {
  throw new Error("FAIL: must preserve unknown vendor fields");
}
console.log("✓ Isomorphic mode preserves unknown fields");

// Test false/0/null preservation
const edgeCaseCtx = {
  body: {
    kind: "json",
    value: {
      model: "hitem3d-2-0-251223",
      content: [{ type: "image_url", image_url: { url: "https://example.com/img.png" } }],
      seed: 0,
      use_cache: false,
      custom_field: null,
      empty_array: [],
    },
  },
  model: "hitem3d-2-0-251223",
};

const edgeResult = plugin.native.create3D(edgeCaseCtx);
const edgePayload = edgeResult.requestBody.payload;
if (edgePayload.seed !== 0) {
  throw new Error("FAIL: must preserve seed=0");
}
if (edgePayload.use_cache !== false) {
  throw new Error("FAIL: must preserve false");
}
if (edgePayload.custom_field !== null) {
  throw new Error("FAIL: must preserve null");
}
if (!Array.isArray(edgePayload.empty_array) || edgePayload.empty_array.length !== 0) {
  throw new Error("FAIL: must preserve empty array");
}
console.log("✓ Isomorphic mode preserves 0/false/null/empty arrays");

// ============================================================================
// Build Submit Request
// ============================================================================

console.log("\n--- Build Submit Request Tests ---");

const submitCtx = {
  baseUrl: "https://ark.cn-beijing.volces.com",
  apiKey: "test-key-placeholder",
  model: "doubao-seed3d-2-0-260328",
  upstreamModel: "doubao-seed3d-2-0-260328",
  requestBody: {
    adapterMode: "isomorphic",
    payload: {
      model: "doubao-seed3d-2-0-260328",
      content: [
        { type: "text", text: "--subdivisionlevel high --fileformat glb" },
        { type: "image_url", image_url: { url: "https://example.com/input.png" } },
      ],
    },
  },
};

const submitReq = plugin.buildSubmitRequest(submitCtx);
console.log("✓ Submit request:", JSON.stringify(submitReq, null, 2));

if (submitReq.url !== "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks") {
  throw new Error("FAIL: submit URL mismatch. Got: " + submitReq.url);
}
if (submitReq.method !== "POST") {
  throw new Error("FAIL: submit method must be POST");
}
if (!submitReq.headers.Authorization || submitReq.headers.Authorization !== "Bearer test-key-placeholder") {
  throw new Error("FAIL: Authorization header missing or incorrect");
}
if (!submitReq.body || submitReq.body.model !== "doubao-seed3d-2-0-260328") {
  throw new Error("FAIL: body.model must match upstreamModel");
}
if (submitReq.body.new_api_internal !== undefined) {
  throw new Error("FAIL: internal fields must be removed");
}
console.log("✓ Submit request URL, headers, and body correct");

// ============================================================================
// Parse Submit Response
// ============================================================================

console.log("\n--- Parse Submit Response Tests ---");

const submitResp = {
  body: { id: "cgt-2026-test-id" },
};

const parseResult = plugin.parseSubmitResponse({}, submitResp);
console.log("✓ Parse submit response:", parseResult);

if (parseResult.taskId !== "cgt-2026-test-id") {
  throw new Error("FAIL: taskId extraction failed");
}
if (!parseResult.taskData || parseResult.taskData.id !== "cgt-2026-test-id") {
  throw new Error("FAIL: taskData must be preserved");
}
console.log("✓ Submit response parsing correct");

// Error envelope test
try {
  plugin.parseSubmitResponse({}, { body: { code: 400, message: "invalid request" } });
  throw new Error("FAIL: should throw on non-zero code");
} catch (err) {
  if (err.message.indexOf("ark 3d submit failed") < 0 && err.message.indexOf("invalid request") < 0) {
    throw err;
  }
  console.log("✓ Submit error handling correct");
}

// ============================================================================
// Build Query Request
// ============================================================================

console.log("\n--- Build Query Request Tests ---");

const queryCtx = {
  baseUrl: "https://ark.cn-beijing.volces.com",
  apiKey: "test-key-placeholder",
  taskId: "cgt-2026-test-id",
};

const queryReq = plugin.buildQueryRequest(queryCtx);
console.log("✓ Query request:", JSON.stringify(queryReq, null, 2));

if (queryReq.url !== "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-2026-test-id") {
  throw new Error("FAIL: query URL mismatch. Got: " + queryReq.url);
}
if (queryReq.method !== "GET") {
  throw new Error("FAIL: query method must be GET");
}
console.log("✓ Query request correct");

// ============================================================================
// Status Ladder Tests (6 layers)
// ============================================================================

console.log("\n--- Status Ladder Tests ---");

// Layer 0: Envelope error
const envelopeError = plugin.parseTaskResult({}, { code: 400, message: "bad request" });
if (envelopeError.status !== "FAILURE") {
  throw new Error("FAIL: layer 0 - envelope error must return FAILURE");
}
console.log("✓ Layer 0: envelope error → FAILURE");

// Layer 1/2: Declarative mapping
const succeededTask = plugin.parseTaskResult({}, { status: "succeeded" });
if (succeededTask.status !== "SUCCESS") {
  throw new Error("FAIL: layer 1 - succeeded → SUCCESS");
}
console.log("✓ Layer 1: 'succeeded' → SUCCESS");

const processingTask = plugin.parseTaskResult({}, { status: "processing" });
if (processingTask.status !== "IN_PROGRESS") {
  throw new Error("FAIL: layer 1 - processing → IN_PROGRESS");
}
console.log("✓ Layer 1: 'processing' → IN_PROGRESS");

const queuedTask = plugin.parseTaskResult({}, { status: "queued" });
if (queuedTask.status !== "QUEUED") {
  throw new Error("FAIL: layer 1 - queued → QUEUED");
}
console.log("✓ Layer 1: 'queued' → QUEUED");

const failedTask = plugin.parseTaskResult({}, { status: "failed", fail_reason: "generation error" });
if (failedTask.status !== "FAILURE" || !failedTask.reason) {
  throw new Error("FAIL: layer 1 - failed → FAILURE with reason");
}
console.log("✓ Layer 1: 'failed' → FAILURE");

// Layer 3: Fuzzy prefix matching
const completedTask = plugin.parseTaskResult({}, { status: "completed" });
if (completedTask.status !== "SUCCESS") {
  throw new Error("FAIL: layer 3 - 'completed' prefix → SUCCESS");
}
console.log("✓ Layer 3: 'completed' prefix → SUCCESS");

const runningTask = plugin.parseTaskResult({}, { status: "running" });
if (runningTask.status !== "IN_PROGRESS") {
  throw new Error("FAIL: layer 3 - 'running' prefix → IN_PROGRESS");
}
console.log("✓ Layer 3: 'running' prefix → IN_PROGRESS");

// Layer 3: Anti-pattern - substring must NOT match
const notCompletedTask = plugin.parseTaskResult({}, { status: "not_completed" });
if (notCompletedTask.status === "SUCCESS") {
  throw new Error("FAIL: layer 3 anti-pattern - 'not_completed' must NOT match 'comp' substring");
}
console.log("✓ Layer 3: 'not_completed' does NOT match 'comp' (anti-pattern check)");

// Layer 4: Result URL fallback
const urlFallbackTask = plugin.parseTaskResult({}, {
  status: "",
  content: { url: "https://example.com/result.glb" },
});
if (urlFallbackTask.status !== "SUCCESS" || !urlFallbackTask.url) {
  throw new Error("FAIL: layer 4 - content.url → SUCCESS");
}
console.log("✓ Layer 4: content.url present → SUCCESS");

// Layer 4: Must yield to failure signal
const urlButFailedTask = plugin.parseTaskResult({}, {
  status: "",
  content: { url: "https://example.com/result.glb" },
  fail_reason: "upstream error",
});
if (urlButFailedTask.status !== "FAILURE") {
  throw new Error("FAIL: layer 4 - URL must yield to failure signal");
}
console.log("✓ Layer 4: URL with fail_reason → FAILURE (signal priority)");

// Layer 5: Failure signal fallback
const unknownWithError = plugin.parseTaskResult({}, {
  status: "unknown_status_xyz",
  error: { message: "something went wrong" },
});
if (unknownWithError.status !== "FAILURE") {
  throw new Error("FAIL: layer 5 - unknown status + error → FAILURE");
}
console.log("✓ Layer 5: unknown status + error.message → FAILURE");

// Layer 6: Safe default
const totallyUnknown = plugin.parseTaskResult({}, { status: "xyz_unknown" });
if (totallyUnknown.status !== "QUEUED") {
  throw new Error("FAIL: layer 6 - unknown status → QUEUED (never UNKNOWN)");
}
console.log("✓ Layer 6: unknown status → QUEUED (safe default, never UNKNOWN)");

// ============================================================================
// Artifact Tests
// ============================================================================

console.log("\n--- Artifact Tests ---");

const successTask = {
  status: "SUCCESS",
  data: {
    content: {
      url: "https://example.com/model.glb",
    },
  },
};

const artifacts = plugin.listArtifacts(successTask);
console.log("✓ Artifacts:", JSON.stringify(artifacts, null, 2));

if (artifacts.length !== 1) {
  throw new Error("FAIL: should list 1 artifact");
}
if (artifacts[0].key !== "file" || artifacts[0].type !== "file") {
  throw new Error("FAIL: artifact key/type should be 'file'");
}
if (artifacts[0].mimeType !== "model/gltf-binary") {
  throw new Error("FAIL: default mimeType should be model/gltf-binary");
}
console.log("✓ Artifact list correct");

// Non-success task
const pendingTask = { status: "QUEUED", data: {} };
const noArtifacts = plugin.listArtifacts(pendingTask);
if (noArtifacts.length !== 0) {
  throw new Error("FAIL: pending task should have no artifacts");
}
console.log("✓ Non-success task returns empty artifacts");

// buildContentRequest
const contentCtx = {
  artifactKey: "file",
  data: { content: { url: "https://example.com/model.glb" } },
  clientRequest: { method: "GET" },
};

const contentReq = plugin.buildContentRequest(contentCtx);
if (contentReq.url !== "https://example.com/model.glb") {
  throw new Error("FAIL: content URL mismatch");
}
if (contentReq.credentialless !== true) {
  throw new Error("FAIL: content request must be credentialless");
}
console.log("✓ Content request correct and credentialless");

// Unknown artifact key
try {
  plugin.buildContentRequest({ artifactKey: "nonexistent", data: {}, clientRequest: { method: "GET" } });
  throw new Error("FAIL: should throw artifact_not_found");
} catch (err) {
  if (err.message !== "artifact_not_found") throw err;
  console.log("✓ Unknown artifact key throws correctly");
}

// ============================================================================
// Usage Extraction
// ============================================================================

console.log("\n--- Usage Extraction Tests ---");

const hyper3dUsageCtx = {
  model: "hyper3d-gen2-260112",
  upstreamModel: "hyper3d-gen2-260112",
  requestBody: { payload: { model: "hyper3d-gen2-260112" } },
};

const hyper3dUsage = plugin.extractUsage(hyper3dUsageCtx);
if (hyper3dUsage.output_tokens !== 30000) {
  throw new Error("FAIL: Hyper3D usage should be 30000 tokens");
}
console.log("✓ Hyper3D usage: 30000 tokens");

const seed3dUsageCtx = {
  model: "doubao-seed3d-2-0-260328",
  requestBody: { payload: {} },
};

const seed3dUsage = plugin.extractUsage(seed3dUsageCtx);
if (seed3dUsage.output_tokens !== 1) {
  throw new Error("FAIL: Seed3D usage should be 1 token");
}
console.log("✓ Seed3D usage: 1 token");

// ============================================================================
// Native Renderers
// ============================================================================

console.log("\n--- Native Renderer Tests ---");

const createdTask = {
  task_id: "cgt-123",
  status: "SUCCESS",
  data: { id: "cgt-123", status: "succeeded" },
};

const createdResult = plugin.native.created3D({}, createdTask);
if (createdResult.id !== "cgt-123" || createdResult.status !== "succeeded") {
  throw new Error("FAIL: created3D renderer incorrect");
}
console.log("✓ created3D renderer correct");

const queriedTask = {
  task_id: "cgt-456",
  status: "IN_PROGRESS",
  data: { task_id: "cgt-456", status: "processing" },
};

const queryResult = plugin.native.query3D({}, queriedTask);
if (queryResult.task_id !== "cgt-456" || queryResult.status !== "processing") {
  throw new Error("FAIL: query3D renderer incorrect");
}
console.log("✓ query3D renderer correct");

// ============================================================================
// Summary
// ============================================================================

console.log("\n========================================");
console.log("✅ ALL CONTRACT TESTS PASSED");
console.log("========================================");
console.log("Plugin: volcengine-ark-3d v1.0.0");
console.log("ChannelType: 10001");
console.log("Models: doubao-seed3d-2-0-260328, hyper3d-gen2-260112, hitem3d-2-0-251223");
console.log("Adapter Mode: Isomorphic (native passthrough)");
console.log("Status Ladder: 6 layers verified");
console.log("Artifact Support: ✓");
console.log("Usage Tracking: ✓");
