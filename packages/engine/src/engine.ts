// 引擎门面：开局、月结、招募、提拔、升阶 + M2 管理命令（研读功法法术/穿戴装备/服用丹药/任命长老）。
// 所有操作返回新状态（纯函数、确定性）；每条管理命令落纪事 normal 一条。
import {
  GEAR_SLOT_DISPLAY_NAMES,
  type GearSlot,
  type GearTier,
  MAX_SPELLS_PER_DISCIPLE,
  canLearnSpell,
  getGear,
  getPillById,
  getSpellById,
  getTechniqueById,
} from "./catalog.js";
import { combatReadyDisciples } from "./expedition.js";
import { generateDisciple } from "./generation.js";
import { ADULT_AGE } from "./production.js";
import { realmLifespanBonusForLevel, realmStageForLevel } from "./realms.js";
import { canPlayerDeclareWar, createRivalSect, declareWar } from "./rival.js";
import { SECT_WAR_FIGHTERS } from "./sect-war.js";
import {
  INITIAL_INNER_DISCIPLES,
  INITIAL_MORALE,
  INITIAL_OUTER_DISCIPLES,
  INITIAL_PRESTIGE,
  INITIAL_SPIRIT_STONES,
  RECRUIT_CANDIDATE_COUNT,
  RECRUIT_COST,
  sectLimitsFor,
  sectUpgradeFailureReason,
  upgradeRequirementFor,
} from "./sect.js";
import { currentSuccessRate, monthlyZhenyuanGain } from "./settlement.js";
import { emptyLibrary, emptySectJobs, emptyWarehouse } from "./state.js";
import type { ChronicleEntry, Disciple, GameState, RecruitmentCandidate } from "./state.js";

export type CreateGameInput = {
  seed: string;
  sectName: string;
  /** NPC 对手宗门名（缺省按 seed 确定性选取）。 */
  rivalName?: string;
  /** NPC 难度倍率（0.8 / 1 / 1.2，缺省 1）。 */
  rivalDifficulty?: number;
};

export function createGame(input: CreateGameInput): GameState {
  if (input.seed.trim().length === 0 || input.seed.length > 128) {
    throw new Error("game_seed_invalid");
  }
  const sectName = input.sectName.trim();
  if (sectName.length < 2 || sectName.length > 24) {
    throw new Error("game_sect_name_invalid");
  }
  const state: GameState = {
    seed: input.seed.trim(),
    sectName,
    currentTurn: 1,
    spiritStones: INITIAL_SPIRIT_STONES,
    sectRank: 1,
    morale: INITIAL_MORALE,
    prestige: INITIAL_PRESTIGE,
    discipleSeq: 0,
    disciples: [],
    chronicle: [
      {
        turn: 1,
        kind: "milestone",
        text: `${sectName} 开山立派，广纳门徒，仙途自此始。`,
      },
    ],
    fallen: [],
    library: emptyLibrary(),
    jobs: emptySectJobs(),
    warehouse: emptyWarehouse(),
  };

  const initialAges = [18, 21, 24];
  const usedNames: string[] = [];
  for (let i = 0; i < INITIAL_INNER_DISCIPLES; i++) {
    state.discipleSeq += 1;
    const disciple = generateDisciple({
      gameSeed: state.seed,
      discipleId: `d-${state.discipleSeq}`,
      ordinal: state.discipleSeq,
      usedNames,
      age: initialAges[i] ?? 16,
      role: "inner",
    });
    usedNames.push(disciple.name);
    state.disciples.push(disciple);
  }
  for (let i = 0; i < INITIAL_OUTER_DISCIPLES; i++) {
    state.discipleSeq += 1;
    const disciple = generateDisciple({
      gameSeed: state.seed,
      discipleId: `d-${state.discipleSeq}`,
      ordinal: state.discipleSeq,
      usedNames,
      role: "outer",
    });
    usedNames.push(disciple.name);
    state.disciples.push(disciple);
  }

  // NPC 对手宗门：与玩家同 seed 确定性生成，开局同为 1 级宗门（设计 §NPC 对手宗门）。
  state.rival = createRivalSect({
    seed: state.seed,
    name: input.rivalName,
    difficulty: input.rivalDifficulty ?? 1,
  });
  state.sectWars = [];
  return state;
}

export function listRecruitCandidates(state: Readonly<GameState>): RecruitmentCandidate[] {
  const usedNames = state.disciples.map((disciple) => disciple.name);
  const candidates: RecruitmentCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < RECRUIT_CANDIDATE_COUNT; i++) {
    const candidateId = `cand-${state.currentTurn}-${i}`;
    const candidate = generateDisciple({
      gameSeed: state.seed,
      discipleId: `preview:${candidateId}`,
      ordinal: state.discipleSeq + 1 + i,
      usedNames: [...usedNames, ...seen],
      role: "outer",
    });
    seen.add(candidate.name);
    candidates.push({ candidateId, disciple: candidate });
  }
  return candidates;
}

export type RecruitOutcome = {
  state: GameState;
  disciple: Disciple;
};

export function recruitDisciple(
  stateInput: Readonly<GameState>,
  candidateId: string,
): RecruitOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  if (stateInput.spiritStones < RECRUIT_COST) throw new Error("insufficient_resource");
  const candidates = listRecruitCandidates(stateInput);
  const chosen = candidates.find((candidate) => candidate.candidateId === candidateId);
  if (!chosen) throw new Error("candidate_not_found");
  const state = structuredClone(stateInput) as GameState;
  state.spiritStones -= RECRUIT_COST;
  state.discipleSeq += 1;
  const disciple = generateDisciple({
    gameSeed: state.seed,
    discipleId: `d-${state.discipleSeq}`,
    ordinal: state.discipleSeq,
    usedNames: state.disciples.map((existing) => existing.name),
    role: "outer",
  });
  state.disciples.push(disciple);
  return { state, disciple };
}

export type PromoteOutcome = {
  state: GameState;
  disciple: Disciple;
};

export function promoteToInner(
  stateInput: Readonly<GameState>,
  discipleId: string,
): PromoteOutcome {
  const state = structuredClone(stateInput) as GameState;
  const disciple = state.disciples.find((existing) => existing.id === discipleId);
  if (!disciple) throw new Error("disciple_not_found");
  if (disciple.role === "inner") throw new Error("disciple_already_inner");
  const limits = sectLimitsFor(state.sectRank);
  const innerCount = state.disciples.filter((existing) => existing.role === "inner").length;
  if (innerCount >= limits.innerLimit) throw new Error("inner_limit_reached");
  disciple.role = "inner";
  return { state, disciple };
}

export type UpgradeOutcome = {
  state: GameState;
  newRank: GameState["sectRank"];
};

export function upgradeSect(stateInput: Readonly<GameState>): UpgradeOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const reason = sectUpgradeFailureReason(stateInput);
  if (reason) throw new Error(reason);
  const state = structuredClone(stateInput) as GameState;
  const requirement = upgradeRequirementFor(state.sectRank);
  if (!requirement) throw new Error("sect_rank_maxed");
  state.spiritStones -= requirement.cost;
  state.sectRank = (state.sectRank + 1) as GameState["sectRank"];
  state.chronicle.unshift({
    turn: state.currentTurn,
    kind: "milestone",
    text: `${state.sectName} 晋升为${state.sectRank === 2 ? "二" : "三"}级宗门，山门气象一新！`,
  });
  return { state, newRank: state.sectRank };
}

// ─── M2 管理命令：研读功法法术 / 穿戴装备 / 服用丹药 / 任命长老 ──────────

function appendChronicle(state: GameState, entry: ChronicleEntry): void {
  state.chronicle.unshift(entry);
}

export type LearnArtOutcome = {
  state: GameState;
  disciple: Disciple;
};

/** 研读功法/法术：藏经阁拥有方可研读（不耗书）；功法限 1 门、法术限 2 门。 */
export function learnArt(
  stateInput: Readonly<GameState>,
  discipleId: string,
  artId: string,
): LearnArtOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const disciple = stateInput.disciples.find((entry) => entry.id === discipleId);
  if (!disciple) throw new Error("disciple_not_found");
  if (disciple.role !== "inner") throw new Error("disciple_not_inner");
  const library = stateInput.library ?? emptyLibrary();
  let plan: { kind: "technique"; name: string } | { kind: "spell"; name: string };
  const technique = getTechniqueById(artId);
  const spell = getSpellById(artId);
  if (technique) {
    if (!library.techniqueIds.includes(artId)) throw new Error("art_not_in_library");
    if (disciple.techniqueId) throw new Error("technique_limit_reached");
    plan = { kind: "technique", name: technique.name };
  } else if (spell) {
    const known = disciple.spellIds ?? [];
    if (known.includes(artId)) throw new Error("spell_already_learned");
    if (!canLearnSpell(library.spellIds, artId, known.length)) {
      throw new Error(
        library.spellIds.includes(artId) ? "spell_limit_reached" : "art_not_in_library",
      );
    }
    plan = { kind: "spell", name: spell.name };
  } else {
    // 目录中既无功法亦无法术。
    throw new Error("art_not_found");
  }
  const state = structuredClone(stateInput) as GameState;
  const target = state.disciples.find((entry) => entry.id === discipleId) as Disciple;
  if (plan.kind === "technique") {
    target.techniqueId = artId;
    appendChronicle(state, {
      turn: state.currentTurn,
      kind: "normal",
      text: `${target.name} 研读功法《${plan.name}》，气机渐入门径。`,
    });
  } else {
    target.spellIds = [...(target.spellIds ?? []), artId].slice(0, MAX_SPELLS_PER_DISCIPLE);
    appendChronicle(state, {
      turn: state.currentTurn,
      kind: "normal",
      text: `${target.name} 修习法术《${plan.name}》，指下灵光初成。`,
    });
  }
  return { state, disciple: target };
}

export type WearGearOutcome = {
  state: GameState;
  disciple: Disciple;
};

/** 穿戴装备：从仓库取同槽同档一件戴上；原槽位装备卸下回仓（固定数值无实例差异）。 */
export function wearGear(
  stateInput: Readonly<GameState>,
  discipleId: string,
  slot: GearSlot,
  tier: GearTier,
): WearGearOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const disciple = stateInput.disciples.find((entry) => entry.id === discipleId);
  if (!disciple) throw new Error("disciple_not_found");
  if (disciple.role !== "inner") throw new Error("disciple_not_inner");
  if (!getGear(slot, tier)) throw new Error("gear_invalid");
  const warehouse = stateInput.warehouse ?? emptyWarehouse();
  const stockIndex = warehouse.gear.findIndex((item) => item.slot === slot && item.tier === tier);
  if (stockIndex < 0) throw new Error("gear_not_in_warehouse");
  const state = structuredClone(stateInput) as GameState;
  const target = state.disciples.find((entry) => entry.id === discipleId) as Disciple;
  const stock = state.warehouse ?? emptyWarehouse();
  state.warehouse = stock;
  stock.gear.splice(stockIndex, 1);
  const previousTier = target.equippedGear?.[slot];
  if (previousTier !== undefined) stock.gear.push({ slot, tier: previousTier });
  target.equippedGear = { ...(target.equippedGear ?? {}), [slot]: tier };
  appendChronicle(state, {
    turn: state.currentTurn,
    kind: "normal",
    text: `${target.name} 佩上${GEAR_SLOT_DISPLAY_NAMES[slot]}（档${tier}）${previousTier !== undefined ? "，原装备卸下回仓" : ""}。`,
  });
  return { state, disciple: target };
}

export type UsePillOutcome = {
  state: GameState;
  disciple: Disciple;
};

/** 服用丹药：延寿丹最大寿命 +10；聚灵丹 12 月内真元 ×1.5（不叠加、刷新时长）。 */
export function usePill(
  stateInput: Readonly<GameState>,
  discipleId: string,
  pillId: string,
): UsePillOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const pill = getPillById(pillId);
  if (!pill) throw new Error("pill_not_found");
  const disciple = stateInput.disciples.find((entry) => entry.id === discipleId);
  if (!disciple) throw new Error("disciple_not_found");
  const warehouse = stateInput.warehouse ?? emptyWarehouse();
  const stockEntry = warehouse.pills.find((entry) => entry.pillId === pillId);
  if (!stockEntry || stockEntry.count <= 0) throw new Error("pill_not_in_warehouse");
  const state = structuredClone(stateInput) as GameState;
  const target = state.disciples.find((entry) => entry.id === discipleId) as Disciple;
  const stock = state.warehouse ?? emptyWarehouse();
  state.warehouse = stock;
  const stored = stock.pills.find((entry) => entry.pillId === pillId);
  if (stored) {
    stored.count -= 1;
    if (stored.count <= 0) {
      stock.pills = stock.pills.filter((entry) => entry.pillId !== pillId);
    }
  }
  if (pill.effect.lifespanFlat !== undefined) {
    target.maxLifespan += pill.effect.lifespanFlat;
    appendChronicle(state, {
      turn: state.currentTurn,
      kind: "normal",
      text: `${target.name} 服用${pill.name}，寿元绵长（最大寿命 +${pill.effect.lifespanFlat} 年）。`,
    });
  }
  if (pill.effect.zhenyuanBuff) {
    target.spiritFocusUntilTurn = state.currentTurn + pill.effect.zhenyuanBuff.months;
    appendChronicle(state, {
      turn: state.currentTurn,
      kind: "normal",
      text: `${target.name} 服用${pill.name}，${pill.effect.zhenyuanBuff.months} 月内真元获取 ×1.5（重复服用只刷新时长）。`,
    });
  }
  return { state, disciple: target };
}

export type ElderKind = "resource" | "war";

export type AppointElderOutcome = {
  state: GameState;
  disciple: Disciple;
  /** 被替换卸任的旧长老（无则缺省）。 */
  replacedDiscipleId?: string;
};

/** 任命长老：资源长老（外门供奉 +20%）/ 战备长老（全门突破率 +3），各至多 1 名，可替换（旧长老卸任）。 */
export function appointElder(
  stateInput: Readonly<GameState>,
  discipleId: string,
  kind: ElderKind,
): AppointElderOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const disciple = stateInput.disciples.find((entry) => entry.id === discipleId);
  if (!disciple) throw new Error("disciple_not_found");
  if (disciple.role !== "inner") throw new Error("disciple_not_inner");
  if (disciple.age < ADULT_AGE) throw new Error("disciple_not_adult");
  const jobs = stateInput.jobs ?? emptySectJobs();
  for (const workshopKind of ["pill", "gear"] as const) {
    if (jobs[workshopKind].workers.includes(discipleId)) throw new Error("disciple_job_busy");
  }
  const current = stateInput.elders ?? {};
  if (current[kind] === discipleId) {
    // 幂等连任：状态不变。
    return { state: structuredClone(stateInput) as GameState, disciple };
  }
  const other = kind === "resource" ? current.war : current.resource;
  if (other === discipleId) throw new Error("disciple_job_busy");
  const state = structuredClone(stateInput) as GameState;
  const target = state.disciples.find((entry) => entry.id === discipleId) as Disciple;
  const replaced = kind === "resource" ? state.elders?.resource : state.elders?.war;
  state.elders = { ...(state.elders ?? {}), [kind]: discipleId };
  const elderName = kind === "resource" ? "资源长老" : "战备长老";
  const elderEffect = kind === "resource" ? "外门供奉 +20%" : "全门突破成功率 +3";
  appendChronicle(state, {
    turn: state.currentTurn,
    kind: "normal",
    text: `${target.name} 就任${elderName}（${elderEffect}），自此不问战修、专司其职。`,
  });
  return { state, disciple: target, replacedDiscipleId: replaced };
}

/** 派生展示：弟子修炼视图（只读，不写状态）。 */
export function discipleCultivationView(state: Readonly<GameState>, disciple: Disciple) {
  const stage = realmStageForLevel(disciple.realmLevel);
  return {
    stageName: stage.name,
    requiredZhenyuan: stage.requiredZhenyuan,
    monthlyGain: monthlyZhenyuanGain(state, disciple),
    successRate: currentSuccessRate(disciple, stage.baseSuccessRate),
    realmLifespanBonus: realmLifespanBonusForLevel(disciple.realmLevel),
  };
}

// ─── M3 两宗对抗命令：会战出战名单 / 宣战 ────────────────────────────────

export type SetWarPartyOutcome = {
  state: GameState;
  discipleIds: string[];
};

/** 指定会战出战弟子（至多 3 名，须为可出战内门；清空传空数组即恢复自动选将）。 */
export function setWarParty(
  stateInput: Readonly<GameState>,
  discipleIds: readonly string[],
): SetWarPartyOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const unique = [...new Set(discipleIds)];
  if (unique.length > SECT_WAR_FIGHTERS) throw new Error("war_party_too_large");
  const readyIds = new Set(
    combatReadyDisciples(stateInput, stateInput.currentTurn).map((d) => d.id),
  );
  for (const id of unique) {
    if (!readyIds.has(id)) throw new Error("war_party_disciple_unavailable");
  }
  const state = structuredClone(stateInput) as GameState;
  state.warParty = unique;
  const names = unique
    .map((id) => state.disciples.find((disciple) => disciple.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  state.chronicle.unshift({
    turn: state.currentTurn,
    kind: "normal",
    text:
      names.length > 0
        ? `会战出战名单已定：${names.join("、")}。`
        : "会战出战名单已清空，届时自动选派最强弟子。",
  });
  return { state, discipleIds: unique };
}

export type DeclareWarOutcome = {
  state: GameState;
  /** 宣战是否成立（冷却期/已开战时拒绝并抛错，故恒为 true；保留字段便于 UI 判定展示）。 */
  canDeclare: boolean;
};

/** 玩家宣战（随时可宣，冷却期拒绝；宣战次月月结触发会战）。 */
export function playerDeclareWar(stateInput: Readonly<GameState>): DeclareWarOutcome {
  if (!canPlayerDeclareWar(stateInput)) {
    if (stateInput.ending) throw new Error("game_already_ended");
    if (stateInput.warWithRival) throw new Error("war_already_declared");
    if (!stateInput.rival) throw new Error("rival_missing");
    throw new Error("war_cooldown_active");
  }
  return { state: declareWar(stateInput), canDeclare: true };
}
