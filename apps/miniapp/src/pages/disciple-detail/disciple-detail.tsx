import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  PILLS,
  ROOT_ELEMENT_DISPLAY_NAMES,
  ROOT_TYPE_DISPLAY_NAMES,
  discipleCultivationView,
  effectiveAttributes,
  getSpellById,
  getTechniqueById,
  injuryMonthsLeftFor,
  sectLimitsFor,
  talentById,
} from "@simple-xiuxian/engine";
import type { GearSlot } from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { getCurrentInstance, navigateBack, reLaunch } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { GENDER_DISPLAY_NAMES, formatNumber, realmToneClass } from "../../ui/display";
import "./disciple-detail.css";

type DetailAction = "study" | "wear" | "pill" | null;

export default function DiscipleDetailPage() {
  const store = getGameStore();
  const { state, errorMessage } = useGame();
  const [detailAction, setDetailAction] = useState<DetailAction>(null);

  const discipleId = getCurrentInstance().router?.params?.id ?? "";
  if (!state) {
    reLaunch({ url: "/pages/index/index" });
    return null;
  }
  const disciple = state.disciples.find((item) => item.id === discipleId);
  if (!disciple) {
    return (
      <View className="page">
        <View className="card">
          <Text>弟子不存在，可能已坐化。</Text>
          <Button className="btn-primary" onClick={() => navigateBack()}>
            返回
          </Button>
        </View>
      </View>
    );
  }

  const effective = effectiveAttributes(disciple.attributes, disciple.talentIds);
  const view = discipleCultivationView(state, disciple);
  const limits = sectLimitsFor(state.sectRank);
  const innerCount = state.disciples.filter((item) => item.role === "inner").length;
  const canPromote = disciple.role === "outer" && innerCount < limits.innerLimit && !state.ending;
  const ended = state.ending !== undefined;
  const warehouse = state.warehouse ?? { gear: [], pills: [] };
  const library = state.library ?? { techniqueIds: [], spellIds: [] };
  const spellIds = disciple.spellIds ?? [];
  const equipped = disciple.equippedGear ?? {};
  const injuryMonths = injuryMonthsLeftFor(disciple, state.currentTurn);
  const isElder = state.elders?.resource === disciple.id || state.elders?.war === disciple.id;
  const jobBusy =
    (state.jobs?.pill.workers.includes(disciple.id) ?? false) ||
    (state.jobs?.gear.workers.includes(disciple.id) ?? false);
  const canBeElder =
    !ended && disciple.role === "inner" && disciple.age >= 16 && !jobBusy && !isElder;
  const learnableTechniques = library.techniqueIds.filter(() => !disciple.techniqueId);
  const learnableSpells = library.spellIds.filter((id) => !spellIds.includes(id));

  return (
    <View className="page">
      <View className="card">
        <View className="card-title detail-head">
          <Text className="detail-name">{disciple.name}</Text>
          <Text className={realmToneClass(disciple.realmLevel)}>
            {disciple.realm} · Lv.{disciple.realmLevel}
          </Text>
        </View>
        <Text className="muted">
          {GENDER_DISPLAY_NAMES[disciple.gender]} · {disciple.age}/{disciple.maxLifespan} 岁 ·{" "}
          {disciple.role === "inner" ? "内门" : "外门"}
        </Text>
        <Text className="muted">
          灵根：{ROOT_TYPE_DISPLAY_NAMES[disciple.rootType]}（
          {disciple.rootElements.map((element) => ROOT_ELEMENT_DISPLAY_NAMES[element]).join("")}）
        </Text>
      </View>

      <View className="card">
        <View className="card-title">五维（基础→有效）</View>
        {ATTRIBUTE_KEYS.map((key) => (
          <View key={key} className="attr-row">
            <Text>{ATTRIBUTE_DISPLAY_NAMES[key]}</Text>
            <Text>
              {disciple.attributes[key]} → {effective[key]}
            </Text>
          </View>
        ))}
      </View>

      <View className="card">
        <View className="card-title">天赋</View>
        {disciple.talentIds.length === 0 && <Text className="muted">无天赋。</Text>}
        {disciple.talentIds.map((id) => {
          const talent = talentById(id);
          if (!talent) return <Text key={id}>{id}</Text>;
          return (
            <View key={id} className="talent-row">
              <Text className="talent-name">{talent.name}</Text>
              <Text className="muted">{talent.description}</Text>
            </View>
          );
        })}
      </View>

      <View className="card">
        <View className="card-title">修炼视图</View>
        <View className="attr-row">
          <Text>当前阶段</Text>
          <Text>{view.stageName}</Text>
        </View>
        <View className="attr-row">
          <Text>真元</Text>
          <Text>
            {disciple.zhenyuan}/{formatNumber(view.requiredZhenyuan)}
          </Text>
        </View>
        <View className="attr-row">
          <Text>每月真元</Text>
          <Text>+{view.monthlyGain}</Text>
        </View>
        <View className="attr-row">
          <Text>下次突破率</Text>
          <Text>{view.successRate}%</Text>
        </View>
        <View className="attr-row">
          <Text>突破失败积累</Text>
          <Text>{disciple.breakthroughFailures} 次（每次 +5%）</Text>
        </View>
        <View className="attr-row">
          <Text>境界寿元加成</Text>
          <Text>+{view.realmLifespanBonus} 年</Text>
        </View>
      </View>

      <View className="card">
        <View className="card-title">功法 · 法术 · 装备 · 伤势</View>
        <View className="attr-row">
          <Text>功法</Text>
          <Text>
            {disciple.techniqueId ? `《${getTechniqueById(disciple.techniqueId)?.name}》` : "未修"}
          </Text>
        </View>
        <View className="attr-row">
          <Text>法术</Text>
          <Text>
            {spellIds.length === 0
              ? "未修"
              : spellIds.map((id) => `《${getSpellById(id)?.name ?? id}》`).join("、")}
          </Text>
        </View>
        {GEAR_SLOT_KEYS.map((slot: GearSlot) => (
          <View key={slot} className="attr-row">
            <Text>{GEAR_SLOT_DISPLAY_NAMES[slot]}</Text>
            <Text>{equipped[slot] ? `档${equipped[slot]}` : "未穿戴"}</Text>
          </View>
        ))}
        <View className="attr-row">
          <Text>伤势</Text>
          <Text>
            {disciple.injury
              ? `${disciple.injury.kind === "severe" ? "重伤" : "轻伤"} · 禁战 ${injuryMonths} 月`
              : "无"}
          </Text>
        </View>
        {(disciple.spiritFocusUntilTurn ?? 0) >= state.currentTurn && (
          <Text className="muted">
            聚灵丹生效中：真元 ×1.5（至 {disciple.spiritFocusUntilTurn} 回目）。
          </Text>
        )}
      </View>

      <View className="card">
        <View className="card-title">管理操作</View>
        {disciple.role === "outer" ? (
          <Button
            className="btn-primary"
            disabled={!canPromote}
            onClick={() => store.promote(disciple.id)}
          >
            提拔入内门
          </Button>
        ) : (
          <View className="detail-actions">
            <Button
              className="btn-mini"
              disabled={ended || learnableTechniques.length === 0}
              onClick={() => setDetailAction(detailAction === "study" ? null : "study")}
            >
              研读（藏经阁 {learnableTechniques.length + learnableSpells.length} 本可修）
            </Button>
            <Button
              className="btn-mini"
              disabled={ended || warehouse.gear.length === 0}
              onClick={() => setDetailAction(detailAction === "wear" ? null : "wear")}
            >
              穿戴仓库装备
            </Button>
            <Button
              className="btn-mini"
              disabled={ended || warehouse.pills.length === 0}
              onClick={() => setDetailAction(detailAction === "pill" ? null : "pill")}
            >
              服用丹药
            </Button>
            {!isElder && (
              <>
                <Button
                  className="btn-mini"
                  disabled={!canBeElder}
                  onClick={() => store.appointElder(disciple.id, "resource")}
                >
                  任命资源长老
                </Button>
                <Button
                  className="btn-mini"
                  disabled={!canBeElder}
                  onClick={() => store.appointElder(disciple.id, "war")}
                >
                  任命战备长老
                </Button>
              </>
            )}
            {isElder && <Text className="muted">现任长老（不战斗不修炼）。</Text>}
            {jobBusy && !isElder && <Text className="muted">车间任内，卸任后可任命长老。</Text>}
          </View>
        )}

        {detailAction === "study" && disciple.role === "inner" && (
          <View className="detail-panel">
            {learnableTechniques.length === 0 && learnableSpells.length === 0 && (
              <Text className="muted">藏经阁暂无可修之书（历练奇遇入阁）。</Text>
            )}
            {learnableTechniques.map((artId) => {
              const technique = getTechniqueById(artId);
              return (
                <Button
                  key={artId}
                  className="btn-mini"
                  onClick={() => store.study(disciple.id, artId)}
                >
                  修《{technique?.name ?? artId}》
                </Button>
              );
            })}
            {learnableSpells.map((artId) => {
              const spell = getSpellById(artId);
              return (
                <Button
                  key={artId}
                  className="btn-mini"
                  onClick={() => store.study(disciple.id, artId)}
                >
                  习《{spell?.name ?? artId}》
                </Button>
              );
            })}
          </View>
        )}
        {detailAction === "wear" && (
          <View className="detail-panel">
            {warehouse.gear.length === 0 && <Text className="muted">仓库暂无装备。</Text>}
            {warehouse.gear.map((entry, index) => (
              <Button
                key={`${entry.slot}-${entry.tier}-${index}`}
                className="btn-mini"
                onClick={() => {
                  store.wear(disciple.id, entry.slot, entry.tier);
                  setDetailAction(null);
                }}
              >
                穿 {GEAR_SLOT_DISPLAY_NAMES[entry.slot]}（档{entry.tier}）
              </Button>
            ))}
          </View>
        )}
        {detailAction === "pill" && (
          <View className="detail-panel">
            {warehouse.pills.length === 0 && <Text className="muted">仓库暂无丹药。</Text>}
            {warehouse.pills.map((entry) => {
              const pill = PILLS.find((item) => item.id === entry.pillId);
              return (
                <Button
                  key={entry.pillId}
                  className="btn-mini"
                  onClick={() => {
                    store.takePill(disciple.id, entry.pillId);
                    setDetailAction(null);
                  }}
                >
                  服 {pill?.name ?? entry.pillId} ×{entry.count}
                </Button>
              );
            })}
          </View>
        )}
        {errorMessage !== null && (
          <Text className="error-line" onClick={() => store.clearError()}>
            {errorMessage}（点击关闭）
          </Text>
        )}
      </View>
    </View>
  );
}
