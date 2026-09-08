import {
  OUTER_MINING_STONES_PER_MONTH,
  outerJobsOf,
  outerTotalOf,
  sectLimitsFor,
  upgradeRequirementFor,
  workshopStaffedOuterCount,
} from "@simple-xiuxian/engine";
import { Button, Slider, Switch, Text, View } from "@tarojs/components";
import { navigateTo, reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useAutoAdvance, useGame } from "../../store/use-game";
import {
  BREAKTHROUGH_OUTCOME_LABELS,
  formatDelta,
  formatNumber,
  formatTurn,
} from "../../ui/display";
import "./main.css";

const NAV_ENTRIES: Array<{ label: string; url: string }> = [
  { label: "弟子殿", url: "/pages/disciples/disciples" },
  { label: "丹房·器坊", url: "/pages/alchemy/alchemy" },
  { label: "仓库", url: "/pages/warehouse/warehouse" },
  { label: "对手宗门", url: "/pages/rival/rival" },
  { label: "宗门纪事", url: "/pages/chronicle/chronicle" },
  { label: "仙途结局", url: "/pages/ending/ending" },
];

export default function MainPage() {
  const store = getGameStore();
  const { state, lastResult, errorMessage } = useGame();
  const [auto, setAuto] = useState(false);

  useAutoAdvance(auto);

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
  const miningIncome = mining * OUTER_MINING_STONES_PER_MONTH;

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
                <Text className="upgrade-cost">需灵石 {formatNumber(requirement.cost)}</Text>
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
                【{BREAKTHROUGH_OUTCOME_LABELS[event.outcome]}】{event.discipleName}
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
          <View className="card-title">外门挖矿</View>
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
            <Text className="muted mining-hint">
              每名投入弟子每月上缴 {OUTER_MINING_STONES_PER_MONTH} 灵石（供奉之外另计）；与
              丹房·器坊投入合计不超外门总数 {outerTotal} 人。
            </Text>
          </View>
        </View>
      </View>

      <View className="page-footer">
        <Button
          className="btn-advance"
          disabled={Boolean(state.ending)}
          onClick={() => store.settleMonth()}
        >
          推进一月
        </Button>
        <View
          className="auto-wrap"
          onClick={() => {
            if (!state.ending) setAuto(!auto);
          }}
        >
          <Switch checked={auto} onChange={(event) => setAuto(event.detail.value)} />
          <Text className="auto-label">自动推进</Text>
        </View>
      </View>
    </View>
  );
}
