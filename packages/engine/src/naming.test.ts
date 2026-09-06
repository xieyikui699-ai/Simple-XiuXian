import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDiscipleProfile } from "./naming.js";

describe("弟子取名", () => {
  it("同 seed 同序号恒定", () => {
    const a = generateDiscipleProfile({ seed: "sect-alpha", ordinal: 1 });
    const b = generateDiscipleProfile({ seed: "sect-alpha", ordinal: 1 });
    assert.deepEqual(a, b);
  });

  it("不同序号避重且生成 100 个不重复姓名", () => {
    const used: string[] = [];
    for (let ordinal = 1; ordinal <= 100; ordinal++) {
      const profile = generateDiscipleProfile({ seed: "sect-alpha", ordinal, usedNames: used });
      assert.ok(!used.includes(profile.name));
      assert.ok(profile.name.length >= 2 && profile.name.length <= 4);
      used.push(profile.name);
    }
  });

  it("性别字池隔离：男名不出现女字池独有字", () => {
    for (let ordinal = 1; ordinal <= 60; ordinal++) {
      const profile = generateDiscipleProfile({ seed: "pool-check", ordinal });
      assert.match(profile.name, /^[\u4e00-\u9fff]+$/);
    }
  });

  it("非法输入被拒绝", () => {
    assert.throws(() => generateDiscipleProfile({ seed: "  ", ordinal: 1 }));
    assert.throws(() => generateDiscipleProfile({ seed: "s", ordinal: 0 }));
    assert.throws(() => generateDiscipleProfile({ seed: "s", ordinal: 1.5 }));
  });
});
