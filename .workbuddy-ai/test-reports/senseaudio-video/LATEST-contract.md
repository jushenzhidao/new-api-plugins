<!-- 自动生成：contract 层最新报告副本，原文 senseaudio-video/20260916-233725-senseaudio-video-1.0.0-contract.md -->

# 测试报告 · senseaudio-video 1.0.0 · contract

> **插件闸门结论：PASS** — 本层（contract）通过 164 / 失败 0 / 告警 5 / 用例 169；回归 0 条
>
> 本层自身结论：**PASS**。闸门结论由该插件本次运行的全部层级合并判定：`live`、`contract`。

## 元信息

| 字段 | 值 |
| --- | --- |
| 报告 ID | `20260916-233725-senseaudio-video-1.0.0-contract` |
| 时间 | 2026-09-16 23:37:25 +0800 |
| 插件 | `senseaudio-video@1.0.0` |
| 层级 | `contract` — 离线纯函数合同测试，不联网 |
| 断言粒度 | 用例级（可精确定位回归用例） |
| 测试脚本 | `.workbuddy-ai/tmp-tests/senseaudio-video.test.mjs` |
| 脚本 sha256 | `ce5ad724cd052f37…` |
| 被测源码 | `plugins/tasks/senseaudio-video/1.0.0/plugin.js` |
| 源码 sha256 | `938049e50dba37c6…` |
| 命令 | `node .workbuddy-ai/tmp-tests/senseaudio-video.test.mjs` |
| 退出码 | 0 |
| 耗时 | 68 ms |

## 与历史报告比对

- 基线报告：`20260916-233357-senseaudio-video-1.0.0-contract`（1.0.0 · FAIL · 2026-09-16 23:33:57 +0800）
- 回归：**0** ｜ 已修复：0 ｜ 仍失败：0 ｜ 新增用例：0 ｜ 未变：169 ｜ 消失用例：0

### 该插件该层历史（倒排，最新在上）

| 报告 ID | 时间 | 版本 | 结论 | 通过/失败 | 回归 |
| --- | --- | --- | --- | --- | --- |
| `20260916-233357-senseaudio-video-1.0.0-contract` | 2026-09-16 23:33:57 +0800 | 1.0.0 | FAIL | 164/0 | 0 |
| `20260916-233135-senseaudio-video-1.0.0-contract` | 2026-09-16 23:31:35 +0800 | 1.0.0 | INCOMPLETE | 153/0 | 0 |
| `20260916-233101-senseaudio-video-1.0.0-contract` | 2026-09-16 23:31:01 +0800 | 1.0.0 | INCOMPLETE | 153/0 | 0 |
| `20260916-233003-senseaudio-video-1.0.0-contract` | 2026-09-16 23:30:03 +0800 | 1.0.0 | INCOMPLETE | 153/0 | 0 |

## 层覆盖

- 本次已跑层级：`live`、`contract`
- 该插件历史已验证层级：`contract`
- 闸门要求：`contract`、`real`

## 用例明细

### meta（18 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | apiVersion = 1 |
| ✓ | key = senseaudio-video |
| ✓ | version = 1.0.0 |
| ✓ | author = Jushenzhidao |
| ✓ | channelTypes = [10010] |
| ✓ | fetchMode = per_task |
| ✓ | no host protocols claimed (native routes only) |
| ✓ | two routes |
| ✓ | submit route has decode + render |
| ✓ | query route has render only |
| ✓ | query path contains its taskIdParam placeholder |
| ✓ | submit path mirrors the Ark native path |
| ✓ | native members are functions |
| ✓ | native.createTask is exported |
| ✓ | native.taskCreated is exported |
| ✓ | native.taskStatus is exported |
| ✓ | usageExamples facts cover usageSchema keys |
| ✓ | every usageExample covers usageSchema keys |

### 入站解码：火山原生 content -> 内部规范模型（22 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | kind = submit |
| ✓ | action = text_to_video |
| ✓ | adapterMode = heterogeneous |
| ✓ | text 归一为 prompt |
| ✓ | duration 透传 |
| ✓ | resolution 透传 |
| ✓ | ratio 透传 |
| ✓ | watermark 缺省补 false（火山语义） |
| ✓ | 无图片 |
| ✓ | 未给 provider_specific 时不生成该字段 |
| ✓ | 首尾帧 action |
| ✓ | 嵌套 image_url.url 解出 url + role |
| ✓ | 参考素材 action |
| ✓ | audio_url 对象解出字符串 |
| ✓ | video_url 对象解出字符串 |
| ✓ | 扁平 image/url 兼容 |
| ✓ | 扁平 audio/audio_url 兼容 |
| ✓ | 扁平 video/video_url 兼容 |
| ✓ | 裸图补 first_frame |
| ✓ | 单图 action = image_to_video |
| ✓ | 两张裸图补 first_frame + last_frame |
| ✓ | 图片允许 data URL |

### 入站解码：默认值与枚举（9 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | duration 缺省 5 |
| ✓ | resolution 缺省 720p |
| ✓ | resolution 大小写归一 |
| ✓ | watermark 显式 true 保留 |
| ✓ | watermark "false" 字符串解析为 false |
| ✓ | 多条 text 合并为 1 条 |
| ✓ | provider_specific 原样转发（厂商扩展袋） |
| ✓ | 顶层 generate_audio 归并进 provider_specific |
| ✓ | timeout 透传 |

### 入站解码：非法输入（25 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 拒绝非 JSON body |
| ✓ | 拒绝非对象 body |
| ✓ | 缺 model 报错（ctx.model 也为空时） |
| ✓ | body.model 缺失时回落到 ctx.model |
| ✓ | content 非数组报错 |
| ✓ | content 空报错 |
| ✓ | 缺 ratio 显式报错（不静默选比例） |
| ✓ | ratio=adaptive 显式报错 |
| ✓ | ratio=21:9 显式报错 |
| ✓ | resolution=4k 照传不了就报错（不静默降档） |
| ✓ | duration 越界报错 |
| ✓ | duration 非整数报错 |
| ✓ | timeout 越界报错 |
| ✓ | watermark 非法值报错 |
| ✓ | draft_task 显式报错 |
| ✓ | 未知 content type 报错 |
| ✓ | 图片缺 URL 报错 |
| ✓ | 图片非 http/data URL 报错 |
| ✓ | 非法 role 报错 |
| ✓ | 首尾帧与参考素材混用报错 |
| ✓ | 仅音频报错 |
| ✓ | 超过两张裸图必须显式声明 role |
| ✓ | 参考图上限 9 |
| ✓ | 参考音频上限 3 |
| ✓ | 参考视频上限 3 |

### 上游请求构建（白名单重建）（12 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 上游 URL 无重复前缀 |
| ✓ | method = POST |
| ✓ | Bearer 鉴权 |
| ✓ | action 回传（单首帧） |
| ✓ | body 严格按上游 schema 白名单，未识别字段不泄漏 |
| ✓ | model 用 upstreamModel |
| ✓ | content 重建为 SenseAudio 形态且顺序稳定 |
| ✓ | content 按 text/image/audio/video 分组，同类型内相对顺序不变（保住「图片1/音频1」编号） |
| ✓ | 同类型素材相对顺序保持 |
| ✓ | 无 prompt 时不塞空 text 元素 |
| ✓ | 非法 adapterMode 被拒 |
| ✓ | 缺 requestBody 被拒 |

### 提交响应（5 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | task_id 提取为上游任务 ID |
| ✓ | 兼容 id 字段 |
| ✓ | 空 ID 报错（HTTP 200 空结果也算失败） |
| ✓ | 兼容 {error:{code,message}} 信封（非实测形状，回退分支） |
| ✓ | code/message 信封被识别 |

### 查询请求（3 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 查询 URL 带编码后的 id |
| ✓ | 查询 method = GET |
| ✓ | 查询 Bearer 鉴权 |

### 状态映射（28 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | status="pending" -> QUEUED |
| ✓ | status="processing" -> IN_PROGRESS |
| ✓ | status="completed" -> SUCCESS |
| ✓ | status="failed" -> FAILURE |
| ✓ | status="Pending" -> QUEUED |
| ✓ | status="PENDING" -> QUEUED |
| ✓ | status="queued" -> QUEUED |
| ✓ | status="running" -> IN_PROGRESS |
| ✓ | status="succeeded" -> SUCCESS |
| ✓ | status="cancelled" -> FAILURE |
| ✓ | status="expired" -> FAILURE |
| ✓ | status="" -> QUEUED |
| ✓ | status="weird_state" -> QUEUED |
| ✓ | completed 带出 video_url |
| ✓ | processing 用上游 progress |
| ✓ | pending progress = 0% |
| ✓ | failed -> FAILURE |
| ✓ | FAILURE 带 reason |
| ✓ | FAILURE 有兜底 reason |
| ✓ | not_completed 不被子串误判为 completed |
| ✓ | unpaid 不被子串误判为 paid/成功 |
| ✓ | 无 status 但有结果 URL -> SUCCESS |
| ✓ | 失败信号优先于结果 URL |
| ✓ | err_msg 兜底判失败 |
| ✓ | 5xx 信封错误抛错让宿主重试 |
| ✓ | 429 抛错让宿主重试 |
| ✓ | 非可重试错误信封判任务失败（走退款路径） |
| ✓ | 字符串响应体可解析 |

### 制品与回源（7 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 未成功时无制品 |
| ✓ | 成功时返回 video 制品 |
| ✓ | 无 URL 时不虚报制品 |
| ✓ | 回源取结果 URL |
| ✓ | 回源不携带渠道鉴权 |
| ✓ | 回源沿用客户端 method |
| ✓ | 无制品时报 artifact_not_found |

### 用量（6 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 提交期用量 = duration + resolution |
| ✓ | billing_ratios 返回 null |
| ✓ | payload 缺失时回落到默认维度（宿主硬校验覆盖） |
| ✓ | 完成后回填真实时长与分辨率 |
| ✓ | 非终态不回填 |
| ✓ | schema 外维度不回填 |

### native 渲染（火山原生形状）（13 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 提交渲染只回 {id}（网关公开 ID） |
| ✓ | IN_PROGRESS -> running |
| ✓ | 查询渲染用公开 ID |
| ✓ | 查询渲染带 model |
| ✓ | 未完成时 content 为空对象 |
| ✓ | SUCCESS -> succeeded |
| ✓ | 结果落在 content.video_url |
| ✓ | content.resolution 透出 |
| ✓ | duration 透出 |
| ✓ | progress 透出 |
| ✓ | FAILURE -> failed |
| ✓ | 失败带 error.message |
| ✓ | error 渲染 |

### 真实响应回归（2026-09-16 实测样本）（11 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 401 authentication_error 原文：密钥错误要能透出 |
| ✓ | 400 ref_code=400000 原文：code 就是中文提示本身 |
| ✓ | 400 素材尺寸不合格要能透出 |
| ✓ | 实测 pending 原文 -> QUEUED |
| ✓ | 实测 pending 原文 progress 已 50，照实透出不覆盖 |
| ✓ | 实测 completed 原文 -> SUCCESS |
| ✓ | 实测 completed 原文带出 video_url |
| ✓ | 实测 completed 原文回填用量 |
| ✓ | 无扩展名的结果 URL 仍判 SUCCESS |
| ✓ | 无扩展名也能提取 video 制品（类型由插件声明，不靠后缀） |
| ✓ | 实测 404 原文判任务失败（按 id 查的直接端点，404 即终态） |

### 源码同步语法扫描（5 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | stripped source has no bare `async` token |
| ✓ | stripped source has no bare `await` token |
| ✓ | stripped source has no bare `import` token |
| ✓ | strip pass completed |
| ✓ | no literal async field in source |

### 有意保留的偏差（5 项）

| 结果 | 用例 |
| --- | --- |
| ⚠ | ratio 缺失或 adaptive 显式报错 |
| ⚠ | resolution=4k 不静默降档 |
| ⚠ | watermark 缺省补 false |
| ⚠ | provider_specific 原样转发 |
| ⚠ | 裸 image_url 补 role |

## 原始输出（尾部）

```text
  ✓ 实测 completed 原文回填用量
  ✓ 无扩展名的结果 URL 仍判 SUCCESS
  ✓ 无扩展名也能提取 video 制品（类型由插件声明，不靠后缀）
  ✓ 实测 404 原文判任务失败（按 id 查的直接端点，404 即终态）

== 源码同步语法扫描 ==
  ✓ stripped source has no bare `async` token
  ✓ stripped source has no bare `await` token
  ✓ stripped source has no bare `import` token
  ✓ strip pass completed
  ✓ no literal async field in source

== 有意保留的偏差 ==
  ⚠ ratio 缺失或 adaptive 显式报错
  ⚠ resolution=4k 不静默降档
  ⚠ watermark 缺省补 false
  ⚠ provider_specific 原样转发
  ⚠ 裸 image_url 补 role

===NEWAPI-TEST-RESULT-BEGIN===
{"schema":1,"key":"senseaudio-video","version":"1.0.0","layer":"contract","passed":164,"failed":0,"warned":5,"total":169,"cases":[{"id":"apiVersion = 1","label":"apiVersion = 1","outcome":"pass","section":"meta"},{"id":"key = senseaudio-video","label":"key = senseaudio-video","outcome":"pass","section":"meta"},{"id":"version = 1.0.0","label":"version = 1.0.0","outcome":"pass","section":"meta"},{"id":"author = Jushenzhidao","label":"author = Jushenzhidao","outcome":"pass","section":"meta"},{"id":"channelTypes = [10010]","label":"channelTypes = [10010]","outcome":"pass","section":"meta"},{"id":"fetchMode = per_task","label":"fetchMode = per_task","outcome":"pass","section":"meta"},{"id":"no host protocols claimed (native routes only)","label":"no host protocols claimed (native routes only)","outcome":"pass","section":"meta"},{"id":"two routes","label":"two routes","outcome":"pass","section":"meta"},{"id":"submit route has decode + render","label":"submit route has decode + render","outcome":"pass","section":"meta"},{"id":"query route has render only","label":"query route has render only","outcome":"pass","section":"meta"},{"id":"query path contains its taskIdParam placeholder","label":"query path contains its taskIdParam placeholder","outcome":"pass","section":"meta"},{"id":"submit path mirrors the Ark native path","label":"submit path mirrors the Ark native path","outcome":"pass","section":"meta"},{"id":"native members are functions","label":"native members are functions","outcome":"pass","section":"meta"},{"id":"native.createTask is exported","label":"native.createTask is exported","outcome":"pass","section":"meta"},{"id":"native.taskCreated is exported","label":"native.taskCreated is exported","outcome":"pass","section":"meta"},{"id":"native.taskStatus is exported","label":"native.taskStatus is exported","outcome":"pass","section":"meta"},{"id":"usageExamples facts cover usageSchema keys","label":"usageExamples facts cover usageSchema keys","outcome":"pass","section":"meta"},{"id":"every usageExample covers usageSchema keys","label":"every usageExample covers usageSchema keys","outcome":"pass","section":"meta"},{"id":"kind = submit","label":"kind = submit","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"action = text_to_video","label":"action = text_to_video","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"adapterMode = heterogeneous","label":"adapterMode = heterogeneous","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"text 归一为 prompt","label":"text 归一为 prompt","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"duration 透传","label":"duration 透传","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"resolution 透传","label":"resolution 透传","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"ratio 透传","label":"ratio 透传","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"watermark 缺省补 false（火山语义）","label":"watermark 缺省补 false（火山语义）","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"无图片","label":"无图片","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"未给 provider_specific 时不生成该字段","label":"未给 provider_specific 时不生成该字段","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"首尾帧 action","label":"首尾帧 action","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"嵌套 image_url.url 解出 url + role","label":"嵌套 image_url.url 解出 url + role","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"参考素材 action","label":"参考素材 action","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"audio_url 对象解出字符串","label":"audio_url 对象解出字符串","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"video_url 对象解出字符串","label":"video_url 对象解出字符串","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"扁平 image/url 兼容","label":"扁平 image/url 兼容","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"扁平 audio/audio_url 兼容","label":"扁平 audio/audio_url 兼容","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"扁平 video/video_url 兼容","label":"扁平 video/video_url 兼容","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"裸图补 first_frame","label":"裸图补 first_frame","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"单图 action = image_to_video","label":"单图 action = image_to_video","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"两张裸图补 first_frame + last_frame","label":"两张裸图补 first_frame + last_frame","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"图片允许 data URL","label":"图片允许 data URL","outcome":"pass","section":"入站解码：火山原生 content -> 内部规范模型"},{"id":"duration 缺省 5","label":"duration 缺省 5","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"resolution 缺省 720p","label":"resolution 缺省 720p","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"resolution 大小写归一","label":"resolution 大小写归一","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"watermark 显式 true 保留","label":"watermark 显式 true 保留","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"watermark \"false\" 字符串解析为 false","label":"watermark \"false\" 字符串解析为 false","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"多条 text 合并为 1 条","label":"多条 text 合并为 1 条","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"provider_specific 原样转发（厂商扩展袋）","label":"provider_specific 原样转发（厂商扩展袋）","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"顶层 generate_audio 归并进 provider_specific","label":"顶层 generate_audio 归并进 provider_specific","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"timeout 透传","label":"timeout 透传","outcome":"pass","section":"入站解码：默认值与枚举"},{"id":"拒绝非 JSON body","label":"拒绝非 JSON body","outcome":"pass","section":"入站解码：非法输入"},{"id":"拒绝非对象 body","label":"拒绝非对象 body","outcome":"pass","section":"入站解码：非法输入"},{"id":"缺 model 报错（ctx.model 也为空时）","label":"缺 model 报错（ctx.model 也为空时）","outcome":"pass","section":"入站解码：非法输入"},{"id":"body.model 缺失时回落到 ctx.model","label":"body.model 缺失时回落到 ctx.model","outcome":"pass","section":"入站解码：非法输入"},{"id":"content 非数组报错","label":"content 非数组报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"content 空报错","label":"content 空报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"缺 ratio 显式报错（不静默选比例）","label":"缺 ratio 显式报错（不静默选比例）","outcome":"pass","section":"入站解码：非法输入"},{"id":"ratio=adaptive 显式报错","label":"ratio=adaptive 显式报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"ratio=21:9 显式报错","label":"ratio=21:9 显式报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"resolution=4k 照传不了就报错（不静默降档）","label":"resolution=4k 照传不了就报错（不静默降档）","outcome":"pass","section":"入站解码：非法输入"},{"id":"duration 越界报错","label":"duration 越界报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"duration 非整数报错","label":"duration 非整数报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"timeout 越界报错","label":"timeout 越界报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"watermark 非法值报错","label":"watermark 非法值报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"draft_task 显式报错","label":"draft_task 显式报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"未知 content type 报错","label":"未知 content type 报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"图片缺 URL 报错","label":"图片缺 URL 报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"图片非 http/data URL 报错","label":"图片非 http/data URL 报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"非法 role 报错","label":"非法 role 报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"首尾帧与参考素材混用报错","label":"首尾帧与参考素材混用报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"仅音频报错","label":"仅音频报错","outcome":"pass","section":"入站解码：非法输入"},{"id":"超过两张裸图必须显式声明 role","label":"超过两张裸图必须显式声明 role","outcome":"pass","section":"入站解码：非法输入"},{"id":"参考图上限 9","label":"参考图上限 9","outcome":"pass","section":"入站解码：非法输入"},{"id":"参考音频上限 3","label":"参考音频上限 3","outcome":"pass","section":"入站解码：非法输入"},{"id":"参考视频上限 3","label":"参考视频上限 3","outcome":"pass","section":"入站解码：非法输入"},{"id":"上游 URL 无重复前缀","label":"上游 URL 无重复前缀","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"method = POST","label":"method = POST","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"Bearer 鉴权","label":"Bearer 鉴权","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"action 回传（单首帧）","label":"action 回传（单首帧）","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"body 严格按上游 schema 白名单，未识别字段不泄漏","label":"body 严格按上游 schema 白名单，未识别字段不泄漏","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"model 用 upstreamModel","label":"model 用 upstreamModel","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"content 重建为 SenseAudio 形态且顺序稳定","label":"content 重建为 SenseAudio 形态且顺序稳定","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"content 按 text/image/audio/video 分组，同类型内相对顺序不变（保住「图片1/音频1」编号）","label":"content 按 text/image/audio/video 分组，同类型内相对顺序不变（保住「图片1/音频1」编号）","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"同类型素材相对顺序保持","label":"同类型素材相对顺序保持","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"无 prompt 时不塞空 text 元素","label":"无 prompt 时不塞空 text 元素","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"非法 adapterMode 被拒","label":"非法 adapterMode 被拒","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"缺 requestBody 被拒","label":"缺 requestBody 被拒","outcome":"pass","section":"上游请求构建（白名单重建）"},{"id":"task_id 提取为上游任务 ID","label":"task_id 提取为上游任务 ID","outcome":"pass","section":"提交响应"},{"id":"兼容 id 字段","label":"兼容 id 字段","outcome":"pass","section":"提交响应"},{"id":"空 ID 报错（HTTP 200 空结果也算失败）","label":"空 ID 报错（HTTP 200 空结果也算失败）","outcome":"pass","section":"提交响应"},{"id":"兼容 {error:{code,message}} 信封（非实测形状，回退分支）","label":"兼容 {error:{code,message}} 信封（非实测形状，回退分支）","outcome":"pass","section":"提交响应"},{"id":"code/message 信封被识别","label":"code/message 信封被识别","outcome":"pass","section":"提交响应"},{"id":"查询 URL 带编码后的 id","label":"查询 URL 带编码后的 id","outcome":"pass","section":"查询请求"},{"id":"查询 method = GET","label":"查询 method = GET","outcome":"pass","section":"查询请求"},{"id":"查询 Bearer 鉴权","label":"查询 Bearer 鉴权","outcome":"pass","section":"查询请求"},{"id":"status=\"pending\" -> QUEUED","label":"status=\"pending\" -> QUEUED","outcome":"pass","section":"状态映射"},{"id":"status=\"processing\" -> IN_PROGRESS","label":"status=\"processing\" -> IN_PROGRESS","outcome":"pass","section":"状态映射"},{"id":"status=\"completed\" -> SUCCESS","label":"status=\"completed\" -> SUCCESS","outcome":"pass","section":"状态映射"},{"id":"status=\"failed\" -> FAILURE","label":"status=\"failed\" -> FAILURE","outcome":"pass","section":"状态映射"},{"id":"status=\"Pending\" -> QUEUED","label":"status=\"Pending\" -> QUEUED","outcome":"pass","section":"状态映射"},{"id":"status=\"PENDING\" -> QUEUED","label":"status=\"PENDING\" -> QUEUED","outcome":"pass","section":"状态映射"},{"id":"status=\"queued\" -> QUEUED","label":"status=\"queued\" -> QUEUED","outcome":"pass","section":"状态映射"},{"id":"status=\"running\" -> IN_PROGRESS","label":"status=\"running\" -> IN_PROGRESS","outcome":"pass","section":"状态映射"},{"id":"status=\"succeeded\" -> SUCCESS","label":"status=\"succeeded\" -> SUCCESS","outcome":"pass","section":"状态映射"},{"id":"status=\"cancelled\" -> FAILURE","label":"status=\"cancelled\" -> FAILURE","outcome":"pass","section":"状态映射"},{"id":"status=\"expired\" -> FAILURE","label":"status=\"expired\" -> FAILURE","outcome":"pass","section":"状态映射"},{"id":"status=\"\" -> QUEUED","label":"status=\"\" -> QUEUED","outcome":"pass","section":"状态映射"},{"id":"status=\"weird_state\" -> QUEUED","label":"status=\"weird_state\" -> QUEUED","outcome":"pass","section":"状态映射"},{"id":"completed 带出 video_url","label":"completed 带出 video_url","outcome":"pass","section":"状态映射"},{"id":"processing 用上游 progress","label":"processing 用上游 progress","outcome":"pass","section":"状态映射"},{"id":"pending progress = 0%","label":"pending progress = 0%","outcome":"pass","section":"状态映射"},{"id":"failed -> FAILURE","label":"failed -> FAILURE","outcome":"pass","section":"状态映射"},{"id":"FAILURE 带 reason","label":"FAILURE 带 reason","outcome":"pass","section":"状态映射"},{"id":"FAILURE 有兜底 reason","label":"FAILURE 有兜底 reason","outcome":"pass","section":"状态映射"},{"id":"not_completed 不被子串误判为 completed","label":"not_completed 不被子串误判为 completed","outcome":"pass","section":"状态映射"},{"id":"unpaid 不被子串误判为 paid/成功","label":"unpaid 不被子串误判为 paid/成功","outcome":"pass","section":"状态映射"},{"id":"无 status 但有结果 URL -> SUCCESS","label":"无 status 但有结果 URL -> SUCCESS","outcome":"pass","section":"状态映射"},{"id":"失败信号优先于结果 URL","label":"失败信号优先于结果 URL","outcome":"pass","section":"状态映射"},{"id":"err_msg 兜底判失败","label":"err_msg 兜底判失败","outcome":"pass","section":"状态映射"},{"id":"5xx 信封错误抛错让宿主重试","label":"5xx 信封错误抛错让宿主重试","outcome":"pass","section":"状态映射"},{"id":"429 抛错让宿主重试","label":"429 抛错让宿主重试","outcome":"pass","section":"状态映射"},{"id":"非可重试错误信封判任务失败（走退款路径）","label":"非可重试错误信封判任务失败（走退款路径）","outcome":"pass","section":"状态映射"},{"id":"字符串响应体可解析","label":"字符串响应体可解析","outcome":"pass","section":"状态映射"},{"id":"未成功时无制品","label":"未成功时无制品","outcome":"pass","section":"制品与回源"},{"id":"成功时返回 video 制品","label":"成功时返回 video 制品","outcome":"pass","section":"制品与回源"},{"id":"无 URL 时不虚报制品","label":"无 URL 时不虚报制品","outcome":"pass","section":"制品与回源"},{"id":"回源取结果 URL","label":"回源取结果 URL","outcome":"pass","section":"制品与回源"},{"id":"回源不携带渠道鉴权","label":"回源不携带渠道鉴权","outcome":"pass","section":"制品与回源"},{"id":"回源沿用客户端 method","label":"回源沿用客户端 method","outcome":"pass","section":"制品与回源"},{"id":"无制品时报 artifact_not_found","label":"无制品时报 artifact_not_found","outcome":"pass","section":"制品与回源"},{"id":"提交期用量 = duration + resolution","label":"提交期用量 = duration + resolution","outcome":"pass","section":"用量"},{"id":"billing_ratios 返回 null","label":"billing_ratios 返回 null","outcome":"pass","section":"用量"},{"id":"payload 缺失时回落到默认维度（宿主硬校验覆盖）","label":"payload 缺失时回落到默认维度（宿主硬校验覆盖）","outcome":"pass","section":"用量"},{"id":"完成后回填真实时长与分辨率","label":"完成后回填真实时长与分辨率","outcome":"pass","section":"用量"},{"id":"非终态不回填","label":"非终态不回填","outcome":"pass","section":"用量"},{"id":"schema 外维度不回填","label":"schema 外维度不回填","outcome":"pass","section":"用量"},{"id":"提交渲染只回 {id}（网关公开 ID）","label":"提交渲染只回 {id}（网关公开 ID）","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"IN_PROGRESS -> running","label":"IN_PROGRESS -> running","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"查询渲染用公开 ID","label":"查询渲染用公开 ID","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"查询渲染带 model","label":"查询渲染带 model","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"未完成时 content 为空对象","label":"未完成时 content 为空对象","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"SUCCESS -> succeeded","label":"SUCCESS -> succeeded","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"结果落在 content.video_url","label":"结果落在 content.video_url","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"content.resolution 透出","label":"content.resolution 透出","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"duration 透出","label":"duration 透出","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"progress 透出","label":"progress 透出","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"FAILURE -> failed","label":"FAILURE -> failed","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"失败带 error.message","label":"失败带 error.message","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"error 渲染","label":"error 渲染","outcome":"pass","section":"native 渲染（火山原生形状）"},{"id":"401 authentication_error 原文：密钥错误要能透出","label":"401 authentication_error 原文：密钥错误要能透出","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"400 ref_code=400000 原文：code 就是中文提示本身","label":"400 ref_code=400000 原文：code 就是中文提示本身","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"400 素材尺寸不合格要能透出","label":"400 素材尺寸不合格要能透出","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"实测 pending 原文 -> QUEUED","label":"实测 pending 原文 -> QUEUED","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"实测 pending 原文 progress 已 50，照实透出不覆盖","label":"实测 pending 原文 progress 已 50，照实透出不覆盖","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"实测 completed 原文 -> SUCCESS","label":"实测 completed 原文 -> SUCCESS","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"实测 completed 原文带出 video_url","label":"实测 completed 原文带出 video_url","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"实测 completed 原文回填用量","label":"实测 completed 原文回填用量","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"无扩展名的结果 URL 仍判 SUCCESS","label":"无扩展名的结果 URL 仍判 SUCCESS","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"无扩展名也能提取 video 制品（类型由插件声明，不靠后缀）","label":"无扩展名也能提取 video 制品（类型由插件声明，不靠后缀）","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"实测 404 原文判任务失败（按 id 查的直接端点，404 即终态）","label":"实测 404 原文判任务失败（按 id 查的直接端点，404 即终态）","outcome":"pass","section":"真实响应回归（2026-09-16 实测样本）"},{"id":"stripped source has no bare `async` token","label":"stripped source has no bare `async` token","outcome":"pass","section":"源码同步语法扫描"},{"id":"stripped source has no bare `await` token","label":"stripped source has no bare `await` token","outcome":"pass","section":"源码同步语法扫描"},{"id":"stripped source has no bare `import` token","label":"stripped source has no bare `import` token","outcome":"pass","section":"源码同步语法扫描"},{"id":"strip pass completed","label":"strip pass completed","outcome":"pass","section":"源码同步语法扫描"},{"id":"no literal async field in source","label":"no literal async field in source","outcome":"pass","section":"源码同步语法扫描"},{"id":"ratio 缺失或 adaptive 显式报错","label":"ratio 缺失或 adaptive 显式报错","outcome":"warn","section":"有意保留的偏差","detail":"上游必填且插件无法推断画幅，静默选比例会产出错误画幅"},{"id":"resolution=4k 不静默降档","label":"resolution=4k 不静默降档","outcome":"warn","section":"有意保留的偏差","detail":"照传让上游明确拒绝，避免隐性少扣费"},{"id":"watermark 缺省补 false","label":"watermark 缺省补 false","outcome":"warn","section":"有意保留的偏差","detail":"上游缺省加水印，火山缺省不加，显式补全以保持客户端可观察行为"},{"id":"provider_specific 原样转发","label":"provider_specific 原样转发","outcome":"warn","section":"有意保留的偏差","detail":"上游声明的厂商扩展袋，未识别键由上游忽略"},{"id":"裸 image_url 补 role","label":"裸 image_url 补 role","outcome":"warn","section":"有意保留的偏差","detail":"上游 role 缺省语义未文档化，按火山语义显式补 first_frame/last_frame/reference"}]}
===NEWAPI-TEST-RESULT-END===

passed=164 failed=0 warned=5
```

## stderr（尾部）

```text
(node:68231) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/betterme/PycharmProjects/AI/new-api-plugins/plugins/tasks/senseaudio-video/1.0.0/plugin.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/betterme/PycharmProjects/AI/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
```

