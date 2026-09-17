#!/usr/bin/env node
// 全仓库结构体检（零成本、不联网、不需要凭据）
//
//   node .workbuddy-ai/skills/new-api-task-plugin-builder/assets/route-lint.mjs
//
// 为什么需要它：单个插件的合同测试只能检查自己，检查不了**跨插件的全局属性**
// （channelTypes 是否全局唯一）。另外它能一次性把「路由声明的 hook 悬空」这类
// 结构性问题在全仓库范围内扫出来 —— 这类 bug 不报错、不崩溃，只是那条路由永远用不了，
// 靠跑测试很容易漏（kling 1.0.1 的 6 条死路由就是这样活了两个版本）。
//
// 检查项：
//   1. meta.version 必须等于所在目录名
//   2. meta.author.name 必须是 Jushenzhidao
//   3. channelTypes 必须全局唯一，且 >= 10000（不复用上游小数值）
//   4. 每条 submit/dynamic 路由的 decode 与 render、每条 query 路由的 render，
//      都必须在 native 里是可调用成员（宿主约定：只引用 native 成员）
//   5. query 路由不得配 decode
//   6. route 形状（method + 归一化 path）去重后数量不变，且 GET query 路由形状不重复
//   7. usageExamples[*].facts 的键集合必须等于 usageSchema 的键集合（宿主会硬校验并拒绝加载）
//   8. usageSchema 里带 enum 的维度，**每个枚举值都必须至少被一条 usageExample 覆盖**。
//      宿主只校验键集合、不校验枚举覆盖，所以漏了不报错；但用户在倍率表里只会看到示例里出现过的值，
//      没出现的那个值对应的模型永远匹配不到任何行（aivideomaker 的 "unspecified" 就是这样漏的）。
//   9. meta.models 不得为空
//
// 退出码：0 = 全绿，1 = 有结构性问题。

import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..", "plugins/tasks");

function cmpSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

// route 形状：把 :placeholder 归一成 :param，用于判定冲突
function routeShape(route) {
  return route.method + " " + String(route.path).replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":param");
}

const problems = [];
const channelOwners = new Map();
const rows = [];

for (const key of readdirSync(ROOT).sort()) {
  const dir = resolve(ROOT, key);
  const versions = readdirSync(dir)
    .filter(function (name) {
      return /^\d+\.\d+\.\d+$/.test(name);
    })
    .sort(cmpSemver);
  if (!versions.length) continue;
  const version = versions[versions.length - 1];
  const file = resolve(dir, version, "plugin.js");
  if (!existsSync(file)) continue;

  const plugin = await import(file);
  const meta = plugin.meta || {};
  const native = plugin.native || {};
  const routes = meta.routes || [];
  const issues = [];

  if (meta.version !== version) issues.push("meta.version=" + meta.version + " 与目录 " + version + " 不一致");
  if (!meta.author || meta.author.name !== "Jushenzhidao") issues.push("author 不是 Jushenzhidao");

  for (const channel of meta.channelTypes || []) {
    if (channel < 10000) issues.push("channelType " + channel + " < 10000（不得复用上游小数值）");
    if (channelOwners.has(channel)) {
      issues.push("channelType " + channel + " 已被 " + channelOwners.get(channel) + " 占用");
    } else {
      channelOwners.set(channel, key);
    }
  }

  const declaredDecodes = [...new Set(routes.filter((r) => r.decode).map((r) => r.decode))];
  const danglingDecodes = declaredDecodes.filter((name) => typeof native[name] !== "function");
  if (danglingDecodes.length) issues.push("decode 悬空: " + danglingDecodes.join(", "));

  const declaredRenders = [...new Set(routes.filter((r) => r.render).map((r) => r.render))];
  const danglingRenders = declaredRenders.filter((name) => typeof native[name] !== "function");
  if (danglingRenders.length) issues.push("render 悬空: " + danglingRenders.join(", "));

  const queryWithDecode = routes.filter((r) => r.type === "query" && r.decode);
  if (queryWithDecode.length) issues.push("query 路由不该配 decode（" + queryWithDecode.length + " 条）");

  const submitWithoutDecode = routes.filter((r) => (r.type === "submit" || r.type === "dynamic") && !r.decode);
  if (submitWithoutDecode.length) issues.push("submit/dynamic 路由缺 decode（" + submitWithoutDecode.length + " 条）");

  const queryMissingParam = routes.filter(
    (r) => r.type === "query" && (!r.taskIdParam || String(r.path).indexOf(":" + r.taskIdParam) < 0),
  );
  if (queryMissingParam.length) issues.push("query 路由的 taskIdParam 未出现在 path 中（" + queryMissingParam.length + " 条）");

  const shapes = routes.map(routeShape);
  if (new Set(shapes).size !== shapes.length) issues.push("route 形状重复（去重后数量变化）");

  // 用量契约的配置可用性。宿主只硬校验「示例键集合覆盖 schema 键集合」，
  // 枚举覆盖与否它不管，漏了不报错但会让用户配不出正确的倍率表，所以在这里守。
  const schema = meta.usageSchema || {};
  const examples = meta.usageExamples || [];
  const schemaKeys = Object.keys(schema).sort().join(",");

  if (Object.keys(schema).length && !examples.length) issues.push("有 usageSchema 但没有 usageExamples");

  examples.forEach(function (example, index) {
    const factsKeys = Object.keys((example && example.facts) || {}).sort().join(",");
    if (factsKeys !== schemaKeys) {
      issues.push(
        "usageExamples[" + index + "] 键集合 [" + factsKeys + "] != usageSchema 键集合 [" + schemaKeys + "]（宿主会拒绝加载）",
      );
    }
  });

  for (const dim of Object.keys(schema)) {
    const spec = schema[dim] || {};
    if (!Array.isArray(spec.enum) || !spec.enum.length) continue;
    const covered = new Set(
      examples
        .map(function (example) {
          return example && example.facts ? example.facts[dim] : undefined;
        })
        .filter(function (value) {
          return value !== undefined;
        }),
    );
    const missed = spec.enum.filter(function (value) {
      return !covered.has(value);
    });
    if (missed.length) {
      issues.push(
        "usageSchema." + dim + " 的枚举值没有任何示例覆盖: " + JSON.stringify(missed) + "（用户在倍率表里看不到这些值）",
      );
    }
  }

  if (!Array.isArray(meta.models) || !meta.models.length) issues.push("meta.models 为空");

  if (issues.length) problems.push(key + "@" + version);
  rows.push({
    key: key,
    version: version,
    routes: routes.length,
    channels: JSON.stringify(meta.channelTypes || []),
    issues: issues,
  });
}

for (const row of rows) {
  const mark = row.issues.length ? "✗" : "✓";
  const tail = row.issues.length ? row.issues.join(" | ") : "OK";
  console.log(mark + " " + row.key + "@" + row.version + "  routes=" + row.routes + "  channelTypes=" + row.channels + "  " + tail);
}

console.log("\n插件数 = " + rows.length + "，有问题的 = " + problems.length);
if (problems.length) {
  console.log("需要修复：" + problems.join(", "));
  process.exit(1);
}
