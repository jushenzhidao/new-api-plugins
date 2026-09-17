# kling — 腾讯云 TokenHub 可灵视频生成

把可灵六款模型的请求转成腾讯云 TokenHub 原生协议（`https://tokenhub.tencentmaas.com/v1/wand/kling/*`），
支持文生视频、图生视频、全能视频生成（Omni）与任务轮询。

参考文档：<https://cloud.tencent.com/document/product/1823/135742>

## 模型

| 模型 | 端点 | 时长 | 分辨率 | 音频 | 多镜头 | 输入素材 |
| --- | --- | --- | --- | --- | --- | --- |
| `kling-video-v3` | 文生 / 图生 | 3~15 整数 | 720p / 1080p / 4k | native / off | 支持 | prompt、首帧、尾帧、element |
| `kling-video-v3-turbo` | 文生 / 图生 | 3~15 整数 | 720p / 1080p | 不支持 | 不支持 | prompt、首帧 |
| `kling-video-v3-omni` | 全能 | 3~15 整数 | 720p / 1080p / 4k | native / original / off | 支持 | prompt、首/尾帧、refer_image、feature_video、base_video、element、voice |
| `kling-video-o1` | 全能 | 3~10 整数 | 720p / 1080p | original / off | 不支持 | 同 omni |
| `kling-video-v2.6` | 文生 / 图生 | 5 / 10 | 720p / 1080p | native / off | 不支持 | prompt、首帧、尾帧、voice |
| `kling-video-v2.5-turbo` | 文生 / 图生 | 5 / 10 | 720p / 1080p | 不支持 | 不支持 | prompt、首帧、尾帧 |

兼容历史短名：`kling-v3`、`kling-v3-omni`、`kling-v3-turbo`、`kling-o1`；大小写不敏感（`Kling-Video-O1` 亦可）。

## 路由

模型名写在路径末段，一个模型一条提交入口。路径锁定模型与端点，body 里的 `model` 只作参考、不参与选路。

| 方法 | 路径 | 锁定模型 | 端点 |
| --- | --- | --- | --- |
| POST | `/kling/text-to-video/kling-video-v3` | `kling-video-v3` | 文生 |
| POST | `/kling/text-to-video/kling-video-v3-turbo` | `kling-video-v3-turbo` | 文生 |
| POST | `/kling/text-to-video/kling-video-v2.6` | `kling-video-v2.6` | 文生 |
| POST | `/kling/text-to-video/kling-video-v2.5-turbo` | `kling-video-v2.5-turbo` | 文生 |
| POST | `/kling/image-to-video/kling-video-v3` | `kling-video-v3` | 图生 |
| POST | `/kling/image-to-video/kling-video-v3-turbo` | `kling-video-v3-turbo` | 图生 |
| POST | `/kling/image-to-video/kling-video-v2.6` | `kling-video-v2.6` | 图生 |
| POST | `/kling/image-to-video/kling-video-v2.5-turbo` | `kling-video-v2.5-turbo` | 图生 |
| POST | `/kling/omni-video/kling-video-v3-omni` | `kling-video-v3-omni` | 全能 |
| POST | `/kling/omni-video/kling-video-o1` | `kling-video-o1` | 全能 |
| GET | `/kling/tasks/:task_id` | — | 查询 |

**模型后缀只存在于插件对外的 route path，不会出现在发往上游的 URL 上。** 上游只有三个无后缀提交端点
（`/v1/wand/kling/text-to-video`、`/image-to-video`、`/omni-video`），模型靠 body 的 `model` 字段区分，
`buildSubmitRequest` 会把归一后的模型写回 body。

不提供无模型后缀的入口，也不保留旧 `kling-v3` 插件的 `kling-3.0` 之类简称路径 —— 无需兼容旧版本。

协议入口：`openai_responses`（stream / sync / background）、`openai_video`。

## 适配模式

- **同构**：请求体已带 `contents` / `settings` / `options`，按厂商原生形状保真透传，只做模型归一、端点选择与
  明确字段删除（如图生视频去掉 `aspect_ratio`）。
- **异构**：OpenAI 等入口先归一成规范模型（prompt / 首帧 / 尾帧 / 参考图 / 参考视频 / 元素 / 音色 + settings），
  再由唯一 encoder 按白名单重建上游 body。未知客户端字段不会外泄。

两种模式共用同一个终点校验器 `finalizeBody`。原生入口的端点由路径直接给定，不做内容推断；
只有 `openai_responses` / `openai_video` 这类协议入口才走 `inferEndpoint`
（全能模型恒走 `omni-video`；有视频素材但模型不支持直接报错；有图片 / 元素 / 音色走 `image-to-video`；其余文生）。

端点锁定后，素材与端点不匹配会显式报错而非静默丢弃：向 `text-to-video` 传首帧 / 参考图 / 参考视频 /
element / voice 一律拒绝；向非全能模型传 `base_video`、`feature_video` 由按模型的内容类型白名单拦截。

## 用量

- `usageSchema` 只含提交期即可确定的四个维度：`seconds` / `resolution` / `input_images` / `input_videos`。
- 任务成功后 `extractUsageOnComplete` 读取 `data[].outputs[].duration`，把 `seconds` 回填成真实出片时长。
- 厂商 token 消耗（`tokenhub_usage.total_tokens`）**不进事实集**：它是完成后才知道的连续值，做倍率维度没有意义。
  原始值随任务数据持久化，对账时从任务原始响应里取，`queryVideo` 也会在渲染结果中透出。
- 宿主会硬校验 `usageExamples[*].facts` 与 `extractUsage` 的键集合完整覆盖 `usageSchema`（缺键直接拒绝加载，
  `0` 值合法）。改动 `usageSchema` 时务必同步全部示例与 `usageFacts()` 初值。
- `usagePurpose === "billing_ratios"` 时返回 `null`。

## 状态映射

查询响应 `data` 为数组，取首个元素：`succeeded → SUCCESS`、`failed → FAILURE`、
`processing → IN_PROGRESS`、`submitted/queued → QUEUED`；未知状态按前缀兜底，
再退化到「失败信号 → 结果 URL」，最终默认 `QUEUED`，永不返回 `UNKNOWN`。
HTTP 408 / 429 / 5xx 抛错交给宿主重试。

## 结果下载

`outputs[].url` 是腾讯云 COS 临时地址，artifact key 为 `video`（多个依次 `video_2`、`video_3`），
回源使用 `credentialless: true`，不带渠道鉴权。

## 版本

- `1.0.0`：首版，六模型全覆盖。`usageSchema` 含 `tokens`，提交期填 0。
- `1.0.1`：`tokens` 从 `usageSchema` 与 `usageExamples` 中移除，完成后只回填真实 `seconds`；
  路由改为「模型名在端点上」，一模型一入口，去掉无后缀入口与旧版简称路径；
  修掉 `encodeCanonical` 在 text-to-video 分支静默丢弃素材字段的问题。
- `1.0.2`（当前）：删掉 `1.0.1` 遗留的 6 条 `/kling/v1/videos/*` 旧版风格路由
  （3 条 submit + 3 条 query）。它们声明的 decode
  （`legacyTextVideo` / `legacyImageVideo` / `legacyOmniVideo`）从未导出，而宿主约定
  decode/render 只能引用 `native` 里的可调用成员，所以这 6 条路由是死的 —— 既与本文件
  「不提供无模型后缀的入口」矛盾，也与路由表列出的 11 条不符。按文档口径删除而非补实现。
  **旧版「输入形状」的支持不受影响**：`image_list` / `element_list` / `mode` / `sound` /
  `multi_prompt` 仍由 `decodeNative` 的 `isLegacyShaped` 分支处理，模型后缀入口照常收旧形状 body。
  路由数回到路由表的 11 条（10 submit + 1 query）。

## 测试

```bash
node .workbuddy-ai/tmp-tests/kling.test.mjs
```

测试自动取 `plugins/tasks/kling/` 下最新的 semver 目录（当前 `1.0.2`），324 条断言；
打了新 patch 不需要手改测试里的版本号。
