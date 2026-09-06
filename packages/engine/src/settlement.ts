// 月度结算：灵石结转 → 方针 → 真元/突破 → 年度衰老坐化（顺序见设计文档 §月结流程）。
// 纯函数：输入 GameState 返回新 GameState（内部 structuredClone），同输入恒同输出。
import { deterministicRoll } from "./hash.js";
import { effectiveDeathAge } from "./lifespan.js";
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
import { POLICY_DISPLAY_NAMES } from "./state.js";
import {
  effectiveAttributes,
  talentsBreakthroughFlat,
  talentsLifespanFlat,
  talentsZhenyuanPct,
} from "./talents.js";

export const MORALE_HIGH_THRESHOLD = 70;
export const MORALE_LOW_THRESHOLD = 30;
export const MORALE_HIGH_ZHENYUAN_PCT = 0.1;
export const MORALE_LOW_ZHENYUAN_PCT = -0.1;
export const CULTIVATE_POLICY_ZHENYUAN_PCT = 0.3;
export const CULTIVATE_POLICY_SPIRIT_COST = 15;
export const EXPLORE_POLICY_SPIRIT_COST = 15;
export const EXPLORE_FIND_MIN = 50;
export const EXPLORE_FIND_RANGE = 100;
export const REST_POLICY_MORALE_DELTA = 5;
export const CRISIS_MORALE_PENALTY = 3;
export const DEATH_MORALE_PENALTY = 5;
export const BREAKTHROUGH_FAILURE_RATE_BONUS = 5;
export const CHRONICLE_LIMIT = 500;

export function monthlyZhenyuanGain(state: GameState, disciple: Disciple): number {
  const comprehension = effectiveAttributes(disciple.attributes, disciple.talentIds).comprehension;
  const moralePct =
    state.morale >= MORALE_HIGH_THRESHOLD
      ? MORALE_HIGH_ZHENYUAN_PCT
      : state.morale <= MORALE_LOW_THRESHOLD
        ? MORALE_LOW_ZHENYUAN_PCT
        : 0;
  const policyPct = state.policy === "cultivate" ? CULTIVATE_POLICY_ZHENYUAN_PCT : 0;
  const base = 10 + comprehension * 0.1;
  const rate = 1 + talentsZhenyuanPct(disciple.talentIds) + moralePct + policyPct;
  return Math.round(base * ROOT_MULTIPLIERS[disciple.rootType] * rate);
}

export function currentSuccessRate(disciple: Disciple, baseSuccessRate: number): number {
  return Math.min(
    100,
    baseSuccessRate +
      disciple.breakthroughFailures * BREAKTHROUGH_FAILURE_RATE_BONUS +
      talentsBreakthroughFlat(disciple.talentIds),
  );
}

function appendChronicle(state: GameState, entry: ChronicleEntry): void {
  state.chronicle.unshift(entry);
  if (state.chronicle.length > CHRONICLE_LIMIT) state.chronicle.length = CHRONICLE_LIMIT;
}

export type SettleMonthlyOutcome = {
  state: GameState;
  result: SettlementResult;
};

export function settleMonthly(
  stateInput: Readonly<GameState>,
  policy: MonthlyPolicy,
): SettleMonthlyOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const state = structuredClone(stateInput) as GameState;
  state.currentTurn += 1;
  state.policy = policy;
  const turn = state.currentTurn;

  const breakthroughs: BreakthroughEvent[] = [];
  const deaths: DeathEvent[] = [];
  const promotions: PromotionEvent[] = [];
  let spiritStonesDelta = 0;
  let moraleDelta = 0;
  let prestigeDelta = 0;

  // ① 灵石结转：外门供奉 + 内门俸禄。
  const outerCount = state.disciples.filter((disciple) => disciple.role === "outer").length;
  const innerCount = state.disciples.filter((disciple) => disciple.role === "inner").length;
  let income = outerCount * OUTER_INCOME_PER_DISCIPLE;
  if (policy === "develop") income += outerCount * DEVELOP_POLICY_EXTRA_INCOME_PER_OUTER;
  const expenses = innerCount * INNER_SALARY_PER_DISCIPLE;
  let crisis = false;

  // ② 资源危机：付不起俸禄时方针未执行、成本勾销、全门士气受挫。
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

    // ③ 方针效果。
    if (policy === "rest") {
      moraleDelta += REST_POLICY_MORALE_DELTA;
    } else if (policy === "explore") {
      moraleDelta -= 2;
      prestigeDelta += 1;
      const find =
        EXPLORE_FIND_MIN +
        Math.floor(deterministicRoll(`${state.seed}:explore:${turn}`) % EXPLORE_FIND_RANGE);
      spiritStonesDelta += find;
      state.spiritStones += find;
      appendChronicle(state, {
        turn,
        kind: "normal",
        text: `弟子外出历练，于山野间寻得灵石 ${find} 枚。`,
      });
    } else if (policy === "cultivate") {
      moraleDelta += 1;
    } else {
      moraleDelta += 1;
    }
  }

  state.morale = Math.min(100, Math.max(0, state.morale + moraleDelta));
  state.prestige = Math.max(0, state.prestige + prestigeDelta);

  // ④ 真元增长与突破判定（仅内门弟子修炼）。
  for (const disciple of state.disciples) {
    if (disciple.role !== "inner") continue;
    disciple.zhenyuan += monthlyZhenyuanGain(state, disciple);
    const stage = realmStageForLevel(disciple.realmLevel);
    if (disciple.zhenyuan < stage.requiredZhenyuan) continue;

    // 尝试突破：无论成败，真元清零重新积累。
    disciple.zhenyuan = 0;
    const successRate = currentSuccessRate(disciple, stage.baseSuccessRate);
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

  // ⑤ 年度衰老与坐化（第 12、24……月）。
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
  return { state, result };
}
