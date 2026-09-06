// 游戏状态类型：唯一事实源是 GameState 快照，UI 层负责持久化（小程序本地存储）。
// M2 扩展字段（library/jobs/warehouse、弟子功法法术装备）均为可选：旧档缺字段时按空值口径兼容。
import type { DiscipleAttributes } from "./attributes.js";
import type { CraftJobKind, EquippedGear, GearSlot, GearTier } from "./catalog.js";
import type { RootElement, RootType } from "./roots.js";

export type DiscipleRole = "inner" | "outer";

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

export type GameEnding = {
  kind: EndingKind;
  turn: number;
  text: string;
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
};
