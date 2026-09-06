// M2 红色契约（T-E00-F01-001）：战斗系统状态效果 golden 红测。
// 数值锚点取自 docs/design/2026-09-06-小程序简化版设计.md §战斗系统·状态效果 表格，不从旧实现反抄。
// 属性派生与回合规则的 golden 已由并行实现方在 combat.test.ts 锁定；本文件锁定其尚未覆盖、
// 也尚未实现的状态效果契约（owner：battle-status.ts，T-E01-F03-001）：
// 灼烧 6%/8% 最大生命 3/2 回合、冰冻 1 回合、减速先攻 −5 3 回合、护盾吸收、反伤 10%、
// 状态抗性按概率抵消、同状态不叠加异源刷新取最强。
// 现阶段 battle-status.ts 不存在 → 导入即红；pnpm test 三次连跑退出码均非 0。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ActiveStatus,
  BURN_STRONG,
  BURN_WEAK,
  FREEZE_TURNS,
  REFLECT_PCT,
  SLOW_FIRST_STRIKE_FLAT,
  SLOW_TURNS,
  absorbWithShield,
  attachStatus,
  reflectDamage,
  shieldCapacity,
  statusResisted,
  tickStatus,
} from "./battle-status.js";

describe("状态效果数值锚点（battle-status）", () => {
  it("灼烧 6%/回合 3 回合（弱）与 8%/回合 2 回合（强）；冰冻 1 回合；减速先攻 −5 3 回合；反伤 10%", () => {
    assert.deepEqual(BURN_WEAK, { hpPctPerTurn: 6, turns: 3 });
    assert.deepEqual(BURN_STRONG, { hpPctPerTurn: 8, turns: 2 });
    assert.equal(FREEZE_TURNS, 1);
    assert.equal(SLOW_FIRST_STRIKE_FLAT, 5);
    assert.equal(SLOW_TURNS, 3);
    assert.equal(REFLECT_PCT, 10);
  });

  it("灼烧在行动后每回合扣 6%/8% 最大生命，3/2 回合后消退", () => {
    let current: ActiveStatus | undefined = {
      kind: "burn",
      hpPctPerTurn: BURN_WEAK.hpPctPerTurn,
      turnsLeft: BURN_WEAK.turns,
    };
    for (let i = 0; i < 3; i++) {
      assert.ok(current);
      const tick = tickStatus(current, 350);
      assert.equal(tick.damage, 21);
      current = tick.status;
    }
    assert.equal(current, undefined);

    const strong = tickStatus(
      { kind: "burn", hpPctPerTurn: BURN_STRONG.hpPctPerTurn, turnsLeft: BURN_STRONG.turns },
      350,
    );
    assert.equal(strong.damage, 28);
    assert.equal(strong.status?.turnsLeft, 1);
  });

  it("冰冻 1 回合：不产出伤害，回合结束即消退", () => {
    const frozen = tickStatus({ kind: "freeze", turnsLeft: FREEZE_TURNS }, 350);
    assert.equal(frozen.damage, 0);
    assert.equal(frozen.status, undefined);
  });

  it("减速先攻 −5 持续 3 回合：不产出伤害，逐回合递减", () => {
    let current: ActiveStatus | undefined = {
      kind: "slow",
      firstStrikeFlat: SLOW_FIRST_STRIKE_FLAT,
      turnsLeft: SLOW_TURNS,
    };
    let ticks = 0;
    while (current) {
      const tick = tickStatus(current, 350);
      assert.equal(tick.damage, 0);
      current = tick.status;
      ticks += 1;
    }
    assert.equal(ticks, SLOW_TURNS);
  });

  it("同状态不叠加，异源刷新取最强", () => {
    // 弱灼烧快消退时叠加强灼烧 → 取 8%，时长刷新为 2。
    assert.deepEqual(
      attachStatus(
        { kind: "burn", hpPctPerTurn: 6, turnsLeft: 1 },
        { kind: "burn", hpPctPerTurn: 8, turnsLeft: 2 },
      ),
      { kind: "burn", hpPctPerTurn: 8, turnsLeft: 2 },
    );
    // 强灼烧在身时叠加强度较弱但更持久的灼烧 → 保持 8%，时长取剩余更长者。
    assert.deepEqual(
      attachStatus(
        { kind: "burn", hpPctPerTurn: 8, turnsLeft: 1 },
        { kind: "burn", hpPctPerTurn: 6, turnsLeft: 3 },
      ),
      { kind: "burn", hpPctPerTurn: 8, turnsLeft: 3 },
    );
    // 同强度灼烧二次附加 → 不叠加成 12%，仅刷新时长。
    assert.deepEqual(
      attachStatus(
        { kind: "burn", hpPctPerTurn: 6, turnsLeft: 2 },
        { kind: "burn", hpPctPerTurn: 6, turnsLeft: 3 },
      ),
      { kind: "burn", hpPctPerTurn: 6, turnsLeft: 3 },
    );
  });

  it("状态抗性按概率抵消（百毒不侵 20%：掷骰 < 20 抵消）", () => {
    assert.equal(statusResisted(10, 20), true);
    assert.equal(statusResisted(19.9, 20), true);
    assert.equal(statusResisted(20, 20), false);
    assert.equal(statusResisted(99, 20), false);
  });

  it("护盾按最大生命百分比生成并吸收伤害直至破除（玄光罩 20%、灵龟盾 12%）", () => {
    assert.equal(shieldCapacity(350, 20), 70);
    assert.equal(shieldCapacity(350, 12), 42);
    assert.deepEqual(absorbWithShield(70, 50), { shieldLeft: 20, hpDamage: 0 });
    assert.deepEqual(absorbWithShield(70, 90), { shieldLeft: 0, hpDamage: 20 });
  });

  it("反伤：受击反弹 10% 伤害", () => {
    assert.equal(reflectDamage(100), 10);
    assert.equal(reflectDamage(350), 35);
  });
});
