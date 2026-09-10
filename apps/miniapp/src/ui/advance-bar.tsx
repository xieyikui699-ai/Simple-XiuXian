import { Button, Switch, Text, View } from "@tarojs/components";
import { useAutoAdvance } from "../store/auto-advance";
import { getGameStore, useGame } from "../store/use-game";
import "./advance-bar.css";

/**
 * 底部推进栏：推进一月 + 自动推进开关。
 * 各游戏页共用，切页时保持常显；未开局（无 state）不渲染。
 * 终局时按钮与开关禁用。
 */
export function AdvanceBar() {
  const { state } = useGame();
  const { enabled: auto, setEnabled: setAuto } = useAutoAdvance();
  if (!state) return null;
  const ended = Boolean(state.ending);
  return (
    <View className="page-footer">
      <Button className="btn-advance" disabled={ended} onClick={() => getGameStore().settleMonth()}>
        推进一月
      </Button>
      <View
        className="auto-wrap"
        onClick={() => {
          if (!ended) setAuto(!auto);
        }}
      >
        <Switch checked={auto} onChange={(event) => setAuto(event.detail.value)} />
        <Text className="auto-label">自动推进</Text>
      </View>
    </View>
  );
}
