// 游戏状态类型：唯一事实源是 GameState 快照，UI 层负责持久化（小程序本地存储）。
// M2 扩展字段（library/jobs/warehouse、弟子功法法术装备）均为可选：旧档缺字段时按空值口径兼容。
import type { DiscipleAttributes } from "./attributes.js";
import type { BattleReport } from "./battle.js";
import type { CraftJobKind, EquippedGear, GearSlot, GearTier } from "./catalog.js";
import type { ExpeditionReport } from "./expedition.js";
import type { RivalSect } from "./rival.js";
import type { RootElement, RootType } from "./roots.js";
import type { SectWarRecord } from "./sect-war.js";

export type DiscipleRole = "inner" | "outer";

/** 伤势档位：轻伤禁战 1 月 / 重伤禁战 3 月（与 battle.ts 战败伤势同词汇表）。 */
export type InjuryKind = "light" | "severe";

/** 伤势：untilTurn 当回目（含）仍禁战，下一回目起可出战；休养方针恢复月数 −2。 */
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
  role: DiscipleRole;
  rootType: RootType;
  rootElements: RootElement[];
  attributes: DiscipleAttributes;
  talentIds: string[];
  /** 已修功法（限 1 门；旧档缺省 = 未修）。 */
  techniqueId?: string;
  /** 已修法术（限 2 门；旧档缺省 = 空）。 */
  spellIds?: string[];
  /** 已穿戴装备（槽位 → 档位；旧档缺省 = 空）。 */
  equippedGear?: EquippedGear;
  /** 聚灵丹增益：该回目（含）之前真元获取 ×1.5；重复服用只刷新时长不叠加。 */
  spiritFocusUntilTurn?: number;
  /** 未愈伤势；缺省 = 无伤（旧档兼容）。 */
  injury?: Injury;
};

export type MonthlyPolicy = "cultivate" | "develop" | "explore" | "rest";

export const POLICY_DISPLAY_NAMES: Record<MonthlyPolicy, string> = {
  cultivate: "闭关修炼",
  develop: "经营宗门",
  explore: "外出历练",
  rest: "休养生息",
};

export type ChronicleKind = "normal" | "milestone" | "warning";

export type ChronicleEntry = {
  turn: number;
  kind: ChronicleKind;
  text: string;
};

export type EndingKind = "ascension" | "annexation" | "annexed" | "bankrupt";

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

/** 在炉丹药任务：出炉剩余月数。 */
export type FurnaceTask = {
  pillId: string;
  monthsLeft: number;
};

/** 车间（丹房/器坊）状态：岗位分配、累积点数、在炉任务。 */
export type WorkshopState = {
  /** 岗位分配（丹师/工匠的 discipleId，至多 2 名）。 */
  workers: string[];
  /** 已累积未消耗的炼制点数。 */
  points: number;
  /** 在炉任务（器坊开炉即出炉，恒为空）。 */
  tasks: FurnaceTask[];
};

/** 岗位与生产扩展字段（GameSnapshot jobs；旧档缺字段按空车间口径兼容）。 */
export type SectJobs = {
  pill: WorkshopState;
  gear: WorkshopState;
};

export type WarehouseGearItem = {
  slot: GearSlot;
  tier: GearTier;
};

export type WarehouseStock = {
  /** 未穿戴装备。 */
  gear: WarehouseGearItem[];
  /** 未服用丹药（按丹药 id 计数）。 */
  pills: Array<{ pillId: string; count: number }>;
};

/** 长老任命（各至多 1 名，从无职成年内门弟子任命，可替换、旧长老自动卸任）：
 * 资源长老外门供奉 +20%、战备长老全门突破率 +3；长老不战斗不修炼。 */
export type SectElders = {
  resource?: string;
  war?: string;
};

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
  /** 当前方针（本月结算所用），仅结算期间有语义。 */
  policy?: MonthlyPolicy;
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
  /** 突破成功总次数（含飞升；结局评价输入）。 */
  totalBreakthroughs?: number;
};

export function emptyWorkshop(): WorkshopState {
  return { workers: [], points: 0, tasks: [] };
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

/** 车间键序（丹房在前，与月结生产步骤口径一致）。 */
export const CRAFT_JOB_KINDS: readonly CraftJobKind[] = ["pill", "gear"];

export type RecruitmentCandidate = {
  candidateId: string;
  disciple: Disciple;
};

export type BreakthroughOutcome = "success" | "failure" | "ascended";

export type BreakthroughEvent = {
  discipleId: string;
  discipleName: string;
  outcome: BreakthroughOutcome;
  fromRealmLevel: number;
  toRealmLevel?: number;
  successRate: number;
};

export type DeathEvent = {
  discipleId: string;
  discipleName: string;
  age: number;
};

export type PromotionEvent = {
  discipleId: string;
  discipleName: string;
  from: DiscipleRole;
  to: DiscipleRole;
};

export type SettlementResult = {
  turn: number;
  policy: MonthlyPolicy;
  crisis: boolean;
  spiritStonesDelta: number;
  moraleDelta: number;
  prestigeDelta: number;
  breakthroughs: BreakthroughEvent[];
  deaths: DeathEvent[];
  promotions: PromotionEvent[];
  /** 方针=外出历练时的遭遇事件报告（第 5 步；其余方针缺省）。 */
  expedition?: ExpeditionReport;
  /** 会战结算记录（第 7 步触发时携带）。 */
  war?: SectWarRecord;
  /** 第 6 步 NPC 推进是否发生宣战（供 UI 提示）。 */
  rivalDeclaredWar?: boolean;
  /** 第 6 步 NPC 宗门是否升阶（供 UI 提示）。 */
  rivalRankUp?: { from: number; to: number };
};
