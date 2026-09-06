import { Button, Text, View } from "@tarojs/components";
import { navigateBack, reLaunch, useDidShow } from "@tarojs/taro";
import { useGame } from "../../store/use-game";
import { formatTurn } from "../../ui/display";

export default function RivalPage() {
  const { state } = useGame();

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  return (
    <View className="page">
      <View className="card">
        <View className="card-title">对手宗门 · 情报</View>
        <Text className="muted">
          当前回合：{formatTurn(state.currentTurn)} · 我方声望 {state.prestige}
        </Text>
      </View>
      <View className="card">
        <Text className="muted">
          对手宗门名册（姓名/境界/伤势）、灵石区间、宣战与冷却、会战记录依赖 NPC
          宗门引擎（E04：rival.ts /
          sect-war.ts），该波次尚未合入本仓。届时本页提供：名册情报、宣战按钮、三份会战战报逐回合回放入口。
          当前页面为路由占位。
        </Text>
      </View>
      <Button className="btn-primary" onClick={() => navigateBack()}>
        返回
      </Button>
    </View>
  );
}
