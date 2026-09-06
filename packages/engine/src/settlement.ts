// 月度结算（设计文档 §月结流程 9 步顺序锚点 MONTHLY_STEP_ORDER）：
// ① 灵石结转（供奉/俸禄/危机判定，资源长老供奉 +20%）
// ② 方针效果（闭关/经营/历练/休养；休养兼作伤势恢复 −2 月）
// ③ 真元增长与突破判定（功法/聚灵丹/养气诀/战备长老增益接线；岗位占用者不修炼）
// ④ 丹房/器坊点数与出炉（production.advanceWorkshops；旧档未启用生产时跳过以保持缺省口径）
// ⑤ 历练与遭遇事件（方针=外出历练时 settleExpedition；报告落账：灵石/声望/士气/纪事/伤势/掉落/战报）
// ⑥ NPC 宗门推进（E04-F02 接线点）
// ⑦ 会战结算（E04-F04 接线点）
// ⑧ 声望/士气落地与胜负判定（吞并/被吞并/凋敝由 E04-F04 接入）
// ⑨ 第 12 月：年度衰老与坐化（长老随坐化自动卸任）
// 纯函数：输入 GameState 返回新 GameState（内部 structuredClone），同输入恒同输出。
import { getTechniqueById } from "./catalog.js";
import { buildCombatProfile } from "./combat-profile.js";
import {
  type ExpeditionReport,
  type FighterProvider,
  type OpponentProvider,
  settleExpedition,
} from "./expedition.js";
import { deterministicRoll } from "./hash.js";
import { effectiveDeathAge } from "./lifespan.js";
import { advanceWorkshops } from "./production.js";
import { nextRealmStage, realmLifespanBonusForLevel, realmStageForLevel } from "./realms.js";
import { ROOT_MULTIPLIERS } from "./roots.js";
import {
  DEVELOP_POLICY_EXTRA_INCOME_PER_OUTER,
  INNER_SALARY_PER_DISCIPLE,
  OUTER_INCOME_PER_DISCIPLE,
} from "./sect.js";
import type {
  BreakthroughEvent,
  ChronicleEntry,
  DeathEvent,
  Disciple,
  GameState,
  MonthlyPolicy,
  PromotionEvent,
  SettlementResult,
} from "./state.js";
import { CRAFT_JOB_KINDS, POLICY_DISPLAY_NAMES } from "./state.js";
import { talentById } from "./talents.js";
import { talentsBreakthroughFlat, talentsLifespanFlat, talentsZhenyuanPct } from "./talents.js";

export const MORALE_HIGH_THRESHOLD = 70;
export const MORALE_LOW_THRESHOLD = 30;
export const MORALE_HIGH_ZHENYUAN_PCT = 0.1;
export const MORALE_LOW_ZHENYUAN_PCT = -0.1;
export const CULTIVATE_POLICY_ZHENYUAN_PCT = 0.3;
export const CULTIVATE_POLICY_SPIRIT_COST = 15;
export const EXPLORE_POLICY_SPIRIT_COST = 15;
export const REST_POLICY_MORALE_DELTA = 5;
export const CRISIS_MORALE_PENALTY = 3;
export const DEATH_MORALE_PENALTY = 5;
export const BREAKTHROUGH_FAILURE_RATE_BONUS = 5;
export const CHRONICLE_LIMIT = 500;

/** 资源长老：外门供奉 +20%（设计 §宗门体系 长老简版）。 */
export const RESOURCE_ELDER_OFFERING_PCT = 0.2;
/** 战备长老：全门突破成功率 +3（百分点）。 */
export const WAR_ELDER_BREAKTHROUGH_FLAT = 3;
/** 休养方针：所有伤势恢复月数 −2（设计 §伤势）。 */
export const REST_POLICY_INJURY_RECOVERY_MONTHS = 2;
/** 战报存档上限（最新在前；控制快照体积）。 */
export const BATTLE_LOG_LIMIT = 30;

/** 月结 9 步顺序锚点（T-E00-F04-001 golden 契约）：经济→方针→真元突破→生产→历练→NPC→会战→声望胜负→年度衰老。 */
export const MONTHLY_STEP_ORDER: readonly string[] = [
  "economy",
  "policy",
  "breakthrough",
  "production",
  "expedition",
  "rival",
  "sectWar",
  "verdict",
  "aging",
];

export type MonthlyStep = (typeof MONTHLY_STEP_ORDER)[number];

export type SettleMonthlyOptions = {
  /** 历练切磋/掠夺对位注入（E04-F02 接真实对手；缺省视为无对手，切磋/掠夺作罢）。 */
  opponentProvider?: OpponentProvider;
  /** 历练出战弟子注入（缺省按可出战内门弟子确定性选取）。 */
  fighterProvider?: FighterProvider;
  /** 宣战状态（E04-F02 落 state 后改为内部读取；此前由调用方传入）。 */
  atWar?: boolean;
};

export function monthlyZhenyuanGain(state: GameState, disciple: Disciple): number {
  // 有效五维（基础 + 天赋 + 功法 + 装备平加，clamp 后）由 combat-profile 统一聚合。
  const comprehension = buildCombatProfile(disciple).breakdown.attributes.effective.comprehension;
  const moralePct =
    state.morale >= MORALE_HIGH_THRESHOLD
      ? MORALE_HIGH_ZHENYUAN_PCT
      : state.morale <= MORALE_LOW_THRESHOLD
        ? MORALE_LOW_ZHENYUAN_PCT
        : 0;
  const policyPct = state.policy === "cultivate" ? CULTIVATE_POLICY_ZHENYUAN_PCT : 0;
  const techniquePct = disciple.techniqueId
    ? (getTechniqueById(disciple.techniqueId)?.effect.zhenyuanPct ?? 0)
    : 0;
  const base = 10 + comprehension * 0.1;
  const rate = 1 + talentsZhenyuanPct(disciple.talentIds) + techniquePct + moralePct + policyPct;
  const gain = Math.round(base * ROOT_MULTIPLIERS[disciple.rootType] * rate);
  const focusUntil = disciple.spiritFocusUntilTurn;
  // 聚灵丹：持续期内真元获取 ×1.5（不叠加、重复服用刷新时长）。
  return focusUntil !== undefined && focusUntil >= state.currentTurn
    ? Math.round(gain * 1.5)
    : gain;
}

export function currentSuccessRate(
  disciple: Disciple,
  baseSuccessRate: number,
  extraFlat = 0,
): number {
  const techniqueFlat = disciple.techniqueId
    ? (getTechniqueById(disciple.techniqueId)?.effect.breakthroughFlat ?? 0)
    : 0;
  return Math.min(
    100,
    baseSuccessRate +
      disciple.breakthroughFailures * BREAKTHROUGH_FAILURE_RATE_BONUS +
      talentsBreakthroughFlat(disciple.talentIds) +
      techniqueFlat +
      extraFlat,
  );
}

function appendChronicle(state: GameState, entry: ChronicleEntry): void {
  state.chronicle.unshift(entry);
  if (state.chronicle.length > CHRONICLE_LIMIT) state.chronicle.length = CHRONICLE_LIMIT;
}

/** 岗位/长老占用者：不战斗、不修炼。 */
function jobHolderIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  if (state.jobs) {
    for (const kind of CRAFT_JOB_KINDS) {
      for (const workerId of state.jobs[kind].workers) ids.add(workerId);
    }
  }
  if (state.elders?.resource) ids.add(state.elders.resource);
  if (state.elders?.war) ids.add(state.elders.war);
  return ids;
}

/** 历练灵石收益加成：取全宗弟子中天赋 incomePct 聚合最高者（宗门级收获按最强福缘计）。 */
function maxIncomePct(state: GameState): number {
  let max = 0;
  for (const disciple of state.disciples) {
    let sum = 0;
    for (const id of disciple.talentIds) sum += talentById(id)?.effect.incomePct ?? 0;
    if (sum > max) max = sum;
  }
  return max;
}

/** 历练报告落账：灵石/声望/士气、纪事、伤势、掉落入库入阁、战报存档。 */
function applyExpeditionReport(
  state: GameState,
  report: ExpeditionReport,
  turn: number,
  acc: {
    spiritStonesDelta: number;
    moraleDelta: number;
    prestigeDelta: number;
  },
): void {
  if (report.spiritStonesDelta !== 0) {
    state.spiritStones += report.spiritStonesDelta;
    acc.spiritStonesDelta += report.spiritStonesDelta;
  }
  if (report.moraleDelta !== 0) {
    acc.moraleDelta += report.moraleDelta;
    state.morale = Math.min(100, Math.max(0, state.morale + report.moraleDelta));
  }
  if (report.prestigeDelta !== 0) {
    acc.prestigeDelta += report.prestigeDelta;
    state.prestige = Math.max(0, state.prestige + report.prestigeDelta);
  }
  for (const note of report.notes) {
    appendChronicle(state, { turn, kind: note.kind, text: note.text });
  }
  if (report.injury) {
    const disciple = state.disciples.find((entry) => entry.id === report.injury?.discipleId);
    if (disciple) {
      disciple.injury = {
        kind: report.injury.kind === "heavy" ? "severe" : "light",
        untilTurn: turn + report.injury.months,
      };
    }
  }
  const reward = report.reward;
  if (reward) {
    if (reward.type === "gongfa_book") {
      state.library ??= { techniqueIds: [], spellIds: [] };
      if (!state.library.techniqueIds.includes(reward.techniqueId)) {
        state.library.techniqueIds.push(reward.techniqueId);
      }
    } else if (reward.type === "spell_book") {
      state.library ??= { techniqueIds: [], spellIds: [] };
      if (!state.library.spellIds.includes(reward.spellId)) {
        state.library.spellIds.push(reward.spellId);
      }
    } else if (reward.type === "gear") {
      state.warehouse ??= { gear: [], pills: [] };
      state.warehouse.gear.push({ slot: reward.slot, tier: reward.tier });
    } else {
      state.warehouse ??= { gear: [], pills: [] };
      const stock = state.warehouse.pills.find((entry) => entry.pillId === reward.pillId);
      if (stock) stock.count += 1;
      else state.warehouse.pills.push({ pillId: reward.pillId, count: 1 });
    }
  }
  if (report.battle) {
    state.battles = [report.battle.report, ...(state.battles ?? [])].slice(0, BATTLE_LOG_LIMIT);
  }
}

/** 长老随坐化自动卸任（步骤 ⑨）。 */
function cleanupDeceasedElders(state: GameState): void {
  if (!state.elders) return;
  const alive = new Set(state.disciples.map((disciple) => disciple.id));
  if (state.elders.resource && !alive.has(state.elders.resource)) state.elders.resource = undefined;
  if (state.elders.war && !alive.has(state.elders.war)) state.elders.war = undefined;
}

export type SettleMonthlyOutcome = {
  state: GameState;
  result: SettlementResult;
};

export function settleMonthly(
  stateInput: Readonly<GameState>,
  policy: MonthlyPolicy,
  options: SettleMonthlyOptions = {},
): SettleMonthlyOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  let state = structuredClone(stateInput) as GameState;
  state.currentTurn += 1;
  state.policy = policy;
  const turn = state.currentTurn;

  const breakthroughs: BreakthroughEvent[] = [];
  const deaths: DeathEvent[] = [];
  const promotions: PromotionEvent[] = [];
  let spiritStonesDelta = 0;
  let moraleDelta = 0;
  let prestigeDelta = 0;

  // ① 灵石结转：外门供奉（资源长老 +20%）+ 经营方针额外供奉 − 内门俸禄。
  const outerCount = state.disciples.filter((disciple) => disciple.role === "outer").length;
  const innerCount = state.disciples.filter((disciple) => disciple.role === "inner").length;
  const offeringMultiplier = state.elders?.resource ? 1 + RESOURCE_ELDER_OFFERING_PCT : 1;
  let income = Math.round(outerCount * OUTER_INCOME_PER_DISCIPLE * offeringMultiplier);
  if (policy === "develop") income += outerCount * DEVELOP_POLICY_EXTRA_INCOME_PER_OUTER;
  const expenses = innerCount * INNER_SALARY_PER_DISCIPLE;
  let crisis = false;

  // ① 资源危机：付不起俸禄时方针未执行、成本勾销、全门士气受挫。
  const policyCost =
    policy === "cultivate" || policy === "explore"
      ? policy === "cultivate"
        ? CULTIVATE_POLICY_SPIRIT_COST
        : EXPLORE_POLICY_SPIRIT_COST
      : 0;
  if (state.spiritStones + income - expenses - policyCost < 0) {
    crisis = true;
    moraleDelta -= CRISIS_MORALE_PENALTY;
    appendChronicle(state, {
      turn,
      kind: "warning",
      text: `宗门灵石见底，本月「${POLICY_DISPLAY_NAMES[policy]}」未能执行，俸禄一笔勾销，弟子人心浮动。`,
    });
  } else {
    spiritStonesDelta += income - expenses - policyCost;
    state.spiritStones += income - expenses - policyCost;

    // ② 方针效果（历练的遭遇事件在第 ⑤ 步触发）。
    if (policy === "rest") {
      moraleDelta += REST_POLICY_MORALE_DELTA;
      // 休养生息：所有伤势恢复月数 −2（不超过当月，次月起可出战）。
      for (const disciple of state.disciples) {
        if (!disciple.injury) continue;
        disciple.injury = {
          kind: disciple.injury.kind,
          untilTurn: Math.max(turn, disciple.injury.untilTurn - REST_POLICY_INJURY_RECOVERY_MONTHS),
        };
      }
    } else if (policy === "explore") {
      moraleDelta -= 2;
      prestigeDelta += 1;
    } else {
      moraleDelta += 1;
    }
  }

  state.morale = Math.min(100, Math.max(0, state.morale + moraleDelta));
  state.prestige = Math.max(0, state.prestige + prestigeDelta);

  // ③ 真元增长与突破判定（仅内门弟子修炼；岗位/长老占用者不修炼）。
  const occupied = jobHolderIds(state);
  const warElderFlat = state.elders?.war ? WAR_ELDER_BREAKTHROUGH_FLAT : 0;
  for (const disciple of state.disciples) {
    if (disciple.role !== "inner") continue;
    if (occupied.has(disciple.id)) continue;
    disciple.zhenyuan += monthlyZhenyuanGain(state, disciple);
    const stage = realmStageForLevel(disciple.realmLevel);
    if (disciple.zhenyuan < stage.requiredZhenyuan) continue;

    // 尝试突破：无论成败，真元清零重新积累。
    disciple.zhenyuan = 0;
    const successRate = currentSuccessRate(disciple, stage.baseSuccessRate, warElderFlat);
    const roll = deterministicRoll(`${state.seed}:breakthrough:${disciple.id}:${turn}`);
    if (roll >= successRate) {
      disciple.breakthroughFailures += 1;
      breakthroughs.push({
        discipleId: disciple.id,
        discipleName: disciple.name,
        outcome: "failure",
        fromRealmLevel: disciple.realmLevel,
        successRate,
      });
      continue;
    }
    disciple.breakthroughFailures = 0;
    const next = nextRealmStage(disciple.realmLevel);
    if (!next) {
      // 元婴前期圆满再突破 → 飞升结局。
      appendChronicle(state, {
        turn,
        kind: "milestone",
        text: `${disciple.name} 于元婴前期圆满，突破最后一道天堑，白日飞升而去！`,
      });
      state.ending = {
        kind: "ascension",
        turn,
        text: `${state.sectName}门下 ${disciple.name} 飞升仙界，宗门就此名留仙史。`,
      };
      breakthroughs.push({
        discipleId: disciple.id,
        discipleName: disciple.name,
        outcome: "ascended",
        fromRealmLevel: disciple.realmLevel,
        successRate,
      });
      break;
    }
    const previousBonus = realmLifespanBonusForLevel(disciple.realmLevel);
    disciple.realm = next.realm;
    disciple.realmLevel = next.level;
    breakthroughs.push({
      discipleId: disciple.id,
      discipleName: disciple.name,
      outcome: "success",
      fromRealmLevel: stage.level,
      toRealmLevel: next.level,
      successRate,
    });
    appendChronicle(state, {
      turn,
      kind: "milestone",
      text: `${disciple.name} 突破至${next.name}！`,
    });
    // 新境界寿元加成实时生效（差额累加）。
    const bonusDelta = realmLifespanBonusForLevel(disciple.realmLevel) - previousBonus;
    if (bonusDelta > 0) {
      appendChronicle(state, {
        turn,
        kind: "normal",
        text: `境界跃升，${disciple.name} 寿元大增（+${bonusDelta} 年）。`,
      });
    }
  }

  // ④ 丹房/器坊点数与出炉（旧档未启用生产时跳过，保持扩展字段缺省口径）。
  // ⑤ 历练与遭遇事件（方针=外出历练且未危机时；资源危机月方针未执行故无遭遇）。
  // 飞升当月终局已定（第 ③ 步），后续生产与历练不再执行。
  let expeditionReport: ExpeditionReport | undefined;
  if (!state.ending) {
    if (state.jobs) {
      state = advanceWorkshops(state).state;
    }
    if (policy === "explore" && !crisis) {
      expeditionReport = settleExpedition(state, {
        turn,
        atWar: options.atWar ?? false,
        incomePct: maxIncomePct(state),
        opponentProvider: options.opponentProvider ?? (() => undefined),
        fighterProvider: options.fighterProvider,
      });
      const acc = { spiritStonesDelta, moraleDelta, prestigeDelta };
      applyExpeditionReport(state, expeditionReport, turn, acc);
      spiritStonesDelta = acc.spiritStonesDelta;
      moraleDelta = acc.moraleDelta;
      prestigeDelta = acc.prestigeDelta;
    }
  }

  // ⑥ NPC 宗门推进（E04-F02 接线点）。
  // ⑦ 会战结算（E04-F04 接线点）。
  // ⑧ 声望/士气落地与胜负判定：声望/士气已随方针与历练落账；吞并/被吞并/凋敝判定由 E04-F04 接入。

  // ⑨ 第 12 月：年度衰老与坐化。
  if (turn % 12 === 0) {
    for (const disciple of state.disciples) disciple.age += 1;
    const deceased = state.disciples.filter(
      (disciple) =>
        disciple.age >= effectiveDeathAge(disciple, talentsLifespanFlat(disciple.talentIds)),
    );
    if (deceased.length > 0) {
      const deceasedIds = new Set(deceased.map((disciple) => disciple.id));
      state.disciples = state.disciples.filter((disciple) => !deceasedIds.has(disciple.id));
      for (const dead of deceased) {
        deaths.push({ discipleId: dead.id, discipleName: dead.name, age: dead.age });
        state.fallen.unshift({ name: dead.name, diedTurn: turn });
        appendChronicle(state, {
          turn,
          kind: "warning",
          text: `${dead.name} 寿元耗尽，坐化仙逝，享年 ${dead.age} 岁。`,
        });
      }
      moraleDelta -= deceased.length * DEATH_MORALE_PENALTY;
      state.morale = Math.max(0, state.morale - deceased.length * DEATH_MORALE_PENALTY);
      cleanupDeceasedElders(state);

      // 补员：仅补齐内门坐化空出的席位，从外门最强者（按实力等级、真元排序）依次递补。
      const innerDeaths = deceased.filter((dead) => dead.role === "inner").length;
      let promoted = 0;
      while (
        promoted < innerDeaths &&
        state.disciples.some((disciple) => disciple.role === "outer")
      ) {
        const strongest = state.disciples
          .filter((disciple) => disciple.role === "outer")
          .sort(
            (a, b) =>
              b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan || a.id.localeCompare(b.id),
          )[0];
        if (!strongest) break;
        strongest.role = "inner";
        promoted += 1;
        promotions.push({
          discipleId: strongest.id,
          discipleName: strongest.name,
          from: "outer",
          to: "inner",
        });
        appendChronicle(state, {
          turn,
          kind: "normal",
          text: `外门弟子 ${strongest.name} 因同门仙逝递补入内门。`,
        });
      }
    }
  }

  const result: SettlementResult = {
    turn,
    policy,
    crisis,
    spiritStonesDelta,
    moraleDelta,
    prestigeDelta,
    breakthroughs,
    deaths,
    promotions,
  };
  if (expeditionReport) result.expedition = expeditionReport;
  return { state, result };
}
