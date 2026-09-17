# new-api-plugins 项目长期约定

自建仓库，上游参考源 `QuantumNous/new-api-plugins`（移植须改写身份类字段，不得照抄）。
**细则以 `.workbuddy-ai/skills/new-api-task-plugin-builder/SKILL.md` 为准；插件实测事实以各
`plugins/tasks/<key>/README.md` 为准。** 本文件只留跨插件硬约束与索引。

## 硬约定
- 目录 `plugins/tasks/<key>/<semver>/plugin.js`。
- `author` 固定 `{ name: "Jushenzhidao" }`。
- `channelTypes` 全局唯一整数、从 `10000` 起递增，不得照抄上游小数值（如 `35`）；已上线插件不要改
  （等于要求用户重绑渠道）。分配后登记到 SKILL.md 末尾的 channelTypes 登记表。
- `version` 从 `1.0.0` 起、patch 位递增；`meta.version` 必须等于目录名；已发布版本目录不可变，改动新建下一 patch。
- 仓库**不设 `.gitignore`**，全部文件（含 `test-reports/`、`tmp-tests/`）入库——用户明确选择保留全部历史，
  测试报告本身即「真实层已验证」的证据。提交前做凭据扫描。

## 验证（离线 + 真实两层，缺一不可）
- 离线合同测试只证明「函数对」，证明不了「上游认」。新建插件 / 每个新 patch / 改请求构建·状态映射·制品提取
  任一 hook 后，**必须用真实 Base URL + 凭据跑通一条真实任务**。凭据开工时就索要，只从环境变量读，
  不入源码/测试/skill/记忆。给不出凭据时明确区分「已验证」与「未验证」，不许用 mock 含糊带过。
- 入口只有 `.workbuddy-ai/tools/test-runner.mjs`，报告由它生成到 `test-reports/`，**不许手写**。
  闸门按插件聚合：任一层失败/回归 → `FAIL`(1)；要求层没覆盖齐 → `INCOMPLETE`(2，不算完成)；全齐 → `PASS`(0)。
  默认要求 `contract` + `real`(live|e2e)，真实层要 `--include-live` + `LIVE_KEY`。
- 回归即阻塞（基线通过、本次失败 = `REGRESSION`），**不许删用例/改断言名绕过**。
- 拿到 PASS 后不要跑离线-only 复核，会把 LATEST 指针顶成 `INCOMPLETE`；复核要带 `--include-live` 一起跑。

## 跨插件铁律
- 请求适配：同构/异构按入站 body 与上游契约的字段·层级·类型·枚举·缺省语义判断，不看 `native` 名称；
  适配信息只放 `requestBody: { adapterMode, payload }`；driver hook 只消费 `ctx.requestBody`，不按 path/protocol 分支。
- 状态映射六层阶梯：envelope 错误码 → 文档枚举 → 前缀模糊 → 结果字段兜底成功 → 失败信号 → 默认 `QUEUED`。
  禁止子串匹配，永不返回 `UNKNOWN`。**先看上游原始 status 再改映射**，别把「还在跑」误判成漏枚举去改对的代码。
- 「转成某家原生格式」＝那家是入站契约、另一家是上游；该家官方插件源码是契约权威，比文档准。
- 用量维度判据是「上游模型有没有该字段」，不是「payload 里有没有值」（跨协议 decoder 会补默认值，
  多入口插件收尾必跑「同模型两入口 `usage(submit)` 对比」）；任何进 `enum` 的哨兵值都要在 `usageExamples`
  里可见。加插件/改用量后必跑 `route-lint.mjs`——它是唯一校验枚举值示例覆盖的地方。
- 宿主默认不转发插件日志（仅 `DEBUG=true` 时），生产排障靠宿主 Go 层 HTTP 日志 + 上游 access log。

## 待决策
- `minimax-h3@1.0.8` 违反两条硬约定：`channelTypes=[35]`（< 10000）、author 非 `Jushenzhidao`。**未修**——
  改 channelTypes 等于要求已上线用户重绑渠道，属产品决策；`route-lint.mjs` 会持续报它。

## 工具（均在 `.workbuddy-ai/`）
- `tools/test-runner.mjs`：测试闸门。
- `skills/new-api-task-plugin-builder/`：`SKILL.md` + `assets/`——`route-lint.mjs` 结构体检、
  `media-probe.py` 零依赖验成片（无 ffmpeg）、`live-harness.mjs` 真实联调脚手架（凭据走 `LIVE_KEY`/`LIVE_BASE`）、
  `resume-task.mjs` 续查已有任务（不重复扣费）、`testkit.mjs` 用例套件。
- 合同测试统一放 `tmp-tests/<key>.test.mjs`（ESM 直接 import 插件源码）；一个插件只能有一个 `<key>.test.mjs`
  （运行器按文件名去后缀推导 key），mock 流程测试只能并进去。仓库内无官方编译工具，只做语法 + Hook 合同测试。
