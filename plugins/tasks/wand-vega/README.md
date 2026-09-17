# WAND-Vega Image Generation Plugin

腾讯云 WAND-Vega 图像生成插件，支持 Lite/Flash/Pro 三档模型。

## 模型支持

- `wand-vega-image-lite` - 高性价比图像生成
- `wand-vega-image-flash` - 平衡型图像生成
- `wand-vega-image-pro` - 高质量图像生成

## 功能特性

- ✅ 文生图（Text-to-Image）
- ✅ 参考生图（Image-to-Image，支持 0-6 张参考图）
- ✅ 分辨率：1K/2K/4K，支持多种宽高比
- ✅ 异步任务模式（提交 + 轮询）
- ✅ 完成后提取实际消耗 token

## API 端点

### 原生端点

- **提交任务**: `POST /wand/vega/images/generations`
- **查询结果**: `GET /wand/vega/images/tasks/:task_id`

### 支持的协议

- `openai_responses` - OpenAI 响应式协议（支持 sync/background）

## 请求示例

### 文生图

```json
{
  "model": "wand-vega-image-lite",
  "prompt": "A detailed painting of a butterfly",
  "size": "1024x1024"
}
```

### 参考生图

```json
{
  "model": "wand-vega-image-pro",
  "prompt": "A seamless composition of all reference images",
  "input": [
    {
      "content": [
        {
          "type": "input_image",
          "image_url": "https://example.com/reference.jpg"
        }
      ]
    }
  ],
  "size": "2048x2048"
}
```

### OpenAI 协议

```json
{
  "model": "wand-vega-image-flash",
  "input": [
    { "type": "text", "text": "A beautiful sunset" },
    { "type": "image_url", "image_url": "https://example.com/ref.jpg" }
  ],
  "size": "1024x1024"
}
```

## 响应示例

### 提交任务响应

```json
{
  "task_id": "251380669-VegaImage-f91e7435e1e34dfa9898a451946bb3d3",
  "request_id": "5b7c57a3-e5e4-4df0-958b-e72d35582be1"
}
```

### 查询结果响应

```json
{
  "task_id": "251380669-VegaImage-68a067d14b3c43c0961ce83373709f44",
  "status": "completed",
  "request_id": "92aa30e9-7549-4319-a0eb-467302d446f5",
  "data": [
    {
      "url": "https://aigc-image.cos.myqcloud.com/xxx/result.png"
    }
  ],
  "usage": {
    "total_tokens": 16200
  },
  "created_at": 1787560807,
  "finished_at": 1787560820
}
```

## 状态映射

| 上游状态 | new-api 状态 | 说明 |
|---------|-------------|------|
| `completed`, `success`, `succeeded` | `SUCCESS` | 任务成功完成 |
| `failed`, `failure`, `cancelled`, `expired` | `FAILURE` | 任务失败 |
| `in_progress`, `processing`, `running` | `IN_PROGRESS` | 任务处理中 |
| `queued`, `pending`, `submitted` | `QUEUED` | 任务排队中 |
| 其他 | `QUEUED` | 默认排队状态 |

## 用量计费

- 提交时无法预估 token 消耗
- 任务完成后从 `usage.total_tokens` 提取实际消耗
- 不同分辨率和模型档位的 token 消耗不同

## 预设尺寸

支持的宽高比：1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9

### 1K 分辨率
- 1:1 - 1024×1024、1080×1080
- 16:9 - 1280×720、1920×1080
- 21:9 - 1512×648

### 2K 分辨率
- 1:1 - 2048×2048、2160×2160
- 16:9 - 2560×1440
- 9:16 - 1440×2560

### 4K 分辨率
- 1:1 - 4096×4096
- 16:9 - 3840×2160
- 9:16 - 2160×3840

## 参考图限制

- **Lite 模型**: 0-3 张参考图（输入图片全部免费）
- **Flash 模型**: 0-6 张参考图（输入图片全部免费）
- **Pro 模型**: 0-6 张参考图（前 3 张免费，第 4 张起收费）

## 注意事项

1. **临时签名 URL**: 生成的图片 URL 为临时签名地址，请及时下载转存
2. **提示词长度**: 最大 2000 字符
3. **图片格式**: 支持 PNG/JPEG，单张不超过 10MB
4. **轮询建议**: 图片生成约需数秒至数十秒，建议每 3-5 秒轮询一次

## 版本历史

- `1.0.0` (2026-09-04) - 初始版本
  - 支持 Lite/Flash/Pro 三档模型
  - 支持文生图和参考生图
  - 支持异步任务轮询
  - 完成后提取实际 token 消耗
