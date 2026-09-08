import {
  WAR_COOLDOWN_MONTHS,
  canPlayerDeclareWar,
  injuryMonthsLeftFor,
  realmStageForLevel,
  rivalRosterView,
} from "@simple-xiuxian/engine";
import type { GameState } from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { getGameStore, useGame } from "../../store/use-game";
import { formatNumber, formatTurn, realmToneClass } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import "./rival.css";

const DIFFICULTY_LABELS: Record<string, string> = {
  "0.8": "简单 ×0.8",
  "1": "标准 ×1.0",
  "1.2": "困难 ×1.2",
};

function difficultyLabel(multiplier: number): string {
  return DIFFICULTY_LABELS[String(multiplier)] ?? `×${multiplier}`;
}

function warCooldownText(state: GameState): string | null {
  const ends = state.warCooldownEndsTurn;
  if (ends === undefined || state.currentTurn > ends) return null;
  return `会战冷却中（自宣战起 ${WAR_COOLDOWN_MONTHS} 月），还需 ${ends - state.currentTurn + 1} 月`;
}

function outcomeLabel(decidedBy: string): string {
  if (decidedBy === "wins") return "胜场占优";
  if (decidedBy === "totalDamage") return "总伤害占优";
  return "势均力敌，天命在我";
}

export default function RivalPage() {
  const store = getGameStore();
  const { state, errorMessage } = useGame();

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;
  const rival = state.rival;
  const roster = rival ? rivalRosterView(rival, state.currentTurn) : [];
  const cooldownText = warCooldownText(state);
  const canDeclare = canPlayerDeclareWar(state);

  return (
    <View className="page">
      <BackBar title="对手宗门" />
      <View className="page-body">
        <View className="card">
          <View className="card-title">对手宗门 · 情报</View>
          {rival ? (
            <View className="rival-facts">
              <Text>
                {rival.name} · {rival.sectRank} 级宗门 · {difficultyLabel(rival.difficulty)}
              </Text>
              <Text className="muted">
                声望 {rival.prestige} · 士气 {rival.morale} · 灵石{" "}
                {formatNumber(rival.spiritStones)}
              </Text>
              <Text className="muted">
                我方：{state.sectRank} 级 · 声望 {state.prestige} · {formatTurn(state.currentTurn)}
              </Text>
            </View>
          ) : (
            <Text className="muted">对手宗门缺失（旧档）。</Text>
          )}
          {state.warWithRival && (
            <Text className="war-banner">⚔ 两宗已开战，来月月结触发会战！</Text>
          )}
          {!state.warWithRival && cooldownText !== null && (
            <Text className="muted">{cooldownText}</Text>
          )}
          <Button className="btn-primary" disabled={!canDeclare} onClick={() => store.wageWar()}>
            {canDeclare ? "宣战（来月会战）" : "暂不可宣战"}
          </Button>
          {errorMessage !== null && (
            <Text className="error-line" onClick={() => store.clearError()}>
              {errorMessage}（点击关闭）
            </Text>
          )}
        </View>

        {rival && (
          <View className="card">
            <View className="card-title">内门名册（{roster.length} 人，情报透明）</View>
            {roster.map((entry) => {
              const disciple = rival.disciples.find((item) => item.id === entry.id);
              const injuryMonths = disciple ? injuryMonthsLeftFor(disciple, state.currentTurn) : 0;
              return (
                <View key={entry.id} className="rival-row">
                  <Text>
                    {entry.isLeader ? "【掌门】" : ""}
                    {entry.name}
                  </Text>
                  <Text className={realmToneClass(entry.realmLevel)}>
                    {realmStageForLevel(entry.realmLevel).name}
                  </Text>
                  <Text className={entry.injured ? "rival-injured" : "muted"}>
                    {entry.injured ? `伤势未愈（禁战 ${injuryMonths} 月）` : "可出战"}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View className="card">
          <View className="card-title">会战记录（最新在前，至多留存 20 场）</View>
          {(state.sectWars ?? []).length === 0 && (
            <Text className="muted">尚无会战。宣战后来月开战，胜方掠灵石 10%（上限 5,000）。</Text>
          )}
          {(state.sectWars ?? []).map((record, index) => (
            <View key={`${record.turn}-${index}`} className="war-record">
              <Text className={record.winner === "player" ? "war-win" : "war-lose"}>
                {formatTurn(record.turn)} · {record.winner === "player" ? "我方胜" : "我方败"}（
                {outcomeLabel(record.decidedBy)}）
              </Text>
              <Text className="muted">{record.summary}</Text>
              <Text className="muted">
                声望 {record.prestigeDelta > 0 ? "+" : ""}
                {record.prestigeDelta} · 士气 {record.moraleDelta > 0 ? "+" : ""}
                {record.moraleDelta} · 三阵对阵：
                {record.pairOutcomes
                  .map((pair) => `${pair.playerFighterName}vs${pair.rivalFighterName}`)
                  .join("、")}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
