// 游戏状态类型：唯一事实源是 GameState 快照，UI 层负责持久化（小程序本地存储）。
import type { DiscipleAttributes } from "./attributes.js";
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
};

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
