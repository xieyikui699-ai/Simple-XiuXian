import { Button, Text, View } from "@tarojs/components";
import { navigateBack, reLaunch, useDidShow } from "@tarojs/taro";
import { useGame } from "../../store/use-game";
import { formatNumber, formatTurn } from "../../ui/display";

export default function AlchemyPage() {
  const { state } = useGame();

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  return (
    <View className="page">
      <View className="card">
        <View className="card-title">丹房 · 器坊</View>
        <Text className="muted">
          当前灵石：{formatNumber(state.spiritStones)} · {formatTurn(state.currentTurn)}
        </Text>
      </View>
      <View className="card">
        <Text className="muted">
          目录与生产核心（E02-F01/F02：catalog.ts / production.ts）已合入引擎；岗位任命入口与月结
          增益接线（E02-F03 管理命令）尚未完成，本页暂缓接入，避免 UI 抢跑引擎口径。待 E02-F03
          合入后本页提供：
        </Text>
        <Text className="muted">
          · 丹房：延寿丹（40 点 / 500 灵石 / 2 月）、聚灵丹（20 点 / 300 灵石 / 1 月）
        </Text>
        <Text className="muted">· 器坊：装备四槽四档炼制（20/60/150/300 点，宗门等级限档）</Text>
      </View>
      <Button className="btn-primary" onClick={() => navigateBack()}>
        返回
      </Button>
    </View>
  );
}
