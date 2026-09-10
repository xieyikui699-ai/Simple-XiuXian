// M2 红色契约（T-E00-F03-001）：NPC 宗门、宣战、会战、声望与胜负结局 golden 红测。
// 数值锚点全部取自 docs/design/2026-09-06-小程序简化版设计.md §NPC 对手宗门/§两宗对抗/§胜负与结局评价 表格，
// 不从旧实现反抄。本文件只锁契约：rival.ts（E04-F01/F02）与 sect-war.ts（E04-F03）尚未实现 → 导入即红；
// settlement.ts 的结局判定导出（E04-F04 契约）亦未落地。pnpm test 三次连跑退出码均非 0。
// 战斗细节 golden 由 battle 域（combat.test.ts + battle.test.ts）锁定，此处不重复断言。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deterministicRoll } from "./hash.js";
import { realmStageForLevel } from "./realms.js";
import {
  MAJOR_BREAKTHROUGH_LEVELS,
  RIVAL_INCOME_PER_OUTER_PER_MONTH,
  RIVAL_INITIAL_INNER_DISCIPLES,
  RIVAL_RECRUIT_CHANCE_PCT,
  type RivalSect,
  WAR_COOLDOWN_MONTHS,
  WAR_DECLARE_ROLL_PCT,
  advanceRivalSectMonthly,
  applyPrestigeDelta,
  createRivalSect,
  prestigeDeltaForMajorBreakthrough,
  prestigeDeltaForSectWar,
  prestigeDeltaForSpar,
  rivalGearTierForRank,
  rivalWarDecision,
} from "./rival.js";
import {
  type PairOutcome,
  WAR_DEATH_CHANCE_PCT,
  WAR_MORALE_DELTA,
  WAR_PLUNDER_CAP,
  WAR_PLUNDER_PCT,
  WAR_PRESTIGE_DELTA,
  type WarEligibleDisciple,
  pairSectWarFighters,
  resolveSectWar,
  runSectWar,
  warPlunder,
} from "./sect-war.js";
import { RECRUIT_COST, sectLimitsFor } from "./sect.js";
import {
  DECLINE_COLLAPSE_MONTHS,
  annexationTriggered,
  annexedTriggered,
  declineStreakAfter,
  isDeclineCollapse,
  monthlyZhenyuanGain,
  nascentVictoryTriggered,
  rateEnding,
} from "./settlement.js";
import type { Disciple, GameState } from "./state.js";

function makeFighter(
  overrides: Partial<Disciple> & Pick<Disciple, "id"> & { injuryMonthsLeft?: number },
): WarEligibleDisciple {
  const realmLevel = overrides.realmLevel ?? 1;
  return {
    id: overrides.id,
    name: overrides.name ?? `弟子${overrides.id}`,
    gender: "male",
    age: 20,
    maxLifespan: 90,
    realm: overrides.realm ?? realmStageForLevel(realmLevel).realm,
    realmLevel,
    zhenyuan: overrides.zhenyuan ?? 0,
    breakthroughFailures: 0,
    rootType: "single",
    rootElements: ["metal"],
    attributes: { strength: 50, soulPower: 50, agility: 50, physique: 50, comprehension: 50 },
    talentIds: [],
    injuryMonthsLeft: overrides.injuryMonthsLeft,
  };
}

function stubStateFor(rival: RivalSect): GameState {
  // monthlyZhenyuanGain 只读 morale / policy，NPC 与玩家同公式（设计 §NPC 对手宗门）。
  return { morale: rival.morale } as GameState;
}

describe("NPC 宗门生成（rival）", () => {
  it("开局掌门 1 + 内门 3（外门恒按等级上限满员、不入名册），与玩家同为 1 级宗门、初始 2000 灵石 / 士气 70 / 声望 50", () => {
    assert.equal(RIVAL_INITIAL_INNER_DISCIPLES, 3);
    assert.equal(sectLimitsFor(1).outerLimit, 100);
    const rival = createRivalSect({ seed: "rival-golden", name: "玄阴宗", difficulty: 1 });
    assert.equal(rival.disciples.length, 4);
    const leader = rival.disciples.find((disciple) => disciple.id === rival.leaderId);
    assert.ok(leader);
    assert.equal(rival.sectRank, 1);
    assert.equal(rival.spiritStones, 2000);
    assert.equal(rival.morale, 70);
    assert.equal(rival.prestige, 50);
    for (const disciple of rival.disciples) {
      assert.equal(disciple.realmLevel, 1);
      assert.equal(disciple.zhenyuan, 0);
    }
    assert.equal(new Set(rival.disciples.map((disciple) => disciple.name)).size, 4);
  });

  it("同一生成器：同 seed 双跑 deepEqual（禁 Math.random）", () => {
    const first = createRivalSect({ seed: "rival-golden", name: "玄阴宗", difficulty: 1 });
    const second = createRivalSect({ seed: "rival-golden", name: "玄阴宗", difficulty: 1 });
    assert.deepEqual(first, second);
  });

  it("装备按宗门等级自动配品阶：1→阶1 / 2→阶2 / 3→阶3（不出阶 4）", () => {
    assert.equal(rivalGearTierForRank(1), 1);
    assert.equal(rivalGearTierForRank(2), 2);
    assert.equal(rivalGearTierForRank(3), 3);
  });
});

describe("NPC 月度运行时（rival，确定性）", () => {
  it("内门真元按玩家同公式 ×难度（1.0/0.8/1.2，四舍五入）", () => {
    for (const difficulty of [1, 0.8, 1.2] as const) {
      const rival = createRivalSect({ seed: "rival-golden", name: "玄阴宗", difficulty });
      // 调平后首月真元即超 1 级需求，会触发突破清零；把内门抬到筑基后期（需求 5,000）观察净增。
      for (const disciple of rival.disciples) {
        disciple.realmLevel = 6;
        disciple.realm = realmStageForLevel(6).realm;
      }
      const advanced = advanceRivalSectMonthly(rival, 2);
      // 遍历推进前名册（当月招募的新弟子真元恒 0，不参与本断言）。
      for (const before of rival.disciples) {
        const after = advanced.disciples.find((entry) => entry.id === before.id);
        assert.ok(after);
        const gain = monthlyZhenyuanGain(stubStateFor(rival), before);
        assert.equal(after.zhenyuan, Math.round(gain * difficulty));
      }
    }
  });

  it("满足升阶条件自动升阶：1→2 消耗 5,000 灵石，外门随等级扩容至 300", () => {
    const staged = structuredClone(
      createRivalSect({ seed: "rival-golden", name: "玄阴宗", difficulty: 1 }),
    );
    staged.spiritStones = 6000;
    const leader = staged.disciples.find((disciple) => disciple.id === staged.leaderId);
    assert.ok(leader);
    leader.realmLevel = 4;
    const advanced = advanceRivalSectMonthly(staged, 2);
    assert.equal(advanced.sectRank, 2);
    // 经济：挖矿收入 200（1 级外门上限 100 × 2）− 内门俸禄 4×10 = +160；升阶 −5,000；
    // 升阶后内门未满，当月招募掷骰若命中再扣 300（按名册实际增员折算）。
    const recruitCost = advanced.disciples.length > staged.disciples.length ? RECRUIT_COST : 0;
    assert.equal(advanced.spiritStones, 6000 + 200 - 40 - 5000 - recruitCost);
  });

  it("突破尝试后真元清零（成败皆清，同玩家规则）", () => {
    const staged = structuredClone(
      createRivalSect({ seed: "rival-golden", name: "玄阴宗", difficulty: 1 }),
    );
    const leader = staged.disciples.find((disciple) => disciple.id === staged.leaderId);
    assert.ok(leader);
    // 设为恰好达阈：月结先加当月真元再判突破，必触发一次尝试（成败皆清零）。
    leader.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    const advanced = advanceRivalSectMonthly(staged, 2);
    const after = advanced.disciples.find((disciple) => disciple.id === leader.id);
    assert.ok(after);
    assert.equal(after.zhenyuan, 0);
  });
});

describe("NPC 招募与经济（rival）", () => {
  it("常量锚点：挖矿单价 2、招募概率基准 30%/月", () => {
    assert.equal(RIVAL_INCOME_PER_OUTER_PER_MONTH, 2);
    assert.equal(RIVAL_RECRUIT_CHANCE_PCT, 30);
  });

  it("经济：月收入 = 外门上限 × 2（1 级 = 200）− 内门俸禄；招募扣 300（与玩家同价）", () => {
    const rival = createRivalSect({ seed: "rival-econ", name: "玄阴宗", difficulty: 1 });
    const advanced = advanceRivalSectMonthly(rival, 1);
    const recruited = advanced.disciples.length - rival.disciples.length;
    assert.equal(advanced.spiritStones, 2000 + 200 - 4 * 10 - recruited * RECRUIT_COST);
  });

  it("月度招募：内门未满按概率补员，60 月内名册增长且永不超过当前等级内门上限；经济自给可升阶（1→2 上限扩至 24）；新弟子按等级配装备、不重名、id 顺号", () => {
    const rival = createRivalSect({ seed: "rival-recruit", name: "玄阴宗", difficulty: 1 });
    let current = rival;
    for (let turn = 1; turn <= 60; turn++) {
      current = advanceRivalSectMonthly(current, turn);
      assert.ok(
        current.disciples.length <= sectLimitsFor(current.sectRank).innerLimit,
        `第 ${turn} 月：内门 ${current.disciples.length} 人超出 ${current.sectRank} 级上限`,
      );
    }
    assert.ok(current.disciples.length > rival.disciples.length, "60 月内应招到新弟子");
    // 经济自给锚点（2026-09-10 九 单价 1→2）：旧口径 1 级满员后收支走平、5,000 永不可攒；
    // 新口径下该 seed 60 月内攒够升阶费并出筑基，自动升 2 级（上限 10 → 24）。
    assert.equal(current.sectRank, 2, "60 月内应靠挖矿收入自升至 2 级");
    // id 严格顺号（r-1 起连续），全员有按等级配的法宝，名册无重名。
    assert.deepEqual(
      current.disciples.map((disciple) => disciple.id),
      current.disciples.map((_, index) => `r-${index + 1}`),
    );
    for (const disciple of current.disciples) {
      assert.ok(disciple.equippedGear?.talisman);
    }
    assert.equal(
      new Set(current.disciples.map((disciple) => disciple.name)).size,
      current.disciples.length,
    );
  });

  it("灵石不足招募费（结余 < 300）当月不补员：0 灵石月结后 60，名册不变", () => {
    const rival = createRivalSect({ seed: "rival-poor", name: "玄阴宗", difficulty: 1 });
    rival.spiritStones = 0;
    const advanced = advanceRivalSectMonthly(rival, 1);
    assert.equal(advanced.disciples.length, rival.disciples.length);
    assert.equal(advanced.spiritStones, 0 + 200 - 40);
  });

  it("内门满员（达等级上限）停止招募：即使掷骰连续命中也不再扩编", () => {
    const seed = "rival-full";
    const difficulty = 1.2;
    const rival = createRivalSect({ seed, name: "玄阴宗", difficulty });
    // 填满至 1 级内门上限 10 人（克隆现名册弟子改 id，规避手搓完整档案）。
    while (rival.disciples.length < sectLimitsFor(1).innerLimit) {
      const source = rival.disciples[rival.disciples.length - 1];
      assert.ok(source);
      const clone = structuredClone(source);
      rival.discipleSeq += 1;
      clone.id = `r-${rival.discipleSeq}`;
      rival.disciples.push(clone);
    }
    // 保证测试效力：12 月窗口内确有掷骰命中（否则闸门未被真正 exercised）。
    const rollHit = Array.from({ length: 12 }, (_, index) =>
      deterministicRoll(`${seed}:rival-recruit:${index + 1}`),
    ).some((roll) => roll < RIVAL_RECRUIT_CHANCE_PCT * difficulty);
    assert.ok(rollHit, "test_setup_recruit_roll_not_found");
    let current = rival;
    for (let turn = 1; turn <= 12; turn++) {
      current = advanceRivalSectMonthly(current, turn);
      assert.equal(current.disciples.length, sectLimitsFor(1).innerLimit);
    }
  });

  it("招募频率 ×难度：同 seed 下 1.2 档 60 月招员数不少于 0.8 档", () => {
    const runFor = (difficulty: number): RivalSect => {
      let current = createRivalSect({ seed: "rival-diff", name: "玄阴宗", difficulty });
      for (let turn = 1; turn <= 60; turn++) current = advanceRivalSectMonthly(current, turn);
      return current;
    };
    assert.ok(runFor(1.2).disciples.length >= runFor(0.8).disciples.length);
  });

  it("招募确定性：同 seed 双跑 60 月 deepEqual（禁 Math.random）", () => {
    const run = (): RivalSect => {
      let current = createRivalSect({ seed: "rival-recruit", name: "玄阴宗", difficulty: 1 });
      for (let turn = 1; turn <= 60; turn++) current = advanceRivalSectMonthly(current, turn);
      return current;
    };
    assert.deepEqual(run(), run());
  });
});

describe("宣战与冷却（rival）", () => {
  it("NPC 宣战：声望差 >50 或等级更高时 15%/月（掷骰 < 15 才宣战）", () => {
    assert.equal(WAR_DECLARE_ROLL_PCT, 15);
    assert.equal(rivalWarDecision({ roll: 14.9, prestigeGap: 51, rivalLevelHigher: false }), true);
    assert.equal(rivalWarDecision({ roll: 15, prestigeGap: 51, rivalLevelHigher: false }), false);
    assert.equal(rivalWarDecision({ roll: 3, prestigeGap: 50, rivalLevelHigher: false }), false);
    assert.equal(rivalWarDecision({ roll: 3, prestigeGap: 50, rivalLevelHigher: true }), true);
  });

  it("会战结束后 12 个月冷却", () => {
    assert.equal(WAR_COOLDOWN_MONTHS, 12);
  });
});

describe("声望规则（rival，设计 §声望）", () => {
  it("历练+1 由月结承担；切磋 +2/−1（平 0）；会战 ±10；大境界突破（进入 4/7/10）+3；下限 0", () => {
    assert.equal(prestigeDeltaForSpar("win"), 2);
    assert.equal(prestigeDeltaForSpar("lose"), -1);
    assert.equal(prestigeDeltaForSpar("draw"), 0);
    assert.equal(prestigeDeltaForSectWar(true), 10);
    assert.equal(prestigeDeltaForSectWar(false), -10);
    assert.deepEqual(MAJOR_BREAKTHROUGH_LEVELS, [4, 7, 10]);
    for (const level of [4, 7, 10]) assert.equal(prestigeDeltaForMajorBreakthrough(level), 3);
    for (const level of [1, 2, 3, 5, 6, 8, 9]) {
      assert.equal(prestigeDeltaForMajorBreakthrough(level), 0);
    }
    assert.equal(applyPrestigeDelta(5, -10), 0);
    assert.equal(applyPrestigeDelta(50, 10), 60);
  });
});

describe("会战（sect-war）", () => {
  it("全军出动：可出战弟子全员按实力等级降序（同值真元高者先），排除伤势（外门只是数字不入会战）", () => {
    const roster = [
      makeFighter({ id: "p-1", realmLevel: 5 }),
      makeFighter({ id: "p-2", realmLevel: 3, zhenyuan: 100 }),
      makeFighter({ id: "p-3", realmLevel: 3, zhenyuan: 50 }),
      makeFighter({ id: "p-4", realmLevel: 2 }),
      makeFighter({ id: "p-5", realmLevel: 9, injuryMonthsLeft: 2 }),
    ];
    const pairs = pairSectWarFighters(roster, [
      makeFighter({ id: "r-1", realmLevel: 4 }),
      makeFighter({ id: "r-2", realmLevel: 1 }),
    ]);
    assert.deepEqual(
      pairs.map((pair) => pair.player.id),
      ["p-1", "p-2"],
      "全员出战：除伤员外全部入列，按战力降序取较少一方对位数",
    );
  });

  it("宣战次月触发：双方按实力等级降序同序配对，人数不等按较少一方打满全部对位", () => {
    const player = [
      makeFighter({ id: "p-2", realmLevel: 3, zhenyuan: 100 }),
      makeFighter({ id: "p-1", realmLevel: 5 }),
      makeFighter({ id: "p-3", realmLevel: 2 }),
    ];
    const rival = [
      makeFighter({ id: "r-3", realmLevel: 1 }),
      makeFighter({ id: "r-1", realmLevel: 6 }),
      makeFighter({ id: "r-2", realmLevel: 3 }),
      makeFighter({ id: "r-4", realmLevel: 2 }),
    ];
    const pairs = pairSectWarFighters(player, rival);
    assert.deepEqual(
      pairs.map((pair) => [pair.player.id, pair.rival.id]),
      [
        ["p-1", "r-1"],
        ["p-2", "r-2"],
        ["p-3", "r-4"],
      ],
    );
  });

  it("胜场多者赢；1:1:1 比总伤害；仍平判玩家胜", () => {
    const outcome = (
      winner: "player" | "rival" | "draw",
      playerDamage: number,
      rivalDamage: number,
    ): PairOutcome => ({
      winner,
      playerDamage,
      rivalDamage,
    });
    assert.deepEqual(
      resolveSectWar([
        outcome("player", 300, 100),
        outcome("player", 200, 150),
        outcome("rival", 50, 400),
      ]),
      { winner: "player", decidedBy: "wins" },
    );
    assert.deepEqual(
      resolveSectWar([
        outcome("rival", 100, 300),
        outcome("rival", 100, 300),
        outcome("player", 400, 100),
      ]),
      { winner: "rival", decidedBy: "wins" },
    );
    assert.deepEqual(
      resolveSectWar([
        outcome("player", 300, 100),
        outcome("rival", 100, 300),
        // 口径修订（zcode-p4，收绿时）：原稿平局场 (150,150) 与前两场 (300,100)/(100,300)
        // 完全对称，任一对称聚合下总伤害恒相等，无法触发 totalDamage 裁决；
        // 改为 (150,100) 使总伤害 550:500 非对称，保留「1:1:1 比总伤害」的测试意图。
        outcome("draw", 150, 100),
      ]),
      { winner: "player", decidedBy: "totalDamage" },
    );
    assert.deepEqual(
      resolveSectWar([
        outcome("player", 200, 200),
        outcome("rival", 200, 200),
        outcome("draw", 100, 100),
      ]),
      { winner: "player", decidedBy: "tieFavorsPlayer" },
    );
    assert.deepEqual(
      resolveSectWar([outcome("rival", 0, 500), outcome("rival", 0, 500), outcome("draw", 0, 0)]),
      { winner: "rival", decidedBy: "wins" },
    );
  });

  it("胜方掠夺败方灵石 10%（上限 5,000，向下取整）；声望 ±10、士气 ±5；败方阵亡率 3%", () => {
    assert.equal(WAR_PLUNDER_PCT, 0.1);
    assert.equal(WAR_PLUNDER_CAP, 5000);
    assert.equal(warPlunder(8000), 800);
    assert.equal(warPlunder(60000), 5000);
    assert.equal(warPlunder(12345), 1234);
    assert.equal(WAR_PRESTIGE_DELTA, 10);
    assert.equal(WAR_MORALE_DELTA, 5);
    assert.equal(WAR_DEATH_CHANCE_PCT, 3);
  });

  it("runSectWar 确定性：同 seed 双跑 deepEqual，三场配对与掠夺/声望/士气口径完整", () => {
    const input = {
      playerFighters: [
        makeFighter({ id: "p-1", realmLevel: 5 }),
        makeFighter({ id: "p-2", realmLevel: 3 }),
        makeFighter({ id: "p-3", realmLevel: 2 }),
      ],
      rivalFighters: [
        makeFighter({ id: "r-1", realmLevel: 6 }),
        makeFighter({ id: "r-2", realmLevel: 3 }),
        makeFighter({ id: "r-3", realmLevel: 1 }),
      ],
      seed: "war-golden",
      playerStones: 8000,
      rivalStones: 20000,
    };
    const first = runSectWar(input);
    assert.deepEqual(first, runSectWar(input));
    assert.equal(first.pairOutcomes.length, 3);
    for (const pair of first.pairOutcomes) {
      assert.ok(pair.battle);
      assert.ok(["player", "rival", "draw"].includes(pair.winner));
    }
    // 阵亡契约：每阵战败者掷 `${seed}:sect-war-death:${turn}:${index}`，< 3 即当场陨落。
    for (const [index, pair] of first.pairOutcomes.entries()) {
      const roll = deterministicRoll(`war-golden:sect-war-death:0:${index}`);
      const shouldDie = pair.winner !== "draw" && roll < WAR_DEATH_CHANCE_PCT;
      if (shouldDie) {
        assert.ok(pair.death, `第 ${index + 1} 阵应判阵亡（掷骰 ${roll}）`);
        assert.equal(
          pair.death.discipleId,
          pair.winner === "player" ? pair.rivalFighterId : pair.playerFighterId,
        );
      } else {
        assert.equal(pair.death, undefined);
      }
    }
    const expectedPlunder = first.winner === "player" ? warPlunder(20000) : warPlunder(8000);
    assert.equal(first.plunder, expectedPlunder);
    assert.equal(
      first.prestigeDelta,
      first.winner === "player" ? WAR_PRESTIGE_DELTA : -WAR_PRESTIGE_DELTA,
    );
    assert.equal(
      first.moraleDelta,
      first.winner === "player" ? WAR_MORALE_DELTA : -WAR_MORALE_DELTA,
    );
  });
});

describe("胜负与结局（settlement 新增契约，E04-F04）", () => {
  it("吞并/被吞并判定对称：对方声望 ≤0 且我方宗门等级更高，次月触发", () => {
    assert.equal(annexationTriggered({ myRank: 2, rivalRank: 1, rivalPrestige: 0 }), true);
    assert.equal(annexationTriggered({ myRank: 2, rivalRank: 1, rivalPrestige: 5 }), false);
    assert.equal(annexationTriggered({ myRank: 1, rivalRank: 1, rivalPrestige: 0 }), false);
    assert.equal(annexedTriggered({ myRank: 1, rivalRank: 2, myPrestige: 0 }), true);
    assert.equal(annexedTriggered({ myRank: 2, rivalRank: 1, myPrestige: 0 }), false);
  });

  it("元婴胜利判定：门下有元婴期弟子即胜，否则不触发", () => {
    assert.equal(nascentVictoryTriggered([1, 5, 10]), true);
    assert.equal(nascentVictoryTriggered([3, 9, 9]), false);
    assert.equal(nascentVictoryTriggered([]), false);
  });

  it("凋敝：内门 0 且灵石不足招募费连续 6 月；内门回补或灵石回血即归零", () => {
    assert.equal(DECLINE_COLLAPSE_MONTHS, 6);
    let streak = 0;
    for (let i = 0; i < 7; i++) {
      streak = declineStreakAfter({ streak, innerCount: 0, spiritStones: RECRUIT_COST - 1 });
    }
    assert.equal(streak, 7);
    assert.equal(isDeclineCollapse(5), false);
    assert.equal(isDeclineCollapse(6), true);
    streak = declineStreakAfter({ streak, innerCount: 0, spiritStones: RECRUIT_COST });
    assert.equal(streak, 0);
    streak = declineStreakAfter({ streak: 4, innerCount: 1, spiritStones: 0 });
    assert.equal(streak, 0);
  });

  it("结局评价五维输入（用时/突破/会战胜绩/坐化/剩余灵石）→ 甲乙丙丁；阈值由 E04-F04 定夺，本测试只锁形状与确定性", () => {
    const input = {
      gameYears: 40,
      breakthroughCount: 12,
      warWins: 2,
      warTotal: 3,
      fallenCount: 4,
      spiritStonesLeft: 8000,
    };
    assert.deepEqual(rateEnding(input), rateEnding(input));
    assert.ok(["甲", "乙", "丙", "丁"].includes(rateEnding(input)));
  });
});
