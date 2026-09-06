import { Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useGame } from "../../store/use-game";
import { formatTurn } from "../../ui/display";
import "./chronicle.css";

const KIND_LABELS: Record<string, string> = {
  milestone: "里程碑",
  warning: "警告",
  normal: "记事",
};

export default function ChroniclePage() {
  const { state } = useGame();

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  return (
    <View className="page">
      <View className="card">
        <View className="card-title">宗门纪事（最新在前，最多留存 500 条）</View>
        <Text className="muted">
          战斗条目与会战逐回合回放将于战斗波次（E01/E04）接入后分色显示并可点开回放。
        </Text>
      </View>
      <View className="card">
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
  );
}
