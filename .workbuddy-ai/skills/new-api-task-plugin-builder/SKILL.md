---
name: new-api-task-plugin-builder
description: This skill should be used when creating, porting, reviewing, or debugging asynchronous task plugins for the local new-api-plugins repository, including video, image, music, audio, 3D, and other provider jobs. It covers heterogeneous protocol translation, native routes, polling, status mapping, artifacts, usage, routing failures, contract validation, timestamped test reports with reverse-chronological indexing, cross-version regression gating, and mandatory real end-to-end verification against the live upstream using user-supplied Base URL and credentials.
agent_created: true
---

# New API 通用任务插件制作与调试

## 目标与仓库定位

将任意厂商的异步任务 API 接入 `new-api-plugins`。本仓库是自建仓库，上游参考源为 `QuantumNous/new-api-plugins`；移植上游源码时必须改写身份类字段，不得照抄上游值。

目录固定为：

```text
plugins/tasks/<key>/<semver>/plugin.js
```

本仓库没有官方编译工具，通常只能执行源码语法检查、宿主同步语法扫描和纯函数 Hook 合同测试；不能自行生成 `index.json`。

## 仓库硬性约定

- `author` 固定为 `{ name: "Jushenzhidao" }`。
- `channelTypes` 从 `10000` 起递增；每个插件全局唯一，禁止复用上游小数值。写入前扫描 `plugins/**/plugin.js`，写入后把分配登记到本文末尾。
- 新插件从 `"1.0.0"` 开始，每次修复递增 patch；`meta.version` 必须与目录名完全一致。
- 已发布版本目录不可变；修改必须新建下一个 patch 目录，不能覆盖旧版本。
- 已上线插件不要随意改 `channelTypes`，改号等于要求用户重新绑定渠道。

## 宿主同步语法硬限制（重要）

宿主插件编译器会在上传/编译阶段扫描源码中的 `async`、`await`、`import` 关键字；命中时会拒绝插件并提示：

```text
unsupported plugin syntax "async": plugins must be synchronous and cannot import modules
```

因此：

- 插件必须使用同步普通函数，不得使用 `async function`、`async` 方法、`await` 或任何模块导入。
- 命名导出仍按宿主示例使用 `export const meta`、`export const native` 和 `export function ...`；ESM 导出不是该错误的原因。
- 上游 JSON 字段名若恰好是 `async`，不要在源码中写对象字面量 `async: true`，因为扫描器会把它误识别为插件异步语法。使用 `body["async"] = true` 或等价的计算属性构造，最终请求体仍保留字段名。
- 注释和字符串通常会在宿主扫描前被去除；不要依赖奇怪的绕过写法，真实 Hook 必须同步。
- `node --check` 不足以验证该限制；发布前还要执行去除注释/字符串后的关键字扫描，确认没有真实 `async`/`await`/`import` token。
- 这条限制与 `openai_responses` 的客户端 `sync` 请求模式无关；这里的同步是插件源码/Hook 执行限制。

## 开始前获取事实

0. **先读该插件的最新测试报告**：`.workbuddy-ai/test-reports/<key>/LATEST.md`（全文）与
   `.workbuddy-ai/test-reports/INDEX.md`（倒排总表）。报告里的「阻塞项」「未验证」就是本次的
   起点；跳过这一步直接改代码，等于闭眼改。详见「测试报告与回归闭环（强制）」。
1. 读取仓库结构和本地插件 API 文档；没有文档时查阅上游 `QuantumNous/new-api` 的 `docs/plugin-api/v1.md`。
2. 阅读厂商官方 API 文档，确认提交、查询、下载、鉴权、状态、错误 envelope、媒体字段和用量。
   **优先找机器可读的规范**（`/docs/*.json`、`/openapi.json`、`/swagger.json`、`/v3/api-docs`，
   或从页面 JS 里搜 `openapi`）：它一次性给出端点清单、请求 schema、状态枚举与错误码，
   比渲染后的文档页可靠得多（SPA 文档页抓取常被截断）。拿到后按「用官方规范反向校验」章节使用。
3. 明确四类身份：客户端模型 `ctx.model`、映射后的厂商模型 `ctx.upstreamModel`、New API 公开任务 ID、厂商上游任务 ID。公开 ID 与上游 ID 必须分别持久化和使用。
4. 记录 Base URL 与路径拼接规则；不要重复拼入部署前缀、插件 key 或 API 版本。
5. 获取两端真实请求/响应样例，逐项比较字段名、层级、类型、枚举、媒体表达、默认值和未知扩展字段。
6. **尽早向用户索要真实联调凭据**（Base URL + API Key / Token / Cookie，网页会话类还需 userId），
   并说明会消耗少量额度。要早要晚不影响正确性，但**报完成前必须有真实 e2e 结果或明确的未验证声明**
   ——开工就问只是为了避免收尾时才发现没凭据。凭据只进环境变量，详见「真实端到端联调（强制）」。

## 请求适配场景

不要用入口名称判断适配模式。按入站与上游的真实结构和语义判定：

- `isomorphic`：字段、层级、类型、枚举、媒体表达和缺省语义一致；只做模型、鉴权、URL 或内部字段修正。
- `heterogeneous`：字段改名、层级变化、单位转换、动作推断、媒体角色转换、默认值变化或协议不同；先解码为内部规范模型，再由唯一 encoder 白名单重建上游 body。

所有 decoder 只返回宿主 canonical intent：

```js
{ kind: "submit", model, action, requestBody, originTaskIds? }
```

适配信息必须放在 `requestBody`：

```js
function adapterRequest(mode, payload) {
  if (mode !== "isomorphic" && mode !== "heterogeneous") throw new Error("invalid adapter mode");
  return { adapterMode: mode, payload: payload };
}
```

driver hook 只消费 `ctx.requestBody`，不得按客户端路径、native 函数名或协议名分支；不要读取原始 `ctx.body`。`ctx.model` 保持客户端展示/计费身份，厂商 body 的模型按 `ctx.upstreamModel || ctx.model` 和厂商契约处理。

## 异构实现规则

- 每种入口先归一化到同一个内部规范模型，再调用单一 encoder。
- 明确每个语义的字段来源优先级和冲突处理；冲突不能靠对象覆盖顺序静默决定。
- 按上游 schema 白名单重建 body，禁止 `Object.assign({}, req)` 或 `{ ...req }` 后局部修补。
- 厂商扩展集中放入 `vendorOptions`/`extras`，只编码有文档依据的字段。
- 明确校验字段类型、枚举、范围、长度、默认值、端点和动作组合。
- 未知客户端字段不得泄漏；无法复刻的语义必须显式报错，不要静默丢弃。
- **区分「客户端没写」与「客户端写了默认值」——用 `*Given` 标记。** 入站契约里可选、上游却必填的字段
  （`duration` / `resolution` / `ratio` 最常见），decoder 归一化时必须额外记录 `durationGiven` /
  `resolutionGiven` / `aspectRatioGiven` 这类布尔标记，encoder 才能正确决策：没写且上游必填 → 显式报错
  （不静默替客户端选值）；写了 → 照传（哪怕值恰好等于上游默认值）。只有一个上游模型时这个标记没用；
  **一旦同一上游有多个模型、且各模型对某字段的支持面不同，它就是必需的** —— 否则「模型 A 根本没有这个
  字段」和「客户端没传这个字段」会塌缩成同一种输入，无法给出正确行为。教训：aivideomaker 1.0.1 的 8 个
  模型里，`t2v`/`i2v`/`t2v_v3`/`i2v_v3` 完全没有 `resolution` 字段，客户端传了要报错、没传要放过，
  靠默认值填充无法区分这两种情况。
- **区分「生成语义」和「旁路语义」，不要一律 400**：影响产物本身的语义（模型、歌词、风格、
  时长、续写边界）无法复刻时才显式报错；回调、通知这类**旁路/可选便利字段**只要上游有对应参数
  就尽力转发，把偏差写进注释，不要拦截整个请求。教训：acedata-suno 曾对 `notify_hook` 显式报 400，
  结果正常客户端（会默认带回调地址）全部被拒；而 AceData `/suno/audios` 文档「异步回调」本来就有
  `callback_url`，直接映射即可。
- 转发回调类字段前先查上游各端点：**不同端点参数表不一样**。同一插件里 `/suno/audios` 有
  `callback_url` 而 `/suno/lyrics` 没有，后者只能校验格式后忽略，不能无依据地塞进白名单。
- native 异构入口和 OpenAI 等跨协议入口必须复用同一规范模型和 encoder。

## 同构实现规则

同构模式应浅复制并最小修正，保留未知厂商字段、数组顺序和显式 `false`、`0`、`null`、空数组；不要用 `value || default` 改写合法值。只由插件重建 URL、method 和鉴权 header，不信任客户端传入的 URL、Authorization、Host 或代理控制字段。

## 插件骨架与路由

```js
export const meta = {
  apiVersion: 1,
  key: "vendor-key",
  name: "Vendor",
  version: "1.0.0",
  author: { name: "Jushenzhidao" },
  channelTypes: [10000],
  models: ["vendor_model"],
  fetchMode: "per_task",
  routes: [
    { method: "POST", path: "/vendor/submit", type: "submit", models: ["vendor_model"], decode: "submit", render: "submitted" },
    { method: "GET", path: "/vendor/fetch/:task_id", type: "query", taskIdParam: "task_id", render: "fetched" },
  ],
};

export function buildSubmitRequest(ctx) {}
export function parseSubmitResponse(ctx, resp) {}
export function buildQueryRequest(ctx) {}
export function parseTaskResult(ctx, body, response) {}
export function listArtifacts(task) {}
export function buildContentRequest(ctx) {}
export function extractUsage(ctx) {}

export const native = {
  submit(ctx) {},
  submitted(ctx, task) {},
  fetched(ctx, task) {},
};
```

- submit/dynamic 路由必须同时有 `decode` 和 `render`。
- query 路由只配置 `render`，不要配置 `decode`。
- `taskIdParam` 必须以同名 `:placeholder` 出现在 path 中。
- `routes[].models` 只用于 submit/dynamic，不用于 query。
- `dynamic` 是第三条路由类型，专门承载「一次请求返回多个任务」的批量查询
  （典型：New API Suno 的 `POST /suno/fetch { ids: [...] }`）。约定：
  - decode 返回 `{ kind: "query", taskIds: [...] }`（taskIds 是**公开任务 ID**）；
  - 宿主校验归属后把任务数组交给 render，render 返回 `data: 任务对象[]`；
  - 参考实现见上游官方 `sunoapi` 插件：`{ method:"POST", path:"/suno/fetch", type:"dynamic", decode:"decodeBatch", render:"renderTasks" }`。
- **不要**因为「query 路由的 `:task_id` 占位符限制」就判定批量查询无法实现——
  那条限制只约束 `type: "query"`，`type: "dynamic"` 的 path 不需要占位符。
- `:action` 之类的通配 path（如 `/suno/submit/:action`）是合法的单条 submit 路由，
  能同时覆盖 `/suno/submit/music`、`/suno/submit/lyrics` 等具体路径，比声明多条更省路由；
  分派要依据 `ctx.params.action` 的动作语义，driver hook 仍只消费 `ctx.requestBody`。
- 已线上验证过的宿主事实（acedata-suno 1.0.11）：`:action` 通配能命中具体路径；
  `type:"dynamic"` 的批量查询路由可用；`fetchMode:"batch"` + `buildBatchQueryRequest`/
  `parseBatchResult` 被宿主正确消费，批量结果里的 `action` / `progress` 字段会被采信。
- **用户已验证过的版本目录不要再改源码**（哪怕只加一行注释），否则验证结论失效；
  补充说明只写进注释以外的文档/记忆。
- 协议 hooks 必须按 `protocols` 声明的模式精确导出，不能声明一个模式却缺少对应 hook。

### route path 与上游 URL 是两套东西（易错）

插件对外暴露给客户端的 `meta.routes[].path`，和 decode 里拼给上游的 `url`，互不相干。
移植旧插件时**先确认旧插件那段路径拼接是否真的被用了**——`kling-v3` 插件里有个算出
`text-to-video/kling-3.0` 这类带模型后缀路径的 `endpoint` 变量，但下一行拼 URL 时没引用它，
1.0.0 到 1.0.9 五个版本实际发出的都是无后缀 URL。照抄这种死代码会打出上游不存在的路径。

判定方法：把变量名拿去 grep 全文，确认它出现在最终 `url` 的拼接表达式里，而不是只被赋值一次。

当需要兼容旧插件的带模型后缀调用路径时，正确做法是只在 route 层加后缀入口，上游 URL 保持不变：
- decode 函数签名加一个 `modelHint` 参数，由后缀路由传入，优先级高于 `body.model`
  （客户端既然打了带后缀的 URL，就以后缀为准，避免 body 里残留的旧 model 串味）。
- 同构复制路径上必须有 `body.model = model` 这样的显式覆盖，否则后缀锁不住模型。
- 加了通配后缀路由后，检查是否与 `type: "query"` 的 `:task_id` 路由撞形状
  （`/x/omni-video/:m` 与 `/x/tasks/:id` 段数相同）。发布前断言「路由形状去重后数量不变」
  且「GET 查询路由只有一条」。

## 提交、查询和任务 ID

`parseSubmitResponse` 只返回宿主允许的字段：

```js
{ taskId, taskData, immediate?, state? }
```

完整上游响应放入 `taskData`，供轮询、artifact 和 renderer 使用。查询时使用持久化的厂商 task ID，不要把 New API 公开任务 ID误当上游 ID。若单插件只服务一个上游，查询路径固定；不要依赖轮询上下文里可能为空的模型字段来选路径。

`fetchMode: "batch"` 时宿主把同一批在途任务合成一次 `buildBatchQueryRequest(ctx, tasks)`，结果由
`parseBatchResult(ctx, body, response)` 返回数组（每项 `{taskId, action, status, reason, progress, data, ...}`）。
要点：

- 批量 hook 与 `fetchMode` 必须一致；同时**保留** per-task 的 `buildQueryRequest`/`parseTaskResult`
  做合同兼容（官方 sunoapi 就是两者都导出）。
- 结果按业务 ID 回填 `taskId`（用 `items[].id` 之类），**不要假设返回顺序与请求顺序一致**。
- 每条结果的 `data` 存整包上游对象，保证制品提取和 renderer 与单查路径完全同一套逻辑。
- 批量端点自身的错误（token/限流/内部错误）要抛错让宿主重试，不要把整批判成任务失败。
- **上游查询需要多步握手（先换签名 token 再读 SSE）时**，`buildQueryRequest` 只能发一个请求、插件运行时也没有
  `fetch()`，此时退而求其次用「单请求列表端点 + 按 id 定位」（aivideomaker 网页会话用 `/api/model.listModel`）。
  两个要点：① 列表端点常需要用户标识，缺了会返回别人的公开数据，必须在凭据校验阶段就强制；
  ② 目标 id 不在返回窗口里时判 `QUEUED` 继续轮询，**不要判 FAILURE**（刚提交的任务可能还没进列表）。

## 状态映射六层阶梯

内部状态只允许 `QUEUED`、`IN_PROGRESS`、`SUCCESS`、`FAILURE`，永不返回 `UNKNOWN`。从上到下命中即返回：

0. 错误 envelope：明确错误码/顶层 error；HTTP 408、429、5xx 通常抛错让宿主重试。
1. 文档声明式状态枚举：逐项写完整映射表。
2. 精确枚举匹配。
3. 前缀兜底：成功 `success*|succ*|ok|okay|comp*`；失败 `erro*|fail*|cancel*|expire*|timeout*|reject*|abort*`；进行中 `run*|process*|progress*|generat*|render*`；排队 `queue*|pend*|submit*|wait*|not_start`。
4. 结果字段兜底：仅认结果对象的 `url`、`video_url`、`image_url`、`result_url`、`output.url`、`data[].url` 等有效 HTTP URL。
5. 失败信号兜底：`fail_reason`、`err_msg`、`error.message` 等非空时判失败，且优先于结果 URL。
6. 安全默认：`QUEUED`，绝不 `UNKNOWN`。

状态值先 trim、转小写、把空白/连字符折叠为下划线。禁止子串匹配，以免 `not_completed`、`unpaid`、`pre_failed` 被误判。

- **先归一化响应形状再走阶梯**：acedata `/suno/tasks` 的 `action` 枚举有两个值，对应两种响应——
  ① `retrieve`（默认值，传 `id`）→ **单个包裹体**
  `{_id, id, created_at, started_at, finished_at, elapsed, request:{action,prompt}, response:{success,task_id,data:[]}}`；
  ② `retrieve_batch`（传 `ids: string[]`）→ **批量体** `{items:[<包裹体>, ...], count:n}`。
  另有 ③ 同步响应（`async:false`）是顶层平铺体 `{success, task_id, trace_id, data:[]}`，异步轮询遇不到。
  用 `responseOf()` 之类的函数先取出响应体再判状态，否则非预期形状会一路落到「安全默认」，任务永远停在 QUEUED。
  批量解析必须按 `items[].id` 匹配 taskId，**不要假设返回顺序与请求 `ids` 一致**。
- **区分「查询自身错误」和「任务终态失败」**：只有显式 `error{code,message}` 是查询错误（抛错让宿主重试）；
  顶层 `success: false` 是任务失败，判 `FAILURE`（会走退款），不能抛错——抛错只会累加 `PollFailures`，用户拿不到退款。`SUCCESS` 要有 `progress: "100%"` 和可用结果；`FAILURE` 要有非空 `reason`。parser 只负责厂商→宿主，renderer 负责宿主→公开协议，不要在 renderer 再猜上游状态。

## Artifact 与内容回源

成功任务的 `listArtifacts` 返回稳定 key 和 MIME 类型；URL 从完整持久化 envelope 提取，去重并保持顺序。`buildContentRequest` 回源公共 CDN 时使用 `credentialless: true`，不携带渠道 Authorization。纯文本任务不注册 artifact，直接由 renderer 透传文本。

## 用量

提交期无法取得真实用量时，按文档定义的操作口径估算；`usagePurpose === "billing_ratios"` 时按宿主合同返回 `null`。不要编造查询期不存在的消耗数据。计费用模型使用 `ctx.upstreamModel || ctx.model`。

**宿主 usage 硬校验**：加载插件时宿主会校验 `usageExamples[*].facts` 必须覆盖 `usageSchema` 的全部键，缺一个就报
`plugin meta usageExamples[i] facts missing key "<key>"` 并拒绝加载（`0` 值合法，如 `input_images: 0`）。
所以凡是写进 `usageSchema` 的维度，都要同时出现在**每一条** `usageExamples` 和提交期 `extractUsage` 的返回里。
发布前用「examples 键集合 == schema 键集合」做一次断言。

**`usageSchema` 该放什么（推荐口径）**：只放**提交期即可确定的离散/可枚举维度**（时长、分辨率、素材张数等），
它们才适合做倍率表的行。厂商在任务完成后才返回的连续值（如 `total_tokens`）**不要进 schema**：
进了就必须在所有示例里用 `0` 占位，等于让倍率表出现一条无意义的 0 值行。这类原始用量随任务数据持久化，
对账时从任务原始响应里取即可。`extractUsageOnComplete` 也只回填 schema 内的维度（如把估算 `seconds`
换成真实出片时长）。kling 1.0.0 → 1.0.1 就是按这个口径把 `tokens` 摘掉的。

**不要为上游不存在的维度编造默认值。** 某个上游模型根本没有该字段时，提交期 `extractUsage` 应当返回一个
显式的 `"unspecified"`（并把它加进 `enum`），而不是填上游的默认值 —— 填了默认值等于给倍率表凭空造出一条
上游并不存在的维度，用户按它配的倍率会永远算错。教训：aivideomaker 1.0.1 最初给没有 `resolution` 字段的
4 个模型（t2v/i2v/t2v_v3/i2v_v3）填了默认 `720p`，真实跑完 `t2v` 才发现成片其实是 **1080p**（1904×1080），
而用量回填里根本没有 `resolution` 这一项。

**判据必须是「上游模型有没有该字段」，不能是「payload 里有没有值」（易错）。** 同一个插件常有多入口
（原生 + OpenAI 协议），而**跨协议入口的 decoder 会替缺失字段补默认值**，于是同一个上游模型在两个入口下
`payload` 形状不同：原生入口缺字段时 payload 里没有，OpenAI 入口缺字段时 payload 里是默认值。
只看 payload 判断，同一个任务走两个入口会记出两个不同的用量维度，倍率表对不上。
做法：把「没有该字段的模型」写成显式常量（如 `MODELS_WITHOUT_RESOLUTION`），
`extractUsage` 里先按 `ctx.upstreamModel || payload.model || ctx.model` 解析出上游模型再判定 ——
优先级要与请求构建 hook 保持一致，否则模型重定向后用量会按客户端展示名算。
教训：aivideomaker 1.0.1 的火山入口记 `unspecified`，openai 入口却把默认 `720p` 记成了真实维度，
是 dry-run 对比两个入口的 `usage(submit)` 才发现的 —— **多入口插件要专门跑一次「同模型两入口用量一致」的对比**。

**哨兵值必须出现在 `usageExamples` 里。** `"unspecified"` 这类「该模型不存在此维度」的值一旦进了 `enum`，
就一定要在 `usageExamples` 里列一条 —— 否则用户在倍率表里只会看到 480p/720p/1080p 三行，
没有该字段的那些模型**永远匹配不到任何行**，而配置界面里看不出还有第四个可能值。
宿主的硬校验只管「示例的键集合覆盖 schema 的键」，不管条数与枚举覆盖，所以这条只能靠自觉。
再补一条合同断言（`usageExamples.some(e => e.facts.<dim> === "<哨兵值>")`）防止被人当冗余示例删掉。
教训：aivideomaker 1.0.1 补了 `5s unspecified (models without a resolution field)` 才补上这个缺口。

## 真实端到端联调（强制）

离线合同测试只能证明「函数对」，证明不了「上游认」。**每次新建插件、每个新 patch 版本，以及改动了
请求构建 / 状态映射 / 制品提取的任一 hook 后，必须向用户索取真实凭据并跑通一条真实任务。**

### 触发时机与索要话术

在准备收尾、准备报「已完成」之前，主动停下来问用户（不要自己假定没有凭据就跳过）：

```text
需要跑一次真实端到端验证（会消耗少量额度）。请提供：
1. Base URL（默认 <DEFAULT_BASE>，若不同请说明）
2. 凭据：API Key / Token / Cookie（网页会话类还需 userId 等配套标识）
3. 一条最小可用参数：模型名 + prompt（图/视频类再给一个可公网访问的图片 URL）
没有真实凭据我只能停在离线测试，无法确认上游是否接受这个请求。
```

- 用户暂时给不出凭据时，说明「已完成的验证范围」和「未验证的部分」，不要含糊带过。
- 凭据用于**真实上游**；不要用 mock 顶替真实联调，mock 只能作为回归测试。

### 凭据处理硬规则

- 凭据**只从环境变量读**（`LIVE_KEY` / `LIVE_BASE`），不写进源码、测试文件、skill、记忆或任何 git 跟踪文件。
- 日志打印一律脱敏（模板已内置 `mask()`：只显示首尾各几位 + 长度）；不要把完整 key 贴回对话。
- 网页会话类凭据（cookie + userId）按插件约定整段 JSON 传入。
- 跑之前明确告知会消耗上游额度/积分。

### 操作流程

1. 复制脚手架并改头部三行（`PLUGIN_PATH` / `DEFAULT_BASE` / `DEFAULT_MODEL`）：

```bash
cp .workbuddy-ai/skills/new-api-task-plugin-builder/assets/live-harness.mjs \
   .workbuddy-ai/tmp-tests/<key>.live.mjs
```

2. 先跑 `--dry-run`：不联网、不消耗额度，确认 hook 链齐全且 URL/header/body 拼装正确（header 中的凭据自动脱敏）。

```bash
LIVE_KEY='...' node .workbuddy-ai/tmp-tests/<key>.live.mjs --dry-run --prompt "..."
```

3. 确认拼装无误后再跑真实链路（decode → 提交 → 轮询到终态 → 用量 → 制品 → 回源下载 → render）：

```bash
LIVE_KEY='...' node .workbuddy-ai/tmp-tests/<key>.live.mjs --raw '{"prompt":"..."}' --download out.mp4
LIVE_KEY='{"cookie":"...","userId":"..."}' node <key>.live.mjs --prompt "..." --image https://.../a.jpg
```

常用参数：`--raw '<json>'`、`--prompt`、`--image`（可重复）、`--model`、`--artifact`、
`--entry native|openai`、`--poll-interval`、`--poll-max`、`--download`。

### 通用范式，不绑定任何厂商

脚手架适用于视频、图像、音乐、音频、3D 等所有插件；**不要为某个插件把厂商细节写进模板**。

- **优先用 `--raw` 直接给入站 body**。跨插件语义由各插件自己的 decoder 解释，模板不做厂商假设。
  `--prompt`/`--image` 只是多媒体类的便利快捷方式，拼装规则是「常见约定」不是通用契约——
  不同插件入站字段可能是 `prompt`/`text`/`input`、`image`/`images`/`image_url`，拿不准就用 `--raw`。
- **制品 key 一律从插件自身的 `listArtifacts` 推导**，不硬编码 `video` / `audio` / `image`；
  制品条目常常**不带 `url`**（只有 key/type/mimeType），url 要回退到任务结果 URL——
  否则会误判「无制品」而静默跳过回源下载。
- **结果字段、用量、render 都从插件自己的 hook 返回值取**，模板只负责串联和打印。
- 若某插件的 hook 签名与本模板默认值不同，以 `--dry-run` 输出为准微调副本，不改模板本身。

### 通过判定

- 提交返回真实 task ID；轮询走到 `SUCCESS`；拿到可访问的结果 URL；`--download` 能落盘且体积合理。
- 传入了素材 URL（`--image`）时会跑预检：体积 > 5MB、或扩展名与实际格式不符（.jpg 实为 PNG）会先告警；纯文本类插件不触发。
- **成片参数要真去验，别只看状态码**：拿到文件后确认「请求的参数确实生效了」。
  直接用技能自带的探针（零依赖，没有 ffmpeg 也能跑）：

  ```bash
  python3 .workbuddy-ai/skills/new-api-task-plugin-builder/assets/media-probe.py out.mp4 out2.mp4
  ```

  它打印容器品牌、`mvhd` 真实时长、每条 `trak` 的 `hdlr`（vide/soun）+ `stsd` codec + 分辨率。
  这样能零成本证明「`generate_audio=true` 真的出了音轨（有 `soun`/`mp4a`）」
  「请求 10s 的成片 `mvhd` 就是 10.08s」「720p 的成片视频轨就是 1280×720」——
  而不是相信上游回显的参数，回显字段很可能只是请求的副本而非实际产物属性。
  只有 `ftyp` 没有 `moov` = 分片流式容器或下载不完整。
- 任一步失败都算未完成，按「调试决策树」定位根因后重跑。

### 真实层脚本必须自己记失败用例（易错）

闸门按「解析出的失败用例数」判层结论，**不只看退出码**。真实层脚本如果既不输出
`✓/✗` 行也不输出聚合数字，闸门会合成一条 `__process__`「进程未产生任何可解析结果」的 FAIL——
**真实层永远拿不到 PASS**（实测踩过：live 脚本正常出片、exit 0，仍被判 FAIL）。
所以 `process.exit(1)` 静默退出是**危险写法**。`live-harness.mjs` 已内置正确做法，改脚本时保持：

- 任何失败分支都走 `fail(label, detail)`（记一条失败用例 + `t.done()`），不要裸 `process.exit(1)`。
- `t.done()` **只在有失败时退出**，所以 `--dry-run` 这类「跑完就该结束」的分支
  必须在 `t.done()` 后补 `process.exit(0)`，否则会继续往下真的提交任务、白烧额度。
- 成功分支把关键断言记成用例（拿到 task id、轮询到终态、结果 URL 可访问、
  制品非空、回源 `credentialless`、下载落盘），这样真实层也能做逐用例回归。
- 「纯文本类任务没有结果 URL / 没有制品」属正常，记 `t.warn` 而不是 `t.ok(false)`。

### 凭据自检：查询通 ≠ 能提交（易误判）

验证凭据时**不要只用查询/列表端点**证明「凭据可用」。权限常常是分层的：额度耗尽、验证码、
订阅到期、风控等只限制写操作，读操作照常返回 200。典型模式：**「能列出历史任务，但提交必失败」**。

- 只用列表端点验证，会得出「凭据没问题」的错误结论，然后把提交失败误判成插件 bug。
- 正确做法：自检分两步 —— 先用读端点确认凭据有效，**再实际提交一次**确认有写权限。
- 有些上游把这类拒绝包成 **HTTP 200 + 空结果**（不是 4xx），只看状态码会误判成成功。
  提交后必须解析出真实 task ID 才算通过，拿到 `""`/`null` 一律当失败。

### 失败时的第一反应

- `401/403`：先查鉴权 header 名与位置（`key` / `Authorization: Bearer` / `Cookie`），再查凭据本身。
- 提交返回空 ID 而查询正常：按上一节排查额度/验证码/权限分层，别急着改插件。
- `404`：URL 拼错——回到「route path 与上游 URL 是两套东西」复查。
- `400`：字段校验不通过，逐个比对上游必填字段与取值范围。
- 任务 `FAILURE`：区分是上游真的失败，还是状态映射/参数映射错误（看 `--poll` 打印的上游原文）。
- 一直停在非终态：**先直连上游把该任务的原始状态打出来**（`GET /tasks` 列表端点或单任务查询端点，
  一条 curl 即可），看到 `status` 真的是 `PROGRESS`/`running` 就是任务真的慢，不是映射漏枚举。
  教训：aivideomaker 的 `i2v_v3` 5s 任务轮询 40 次（10 分钟）仍是 `IN_PROGRESS 50%`，
  查 `/api/v1/tasks` 确认上游 `status:"PROGRESS"`、`output:null`、积分已扣 —— 第 41 次才转 `COMPLETED`。
  **同一上游不同模型的完成时延可能差一个数量级**，联调脚手架的 `--poll-max` 要按最慢的那个设，
  否则会把「还在跑」误判成「状态映射 bug」，然后去改本来正确的代码。

### 别猜错误信封，用真实响应校正（易错）

文档通常只给「HTTP + 错误码表」，**不给响应体形状**，而码表看着像某家大厂就顺手假设信封也同构，
是常见误判。senseaudio 的码值（400000/400015/500000）与火山方舟完全同构，
但真实信封是 `{"code":"图片链接无效","message":"图片链接无效","ref_code":400000}`——
`code` 是**字符串 slug**（有时直接就是中文提示本身），数字码在 `ref_code` 里，
根本没有 `{error:{code,message}}` 那层。做法：

- 解析器写成「逐个形状探测 + 只在明确命中时判错」，成功体不带 `code` 时才不会被误伤。
- 拿凭据后**先用一条必然失败的请求**（错 key / 不存在的 id / 不存在的素材）把错误信封打出来，
  成本为零（失败请求不计费），比翻文档快。这一步应该在第一次成功提交之前做。
- 顺手确认成功体的最小形状（提交只回 `{task_id}` 还是包一层 envelope），避免解析器凭空加壳。

### 素材类插件：上游在 create 阶段就校验素材

- 上游会真的去拉素材 URL 并校验**可达性 + 格式 + 尺寸**，报错形如「图片链接无效」/「图片高度不符合要求」。
  插件运行时没有网络能力，无法预取，只能让上游明确拒绝——这是正确行为，不要试图在 decode 里补校验。
- 因此联调必须准备**真正合规**的素材。占位域名（`example.com/xxx.jpg`）会被直接拒；
  上游自己 CDN 上的小图也常因低于尺寸下限被拒（实测一张 379×158 的 logo 报「图片高度不符合要求」）。
  可用 `https://picsum.photos/<宽>/<高>`（会 302 到 `fastly.picsum.photos`，把最终 URL 拿下来直接传更稳），
  或任何宽高都落在上游约束内的公网图。
- **「报的是素材自身问题」而不是「字段不认」本身就是映射通过的证据**：上游已经读到并解析了那个字段，
  才会去校验素材内容。调试时用这一点把「字段映射错」和「素材不合规」分开。

## 用官方规范反向校验（拿到 OpenAPI 时必做）

不消耗额度、不需要凭据，却能证明「插件发出的请求符合厂商声明的契约」，价值高于纯自造 fixture。
做法：读规范 JSON，写一个脚本（放在 `.workbuddy-ai/tmp-tests/<key>.openapi.mjs`）断言：

1. **端点命中**：`buildSubmitRequest` / `buildQueryRequest` 产出的 URL 去掉 base 后
   （把真实 taskId 换回 `{taskId}` 这类模板）必须存在于 `spec.paths`，且 method 对得上。
2. **字段白名单**：body 的每个 key 都在 schema `properties` 里（多一个就是厂商不认识的字段）；
   schema 的 `required` 全部存在。
3. **取值合规**：`enum` 命中、`type` 匹配、数字 `minimum`/`maximum`、数组 `maxItems`。
4. **状态枚举全遍历**：`spec` 里的状态枚举逐个喂给 `parseTaskResult`，断言映射结果且永不 `UNKNOWN`。
5. **规范形状可解析**：用规范里的响应 schema 造一条记录，断言能取出结果 URL 与用量维度。

差异要**显式分类**而不是让测试变绿：把「与规范不符但有意保留」的项收进 `knownDiffs` 单独打印，
既保留 `failed=0`，又让差异暴露在报告里。判定原则：

- **官方枚举比插件窄**（如官方只有 720p/1080p，实测 480p 也能出片）：保留宽的一侧并照传，
  让上游用明确 400 拒绝；**不要静默夹紧到更贵的档位**，那是隐性多扣费。
- **官方文档与实测冲突**（如文档说接受 data URI，实测被拒）：以实测为准，但在 README 写明冲突，
  因为另一条路径（不同凭据形态）可能确实支持且当前无法验证。

顺带能确认的常见问题：规范里**没有上传端点** = 该上游根本不支持客户端上传，不用再找；
响应 schema 顶层没有 `progress` = 印证「缺失时按状态推导、不能当 0」。

## 测试报告与回归闭环（强制）

### 四条铁律

1. **不许手写报告，只许跑运行器。** 报告一律由 `.workbuddy-ai/tools/test-runner.mjs` 生成到
   `.workbuddy-ai/test-reports/`；手写一句「测试通过」不构成证据。
2. **改代码前先读最新报告，改完必须重跑并让闸门 PASS。** 不看历史报告就动手，等于闭眼改。
3. **回归即阻塞。** 任何「上一份报告通过、本次失败」的用例判 `REGRESSION` → 闸门 `FAIL`。
   不许放行、不许删用例或改断言名来绕过——那只是把问题从报告里藏起来。
4. **层覆盖不得退化。** 离线全绿 ≠ 完成。真实层没跑，闸门就是 `INCOMPLETE`，
   回复里必须写明「未验证：真实端到端（缺凭据）」。

### 闭环四步（每次优化修复都走一遍）

```text
① 读最新报告
   .workbuddy-ai/test-reports/LATEST.md          # 全插件最新摘要
   .workbuddy-ai/test-reports/<key>/LATEST.md    # 该插件最新一份（全文）
   .workbuddy-ai/test-reports/index.json         # reports[0] 即最新，含逐条用例
② 修复        ← 依据报告里的「阻塞项」「未验证」两节，不要凭猜
③ 重跑闸门    node .workbuddy-ai/tools/test-runner.mjs --key <key> --include-live
④ 读新报告    回归 0 且闸门 PASS 才算修完；否则回到 ②
```

**③ 必须带 `--include-live`（易错）。** `LATEST.md` / `LATEST-<layer>.md` 是按**时间**倒排取最新的，
所以拿到 `PASS` 之后再跑一次**离线-only**的运行，会把 LATEST 指针顶成 `INCOMPLETE`
（报告本身没错，但它成了「最新一份」）。想复核离线层就带上 `--include-live` 一起跑，
不要用离线-only 去「顺便看看」。真跑了离线-only 导致 LATEST 变 INCOMPLETE，
带 `--include-live` 再跑一次即可恢复，报告历史不受影响。

### 目录布局（时间倒排）

```text
.workbuddy-ai/test-reports/
  INDEX.md      全量倒排总表，最新在最上
  index.json    机器可读倒排索引；reports[0] 是最新一份，含逐条用例
  LATEST.md     每个插件最新一份的摘要
  <key>/
    <YYYYMMDD-HHmmss>-<key>-<version>-<layer>.md   不可变报告，历史永存
    LATEST.md / LATEST-<layer>.md                  该插件（该层）最新一份的副本
```

- 报告**不可变**：不要编辑已生成的报告文件，要修正就重跑生成新的。
- 索引**自愈**：报告文件被删，对应索引项会在下次运行时自动剔除。
- 报告头部钉死了**被测源码 sha256** 与**脚本 sha256**，所以「这份报告验的是哪一版代码」无歧义；
  改完插件重跑后 sha256 必须变化，否则说明你测的还是旧文件。

### 四层

| 后缀 | 层级 | 联网 | 默认跑 |
| --- | --- | --- | --- |
| `*.spec.mjs` / `*.openapi.mjs` | `spec` | 否，官方规范反向校验 | 是 |
| `*.test.mjs` | `contract` | 否，纯函数合同 | 是 |
| `*.live.mjs` | `live` | 是，真实上游（消耗额度） | 否，需 `--include-live` + `LIVE_KEY` |
| `*.e2e.mjs` | `e2e` | 是，真实端到端 | 否，同上 |

**`.e2e.mjs` 必须是真打上游的脚本，不许拿本地 mock 冒充（易错）。** 运行器无法判断脚本是否真联网，
只要文件名叫 `*.e2e.mjs` 就计入「真实层」，于是「本地 mock 上游 + 真实 fetch」的流程测试会被闸门
当成「上游认了」——正是「离线全绿只证明函数对」要防的那种假绿。mock 上游的**全链路流程测试属于
contract 层**，但它没有合适的后缀可用：运行器用「文件名去掉后缀」推导插件 key，所以
`<key>.flow.test.mjs` 会被推成 `<key>.flow` 这个不存在的插件（多出一条 INCOMPLETE 的假闸门项），
一个插件只能有一个 `<key>.test.mjs`。结论：**把 mock 流程测试并进 `<key>.test.mjs`**。
案例：aivideomaker 原有一个 76 条断言的 mock 流程测试叫 `aivideomaker.e2e.mjs`（全走本地
`http.createServer`），已并入 `aivideomaker.test.mjs`（284 → 360 条），删掉该文件后该插件的
`real` 层只剩真正联网的 `live`，闸门仍 PASS。**判断办法**：脚本里若只有 `127.0.0.1` 而没有
可配置的真实 Base URL，它就绝对不是 e2e。

### 闸门判定（按插件聚合，不按单层）

一次运行里同一插件的所有层**合并**判定，避免「spec 层因为这次没跑 contract 被判 INCOMPLETE」这类误报：

- 任一层有用例失败或回归 → `FAIL`（退出码 1）
- 否则要求的层没覆盖齐 → `INCOMPLETE`（退出码 2，**不算完成**）
- 全齐 → `PASS`（退出码 0）

默认要求 `contract` + `real`（`live` 或 `e2e` 任一）。`--offline-only` 可降级为只要求 `contract`，
但那只在「明确声明离线层通过、真实层未验证」时使用，不能拿来当完成。

### 常用命令

```bash
NODE=~/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin/node   # 托管 Node

$NODE .workbuddy-ai/tools/test-runner.mjs                          # 全部插件离线层
$NODE .workbuddy-ai/tools/test-runner.mjs --key kling              # 单插件
$NODE .workbuddy-ai/tools/test-runner.mjs --json                   # 额外输出机器可读摘要
$NODE .workbuddy-ai/tools/test-runner.mjs --offline-only --key k   # 明确只验离线层
LIVE_KEY='...' $NODE .workbuddy-ai/tools/test-runner.mjs --include-live --key <key>
```

真实层需要参数时用 `--live-arg` 透传（可重复），例如
`--live-arg '--raw' --live-arg '{"prompt":"..."}' --live-arg '--download' --live-arg 'out.mp4'`。

### 用例级输出约定（决定回归能不能定位到具体用例）

运行器认三种输出，**越靠前越好**：

1. **结构化块（推荐）**：用 `assets/testkit.mjs` 的 `createSuite()`，同时产出人读行与 JSON 块，
   并显式声明 `key` / `version` / `layer`——这三个值优先于文件名与源码推断，最可靠。
2. **人读用例行**：`  ✓ label` / `  ✗ label` / `  ⚠ label`，`== 分组名 ==` 作为分组标题。
3. **仅聚合**：`ALL PASS: N assertions` / `FAILED n (passed m)` / `passed=n failed=m`。
   这种情况下回归只能靠「通过数下降 / 失败数上升」判断，定位不到用例——报告里会标注
   「断言粒度：仅聚合」，应尽快迁移到 testkit。

老脚本的断言辅助函数里已经插了 `mark()` 打印（带注释 `// 用例级输出：… 勿删`），
**不要删掉那几行**，删了回归比对就退化回聚合粒度。同理，新写测试脚本时别把 `ok/eq/throws`
换成静默计数版本。

### 报告里必须看的两节

- **阻塞项**：回归用例 / 仍未修复用例。有内容就是没修完，先修再谈其他。
- **未验证**：导致闸门不是 PASS 的缺失层。有内容就不许报「完成」。

## 技能自带资产（离线 + 真实两层）

`assets/` 目录下的资产，新插件直接复用，不要重写：

| 资产 | 用途 |
| --- | --- |
| `live-harness.mjs` | 真实端到端联调脚手架（见「真实端到端联调（强制）」）；**自身也输出结构化结果块**，失败记成失败用例而不是静默退出 |
| `resume-task.mjs` | **续查已有任务**（不重新提交、不重复扣费）：接着轮询一个已存在的 task id，并在终态用插件自己的 render hook 渲染真实形状。`--poll-max` 用尽而任务还在跑时用它接着等 |
| `testkit.mjs` | 用例级断言套件：每个断言带稳定 id，输出结构化结果块，回归比对能精确到用例 |
| `media-probe.py` | 零依赖媒体探针：校验下载产物的容器/轨道/codec/真实时长（见「通过判定」） |
| `route-lint.mjs` | 全仓库结构体检（零成本、不联网）：meta.version/author、**channelTypes 全局唯一且 >= 10000**、路由 hook 悬空、query 误配 decode、route 形状重复，以及**用量契约的配置可用性**（示例键集合 == schema 键集合、**带 enum 的维度每个枚举值都要有示例覆盖**、`meta.models` 非空） |

```bash
node .workbuddy-ai/skills/new-api-task-plugin-builder/assets/route-lint.mjs   # 全仓库，退出码 1 = 有结构性问题

# 任务还没跑完但轮询次数用尽时接着查（不要重新提交，会重复扣费）
LIVE_KEY='ak_xxx' node .workbuddy-ai/skills/new-api-task-plugin-builder/assets/resume-task.mjs \
  plugins/tasks/<key>/<semver>/plugin.js <task_id> [model] [out.mp4]
# 轮询间隔/次数用 POLL_INTERVAL / POLL_MAX 覆盖；插件需要额外 ctx 字段时用 CTX_EXTRA='{"userId":"..."}'
```

单插件的合同测试只能检查自己，查不了 **channelTypes 全局唯一** 这类跨插件属性，
所以每加一个插件都该跑一次 route-lint。它也是唯一能批量发现「路由 hook 悬空」的工具
——那类 bug 不报错、不崩溃，只是路由永远用不了，跑测试很容易漏。

它同时守着**用量契约的配置可用性**，这一条宿主自己不管：宿主只硬校验「示例的键集合覆盖 schema 的键」，
**枚举覆盖与否它不校验，漏了不报错**，但用户在倍率表里只会看到示例中出现过的值。
最典型的是「该模型不存在此维度」的哨兵值（如 `unspecified`）：不列进示例，
那些模型在倍率表里永远匹配不到任何行。route-lint 会报
`usageSchema.<dim> 的枚举值没有任何示例覆盖: [...]`。案例：aivideomaker 1.0.1 就是这样漏的，
补了一条 `5s unspecified` 示例后全仓库 12 个插件才全绿。

`testkit.mjs` 用法（测试脚本放 `.workbuddy-ai/tmp-tests/`）：

```js
import { createSuite } from "../skills/new-api-task-plugin-builder/assets/testkit.mjs";
const t = createSuite({ key: "vendor", version: "1.0.0", layer: "contract" });

t.section("meta 约定");
t.ok(cond, "用例名");
t.eq(actual, expected, "用例名");
t.throws(() => fn(), /正则或片段/, "用例名");
t.warn("有意保留的偏差", "为什么保留");
t.done();   // 打印结构化块并设置退出码；不调用则按 0 退出
```

- **用例名就是稳定 id，改文案等于换 id**，回归比对会认成「删一条 + 加一条」，所以命名要一次定稳。
- `t.warn` 专门登记「有意保留的偏差」：不阻塞闸门，但会进报告——比写注释更难被忽略。
- 输出仍是 `✓/✗/⚠ label` 人读行，直接 `node x.test.mjs` 手跑也正常。
- **把实测抓到的真实响应原文粘进测试**做回归（错误信封、pending/completed 原文），
  防止解析器被「看起来更合理」的重构改坏。这一层比自造 fixture 值钱。

## 验证清单

**完成的定义（收尾闸门）**：跑 `test-runner.mjs` 拿到闸门 `PASS` 才算完成。
`INCOMPLETE` = 离线层过了但真实层没验，**不算完成**；`FAIL` = 有失败或回归，必须先修。
两种非 PASS 状态下，回复里必须分两段写明「已验证：…」与「未验证：…（缺 <凭据类型>）」，
不许报完成、不许用 mock 含糊带过。

每个新 patch 版本至少执行：

1. 检查目录名与 `meta.version` 一致，author/channelTypes 正确且不重复。
   **这一步直接跑 `route-lint.mjs`**（零成本不联网，一次覆盖 meta 约定 + 路由 hook 悬空 +
   用量契约的配置可用性），不要靠肉眼；退出码 1 = 有问题。
2. 托管 Node 执行 `node --check`。
3. 执行宿主同步语法扫描，去除注释和字符串后不得出现真实 `async`、`await`、`import` token。
4. （离线层）纯函数合同测试覆盖：每个入口、字段映射、边界值、非法值、未知字段不泄漏、task ID、查询请求、成功/失败/处理中、结果字段优先级、artifact 回源和 renderer 形状。
4b. **逐路由断言 hook 可解析（必做，成本几乎为零）**：遍历 `meta.routes`，
   每条 `submit`/`dynamic` 路由的 `decode` 与 `render`、每条 `query` 路由的 `render`，
   都必须在 `native` 里是函数。宿主约定「decode/render 只引用 native 中可调用的成员」，
   悬空引用等于那条路由是死的。**这条抓到过已发布版本的真 bug**：kling 1.0.1 声明了 6 条
   `/kling/v1/videos/*` 路由，decode 指向从未导出的 `legacyTextVideo`/`legacyImageVideo`/`legacyOmniVideo`，
   从 1.0.0 到 1.0.1 一直没人发现（1.0.2 删除）。
   顺手再断言两条结构约定：**query 路由不得配 `decode`**、**route 形状去重后数量不变**。
4c. **测试脚本要自动取最新版本目录**，不要把 `<semver>` 硬编码进 import 路径与版本断言。
   硬编码的后果是「新 patch 已发布、测试仍指向旧版本」的假绿；用
   `readdirSync` 取 `plugins/tasks/<key>/` 下最大 semver 再断言 `meta.version === 该目录名`，
   既免维护又保留了「meta.version 必须与目录一致」的检查。
4d. **多入口插件：同一模型在两个入口下必须产出一致的用量维度，且 `meta.models` 列的模型都真的可达。**
   跨协议入口的 decoder 会替缺失字段补默认值、原生入口不会，所以「按 payload 有没有值判断维度」的写法
   会让同一个任务在两个入口记出不同维度。零额度验证方式：对同一模型分别跑 `--entry native` 与
   `--entry openai` 的 `--dry-run`，对比打印出的 `usage(submit)`；再对 `meta.models` 里的每个模型确认
   请求真的打到了对应上游端点（看 dry-run 打印的 URL），不要出现「列了但只有某个入口能路由」的假声明。
   **这条抓到过 aivideomaker 1.0.1 的真缺陷**：火山入口给 `t2v` 记 `unspecified`，
   openai 入口却把补出来的默认 `720p` 当成真实维度记下。
5. 对上游 JSON 字段名为 `async` 的请求，测试最终 body 确实包含 `{ "async": true }`，同时源码扫描不命中 `async:`。
6. （真实层，不可跳过）向用户索取 Base URL + 真实凭据，用 `live-harness.mjs` 先 `--dry-run` 再跑通一条真实任务到终态；详见上一节。离线全绿不等于上线可用——这两层都要有。
7. **跑闸门并落报告**：`node .workbuddy-ai/tools/test-runner.mjs --key <key> --include-live`，
   确认新报告的「阻塞项」为空、回归为 0、闸门 `PASS`。报告自动写入 `.workbuddy-ai/test-reports/`，
   不要手写报告，也不要编辑已生成的报告。
8. 失败后修复根因，不使用 `--no-verify` 或跳过检查。

## 调试决策树

- 报 `unsupported plugin syntax "async"`：先搜真实 token `async:`、`async function`、async 方法、`await`、`import`；上游字段名用 `body["async"] = true` 构造，不能删除业务字段。
- 报插件无法编译：检查路由 hook 名称、query 的 `:task_id` 占位符、manifest 字段和 ES module 命名导出。
- 提交成功但轮询失败：检查 `parseSubmitResponse` 是否保存上游 task ID 和完整 `taskData`，查询是否使用上游 ID。
- 任务永远进行中：先检查 envelope 错误、失败信号和结果 URL，再检查状态枚举，不要盲目默认成功或 UNKNOWN。
- 有 URL 但下载失败：检查 artifact 是否从持久化完整 envelope 提取，回源是否 `credentialless: true`。
- 客户端批量查询 404：确认是否声明了 `type: "dynamic"` 路由；无 `:task_id` 的批量查询端点走不了 `query`。
- 请求在 decode 阶段被自家插件 400：先分辨是「必需语义缺失」还是「可选便利字段被误拒」。
  后者的典型是 `notify_hook`——客户端默认带，硬拒会打断所有请求；能映射就映射，不能映射就忽略。
- 只读不写同文件：多条 Edit 并行提交到同一个文件会互相覆盖（后写的用旧快照整文件写回），
  必须串行；改完用 `import()` 打印关键字段复核，别只信工具返回的成功提示。
- 判断「宿主是否支持某个端点」时，优先去 `QuantumNous/new-api-plugins` 找同类官方插件源码对照
  （如 sunoapi），比翻 `docs/plugin-api/v1.md` 更快更准；文档只写规则，插件写用法。
- **离线测试全绿但线上不可用**：几乎一定是没做真实联调。mock 只能证明「函数对」，证明不了「上游认」。
  回到「真实端到端联调（强制）」索要凭据，先 `--dry-run` 看拼装，再打真实上游。
- **改完一处、不确定有没有踩坏别处**：跑 `test-runner.mjs`，看报告的「与历史报告比对」一节。
  回归数不为 0 就是踩坏了，别只看「我改的那条现在过了」。跨版本比对是故意设计的——
  1.0.2 的修复不能让 1.0.1 验过的用例失败。
- **报告里出现「消失用例」**：基线有、本次没有，通常是测试脚本被改写。人工确认不是漏测后再继续，
  运行器不会把它判成失败，但它是「测试覆盖被悄悄削弱」的信号。

## channelTypes 登记表

| channelType | plugin key | 说明 |
| --- | --- | --- |
| 10007 | acedata-suno | New API Suno 到 AceDataCloud Suno 的异构桥；提交 `/suno/audios`/`/suno/lyrics`，查询 `/suno/tasks` |
| 10008 | kling | 腾讯云 TokenHub 可灵六模型统一插件；提交 `/kling/text-to-video`、`/kling/image-to-video`、`/kling/omni-video`，查询 `/kling/tasks/:task_id` |
| 10009 | aivideomaker | aivideomaker.ai MiniMax H3；`ak_` 官方 API 提交 `/api/v1/generate/minimax`、查询 `/api/v1/tasks/:id`；网页会话（cookie+userId JSON 密钥）提交 `/api/ai.minimaxH3`、查询 `/api/model.listModel` |
| 10010 | senseaudio-video | SenseAudio `/v1/video/create` + `/v1/video/status` 转成火山方舟 Seedance 原生格式；入站 `/senseaudio/api/v3/contents/generations/tasks`，唯一模型 `doubao-seedance-2-0-260128` |

## 把厂商接口「转成某家原生格式」

需求形如「把 A 厂商的接口转成 B 家的原生格式」时，**B 家是入站契约（客户端侧），A 厂商是上游**。
判定依据是「转成」的目标格式描述的是客户端可见的接口面，而插件只能适配自己拿得到凭据的那一侧。

做法（以 senseaudio-video 为例）：

- 入站 route path 照抄 B 家原生路径，前缀换成插件 key：官方 `doubao` 用
  `/doubao/api/v3/contents/generations/tasks`，照此写 `/senseaudio/api/v3/contents/generations/tasks`。
- **先把 B 家官方插件源码当契约读**：`QuantumNous/new-api-plugins/plugins/tasks/<vendor>/<semver>/plugin.js`
  （火山 Seedance 原生格式的权威定义就在 `doubao` 里，含 `content[].type` 取值、`role` 语义、
  查询响应 `content.video_url`、状态枚举）。比翻文档快，也比文档准。
- render hook 要吐 B 家形状（`{id}` / `{id,status:queued|running|succeeded|failed,content:{video_url}}`），
  不是上游原样。上游 `task.data` 是 A 家的 body，必须**重建**而不是 `Object.assign` 透传。
- 逐项列两端差异表（字段名、层级、枚举、缺省语义），差异项就是 encoder 的职责。
- **缺省语义相反时要显式补值**：火山 `watermark` 缺省「不加」、SenseAudio 缺省「加」，
  客户端不写时必须补 `false`，否则客户端可观察行为被上游缺省悄悄改掉。
- **拿不到的信息就报错，不要猜**：火山 `ratio` 缺省 `adaptive`，而上游要求显式枚举且插件无法
  从首帧图推断画幅——静默选一个比例会产出错误画幅，必须显式 400 并列出可选值。

## 腾讯 TokenHub（/v1/wand/\*）系列约定

- 上游域名 `https://tokenhub.tencentmaas.com`，路径前缀 `/v1/wand/<vendor>/`，Bearer 鉴权。
- 视频生成统一两步：提交返回 `data.id`，轮询 `GET /v1/wand/<vendor>/tasks/{task_id}`；
  查询响应 `data` 是**数组**，元素结构 `{ id, status, message, outputs[{type,id,url,duration}], create_time, update_time }`，
  顶层另有 `tokenhub_usage.total_tokens` 可用于 `extractUsageOnComplete` 回填真实用量。
- 视频生成状态只有 `processing` / `succeeded` / `failed`（元素与音色任务用的是 `task_status`，成功值是 `succeed` 不是 `succeeded`）。
- **提交端点不带模型后缀**。可灵只有 `/kling/text-to-video`、`/kling/image-to-video`、`/kling/omni-video`
  三个提交路径，模型一律靠 body 的 `model` 字段区分。腾讯云文档已两次独立抓取确认。
  插件 route 层可以另外提供带后缀的兼容入口（见「route path 与上游 URL 是两套东西」），但发往上游的 URL 必须无后缀。
- 腾讯云文档页是 SPA + 压缩响应，`WebFetch` 会截断长文档；用
  `curl -sL --compressed <url>` 取 HTML 后去标签转文本，才能拿到「查询任务结果」这类靠后的章节。
