// new-api-plugins 用例级测试工具（可选，但推荐）
//
// 为什么需要它：老脚本只打印 `passed=n failed=m` 聚合数字，test-runner 只能靠
// 「通过数掉了多少」判断回归，定位不到具体用例。用本工具后每个断言都带稳定 id，
// 回归比对能精确到「上一份报告里叫 X 的用例现在失败了」。
//
// 用法（测试脚本放在 .workbuddy-ai/tmp-tests/）：
//
//   import { createSuite } from "../skills/new-api-task-plugin-builder/assets/testkit.mjs";
//   const t = createSuite({ key: "vendor", version: "1.0.0", layer: "contract" });
//
//   t.section("meta 约定");
//   t.ok(meta.version === "1.0.0", "meta.version 与目录一致");
//   t.eq(meta.author, { name: "Jushenzhidao" }, "meta.author");
//   t.throws(() => decode({}), /prompt/, "缺 prompt 必须报错");
//   t.warn("官方枚举比插件窄：480p 实测可出片，有意保留");
//
//   t.done();   // 打印结构化块并设置退出码；不调用则脚本按 0 退出
//
// 兼容性：输出仍是人读的 `✓/✗/⚠ label` 行，test-runner 两种解析都能吃；
// 结构化块只是额外增强，不影响直接 `node x.test.mjs` 手动跑。

const MARK = { pass: "✓", fail: "✗", warn: "⚠" };

export function createSuite({ key = "unknown", version = "unknown", layer = "contract" } = {}) {
  const cases = [];
  let section = "(未分组)";
  let passed = 0;
  let failed = 0;
  let warned = 0;

  const record = (outcome, label, detail) => {
    const name = String(label);
    cases.push({ id: name, label: name, outcome, section, ...(detail ? { detail: String(detail) } : {}) });
    console.log("  " + MARK[outcome] + " " + name);
    if (outcome === "pass") passed += 1;
    else if (outcome === "fail") failed += 1;
    else warned += 1;
    if (outcome === "fail" && detail) console.error("      " + String(detail).replace(/\n/g, "\n      "));
  };

  const api = {
    section(name) {
      section = String(name);
      console.log("\n== " + section + " ==");
    },
    ok(cond, label, detail) {
      record(cond ? "pass" : "fail", label, cond ? null : detail);
    },
    eq(actual, expected, label) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      record(a === e ? "pass" : "fail", label, a === e ? null : `expected ${e}\nactual   ${a}`);
    },
    // 期望抛错；needle 可以是字符串片段或 RegExp
    throws(fn, needle, label) {
      try {
        fn();
        record("fail", label, "did not throw");
      } catch (err) {
        const msg = String(err && err.message);
        const hit = !needle ? true : needle instanceof RegExp ? needle.test(msg) : msg.indexOf(String(needle)) >= 0;
        record(hit ? "pass" : "fail", label, hit ? null : `wrong message: ${msg}`);
      }
    },
    // 有意保留的与文档/规范的差异：记为告警，不阻塞闸门，但会出现在报告里
    warn(label, detail) {
      record("warn", label, detail);
    },
    get counts() {
      return { passed, failed, warned, total: cases.length };
    },
    done() {
      console.log("\n" + "===NEWAPI-TEST-RESULT-BEGIN===");
      console.log(JSON.stringify({ schema: 1, key, version, layer, passed, failed, warned, total: cases.length, cases }));
      console.log("===NEWAPI-TEST-RESULT-END===");
      console.log(`\npassed=${passed} failed=${failed} warned=${warned}`);
      if (failed > 0) process.exit(1);
    },
  };
  return api;
}
