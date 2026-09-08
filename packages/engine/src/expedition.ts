import { type BattleFighter, type BattleReport, runBattle } from "./battle.js";
// 历练与遭遇（设计文档 §历练与遭遇 D-014 / §声望 D-019）：每月自动进行的宗门级月掷结算。
// 纯函数：不修改输入状态，返回 ExpeditionReport 由月结第 5 步落账（settlement.ts，E03-F02）；
// 对手弟子与出战弟子均由调用方注入（opponentProvider / fighterProvider），本模块不依赖 NPC 实装。
// 事件掷骰契约（与 expedition.test.ts golden 对拍，sha256 独立预计算）：
//   deterministicRoll(`${state.seed}:expedition:${turn}`)
//   区间 [0,50) 收获 / [50,65) 切磋 / [65,75) 掠夺 / [75,85) 奇遇 / [85,95) 危险 / [95,100) 丹药奇缘。
import {
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  type GearSlot,
  type GearTier,
  PILLS,
  SPELLS,
  TECHNIQUES,
  getSpellById,
} from "./catalog.js";
import { buildCombatProfile } from "./combat-profile.js";
import { deterministicRoll } from "./hash.js";
import type { Disciple, GameState } from "./state.js";

// ─── 六事件表（设计 §历练与遭遇 概率列）─────────────────────────────────

export type ExpeditionEventKind = "harvest" | "spar" | "plunder" | "windfall" | "danger" | "pill";

export const EXPEDITION_EVENT_RATES: Record<ExpeditionEventKind, number> = {
  harvest: 50,
  spar: 15,
  plunder: 10,
  windfall: 10,
  danger: 10,
  pill: 5,
};

/** 事件区间映射（roll ∈ [0,100)，golden 对拍契约）。 */
export function expeditionEventForRoll(roll: number): ExpeditionEventKind {
  if (roll < 50) return "harvest";
  if (roll < 65) return "spar";
  if (roll < 75) return "plunder";
  if (roll < 85) return "windfall";
  if (roll < 95) return "danger";
  return "pill";
}

export type ExpeditionInjuryKind = "light" | "heavy";

/** 危险伤势分支（roll ∈ [0,100)）：30% 轻伤 / 15% 重伤 / 其余安全。 */
export function injuryForRoll(roll: number): ExpeditionInjuryKind | "none" {
  if (roll < 30) return "light";
  if (roll < 45) return "heavy";
  return "none";
}

export const EXPEDITION_LIGHT_MONTHS = 1;
export const EXPEDITION_HEAVY_MONTHS = 3;
/** 收获灵石区间（×(1+incomePct) 前口径）。 */
export const HARVEST_STONES_MIN = 50;
export const HARVEST_STONES_MAX = 150;
/** 掠夺灵石区间（仅宣战状态、战胜时）。 */
export const PLUNDER_STONES_MIN = 200;
export const PLUNDER_STONES_MAX = 400;
/** 切磋奖惩（D-019 声望来源表）。 */
export const SPAR_WIN_PRESTIGE = 2;
export const SPAR_WIN_MORALE = 1;
export const SPAR_LOSE_PRESTIGE = -1;
export const SPAR_LOSE_MORALE = -1;

// ─── 注入边界 ────────────────────────────────────────────────────────────

/** 对手弟子注入（E04-F02 接真实 NPC 宗门；此前由测试注入 fixture 弟子）。 */
export type OpponentProvider = () => Disciple | undefined;

/** 我方出战弟子注入（缺省按可出战内门弟子确定性选取）。 */
export type FighterProvider = () => Disciple | undefined;

// ─── 报告形状（月结落账与 UI 回放消费）──────────────────────────────────

export type ExpeditionInjury = {
  discipleId: string;
  kind: ExpeditionInjuryKind;
  /** 禁战月数：轻伤 1 / 重伤 3。 */
  months: number;
};

export type ExpeditionBattle = {
  /** A = 我方出战弟子，B = 注入对手，draw = 30 回合平局。 */
  winner: "A" | "B" | "draw";
  /** 战败方伤势掷骰结果（平局无伤势；败者侧别由 winner 推得）。 */
  loserInjury?: { kind: ExpeditionInjuryKind; months: number };
  /** 逐回合战报（UI 回放直接消费）。 */
  report: BattleReport;
};

export type ExpeditionReward =
  | { type: "gongfa_book"; techniqueId: string }
  | { type: "spell_book"; spellId: string }
  | { type: "gear"; slot: GearSlot; tier: GearTier }
  | { type: "pill"; pillId: string };

export type ExpeditionNote = {
  kind: "normal" | "warning";
  text: string;
};

export type ExpeditionReport = {
  seed: string;
  turn: number;
  event: ExpeditionEventKind;
  /** 掠夺在非宣战状态下降级为切磋时记录原事件。 */
  degradedFrom?: "plunder";
  participantId?: string;
  participantName?: string;
  opponentId?: string;
  opponentName?: string;
  battle?: ExpeditionBattle;
  spiritStonesDelta: number;
  prestigeDelta: number;
  moraleDelta: number;
  /** 我方弟子伤势（危险事件或战败）；安全/胜利时缺省。 */
  injury?: ExpeditionInjury;
  /** 奇遇/丹药奇缘的入仓/入阁掉落（月结接线写入库）。 */
  reward?: ExpeditionReward;
  notes: ExpeditionNote[];
};

export type SettleExpeditionInput = {
  turn: number;
  atWar: boolean;
  /** 历练灵石收益加成（收获事件 ×(1+incomePct)；由月结按天赋聚合传入）。 */
  incomePct: number;
  opponentProvider: OpponentProvider;
  fighterProvider?: FighterProvider;
};

// ─── 可出战判定与默认选将 ────────────────────────────────────────────────

/** 可出战内门弟子：内门、未被岗位/长老占用、无未愈伤势（禁战判定供切磋/会战选人复用）。 */
export function combatReadyDisciples(state: Readonly<GameState>, turn: number): Disciple[] {
  const occupied = new Set<string>();
  if (state.jobs) {
    for (const kind of ["pill", "gear"] as const) {
      for (const workerId of state.jobs[kind].workers) occupied.add(workerId);
    }
  }
  if (state.elders?.resource) occupied.add(state.elders.resource);
  if (state.elders?.war) occupied.add(state.elders.war);
  return state.disciples.filter(
    (disciple) =>
      !occupied.has(disciple.id) && !(disciple.injury && disciple.injury.untilTurn >= turn),
  );
}

function defaultFighter(
  state: Readonly<GameState>,
  rollBase: string,
  turn: number,
): Disciple | undefined {
  const eligible = combatReadyDisciples(state, turn);
  if (eligible.length === 0) return undefined;
  const index = Math.floor((deterministicRoll(`${rollBase}:fighter`) / 100) * eligible.length);
  return eligible[index] ?? eligible[0];
}

function toBattleFighter(disciple: Disciple): BattleFighter {
  // 行动策略（设计 §回合规则）：可用法术按倍率从高到低（同倍率保持研读顺序），CD 未好自动回落普攻。
  const spells = (disciple.spellIds ?? [])
    .map((id) => getSpellById(id))
    .filter((spell): spell is NonNullable<typeof spell> => spell !== undefined)
    .sort((a, b) => b.multiplier - a.multiplier);
  return {
    name: disciple.name,
    profile: buildCombatProfile(disciple),
    rootElements: disciple.rootElements,
    spells,
    plan: spells.map((spell) => ({ kind: "spell" as const, spellId: spell.id })),
  };
}

/** [min, max] 闭区间整数掷骰。 */
function rollInt(seed: string, min: number, max: number): number {
  return min + Math.floor((deterministicRoll(seed) / 100) * (max - min + 1));
}

function pickIndex(seed: string, count: number): number {
  return Math.floor((deterministicRoll(seed) / 100) * count);
}

// ─── 战斗事件结算（切磋/掠夺共用）───────────────────────────────────────

type BattleContext = {
  participant: Disciple;
  opponent: Disciple;
  battle: ExpeditionBattle;
};

function runExpeditionBattle(
  input: SettleExpeditionInput,
  rollBase: string,
  participant: Disciple,
  opponent: Disciple,
): BattleContext {
  const report = runBattle(toBattleFighter(participant), toBattleFighter(opponent), rollBase, {
    source: "expedition",
    turn: input.turn,
  });
  const loserSide = report.winner === "A" ? "B" : report.winner === "B" ? "A" : undefined;
  const loserKind = loserSide ? report.injuries[loserSide] : "none";
  const loserInjury =
    loserSide && loserKind !== "none"
      ? { kind: loserKind, months: report.injuryMonths[loserKind] }
      : undefined;
  return {
    participant,
    opponent,
    battle: { winner: report.winner, loserInjury, report },
  };
}

/** 我方出战弟子的伤势（战败且伤势掷骰命中时；胜者恒无伤、平局双方无伤）。 */
function ownInjury(context: BattleContext): ExpeditionInjury | undefined {
  if (context.battle.winner !== "B") return undefined;
  const loser = context.battle.loserInjury;
  if (!loser) return undefined;
  return { discipleId: context.participant.id, kind: loser.kind, months: loser.months };
}

function sparReport(
  state: Readonly<GameState>,
  input: SettleExpeditionInput,
  rollBase: string,
  degradedFrom: "plunder" | undefined,
): ExpeditionReport {
  const base = {
    seed: state.seed,
    turn: input.turn,
    event: "spar" as const,
    degradedFrom,
    spiritStonesDelta: 0,
  };
  const participant = input.fighterProvider?.() ?? defaultFighter(state, rollBase, input.turn);
  if (!participant) {
    return {
      ...base,
      prestigeDelta: 0,
      moraleDelta: 0,
      notes: [
        {
          kind: "normal",
          text: degradedFrom
            ? "外出历练：掠夺因非宣战状态降级为切磋，然门中无人可出战，只得作罢。"
            : "外出历练：切磋因门中无人可出战，只得作罢。",
        },
      ],
    };
  }
  const opponent = input.opponentProvider();
  if (!opponent) {
    return {
      ...base,
      participantId: participant.id,
      participantName: participant.name,
      prestigeDelta: 0,
      moraleDelta: 0,
      notes: [
        {
          kind: "normal",
          text: degradedFrom
            ? "外出历练：掠夺因非宣战状态降级为切磋，然未遇可切磋之人，只得作罢。"
            : "外出历练：切磋未遇对手，只得作罢。",
        },
      ],
    };
  }
  const context = runExpeditionBattle(input, rollBase, participant, opponent);
  const winner = context.battle.winner;
  const prestigeDelta =
    winner === "A" ? SPAR_WIN_PRESTIGE : winner === "B" ? SPAR_LOSE_PRESTIGE : 0;
  const moraleDelta = winner === "A" ? SPAR_WIN_MORALE : winner === "B" ? SPAR_LOSE_MORALE : 0;
  const injury = ownInjury(context);
  const verdict =
    winner === "A"
      ? "胜之（声望 +2、士气 +1）"
      : winner === "B"
        ? "败下阵来（声望 −1、士气 −1）"
        : "战成平手";
  const notes: ExpeditionNote[] = [
    {
      kind: "normal",
      text: `外出历练切磋：${context.participant.name} 对阵 ${context.opponent.name}，${verdict}。`,
    },
  ];
  if (injury) {
    notes.push({
      kind: "warning",
      text: `${context.participant.name} 切磋负伤（${injury.kind === "heavy" ? "重伤" : "轻伤"}，禁战 ${injury.months} 月）。`,
    });
  }
  return {
    ...base,
    participantId: context.participant.id,
    participantName: context.participant.name,
    opponentId: context.opponent.id,
    opponentName: context.opponent.name,
    battle: context.battle,
    prestigeDelta,
    moraleDelta,
    injury,
    notes,
  };
}

function plunderReport(
  state: Readonly<GameState>,
  input: SettleExpeditionInput,
  rollBase: string,
): ExpeditionReport {
  if (!input.atWar) return sparReport(state, input, rollBase, "plunder");
  const participant = input.fighterProvider?.() ?? defaultFighter(state, rollBase, input.turn);
  const opponent = participant ? input.opponentProvider() : undefined;
  if (!participant || !opponent) {
    return {
      seed: state.seed,
      turn: input.turn,
      event: "plunder",
      spiritStonesDelta: 0,
      prestigeDelta: 0,
      moraleDelta: 0,
      notes: [{ kind: "normal", text: "外出历练掠夺：门中无人可出战或未遇对位弟子，无功而返。" }],
    };
  }
  const context = runExpeditionBattle(input, rollBase, participant, opponent);
  const winner = context.battle.winner;
  const spiritStonesDelta =
    winner === "A" ? rollInt(`${rollBase}:plunder`, PLUNDER_STONES_MIN, PLUNDER_STONES_MAX) : 0;
  const injury = ownInjury(context);
  const notes: ExpeditionNote[] = [
    {
      kind: "normal",
      text:
        winner === "A"
          ? `外出历练掠夺：${context.participant.name} 击败 ${context.opponent.name}，掠得灵石 ${spiritStonesDelta} 枚。`
          : winner === "B"
            ? `外出历练掠夺：${context.participant.name} 攻势受挫，被 ${context.opponent.name} 击退，无功而返。`
            : `外出历练掠夺：${context.participant.name} 与 ${context.opponent.name} 久战不下，各自收兵。`,
    },
  ];
  if (injury) {
    notes.push({
      kind: "warning",
      text: `${context.participant.name} 掠夺战败负伤（${injury.kind === "heavy" ? "重伤" : "轻伤"}，禁战 ${injury.months} 月）。`,
    });
  }
  return {
    seed: state.seed,
    turn: input.turn,
    event: "plunder",
    participantId: context.participant.id,
    participantName: context.participant.name,
    opponentId: context.opponent.id,
    opponentName: context.opponent.name,
    battle: context.battle,
    spiritStonesDelta,
    prestigeDelta: 0,
    moraleDelta: 0,
    injury,
    notes,
  };
}

// ─── 非战斗事件 ──────────────────────────────────────────────────────────

function harvestReport(
  state: Readonly<GameState>,
  input: SettleExpeditionInput,
  rollBase: string,
): ExpeditionReport {
  const amount = Math.round(
    rollInt(`${rollBase}:harvest`, HARVEST_STONES_MIN, HARVEST_STONES_MAX) * (1 + input.incomePct),
  );
  return {
    seed: state.seed,
    turn: input.turn,
    event: "harvest",
    spiritStonesDelta: amount,
    prestigeDelta: 0,
    moraleDelta: 0,
    notes: [{ kind: "normal", text: `外出历练：弟子于山野间寻得灵石 ${amount} 枚。` }],
  };
}

function windfallReport(
  state: Readonly<GameState>,
  input: SettleExpeditionInput,
  rollBase: string,
): ExpeditionReport {
  const library = state.library ?? { techniqueIds: [], spellIds: [] };
  const branchRoll = deterministicRoll(`${rollBase}:windfall`);
  let reward: ExpeditionReward;
  let rewardText: string;
  if (branchRoll < 34) {
    const candidates = TECHNIQUES.filter(
      (technique) => !library.techniqueIds.includes(technique.id),
    );
    const picked =
      candidates.length > 0
        ? candidates[pickIndex(`${rollBase}:windfall:book`, candidates.length)]
        : undefined;
    if (picked) {
      reward = { type: "gongfa_book", techniqueId: picked.id };
      rewardText = `偶得功法书《${picked.name}》，已送入藏经阁`;
    } else {
      const gear = rollGearReward(rollBase);
      reward = gear.reward;
      rewardText = gear.text;
    }
  } else if (branchRoll < 67) {
    const candidates = SPELLS.filter((spell) => !library.spellIds.includes(spell.id));
    const picked =
      candidates.length > 0
        ? candidates[pickIndex(`${rollBase}:windfall:book`, candidates.length)]
        : undefined;
    if (picked) {
      reward = { type: "spell_book", spellId: picked.id };
      rewardText = `偶得法术书《${picked.name}》，已送入藏经阁`;
    } else {
      const gear = rollGearReward(rollBase);
      reward = gear.reward;
      rewardText = gear.text;
    }
  } else {
    const gear = rollGearReward(rollBase);
    reward = gear.reward;
    rewardText = gear.text;
  }
  return {
    seed: state.seed,
    turn: input.turn,
    event: "windfall",
    spiritStonesDelta: 0,
    prestigeDelta: 0,
    moraleDelta: 0,
    reward,
    notes: [{ kind: "normal", text: `外出历练奇遇：${rewardText}。` }],
  };
}

function rollGearReward(rollBase: string): { reward: ExpeditionReward; text: string } {
  const slot = GEAR_SLOT_KEYS[
    pickIndex(`${rollBase}:windfall:gear-slot`, GEAR_SLOT_KEYS.length)
  ] as GearSlot;
  const tier: GearTier = deterministicRoll(`${rollBase}:windfall:gear-tier`) < 50 ? 1 : 2;
  return {
    reward: { type: "gear", slot, tier },
    text: `获赠${GEAR_SLOT_DISPLAY_NAMES[slot]}（档${tier}），已存入仓库`,
  };
}

function pillReport(
  state: Readonly<GameState>,
  input: SettleExpeditionInput,
  rollBase: string,
): ExpeditionReport {
  const pill = deterministicRoll(`${rollBase}:pill`) < 50 ? PILLS[0] : PILLS[1];
  if (!pill) throw new Error("pill_catalog_empty");
  return {
    seed: state.seed,
    turn: input.turn,
    event: "pill",
    spiritStonesDelta: 0,
    prestigeDelta: 0,
    moraleDelta: 0,
    reward: { type: "pill", pillId: pill.id },
    notes: [{ kind: "normal", text: `外出历练奇缘：途中偶得${pill.name}一枚，已存入仓库。` }],
  };
}

function dangerReport(
  state: Readonly<GameState>,
  input: SettleExpeditionInput,
  rollBase: string,
): ExpeditionReport {
  const participant = input.fighterProvider?.() ?? defaultFighter(state, rollBase, input.turn);
  const base = {
    seed: state.seed,
    turn: input.turn,
    event: "danger" as const,
    spiritStonesDelta: 0,
    prestigeDelta: 0,
    moraleDelta: 0,
  };
  if (!participant) {
    return {
      ...base,
      notes: [{ kind: "normal", text: "外出历练遇险：本月历练队伍无人出行，有惊无险。" }],
    };
  }
  const branch = injuryForRoll(deterministicRoll(`${rollBase}:danger`));
  if (branch === "none") {
    return {
      ...base,
      participantId: participant.id,
      participantName: participant.name,
      notes: [
        {
          kind: "normal",
          text: `外出历练遇险：${participant.name} 陷入险境，侥幸脱身，安然无恙。`,
        },
      ],
    };
  }
  const months = branch === "light" ? EXPEDITION_LIGHT_MONTHS : EXPEDITION_HEAVY_MONTHS;
  return {
    ...base,
    participantId: participant.id,
    participantName: participant.name,
    injury: { discipleId: participant.id, kind: branch, months },
    notes: [
      {
        kind: "warning",
        text: `外出历练遇险：${participant.name} 身受${branch === "heavy" ? "重" : "轻"}伤（禁战 ${months} 月）。`,
      },
    ],
  };
}

// ─── 主入口：宗门级月掷一次 ──────────────────────────────────────────────

export function settleExpedition(
  state: Readonly<GameState>,
  input: SettleExpeditionInput,
): ExpeditionReport {
  const rollBase = `${state.seed}:expedition:${input.turn}`;
  const event = expeditionEventForRoll(deterministicRoll(rollBase));
  switch (event) {
    case "harvest":
      return harvestReport(state, input, rollBase);
    case "spar":
      return sparReport(state, input, rollBase, undefined);
    case "plunder":
      return plunderReport(state, input, rollBase);
    case "windfall":
      return windfallReport(state, input, rollBase);
    case "danger":
      return dangerReport(state, input, rollBase);
    case "pill":
      return pillReport(state, input, rollBase);
  }
}
