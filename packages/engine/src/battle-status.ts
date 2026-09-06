// 状态效果系统（设计文档 §战斗系统·状态效果 D-012）。
// 五类状态：灼烧 / 冰冻 / 减速 / 护盾（可带反伤）/ 反伤；同状态不叠加、异源刷新取最强
//（强度与剩余时长各取最大）。本模块只做状态纯逻辑（附加/衰减/吸收/反伤/抗性判定）；
// 掷骰由 battle.ts 以 seed 域完成后传入（禁 Math.random，一律 sha256）。
import type { SpellStatusEffect } from "./catalog.js";

/** 灼烧：行动后每回合扣最大生命 hpPctPerTurn%（弱 6%×3 回合 / 强 8%×2 回合），可致死。 */
export const BURN_WEAK = { hpPctPerTurn: 6, turns: 3 };
export const BURN_STRONG = { hpPctPerTurn: 8, turns: 2 };
/** 冰冻：1 回合无法行动（被跳过行动时消耗）。 */
export const FREEZE_TURNS = 1;
/** 减速：先攻 −5，持续 3 回合。 */
export const SLOW_FIRST_STRIKE_FLAT = 5;
export const SLOW_TURNS = 3;
/** 反伤：受击反弹实际扣血伤害的 10%。 */
export const REFLECT_PCT = 10;

export type BurnStatus = { kind: "burn"; hpPctPerTurn: number; turnsLeft: number };
export type FreezeStatus = { kind: "freeze"; turnsLeft: number };
export type SlowStatus = { kind: "slow"; firstStrikeFlat?: number; turnsLeft: number };
/** 护盾：吸收伤害直至破除；reflectPct > 0 时受击反弹（灵龟盾）。turnsLeft 恒无（不随回合衰减）。 */
export type ShieldStatus = {
  kind: "shield";
  absorbLeft: number;
  reflectPct: number;
  turnsLeft?: undefined;
};

/** 战斗中身上的活动状态；同类状态至多 1 条（不叠加，异源附加取最强）。 */
export type ActiveStatus = BurnStatus | FreezeStatus | SlowStatus | ShieldStatus;

export type StatusTick = {
  /** 本次衰减造成的直接伤害（仅灼烧 > 0：直接扣血、不受护盾影响、可致死）。 */
  damage: number;
  /** 衰减后的状态；回合数耗尽时为 undefined。 */
  status: ActiveStatus | undefined;
};

/** 回合末衰减：灼烧结算伤害并扣减回合数；冰冻/减速只扣减回合数；护盾不随回合衰减。 */
export function tickStatus(status: ActiveStatus, maxHp: number): StatusTick {
  if (status.kind === "shield") return { damage: 0, status };
  const turnsLeft = status.turnsLeft - 1;
  if (status.kind === "burn") {
    return {
      damage: Math.round((maxHp * status.hpPctPerTurn) / 100),
      status:
        turnsLeft > 0 ? { kind: "burn", hpPctPerTurn: status.hpPctPerTurn, turnsLeft } : undefined,
    };
  }
  if (status.kind === "slow") {
    const next: SlowStatus = { kind: "slow", turnsLeft };
    if (status.firstStrikeFlat !== undefined) next.firstStrikeFlat = status.firstStrikeFlat;
    return { damage: 0, status: turnsLeft > 0 ? next : undefined };
  }
  return { damage: 0, status: turnsLeft > 0 ? { kind: "freeze", turnsLeft } : undefined };
}

/** 同状态不叠加、异源附加取最强：强度与剩余时长各取最大（护盾取剩余吸收与反伤最大）。 */
export function attachStatus(existing: ActiveStatus, incoming: ActiveStatus): ActiveStatus {
  if (existing.kind === "burn" && incoming.kind === "burn") {
    return {
      kind: "burn",
      hpPctPerTurn: Math.max(existing.hpPctPerTurn, incoming.hpPctPerTurn),
      turnsLeft: Math.max(existing.turnsLeft, incoming.turnsLeft),
    };
  }
  if (existing.kind === "freeze" && incoming.kind === "freeze") {
    return { kind: "freeze", turnsLeft: Math.max(existing.turnsLeft, incoming.turnsLeft) };
  }
  if (existing.kind === "slow" && incoming.kind === "slow") {
    const flat = Math.max(existing.firstStrikeFlat ?? 0, incoming.firstStrikeFlat ?? 0);
    const merged: SlowStatus = {
      kind: "slow",
      turnsLeft: Math.max(existing.turnsLeft, incoming.turnsLeft),
    };
    if (flat > 0) merged.firstStrikeFlat = flat;
    return merged;
  }
  if (existing.kind === "shield" && incoming.kind === "shield") {
    return {
      kind: "shield",
      absorbLeft: Math.max(existing.absorbLeft, incoming.absorbLeft),
      reflectPct: Math.max(existing.reflectPct, incoming.reflectPct),
    };
  }
  return incoming;
}

/** 状态抗性判定：掷骰结果 roll（[0,100)）低于抗性百分点即抵消附加。 */
export function statusResisted(roll: number, resistPct: number): boolean {
  return roll < resistPct;
}

/** 护盾容量 = round(最大生命 × shieldPct%)。 */
export function shieldCapacity(maxHp: number, shieldPct: number): number {
  return Math.round((maxHp * shieldPct) / 100);
}

/** 护盾吸收：先扣盾，溢出部分为实际扣血；盾破（剩余 0）后由调用方移除。 */
export function absorbWithShield(
  shieldLeft: number,
  damage: number,
): { shieldLeft: number; hpDamage: number } {
  const absorbed = Math.min(shieldLeft, damage);
  return { shieldLeft: shieldLeft - absorbed, hpDamage: damage - absorbed };
}

/** 反伤：反弹实际扣血伤害的 10%（四舍五入）。 */
export function reflectDamage(hpDamage: number): number {
  return Math.round((hpDamage * REFLECT_PCT) / 100);
}

/** 由法术状态描述构造灼烧/冰冻/减速的活动状态（护盾需要最大生命，由战斗引擎构造）。 */
export function statusFromSpellSpec(
  spec: SpellStatusEffect,
): Exclude<ActiveStatus, ShieldStatus> | undefined {
  if (spec.burn) {
    return { kind: "burn", hpPctPerTurn: spec.burn.hpPctPerTurn, turnsLeft: spec.burn.turns };
  }
  if (spec.freeze) {
    return { kind: "freeze", turnsLeft: spec.freeze.turns };
  }
  if (spec.slow) {
    const next: SlowStatus = { kind: "slow", turnsLeft: spec.slow.turns };
    if (spec.slow.firstStrikeFlat !== undefined) next.firstStrikeFlat = spec.slow.firstStrikeFlat;
    return next;
  }
  return undefined;
}
