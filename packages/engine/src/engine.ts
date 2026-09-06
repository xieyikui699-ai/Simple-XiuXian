import { generateDisciple } from "./generation.js";
import { realmLifespanBonusForLevel, realmStageForLevel } from "./realms.js";
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
// 引擎门面：开局、月结、招募、提拔、升阶。所有操作返回新状态（纯函数、确定性）。
import { currentSuccessRate, monthlyZhenyuanGain } from "./settlement.js";
import type { Disciple, GameState, RecruitmentCandidate } from "./state.js";

export type CreateGameInput = {
  seed: string;
  sectName: string;
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
