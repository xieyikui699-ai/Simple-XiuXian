import { Button, Text, View } from "@tarojs/components";
import { navigateBack, reLaunch, useDidShow } from "@tarojs/taro";
import { useGame } from "../../store/use-game";
import { formatNumber, formatTurn } from "../../ui/display";

export default function WarehousePage() {
  const { state } = useGame();

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  return (
    <View className="page">
      <View className="card">
        <View className="card-title">仓库</View>
        <Text className="muted">
          当前灵石：{formatNumber(state.spiritStones)} · {formatTurn(state.currentTurn)}
        </Text>
      </View>
      <View className="card">
        <Text className="muted">
          目录基础（E02-F01/F02：装备四槽四档、丹药两种、功法 8 门、法术 12
          门）已合入引擎；仓库卡片与使用入口（研读/穿戴/服丹）依赖 E02-F03 管理命令，历练掉落随 E03
          波次接入。合入前本页为路由占位。
        </Text>
      </View>
      <Button className="btn-primary" onClick={() => navigateBack()}>
        返回
      </Button>
    </View>
  );
}
