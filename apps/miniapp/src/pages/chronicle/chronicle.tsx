import type { BattleReport, BattleReportSegment, GameState } from "@simple-xiuxian/engine";
import { battleSourceLabel, formatBattleReportSegments } from "@simple-xiuxian/engine";
import { Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { useGame } from "../../store/use-game";
import { AdvanceBar } from "../../ui/advance-bar";
import { formatTurn } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import "./chronicle.css";

const KIND_LABELS: Record<string, string> = {
  milestone: "里程碑",
  warning: "警告",
  normal: "记事",
};

function battleTitle(report: BattleReport): string {
  const source = battleSourceLabel(report.source);
  const verdict = report.winner === "A" ? "我方胜" : report.winner === "B" ? "对方胜" : "平局";
  return `${formatTurn(report.turn ?? 0)} · ${source} · ${verdict}（${report.rounds} 回合）`;
}

/** 单行分段渲染：人名段按 tone 着色（A 我方绿 / B 对方红），其余纯文本。 */
function renderSegments(segments: BattleReportSegment[]) {
  return segments.map((segment, segIndex) => {
    // biome-ignore lint/suspicious/noArrayIndexKey: 段序稳定不重排
    if (!segment.tone) return <Text key={segIndex}>{segment.text}</Text>;
    const cls =
      segment.tone === "own" ? "replay-name replay-name-own" : "replay-name replay-name-enemy";
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: 段序稳定不重排
      <Text key={segIndex} className={cls}>
        {segment.text}
      </Text>
    );
  });
}

function battleRows(report: BattleReport, expanded: boolean) {
  if (!expanded) return null;
  // 文字战报：引擎叙事层逐行转写（谁与谁对战、谁用了什么、对谁造成多少伤害）。
  return (
    <View className="replay-body">
      {formatBattleReportSegments(report).map((segments, index) => {
        const line = segments.map((segment) => segment.text).join("");
        const cls = `replay-line${line.startsWith("——") ? " replay-line-round" : line.startsWith("· ") ? " replay-line-note" : ""}`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 战报行只读不重排，序号即稳定键
          <Text key={index} className={cls}>
            {renderSegments(segments)}
          </Text>
        );
      })}
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
      <AdvanceBar />
    </View>
  );
}
