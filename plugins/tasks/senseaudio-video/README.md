# senseaudio-video — SenseAudio Seedance 视频生成（对外火山方舟原生格式）

把 SenseAudio 开放平台的视频生成接口，转成**火山方舟 Seedance 原生格式**对外提供：
客户端用方舟那套 `/api/v3/contents/generations/tasks` 协议调用，插件把它翻译成 SenseAudio 的
`/v1/video/create` + `/v1/video/status`。

- 上游文档：<https://docs.senseaudio.cn/api-reference/endpoint/video/create>、<https://docs.senseaudio.cn/api-reference/endpoint/video/status>
- 入站参照的火山原生契约（官方 `doubao` 插件）：`POST/GET /api/v3/contents/generations/tasks`
- Base URL：`https://api.senseaudio.cn`，渠道密钥填 SenseAudio 的 API Key（`sk-...`），Bearer 鉴权。

## 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/senseaudio/api/v3/contents/generations/tasks` | 创建任务，返回 `{"id":"<网关任务 ID>"}` |
| GET | `/senseaudio/api/v3/contents/generations/tasks/:task_id` | 查询任务，返回方舟形状 |

只有 native 路由，未认领 `openai_video` / `openai_responses` 宿主协议。

## 模型

| 模型 | 说明 |
| --- | --- |
| `doubao-seedance-2-0-260128` | 上游文档明确支持的唯一视频模型（文生、首尾帧、参考素材、多模态） |

上游文档的模型版本表里把它叫 `Seedance-2.0`，但接口参数值只认 `doubao-seedance-2-0-260128`，
插件按接口参数值登记。

## 两端差异（插件做了哪些翻译）

| 语义 | 火山原生（入站） | SenseAudio（上游） |
| --- | --- | --- |
| 图片 | `{type:"image_url", image_url:{url}}` | `{type:"image", url}` |
| 视频 | `{type:"video_url", video_url:{url}}` | `{type:"video", video_url}` |
| 音频 | `{type:"audio_url", audio_url:{url}}` | `{type:"audio", audio_url}` |
| 文本 | 可多条 | 最多 1 条，多条按 `\n` 合并 |
| `role` | `image_url` 上的 `role` | 同名字段，取值相同 |
| `ratio` | `adaptive`/`16:9`/`4:3`/`1:1`/`3:4`/`9:16`/`21:9` | 仅 `16:9`/`4:3`/`1:1`/`3:4`/`9:16` |
| `resolution` | `480p`/`720p`/`1080p`/`4k` | 仅 `480p`/`720p`/`1080p` |
| `duration` | 秒 | 4~15 整数，必填 |
| `watermark` | 缺省**不加** | 缺省**加** |
| 音频开关 | 无对应字段 | `provider_specific.generate_audio` |
| 提交响应 | `{id}` | `{task_id}` |
| 结果字段 | `content.video_url` | 顶层 `video_url` |
| 状态 | `queued`/`running`/`succeeded`/`failed` | `pending`/`processing`/`completed`/`failed` |
| 草稿任务 | `content[].type = "draft_task"` | 不支持 |

入站还兼容扁平写法（`{type:"image", url}`、`{type:"audio", audio_url}`、`{type:"video", video_url}`），
方便直接照 SenseAudio 示例发请求。

## 有意保留的偏差（不静默夹紧）

1. **`ratio` 缺失或 `adaptive` 显式报错**。火山缺省是 `adaptive`，上游文档把 `ratio` 标为必填；
   插件在沙箱里拿不到首帧图、无法推断画幅，静默选 `16:9` 会产出错误比例，因此直接报错并列出可选值。
2. **`resolution=4k` 照传不了就报错**，不静默降到 `1080p`（降档＝隐性少扣费/画质不符）。
3. **`watermark` 缺省补 `false`**。上游缺省是加水印，火山缺省是不加；客户端没写时显式补 `false`，
   保持客户端可观察行为不变。
4. **`provider_specific` 原样转发**（上游声明「传入不支持的字段会直接忽略」），
   另外额外接受顶层 `generate_audio` 并归并进去。
5. **裸 `image_url`（不带 `role`）**：火山语义是首帧。上游 `role` 是可选项且缺省语义未文档化，
   插件显式补全——无参考图时按顺序补 `first_frame`/`last_frame`，有参考图时补 `reference`；
   超过两张裸图则要求显式声明 `role`。

## 状态映射

上游只有 4 个状态值，全部进精确层：

| 上游 | 内部 | 对外（火山） |
| --- | --- | --- |
| `pending` | `QUEUED` | `queued` |
| `processing` | `IN_PROGRESS` | `running` |
| `completed` | `SUCCESS` | `succeeded` |
| `failed` | `FAILURE` | `failed` |

再往下一律走「前缀兜底 → 结果 URL 兜底 → 失败信号兜底 → 默认 `QUEUED`」，永不返回 `UNKNOWN`。
查询请求本身的可重试错误（408/429/5xx）抛错让宿主重试，不会误判成任务失败。

## 上游错误信封（已实测）

`HTTP + {code, message, ref_code?, ref_scope?}`，`code` 是字符串 slug（有时直接就是中文提示本身），
`ref_code` 才是数字码；成功体不带 `code`。实测样本：

| HTTP | 响应体 | 触发条件 |
| --- | --- | --- |
| 401 | `{"code":"authentication_error","message":"incorrect API key provided"}` | 密钥错误 |
| 400 | `{"code":"图片链接无效","message":"图片链接无效","ref_code":400000}` | 素材 URL 拉不到 |
| 400 | `{"code":"图片高度不符合要求","message":"图片高度不符合要求","ref_code":400000}` | 图片高度 < 300px |
| 404 | `{"code":"notfound","message":"未找到资源","ref_code":404000,"ref_scope":"common"}` | 查询不存在的任务 ID |

插件按 `{error:{code,message}}` 优先、兼容 `{code,message}` / `{ref_code,message}` 解析。
查询侧 404 判任务 `FAILURE`（按 id 查的直接端点，404 即终态，没有列表端点的「刚提交还没进窗口」问题）。

## 用量

`usageSchema` 只放提交期即可确定的两个维度：`duration`（秒）、`resolution`（枚举）。
上游积分（credits）要任务完成后才返回，是连续值，不进 schema，随任务原始数据持久化供对账；
`extractUsageOnComplete` 会用完成后回传的真实时长/分辨率覆盖提交期估算。

## 实测补充（2026-09-16，真实凭据）

- 创建响应确实只有 `{"task_id":"..."}`；查询响应字段与文档一致，`duration` 回显请求时长。
- `status=pending` 时 `progress` 已经是 **50**，所以内部 `QUEUED` 也会带 50%——照实透出，
  不按状态反推覆盖上游自己的数字。
- 素材在 **create 阶段就校验**（可达性 + 尺寸），插件无法预取素材，只能让上游明确拒绝。
- 上游会在响应的 `provider_specific` 里回填 `watermark_url`（水印图地址），
  不是请求的回显，插件不回传该字段。
- `provider_specific.generate_audio: true` **确实生效**：拆成片 MP4 的 box 结构确认同时有
  `avc1` 视频轨与 `mp4a` 音频轨；`watermark: true` 时结果 URL 落在 `/video_add_watermark/` 路径下。
- 状态响应里的 `duration` 回显的是请求时长，与成片实际时长一致（请求 10s → `mvhd` 10.08s，
  请求 5s → 5.09s），所以 `extractUsageOnComplete` 回填的时长是可信的。

## 验证状态

**已完成真实端到端**（Base URL `https://api.senseaudio.cn`，真实 API Key）：

| 用例 | 结果 |
| --- | --- |
| 文生视频 `10s / 720p / 16:9 / watermark=true / generate_audio=true` | 提交拿到上游 `task_id` → 12 轮轮询 `QUEUED 0%→50%` → `SUCCESS 100%` → 回源下载 **6.2 MB**（`mvhd` 10.08s，`avc1` 1280×720 + `mp4a` 音轨） |
| 图生视频 `first_frame` + `5s / 720p` | 10 轮轮询 → `SUCCESS` → **4.4 MB**（5.09s，音视频轨齐全） |
| 首尾帧 `first_frame` + `last_frame` + `5s / 720p` | `action=first_tail_to_video`，14 轮轮询 → `SUCCESS` → **3.9 MB**（5.09s） |
| 参考图 `reference` ×2 + `5s / 720p` | `action=reference_to_video`，18 轮轮询 → `SUCCESS` → **2.7 MB**（5.09s） |
| 占位图 `https://example.com/first.jpg` | 上游 400 `图片链接无效`，插件在 `parseSubmitResponse` 干净抛出该原因 |
| 高度 158px 的 logo 作首帧 | 上游 400 `图片高度不符合要求`——说明 `image_url → image.url + role` 映射已过结构校验，卡的是素材本身 |

四条成功用例的成片都用 box 解析核对过：全部是 `isom` 容器、`avc1` 视频轨 1280×720 +
`mp4a` 音频轨，`mvhd` 时长与请求一致。所以 `resolution` / `duration` / `generate_audio`
三个参数都是**真的生效**，不只是被上游回显。

> 结果 URL 的路径由 `watermark` 决定：`true` 走 `/video_add_watermark/<uuid>/<uuid>.mp4`，
> `false` 走 `/video/<uuid>`（**没有扩展名**，靠 `Content-Type: video/mp4` 判断）。
> 插件不依赖扩展名，制品类型由插件自己声明。

`native.taskCreated` 回 `{"id":"<公开任务 ID>"}`，`native.taskStatus` 回
`{"id","model","status":"succeeded","content":{"video_url","resolution"},"ratio","duration","progress","created_at","completed_at"}`，
均为火山方舟形状。

离线层：`node --check`、宿主同步语法扫描、`.workbuddy-ai/tmp-tests/senseaudio-video.test.mjs` 全绿。
联调脚本：`.workbuddy-ai/tmp-tests/senseaudio-video.live.mjs`（凭据只走 `LIVE_KEY` 环境变量）。

## 闸门结论

```bash
LIVE_KEY='sk-...' node .workbuddy-ai/tools/test-runner.mjs --key senseaudio-video --include-live \
  --live-arg --prompt --live-arg '黄昏海边，海浪轻轻拍打礁石，镜头缓慢推进' \
  --live-arg --download --live-arg /tmp/out.mp4
```

结论 **PASS**（层 `[live, contract]`，通过 171/176，失败 0，回归 0）。
live 层逐用例：`native decode 成功` / `提交拿到上游 task id` / `轮询走到终态 SUCCESS` /
`终态给出可访问的结果 URL` / `listArtifacts 返回制品` / `回源请求 credentialless` / `回源下载落盘`，
7 条全过；本次下载产物 3.16 MB，`mvhd` 5.09s、`avc1` 1280×720 + `mp4a` 音轨。

**未验证**：失败终态（`status: failed` + `error_message`）的真实样本——无法在不故意触发违规内容的前提下
稳定构造；该分支目前只有文档依据与离线合同测试覆盖。参考音频（`audio`）/ 参考视频（`video`）
元素也未跑真实任务，只验证了参考图。
