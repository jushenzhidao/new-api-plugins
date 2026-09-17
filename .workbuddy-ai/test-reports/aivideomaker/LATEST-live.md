<!-- 自动生成：live 层最新报告副本，原文 aivideomaker/20260917-014605-aivideomaker-1.0.1-live.md -->

# 测试报告 · aivideomaker 1.0.1 · live

> **插件闸门结论：PASS** — 本层（live）通过 7 / 失败 0 / 告警 0 / 用例 7；回归 0 条
>
> 本层自身结论：**PASS**。闸门结论由该插件本次运行的全部层级合并判定：`live`、`spec`、`contract`。

## 元信息

| 字段 | 值 |
| --- | --- |
| 报告 ID | `20260917-014605-aivideomaker-1.0.1-live` |
| 时间 | 2026-09-17 01:46:05 +0800 |
| 插件 | `aivideomaker@1.0.1` |
| 层级 | `live` — 真实上游联调（消耗额度） |
| 断言粒度 | 用例级（可精确定位回归用例） |
| 测试脚本 | `.workbuddy-ai/tmp-tests/aivideomaker.live.mjs` |
| 脚本 sha256 | `618ff019dafa91b9…` |
| 被测源码 | `plugins/tasks/aivideomaker/1.0.1/plugin.js` |
| 源码 sha256 | `e332e4341927670e…` |
| 命令 | `node .workbuddy-ai/tmp-tests/aivideomaker.live.mjs` |
| 退出码 | 0 |
| 耗时 | 190116 ms |

## 与历史报告比对

- 基线报告：`20260917-014046-aivideomaker-1.0.1-live`（1.0.1 · PASS · 2026-09-17 01:40:46 +0800）
- 回归：**0** ｜ 已修复：0 ｜ 仍失败：0 ｜ 新增用例：0 ｜ 未变：7 ｜ 消失用例：0

### 该插件该层历史（倒排，最新在上）

| 报告 ID | 时间 | 版本 | 结论 | 通过/失败 | 回归 |
| --- | --- | --- | --- | --- | --- |
| `20260917-014046-aivideomaker-1.0.1-live` | 2026-09-17 01:40:46 +0800 | 1.0.1 | PASS | 7/0 | 0 |
| `20260917-013735-aivideomaker-1.0.1-live` | 2026-09-17 01:37:35 +0800 | 1.0.1 | PASS | 7/0 | 0 |
| `20260917-013013-aivideomaker-1.0.1-live` | 2026-09-17 01:30:13 +0800 | 1.0.1 | PASS | 7/0 | 0 |
| `20260917-012329-aivideomaker-1.0.1-live` | 2026-09-17 01:23:29 +0800 | 1.0.1 | PASS | 7/0 | 0 |

## 层覆盖

- 本次已跑层级：`live`、`spec`、`contract`
- 该插件历史已验证层级：`live`、`spec`、`contract`、`e2e`
- 闸门要求：`contract`、`real`

## 用例明细

### (未分组)（1 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | native decode 成功（native.createTask） |

### 真实端到端（6 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | 提交拿到上游 task id |
| ✓ | 轮询走到终态 SUCCESS |
| ✓ | 终态给出可访问的结果 URL |
| ✓ | listArtifacts 返回制品（1 个） |
| ✓ | 回源请求 credentialless（不携带渠道鉴权） |
| ✓ | 回源下载落盘 |

## 原始输出（尾部）

```text
poll #11 http=200 -> IN_PROGRESS 50%
poll #12 http=200 -> IN_PROGRESS 50%
poll #13 http=200 -> SUCCESS 100%
  ✓ 轮询走到终态 SUCCESS

result url=https://static.img2video.ai/1789580947885-de6fd8bd-6338-43b6-9ce4-0339a51754ed-1639216_0_minimax_h3_1639216.mp4
usage(onComplete)={"duration":5}
artifacts=[{"key":"video","type":"video","mimeType":"video/mp4"}]
artifactKey=video
  ✓ 终态给出可访问的结果 URL
  ✓ listArtifacts 返回制品（1 个）
content request url=https://static.img2video.ai/1789580947885-de6fd8bd-6338-43b6-9ce4-0339a51754ed-1639216_0_minimax_h3_1639216.mp4 credentialless=true
  ✓ 回源请求 credentialless（不携带渠道鉴权）
downloaded -> /tmp/avm-final.mp4 (200, 792165 bytes, video/mp4)
  ✓ 回源下载落盘
renderFinal={"output":[{"type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"<video controls src=\"https://static.img2video.ai/1789580947885-de6fd8bd-6338-43b6-9ce4-0339a51754ed-1639216_0_minimax_h3_1639216.mp4\"></video>","annotations":[],"logprobs":[]}]}],"metadata":{"vendor":"aivideomaker"}}

端到端通过：提交→轮询→终态→制品→回源 全链路 OK

===NEWAPI-TEST-RESULT-BEGIN===
{"schema":1,"key":"aivideomaker","version":"1.0.1","layer":"live","passed":7,"failed":0,"warned":0,"total":7,"cases":[{"id":"native decode 成功（native.createTask）","label":"native decode 成功（native.createTask）","outcome":"pass","section":"(未分组)"},{"id":"提交拿到上游 task id","label":"提交拿到上游 task id","outcome":"pass","section":"真实端到端"},{"id":"轮询走到终态 SUCCESS","label":"轮询走到终态 SUCCESS","outcome":"pass","section":"真实端到端"},{"id":"终态给出可访问的结果 URL","label":"终态给出可访问的结果 URL","outcome":"pass","section":"真实端到端"},{"id":"listArtifacts 返回制品（1 个）","label":"listArtifacts 返回制品（1 个）","outcome":"pass","section":"真实端到端"},{"id":"回源请求 credentialless（不携带渠道鉴权）","label":"回源请求 credentialless（不携带渠道鉴权）","outcome":"pass","section":"真实端到端"},{"id":"回源下载落盘","label":"回源下载落盘","outcome":"pass","section":"真实端到端"}]}
===NEWAPI-TEST-RESULT-END===

passed=7 failed=0 warned=0
```

## stderr（尾部）

```text
(node:7821) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/betterme/PycharmProjects/AI/new-api-plugins/plugins/tasks/aivideomaker/1.0.1/plugin.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/betterme/PycharmProjects/AI/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
```

