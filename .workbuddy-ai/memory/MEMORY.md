# new-api-plugins 项目长期约定

## 仓库定位
自建仓库，上游参考源为 `QuantumNous/new-api-plugins`。移植上游插件时必须改写身份类字段，不得照抄。

## meta 硬性约定（来自仓库 README）
- `author` 固定为 `{ name: "Jushenzhidao" }`，**不是**上游的 `QuantumNous`。
- `channelTypes` 从 `10000` 起递增，每个插件一个全局唯一整数；不得复用上游小数值（如 `35`）。
  分配前扫描 `plugins/**/plugin.js` 已占用值，分配后登记到
  `.workbuddy-ai/skills/new-api-task-plugin-builder/SKILL.md` 末尾的 channelTypes 登记表。
- `version` 新插件从 `"1.0.0"` 起，之后 patch 位逐次 +1（`1.0.1`、`1.0.2`…）；
  `meta.version` 必须与所在目录名 `<semver>` 完全一致；已发布版本目录不可变，修改需新建下一个 patch 目录。
- 已上线插件不要随意改 `channelTypes`（等于要求用户重新绑定渠道）。

## 目录结构
`plugins/tasks/<key>/<semver>/plugin.js`

## 验证约定（离线 + 真实两层，缺一不可）
- 离线合同测试只证明「函数对」，证明不了「上游认」。新建插件 / 每个新 patch / 改动请求构建·状态映射·
  制品提取任一 hook 后，**必须向用户索取 Base URL + 真实凭据（api key / token / cookie）跑通一条真实任务**。
- 凭据**开工时就索要**，不要等到收尾；只从环境变量读，不写进源码/测试/skill/记忆，日志脱敏。
- 用户给不出凭据时，要明确区分「已验证范围」与「未验证部分」，不能用 mock 含糊带过。

## 测试报告与回归闭环（强制，端到端）
- 入口只有 `.workbuddy-ai/tools/test-runner.mjs`。**不许手写报告**，报告一律由它生成到 `.workbuddy-ai/test-reports/`。
- 闭环：读 `<key>/LATEST.md` + `INDEX.md` → 按报告「阻塞项/未验证」修复 → 重跑 runner → 回归 0 且闸门 PASS 才算修完。
- 倒排索引：`index.json` 的 `reports[0]` 即最新（含逐条用例）；`INDEX.md` 全量倒排；`<key>/LATEST-<layer>.md` 为该层最新全文副本。
- 报告不可变，头部钉死被测源码 sha256 + 脚本 sha256；改完重跑后 sha256 必须变化，否则测的还是旧文件。
- 闸门**按插件聚合**（不按单层）：任一层失败/回归 → `FAIL`(1)；要求层没覆盖齐 → `INCOMPLETE`(2，不算完成)；全齐 → `PASS`(0)。
  默认要求 `contract` + `real`（live|e2e）。`--offline-only` 只能用于「明确声明真实层未验」。
- 四层后缀：`*.spec.mjs`/`*.openapi.mjs`=spec（不联网）、`*.test.mjs`=contract（不联网）、
  `*.live.mjs`=live、`*.e2e.mjs`=e2e（后两者需 `--include-live` + `LIVE_KEY`）。
- 回归即阻塞：基线通过、本次失败的用例判 `REGRESSION`。**不许删用例/改断言名绕过**。跨版本比对是故意的
  （1.0.2 的修复不能让 1.0.1 验过的用例失败）。
- 用例粒度决定回归精度。推荐用 `assets/testkit.mjs` 的 `createSuite()`（输出结构化块并显式声明 key/version/layer，
  优先于文件名推断）。老脚本断言辅助函数里的 `mark()` 打印行**勿删**，删了就退化回「仅聚合」粒度。
- 索引自愈：报告文件被删，索引项下次运行自动剔除。

## 请求适配约定
- 不能用 `native` 名称判断请求同构；按入站 body 与上游契约的字段、层级、类型、枚举、媒体表达和缺省语义判断。
- decoder 只返回宿主 canonical intent；适配信息放在 `requestBody: { adapterMode, payload }`，其中 `adapterMode` 仅为 `isomorphic` 或 `heterogeneous`。
- 同构：保真复制并最小修正，保留未知厂商字段及 `false/0/null`、数组顺序；仅重建 URL/鉴权并做明确模型映射或内部字段删除。
- 异构：协议输入先归一为内部语义模型，再由单一 encoder 按上游 schema 白名单重建；native 异构与 OpenAI 等入口复用规范模型和 encoder。
- driver hook 只消费 `ctx.requestBody`，不得按客户端 path/protocol 分支；日志只记 `adapterMode`，不记 payload。

## 任务状态映射约定（上游 → new-api）
六层阶梯，上层命中即返回：0 envelope 错误码 → 1/2 文档声明式+精确枚举表 → 3 前缀模糊
（成功 `success*|succ*|ok|okay|comp*`；失败 `erro*|fail*|cancel*|expire*|timeout*`；
进行中 `run*|process*|progress*|generat*|render*`；排队 `queue*|pend*|submit*|wait*`）
→ 4 结果字段 `url/video_url/image_url/data[].url` 兜底成功 → 5 失败信号兜底失败 → 6 默认 `QUEUED`。
禁止子串匹配（防 `not_completed` 误判）；结果兜底让位于 `fail_reason/err_msg/error.message`；永不返回 `UNKNOWN`。

## 插件日志约定
沙箱内只有 `console.log`，无 Logfire/OTel。**宿主默认不转发插件日志**——new-api 只在 `DEBUG=true` 时才收集并转发
`console.log`（上游文档原文："Plugin console.log output is also forwarded in DEBUG mode"）。生产环境不开 DEBUG，
插件日志一条都没有，这不是插件 bug。线上排障不依赖插件日志，改用宿主 Go 层 HTTP 日志和上游 access log 定位。

## 腾讯 TokenHub（`/v1/wand/*`）系列
- 上游 `https://tokenhub.tencentmaas.com`，Bearer 鉴权；提交返回 `data.id`，轮询 `GET /v1/wand/<vendor>/tasks/{task_id}`，
  查询响应 `data` 是数组，结果在 `data[].outputs[].url`，真实用量在顶层 `tokenhub_usage.total_tokens`。
- 腾讯云文档页是 SPA + 压缩响应：WebFetch 常把长文档截断，用 `curl -sL --compressed` 取 HTML 后再去标签转文本可拿全篇。

## aivideomaker（aivideomaker.ai，channelTypes 10009）

- 站点暴露官方 OpenAPI 规范：`/docs/aivideo-openapi.json`（3.1.0）。拿规范可零成本反向校验插件，
  比抓 SPA 文档页可靠（文档页常被截断）。共 7 个端点，**无任何上传端点** → 两种凭据形态
  都支持不了客户端上传，文件占位符必须显式拒绝。
- 两种凭据：`ak_`（header `key`，`POST /api/v1/generate/minimax` + `GET /api/v1/tasks/{id}`）与
  网页会话（tRPC 信封，`POST /api/ai.minimaxH3?batch=1` + `GET /api/model.listModel`，后者需 userId 否则
  返回他人公开视频）。cookie 必须属 `aivideomaker.ai` 域。
- **官方 TaskStatus 仅 5 值**：`SUBMITTED/PROGRESS/COMPLETED/FAILED/CANCEL`。`PROGRESS`/`CANCEL`
  必须进精确层：`CANCEL` 掉到默认 QUEUED 后上游不再变化 → 任务永远卡轮询。
- 官方 Task 形状与网页会话不同：顶层无 `duration`（回显在 `input`）、无 `progress`、
  成片在 `output.url`；积分叫 `creditsCharged`（网页会话叫 `credits`）。
- 两处有意保留的差异：`resolution` 官方只有 720p/1080p 但插件保留 480p（实测可出片，
  静默升档＝隐性多扣费）；文档称 image 接受 data URI 但实测被拒（且报成 500），按 http/https/s3/r2 预校验。
- 图片直传外链会被上游校验 MIME：`image/jpg` 被拒、`image/jpeg` 才过（"浏览器能传的图，外链不一定过"）。
- **优先用 `ak_` 形态**：`/zh/app/settings/account/api-keys` 创建，站点赠送体验积分（页面文案：
  50 积分 = 3 个 5 秒视频）。官方 API 不受验证码限制，且渠道密钥就是 `ak_...` 本身，免 JSON、免 userId。
- **`needsCaptcha=true` 的真实原因是体验额度耗尽**，不是凭据格式问题。该状态下**查询仍正常
  （listModel 能列出历史任务）但提交必失败**，响应是 HTTP 200 + `[{"result":{"data":{"json":""}}}]`
  空字符串。所以「能查到历史任务」不代表「还能出片」，别拿 listModel 通了当凭据可用。
  自查端点 `GET /api/model.needsCaptcha`（**必须带 userId**），与 visitorId 取值无关（全 0/随机都同结果）。
- **`ak_` 官方 API 模式已全面真实验证**（8 个端点全部提交→轮询→下载→探针核对，闸门 PASS）。
  `GET /api/v1/account` 的 `supportedModels` 列出全部 8 个模型，一举证实那 7 个站点公开文档里
  查不到的端点确实存在（`/docs`、`/llms.txt`、`/docs/aivideo-openapi.json` 只声明 minimax 一个）。
  无效 key 探测**无法**区分端点存在性——鉴权在路由分发之前，8 个端点全返回同一个 401。
  扣费与文档公式吻合（t2v/i2v = 秒×3、t2v_v3/i2v_v3 = 秒×4、wan27 = 秒×10、happyhorse = 秒×25、
  seedance20 4s/480 = 41）。
- **同一上游不同模型的完成时延差一个数量级**：`i2v_v3` 5s 任务轮询 40 次（10 分钟）仍是上游 `PROGRESS`，
  第 41 次才 `COMPLETED`（约 13 分钟）；其他端点 2~7 分钟。**先 curl `/api/v1/tasks` 看上游原始 status
  再下结论**，别把「还在跑」误判成状态映射漏枚举去改本来正确的代码。
- **没有 resolution 参数的 4 个端点（t2v/i2v/t2v_v3/i2v_v3）出片画幅由上游固定**：
  t2v/i2v 实测 1248×704（720p 档），t2v_v3/i2v_v3 实测 1904×1080（1080p 档）。
  用量维度记 `"unspecified"`，不替上游猜画幅（编造维度＝给倍率表造出一条上游不存在的行）。
- **用量维度的判据是「上游模型有没有该字段」，不是「payload 里有没有值」**：跨协议入口的 decoder
  会替缺失字段补默认值（原生入口不会），只看 payload 会让同一个 t2v 任务在火山入口记 `unspecified`、
  在 openai 入口记 `720p`，倍率表对不上。实现上按 `upstreamModelOf` 解析上游模型后再判定。
  **多入口插件收尾时务必跑一次「同模型两入口 `usage(submit)` 对比」**（dry-run 即可，零额度）。
- **两个入口都能路由全部 8 个模型**（共用同一个 `buildSubmitRequest`）：openai 协议入口发
  `{"model":"t2v",...}` 也会打到 `/api/v1/generate/t2v`；缺 `ratio` 时显式报错并列出允许取值，
  不静默回落 minimax。`meta.models` 因此列 8 个模型名 + 2 个别名，是诚实的。
- **`usageExamples` 必须列一条 `unspecified`**：4 个没有分辨率字段的模型实际就产出这个值，
  不列出来用户在倍率表里只会看到 480p/720p/1080p 三行、这四个模型永远匹配不到行。
  宿主只硬校验「示例键集合覆盖 schema 键」，条数与枚举覆盖靠自觉 + 合同断言守住。
  同理：**任何「该模型不存在此维度」的哨兵值进了 `enum`，就要在 `usageExamples` 里可见。**
- `happyhorse` 默认出**带水印**成片（URL 含 `_refiner_watermark`），8 个端点都没有 watermark 开关。
  「不写 watermark 按上游默认出片」≠「无水印」。
- 1.0.1 新增火山方舟 Seedance 原生入口 `/aivideomaker/api/v3/contents/generations/tasks`，
  覆盖全部 8 个模型；1.0.0 的 openai 入口行为逐字段不变。设计要点见 skill 的 `*Given` 标记手法。

## senseaudio-video（api.senseaudio.cn，channelTypes 10010）

- 定位：把 SenseAudio 视频生成转成**火山方舟 Seedance 原生格式**对外。
  入站 `POST/GET /senseaudio/api/v3/contents/generations/tasks`，上游
  `POST /v1/video/create` + `GET /v1/video/status?id=`（Bearer）。唯一模型 `doubao-seedance-2-0-260128`。
- **「转成某家原生格式」＝那家是入站契约、另一家是上游**；该家官方插件源码
  （`QuantumNous/new-api-plugins/plugins/tasks/doubao`）就是契约权威，比文档准。
  render hook 要吐该家形状（`{id}` / `content.video_url` / `queued|running|succeeded|failed`），
  不能把上游 `task.data` 直接 `Object.assign` 透传。
- 两端差异：图片 `image_url:{url}` → `image.url` 扁平（视频/音频同理）；多条 text 合并 1 条；
  `watermark` 缺省语义**相反**（火山不加 / 上游加）→ 客户端不写时显式补 `false`；
  `ratio` 上游必填且插件无法推断画幅 → 缺失或 `adaptive` 显式报错，不静默选比例；
  `resolution=4k` 照传让上游拒，不静默降档。
- 文档可抓 markdown：`https://docs.senseaudio.cn/<path>.md`（llms.txt 有全量索引），
  比抓渲染页干净。视频模块只有 create/status 两个端点，无上传端点。
- 上游错误信封（**已实测**）：`HTTP + {code, message, ref_code?, ref_scope?}`，`code` 是字符串 slug
  （有时直接就是中文提示），`ref_code` 才是数字码；成功体不带 `code`。401 `authentication_error`、
  400 `图片链接无效`、400 `图片高度不符合要求`、404 `notfound`+`ref_code 404000`。
  **不是**火山方舟同构的 `{error:{code,message}}`，但 `upstreamError()` 的 code/message 分支已覆盖。
- 实测：创建响应只有 `{task_id}`；`status=pending` 时 `progress` 已 50；`completed` 时顶层 `video_url`，
  `provider_specific` 被上游回填 `watermark_url`；**素材在 create 阶段校验可达性与尺寸**
  （高度 <300px 直接 400）。四种模式（文生 / 图生 / 首尾帧 / 参考图）均已真实跑通出片。
- **结果 URL 形态由 `watermark` 决定**：`true` → `/video_add_watermark/<uuid>/<uuid>.mp4`；
  `false` → `/video/<uuid>`（无扩展名）。制品类型不能靠扩展名推断。
- 可用合规测试图：`https://fastly.picsum.photos/id/415/1280/720.jpg?hmac=...`（1280×720 JPEG）。
  上游 CDN 的 `logo2.png` 只有 379×158，高度不足 300px 会被拒。

## 已知待决策事项

- `minimax-h3@1.0.8` 违反两条仓库硬约定：`channelTypes=[35]`（< 10000，是照抄上游的小数值）、
  author 不是 `Jushenzhidao`。**未修**——改 channelTypes 等于要求已上线用户重新绑定渠道，
  属产品决策。`route-lint.mjs` 会一直报它。
- `kling 1.0.1` 曾有 6 条 `/kling/v1/videos/*` 死路由（decode 指向从未导出的 `legacy*`），
  已在 `kling 1.0.2` 删除。教训：**路由声明的 decode/render 必须都能解析到 `native` 成员**，
  这类 bug 不报错、不崩溃，只是路由永远用不了。
- `.workbuddy-ai/tmp-tests/aivideomaker.e2e.mjs` 曾是**本地 mock**（`http.createServer`，不联网），
  却因文件名后缀被闸门计入「真实层」——正是「离线全绿只证明函数对」要防的假绿。
  **已合并进 `aivideomaker.test.mjs`**（284 → 360 条断言），原文件删除，`real` 层只剩真正联网的 `live`。
  **运行器用「文件名去后缀」推导插件 key**，所以 `<key>.flow.test.mjs` 会被推成不存在的 `<key>.flow`，
  一个插件只能有一个 `<key>.test.mjs` —— mock 流程测试没有别的后缀可用，只能并进去。
  判断一个脚本是不是真 e2e：看它有没有可配置的真实 Base URL，只有 `127.0.0.1` 就绝对不是。
- **拿到 PASS 之后不要跑离线-only 复核**：`LATEST.md` / `LATEST-<layer>.md` 按**时间**倒排取最新，
  离线-only 会把指针顶成 `INCOMPLETE`。复核离线层要带 `--include-live` 一起跑。

## 工具
- 结构体检：`.workbuddy-ai/skills/new-api-task-plugin-builder/assets/route-lint.mjs`
  （全仓库：meta.version/author、channelTypes 全局唯一且 >= 10000、路由 hook 悬空、
  query 误配 decode、route 形状重复、**用量契约配置可用性**（示例键集合 == schema 键集合、
  带 enum 的维度每个枚举值都要有示例覆盖、meta.models 非空）；退出码 1 = 有问题）。
  **它是唯一守着「枚举值有没有示例覆盖」的地方** —— 宿主只硬校验键集合，漏了不报错，
  但用户在倍率表里只会看到示例里出现过的值。加插件/改用量后必跑。
- 媒体探针：同目录 `media-probe.py`（零依赖读 ftyp/mvhd/trak/hdlr/stsd，无 ffmpeg 也能验成片）
- 测试闸门：`.workbuddy-ai/tools/test-runner.mjs`（报告落 `.workbuddy-ai/test-reports/`，
  `PASS` 才算完成；真实层要 `--include-live` + `LIVE_KEY`）
- 技能：`.workbuddy-ai/skills/new-api-task-plugin-builder/SKILL.md`（含仓库约定、四层实现、状态映射阶梯、调试决策树、验证要求）
- 真实联调脚手架：`.workbuddy-ai/skills/new-api-task-plugin-builder/assets/live-harness.mjs`
  （复制到 `.workbuddy-ai/tmp-tests/<key>.live.mjs`，改头部 PLUGIN_PATH/DEFAULT_BASE/DEFAULT_MODEL 三行；
  凭据走 `LIVE_KEY`/`LIVE_BASE` 环境变量；先 `--dry-run` 再真跑）
- 续查已有任务：同目录 `resume-task.mjs`（不重新提交＝不重复扣费）。
  `LIVE_KEY=... node assets/resume-task.mjs plugins/tasks/<key>/<semver>/plugin.js <task_id> [model] [out.mp4]`。
  脚手架没有「只查已存在任务」的入口，`--poll-max` 用尽而任务还在跑时只能靠它接着等；
  它还会在终态用插件自己的 render hook 渲染真实形状（离线测不到的那一层）。
- 仓库内无官方编译工具，无法生成 `index.json`，只做源码语法 + Hook 合同测试。
- 合同测试统一放在 `.workbuddy-ai/tmp-tests/<key>.test.mjs`（ESM，直接 import 插件源码）。
