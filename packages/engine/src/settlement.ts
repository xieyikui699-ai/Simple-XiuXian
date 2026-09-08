// 月度结算（设计文档 §月结流程 8 步顺序锚点 MONTHLY_STEP_ORDER）：
// ① 灵石结转（供奉/俸禄/危机判定，资源长老供奉 +20%；外门总数恒等于宗门等级上限）
// ② 真元增长与突破判定（功法/聚灵丹/养气诀/战备长老增益接线；岗位占用者不修炼）
// ③ 丹房/器坊点数与出炉（production.advanceWorkshops；旧档未启用生产时跳过以保持缺省口径）
// ④ 历练与遭遇事件（每月自动进行 settleExpedition；报告落账：灵石/声望/士气/纪事/伤势/掉落/战报）
// ⑤ NPC 宗门推进（E04-F02 接线：advanceRivalSectMonthly 同帧推进 + NPC 宣战判定）
// ⑥ 会战结算（E04-F03/F04 接线：宣战次月 runSectWar）
// ⑦ 声望/士气落地与胜负判定（E04-F04：吞并/被吞并/凋敝终局 + 仙途评级）
// ⑧ 第 12 月：年度衰老与坐化（长老随坐化自动卸任）
// 纯函数：输入 GameState 返回新 GameState（内部 structuredClone），同输入恒同输出。
import type { BattleReport } from "./battle.js";
import { MAX_SPELLS_PER_DISCIPLE, SPELLS, type Spell, getTechniqueById } from "./catalog.js";
import { buildCombatProfile } from "./combat-profile.js";
import {
  type ExpeditionReport,
  type FighterProvider,
  type OpponentProvider,
  settleExpedition,
} from "./expedition.js";
import { generateDisciple } from "./generation.js";
import { deterministicRoll } from "./hash.js";
import { effectiveDeathAge } from "./lifespan.js";
import {
  OUTER_MINING_STONES_PER_MONTH,
  OUTER_QI_ZHENYUAN_PER_WORKER,
  effectiveOuterJobsOf,
} from "./outer-jobs.js";
import { advanceWorkshops } from "./production.js";
import {
  TOP_REALM_LEVEL,
  lifespanIncreaseForRealmLevel,
  nextRealmStage,
  realmStageForLevel,
} from "./realms.js";
import {
  WAR_COOLDOWN_MONTHS,
  advanceRivalSectMonthly,
  applyPrestigeDelta,
  pickRivalOpponent,
  prestigeDeltaForMajorBreakthrough,
  rivalWarDecision,
  rivalWarRollForTurn,
  warCooldownEnded,
} from "./rival.js";
import { ROOT_MULTIPLIERS } from "./roots.js";
import {
  SECT_WAR_FIGHTERS,
  type SectWarRecord,
  type WarEligibleDisciple,
  injuryMonthsLeftFor,
  isWarEligible,
  runSectWar,
  sectWarRecord,
  selectSectWarFighters,
} from "./sect-war.js";
import {
  INNER_SALARY_PER_DISCIPLE,
  OUTER_INCOME_PER_DISCIPLE,
  RECRUIT_COST,
  sectLimitsFor,
} from "./sect.js";
import type {
  BreakthroughEvent,
  ChronicleEntry,
  DeathEvent,
  Disciple,
  EndingKind,
  EndingRating,
  GameState,
  PromotionEvent,
  SettlementResult,
} from "./state.js";
import { CRAFT_JOB_KINDS } from "./state.js";
import { talentById } from "./talents.js";
import { talentsBreakthroughFlat, talentsLifespanFlat, talentsZhenyuanPct } from "./talents.js";

export const MORALE_HIGH_THRESHOLD = 70;
export const MORALE_LOW_THRESHOLD = 30;
export const MORALE_HIGH_ZHENYUAN_PCT = 0.1;
export const MORALE_LOW_ZHENYUAN_PCT = -0.1;
/** 基线士气：无事月 +1（会战/坐化/危机/切磋另计）。 */
export const BASE_MORALE_DELTA = 1;
export const CRISIS_MORALE_PENALTY = 3;
export const DEATH_MORALE_PENALTY = 5;
export const BREAKTHROUGH_FAILURE_RATE_BONUS = 5;
export const CHRONICLE_LIMIT = 500;

/** 资源长老：外门供奉 +20%（设计 §宗门体系 长老简版）。 */
export const RESOURCE_ELDER_OFFERING_PCT = 0.2;
/** 战备长老：全门突破成功率 +3（百分点）。 */
export const WAR_ELDER_BREAKTHROUGH_FLAT = 3;
/** 突破顿悟概率：弟子突破成功时直接领悟一门未修法术的概率（百分点，不经藏经阁）。 */
export const EPIPHANY_CHANCE_PCT = 20;
/** 战报存档条数上限（最新在前；控制快照体积）。 */
export const BATTLE_LOG_LIMIT = 30;
/** 战报存档字节预算：序列化总量超预算时丢弃更旧战报（快照 <128KB 约束，设计 D-022）。 */
export const BATTLE_LOG_BYTE_BUDGET = 45_000;

/**
 * 战报入库（最新在前）：先按条数上限截断，再按字节预算自旧向新丢弃；至少保留最新 1 条。
 * 纪事文本不受影响，更早的战斗只留纪事摘要供追溯。
 */
export function prependBattleReports(state: GameState, reports: readonly BattleReport[]): void {
  const merged = [...reports, ...(state.battles ?? [])].slice(0, BATTLE_LOG_LIMIT);
  const kept: BattleReport[] = [];
  let totalBytes = 0;
  for (const report of merged) {
    const size = JSON.stringify(report).length;
    if (kept.length > 0 && totalBytes + size > BATTLE_LOG_BYTE_BUDGET) break;
    kept.push(report);
    totalBytes += size;
  }
  state.battles = kept;
}

/** 月结 8 步顺序锚点（golden 契约）：经济→真元突破→生产→历练→NPC→会战→声望胜负→年度衰老。 */
export const MONTHLY_STEP_ORDER: readonly string[] = [
  "economy",
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

/** 月真元基准常量（调平旋钮，E06-F01）：base = ZHENYUAN_BASE + 悟性 × ZHENYUAN_COMPREHENSION_COEFF。 */
export const ZHENYUAN_BASE = 130;
export const ZHENYUAN_COMPREHENSION_COEFF = 0.5;

export function monthlyZhenyuanGain(state: GameState, disciple: Disciple): number {
  // 有效五维（基础 + 天赋 + 功法 + 装备平加，clamp 后）由 combat-profile 统一聚合。
  const comprehension = buildCombatProfile(disciple).breakdown.attributes.effective.comprehension;
  const moralePct =
    state.morale >= MORALE_HIGH_THRESHOLD
      ? MORALE_HIGH_ZHENYUAN_PCT
      : state.morale <= MORALE_LOW_THRESHOLD
        ? MORALE_LOW_ZHENYUAN_PCT
        : 0;
  const techniquePct = disciple.techniqueId
    ? (getTechniqueById(disciple.techniqueId)?.effect.zhenyuanPct ?? 0)
    : 0;
  const base = ZHENYUAN_BASE + comprehension * ZHENYUAN_COMPREHENSION_COEFF;
  const rate = 1 + talentsZhenyuanPct(disciple.talentIds) + techniquePct + moralePct;
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
    prependBattleReports(state, [report.battle.report]);
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
  options: SettleMonthlyOptions = {},
): SettleMonthlyOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  let state = structuredClone(stateInput) as GameState;
  state.currentTurn += 1;
  const turn = state.currentTurn;

  const breakthroughs: BreakthroughEvent[] = [];
  const deaths: DeathEvent[] = [];
  const promotions: PromotionEvent[] = [];
  let spiritStonesDelta = 0;
  let moraleDelta = 0;
  let prestigeDelta = 0;

  // ① 灵石结转：外门供奉（资源长老 +20%，外门总数恒等于宗门等级上限）+ 挖矿上缴 − 内门俸禄。
  const outerCount = sectLimitsFor(state.sectRank).outerLimit;
  const innerCount = state.disciples.length;
  const offeringMultiplier = state.elders?.resource ? 1 + RESOURCE_ELDER_OFFERING_PCT : 1;
  const income =
    Math.round(outerCount * OUTER_INCOME_PER_DISCIPLE * offeringMultiplier) +
    effectiveOuterJobsOf(state).mining * OUTER_MINING_STONES_PER_MONTH;
  const expenses = innerCount * INNER_SALARY_PER_DISCIPLE;
  let crisis = false;

  // ① 资源危机：付不起俸禄时当月停摆、收支勾销、全门士气受挫。
  if (state.spiritStones + income - expenses < 0) {
    crisis = true;
    moraleDelta -= CRISIS_MORALE_PENALTY;
    appendChronicle(state, {
      turn,
      kind: "warning",
      text: "宗门灵石见底，本月俸禄无法支付、历练停摆，弟子人心浮动。",
    });
  } else {
    spiritStonesDelta += income - expenses;
    state.spiritStones += income - expenses;
    // 基线士气：无事月 +1（切磋/会战/坐化/危机另计）。
    moraleDelta += BASE_MORALE_DELTA;
  }

  state.morale = Math.min(100, Math.max(0, state.morale + moraleDelta));
  state.prestige = Math.max(0, state.prestige + prestigeDelta);

  // （外门自然流动已废除：外门恒按宗门等级上限满员，无来投/离去。）

  // ② 真元增长与突破判定（名册全员内门；岗位/长老占用者不修炼）。
  const occupied = jobHolderIds(state);
  const warElderFlat = state.elders?.war ? WAR_ELDER_BREAKTHROUGH_FLAT : 0;
  for (const disciple of state.disciples) {
    if (occupied.has(disciple.id)) continue;
    // 元婴前期即修行尽头：圆满弟子不再积累真元、不再尝试突破。
    if (disciple.realmLevel >= TOP_REALM_LEVEL) continue;
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
    if (!next) continue;
    disciple.realm = next.realm;
    disciple.realmLevel = next.level;
    state.totalBreakthroughs = (state.totalBreakthroughs ?? 0) + 1;

    // 突破顿悟：突破成功有 EPIPHANY_CHANCE_PCT 概率灵光乍现，直接领悟一门未修法术
    //（不经藏经阁、不耗书；弟子已修满 2 门则与此无缘）。
    const knownSpells = disciple.spellIds ?? [];
    let epiphany: Spell | undefined;
    if (knownSpells.length < MAX_SPELLS_PER_DISCIPLE) {
      const candidates = SPELLS.filter((spell) => !knownSpells.includes(spell.id));
      if (
        candidates.length > 0 &&
        deterministicRoll(`${state.seed}:epiphany:${disciple.id}:${turn}`) < EPIPHANY_CHANCE_PCT
      ) {
        const pickRoll = deterministicRoll(`${state.seed}:epiphany:pick:${disciple.id}:${turn}`);
        const picked = candidates[Math.floor((pickRoll / 100) * candidates.length)];
        if (picked) {
          epiphany = picked;
          disciple.spellIds = [...knownSpells, picked.id];
        }
      }
    }

    const event: BreakthroughEvent = {
      discipleId: disciple.id,
      discipleName: disciple.name,
      outcome: "success",
      fromRealmLevel: stage.level,
      toRealmLevel: next.level,
      successRate,
    };
    if (epiphany) {
      event.epiphanySpellId = epiphany.id;
      event.epiphanySpellName = epiphany.name;
    }
    breakthroughs.push(event);
    appendChronicle(state, {
      turn,
      kind: "milestone",
      text: `${disciple.name} 突破至${next.name}！`,
    });
    if (epiphany) {
      appendChronicle(state, {
        turn,
        kind: "milestone",
        text: `${disciple.name} 突破之际灵台清明，顿悟法术《${epiphany.name}》！`,
      });
    }
    // 大境界突破（进入 4/7/10 级）：声望 +3（设计 §声望）。
    const majorPrestige = prestigeDeltaForMajorBreakthrough(next.level);
    if (majorPrestige > 0) {
      prestigeDelta += majorPrestige;
      state.prestige = applyPrestigeDelta(state.prestige, majorPrestige);
      appendChronicle(state, {
        turn,
        kind: "normal",
        text: `${disciple.name} 迈入大境界（实力等级 ${next.level}），宗门声望 +${majorPrestige}。`,
      });
    }
    // 大境界突破寿元直接写入最大寿命：练气→筑基 +200 / 筑基→金丹 +500 / 金丹→元婴 +1000。
    const lifespanIncrease = lifespanIncreaseForRealmLevel(next.level);
    if (lifespanIncrease > 0) {
      disciple.maxLifespan += lifespanIncrease;
      appendChronicle(state, {
        turn,
        kind: "normal",
        text: `境界跃升，${disciple.name} 寿元大增（+${lifespanIncrease} 年）。`,
      });
    }
  }

  // ③ 丹房/器坊点数与出炉（旧档未启用生产时跳过，保持扩展字段缺省口径；危机月随历练一并停摆）。
  // ④ 历练与遭遇事件（每月自动进行；资源危机月停摆故无遭遇）。
  // 终局只能由第 ⑦ 步落账；此后生产与历练不再执行（防御性判定）。
  let expeditionReport: ExpeditionReport | undefined;
  let workshopsOutcome: ReturnType<typeof advanceWorkshops> | undefined;
  if (!state.ending) {
    if (state.jobs && !crisis) {
      workshopsOutcome = advanceWorkshops(state);
      state = workshopsOutcome.state;
    }
    if (!crisis) {
      // 相遇接线（E04-F02）：缺省对手 = 真实 NPC 宗门确定性选将；宣战状态自 state 读取。
      const rival = state.rival;
      const opponentProvider: OpponentProvider =
        options.opponentProvider ??
        (rival
          ? () => pickRivalOpponent(rival, `${state.seed}:rival-opponent:${turn}`, turn)
          : () => undefined);
      expeditionReport = settleExpedition(state, {
        turn,
        atWar: options.atWar ?? state.warWithRival === true,
        incomePct: maxIncomePct(state),
        opponentProvider,
        fighterProvider: options.fighterProvider,
      });
      const acc = { spiritStonesDelta, moraleDelta, prestigeDelta };
      applyExpeditionReport(state, expeditionReport, turn, acc);
      spiritStonesDelta = acc.spiritStonesDelta;
      moraleDelta = acc.moraleDelta;
      prestigeDelta = acc.prestigeDelta;
      // 对位弟子的战败伤势落回对手宗门名册（我方伤势由 applyExpeditionReport 落账；
      // 战报 A=我方、B=对手：我方胜时败者为对手弟子）。
      const battle = expeditionReport.battle;
      const loserInjury = battle?.loserInjury;
      if (
        rival &&
        battle?.winner === "A" &&
        loserInjury &&
        expeditionReport.opponentId !== undefined
      ) {
        const opponentId = expeditionReport.opponentId;
        const rivalDisciple = rival.disciples.find((entry) => entry.id === opponentId);
        if (rivalDisciple) {
          rivalDisciple.injury = {
            kind: loserInjury.kind === "heavy" ? "severe" : "light",
            untilTurn: turn + loserInjury.months,
          };
        }
      }
    }
  }

  // ⑤ NPC 宗门推进：与玩家月结同帧推进对手宗门（真元/突破/升阶），并做 NPC 宣战判定。
  let rivalDeclaredWar = false;
  let rivalRankUp: { from: number; to: number } | undefined;
  if (!state.ending && state.rival) {
    const previousRank = state.rival.sectRank;
    state.rival = advanceRivalSectMonthly(state.rival, turn);
    if (state.rival.sectRank !== previousRank) {
      rivalRankUp = { from: previousRank, to: state.rival.sectRank };
      appendChronicle(state, {
        turn,
        kind: "milestone",
        text: `情报：${state.rival.name} 晋升为${state.rival.sectRank === 2 ? "二" : "三"}级宗门！`,
      });
    }
    // NPC 宣战判定：未开战且冷却已过时，声望差 >50 或其宗门等级更高 → 15%/月（sha256 掷骰）。
    if (!state.warWithRival && warCooldownEnded(state)) {
      const declared = rivalWarDecision({
        roll: rivalWarRollForTurn(state.seed, turn),
        prestigeGap: state.rival.prestige - state.prestige,
        rivalLevelHigher: state.rival.sectRank > state.sectRank,
      });
      if (declared) {
        state.warWithRival = true;
        state.warDeclaredTurn = turn;
        rivalDeclaredWar = true;
        appendChronicle(state, {
          turn,
          kind: "warning",
          text: `${state.rival.name} 向我宗宣战！来月会战，兵戎相见。`,
        });
      }
    }
  }

  // ⑥ 会战结算（宣战次月触发）：选将 → 同序配对逐场 1v1 → 裁决 → 掠夺/声望/士气/伤势落账。
  let warRecord: SectWarRecord | undefined;
  if (
    !state.ending &&
    state.warWithRival &&
    state.rival &&
    state.warDeclaredTurn !== undefined &&
    turn > state.warDeclaredTurn
  ) {
    const rival = state.rival;
    const toWarEligible = (disciple: Disciple): WarEligibleDisciple => ({
      ...disciple,
      injuryMonthsLeft: injuryMonthsLeftFor(disciple, turn),
    });
    // 我方出战名单：warParty 指定优先（须可出战），不足自动按最强 3 补齐；缺省全自动选将。
    const playerRoster = state.disciples.map(toWarEligible);
    const rosterById = new Map(playerRoster.map((disciple) => [disciple.id, disciple]));
    const party: WarEligibleDisciple[] = [];
    for (const id of (state.warParty ?? []).slice(0, SECT_WAR_FIGHTERS)) {
      const disciple = rosterById.get(id);
      if (disciple && isWarEligible(disciple) && !party.some((entry) => entry.id === disciple.id)) {
        party.push(disciple);
      }
    }
    if (party.length < SECT_WAR_FIGHTERS) {
      const autoFill = selectSectWarFighters(playerRoster).filter(
        (disciple) => !party.some((entry) => entry.id === disciple.id),
      );
      party.push(...autoFill.slice(0, SECT_WAR_FIGHTERS - party.length));
    }

    const warResult = runSectWar({
      playerFighters: party,
      rivalFighters: rival.disciples.map(toWarEligible),
      seed: state.seed,
      playerStones: state.spiritStones,
      rivalStones: rival.spiritStones,
      turn,
    });
    const record = sectWarRecord(warResult, rival.name);

    // 掠夺交割：胜方掠败方灵石 10%（≤5,000）。
    if (warResult.winner === "player") {
      state.spiritStones += warResult.plunder;
      rival.spiritStones -= warResult.plunder;
    } else {
      state.spiritStones -= warResult.plunder;
      rival.spiritStones += warResult.plunder;
    }
    // 声望/士气落地（我方 ±10/±5；对方对称）。
    prestigeDelta += record.prestigeDelta;
    state.prestige = applyPrestigeDelta(state.prestige, record.prestigeDelta);
    moraleDelta += record.moraleDelta;
    state.morale = Math.min(100, Math.max(0, state.morale + record.moraleDelta));
    rival.prestige = applyPrestigeDelta(rival.prestige, record.rivalPrestigeDelta);
    rival.morale = Math.min(100, Math.max(0, rival.morale + record.rivalMoraleDelta));

    // 参战者按战败伤势规则落账（各场战报给出败方侧别与掷骰结果）。
    const playerById = new Map(state.disciples.map((disciple) => [disciple.id, disciple]));
    const rivalById = new Map(rival.disciples.map((disciple) => [disciple.id, disciple]));
    for (const pair of warResult.pairOutcomes) {
      if (!pair.loser) continue;
      const target =
        pair.loser.side === "player"
          ? playerById.get(pair.loser.discipleId)
          : rivalById.get(pair.loser.discipleId);
      if (target) {
        target.injury = {
          kind: pair.loser.kind === "heavy" ? "severe" : "light",
          untilTurn: turn + pair.loser.months,
        };
      }
    }

    // 会战记录与战报存档 + 纪事。
    state.sectWars = [record, ...(state.sectWars ?? [])].slice(0, SECT_WAR_RECORD_LIMIT);
    prependBattleReports(state, warResult.pairOutcomes.map((pair) => pair.battle).reverse());
    appendChronicle(state, {
      turn,
      kind: record.winner === "player" ? "milestone" : "warning",
      text: record.summary,
    });
    for (const [index, pair] of warResult.pairOutcomes.entries()) {
      const verdictText = pair.winner === "player" ? "胜" : pair.winner === "rival" ? "负" : "平";
      appendChronicle(state, {
        turn,
        kind: "normal",
        text: `会战第${index + 1}阵：${pair.playerFighterName} 对阵 ${pair.rivalFighterName}，${verdictText}。`,
      });
    }

    // 战争状态收尾：进入 12 个月冷却（自宣战月起算），出战名单清空待下战重定。
    state.warWithRival = false;
    state.warCooldownEndsTurn = (state.warDeclaredTurn ?? turn) + WAR_COOLDOWN_MONTHS;
    state.warDeclaredTurn = undefined;
    state.warParty = undefined;
    warRecord = record;
  }

  // ⑦ 声望/士气落地与胜负判定：声望/士气已随历练与会战落账；此处判吞并/被吞并/凋敝终局。
  if (!state.ending) {
    const rival = state.rival;
    if (
      rival &&
      annexationTriggered({
        myRank: state.sectRank,
        rivalRank: rival.sectRank,
        rivalPrestige: rival.prestige,
      })
    ) {
      setOutcomeEnding(
        state,
        "annexation",
        turn,
        `${state.sectName} 压服${rival.name}：对方声望扫地、山门俯首，仙途霸业自此功成。`,
      );
    } else if (
      rival &&
      annexedTriggered({
        myRank: state.sectRank,
        rivalRank: rival.sectRank,
        myPrestige: state.prestige,
      })
    ) {
      setOutcomeEnding(
        state,
        "annexed",
        turn,
        `${rival.name} 大军压境：我宗声望扫地、群徒四散，宗门被吞并。`,
      );
    } else {
      // 凋敝：内门 0 且灵石不足招募费连续 6 月（计数器落 state）。
      state.bankruptStreak = declineStreakAfter({
        streak: state.bankruptStreak ?? 0,
        innerCount: state.disciples.length,
        spiritStones: state.spiritStones,
      });
      if (isDeclineCollapse(state.bankruptStreak)) {
        setOutcomeEnding(
          state,
          "bankrupt",
          turn,
          `${state.sectName} 内门零落、灵石耗竭，连续半年难以为继，宗门就此凋敝。`,
        );
      }
    }
  }

  // ⑧ 第 12 月：年度衰老与坐化。
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

      // 补员：仅补齐内门坐化空出的席位；外门恒满员——自外门递补生成新内门弟子入册，外门总数不变。
      // 练气岗加成：按在岗练气外门人数给递补弟子携带初始真元（外门修行底子随人带来）。
      const innerDeaths = deceased.length;
      const qiBonus = effectiveOuterJobsOf(state).qi * OUTER_QI_ZHENYUAN_PER_WORKER;
      let promoted = 0;
      while (promoted < innerDeaths) {
        state.discipleSeq += 1;
        const successor = generateDisciple({
          gameSeed: state.seed,
          discipleId: `d-${state.discipleSeq}`,
          ordinal: state.discipleSeq,
          usedNames: state.disciples.map((disciple) => disciple.name),
        });
        if (qiBonus > 0) successor.zhenyuan += qiBonus;
        state.disciples.push(successor);
        promoted += 1;
        promotions.push({ discipleId: successor.id, discipleName: successor.name });
        appendChronicle(state, {
          turn,
          kind: "normal",
          text: `${successor.name} 因同门仙逝递补入内门${
            qiBonus > 0 ? `，携练气真元 ${qiBonus} 点入门` : ""
          }。`,
        });
      }
    }
  }

  const result: SettlementResult = {
    turn,
    crisis,
    spiritStonesDelta,
    moraleDelta,
    prestigeDelta,
    breakthroughs,
    deaths,
    promotions,
  };
  if (workshopsOutcome?.completedPills.length)
    result.completedPills = workshopsOutcome.completedPills;
  if (workshopsOutcome?.completedGear.length) result.completedGear = workshopsOutcome.completedGear;
  if (expeditionReport) result.expedition = expeditionReport;
  if (warRecord) result.war = warRecord;
  if (rivalDeclaredWar) result.rivalDeclaredWar = true;
  if (rivalRankUp) result.rivalRankUp = rivalRankUp;
  return { state, result };
}

// ─── 结局落账与评价（E04-F04）────────────────────────────────────────────

/** 会战记录存档上限（最新在前；控制快照体积）。 */
export const SECT_WAR_RECORD_LIMIT = 20;

/** 结局评价五维输入快照（设计 §胜负与结局评价：用时/突破/会战胜绩/坐化/剩余灵石）。 */
function endingStatsOf(state: GameState, turn: number) {
  return {
    gameYears: Math.round((turn / 12) * 10) / 10,
    breakthroughCount: state.totalBreakthroughs ?? 0,
    warWins: (state.sectWars ?? []).filter((record) => record.winner === "player").length,
    warTotal: (state.sectWars ?? []).length,
    fallenCount: state.fallen.length,
    spiritStonesLeft: state.spiritStones,
  };
}

/** 为已写入的结局补算仙途评级与综合得分。 */
function applyEndingEvaluation(state: GameState, turn: number): void {
  if (!state.ending) return;
  const stats = endingStatsOf(state, turn);
  state.ending.rating = rateEnding(stats);
  state.ending.score = endingScore(stats);
}

/** 吞并/被吞并/凋敝终局落账：写 ending + 评级 + 纪事里程碑。 */
function setOutcomeEnding(state: GameState, kind: EndingKind, turn: number, text: string): void {
  state.ending = { kind, turn, text };
  applyEndingEvaluation(state, turn);
  appendChronicle(state, {
    turn,
    kind: "milestone",
    text: `${text}（仙途评级：${state.ending.rating ?? "丁"}）`,
  });
}

// ─── 凋敝判定（设计 §胜负与结局评价：内门 0 且灵石不足招募费连续 6 月）──

export const DECLINE_COLLAPSE_MONTHS = 6;

export type DeclineStreakInput = {
  /** 上月累计计数。 */
  streak: number;
  innerCount: number;
  spiritStones: number;
};

/** 凋敝计数推进：内门 0 且灵石 < 招募费 → +1；任一条件解除即归零。 */
export function declineStreakAfter(input: DeclineStreakInput): number {
  const declining = input.innerCount === 0 && input.spiritStones < RECRUIT_COST;
  return declining ? input.streak + 1 : 0;
}

/** 凋敝是否成局：连续计数 ≥ 6 月。 */
export function isDeclineCollapse(streak: number): boolean {
  return streak >= DECLINE_COLLAPSE_MONTHS;
}

// ─── 吞并/被吞并判定（对称：对方声望 ≤0 且我方宗门等级更高）────────────

export type AnnexationInput = { myRank: number; rivalRank: number; rivalPrestige: number };

/** 吞并胜利：对方声望 ≤0 且我方宗门等级更高。 */
export function annexationTriggered(input: AnnexationInput): boolean {
  return input.rivalPrestige <= 0 && input.myRank > input.rivalRank;
}

export type AnnexedInput = { myRank: number; rivalRank: number; myPrestige: number };

/** 被吞并失局：我方声望 ≤0 且对方宗门等级更高。 */
export function annexedTriggered(input: AnnexedInput): boolean {
  return input.myPrestige <= 0 && input.rivalRank > input.myRank;
}

// ─── 仙途评级（甲/乙/丙/丁；五维输入 → 综合评分，阈值写死常量）─────────

/** 结局评价阈值常量（设计 §胜负与结局评价 五维输入；分档为 E04-F04 定夺并写死）。 */
export const ENDING_RATING_THRESHOLDS = {
  /** 用时（游戏年）≤30 年得 3 分 / ≤60 年得 2 分 / 其余 1 分。 */
  clearFastYears: 30,
  clearSteadyYears: 60,
  /** 突破总数 ≥25 次得 2 分 / ≥12 次得 1 分 / 其余 0 分。 */
  breakthroughHigh: 25,
  breakthroughMid: 12,
  /** 会战胜率（有会战记录时）≥60% 得 2 分 / ≥40% 得 1 分 / 无会战 0 分。 */
  warWinRateHighPct: 60,
  warWinRateMidPct: 40,
  /** 坐化弟子数 ≤2 人得 1 分 / 其余 0 分。 */
  fallenCalm: 2,
  /** 剩余灵石 ≥30,000 得 2 分 / ≥10,000 得 1 分 / 其余 0 分。 */
  stonesHigh: 30000,
  stonesMid: 10000,
  /** 综合评分（满分 10）：≥8 甲 / ≥6 乙 / ≥4 丙 / 其余 丁。 */
  scoreJia: 8,
  scoreYi: 6,
  scoreBing: 4,
  scoreMax: 10,
} as const;

export type EndingStatsInput = {
  /** 用时（游戏年）。 */
  gameYears: number;
  /** 突破成功总次数。 */
  breakthroughCount: number;
  warWins: number;
  warTotal: number;
  /** 坐化弟子数。 */
  fallenCount: number;
  /** 剩余灵石。 */
  spiritStonesLeft: number;
};

/** 结局综合评分（0–10；口径见 ENDING_RATING_THRESHOLDS 注释）。 */
export function endingScore(input: EndingStatsInput): number {
  const t = ENDING_RATING_THRESHOLDS;
  let score = 0;
  if (input.gameYears <= t.clearFastYears) score += 3;
  else if (input.gameYears <= t.clearSteadyYears) score += 2;
  else score += 1;

  if (input.breakthroughCount >= t.breakthroughHigh) score += 2;
  else if (input.breakthroughCount >= t.breakthroughMid) score += 1;

  if (input.warTotal > 0) {
    const winRatePct = (input.warWins / input.warTotal) * 100;
    if (winRatePct >= t.warWinRateHighPct) score += 2;
    else if (winRatePct >= t.warWinRateMidPct) score += 1;
  }

  if (input.fallenCount <= t.fallenCalm) score += 1;

  if (input.spiritStonesLeft >= t.stonesHigh) score += 2;
  else if (input.spiritStonesLeft >= t.stonesMid) score += 1;

  return Math.min(score, t.scoreMax);
}

/** 仙途评级：综合评分 → 甲/乙/丙/丁（纯函数、确定性）。 */
export function rateEnding(input: EndingStatsInput): EndingRating {
  const score = endingScore(input);
  const t = ENDING_RATING_THRESHOLDS;
  if (score >= t.scoreJia) return "甲";
  if (score >= t.scoreYi) return "乙";
  if (score >= t.scoreBing) return "丙";
  return "丁";
}
