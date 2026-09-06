import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  ROOT_ELEMENT_DISPLAY_NAMES,
  ROOT_TYPE_DISPLAY_NAMES,
  discipleCultivationView,
  effectiveAttributes,
  sectLimitsFor,
  talentById,
} from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { getCurrentInstance, navigateBack, reLaunch } from "@tarojs/taro";
import { getGameStore, useGame } from "../../store/use-game";
import { GENDER_DISPLAY_NAMES, formatNumber, realmToneClass } from "../../ui/display";
import "./disciple-detail.css";

export default function DiscipleDetailPage() {
  const store = getGameStore();
  const { state, errorMessage } = useGame();

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
        <Text className="muted">功法/法术研读与装备穿戴将于内容目录波次（M2）后开放。</Text>
        <Text className="muted">伤势记录将于战斗波次后开放。</Text>
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
          <Text className="muted">长老任命将于管理命令波次（M2）后开放。</Text>
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
