import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDiscipleAttributes } from "./attributes.js";
import { effectiveDeathAge, generateDiscipleMaxLifespan } from "./lifespan.js";
import {
  REALM_LIFESPAN_BONUSES,
  REALM_STAGES,
  realmLifespanBonusForLevel,
  realmStageForLevel,
} from "./realms.js";
import { ROOT_ELEMENTS, ROOT_MULTIPLIERS, generateRootProfile } from "./roots.js";
import { TALENTS, generateTalentIds, talentsZhenyuanPct } from "./talents.js";

describe("境界表", () => {
  it("10 段、实力等级 1–10 连续且真元递增", () => {
    assert.equal(REALM_STAGES.length, 10);
    for (let i = 0; i < REALM_STAGES.length; i++) {
      const stage = REALM_STAGES[i];
      assert.ok(stage);
      assert.equal(stage.level, i + 1);
      if (i > 0) {
        const previous = REALM_STAGES[i - 1];
        assert.ok(previous);
        assert.ok(stage.requiredZhenyuan > previous.requiredZhenyuan);
      }
    }
    const last = REALM_STAGES[REALM_STAGES.length - 1];
    assert.ok(last);
    assert.equal(last.name, "元婴前期");
    assert.equal(realmStageForLevel(10).realm, "nascent_soul_early");
  });

  it("境界寿元加成档位", () => {
    assert.equal(realmLifespanBonusForLevel(1), 0);
    assert.equal(realmLifespanBonusForLevel(3), 0);
    assert.equal(realmLifespanBonusForLevel(4), 200);
    assert.equal(realmLifespanBonusForLevel(7), 700);
    assert.equal(realmLifespanBonusForLevel(10), 2200);
    assert.equal(REALM_LIFESPAN_BONUSES.length, 4);
  });
});

describe("五维生成", () => {
  it("确定性且在 [10, 90]", () => {
    const a = generateDiscipleAttributes({ gameSeed: "seed-1", discipleId: "d-1" });
    const b = generateDiscipleAttributes({ gameSeed: "seed-1", discipleId: "d-1" });
    assert.deepEqual(a, b);
    for (const value of Object.values(a)) {
      assert.ok(value >= 10 && value <= 90);
    }
  });

  it("总体分布均值接近 50", () => {
    let sum = 0;
    let count = 0;
    for (let i = 1; i <= 200; i++) {
      const attributes = generateDiscipleAttributes({ gameSeed: "dist", discipleId: `d-${i}` });
      for (const value of Object.values(attributes)) {
        sum += value;
        count += 1;
      }
    }
    const mean = sum / count;
    assert.ok(mean > 47 && mean < 53, `mean=${mean}`);
  });
});

describe("灵根", () => {
  it("确定性、元素数量与类型匹配且不重复", () => {
    for (let i = 1; i <= 100; i++) {
      const profile = generateRootProfile("root-seed", `d-${i}`);
      const expectedCount = { five: 5, four: 4, three: 3, dual: 2, single: 1 }[profile.rootType];
      assert.equal(profile.rootElements.length, expectedCount);
      assert.equal(new Set(profile.rootElements).size, expectedCount);
      for (const element of profile.rootElements) {
        assert.ok(ROOT_ELEMENTS.includes(element));
      }
    }
  });

  it("倍率表与主仓一致", () => {
    assert.deepEqual(ROOT_MULTIPLIERS, { five: 1, four: 1.5, three: 2, dual: 3, single: 5 });
  });
});

describe("寿命", () => {
  it("maxLifespan 在 [70, 108] 且确定", () => {
    const a = generateDiscipleMaxLifespan("life-seed", "d-1");
    assert.equal(a, generateDiscipleMaxLifespan("life-seed", "d-1"));
    for (let i = 1; i <= 100; i++) {
      const value = generateDiscipleMaxLifespan("life-seed", `d-${i}`);
      assert.ok(value >= 70 && value <= 108);
    }
  });

  it("有效坐化年龄 = 基准 + 境界加成 + 平加", () => {
    const deathAge = effectiveDeathAge({ age: 80, maxLifespan: 90, realmLevel: 7 }, 10);
    assert.equal(deathAge, 90 + 700 + 10);
  });
});

describe("天赋目录", () => {
  it("30 条、id 唯一、权重为正", () => {
    assert.equal(TALENTS.length, 30);
    assert.equal(new Set(TALENTS.map((talent) => talent.id)).size, 30);
    for (const talent of TALENTS) {
      assert.ok(talent.weight > 0);
    }
  });

  it("每人 1–3 条且不重复、确定性", () => {
    for (let i = 1; i <= 100; i++) {
      const ids = generateTalentIds("talent-seed", `d-${i}`);
      assert.ok(ids.length >= 1 && ids.length <= 3);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(ids, generateTalentIds("talent-seed", `d-${i}`));
    }
  });

  it("真元加成聚合", () => {
    // 灵气亲和 0.1 + 苦修不辍 0.05
    assert.ok(
      Math.abs(talentsZhenyuanPct(["t-spirit-affinity", "t-diligent-cultivation"]) - 0.15) < 1e-9,
    );
  });
});
