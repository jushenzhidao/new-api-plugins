# Volcengine Doubao Audio Recognition Plugin

火山引擎豆包录音文件识别标准版插件，支持通过 HTTP 异步任务接口识别音频文件为文本。

## 模型支持

| 模型 ID | 能力 | 版本 |
|---------|------|------|
| `volc.seedasr.auc` | 豆包录音文件识别模型 2.0 | 多语种、高准确率 |
| `volc.bigasr.auc` | 豆包录音文件识别模型 1.0 | 标准版 |

## 适配模式

**原生同构直通（Isomorphic）**：保真复制厂商请求体，仅执行 URL 重建和鉴权替换。模型版本通过 `X-Api-Resource-Id` 请求头传递，不在 body 中。完整保留：
- 厂商扩展字段（`vocab_id`、`corpus`、`callback` 等）
- `false` / `0` / `null` / 空数组
- 嵌套对象和数组顺序

## API 路由

- **提交任务**：`POST /volc/auc/v3/submit`
- **查询任务**：`GET /volc/auc/v3/query/:task_id`

## 关键特性

### 1. 任务状态在 HTTP 响应头

火山引擎 ASR API 的任务状态通过 **HTTP 响应头 `X-Api-Status-Code`** 传递，不在 body 中：

| 状态码 | 含义 | 插件映射 |
|--------|------|----------|
| `20000000` | 成功 | `SUCCESS` |
| `20000001` | 正在处理中 | `IN_PROGRESS` |
| `20000002` | 任务在队列中 | `QUEUED` |
| `20000003` | 静音音频 | `FAILURE` |
| `45xxxxxx` | 请求参数错误 | `FAILURE` |
| `55xxxxxx` | 服务端错误 | 抛错重试（不终态） |

`parseTaskResult` 和 `parseSubmitResponse` 均读取响应头获取状态码。

### 2. 任务 ID 的生成与传递

- **提交时**：插件生成 UUID 作为 `X-Api-Request-Id` 请求头，该 UUID **成为任务 ID**
- **查询时**：任务 ID 通过 `X-Api-Request-Id` 请求头传递（等于 `ctx.taskId`），body 为空 JSON `{}`

### 3. 识别结果为纯文本

输出是识别文本 `body.result.text`，通过原生 query presenter 返回，不生成媒体 artifact。

## 用量跟踪

按音频时长计费，从查询响应的 `audio_info.duration`（毫秒）提取，向上取整为秒：
- **单位**：`audio_seconds`（秒）
- **提取时机**：`extractUsageOnComplete`（任务完成后）

## 示例请求

### 提交任务

```bash
POST /volc/auc/v3/submit
X-Api-Key: <your_api_key>
X-Api-Resource-Id: volc.seedasr.auc
X-Api-Request-Id: 550e8400-e29b-41d4-a716-446655440000
X-Api-Sequence: -1
Content-Type: application/json

{
  "audio": {
    "url": "https://example.com/audio.mp3",
    "format": "mp3",
    "rate": 16000,
    "bits": 16,
    "channel": 1
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true,
    "enable_punc": false,
    "show_utterances": false
  }
}
```

**响应**（状态码在响应头）：

```
HTTP/1.1 200 OK
X-Api-Status-Code: 20000000
X-Api-Message: OK
X-Api-Request-Id: 550e8400-e29b-41d4-a716-446655440000

{
  "task_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 查询任务

```bash
POST /volc/auc/v3/query
X-Api-Key: <your_api_key>
X-Api-Resource-Id: volc.seedasr.auc
X-Api-Request-Id: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{}
```

**响应**（完成）：

```
HTTP/1.1 200 OK
X-Api-Status-Code: 20000000
X-Api-Message: OK

{
  "audio_info": {
    "duration": 6312
  },
  "result": {
    "text": "刚刚还在想你怎么还不来找我聊天，你就来了，真是心有灵犀啊。",
    "utterances": [
      {
        "start_time": 480,
        "end_time": 5880,
        "text": "刚刚还在想你怎么还不来找我聊天，你就来了，真是心有灵犀啊。"
      }
    ]
  }
}
```

**响应**（处理中）：

```
HTTP/1.1 200 OK
X-Api-Status-Code: 20000001
X-Api-Message: Processing
```

## 支持的音频格式

- **格式**：raw、wav、mp3、ogg、pcm、spx、amr、aac、m4a
- **最大时长**：5 小时
- **最大大小**：512 MB

## 参考文档

- [录音文件识别标准版](https://docs.volcengine.com/docs/6561/2607737?lang=zh)
- [任务提交-HTTP](https://docs.volcengine.com/docs/6561/2606791?lang=zh)
- [结果查询-HTTP](https://docs.volcengine.com/docs/6561/2606792?lang=zh)
- [控制台 API Key 管理](https://console.volcengine.com/speech/new/setting/apikeys)

## 版本历史

### 1.0.0 (2026-09-04)

- 初始版本
- 支持豆包录音文件识别模型 2.0 / 1.0（`volc.seedasr.auc` / `volc.bigasr.auc`）
- 原生同构适配，保留厂商扩展字段
- 状态码从 HTTP 响应头 `X-Api-Status-Code` 读取
- 任务 ID 通过 `X-Api-Request-Id` 头传递
- 用量跟踪（按音频时长，向上取整）
- ChannelType: 10003
