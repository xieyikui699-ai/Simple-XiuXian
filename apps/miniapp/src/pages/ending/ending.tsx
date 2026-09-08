import { Button, Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useGame } from "../../store/use-game";
import { formatNumber, formatTurn } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import "./ending.css";

const ENDING_KIND_LABELS: Record<string, string> = {
  annexation: "吞并胜利 · 独尊一方",
  annexed: "被吞并 · 山门倾覆",
  bankrupt: "宗门凋敝 · 曲终人散",
};

export default function EndingPage() {
  const { state } = useGame();

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  return (
    <View className="page">
      <BackBar title="仙途结局" />
      <View className="page-body">
        {state.ending ? (
          <View className="card ending-card">
            <View className="card-title">{ENDING_KIND_LABELS[state.ending.kind]}</View>
            <Text className="ending-text">{state.ending.text}</Text>
            <Text className="muted">触发于 {formatTurn(state.ending.turn)}</Text>
          </View>
        ) : (
          <View className="card">
            <View className="card-title">本局仍在进行</View>
            <Text className="muted">
              压制对方声望且宗门等级更高可吞并对手；声望扫地则被吞并，内门凋敝则宗门败落。
            </Text>
          </View>
        )}

        <View className="card">
          <View className="card-title">仙途总览</View>
          <View className="ending-row">
            <Text>历经岁月</Text>
            <Text>{formatTurn(state.currentTurn)}</Text>
          </View>
          <View className="ending-row">
            <Text>坐化弟子</Text>
            <Text>{state.fallen.length} 人</Text>
          </View>
          <View className="ending-row">
            <Text>剩余灵石</Text>
            <Text>{formatNumber(state.spiritStones)}</Text>
          </View>
          <View className="ending-row">
            <Text>宗门等级</Text>
            <Text>{state.sectRank} 级</Text>
          </View>
          {state.fallen.length > 0 && (
            <Text className="muted">
              先后仙逝：{state.fallen.map((fallen) => fallen.name).join("、")}
            </Text>
          )}
        </View>

        <View className="card">
          <View className="card-title">仙途评级</View>
          {state.ending?.rating ? (
            <View className="ending-row">
              <Text>评级（用时/突破/会战胜绩/坐化/灵石）</Text>
              <Text>
                {state.ending.rating} · 得分 {state.ending.score ?? "—"}/10
              </Text>
            </View>
          ) : (
            <Text className="muted">终局后由引擎结算给出甲/乙/丙/丁评级。</Text>
          )}
        </View>

        <Button className="btn-primary" onClick={() => reLaunch({ url: "/pages/index/index" })}>
          返回首页（可开新局）
        </Button>
      </View>
    </View>
  );
}
