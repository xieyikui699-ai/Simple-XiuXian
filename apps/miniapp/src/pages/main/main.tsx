import {
  type MonthlyPolicy,
  POLICY_DISPLAY_NAMES,
  sectLimitsFor,
  sectUpgradeFailureReason,
  upgradeRequirementFor,
} from "@simple-xiuxian/engine";
import { Button, Switch, Text, View } from "@tarojs/components";
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

const POLICIES: MonthlyPolicy[] = ["cultivate", "develop", "explore", "rest"];

const NAV_ENTRIES: Array<{ label: string; url: string }> = [
  { label: "弟子殿", url: "/pages/disciples/disciples" },
  { label: "丹房·器坊", url: "/pages/alchemy/alchemy" },
  { label: "仓库", url: "/pages/warehouse/warehouse" },
  { label: "对手宗门", url: "/pages/rival/rival" },
  { label: "宗门纪事", url: "/pages/chronicle/chronicle" },
  { label: "仙途结局", url: "/pages/ending/ending" },
];

const UPGRADE_REASON_HINTS: Record<string, string> = {
  insufficient_resource: "灵石不足",
  inner_realm_not_reached: "内门弟子境界未达",
  golden_core_not_enough: "金丹内门弟子不足",
};

export default function MainPage() {
  const store = getGameStore();
  const { state, lastResult, errorMessage } = useGame();
  const [policy, setPolicy] = useState<MonthlyPolicy>("cultivate");
  const [auto, setAuto] = useState(false);

  useAutoAdvance(auto, policy);

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  const limits = sectLimitsFor(state.sectRank);
  const innerCount = state.disciples.filter((disciple) => disciple.role === "inner").length;
  const outerCount = state.disciples.filter((disciple) => disciple.role === "outer").length;
  const requirement = upgradeRequirementFor(state.sectRank);
  const upgradeBlockReason = sectUpgradeFailureReason(state);
  const upgradeHint =
    state.sectRank === 3
      ? "已是最高等级"
      : upgradeBlockReason && UPGRADE_REASON_HINTS[upgradeBlockReason]
        ? UPGRADE_REASON_HINTS[upgradeBlockReason]
        : requirement
          ? `需灵石 ${formatNumber(requirement.cost)}${
              requirement.minRealmLevel ? " + 任一内门达筑基" : " + 金丹内门≥3"
            }`
          : "";

  return (
    <View className="page">
      {state.ending && (
        <View className="banner-ending" onClick={() => navigateTo({ url: "/pages/ending/ending" })}>
          本局已终局：{state.ending.text}（点击查看结局）
        </View>
      )}

      <View className="card">
        <View className="card-title overview-head">
          <Text>
            {state.sectName} · {formatTurn(state.currentTurn)}
          </Text>
          <Text className="muted">回合 {state.currentTurn}</Text>
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
            <Text className="stat-label">
              内{innerCount}/{limits.innerLimit} 外{outerCount}/{limits.outerLimit}
            </Text>
          </View>
          <View className="stat">
            <Text className="stat-value muted">未实装</Text>
            <Text className="stat-label">对方宗门等级</Text>
          </View>
        </View>
      </View>

      <View className="card">
        <View className="card-title">月度方针</View>
        <View className="policy-row">
          {POLICIES.map((item) => (
            <View
              key={item}
              className={`policy-chip ${policy === item ? "policy-chip-active" : ""}`}
              onClick={() => setPolicy(item)}
            >
              {POLICY_DISPLAY_NAMES[item]}
            </View>
          ))}
        </View>
        <View className="row advance-row">
          <Button
            className="btn-advance"
            disabled={Boolean(state.ending)}
            onClick={() => store.settleMonth(policy)}
          >
            推进一月
          </Button>
          <View className="auto-wrap">
            <Switch checked={auto} onChange={(event) => setAuto(event.detail.value)} />
            <Text className="muted">自动推进（1 秒 1 月）</Text>
          </View>
        </View>
        {errorMessage !== null && (
          <Text className="error-line" onClick={() => store.clearError()}>
            {errorMessage}（点击关闭）
          </Text>
        )}
      </View>

      {lastResult && (
        <View className="card result-card">
          <View className="card-title result-head">
            <Text>{formatTurn(lastResult.turn)} 月结</Text>
            <Text className="result-close" onClick={() => store.clearResult()}>
              关闭
            </Text>
          </View>
          {lastResult.crisis && <Text className="error-line">灵石危机：本月方针未执行！</Text>}
          <Text className="result-line">
            灵石 {formatDelta(lastResult.spiritStonesDelta)} · 士气{" "}
            {formatDelta(lastResult.moraleDelta)} · 声望 {formatDelta(lastResult.prestigeDelta)}
          </Text>
          {lastResult.breakthroughs.map((event) => (
            <Text key={event.discipleId} className="result-line">
              【{BREAKTHROUGH_OUTCOME_LABELS[event.outcome]}】{event.discipleName}
              {event.outcome === "success" ? `（升至实力等级 ${event.toRealmLevel ?? "?"}）` : ""}
              {event.outcome === "failure" ? `（成功率 ${event.successRate}%）` : ""}
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
        <View className="upgrade-row">
          <Button
            className="btn-upgrade"
            disabled={state.sectRank >= 3 || Boolean(state.ending)}
            onClick={() => store.upgrade()}
          >
            宗门升阶
          </Button>
          {upgradeHint !== "" && <Text className="muted">{upgradeHint}</Text>}
        </View>
        <View className="save-row-group">
          <Text className="muted">手动存档：</Text>
          {[1, 2, 3].map((target) => (
            <Button
              key={target}
              className="btn-save"
              onClick={() => store.saveToSlot(target as 1 | 2 | 3)}
            >
              存入{target}格
            </Button>
          ))}
        </View>
      </View>
    </View>
  );
}
