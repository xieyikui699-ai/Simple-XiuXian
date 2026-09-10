// 两宗会战（设计文档 §两宗对抗·会战 D-018 / §声望 D-019 / §伤势 D-013）。
// 纯函数、确定性：逐场复用 battle.resolveBattle（source=sect-war），禁 Math.random；
// 同输入双跑恒等（rival.test.ts golden 断言 deepEqual）。
// 胜负终局判定与月结挂载属 settlement（E04-F04）；本模块只结算单场会战。
import type { BattleFighter, BattleReport } from "./battle.js";
import { injuryMonthsFor, runBattle } from "./battle.js";
import { getSpellById } from "./catalog.js";
import type { Spell } from "./catalog.js";
import { buildCombatProfile } from "./combat-profile.js";
import { deterministicRoll } from "./hash.js";
import { realmStageForLevel } from "./realms.js";
import type { Disciple } from "./state.js";

// ─── 会战常量（设计 §两宗对抗·会战结果）─────────────────────────────────

/** 败方阵亡判定：每阵战败者 3% 概率当场陨落（阵亡者不入伤势，由月结除名）。 */
export const WAR_DEATH_CHANCE_PCT = 3;
/** 胜方掠夺败方灵石 10%（上限 5,000，向下取整）。 */
export const WAR_PLUNDER_PCT = 0.1;
export const WAR_PLUNDER_CAP = 5000;
/** 会战声望 ±10、士气 ±5（胜方 +、败方 −）。 */
export const WAR_PRESTIGE_DELTA = 10;
export const WAR_MORALE_DELTA = 5;

/** 会战参战弟子：内门弟子 + 当月剩余禁战月数（由伤势模型换算，0/缺省 = 可出战）。 */
export type WarEligibleDisciple = Disciple & { injuryMonthsLeft?: number };

/** 会战参战资格：无未愈伤势（injuryMonthsLeft > 0 = 仍在禁战期；全军出动：名册全员含岗位/长老占用者皆出战，外门只是数字不参战）。 */
export function isWarEligible(disciple: WarEligibleDisciple): boolean {
  return !(disciple.injuryMonthsLeft && disciple.injuryMonthsLeft > 0);
}

/** 由弟子伤势模型换算当月剩余禁战月数（untilTurn 当月含仍禁战）。 */
export function injuryMonthsLeftFor(disciple: Disciple, turn: number): number {
  return disciple.injury ? Math.max(0, disciple.injury.untilTurn - turn + 1) : 0;
}

/** 战力排序：实力等级降序，同值真元高者优先，再同按 id 稳定排序。 */
function compareWarStrength(a: WarEligibleDisciple, b: WarEligibleDisciple): number {
  return b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan || a.id.localeCompare(b.id);
}

/** 出战名单：全军出动——可出战弟子全员按战力降序（同值真元高者优先，再同按 id 稳定排序）。 */
function warRosterOrder(roster: readonly WarEligibleDisciple[]): WarEligibleDisciple[] {
  return roster.filter(isWarEligible).sort(compareWarStrength);
}

export type SectWarPair = { player: WarEligibleDisciple; rival: WarEligibleDisciple };

/** 同序配对：双方全军按战力降序排列后逐位配对，打满全部对位（人数不等时按较少一方配对）。 */
export function pairSectWarFighters(
  playerRoster: readonly WarEligibleDisciple[],
  rivalRoster: readonly WarEligibleDisciple[],
): SectWarPair[] {
  const player = warRosterOrder(playerRoster);
  const rival = warRosterOrder(rivalRoster);
  const count = Math.min(player.length, rival.length);
  const pairs: SectWarPair[] = [];
  for (let i = 0; i < count; i++) {
    const p = player[i];
    const r = rival[i];
    if (p && r) pairs.push({ player: p, rival: r });
  }
  return pairs;
}

// ─── 单场会战裁决 ────────────────────────────────────────────────────────

export type PairOutcome = {
  winner: "player" | "rival" | "draw";
  /** 我方弟子本场造成的实际扣血伤害合计。 */
  playerDamage: number;
  /** 对方弟子本场造成的实际扣血伤害合计。 */
  rivalDamage: number;
};

export type SectWarVerdict = {
  winner: "player" | "rival";
  decidedBy: "wins" | "totalDamage" | "tieFavorsPlayer";
};

/** 会战裁决：胜场多者赢；胜场相同比总伤害；仍平判玩家胜（设计 §会战）。 */
export function resolveSectWar(pairOutcomes: readonly PairOutcome[]): SectWarVerdict {
  let playerWins = 0;
  let rivalWins = 0;
  let playerDamage = 0;
  let rivalDamage = 0;
  for (const pair of pairOutcomes) {
    if (pair.winner === "player") playerWins += 1;
    else if (pair.winner === "rival") rivalWins += 1;
    playerDamage += pair.playerDamage;
    rivalDamage += pair.rivalDamage;
  }
  if (playerWins !== rivalWins) {
    return { winner: playerWins > rivalWins ? "player" : "rival", decidedBy: "wins" };
  }
  if (playerDamage !== rivalDamage) {
    return { winner: playerDamage > rivalDamage ? "player" : "rival", decidedBy: "totalDamage" };
  }
  return { winner: "player", decidedBy: "tieFavorsPlayer" };
}

/** 掠夺额度：败方灵石 10%，上限 5,000，向下取整。 */
export function warPlunder(loserStones: number): number {
  return Math.min(WAR_PLUNDER_CAP, Math.floor(loserStones * WAR_PLUNDER_PCT));
}

// ─── 完整会战结算 ────────────────────────────────────────────────────────

function toCombatant(disciple: WarEligibleDisciple): BattleFighter {
  const spells = (disciple.spellIds ?? [])
    .map((id) => getSpellById(id))
    .filter((spell): spell is Spell => spell !== undefined);
  return {
    name: disciple.name,
    profile: buildCombatProfile(disciple),
    rootElements: disciple.rootElements,
    spells,
    plan: spells.map((spell) => ({ kind: "spell" as const, spellId: spell.id })),
    realm: realmStageForLevel(disciple.realmLevel).name,
  };
}

export type SectWarPairResult = PairOutcome & {
  playerFighterId: string;
  playerFighterName: string;
  rivalFighterId: string;
  rivalFighterName: string;
  /** 逐回合战报（UI 回放直接消费；A = 我方、B = 对方）。 */
  battle: BattleReport;
  /** 战败方（draw 缺省）与其伤势（供月结落到对应弟子）。 */
  loser?: { side: "player" | "rival"; discipleId: string; kind: "light" | "heavy"; months: number };
  /** 阵亡者：战败方 3% 掷骰命中（draw 缺省；阵亡者不再落伤势，由月结除名）。 */
  death?: { side: "player" | "rival"; discipleId: string; discipleName: string };
};

export type RunSectWarInput = {
  playerFighters: readonly WarEligibleDisciple[];
  rivalFighters: readonly WarEligibleDisciple[];
  seed: string;
  /** 双方灵石（掠夺额度按败方灵石 10% 计）。 */
  playerStones: number;
  rivalStones: number;
  /** 游戏月游标（进入战报与掷骰 seed；缺省 0 供独立结算）。 */
  turn?: number;
};

export type SectWarResult = SectWarVerdict & {
  seed: string;
  turn: number;
  pairOutcomes: SectWarPairResult[];
  /** 掠夺灵石额度（胜方从败方处掠得）。 */
  plunder: number;
  /** 我方声望/士气变动（胜 +10/+5、败 −10/−5）。 */
  prestigeDelta: number;
  moraleDelta: number;
};

/**
 * 结算一场全军会战：全员按战力同序配对逐位 1v1（我方为 A 方/攻方，打满全部对位）→ 裁决 → 掠夺与声望士气口径。
 * 每阵战败者再掷 3% 阵亡骰（seed 契约 `${seed}:sect-war-death:${turn}:${index}`）；
 * 参战者伤势与阵亡由调用方（月结）落到对应弟子。
 */
export function runSectWar(input: RunSectWarInput): SectWarResult {
  const turn = input.turn ?? 0;
  const pairs = pairSectWarFighters(input.playerFighters, input.rivalFighters);
  const pairOutcomes: SectWarPairResult[] = pairs.map((pair, index) => {
    // 我方为 A 方（同值先攻时攻方先），逐场独立 seed 保证可回放。
    const battle = runBattle(
      toCombatant(pair.player),
      toCombatant(pair.rival),
      `${input.seed}:sect-war:${index}`,
      {
        source: "sect-war",
        turn,
      },
    );
    const winner = battle.winner === "A" ? "player" : battle.winner === "B" ? "rival" : "draw";
    const totalDamage = battle.totalDamage;
    let loser: SectWarPairResult["loser"];
    if (battle.winner === "A" && battle.injuries.B !== "none") {
      loser = {
        side: "rival",
        discipleId: pair.rival.id,
        kind: battle.injuries.B,
        months: injuryMonthsFor(battle.injuries.B),
      };
    } else if (battle.winner === "B" && battle.injuries.A !== "none") {
      loser = {
        side: "player",
        discipleId: pair.player.id,
        kind: battle.injuries.A,
        months: injuryMonthsFor(battle.injuries.A),
      };
    }
    let death: SectWarPairResult["death"];
    if (battle.winner === "A" || battle.winner === "B") {
      const fallen = battle.winner === "A" ? pair.rival : pair.player;
      const deathRoll = deterministicRoll(`${input.seed}:sect-war-death:${turn}:${index}`);
      if (deathRoll < WAR_DEATH_CHANCE_PCT) {
        death = {
          side: fallen === pair.player ? "player" : "rival",
          discipleId: fallen.id,
          discipleName: fallen.name,
        };
      }
    }
    return {
      winner,
      playerDamage: totalDamage.A,
      rivalDamage: totalDamage.B,
      playerFighterId: pair.player.id,
      playerFighterName: pair.player.name,
      rivalFighterId: pair.rival.id,
      rivalFighterName: pair.rival.name,
      battle,
      loser,
      death,
    };
  });

  let verdict: SectWarVerdict;
  if (pairOutcomes.length === 0) {
    // 无可配对战力：单边无人应战判负；双方皆无人按平局偏袒玩家口径。
    verdict =
      input.playerFighters.length === 0 && input.rivalFighters.length > 0
        ? { winner: "rival", decidedBy: "wins" }
        : { winner: "player", decidedBy: "tieFavorsPlayer" };
  } else {
    verdict = resolveSectWar(pairOutcomes);
  }

  const plunder =
    verdict.winner === "player" ? warPlunder(input.rivalStones) : warPlunder(input.playerStones);
  return {
    seed: input.seed,
    turn,
    pairOutcomes,
    ...verdict,
    plunder,
    prestigeDelta: verdict.winner === "player" ? WAR_PRESTIGE_DELTA : -WAR_PRESTIGE_DELTA,
    moraleDelta: verdict.winner === "player" ? WAR_MORALE_DELTA : -WAR_MORALE_DELTA,
  };
}

// ─── 会战记录（落 GameState.sectWars 供 UI 会战记录页消费）──────────────

export type SectWarRecord = SectWarResult & {
  /** 对方声望/士气变动（胜方 +10/+5、败方 −10/−5，与玩家侧对称）。 */
  rivalPrestigeDelta: number;
  rivalMoraleDelta: number;
  summary: string;
};

/** 由结算结果构造存档记录（summary 供纪事与会战记录页直接展示；有阵亡时附双亡人数）。 */
export function sectWarRecord(result: SectWarResult, rivalName: string): SectWarRecord {
  const playerDeaths = result.pairOutcomes.filter((pair) => pair.death?.side === "player").length;
  const rivalDeaths = result.pairOutcomes.filter((pair) => pair.death?.side === "rival").length;
  const deathNote =
    playerDeaths + rivalDeaths > 0
      ? `（我方阵亡 ${playerDeaths} 人，对方阵亡 ${rivalDeaths} 人）`
      : "";
  const summary =
    result.winner === "player"
      ? `会战获胜：击退${rivalName}，掠得灵石 ${result.plunder} 枚（${result.decidedBy === "wins" ? "胜场占优" : result.decidedBy === "totalDamage" ? "总伤害占优" : "势均力敌，天命在我"}）${deathNote}。`
      : `会战失利：不敌${rivalName}，被掠走灵石 ${result.plunder} 枚${deathNote}。`;
  return {
    ...result,
    rivalPrestigeDelta: result.winner === "player" ? -WAR_PRESTIGE_DELTA : WAR_PRESTIGE_DELTA,
    rivalMoraleDelta: result.winner === "player" ? -WAR_MORALE_DELTA : WAR_MORALE_DELTA,
    summary,
  };
}
