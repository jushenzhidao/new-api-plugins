export const meta = {
  apiVersion: 1,
  key: "wand-vega",
  name: "WAND-Vega Image",
  icon: "Tencent.Color",
  description: {
    en: "Tencent Cloud WAND-Vega image generation (Lite/Flash/Pro)",
    zh: "腾讯云 WAND-Vega 图像生成（Lite/Flash/Pro）",
  },
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10004],
  models: ["wand-vega-image-lite", "wand-vega-image-flash", "wand-vega-image-pro"],
  fetchMode: "per_task",
  usageSchema: {
    tokens: {
      type: "number",
      unit: "token",
      description: {
        en: "Total tokens consumed for billing",
        zh: "计费消耗的 token 总数",
      },
    },
  },
  usageExamples: [
    { label: "Lite 1024x1024", facts: { tokens: 8000 } },
    { label: "Flash 2048x2048", facts: { tokens: 16000 } },
    { label: "Pro 4096x4096", facts: { tokens: 32000 } },
  ],
  protocols: [{ name: "openai_responses", supports: ["sync", "background"] }],
  routes: [
    {
      method: "POST",
      path: "/wand/vega/images/generations",
      type: "submit",
      models: ["wand-vega-image-lite", "wand-vega-image-flash", "wand-vega-image-pro"],
      decode: "createImage",
      render: "createdImage",
    },
    {
      method: "GET",
      path: "/wand/vega/images/tasks/:task_id",
      type: "query",
      taskIdParam: "task_id",
      render: "queryImage",
    },
  ],
};

function trimmed(value) {
  return String(value || "").trim();
}

function metadataOf(req) {
  return req && req.metadata && typeof req.metadata === "object" && !Array.isArray(req.metadata) ? req.metadata : {};
}

// 解析 input 数组，提取参考图片 URL
function extractInputImages(req) {
  const input = req.input;
  if (!Array.isArray(input)) return [];
  const images = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "input_image" && trimmed(part.image_url)) {
        images.push(trimmed(part.image_url));
      }
    }
  }
  return images;
}

export function buildSubmitRequest(ctx) {
  const req = ctx.requestBody || {};
  const model = trimmed(req.model) || trimmed(ctx.upstreamModel) || "wand-vega-image-lite";
  
  if (!["wand-vega-image-lite", "wand-vega-image-flash", "wand-vega-image-pro"].includes(model)) {
    throw new Error("model must be wand-vega-image-lite, wand-vega-image-flash, or wand-vega-image-pro");
  }

  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("prompt is required");

  const body = {
    model: model,
    prompt: prompt,
  };

  // 处理参考图片
  const inputImages = extractInputImages(req);
  if (inputImages.length > 0) {
    body.input = [
      {
        content: inputImages.map(function (url) {
          return { type: "input_image", image_url: url };
        }),
      },
    ];
  }

  // 处理尺寸参数
  const size = trimmed(req.size) || trimmed(req.resolution);
  if (size) body.size = size;

  const action = inputImages.length > 0 ? "image_to_image" : "text_to_image";

  return {
    url: ctx.baseUrl + "/v1/wand/vega/images/generations",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
    body: body,
    action: action,
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = resp.body || {};
  if (!body.task_id) throw new Error("missing task_id in response");
  return { taskId: body.task_id, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/wand/vega/images/tasks/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
  };
}

export function parseTaskResult(_ctx, body) {
  const raw = trimmed(body.status).toLowerCase();
  
  // 成功状态
  if (raw === "completed" || raw === "success" || raw === "succeeded") {
    const data = Array.isArray(body.data) && body.data.length > 0 ? body.data[0] : {};
    const url = trimmed(data.url);
    if (!url) return { status: "FAILURE", progress: "100%", reason: "missing image url in completed task" };
    return { status: "SUCCESS", progress: "100%", url: url };
  }
  
  // 失败状态
  if (raw === "failed" || raw === "failure" || raw === "cancelled" || raw === "canceled" || raw === "expired") {
    return { status: "FAILURE", progress: "100%", reason: trimmed(body.error) || "task failed" };
  }
  
  // 进行中
  if (raw === "in_progress" || raw === "processing" || raw === "running") {
    return { status: "IN_PROGRESS", progress: "50%" };
  }
  
  // 排队中
  if (raw === "queued" || raw === "pending" || raw === "submitted") {
    return { status: "QUEUED", progress: "0%" };
  }
  
  // 默认排队
  return { status: "QUEUED", progress: "0%" };
}

export function extractUsage(_ctx) {
  // WAND-Vega 在提交时无法预估 token，需要等任务完成后从 usage 中提取
  return null;
}

export function extractUsageOnComplete(_task, _taskResult, body) {
  const usage = body.usage;
  if (!usage || typeof usage !== "object") return null;
  const tokens = Number(usage.total_tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  return { tokens: tokens };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const data = task.data && typeof task.data === "object" ? task.data : {};
  const bodyData = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : {};
  const url = trimmed(bodyData.url) || trimmed(task.url);
  if (!url) return [];
  return [{ key: "image", type: "image", mimeType: "image/png" }];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "image") throw new Error("artifact_not_found");
  const data = ctx.data && typeof ctx.data === "object" ? ctx.data : {};
  const bodyData = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : {};
  const url = trimmed(bodyData.url) || trimmed(ctx.url);
  if (!url) throw new Error("artifact_not_found");
  
  return {
    url: url,
    method: ctx.clientRequest.method,
    credentialless: true,
  };
}

export const native = {
  createImage(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const req = ctx.body.value;
    if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
    
    const model = trimmed(req.model);
    if (!model) throw new Error("model is required");
    if (!["wand-vega-image-lite", "wand-vega-image-flash", "wand-vega-image-pro"].includes(model)) {
      throw new Error("unsupported model: " + model);
    }
    
    const prompt = trimmed(req.prompt);
    if (!prompt) throw new Error("prompt is required");
    
    const requestBody = {
      model: model,
      prompt: prompt,
    };
    
    if (req.input !== undefined) requestBody.input = req.input;
    if (req.size !== undefined) requestBody.size = req.size;
    
    const hasInput = Array.isArray(req.input) && req.input.length > 0;
    
    return {
      kind: "submit",
      model: model,
      action: hasInput ? "image_to_image" : "text_to_image",
      requestBody: requestBody,
    };
  },

  createdImage(_ctx, task) {
    const data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    return {
      task_id: task.task_id,
      request_id: trimmed(data.request_id),
    };
  },

  queryImage(_ctx, task) {
    const data = task.data && typeof task.data === "object" ? task.data : {};
    const result = {
      task_id: task.task_id,
      status: task.status === "SUCCESS" ? "completed" : task.status === "FAILURE" ? "failed" : task.status === "IN_PROGRESS" ? "in_progress" : "queued",
      request_id: trimmed(data.request_id),
    };
    
    if (task.status === "SUCCESS") {
      const bodyData = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : {};
      result.data = [{ url: trimmed(bodyData.url) || trimmed(task.url) }];
      if (data.usage) result.usage = data.usage;
      if (data.created_at) result.created_at = data.created_at;
      if (data.finished_at) result.finished_at = data.finished_at;
    }
    
    if (task.status === "FAILURE") {
      result.error = { message: task.fail_reason || "task failed" };
    }
    
    return result;
  },
};

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      
      const model = trimmed(req.model) || trimmed(ctx.upstreamModel) || "wand-vega-image-lite";
      if (!["wand-vega-image-lite", "wand-vega-image-flash", "wand-vega-image-pro"].includes(model)) {
        throw new Error("unsupported model: " + model);
      }
      
      // 从 input 数组中提取 prompt 和 image
      const prompts = [];
      const images = [];
      
      if (Array.isArray(req.input)) {
        for (const item of req.input) {
          if (typeof item === "string") {
            prompts.push(item);
          } else if (item && typeof item === "object") {
            if (item.type === "text" && trimmed(item.text)) prompts.push(item.text);
            if (item.type === "image_url") {
              const imageUrl = typeof item.image_url === "string" ? item.image_url : item.image_url && item.image_url.url;
              if (trimmed(imageUrl)) images.push(trimmed(imageUrl));
            }
          }
        }
      }
      
      const prompt = prompts.join("\n") || trimmed(req.prompt);
      if (!prompt) throw new Error("prompt is required");
      
      const requestBody = {
        model: model,
        prompt: prompt,
      };
      
      // 构建 input 数组用于参考图
      if (images.length > 0) {
        requestBody.input = [
          {
            content: images.map(function (url) {
              return { type: "input_image", image_url: url };
            }),
          },
        ];
      }
      
      if (req.size !== undefined) requestBody.size = req.size;
      if (req.resolution !== undefined) requestBody.size = req.resolution;
      
      return {
        kind: "submit",
        model: model,
        action: images.length > 0 ? "image_to_image" : "text_to_image",
        requestBody: requestBody,
      };
    },

    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status: status, progress: progress };
      
      if (status === "SUCCESS") {
        const imageUrl = trimmed(task.url);
        if (!imageUrl) {
          return {
            events: [{ type: "error", code: "missing_image", message: "image url not found" }],
            state: state,
            done: true,
          };
        }
        const escapedUrl = imageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const imageHtml = '<img src="' + escapedUrl + '" alt="Generated image" />';
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: imageHtml }];
        return { events: events, state: state, done: true };
      }
      
      if (status === "FAILURE") {
        return {
          events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }],
          state: state,
          done: true,
        };
      }
      
      if (previousState && previousState.status === status && previousState.progress === progress) {
        return { events: [], state: state, done: false };
      }
      
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },

    renderFinal: function (ctx, _task) {
      const imageUrl = trimmed(_task.url);
      if (!imageUrl) {
        throw new Error("image url not found in completed task");
      }
      const escapedUrl = imageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const imageHtml = '<img src="' + escapedUrl + '" alt="Generated image" />';
      
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: imageHtml,
                annotations: [],
                logprobs: [],
              },
            ],
          },
        ],
        metadata: { vendor: "tencent-wand" },
      };
    },
  },
};
