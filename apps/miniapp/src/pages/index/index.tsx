import { Button, Input, Label, Radio, RadioGroup, Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import type { AutoSaveData } from "../../store/auto-save";
import { DIFFICULTY_DISPLAY_NAMES, type Difficulty } from "../../store/game-store";
import { getGameStore, readAutoSave, useGame } from "../../store/use-game";
import { formatDateTime, formatTurn } from "../../ui/display";
import "./index.css";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

export default function IndexPage() {
  const store = getGameStore();
  const { errorMessage } = useGame();
  const [sectName, setSectName] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [save, setSave] = useState<AutoSaveData | null>(null);

  // 每次显示首页重读自动档（终局后返回首页时存档已被删除，此处读不到即不展示继续入口）。
  useDidShow(() => setSave(readAutoSave()));

  const canContinue = save !== null && !save.state.ending;

  const startNewGame = () => {
    const ok = store.newGame({
      sectName: sectName.trim() === "" ? "无名小宗" : sectName.trim(),
      seed: `zx-${Date.now().toString(36)}`,
      difficulty,
    });
    if (ok) reLaunch({ url: "/pages/main/main" });
  };

  const continueGame = () => {
    if (!canContinue || save === null) return;
    store.loadGame(save.state, save.difficulty);
    reLaunch({ url: "/pages/main/main" });
  };

  return (
    <View className="page">
      <View className="page-body">
        <View className="hero">
          <View className="hero-title">掌门，不好了</View>
          <View className="hero-rule" />
          <View className="hero-sub">两宗对抗 · 文字修仙经营（简化版）</View>
        </View>

        {errorMessage !== null && (
          <View className="card error-line" onClick={() => store.clearError()}>
            {errorMessage}（点击关闭）
          </View>
        )}

        {canContinue && save !== null && (
          <View className="card">
            <View className="card-title">继续修仙</View>
            <View className="continue-row">
              <Text className="continue-sect">{save.state.sectName}</Text>
              <Text className="continue-meta">
                {formatTurn(save.state.currentTurn)} · {DIFFICULTY_DISPLAY_NAMES[save.difficulty]}
              </Text>
            </View>
            <Text className="muted continue-sub">上次保存 {formatDateTime(save.savedAt)}</Text>
            <Button className="btn-primary" onClick={continueGame}>
              继续修仙
            </Button>
          </View>
        )}

        <View className="card">
          <View className="card-title">新的开始</View>
          <View className="field">
            <Text className="field-label">宗门名</Text>
            <Input
              className="field-input"
              placeholder="2–24 个字，如：青云门"
              value={sectName}
              onInput={(event) => setSectName(event.detail.value)}
            />
          </View>
          <View className="field">
            <Text className="field-label">对手难度（影响 NPC 宗门发展速度）</Text>
            <RadioGroup
              className="difficulty-group"
              onChange={(event) => setDifficulty(event.detail.value as Difficulty)}
            >
              {DIFFICULTIES.map((level) => (
                <Label key={level} className="difficulty-option">
                  <Radio value={level} checked={difficulty === level} />
                  <Text>{DIFFICULTY_DISPLAY_NAMES[level]}</Text>
                </Label>
              ))}
            </RadioGroup>
          </View>
          <Button className="btn-primary" onClick={startNewGame}>
            开新局
          </Button>
        </View>
      </View>
    </View>
  );
}
