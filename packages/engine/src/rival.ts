// NPC 对手宗门（设计文档 §NPC 对手宗门 D-015 / §月度运行时 D-016 / §两宗对抗 D-017）。
// 生成与月度运行时（E04-F01）+ 宣战判定与相遇接线（E04-F02）。
// 纯函数、确定性：弟子用与玩家同一 generateDisciple 生成器（seed 命名空间 ":rival"），
// 掷骰一律 sha256（hash.deterministicRoll），禁 Math.random；同 seed 双跑恒等。
// NPC 不服丹、不研读功法法术（装备即战力）；难度 ×0.8/1.0/1.2 作用于真元收益与招募频率。
import { generateDisciple } from "./generation.js";
import { deterministicRoll } from "./hash.js";
import { nextRealmStage, realmStageForLevel } from "./realms.js";
import { RECRUIT_COST, sectLimitsFor, upgradeRequirementFor } from "./sect.js";
import { currentSuccessRate, monthlyZhenyuanGain } from "./settlement.js";
import type { Disciple, GameState } from "./state.js";

// ─── 生成参数（设计 §NPC 对手宗门：开局与玩家同为 1 级宗门）──────────────

export const RIVAL_INITIAL_INNER_DISCIPLES = 3;
export const RIVAL_INITIAL_OUTER_DISCIPLES = 20;
/** NPC 亦按内门俸禄口径支付掌门俸禄（经济简算：外门供奉 − 内门俸禄 − 招募费）。 */
export const RIVAL_LEADER_EXTRA_INNER = 1;

/** 难度三档：发展速度倍率（作用于 NPC 月度真元收益与招募频率）。 */
export const RIVAL_DIFFICULTY_MULTIPLIERS = [0.8, 1, 1.2] as const;
export type RivalDifficulty = (typeof RIVAL_DIFFICULTY_MULTIPLIERS)[number];

/** 装备按宗门等级自动配最强档（1 级→档 1 / 2 级→档 2 / 3 级→档 3，不出档 4）。 */
export function rivalGearTierForRank(rank: 1 | 2 | 3): 1 | 2 | 3 {
  return Math.min(rank, 3) as 1 | 2 | 3;
}

/** RivalSect：对手宗门快照（与 GameState 同帧推进；UI 情报页直接消费）。 */
export type RivalSect = {
  /** 生成种子（与玩家同 seed；派生命名空间 ":rival" 区隔）。 */
  seed: string;
  name: string;
  /** 发展速度倍率（0.8 / 1 / 1.2）。 */
  difficulty: number;
  sectRank: 1 | 2 | 3;
  spiritStones: number;
  prestige: number;
  morale: number;
  leaderId: string;
  /** 对手弟子编号单调计数（id 与取名 ordinal）。 */
  discipleSeq: number;
  disciples: Disciple[];
  /** 招募频率小数配额结转（rivalRecruitPlan 消费）。 */
  recruitCarry: number;
};

/** NPC 宗门名（未显式指定时按 seed 确定性选取）。 */
const RIVAL_SECT_NAMES = [
  "玄阴宗",
  "血刀门",
  "万剑宗",
  "幽冥谷",
  "赤炎派",
  "天魔教",
  "紫雷阁",
  "白骨宗",
] as const;

/**
 * 创建 NPC 对手宗门：掌门 1 + 内门 3 + 外门 20，1 级宗门、灵石 2000、士气 70、声望 50。
 * 弟子用与玩家同一生成器（同一 seed 命名空间下不重名）；内门按当前等级自动配最强装备档。
 */
export function createRivalSect(input: {
  seed: string;
  name?: string;
  difficulty: number;
}): RivalSect {
  const seed = input.seed.trim();
  if (seed.length === 0 || seed.length > 128) throw new Error("rival_seed_invalid");
  if (!RIVAL_DIFFICULTY_MULTIPLIERS.includes(input.difficulty as RivalDifficulty)) {
    throw new Error("rival_difficulty_invalid");
  }
  const name =
    input.name ??
    RIVAL_SECT_NAMES[
      Math.floor((deterministicRoll(`${seed}:rival-name`) / 100) * RIVAL_SECT_NAMES.length)
    ] ??
    "玄阴宗";

  const rival: RivalSect = {
    seed,
    name,
    difficulty: input.difficulty,
    sectRank: 1,
    spiritStones: 2000,
    prestige: 50,
    morale: 70,
    leaderId: "r-1",
    discipleSeq: 0,
    disciples: [],
    recruitCarry: 0,
  };

  const usedNames: string[] = [];
  const spawn = (age: number, role: Disciple["role"]) => {
    rival.discipleSeq += 1;
    const disciple = generateDisciple({
      gameSeed: `${seed}:rival`,
      discipleId: `r-${rival.discipleSeq}`,
      ordinal: rival.discipleSeq,
      usedNames,
      age,
      role,
    });
    usedNames.push(disciple.name);
    rival.disciples.push(disciple);
  };

  // 掌门 + 内门（起始年龄略长于玩家新收弟子，体现老牌宗门底蕴）。
  spawn(24, "inner");
  for (const age of [21, 19, 17]) spawn(age, "inner");
  for (let i = 0; i < RIVAL_INITIAL_OUTER_DISCIPLES; i++) spawn(16, "outer");

  equipRivalInner(rival);
  return rival;
}

/** 内门弟子按当前宗门等级重配最强装备档（升阶后自动换装；外门不战斗不配装）。 */
function equipRivalInner(rival: RivalSect): void {
  const tier = rivalGearTierForRank(rival.sectRank);
  for (const disciple of rival.disciples) {
    if (disciple.role !== "inner") continue;
    disciple.equippedGear = { weapon: tier, armor: tier, accessory: tier, talisman: tier };
  }
}

// ─── 招募频率：难度小数配额进位（0.8 → 月均 0.8 次 / 1.2 → 月均 1.2 次）──

export type RivalRecruitPlan = { recruits: number; carryOut: number };

/** 配额进位：carryIn + difficulty 的整数部分为本月招募数，小数部分结转（0.1 精度取整避免浮尘）。 */
export function rivalRecruitPlan(difficulty: number, carryIn: number): RivalRecruitPlan {
  const total = Math.round((carryIn + difficulty) * 10) / 10;
  const recruits = Math.floor(total);
  const carryOut = Math.round((total - recruits) * 10) / 10;
  return { recruits, carryOut };
}

// ─── 月度运行时（与玩家月结同帧推进；纯函数返回新 RivalSect）────────────

/**
 * NPC 月度推进：① 经济简算（外门供奉 − 内门俸禄）→ ② 内门真元/突破（同玩家公式 ×难度）
 * → ③ 升阶条件满足自动升阶（并按新等级重配装备）→ ④ 按频率招募外门（灵石充足时，300/人）。
 * NPC 不服丹、不研读、不做衰老坐化（设计 §月度运行时 未列；寿元字段仅作数据扩展位）。
 */
export function advanceRivalSectMonthly(rivalInput: Readonly<RivalSect>, turn: number): RivalSect {
  const rival = structuredClone(rivalInput) as RivalSect;

  // ① 经济简算：外门供奉 = 外门人数 × 2；内门俸禄 = 内门人数（含掌门）× 10。
  const outerCount = rival.disciples.filter((disciple) => disciple.role === "outer").length;
  const innerCount = rival.disciples.filter((disciple) => disciple.role === "inner").length;
  rival.spiritStones += outerCount * 2 - innerCount * 10;

  // ② 内门真元与突破（与玩家同一公式；难度倍率作用于月度真元收益）。
  for (const disciple of rival.disciples) {
    if (disciple.role !== "inner") continue;
    const gain = monthlyZhenyuanGain({ morale: rival.morale } as GameState, disciple);
    disciple.zhenyuan += Math.round(gain * rival.difficulty);
    const stage = realmStageForLevel(disciple.realmLevel);
    if (disciple.zhenyuan < stage.requiredZhenyuan) continue;

    // 尝试突破：无论成败，真元清零重新积累（同玩家规则）。
    disciple.zhenyuan = 0;
    const successRate = currentSuccessRate(disciple, stage.baseSuccessRate);
    const roll = deterministicRoll(`${rival.seed}:rival-breakthrough:${disciple.id}:${turn}`);
    if (roll >= successRate) {
      disciple.breakthroughFailures += 1;
      continue;
    }
    disciple.breakthroughFailures = 0;
    const next = nextRealmStage(disciple.realmLevel);
    if (!next) continue; // NPC 至元婴前期圆满后止步（飞升为玩家专属结局）。
    disciple.realm = next.realm;
    disciple.realmLevel = next.level;
  }

  // ③ 升阶条件满足自动升阶（与玩家同表：筑基+5000 / 金丹×3+30000）。
  const requirement = upgradeRequirementFor(rival.sectRank);
  if (requirement) {
    const minRealmLevel = requirement.minRealmLevel;
    const goldenCoreCount = requirement.goldenCoreCount;
    const stonesEnough = rival.spiritStones >= requirement.cost;
    const realmEnough =
      minRealmLevel !== undefined
        ? rival.disciples.some(
            (disciple) => disciple.role === "inner" && disciple.realmLevel >= minRealmLevel,
          )
        : true;
    const goldenCoreEnough =
      goldenCoreCount !== undefined
        ? rival.disciples.filter(
            (disciple) =>
              disciple.role === "inner" && disciple.realmLevel >= realmStageForLevel(7).level,
          ).length >= goldenCoreCount
        : true;
    if (stonesEnough && realmEnough && goldenCoreEnough) {
      rival.spiritStones -= requirement.cost;
      rival.sectRank = (rival.sectRank + 1) as RivalSect["sectRank"];
      equipRivalInner(rival);
    }
  }

  // ④ 招募：频率配额进位；单次招募需灵石充足（300/人），不足则放弃当月余量。
  const plan = rivalRecruitPlan(rival.difficulty, rival.recruitCarry);
  rival.recruitCarry = plan.carryOut;
  const usedNames = rival.disciples.map((disciple) => disciple.name);
  // 外门容量按宗门等级约束（设计 §宗门体系：100/300/500），满员则放弃当月余量。
  const outerCapacity = sectLimitsFor(rival.sectRank).outerLimit;
  let currentOuter = rival.disciples.filter((disciple) => disciple.role === "outer").length;
  for (let i = 0; i < plan.recruits; i++) {
    if (rival.spiritStones < RECRUIT_COST) break;
    if (currentOuter >= outerCapacity) break;
    rival.spiritStones -= RECRUIT_COST;
    rival.discipleSeq += 1;
    const disciple = generateDisciple({
      gameSeed: `${rival.seed}:rival`,
      discipleId: `r-${rival.discipleSeq}`,
      ordinal: rival.discipleSeq,
      usedNames,
      role: "outer",
    });
    usedNames.push(disciple.name);
    rival.disciples.push(disciple);
    currentOuter += 1;
  }

  return rival;
}

// ─── 情报读模型（设计 §NPC 对手宗门：对方名册/境界/伤势常驻可见）─────────

export type RivalRosterEntry = {
  id: string;
  name: string;
  /** 境界等级（阶段名）。 */
  realm: string;
  /** 实力等级（level 数值）。 */
  realmLevel: number;
  isLeader: boolean;
  injured: boolean;
};

export function rivalRosterView(rival: Readonly<RivalSect>, turn: number): RivalRosterEntry[] {
  return rival.disciples.map((disciple) => ({
    id: disciple.id,
    name: disciple.name,
    realm: disciple.realm,
    realmLevel: disciple.realmLevel,
    isLeader: disciple.id === rival.leaderId,
    injured: Boolean(disciple.injury && disciple.injury.untilTurn >= turn),
  }));
}

// ─── 宣战判定（E04-F02：设计 §两宗对抗）─────────────────────────────────

/** NPC 宣战概率：15%/月。 */
export const WAR_DECLARE_ROLL_PCT = 15;
/** 声望差阈值：NPC 声望领先玩家 >50 时起意。 */
export const WAR_PRESTIGE_GAP_THRESHOLD = 50;
/** 会战结算后冷却 12 个月（自宣战月起算）。 */
export const WAR_COOLDOWN_MONTHS = 12;

export type RivalWarDecisionInput = {
  /** 当月掷骰结果（[0,100)）。 */
  roll: number;
  /** NPC 声望 − 玩家声望。 */
  prestigeGap: number;
  /** NPC 宗门等级是否更高。 */
  rivalLevelHigher: boolean;
};

/** NPC 宣战判定：掷骰 < 15 且（声望差 >50 或其等级更高）。 */
export function rivalWarDecision(input: RivalWarDecisionInput): boolean {
  return (
    input.roll < WAR_DECLARE_ROLL_PCT &&
    (input.prestigeGap > WAR_PRESTIGE_GAP_THRESHOLD || input.rivalLevelHigher)
  );
}

/** NPC 当月是否宣战（settlement 第 ⑥ 步消费；掷骰 seed 契约：`${seed}:rival-war:${turn}`）。 */
export function rivalWarRollForTurn(seed: string, turn: number): number {
  return deterministicRoll(`${seed}:rival-war:${turn}`);
}

/** 战争冷却是否已结束（currentTurn ≥ warCooldownEndsTurn；无记录视为无冷却）。 */
export function warCooldownEnded(state: Readonly<GameState>): boolean {
  if (!state.warCooldownEndsTurn) return true;
  return state.currentTurn >= state.warCooldownEndsTurn;
}

/** 玩家当前可否宣战：未终局、未开战、冷却已过、对手存在（设计：玩家可随时宣战，冷却期拒绝）。 */
export function canPlayerDeclareWar(state: Readonly<GameState>): boolean {
  return !state.ending && !state.warWithRival && warCooldownEnded(state) && Boolean(state.rival);
}

/** 玩家宣战：进入战争状态，会战于次月月结第 ⑦ 步触发；战后 12 个月冷却（自宣战月起算）。 */
export function declareWar(stateInput: Readonly<GameState>): GameState {
  if (!canPlayerDeclareWar(stateInput)) {
    if (stateInput.ending) throw new Error("game_already_ended");
    if (stateInput.warWithRival) throw new Error("war_already_declared");
    if (!stateInput.rival) throw new Error("rival_missing");
    throw new Error("war_cooldown_active");
  }
  const state = structuredClone(stateInput) as GameState;
  state.warWithRival = true;
  state.warDeclaredTurn = state.currentTurn;
  state.chronicle.unshift({
    turn: state.currentTurn,
    kind: "milestone",
    text: `${state.sectName} 向${state.rival?.name ?? "对手宗门"}宣战！来月会战一见高下。`,
  });
  return state;
}

// ─── 声望规则（设计 §声望 D-019；golden 契约见 rival.test.ts）────────────
// 历练 +1 由月结方针承担；切磋 +2/−1（平 0）；会战 ±10；
// 大境界突破（进入 4/7/10 级）+3；下限 0、无月度消退。

/** 大境界突破的实力等级节点（进入 4/7/10 级时声望 +3）。 */
export const MAJOR_BREAKTHROUGH_LEVELS = [4, 7, 10] as const;
export const MAJOR_BREAKTHROUGH_PRESTIGE = 3;

/** 大境界突破声望加成：进入 4/7/10 级 +3，其余 0。 */
export function prestigeDeltaForMajorBreakthrough(realmLevel: number): number {
  return (MAJOR_BREAKTHROUGH_LEVELS as readonly number[]).includes(realmLevel)
    ? MAJOR_BREAKTHROUGH_PRESTIGE
    : 0;
}

export type SparResult = "win" | "lose" | "draw";

/** 切磋声望奖惩：胜 +2 / 败 −1 / 平 0（士气 ±1 由事件表另行结算）。 */
export function prestigeDeltaForSpar(result: SparResult): number {
  return result === "win" ? 2 : result === "lose" ? -1 : 0;
}

/** 会战声望变动：胜 +10 / 败 −10。 */
export function prestigeDeltaForSectWar(won: boolean): number {
  return won ? 10 : -10;
}

/** 声望落地：下限 0（无月度消退）。 */
export function applyPrestigeDelta(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

// ─── 相遇接线（E04-F02：历练切磋/掠夺的对位注入）────────────────────────

/**
 * 从对手宗门确定性选取一名可出战内门弟子（切磋/掠夺对位；掷骰 seed 由调用方传入）。
 * 可出战 = 内门（含掌门）且伤势已愈（与玩家 combatReadyDisciples 同一口径）。
 */
export function pickRivalOpponent(
  rival: Readonly<RivalSect>,
  rollSeed: string,
  turn: number,
): Disciple | undefined {
  const eligible = rival.disciples.filter(
    (disciple) =>
      disciple.role === "inner" && !(disciple.injury && disciple.injury.untilTurn >= turn),
  );
  if (eligible.length === 0) return undefined;
  const index = Math.floor((deterministicRoll(rollSeed) / 100) * eligible.length);
  return eligible[index] ?? eligible[0];
}
