import {
  ATTRIBUTE_KEYS,
  RECRUIT_COST,
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
import { realmToneClass } from "../../ui/display";
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
  const inner = state.disciples
    .filter((disciple) => disciple.role === "inner")
    .sort(
      (a, b) => b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan || a.id.localeCompare(b.id),
    );
  const outer = state.disciples
    .filter((disciple) => disciple.role === "outer")
    .sort(
      (a, b) => b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan || a.id.localeCompare(b.id),
    );
  const candidates = showRecruit ? listRecruitCandidates(state) : [];

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
        <View className="disciple-name">{disciple.name}</View>
        <View className="disciple-realm">
          <Text className={realmToneClass(disciple.realmLevel)}>
            {disciple.realm} · Lv.{disciple.realmLevel}
          </Text>
        </View>
        <View className="disciple-zhenyuan">
          真元 {disciple.zhenyuan}/{stage.requiredZhenyuan} · {disciple.age}/{disciple.maxLifespan}
          岁
        </View>
      </View>
    );
  };

  return (
    <View className="page">
      <View className="card">
        <View className="card-title roster-head">
          <Text>名册</Text>
          <Button className="btn-recruit" onClick={() => setShowRecruit(!showRecruit)}>
            {showRecruit ? "收起招募" : `招募弟子（${RECRUIT_COST} 灵石）`}
          </Button>
        </View>
        {showRecruit && (
          <View className="recruit-panel">
            <Text className="muted">候选 3 选 1，入门后入外门。</Text>
            {candidates.map((candidate) => (
              <View key={candidate.candidateId} className="candidate-row">
                <View className="candidate-info">
                  <Text>
                    {candidate.disciple.name} · {rootLabel(candidate.disciple)}
                  </Text>
                  <Text className="muted">
                    五维 {ATTRIBUTE_KEYS.map((key) => candidate.disciple.attributes[key]).join("/")}
                    {" · 天赋 "}
                    {candidate.disciple.talentIds
                      .map((id) => talentById(id)?.name ?? id)
                      .join("、") || "无"}
                  </Text>
                </View>
                <Button className="btn-admit" onClick={() => store.recruit(candidate.candidateId)}>
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

      <View className="card">
        <View className="card-title">
          外门（{outer.length}/{limits.outerLimit}）
        </View>
        {outer.length === 0 && <Text className="muted">外门无人。</Text>}
        {outer.map(renderDisciple)}
      </View>
    </View>
  );
}
