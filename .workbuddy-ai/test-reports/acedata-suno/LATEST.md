# acedata-suno 最新测试报告

> 自动生成，勿手改。各层最新：
- contract：`20260916-233135-acedata-suno-1.0.11-contract`（INCOMPLETE，2026-09-16 23:31:35 +0800）→ `LATEST-contract.md`

---

# 测试报告 · acedata-suno 1.0.11 · contract

> **插件闸门结论：INCOMPLETE（不算完成）** — 本层（contract）通过 204 / 失败 0 / 告警 0 / 用例 204；回归 0 条
>
> 本层自身结论：**PASS**。闸门结论由该插件本次运行的全部层级合并判定：`contract`。

## 元信息

| 字段 | 值 |
| --- | --- |
| 报告 ID | `20260916-233135-acedata-suno-1.0.11-contract` |
| 时间 | 2026-09-16 23:31:35 +0800 |
| 插件 | `acedata-suno@1.0.11` |
| 层级 | `contract` — 离线纯函数合同测试，不联网 |
| 断言粒度 | 用例级（可精确定位回归用例） |
| 测试脚本 | `.workbuddy-ai/tmp-tests/acedata-suno.test.mjs` |
| 脚本 sha256 | `844c1d005b02eed8…` |
| 被测源码 | `plugins/tasks/acedata-suno/1.0.11/plugin.js` |
| 源码 sha256 | `9d5bc8946ae12dbe…` |
| 命令 | `node .workbuddy-ai/tmp-tests/acedata-suno.test.mjs` |
| 退出码 | 0 |
| 耗时 | 69 ms |

## 与历史报告比对

- 基线报告：`20260916-233101-acedata-suno-1.0.11-contract`（1.0.11 · INCOMPLETE · 2026-09-16 23:31:01 +0800）
- 回归：**0** ｜ 已修复：0 ｜ 仍失败：0 ｜ 新增用例：0 ｜ 未变：204 ｜ 消失用例：0

### 该插件该层历史（倒排，最新在上）

| 报告 ID | 时间 | 版本 | 结论 | 通过/失败 | 回归 |
| --- | --- | --- | --- | --- | --- |
| `20260916-233101-acedata-suno-1.0.11-contract` | 2026-09-16 23:31:01 +0800 | 1.0.11 | INCOMPLETE | 204/0 | 0 |
| `20260916-233003-acedata-suno-1.0.11-contract` | 2026-09-16 23:30:03 +0800 | 1.0.11 | INCOMPLETE | 204/0 | 0 |

## 层覆盖

- 本次已跑层级：`contract`
- 该插件历史已验证层级：`contract`
- 闸门要求：`contract`、`real`

## 未验证（导致结论不是 PASS）

- 真实端到端层未覆盖：该插件还没有真实层脚本（按 skill 的 live-harness 新建 <key>.live.mjs） → 离线全绿只证明「函数对」，证明不了「上游认」

## 用例明细

### (未分组)（204 项）

| 结果 | 用例 |
| --- | --- |
| ✓ | meta.author |
| ✓ | meta.channelType 10007 |
| ✓ | meta.version matches dir |
| ✓ | meta.fetchMode batch |
| ✓ | usageSchema clips unit |
| ✓ | route: POST /suno/submit/:action (submit) |
| ✓ | route: POST /suno/fetch (dynamic batch query) |
| ✓ | route: GET /suno/fetch/:task_id (query) |
| ✓ | submit route decode hook |
| ✓ | dynamic route has decode |
| ✓ | dynamic route has render |
| ✓ | query route prohibits decode |
| ✓ | native Suno routes do not require top-level model |
| ✓ | query route has :task_id |
| ✓ | :action music -> generate |
| ✓ | :action case-insensitive |
| ✓ | :action lyrics |
| ✓ | :action concat |
| ✓ | unknown action rejected |
| ✓ | music action still validates body |
| ✓ | batch decode normalizes ids |
| ✓ | batch decode accepts MUSIC action |
| ✓ | batch decode accepts lowercase action |
| ✓ | batch requires ids array |
| ✓ | batch rejects empty ids |
| ✓ | batch rejects string ids |
| ✓ | batch rejects bad action |
| ✓ | batch requires json body |
| ✓ | custom kind |
| ✓ | custom model |
| ✓ | custom action |
| ✓ | custom adapterMode |
| ✓ | custom normalized |
| ✓ | inspiration normalized |
| ✓ | prompt+gpt mutually exclusive |
| ✓ | instrumental true |
| ✓ | instrumental custom mode |
| ✓ | extend action |
| ✓ | extend normalized |
| ✓ | extend continue_at optional |
| ✓ | extend negative continue_at |
| ✓ | bad mv rejected |
| ✓ | notify_hook accepted (music) |
| ✓ | notify_hook trimmed |
| ✓ | lyrics notify_hook not forwarded |
| ✓ | bad notify_hook rejected (music) |
| ✓ | bad notify_hook rejected (lyrics) |
| ✓ | empty music rejected |
| ✓ | empty lyrics rejected |
| ✓ | non-json rejected |
| ✓ | lyrics model |
| ✓ | lyrics normalized |
| ✓ | concat model |
| ✓ | concat action |
| ✓ | concat normalized |
| ✓ | concat requires clip_id |
| ✓ | is_infill rejected |
| ✓ | notify_hook accepted (concat) |
| ✓ | bad notify_hook rejected (concat) |
| ✓ | music submit url |
| ✓ | music submit method |
| ✓ | bearer auth |
| ✓ | custom encoded body |
| ✓ | notify_hook encoded as callback_url |
| ✓ | lyrics body has no callback_url |
| ✓ | concat encoded with callback_url |
| ✓ | real request custom mode |
| ✓ | real request model |
| ✓ | real request prompt mapped to lyric |
| ✓ | real custom request does not send prompt |
| ✓ | inspiration encoded body |
| ✓ | extend encoded body |
| ✓ | lyrics submit url |
| ✓ | lyrics encoded body |
| ✓ | concat submit url |
| ✓ | concat encoded body |
| ✓ | unknown client field not leaked |
| ✓ | baseUrl override |
| ✓ | isomorphic rejected |
| ✓ | submit taskId |
| ✓ | submit error surfaced |
| ✓ | submit missing task_id |
| ✓ | query url |
| ✓ | query method |
| ✓ | query body retrieve |
| ✓ | queued |
| ✓ | in progress |
| ✓ | success music |
| ✓ | success lyrics |
| ✓ | failure envelope |
| ✓ | item failure beats result url |
| ✓ | item failure reason |
| ✓ | not_completed not fuzzy-matched |
| ✓ | streaming keeps polling |
| ✓ | invalid url not success |
| ✓ | 500 throws |
| ✓ | 429 throws |
| ✓ | 401 throws (query error, not task failure) |
| ✓ | string body parsed |
| ✓ | flat top-level success shape |
| ✓ | flat top-level success=false |
| ✓ | flat terminal items without success flag |
| ✓ | streaming not promoted by fallback |
| ✓ | flat error envelope throws |
| ✓ | flat artifacts: duplicate audio_url deduped, empty video_url skipped |
| ✓ | flat render action MUSIC |
| ✓ | flat render 2 songs |
| ✓ | flat major_model_version derived |
| ✓ | flat style -> metadata tags |
| ✓ | flat image_large_url fallback |
| ✓ | billing_ratios null |
| ✓ | usage generate |
| ✓ | usage extend |
| ✓ | usage lyrics |
| ✓ | usage concat |
| ✓ | artifact list stable keys + dedupe (shared image deduped) |
| ✓ | listArtifacts leaks no URL |
| ✓ | no artifacts before success |
| ✓ | non-http url ignored |
| ✓ | content request credentialless |
| ✓ | HEAD passthrough |
| ✓ | unknown artifact key |
| ✓ | submit-shaped envelope artifact |
| ✓ | real task lists 2 audio image video groups |
| ✓ | content context uses ctx.data snapshot |
| ✓ | submitted render |
| ✓ | fetch code |
| ✓ | fetch action MUSIC |
| ✓ | fetch status mapped |
| ✓ | fetch uses public task id |
| ✓ | submit_time seconds |
| ✓ | finish_time seconds |
| ✓ | song array rendered |
| ✓ | song metadata tags |
| ✓ | major_model_version derived |
| ✓ | image_large_url fallback |
| ✓ | fetch action LYRICS |
| ✓ | lyrics data is object |
| ✓ | lyrics text |
| ✓ | pending status |
| ✓ | pending no data |
| ✓ | pending finish_time 0 |
| ✓ | queued rendered as IN_PROGRESS (doc enum has no SUBMITTED) |
| ✓ | failure mapped to FAIL |
| ✓ | fail_reason rendered |
| ✓ | batch code |
| ✓ | batch data is array |
| ✓ | batch renders every task |
| ✓ | batch first task id |
| ✓ | batch first action MUSIC |
| ✓ | batch second action LYRICS |
| ✓ | batch item shape equals single query |
| ✓ | empty batch renders empty array |
| ✓ | extras normalized |
| ✓ | extras encoded negative_tags |
| ✓ | extras encoded vocal_gender |
| ✓ | extras encoded variation_category |
| ✓ | extras encoded weirdness |
| ✓ | extras encoded style_influence |
| ✓ | extras encoded duration |
| ✓ | extras encoded persona_id |
| ✓ | vocal_gender needs v4-5+ |
| ✓ | vocal_gender ok on v4-5 |
| ✓ | variation_category needs v5+ |
| ✓ | vocal_gender rejected on default model |
| ✓ | bad vocal_gender |
| ✓ | weirdness range |
| ✓ | style_influence range |
| ✓ | duration range low |
| ✓ | duration integer |
| ✓ | negative_tags custom only |
| ✓ | weirdness custom only |
| ✓ | duration custom only |
| ✓ | lyric_prompt accepted without prompt |
| ✓ | lyric_prompt encoded |
| ✓ | lyric_prompt conflicts with prompt |
| ✓ | lyric_prompt custom only |
| ✓ | lyric limit v4 |
| ✓ | lyric 3001 ok on v4-5 |
| ✓ | lyric limit v5-5 |
| ✓ | style limit v4 |
| ✓ | title limit v4 |
| ✓ | gpt prompt limit 500 |
| ✓ | extend extras |
| ✓ | extend without continue_at encoded (optional) |
| ✓ | batch query url |
| ✓ | batch query method |
| ✓ | batch query body drops empty ids |
| ✓ | batch returns one result per item |
| ✓ | batch taskIds from items[].id |
| ✓ | batch statuses |
| ✓ | batch action: request.action or lyrics |
| ✓ | batch progress |
| ✓ | batch submit_time seconds |
| ✓ | batch finish_time seconds |
| ✓ | batch persists whole envelope |
| ✓ | batch order independent (1) |
| ✓ | batch order independent (2) |
| ✓ | batch artifacts from persisted item |
| ✓ | batch render MUSIC |
| ✓ | batch error envelope throws |
| ✓ | batch 429 throws |
| ✓ | batch skips item without id |
| ✓ | batch falls back to single envelope |

## 原始输出（尾部）

```text
  ✓ title limit v4
  ✓ gpt prompt limit 500
  ✓ extend extras
  ✓ extend without continue_at encoded (optional)
  ✓ batch query url
  ✓ batch query method
  ✓ batch query body drops empty ids
  ✓ batch returns one result per item
  ✓ batch taskIds from items[].id
  ✓ batch statuses
  ✓ batch action: request.action or lyrics
  ✓ batch progress
  ✓ batch submit_time seconds
  ✓ batch finish_time seconds
  ✓ batch persists whole envelope
  ✓ batch order independent (1)
  ✓ batch order independent (2)
  ✓ batch artifacts from persisted item
  ✓ batch render MUSIC
  ✓ batch error envelope throws
  ✓ batch 429 throws
  ✓ batch skips item without id
  ✓ batch falls back to single envelope
ALL PASS: 204 assertions
```

## stderr（尾部）

```text
(node:64870) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/betterme/PycharmProjects/AI/new-api-plugins/plugins/tasks/acedata-suno/1.0.11/plugin.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/betterme/PycharmProjects/AI/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
```

