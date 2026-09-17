<!-- 自动生成：e2e 层最新报告副本，原文 aivideomaker/20260917-013013-aivideomaker-1.0.1-e2e.md -->

# 测试报告 · aivideomaker 1.0.1 · e2e

> **插件闸门结论：PASS** — 本层（e2e）通过 76 / 失败 0 / 告警 0 / 用例 76；回归 0 条
>
> 本层自身结论：**PASS**。闸门结论由该插件本次运行的全部层级合并判定：`e2e`、`live`、`spec`、`contract`。

## 元信息

| 字段 | 值 |
| --- | --- |
| 报告 ID | `20260917-013013-aivideomaker-1.0.1-e2e` |
| 时间 | 2026-09-17 01:30:13 +0800 |
| 插件 | `aivideomaker@1.0.1`（版本为推断值，脚本未写死目标版本） |
| 层级 | `e2e` — 真实端到端（消耗额度） |
| 断言粒度 | 仅聚合（脚本不输出用例名，回归只能靠总数变化判断） |
| 测试脚本 | `.workbuddy-ai/tmp-tests/aivideomaker.e2e.mjs` |
| 脚本 sha256 | `e78da89c51db9319…` |
| 被测源码 | `plugins/tasks/aivideomaker/1.0.1/plugin.js` |
| 源码 sha256 | `d74bffbd77021697…` |
| 命令 | `node .workbuddy-ai/tmp-tests/aivideomaker.e2e.mjs` |
| 退出码 | 0 |
| 耗时 | 139 ms |

## 与历史报告比对

- 基线报告：`20260917-012329-aivideomaker-1.0.1-e2e`（1.0.1 · PASS · 2026-09-17 01:23:29 +0800）
- 回归：**0** ｜ 已修复：0 ｜ 仍失败：0 ｜ 新增用例：0 ｜ 未变：76 ｜ 消失用例：0

### 该插件该层历史（倒排，最新在上）

| 报告 ID | 时间 | 版本 | 结论 | 通过/失败 | 回归 |
| --- | --- | --- | --- | --- | --- |
| `20260917-012329-aivideomaker-1.0.1-e2e` | 2026-09-17 01:23:29 +0800 | 1.0.1 | PASS | 76/0 | 0 |

## 层覆盖

- 本次已跑层级：`e2e`、`live`、`spec`、`contract`
- 该插件历史已验证层级：`e2e`、`live`、`spec`、`contract`
- 闸门要求：`contract`、`real`

## 用例明细

该脚本只输出聚合数字（`passed=n failed=m`），无逐条用例可列。

聚合：通过 76 ｜ 失败 0 ｜ 合计 76

> 迁移到 `.workbuddy-ai/skills/new-api-task-plugin-builder/assets/testkit.mjs` 可拿到用例级输出与精确回归定位。
## 原始输出（尾部）

```text

passed=76 failed=0
```

## stderr（尾部）

```text
(node:3360) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/betterme/PycharmProjects/AI/new-api-plugins/plugins/tasks/aivideomaker/1.0.1/plugin.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/betterme/PycharmProjects/AI/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
```

