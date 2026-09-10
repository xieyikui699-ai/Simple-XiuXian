// 战报文字描述契约：锁定 formatBattleReport 的行文模板（开场/逐回合行动/
// 状态明细/终局/伤势/汇总）与 battleSourceLabel 映射；再以真实 runBattle
// 战报做集成冒烟（叙事行数 ≥ 行动条数、法术名可反查、终局句存在）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  battleSourceLabel,
  formatBattleReport,
  formatBattleReportSegments,
} from "./battle-narrative.js";
import type { BattleActionEntry, BattleReport } from "./battle.js";
import { runBattle } from "./battle.js";
import { deriveCombatProfile } from "./combat-profile.js";
import type { CombatProfile } from "./combat-profile.js";

const BASE_ATTRIBUTES = {
  strength: 40,
  soulPower: 40,
  agility: 40,
  physique: 40,
  comprehension: 40,
} as const;

function entry(
  partial: Pick<BattleActionEntry, "round" | "actor" | "kind"> & Partial<BattleActionEntry>,
): BattleActionEntry {
  return {
    damage: 0,
    hpLoss: 0,
    shieldAbsorbed: 0,
    lifestealHeal: 0,
    reflectDamage: 0,
    statusNotes: [],
    hp: { A: 200, B: 200 },
    ...partial,
  };
}

function fixtureReport(overrides: Partial<BattleReport> = {}): BattleReport {
  const actions: BattleActionEntry[] = [
    entry({
      round: 1,
      actor: "A",
      kind: "basic",
      hit: true,
      crit: true,
      damage: 35,
      hpLoss: 35,
      hp: { A: 200, B: 165 },
    }),
    entry({
      round: 1,
      actor: "A",
      kind: "spell",
      spellId: "spell-yanbao",
      hit: true,
      crit: false,
      damage: 58,
      hpLoss: 58,
      hp: { A: 200, B: 107 },
      statusNotes: ["李四 被附加灼烧（每回合 6% 最大生命，持续 3 回合）"],
    }),
    // 纯增益（护盾类）：不掷命中（无 hit/crit 键）。
    entry({
      round: 1,
      actor: "A",
      kind: "spell",
      spellId: "spell-xuanguang",
      hp: { A: 200, B: 107 },
      statusNotes: ["张三 获得护盾（吸收 40 点）"],
    }),
    entry({ round: 2, actor: "B", kind: "basic", hit: false, hp: { A: 200, B: 107 } }),
    entry({
      round: 2,
      actor: "B",
      kind: "spell",
      spellId: "spell-shehun",
      hit: true,
      crit: false,
      damage: 30,
      hpLoss: 30,
      shieldAbsorbed: 10,
      lifestealHeal: 9,
      hp: { A: 170, B: 116 },
      statusNotes: ["护盾吸收 10 点伤害", "李四 吸血回复 9 点生命"],
    }),
    // 目录外法术：名字回退 id。
    entry({
      round: 2,
      actor: "A",
      kind: "spell",
      spellId: "spell-lost",
      hit: true,
      crit: false,
      damage: 22,
      hpLoss: 22,
      hp: { A: 170, B: 94 },
    }),
    entry({
      round: 3,
      actor: "B",
      kind: "skip",
      hp: { A: 170, B: 94 },
      statusNotes: ["李四 被冰冻，跳过行动"],
    }),
    entry({
      round: 3,
      actor: "B",
      kind: "burn",
      damage: 12,
      hp: { A: 170, B: 0 },
      statusNotes: ["李四 灼烧结算：损失 12 点生命（每回合 6% 最大生命）"],
    }),
  ];
  return {
    seed: "fixture-seed",
    winner: "A",
    rounds: 3,
    fighters: { A: "张三", B: "李四" },
    actions,
    totalDamage: { A: 115, B: 30 },
    injuries: { A: "none", B: "light" },
    finalHp: { A: 170, B: 0 },
    injuryMonths: { none: 0, light: 1, heavy: 3 },
    source: "sparring",
    turn: 7,
    ...overrides,
  };
}

describe("战报文字描述（battle-narrative）", () => {
  it("来源显示名：expedition/sparring/sect-war 有名，未知与缺省为「战斗」", () => {
    assert.equal(battleSourceLabel("expedition"), "历练");
    assert.equal(battleSourceLabel("sparring"), "切磋");
    assert.equal(battleSourceLabel("sect-war"), "会战");
    assert.equal(battleSourceLabel("mystery"), "战斗");
    assert.equal(battleSourceLabel(undefined), "战斗");
  });

  it("完整战报逐行转写：开场 → 逐回合行动与状态明细 → 终局 → 伤势 → 汇总", () => {
    const lines = formatBattleReport(fixtureReport());
    assert.deepEqual(lines, [
      "【切磋】张三 与 李四 交战",
      "—— 第 1 回合 ——",
      "张三 发动攻伐，对 李四 造成 35 点伤害（会心一击）",
      "张三 施展【炎爆术】，对 李四 造成 58 点伤害",
      "· 李四 被附加灼烧（每回合 6% 最大生命，持续 3 回合）",
      "张三 施展【玄光罩】",
      "· 张三 获得护盾（吸收 40 点）",
      "—— 第 2 回合 ——",
      "李四 发动攻伐，被 张三 避开，未造成伤害",
      "李四 施展【摄魂大法】，对 张三 造成 30 点伤害",
      "· 护盾吸收 10 点伤害",
      "· 李四 吸血回复 9 点生命",
      "张三 施展【spell-lost】，对 李四 造成 22 点伤害",
      "—— 第 3 回合 ——",
      "李四 身陷冰冻，无法行动",
      "李四 身上灼烧发作，损失 12 点生命",
      "历经 3 回合，李四 不支倒下——张三 胜出！",
      "战后：李四 身负轻伤，禁战 1 月",
      "本场总伤害：张三 115 / 李四 30；终局生命：张三 170 / 李四 0",
    ]);
  });

  it("平局：无伤势行，终局句为平局收场；无来源时开场标签为「战斗」", () => {
    const lines = formatBattleReport(
      fixtureReport({
        winner: "draw",
        rounds: 30,
        injuries: { A: "none", B: "none" },
        finalHp: { A: 90, B: 80 },
        source: undefined,
        turn: undefined,
      }),
    );
    assert.equal(lines[0], "【战斗】张三 与 李四 交战");
    assert.equal(lines[lines.length - 2], "历经 30 回合鏖战，未分胜负，平局收场");
    assert.ok(!lines.some((line) => line.includes("禁战")));
  });

  it("重伤禁战 3 月按战报 injuryMonths 数据化", () => {
    const lines = formatBattleReport(
      fixtureReport({
        winner: "B",
        injuries: { A: "heavy", B: "none" },
        finalHp: { A: 0, B: 82 },
      }),
    );
    assert.ok(lines.includes("历经 3 回合，张三 不支倒下——李四 胜出！"));
    assert.ok(lines.includes("战后：张三 身负重伤，禁战 3 月"));
  });

  function fighter(name: string, profile: CombatProfile, withSpell: boolean, realm?: string) {
    return {
      name,
      profile,
      rootElements: [] as const,
      spells: withSpell
        ? ([
            {
              id: "spell-yanbao",
              name: "炎爆术",
              element: "fire",
              multiplier: 2.6,
              cooldown: 5,
              status: { burn: { hpPctPerTurn: 6, turns: 3 } },
            },
          ] as const)
        : ([] as const),
      plan: withSpell
        ? ([{ kind: "spell", spellId: "spell-yanbao" }, { kind: "basic" }] as const)
        : ([{ kind: "basic" }] as const),
      realm,
    };
  }

  it("真实 runBattle 战报可完整转写：开场含双方实名、法术名反查目录、终局句存在", () => {
    const report = runBattle(
      fighter("青云子", deriveCombatProfile({ realmLevel: 3, attributes: BASE_ATTRIBUTES }), true),
      fighter("血无常", deriveCombatProfile({ realmLevel: 2, attributes: BASE_ATTRIBUTES }), false),
      "narrative-smoke",
      { source: "expedition", turn: 13 },
    );
    const lines = formatBattleReport(report);
    assert.equal(lines[0], "【历练】青云子 与 血无常 交战");
    // 每条行动至少对应一行主句（另加开场/回合分隔/终局/汇总）。
    assert.ok(lines.length > report.actions.length);
    assert.ok(lines.some((line) => line.includes("【炎爆术】")));
    assert.ok(
      lines.some((line) => /胜出！$/.test(line) || line.includes("平局收场")),
      "终局句必须存在",
    );
    const summary = lines[lines.length - 1];
    assert.ok(summary);
    assert.ok(summary.startsWith("本场总伤害：青云子 "));
  });

  it("首行名字后加（境界）：realm 随战报记录，旧档缺省则不显示", () => {
    const withRealm = formatBattleReport(
      fixtureReport({ realms: { A: "练气前期", B: "筑基后期" } }),
    );
    assert.equal(withRealm[0], "【切磋】张三（练气前期） 与 李四（筑基后期） 交战");
    // 旧档无 realms：首行模板不变（向后兼容）。
    assert.equal(formatBattleReport(fixtureReport())[0], "【切磋】张三 与 李四 交战");
    // 仅单方有境界：只显示该方。
    const oneSide = formatBattleReport(fixtureReport({ realms: { A: "练气前期" } }));
    assert.equal(oneSide[0], "【切磋】张三（练气前期） 与 李四 交战");
  });

  it("分段输出：人名段带 tone（A=own 我方 / B=enemy 对方），拼接后与纯文本一致", () => {
    const report = fixtureReport({ realms: { A: "练气前期", B: "筑基后期" } });
    const lines = formatBattleReportSegments(report);
    // 首行：【切磋】 张三（练气前期）[own]  与  李四（筑基后期）[enemy]  交战
    assert.deepEqual(lines[0], [
      { text: "【切磋】" },
      { text: "张三（练气前期）", tone: "own" },
      { text: " 与 " },
      { text: "李四（筑基后期）", tone: "enemy" },
      { text: " 交战" },
    ]);
    // 行动行：actor 与 target 分别带 tone。
    const firstAction = lines[2];
    assert.deepEqual(firstAction, [
      { text: "张三", tone: "own" },
      { text: " 发动攻伐，对 " },
      { text: "李四", tone: "enemy" },
      { text: " 造成 35 点伤害（会心一击）" },
    ]);
    // 拼接结果与纯文本入口逐行一致。
    assert.deepEqual(
      lines.map((segments) => segments.map((segment) => segment.text).join("")),
      formatBattleReport(report),
    );
  });

  it("runBattle 携带双方境界进战报，开场行带（境界）", () => {
    const report = runBattle(
      fighter(
        "青云子",
        deriveCombatProfile({ realmLevel: 3, attributes: BASE_ATTRIBUTES }),
        true,
        "练气后期",
      ),
      fighter(
        "血无常",
        deriveCombatProfile({ realmLevel: 2, attributes: BASE_ATTRIBUTES }),
        false,
        "筑基前期",
      ),
      "realm-smoke",
      { source: "expedition", turn: 14 },
    );
    assert.deepEqual(report.realms, { A: "练气后期", B: "筑基前期" });
    assert.equal(
      formatBattleReport(report)[0],
      "【历练】青云子（练气后期） 与 血无常（筑基前期） 交战",
    );
  });
});
