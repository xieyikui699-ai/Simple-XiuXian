// 游戏状态类型：唯一事实源是 GameState 快照，UI 层负责持久化（小程序本地存储）。
// M2 扩展字段（library/jobs/warehouse、弟子功法法术装备）均为可选：旧档缺字段时按空值口径兼容。
import type { DiscipleAttributes } from "./attributes.js";
import type { BattleReport } from "./battle.js";
import {
  type CraftJobKind,
  type EquippedGear,
  GEAR_SLOT_KEYS,
  GEAR_TIERS,
  type GearSlot,
  type GearTier,
  representativeTreasureOfTier,
} from "./catalog.js";
import type { ExpeditionReport } from "./expedition.js";
import type { RivalSect } from "./rival.js";
import type { RootElement, RootType } from "./roots.js";
import type { SectWarRecord } from "./sect-war.js";

/** 伤势档位：轻伤禁战 1 月 / 重伤禁战 3 月（与 battle.ts 战败伤势同词汇表）。 */
export type InjuryKind = "light" | "severe";

/** 伤势：untilTurn 当回目（含）仍禁战，下一回目起可出战（恢复按回目自然到期）。 */
export type Injury = {
  kind: InjuryKind;
  untilTurn: number;
};

export type Disciple = {
  id: string;
  name: string;
  gender: "male" | "female";
  age: number;
  /** 坐化年龄基准（70–108）；有效坐化年龄另加境界/天赋/丹药加成。 */
  maxLifespan: number;
  realm: string;
  /** 实力等级 1–10。 */
  realmLevel: number;
  zhenyuan: number;
  breakthroughFailures: number;
  rootType: RootType;
  rootElements: RootElement[];
  attributes: DiscipleAttributes;
  talentIds: string[];
  /** 已修功法（限 1 门；旧档缺省 = 未修）。 */
  techniqueId?: string;
  /** 已修法术（限 2 门；旧档缺省 = 空）。 */
  spellIds?: string[];
  /** 已穿戴装备（槽位 → 法宝 id；旧档缺省 = 空）。 */
  equippedGear?: EquippedGear;
  /** 聚灵丹增益：该回目（含）之前真元获取 ×1.5；重复服用倍率不叠加、时长在剩余月数上累加。 */
  spiritFocusUntilTurn?: number;
  /** 未愈伤势；缺省 = 无伤（旧档兼容）。 */
  injury?: Injury;
};

export type ChronicleKind = "normal" | "milestone" | "warning";

export type ChronicleEntry = {
  turn: number;
  kind: ChronicleKind;
  text: string;
};

export type EndingKind = "annexation" | "annexed" | "bankrupt";

/** 仙途评级四档（设计 §胜负与结局评价；阈值见 settlement.ENDING_RATING_THRESHOLDS）。 */
export type EndingRating = "甲" | "乙" | "丙" | "丁";

export type GameEnding = {
  kind: EndingKind;
  turn: number;
  text: string;
  /** 仙途评级（E04-F04 结局评价；M1 旧档缺省）。 */
  rating?: EndingRating;
  /** 综合得分（满分 10）。 */
  score?: number;
};

export type FallenDisciple = {
  name: string;
  diedTurn: number;
};

/** 藏经阁拥有的功法/法术书（研读资格来源；历练奇遇入阁）。 */
export type SectLibrary = {
  techniqueIds: string[];
  spellIds: string[];
};

/**
 * 在炉任务（丹房 = 炼丹、器坊 = 炼法宝；挂任务免费，月结按投入人手推进点数并扣月耗）。
 * 丹房不选丹方、器坊不选图纸：点数各自统一（PILL_TASK_POINTS / GEAR_TASK_POINTS），
 * 满点出炉时丹房在两种丹药中随机（各 50%）、器坊在法宝目录十件中随机其一。
 * accumulatedPoints 为浮点累积（主持加速为乘算小数），满 totalPoints 即出炉。
 */
export type WorkshopTask =
  | { kind: "pill"; accumulatedPoints: number }
  | { kind: "gear"; accumulatedPoints: number };

/**
 * 车间（丹房/器坊）状态：外门投入制（参考完整版 crafting-v2，简化掉多炉与成功率）。
 * - masters（沿用 workers 字段名）：主持弟子（丹师/工匠）至多 1 名，境界越高加成越高
 *   （每境界等级 +20%，元婴前期 +200% 封顶；无主持照常开工）。
 * - assignedOuter：投入的外门弟子人数（≥1 即自动开炉挂默认任务）；两房合计 ≤ 外门总数，人数越多推进越快。
 * - task：在炉任务；满点自动出炉入仓库并连炉（进度清零续炼同任务，换任务即打断）。
 */
export type WorkshopState = {
  /** 主持弟子（丹师/工匠的 discipleId，至多 1 名；不历练，修炼照常）。 */
  workers: string[];
  /** 投入的外门弟子人数（外门只是数字；0 = 停工）。 */
  assignedOuter: number;
  /** 在炉任务（null = 空闲）。 */
  task: WorkshopTask | null;
};

/** 岗位与生产扩展字段（GameSnapshot jobs；旧档缺字段按空车间口径兼容）。 */
export type SectJobs = {
  pill: WorkshopState;
  gear: WorkshopState;
};

export type WarehouseGearItem = {
  slot: GearSlot;
  /** 法宝目录 id（TREASURES；旧档档位数字在 migrateGameState 迁移为该档代表法宝）。 */
  treasureId: string;
};

export type WarehouseStock = {
  /** 未穿戴装备。 */
  gear: WarehouseGearItem[];
  /** 未服用丹药（按丹药 id 计数）。 */
  pills: Array<{ pillId: string; count: number }>;
};

/** 长老任命（各至多 1 名，从无职成年内门弟子任命，可替换、旧长老自动卸任）：
 * 资源长老暂无加成（外门供奉已移除）、战备长老全门突破率 +3、灵矿长老挖矿上缴按境界加成（元婴前期封顶 +100%）；
 * 长老不历练（不出战），修炼照常。 */
export type SectElders = {
  resource?: string;
  war?: string;
  mine?: string;
};

/** 外门分工：挖矿/练气各岗在编人数（丹房/器坊投入记在车间 assignedOuter；旧档缺省 = 未分岗）。 */
export type OuterJobsState = {
  mining: number;
  qi: number;
};

export function emptyOuterJobs(): OuterJobsState {
  return { mining: 0, qi: 0 };
}

export type GameState = {
  seed: string;
  sectName: string;
  /** 月游标：从 1 开始，每次月结 +1。 */
  currentTurn: number;
  spiritStones: number;
  sectRank: 1 | 2 | 3;
  morale: number;
  prestige: number;
  /** 弟子编号单调计数，用于生成 id 与取名 ordinal。 */
  discipleSeq: number;
  // 外门人数不入状态：外门弟子只是数字，总数恒等于当前宗门等级的外门上限（sectLimitsFor），
  // 开局即满员、升阶即扩容；在岗分工见 outerJobs 与 jobs[...].assignedOuter。
  /** 外门分工：挖矿/练气在编人数（丹房/器坊投入在 jobs[...].assignedOuter；旧档缺省 = 未分岗）。 */
  outerJobs?: OuterJobsState;
  /** 在册内门弟子（有名有姓、可战斗修炼管理；外门不入此册）。 */
  disciples: Disciple[];
  chronicle: ChronicleEntry[];
  fallen: FallenDisciple[];
  ending?: GameEnding;
  /** 藏经阁（旧档缺省为空）。 */
  library?: SectLibrary;
  /** 丹房/器坊岗位与点数（旧档缺省为空）。 */
  jobs?: SectJobs;
  /** 仓库（旧档缺省为空）。 */
  warehouse?: WarehouseStock;
  /** 长老任命（旧档缺省为无长老）。 */
  elders?: SectElders;
  /** 战报存档（最新在前，月结接线时裁剪上限；UI 回放直接消费）。 */
  battles?: BattleReport[];
  /** NPC 对手宗门快照（与玩家月结同帧推进；旧档缺省 = 未启用对手）。 */
  rival?: RivalSect;
  /** 战争状态：任一方宣战后至会战结算前为 true。 */
  warWithRival?: boolean;
  /** 宣战发生的回目（会战于次月月结第 ⑦ 步触发）。 */
  warDeclaredTurn?: number;
  /** 冷却结束回目（≥ 该回目方可再次宣战；自宣战月起算 12 个月）。 */
  warCooldownEndsTurn?: number;
  /** 玩家指定的会战出战弟子 id（至多 3；缺省自动选最强 3）。 */
  warParty?: string[];
  /** 会战记录（最新在前；UI 会战记录页消费）。 */
  sectWars?: SectWarRecord[];
  /** 凋敝计数：内门 0 且灵石不足招募费的连续月数（≥6 触发凋敝结局）。 */
  bankruptStreak?: number;
  /** 突破成功总次数（结局评价输入）。 */
  totalBreakthroughs?: number;
};

export function emptyWorkshop(): WorkshopState {
  return { workers: [], assignedOuter: 0, task: null };
}

export function emptySectJobs(): SectJobs {
  return { pill: emptyWorkshop(), gear: emptyWorkshop() };
}

export function emptyWarehouse(): WarehouseStock {
  return { gear: [], pills: [] };
}

export function emptyLibrary(): SectLibrary {
  return { techniqueIds: [], spellIds: [] };
}

/**
 * 旧档迁移：外门个体名册 → 外门恒满员口径（外门弟子只是数字，总数恒等于宗门等级上限）。
 * - 残留的 role 字段自弟子身上剥离（新口径全员内门，字段已废除）；
 * - 旧档的 outerCount 字段（初始 20/流动计数时代）删除——总数改为按 sectRank 派生，不入状态；
 * - 装备法宝化（2026-09-09 三）：仓库条目与已穿戴的档位数字 → 该档代表法宝 id（已是 id 幂等原样），
 *   在炉法宝任务剥离旧档 slot/tier（出炉改为目录十件随机其一）。
 * 新局状态本就是新口径，迁移为幂等空操作。
 */
export function migrateGameState(raw: Readonly<GameState>): GameState {
  const state = structuredClone(raw) as GameState;
  const roleOf = (disciple: unknown): string | undefined =>
    (disciple as { role?: string } | undefined)?.role;
  Reflect.deleteProperty(state as GameState & { outerCount?: number }, "outerCount");
  state.disciples = state.disciples
    .filter((disciple) => roleOf(disciple) !== "outer")
    .map((disciple) => {
      const { role: _obsoleteRole, ...rest } = disciple as Disciple & { role?: string };
      return rest as Disciple;
    });
  if (state.rival) {
    const rival = state.rival as GameState["rival"] & { outerCount?: number };
    Reflect.deleteProperty(rival, "outerCount");
    rival.disciples = rival.disciples
      .filter((disciple) => roleOf(disciple) !== "outer")
      .map((disciple) => {
        const { role: _obsoleteRole, ...rest } = disciple as Disciple & { role?: string };
        return rest as Disciple;
      });
  }
  // 旧档档位数字（1–4）→ 该档代表法宝 id；字符串 id 原样保留（幂等）。
  const treasureIdOf = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (typeof value === "number" && GEAR_TIERS.includes(value as GearTier)) {
      return representativeTreasureOfTier(value as GearTier).id;
    }
    return undefined;
  };
  if (state.warehouse) {
    state.warehouse.gear = state.warehouse.gear.flatMap((item) => {
      const raw = item as { treasureId?: unknown; tier?: unknown };
      const treasureId = treasureIdOf(raw.treasureId ?? raw.tier);
      return treasureId ? [{ slot: item.slot, treasureId }] : [];
    });
  }
  const migrateEquipped = (equipped: EquippedGear): EquippedGear => {
    for (const slot of GEAR_SLOT_KEYS) {
      const migrated = treasureIdOf(equipped[slot]);
      if (migrated !== undefined) equipped[slot] = migrated;
      else Reflect.deleteProperty(equipped, slot);
    }
    return equipped;
  };
  for (const disciple of state.disciples) {
    if (disciple.equippedGear) disciple.equippedGear = migrateEquipped(disciple.equippedGear);
  }
  if (state.rival) {
    for (const disciple of state.rival.disciples) {
      if (disciple.equippedGear) disciple.equippedGear = migrateEquipped(disciple.equippedGear);
    }
  }
  // 在炉法宝任务：旧档 slot/tier 剥离（进度保留；出炉改十件随机其一）。
  const gearTask = (state.jobs?.gear?.task ?? null) as {
    kind?: unknown;
    accumulatedPoints?: unknown;
  } | null;
  if (gearTask && gearTask.kind === "gear") {
    const accumulatedPoints =
      typeof gearTask.accumulatedPoints === "number" && Number.isFinite(gearTask.accumulatedPoints)
        ? gearTask.accumulatedPoints
        : 0;
    if (state.jobs?.gear) state.jobs.gear.task = { kind: "gear", accumulatedPoints };
  }
  return state;
}

/** 车间键序（丹房在前，与月结生产步骤口径一致）。 */
export const CRAFT_JOB_KINDS: readonly CraftJobKind[] = ["pill", "gear"];

export type RecruitmentCandidate = {
  candidateId: string;
  disciple: Disciple;
};

export type BreakthroughOutcome = "success" | "failure";

export type BreakthroughEvent = {
  discipleId: string;
  discipleName: string;
  outcome: BreakthroughOutcome;
  fromRealmLevel: number;
  toRealmLevel?: number;
  successRate: number;
  /** 突破顿悟：本次突破成功时顿悟到的法术（20% 概率；未触发缺省）。 */
  epiphanySpellId?: string;
  epiphanySpellName?: string;
};

export type DeathEvent = {
  discipleId: string;
  discipleName: string;
  age: number;
};

/** 外门递补入内门事件（外门只是数字，递补即从外门计数转入新内门弟子）。 */
export type PromotionEvent = {
  discipleId: string;
  discipleName: string;
};

export type SettlementResult = {
  turn: number;
  crisis: boolean;
  spiritStonesDelta: number;
  moraleDelta: number;
  prestigeDelta: number;
  breakthroughs: BreakthroughEvent[];
  deaths: DeathEvent[];
  promotions: PromotionEvent[];
  /** 本月出炉入仓库的丹药（第 ④ 步生产；无出炉则缺省）。 */
  completedPills?: Array<{ pillId: string; count: number }>;
  /** 本月出炉入仓库的装备（第 ④ 步生产；无出炉则缺省）。 */
  completedGear?: WarehouseGearItem[];
  /** 每月自动进行的历练遭遇事件报告（第 5 步；危机月停摆缺省）。 */
  expedition?: ExpeditionReport;
  /** 会战结算记录（第 7 步触发时携带）。 */
  war?: SectWarRecord;
  /** 第 6 步 NPC 推进是否发生宣战（供 UI 提示）。 */
  rivalDeclaredWar?: boolean;
  /** 第 6 步 NPC 宗门是否升阶（供 UI 提示）。 */
  rivalRankUp?: { from: number; to: number };
};
