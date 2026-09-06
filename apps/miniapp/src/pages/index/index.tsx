import { Button, Input, Label, Radio, RadioGroup, Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { DIFFICULTY_DISPLAY_NAMES, type Difficulty, type SaveMeta } from "../../store/save-adapter";
import { getGameStore, useGame } from "../../store/use-game";
import { formatTurn } from "../../ui/display";
import "./index.css";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

function saveLabel(meta: SaveMeta): string {
  const slotName = meta.slot === 4 ? "自动格" : `手动格${meta.slot}`;
  const ended = meta.ended ? " · 已终局" : "";
  return `${slotName} · ${meta.sectName} · ${formatTurn(meta.turn)}${ended}`;
}

export default function IndexPage() {
  const store = getGameStore();
  const { saves, errorMessage, slot } = useGame();
  const [sectName, setSectName] = useState("");
  const [seed, setSeed] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");

  useDidShow(() => {
    store.refreshSaves();
  });

  const startNewGame = () => {
    const chosenSeed = seed.trim() === "" ? `zx-${Date.now().toString(36)}` : seed.trim();
    const ok = store.newGame({
      sectName: sectName.trim() === "" ? "无名小宗" : sectName.trim(),
      seed: chosenSeed,
      difficulty,
    });
    if (ok) reLaunch({ url: "/pages/main/main" });
  };

  const continueSlot = (target: number) => {
    if (store.loadSlot(target as 1 | 2 | 3 | 4)) reLaunch({ url: "/pages/main/main" });
  };

  return (
    <View className="page">
      <View className="hero">
        <View className="hero-title">掌门，不好了</View>
        <View className="muted">两宗对抗 · 文字修仙经营（简化版）</View>
      </View>

      {errorMessage !== null && (
        <View className="card error-line" onClick={() => store.clearError()}>
          {errorMessage}（点击关闭）
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
          <Text className="field-label">天命种子</Text>
          <Input
            className="field-input"
            placeholder="留空则随机（同种子同命途）"
            value={seed}
            onInput={(event) => setSeed(event.detail.value)}
          />
        </View>
        <View className="field">
          <Text className="field-label">对手难度（NPC 宗门波次接入后生效）</Text>
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

      <View className="card">
        <View className="card-title">继续征程</View>
        {slot !== null && (
          <Button className="continue-resume" onClick={() => continueSlot(slot)}>
            继续上局（自动格）
          </Button>
        )}
        {saves.length === 0 && <Text className="muted">暂无存档，先开一局吧。</Text>}
        {saves.map((meta) => (
          <View key={meta.slot} className="save-row">
            <View className="save-main" onClick={() => continueSlot(meta.slot)}>
              <Text>{saveLabel(meta)}</Text>
            </View>
            {meta.slot !== 4 && (
              <Text
                className="save-delete"
                onClick={() => {
                  store.deleteSlot(meta.slot);
                  store.refreshSaves();
                }}
              >
                删除
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
