import {
  ATTRIBUTE_KEYS,
  RECRUIT_COST,
  RECRUIT_REFRESH_TURNS,
  ROOT_ELEMENT_DISPLAY_NAMES,
  ROOT_TYPE_DISPLAY_NAMES,
  listRecruitCandidates,
  realmStageForLevel,
  sectLimitsFor,
  talentById,
} from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { navigateTo, reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { AdvanceBar } from "../../ui/advance-bar";
import { formatZhenyuanRequirement, realmToneClass } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import "./disciples.css";

export default function DisciplesPage() {
  const store = getGameStore();
  const { state, errorMessage } = useGame();
  const [showRecruit, setShowRecruit] = useState(false);

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;

  const limits = sectLimitsFor(state.sectRank);
  const inner = [...state.disciples].sort(
    (a, b) => b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan || a.id.localeCompare(b.id),
  );
  const innerFull = inner.length >= limits.innerLimit;
  const candidates = showRecruit ? listRecruitCandidates(state) : [];
  const monthsUntilRefresh =
    RECRUIT_REFRESH_TURNS - ((state.currentTurn - 1) % RECRUIT_REFRESH_TURNS);

  const rootLabel = (disciple: (typeof state.disciples)[number]): string =>
    `${ROOT_TYPE_DISPLAY_NAMES[disciple.rootType]}（${disciple.rootElements
      .map((element) => ROOT_ELEMENT_DISPLAY_NAMES[element])
      .join("")}）`;

  const renderDisciple = (disciple: (typeof state.disciples)[number]) => {
    const stage = realmStageForLevel(disciple.realmLevel);
    return (
      <View
        key={disciple.id}
        className="disciple-row"
        onClick={() =>
          navigateTo({ url: `/pages/disciple-detail/disciple-detail?id=${disciple.id}` })
        }
      >
        <Text className="disciple-name">{disciple.name}</Text>
        <Text className={`disciple-realm ${realmToneClass(disciple.realmLevel)}`}>
          {stage.name}
        </Text>
        <Text className="disciple-zhenyuan">
          真元 {disciple.zhenyuan}/{formatZhenyuanRequirement(stage.requiredZhenyuan)} ·{" "}
          {disciple.age}/{disciple.maxLifespan} 岁
        </Text>
      </View>
    );
  };

  return (
    <View className="page">
      <BackBar title="弟子殿" />
      <View className="page-body">
        <View className="card">
          <View className="card-title roster-head">
            <Text>名册</Text>
            <Button
              className="btn-recruit"
              disabled={innerFull}
              onClick={() => setShowRecruit(!showRecruit)}
            >
              {showRecruit ? "收起招募" : `招募弟子（${RECRUIT_COST} 灵石）`}
            </Button>
          </View>
          {innerFull && <Text className="muted">内门席位已满，无法招募。</Text>}
          {showRecruit && (
            <View className="recruit-panel">
              <Text className="muted">{monthsUntilRefresh} 个月后刷新</Text>
              {candidates.map((candidate) => (
                <View key={candidate.candidateId} className="candidate-row">
                  <View
                    className="candidate-info"
                    onClick={() =>
                      navigateTo({
                        url: `/pages/disciple-detail/disciple-detail?candidate=${candidate.candidateId}`,
                      })
                    }
                  >
                    <Text>
                      {candidate.disciple.name} · {rootLabel(candidate.disciple)}
                    </Text>
                    <Text className="muted">
                      五维{" "}
                      {ATTRIBUTE_KEYS.map((key) => candidate.disciple.attributes[key]).join("/")}
                      {" · 天赋 "}
                      {candidate.disciple.talentIds
                        .map((id) => talentById(id)?.name ?? id)
                        .join("、") || "无"}
                    </Text>
                  </View>
                  <Button
                    className="btn-admit"
                    onClick={() => store.recruit(candidate.candidateId)}
                  >
                    入门
                  </Button>
                </View>
              ))}
            </View>
          )}
          {errorMessage !== null && (
            <Text className="error-line" onClick={() => store.clearError()}>
              {errorMessage}（点击关闭）
            </Text>
          )}
        </View>

        <View className="card">
          <View className="card-title">
            内门（{inner.length}/{limits.innerLimit}）
          </View>
          {inner.length === 0 && <Text className="muted">内门无人。</Text>}
          {inner.map(renderDisciple)}
        </View>
      </View>
      <AdvanceBar />
    </View>
  );
}
