import {
  type ActiveStatus,
  SLOW_FIRST_STRIKE_FLAT,
  absorbWithShield,
  attachStatus,
  reflectDamage,
  shieldCapacity,
  statusFromSpellSpec,
  statusResisted,
  tickStatus,
} from "./battle-status.js";
// 1v1 回合制战斗引擎（设计文档 §战斗系统·回合规则 D-011；状态 D-012；伤势 D-013）。
// 纯函数、确定性：掷骰一律走 hash.deterministicRoll（sha256），禁 Math.random；
// 战报为逐条目扁平时间线（行动/伤害/状态/剩余生命），UI 回放直接消费；
// 同输入双跑恒等（测试断言 deepEqual）。
import type { SpellElement, SpellStatusEffect } from "./catalog.js";
import { spellAffinityMultiplier } from "./catalog.js";
import type { CombatProfile } from "./combat-profile.js";
import { deterministicRoll } from "./hash.js";
import type { RootElement } from "./roots.js";

// ─── 回合规则常量（设计 §战斗系统·回合规则/伤势）─────────────────────────

/** 命中率 90 固定（百分点）。 */
export const HIT_RATE = 90;
/** 暴伤倍率：暴击对取整后基础伤害再 ×2。 */
export const CRIT_MULTIPLIER = 2;
/** 普通攻伐倍率（物理 1.0×）。 */
export const BASIC_ATTACK_MULTIPLIER = 1;
/** 最多 30 回合，未分胜负判平（双方无伤势）。 */
export const MAX_BATTLE_ROUNDS = 30;
/** 防御减伤系数：伤害 = max(1, round(攻击×倍率 − 防御×0.8))；暴击对取整后基础伤害再 ×2。 */
export const DEFENSE_MITIGATION = 0.8;
/** 战败伤势：40% 轻伤（禁战 1 月）、20% 重伤（禁战 3 月）、其余无伤。 */
export const DEFEAT_LIGHT_INJURY_PCT = 40;
export const DEFEAT_HEAVY_INJURY_PCT = 20;
export const LIGHT_INJURY_MONTHS = 1;
export const HEAVY_INJURY_MONTHS = 3;

export type BattleSpell = {
  id: string;
  name: string;
  element: SpellElement;
  /** 伤害倍率（× 法威）；≤ 0 视为纯增益法术（护盾类，作用于自身、不掷命中）。 */
  multiplier: number;
  /** 冷却回合数：第 r 回合施放，第 r + cooldown 回合再度可用。 */
  cooldown: number;
  /** 状态附加描述（灼烧/冰冻/减速/护盾/反伤/吸血/破防）。 */
  status?: SpellStatusEffect;
};

export type BattlePlanEntry = { kind: "basic" } | { kind: "spell"; spellId: string };

export type BattleFighter = {
  name: string;
  profile: CombatProfile;
  /** 灵根元素：法术同系威力 +15% 判定输入。 */
  rootElements: readonly RootElement[];
  /** 已修法术；行动策略由 plan 驱动，CD 未好自动回落普通攻伐。 */
  spells: readonly BattleSpell[];
  /** 确定性行动脚本：每次行动按序循环取用。 */
  plan: readonly BattlePlanEntry[];
};

export type BattleSide = "A" | "B";

export type BattleActionKind = "basic" | "spell" | "skip" | "burn";

/** 战报条目：行动（basic/spell）、冰冻跳过（skip）、回合末灼烧结算（burn）。 */
export type BattleActionEntry = {
  round: number;
  actor: BattleSide;
  kind: BattleActionKind;
  spellId?: string;
  hit?: boolean;
  crit?: boolean;
  /** 名义伤害（普攻/法术：命中后按公式；灼烧：直接扣血值；未命中/跳过：0）。 */
  damage: number;
  /** 目标实际生命损失（护盾吸收后）。 */
  hpLoss: number;
  /** 目标护盾吸收量。 */
  shieldAbsorbed: number;
  /** 行动方吸血回复量。 */
  lifestealHeal: number;
  /** 行动方被反伤量。 */
  reflectDamage: number;
  /** 该条目结算后的剩余生命。 */
  hp: { A: number; B: number };
  /** 状态标注（附加/触发/抵消/结算说明）。 */
  statusNotes: string[];
};

export type BattleInjuryKind = "none" | "light" | "heavy";

export type BattleReport = {
  seed: string;
  /** 胜者侧别；30 回合未分胜负为 "draw"。 */
  winner: BattleSide | "draw";
  /** 实际进行回合数（平局 = 30）。 */
  rounds: number;
  fighters: { A: string; B: string };
  actions: BattleActionEntry[];
  /** 双方造成的名义伤害合计（会战 1:1:1 平局比总伤害的输入）。 */
  totalDamage: { A: number; B: number };
  /** 伤势：胜利方恒为 none；战败方掷骰 40% light / 20% heavy；平局双方 none。 */
  injuries: { A: BattleInjuryKind; B: BattleInjuryKind };
  finalHp: { A: number; B: number };
  /** 伤势对应禁战月数（none 0 / light 1 / heavy 3）。 */
  injuryMonths: Record<BattleInjuryKind, number>;
  /** 来源标记（expedition / sparring / sect-war 等）。 */
  source?: string;
  /** 游戏月游标。 */
  turn?: number;
};

export type RunBattleContext = {
  source?: string;
  turn?: number;
};

/** 伤害公式：max(1, round(攻击×倍率 − 防御×0.8×(1−无视防御%)))；暴击对基础伤害再 ×2。 */
export function computeDamage(params: {
  attack: number;
  multiplier: number;
  defense: number;
  crit?: boolean;
  ignoreDefensePct?: number;
}): number {
  const defenseTerm =
    params.defense * DEFENSE_MITIGATION * (1 - (params.ignoreDefensePct ?? 0) / 100);
  const raw = Math.max(1, Math.round(params.attack * params.multiplier - defenseTerm));
  return params.crit ? Math.round(raw * CRIT_MULTIPLIER) : raw;
}

/** 伤势对应禁战月数。 */
export function injuryMonthsFor(kind: BattleInjuryKind): number {
  if (kind === "light") return LIGHT_INJURY_MONTHS;
  if (kind === "heavy") return HEAVY_INJURY_MONTHS;
  return 0;
}

type StatusKind = ActiveStatus["kind"];

type FighterRuntime = {
  side: BattleSide;
  fighter: BattleFighter;
  hp: number;
  /** spellId → 剩余冷却回合数（0 = 可用）。 */
  cooldowns: Map<string, number>;
  /** 活动状态；同类至多 1 条（不叠加）。 */
  statuses: ActiveStatus[];
  /** 行动脚本游标。 */
  planIndex: number;
  /** 本回合新附加的状态类别：回合末不衰减（次回合起结算）。 */
  freshKinds: Set<StatusKind>;
};

const OPPOSITE: Record<BattleSide, BattleSide> = { A: "B", B: "A" };

const STATUS_DISPLAY_NAMES: Record<StatusKind, string> = {
  burn: "灼烧",
  freeze: "冰冻",
  slow: "减速",
  shield: "护盾",
};

function initRuntime(side: BattleSide, fighter: BattleFighter): FighterRuntime {
  return {
    side,
    fighter,
    hp: fighter.profile.maxHp,
    cooldowns: new Map(),
    statuses: [],
    planIndex: 0,
    freshKinds: new Set(),
  };
}

function findStatus(rt: FighterRuntime, kind: StatusKind): ActiveStatus | undefined {
  return rt.statuses.find((status) => status.kind === kind);
}

function replaceStatus(rt: FighterRuntime, kind: StatusKind, next: ActiveStatus | undefined): void {
  rt.statuses = rt.statuses.filter((status) => status.kind !== kind);
  if (next) rt.statuses.push(next);
}

/** 当前先攻 = 先攻值 − Σ减速惩罚。 */
function effectiveFirstStrike(rt: FighterRuntime): number {
  let penalty = 0;
  for (const status of rt.statuses) {
    if (status.kind === "slow") penalty += status.firstStrikeFlat ?? SLOW_FIRST_STRIKE_FLAT;
  }
  return rt.fighter.profile.firstStrike - penalty;
}

function tickCooldowns(rt: FighterRuntime): void {
  for (const [spellId, remaining] of rt.cooldowns) {
    rt.cooldowns.set(spellId, Math.max(0, remaining - 1));
  }
}

function hpSnapshot(runts: Record<BattleSide, FighterRuntime>): { A: number; B: number } {
  return { A: runts.A.hp, B: runts.B.hp };
}

function pushEntry(
  actions: BattleActionEntry[],
  entry: Omit<BattleActionEntry, "hpLoss" | "shieldAbsorbed" | "lifestealHeal" | "reflectDamage"> &
    Partial<
      Pick<BattleActionEntry, "hpLoss" | "shieldAbsorbed" | "lifestealHeal" | "reflectDamage">
    >,
): void {
  const action = {
    hpLoss: 0,
    shieldAbsorbed: 0,
    lifestealHeal: 0,
    reflectDamage: 0,
    ...entry,
  };
  // 可选字段不落 undefined 键：快照走 JSON 序列化会丢键，内存态须与存档往返一致（D-022）。
  for (const key of ["spellId", "hit", "crit"] as const) {
    if (action[key] === undefined) delete action[key];
  }
  actions.push(action);
}

/** 行动前结算：冰冻跳过行动并消耗冰冻回合。 */
function consumeFreeze(
  rt: FighterRuntime,
  frozen: ActiveStatus,
  round: number,
  runts: Record<BattleSide, FighterRuntime>,
  actions: BattleActionEntry[],
): void {
  const tick = tickStatus(frozen, rt.fighter.profile.maxHp);
  replaceStatus(rt, "freeze", tick.status);
  pushEntry(actions, {
    round,
    actor: rt.side,
    kind: "skip",
    damage: 0,
    hp: hpSnapshot(runts),
    statusNotes: [`${rt.fighter.name} 被冰冻，跳过行动`],
  });
}

/** 法术状态附加（灼烧/冰冻/减速 → 目标）：触发概率掷骰 → 抗性掷骰 → 合并取最强。 */
function applySpellStatus(
  spell: BattleSpell,
  round: number,
  actorRt: FighterRuntime,
  targetRt: FighterRuntime,
  rollBase: string,
  notes: string[],
): void {
  const spec = spell.status;
  if (!spec) return;
  const status = statusFromSpellSpec(spec);
  if (!status) return;
  if (
    status.kind === "freeze" &&
    spec.freeze?.chancePct !== undefined &&
    spec.freeze.chancePct < 100
  ) {
    const roll = deterministicRoll(
      `${rollBase}:r${round}:${actorRt.side}:${spell.id}:freeze-chance`,
    );
    if (roll >= spec.freeze.chancePct) {
      notes.push(`冰冻未触发（${spec.freeze.chancePct}% 概率）`);
      return;
    }
  }
  const resistPct = targetRt.fighter.profile.statusResistPct;
  if (resistPct > 0) {
    const roll = deterministicRoll(`${rollBase}:r${round}:${targetRt.side}:status-resist`);
    if (statusResisted(roll, resistPct)) {
      notes.push(`${targetRt.fighter.name} 的抗性抵消了${STATUS_DISPLAY_NAMES[status.kind]}`);
      return;
    }
  }
  const existing = findStatus(targetRt, status.kind);
  const merged = existing ? attachStatus(existing, status) : status;
  replaceStatus(targetRt, status.kind, merged);
  targetRt.freshKinds.add(status.kind);
  notes.push(
    `${targetRt.fighter.name} 被附加${STATUS_DISPLAY_NAMES[status.kind]}${
      status.kind === "burn"
        ? `（每回合 ${status.hpPctPerTurn}% 最大生命，持续 ${status.turnsLeft} 回合）`
        : ""
    }`,
  );
}

function applyShieldFromSpell(spell: BattleSpell, rt: FighterRuntime, notes: string[]): void {
  const shieldPct = spell.status?.shieldHpPct;
  if (!shieldPct) return;
  const capacity = shieldCapacity(rt.fighter.profile.maxHp, shieldPct);
  const reflectPct = spell.status?.reflectPct ?? 0;
  const incoming: ActiveStatus = { kind: "shield", absorbLeft: capacity, reflectPct };
  const existing = findStatus(rt, "shield");
  const merged = existing ? attachStatus(existing, incoming) : incoming;
  if (merged.kind !== "shield") return;
  replaceStatus(rt, "shield", merged);
  notes.push(
    `${rt.fighter.name} 获得护盾（吸收 ${merged.absorbLeft} 点${
      merged.reflectPct > 0 ? `，受击反弹 ${merged.reflectPct}%` : ""
    }）`,
  );
}

type AttackOutcome = { killedTarget: boolean; killedActor: boolean };

function performAttack(
  round: number,
  actorRt: FighterRuntime,
  targetRt: FighterRuntime,
  runts: Record<BattleSide, FighterRuntime>,
  rollBase: string,
  actions: BattleActionEntry[],
): AttackOutcome {
  const actorFighter = actorRt.fighter;
  const targetFighter = targetRt.fighter;
  const notes: string[] = [];

  // 行动脚本：循环取用；目标法术 CD 未好时回落普通攻伐。
  const planLength = actorFighter.plan.length;
  const planEntry = planLength > 0 ? actorFighter.plan[actorRt.planIndex % planLength] : undefined;
  actorRt.planIndex += 1;

  let kind: "basic" | "spell" = "basic";
  let spellId: string | undefined;
  let spell: BattleSpell | undefined;
  if (planEntry?.kind === "spell") {
    const candidate = actorFighter.spells.find((entry) => entry.id === planEntry.spellId);
    if (candidate && (actorRt.cooldowns.get(candidate.id) ?? 0) <= 0) spell = candidate;
  }

  let attack: number;
  let multiplier: number;
  let ignoreDefensePct = 0;
  let spellLifestealPct = 0;
  let selfCast = false;
  if (spell) {
    kind = "spell";
    spellId = spell.id;
    actorRt.cooldowns.set(spell.id, spell.cooldown);
    if (spell.multiplier <= 0) selfCast = true;
    attack =
      actorFighter.profile.magicPower * spellAffinityMultiplier(spell, actorFighter.rootElements);
    multiplier = spell.multiplier;
    ignoreDefensePct = spell.status?.ignoreDefensePct ?? 0;
    spellLifestealPct = spell.status?.lifestealPct ?? 0;
  } else {
    attack = actorFighter.profile.physicalAttack;
    multiplier = BASIC_ATTACK_MULTIPLIER;
  }

  let hit = false;
  let crit = false;
  let damage = 0;
  let shieldAbsorbed = 0;
  let hpLoss = 0;
  let lifestealHeal = 0;
  let reflectDamageDealt = 0;

  if (selfCast) {
    // 纯增益法术（护盾类）作用于自身：不掷命中、不造成伤害。
    applyShieldFromSpell(spell as BattleSpell, actorRt, notes);
  } else {
    hit = deterministicRoll(`${rollBase}:r${round}:${actorRt.side}:hit`) < HIT_RATE;
    if (hit) {
      crit =
        deterministicRoll(`${rollBase}:r${round}:${actorRt.side}:crit`) <
        actorFighter.profile.critRate;
      damage = computeDamage({
        attack,
        multiplier,
        defense: targetFighter.profile.defense,
        crit,
        ignoreDefensePct,
      });
      const shield = findStatus(targetRt, "shield");
      if (shield && shield.kind === "shield") {
        const absorbed = absorbWithShield(shield.absorbLeft, damage);
        shieldAbsorbed = damage - absorbed.hpDamage;
        hpLoss = absorbed.hpDamage;
        if (shieldAbsorbed > 0) notes.push(`护盾吸收 ${shieldAbsorbed} 点伤害`);
        if (absorbed.shieldLeft <= 0) {
          replaceStatus(targetRt, "shield", undefined);
          notes.push(`${targetFighter.name} 的护盾破碎`);
        } else {
          replaceStatus(targetRt, "shield", { ...shield, absorbLeft: absorbed.shieldLeft });
        }
        if (hpLoss > 0 && shield.reflectPct > 0) {
          reflectDamageDealt = reflectDamage(hpLoss);
          if (reflectDamageDealt > 0) {
            actorRt.hp = Math.max(0, actorRt.hp - reflectDamageDealt);
            notes.push(`${targetFighter.name} 反伤 ${reflectDamageDealt} 点伤害`);
          }
        }
      } else {
        hpLoss = damage;
      }
      if (hpLoss > 0) targetRt.hp = Math.max(0, targetRt.hp - hpLoss);
      if (hpLoss > 0 && damage > 0) {
        // 吸血：天赋吸血 + 法术吸血，按名义伤害回量（击杀亦回血），不越过最大生命。
        const lifestealPct = actorFighter.profile.lifestealPct + spellLifestealPct;
        if (lifestealPct > 0) {
          lifestealHeal = Math.min(
            Math.round((damage * lifestealPct) / 100),
            actorFighter.profile.maxHp - actorRt.hp,
          );
          if (lifestealHeal > 0) {
            actorRt.hp += lifestealHeal;
            notes.push(`${actorFighter.name} 吸血回复 ${lifestealHeal} 点生命`);
          }
        }
      }
      if (spell && hit) applySpellStatus(spell, round, actorRt, targetRt, rollBase, notes);
    }
  }

  pushEntry(actions, {
    round,
    actor: actorRt.side,
    kind,
    spellId,
    hit: selfCast ? undefined : hit,
    crit: selfCast ? undefined : crit,
    damage,
    hpLoss,
    shieldAbsorbed,
    lifestealHeal,
    reflectDamage: reflectDamageDealt,
    hp: hpSnapshot(runts),
    statusNotes: notes,
  });
  return { killedTarget: targetRt.hp <= 0, killedActor: actorRt.hp <= 0 };
}

/** 回合末结算：灼烧直接扣血（可致死，不受护盾影响）与减速衰减；本回合新附加的状态不结算。 */
function settleRoundEnd(
  rt: FighterRuntime,
  round: number,
  runts: Record<BattleSide, FighterRuntime>,
  actions: BattleActionEntry[],
): void {
  const burn = findStatus(rt, "burn");
  if (burn && burn.kind === "burn" && !rt.freshKinds.has("burn")) {
    const tick = tickStatus(burn, rt.fighter.profile.maxHp);
    replaceStatus(rt, "burn", tick.status);
    rt.hp = Math.max(0, rt.hp - tick.damage);
    pushEntry(actions, {
      round,
      actor: rt.side,
      kind: "burn",
      damage: tick.damage,
      hp: hpSnapshot(runts),
      statusNotes: [
        `${rt.fighter.name} 灼烧结算：损失 ${tick.damage} 点生命（每回合 ${burn.hpPctPerTurn}% 最大生命）`,
      ],
    });
  }
  const slow = findStatus(rt, "slow");
  if (slow && slow.kind === "slow" && !rt.freshKinds.has("slow")) {
    const tick = tickStatus(slow, rt.fighter.profile.maxHp);
    replaceStatus(rt, "slow", tick.status);
  }
}

function rollInjury(rollBase: string, side: BattleSide): BattleInjuryKind {
  const roll = deterministicRoll(`${rollBase}:injury:${side}`);
  if (roll < DEFEAT_LIGHT_INJURY_PCT) return "light";
  if (roll < DEFEAT_LIGHT_INJURY_PCT + DEFEAT_HEAVY_INJURY_PCT) return "heavy";
  return "none";
}

/** 解决一场 1v1 战斗：先攻定序 → 逐回合行动（法术 CD 回落普攻）→ 回合末灼烧结算 → 30 回合平局 → 伤势掷骰。 */
export function runBattle(
  attacker: BattleFighter,
  defender: BattleFighter,
  seed: string,
  context: RunBattleContext = {},
): BattleReport {
  const trimmedSeed = seed.trim();
  if (trimmedSeed.length === 0) throw new Error("battle_seed_invalid");
  const rollBase = `${trimmedSeed}:battle`;
  const runts: Record<BattleSide, FighterRuntime> = {
    A: initRuntime("A", attacker),
    B: initRuntime("B", defender),
  };
  const actions: BattleActionEntry[] = [];
  let winner: BattleSide | "draw" | undefined;
  let rounds = 0;

  for (let round = 1; round <= MAX_BATTLE_ROUNDS && !winner; round++) {
    rounds = round;
    // 先攻定序：先攻高者先行动，同值攻方（A 方）先。
    const order: [FighterRuntime, FighterRuntime] =
      effectiveFirstStrike(runts.B) > effectiveFirstStrike(runts.A)
        ? [runts.B, runts.A]
        : [runts.A, runts.B];
    for (const actorRt of order) {
      if (winner) break;
      // 冰冻自次回合起生效：当回合新附加的冰冻不跳过本回合行动。
      const frozen = findStatus(actorRt, "freeze");
      if (frozen && !actorRt.freshKinds.has("freeze")) {
        consumeFreeze(actorRt, frozen, round, runts, actions);
        continue;
      }
      const targetRt = runts[OPPOSITE[actorRt.side]];
      const outcome = performAttack(round, actorRt, targetRt, runts, rollBase, actions);
      if (outcome.killedTarget) {
        winner = actorRt.side;
        break;
      }
      if (outcome.killedActor) {
        winner = targetRt.side;
        break;
      }
    }
    if (winner) break;
    for (const rt of [runts.A, runts.B]) {
      settleRoundEnd(rt, round, runts, actions);
      if (rt.hp <= 0) {
        winner = runts[OPPOSITE[rt.side]].side;
        break;
      }
    }
    if (winner) break;
    for (const rt of [runts.A, runts.B]) {
      tickCooldowns(rt);
      rt.freshKinds.clear();
    }
  }

  const result: BattleSide | "draw" = winner ?? "draw";
  const injuries: { A: BattleInjuryKind; B: BattleInjuryKind } = { A: "none", B: "none" };
  if (result !== "draw") injuries[OPPOSITE[result]] = rollInjury(rollBase, OPPOSITE[result]);

  const totalDamage: { A: number; B: number } = { A: 0, B: 0 };
  for (const action of actions) {
    if (action.kind === "basic" || action.kind === "spell") {
      totalDamage[action.actor] += action.damage;
    }
  }

  return {
    seed: trimmedSeed,
    winner: result,
    rounds,
    fighters: { A: attacker.name, B: defender.name },
    actions,
    totalDamage,
    injuries,
    finalHp: { A: runts.A.hp, B: runts.B.hp },
    injuryMonths: { none: 0, light: LIGHT_INJURY_MONTHS, heavy: HEAVY_INJURY_MONTHS },
    source: context.source,
    turn: context.turn,
  };
}

// ─── 对象签名入口（epic 命名位，历练/会战调用方使用）─────────────────────

/** 战斗来源标记（expedition / sparring / sect-war 等，仅随战报记录）。 */
export type BattleSource = string;

/** 战斗参战者（BattleFighter 的领域别名）。 */
export type BattleCombatant = BattleFighter;

export type ResolveBattleInput = {
  seed: string;
  /** 游戏月游标（进入战报记录）。 */
  turn: number;
  source: BattleSource;
  attacker: BattleCombatant;
  defender: BattleCombatant;
};

/** resolveBattle：带来源与月游标标记的 runBattle 对象签名入口，战报等价。 */
export function resolveBattle(input: ResolveBattleInput): BattleReport {
  return runBattle(input.attacker, input.defender, input.seed, {
    source: input.source,
    turn: input.turn,
  });
}
