import type { BattleReport, GameState } from "@simple-xiuxian/engine";
import { Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { useGame } from "../../store/use-game";
import { formatTurn } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import "./chronicle.css";

const KIND_LABELS: Record<string, string> = {
  milestone: "里程碑",
  warning: "警告",
  normal: "记事",
};

const SOURCE_LABELS: Record<string, string> = {
  "sect-war": "会战",
  expedition: "历练",
  sparring: "切磋",
};

const ACTION_KIND_LABELS: Record<string, string> = {
  basic: "普攻",
  spell: "法术",
  skip: "冰冻跳过",
  burn: "灼烧结算",
};

function battleTitle(report: BattleReport): string {
  const source = SOURCE_LABELS[report.source ?? ""] ?? "战斗";
  const verdict = report.winner === "A" ? "我方胜" : report.winner === "B" ? "对方胜" : "平局";
  return `${formatTurn(report.turn ?? 0)} · ${source} · ${verdict}（${report.rounds} 回合）`;
}

function battleRows(report: BattleReport, expanded: boolean) {
  if (!expanded) return null;
  return (
    <View className="replay-body">
      {report.actions.map((action, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 战报 actions 只读不重排，序号即稳定键
        <View key={index} className="replay-row">
          <Text className="replay-round">R{action.round}</Text>
          <Text className={`replay-side replay-side-${action.actor}`}>
            {action.actor === "A" ? "我方" : "对方"}
          </Text>
          <Text className="replay-kind">{ACTION_KIND_LABELS[action.kind] ?? action.kind}</Text>
          <Text className="replay-detail">
            {action.hit === false
              ? "未命中"
              : `伤害 ${action.damage}${action.crit ? "（会心）" : ""}`}
            {action.shieldAbsorbed > 0 ? ` · 护盾吸收 ${action.shieldAbsorbed}` : ""}
            {action.lifestealHeal > 0 ? ` · 吸血回 ${action.lifestealHeal}` : ""}
            {action.reflectDamage > 0 ? ` · 反伤 ${action.reflectDamage}` : ""}
          </Text>
          <Text className="replay-hp">
            血 {action.hp.A}/{action.hp.B}
          </Text>
        </View>
      ))}
      {report.actions.some((action) => action.statusNotes.length > 0) && (
        <View className="replay-notes">
          {report.actions
            .flatMap((action) => action.statusNotes.map((note) => ({ round: action.round, note })))
            .map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 状态注记列表只读不重排
              <Text key={index} className="muted">
                R{entry.round}：{entry.note}
              </Text>
            ))}
        </View>
      )}
      <Text className="muted">
        终局生命 我方 {report.finalHp.A} / 对方 {report.finalHp.B} · 总伤害 {report.totalDamage.A}/
        {report.totalDamage.B}
      </Text>
    </View>
  );
}

function battleReplayAllowed(state: GameState): boolean {
  return (state.battles ?? []).length > 0;
}

export default function ChroniclePage() {
  const { state } = useGame();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;
  const battles = state.battles ?? [];

  return (
    <View className="page">
      <BackBar title="宗门纪事" />
      <View className="page-body">
        {battleReplayAllowed(state) && (
          <View className="card">
            <View className="card-title">战报回放（最新 {battles.length} 场）</View>
            <Text className="muted">点击一场战斗展开逐回合记录；更早战报仅存纪事摘要。</Text>
            {battles.map((report, index) => {
              const key = `${report.seed}-${index}`;
              const expanded = expandedKey === key;
              return (
                <View key={key} className="replay-item">
                  <View
                    className={`replay-head replay-head-${report.winner === "A" ? "win" : report.winner === "B" ? "lose" : "draw"}`}
                    onClick={() => setExpandedKey(expanded ? null : key)}
                  >
                    <Text>{battleTitle(report)}</Text>
                  </View>
                  {battleRows(report, expanded)}
                </View>
              );
            })}
          </View>
        )}

        <View className="card">
          <View className="card-title">宗门纪事（最新在前，最多留存 500 条）</View>
          {state.chronicle.length === 0 && <Text className="muted">尚无纪事。</Text>}
          {state.chronicle.map((entry, index) => (
            <View
              // 纪事无稳定 id，以 turn+序号 充当键。
              key={`${entry.turn}-${index}`}
              className={`chronicle-row chronicle-${entry.kind}`}
            >
              <Text className="chronicle-kind">{KIND_LABELS[entry.kind]}</Text>
              <View className="chronicle-body">
                <Text>{entry.text}</Text>
                <Text className="muted">{formatTurn(entry.turn)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
