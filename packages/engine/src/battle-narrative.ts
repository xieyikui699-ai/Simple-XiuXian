// 战报文字描述（叙事化回放）：把结构化战报（battle.ts 逐条目时间线）转写为
// 「谁与谁对战、谁用了什么、对谁造成多少伤害」的中文叙述行。纯函数、无随机、
// 只读战报不改数据；法术名按 id 反查目录（战报存档保持精简，旧档缺名回退 id）。
// 行文模板见设计文档 §战斗系统·战报文字描述。
// 输出为分段（BattleReportSegment）：人名段带 tone（A 我方 / B 对方），
// UI 按 tone 着色（我方绿、对方红）；formatBattleReport 为分段的纯文本拼接，
// 旧消费方（无着色需求）行为不变。
import type { BattleActionEntry, BattleReport, BattleSide } from "./battle.js";
import { getSpellById } from "./catalog.js";

/** 战斗来源 → 显示名（expedition / sparring / sect-war）。 */
const SOURCE_LABELS: Record<string, string> = {
  expedition: "历练",
  sparring: "切磋",
  "sect-war": "会战",
};

export function battleSourceLabel(source?: string): string {
  if (!source) return "战斗";
  return SOURCE_LABELS[source] ?? "战斗";
}

/** 人名着色基调：A = 我方（绿）、B = 对方（红）。 */
export type BattleNameTone = "own" | "enemy";

/** 战报叙述分段：text 为纯文本片段，人名片段带 tone 供 UI 着色。 */
export type BattleReportSegment = { text: string; tone?: BattleNameTone };

const SIDE_TONE: Record<BattleSide, BattleNameTone> = { A: "own", B: "enemy" };

function spellDisplayName(spellId: string | undefined): string {
  if (!spellId) return "法术";
  return getSpellById(spellId)?.name ?? spellId;
}

function opposite(side: BattleSide): BattleSide {
  return side === "A" ? "B" : "A";
}

/** 人名段（A 我方 / B 对方 tone）。 */
function nameSegment(report: BattleReport, side: BattleSide): BattleReportSegment {
  return { text: report.fighters[side], tone: SIDE_TONE[side] };
}

/** 首行（交战双方）：【来源】我方（境界） 与 对方（境界） 交战；旧档无境界则不显示。 */
function headerSegments(report: BattleReport): BattleReportSegment[] {
  const withRealm = (side: BattleSide): string => {
    const realm = report.realms?.[side];
    return realm ? `（${realm}）` : "";
  };
  return [
    { text: `【${battleSourceLabel(report.source)}】` },
    { ...nameSegment(report, "A"), text: report.fighters.A + withRealm("A") },
    { text: " 与 " },
    { ...nameSegment(report, "B"), text: report.fighters.B + withRealm("B") },
    { text: " 交战" },
  ];
}

/** 单条行动 → 主句分段；状态注记由 formatBattleReportSegments 另起「· 」明细行（skip/burn 主句已自明，不重复）。 */
function describeAction(report: BattleReport, action: BattleActionEntry): BattleReportSegment[] {
  const actor = nameSegment(report, action.actor);
  const target = nameSegment(report, opposite(action.actor));
  const critSuffix = action.crit ? "（会心一击）" : "";
  switch (action.kind) {
    case "skip":
      return [actor, { text: " 身陷冰冻，无法行动" }];
    case "burn":
      return [actor, { text: ` 身上灼烧发作，损失 ${action.damage} 点生命` }];
    case "basic":
      if (action.hit === false) {
        return [actor, { text: " 发动攻伐，被 " }, target, { text: " 避开，未造成伤害" }];
      }
      return [
        actor,
        { text: " 发动攻伐，对 " },
        target,
        { text: ` 造成 ${action.damage} 点伤害${critSuffix}` },
      ];
    case "spell": {
      const spell = `【${spellDisplayName(action.spellId)}】`;
      if (action.hit === undefined) return [actor, { text: ` 施展${spell}` }]; // 纯增益（护盾类）作用于自身，不掷命中。
      if (action.hit === false) {
        return [actor, { text: ` 施展${spell}，被 ` }, target, { text: " 避开，未造成伤害" }];
      }
      return [
        actor,
        { text: ` 施展${spell}，对 ` },
        target,
        { text: ` 造成 ${action.damage} 点伤害${critSuffix}` },
      ];
    }
  }
}

/** 整场战斗 → 逐行分段：开场 → 逐回合行动与状态明细 → 终局 → 伤势 → 汇总。 */
export function formatBattleReportSegments(report: BattleReport): BattleReportSegment[][] {
  const lines: BattleReportSegment[][] = [headerSegments(report)];

  let lastRound = 0;
  for (const action of report.actions) {
    if (action.round !== lastRound) {
      lastRound = action.round;
      lines.push([{ text: `—— 第 ${action.round} 回合 ——` }]);
    }
    lines.push(describeAction(report, action));
    if (action.kind !== "skip" && action.kind !== "burn") {
      for (const note of action.statusNotes) lines.push([{ text: `· ${note}` }]);
    }
  }

  if (report.winner === "draw") {
    lines.push([{ text: `历经 ${report.rounds} 回合鏖战，未分胜负，平局收场` }]);
  } else {
    const winner = nameSegment(report, report.winner);
    const loser = nameSegment(report, opposite(report.winner));
    lines.push([
      { text: `历经 ${report.rounds} 回合，` },
      loser,
      { text: " 不支倒下——" },
      winner,
      { text: " 胜出！" },
    ]);
    const injury = report.injuries[opposite(report.winner)];
    if (injury !== "none") {
      const label = injury === "light" ? "轻伤" : "重伤";
      lines.push([
        { text: "战后：" },
        loser,
        { text: ` 身负${label}，禁战 ${report.injuryMonths[injury]} 月` },
      ]);
    }
  }
  lines.push([
    { text: "本场总伤害：" },
    nameSegment(report, "A"),
    { text: ` ${report.totalDamage.A} / ` },
    nameSegment(report, "B"),
    { text: ` ${report.totalDamage.B}；终局生命：` },
    nameSegment(report, "A"),
    { text: ` ${report.finalHp.A} / ` },
    nameSegment(report, "B"),
    { text: ` ${report.finalHp.B}` },
  ]);
  return lines;
}

/** 整场战斗 → 逐行纯文本（分段拼接；无着色消费方的兼容入口）。 */
export function formatBattleReport(report: BattleReport): string[] {
  return formatBattleReportSegments(report).map((segments) =>
    segments.map((segment) => segment.text).join(""),
  );
}
