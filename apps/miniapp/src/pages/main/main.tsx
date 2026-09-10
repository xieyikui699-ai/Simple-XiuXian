import {
  type BreakthroughEvent,
  CRAFT_JOB_KINDS,
  type Disciple,
  type GameState,
  OUTER_MINING_STONES_PER_MONTH,
  type SectUpgradeRequirement,
  jobsOf,
  mineElderBonusPct,
  nextRealmStage,
  outerJobsOf,
  outerTotalOf,
  realmStageForLevel,
  sectLimitsFor,
  upgradeRequirementFor,
  workshopStaffedOuterCount,
} from "@simple-xiuxian/engine";
import { Button, Slider, Text, View } from "@tarojs/components";
import { navigateTo, reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { AdvanceBar } from "../../ui/advance-bar";
import {
  BREAKTHROUGH_OUTCOME_LABELS,
  formatDelta,
  formatNumber,
  formatTurn,
} from "../../ui/display";
import { DisciplePicker } from "../../ui/picker";
import "./main.css";

const NAV_ENTRIES: Array<{ label: string; url: string }> = [
  { label: "弟子殿", url: "/pages/disciples/disciples" },
  { label: "丹房·器坊", url: "/pages/alchemy/alchemy" },
  { label: "仓库", url: "/pages/warehouse/warehouse" },
  { label: "对手宗门", url: "/pages/rival/rival" },
  { label: "宗门纪事", url: "/pages/chronicle/chronicle" },
  { label: "仙途结局", url: "/pages/ending/ending" },
];

/** 灵矿长老候选：无职成年内门弟子（车间主持、各职长老在任者不可再任）。 */
function mineElderCandidates(state: GameState): Disciple[] {
  const busy = new Set<string>([
    ...CRAFT_JOB_KINDS.flatMap((kind) => jobsOf(state)[kind].workers),
    ...(state.elders?.resource ? [state.elders.resource] : []),
    ...(state.elders?.war ? [state.elders.war] : []),
    ...(state.elders?.mine ? [state.elders.mine] : []),
  ]);
  return state.disciples.filter((disciple) => disciple.age >= 16 && !busy.has(disciple.id));
}

/** 升阶需求文案：灵石花费 + 境界门槛（主页展示，点升阶按钮前即可看到缺口；境界口径与引擎 sectUpgradeFailureReason 一致）。 */
function upgradeRequirementText(requirement: SectUpgradeRequirement): string {
  const parts = [`需灵石 ${formatNumber(requirement.cost)}`];
  const minRealmLevel = requirement.minRealmLevel;
  if (minRealmLevel !== undefined) {
    // 段名形如「筑基前期」，取前两字为大境界。
    const majorRealm = realmStageForLevel(minRealmLevel).name.slice(0, 2);
    parts.push(`${majorRealm}及以上 1 人`);
  }
  const goldenCoreCount = requirement.goldenCoreCount;
  if (goldenCoreCount !== undefined) {
    // 与引擎同口径：realmLevel >= 金丹前期（7 级）。
    const majorRealm = realmStageForLevel(7).name.slice(0, 2);
    parts.push(`${majorRealm}及以上 ${goldenCoreCount} 人`);
  }
  return parts.join(" · ");
}

/** 月结突破行境界文案：原境界 → 尝试突破的境界（成功取 toRealmLevel，失败取下一段）。 */
function breakthroughRealmText(event: BreakthroughEvent): string {
  const fromName = realmStageForLevel(event.fromRealmLevel).name;
  const toStage =
    event.outcome === "success" && event.toRealmLevel !== undefined
      ? realmStageForLevel(event.toRealmLevel)
      : nextRealmStage(event.fromRealmLevel);
  return toStage ? `${fromName} → ${toStage.name}` : fromName;
}

export default function MainPage() {
  const store = getGameStore();
  const { state, lastResult, errorMessage } = useGame();
  const [pickingElder, setPickingElder] = useState(false);

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  const limits = sectLimitsFor(state.sectRank);
  const innerCount = state.disciples.length;
  const requirement = upgradeRequirementFor(state.sectRank);
  const outerJobs = outerJobsOf(state);
  const outerTotal = outerTotalOf(state);
  // 挖矿滑杆上限 = 外门总数 − 丹房/器坊投入 − 练气在编（各岗合计 ≤ 外门总数，同一容量校验）。
  const miningCap = Math.max(0, outerTotal - workshopStaffedOuterCount(state) - outerJobs.qi);
  const mining = outerJobs.mining;
  // 挖矿收入与月结同口径：上缴 ×（1 + 灵矿长老境界加成，元婴前期封顶 +100%）。
  const mineElder = state.elders?.mine
    ? state.disciples.find((disciple) => disciple.id === state.elders?.mine)
    : undefined;
  const miningMultiplier = 1 + mineElderBonusPct(mineElder?.realmLevel ?? 0);
  const miningIncome = Math.round(mining * OUTER_MINING_STONES_PER_MONTH * miningMultiplier);

  return (
    <View className="page">
      <View className="page-body">
        {state.ending && (
          <View
            className="banner-ending"
            onClick={() => navigateTo({ url: "/pages/ending/ending" })}
          >
            本局已终局：{state.ending.text}
          </View>
        )}

        <View className="card sect-card">
          <View className="sect-head">
            <Text className="sect-name">{state.sectName}</Text>
            <View className="sect-head-right">
              {requirement && (
                <Text className="upgrade-cost">{upgradeRequirementText(requirement)}</Text>
              )}
              <Button
                className="btn-upgrade"
                disabled={state.sectRank >= 3 || Boolean(state.ending)}
                onClick={() => store.upgrade()}
              >
                宗门升阶
              </Button>
              <Text className="sect-turn">{formatTurn(state.currentTurn)}</Text>
            </View>
          </View>
          <View className="stat-grid">
            <View className="stat">
              <Text className="stat-value">{formatNumber(state.spiritStones)}</Text>
              <Text className="stat-label">灵石</Text>
            </View>
            <View className="stat">
              <Text className="stat-value">{state.morale}</Text>
              <Text className="stat-label">士气</Text>
            </View>
            <View className="stat">
              <Text className="stat-value">{state.prestige}</Text>
              <Text className="stat-label">声望</Text>
            </View>
            <View className="stat">
              <Text className="stat-value">{state.sectRank} 级</Text>
              <Text className="stat-label">宗门</Text>
            </View>
          </View>
          <Text className="sect-subline">
            内门 {innerCount}/{limits.innerLimit}
            {state.rival ? ` · 对方 ${state.rival.name} ${state.rival.sectRank} 级` : ""}
          </Text>
        </View>

        {lastResult && (
          <View className="card result-card">
            <View className="card-title result-head">
              <Text>{formatTurn(lastResult.turn)} 月结</Text>
              <Text className="result-close" onClick={() => store.clearResult()}>
                关闭
              </Text>
            </View>
            {lastResult.crisis && <Text className="error-line">灵石危机：本月俸禄未能支付！</Text>}
            <Text className="result-line">
              灵石 {formatDelta(lastResult.spiritStonesDelta)} · 士气{" "}
              {formatDelta(lastResult.moraleDelta)} · 声望 {formatDelta(lastResult.prestigeDelta)}
            </Text>
            {lastResult.breakthroughs.map((event) => (
              <Text key={event.discipleId} className="result-line">
                【{BREAKTHROUGH_OUTCOME_LABELS[event.outcome]}】{event.discipleName}{" "}
                {breakthroughRealmText(event)}
                {event.outcome === "failure" ? `（成功率 ${event.successRate}%）` : ""}
                {event.epiphanySpellName ? `，顿悟《${event.epiphanySpellName}》` : ""}
              </Text>
            ))}
            {lastResult.deaths.map((event) => (
              <Text key={event.discipleId} className="result-line">
                【坐化】{event.discipleName}，享年 {event.age} 岁
              </Text>
            ))}
            {lastResult.promotions.map((event) => (
              <Text key={event.discipleId} className="result-line">
                【递补】{event.discipleName} 递补入内门
              </Text>
            ))}
            {lastResult.breakthroughs.length === 0 &&
              lastResult.deaths.length === 0 &&
              lastResult.promotions.length === 0 &&
              !lastResult.crisis && <Text className="result-line">风平浪静的一月。</Text>}
          </View>
        )}

        <View className="card">
          <View className="card-title">宗门管理</View>
          {errorMessage !== null && (
            <Text className="error-line" onClick={() => store.clearError()}>
              {errorMessage}（点击关闭）
            </Text>
          )}
          <View className="nav-grid">
            {NAV_ENTRIES.map((entry) => (
              <View
                key={entry.url}
                className="nav-cell"
                onClick={() => navigateTo({ url: entry.url })}
              >
                {entry.label}
              </View>
            ))}
          </View>
        </View>

        <View className="card">
          <View className="card-title-row">
            <View className="card-title">外门挖矿</View>
            <Button
              className="btn-mini"
              disabled={Boolean(state.ending)}
              onClick={() => setPickingElder(!pickingElder)}
            >
              任命
            </Button>
          </View>
          {pickingElder ? (
            <DisciplePicker
              title="任命灵矿长老（无职成年弟子，任内不历练、照常修炼）"
              hint="挖矿上缴按境界加成：每境界等级 +10%，元婴前期封顶 +100%。"
              disciples={mineElderCandidates(state)}
              onCancel={() => setPickingElder(false)}
              onPick={(discipleId) => {
                store.appointElder(discipleId, "mine");
                setPickingElder(false);
              }}
            />
          ) : (
            mineElder && (
              <View className="elder-line">
                <Text className="muted">
                  灵矿长老 {mineElder.name} · 挖矿加成 +
                  {Math.round(mineElderBonusPct(mineElder.realmLevel) * 100)}%
                </Text>
                <Text className="elder-dismiss" onClick={() => store.removeElder("mine")}>
                  卸任
                </Text>
              </View>
            )
          )}
          <View className="mining-box">
            <View className="mining-row">
              <Text className="mining-label">投入外门弟子</Text>
              <Text className="muted">+{miningIncome} 灵石/月</Text>
              <Text className="mining-count">已投入 {mining} 人</Text>
            </View>
            <Slider
              className="mining-slider"
              min={0}
              max={miningCap}
              step={1}
              value={Math.min(mining, miningCap)}
              disabled={Boolean(state.ending)}
              activeColor="#8c5a2b"
              blockColor="#8c5a2b"
              onChange={(event) =>
                store.assignOuterJobs({ mining: event.detail.value, qi: outerJobs.qi })
              }
            />
          </View>
        </View>
      </View>

      <AdvanceBar />
    </View>
  );
}
