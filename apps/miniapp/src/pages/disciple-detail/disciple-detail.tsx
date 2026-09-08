import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  ROOT_ELEMENT_DISPLAY_NAMES,
  ROOT_TYPE_DISPLAY_NAMES,
  buildCombatProfile,
  discipleCultivationView,
  effectiveAttributes,
  getSpellById,
  getTechniqueById,
  injuryMonthsLeftFor,
  listRecruitCandidates,
  talentById,
} from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { getCurrentInstance, navigateBack, reLaunch } from "@tarojs/taro";
import { useGame } from "../../store/use-game";
import { GENDER_DISPLAY_NAMES, formatZhenyuanRequirement, realmToneClass } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import "./disciple-detail.css";

export default function DiscipleDetailPage() {
  const { state } = useGame();

  const params = getCurrentInstance().router?.params ?? {};
  const discipleId = params.id ?? "";
  const candidateId = params.candidate ?? "";
  const isCandidate = candidateId !== "";
  if (!state) {
    reLaunch({ url: "/pages/index/index" });
    return null;
  }
  // 候选预览：按当前状态确定性重算候选列表（与弟子殿名册同源）；候选未入门，只在预览里查。
  const candidate = isCandidate
    ? listRecruitCandidates(state).find((item) => item.candidateId === candidateId)
    : undefined;
  const disciple = isCandidate
    ? candidate?.disciple
    : state.disciples.find((item) => item.id === discipleId);
  if (!disciple) {
    return (
      <View className="page">
        <View className="card">
          <Text>
            {isCandidate ? "候选已刷新，请返回名册重新查看。" : "弟子不存在，可能已坐化。"}
          </Text>
          <Button className="btn-primary" onClick={() => navigateBack()}>
            返回
          </Button>
        </View>
      </View>
    );
  }

  const effective = effectiveAttributes(disciple.attributes, disciple.talentIds);
  const combat = buildCombatProfile(disciple);
  const view = discipleCultivationView(state, disciple);
  const spellIds = disciple.spellIds ?? [];
  const equipped = disciple.equippedGear ?? {};
  const injuryMonths = injuryMonthsLeftFor(disciple, state.currentTurn);

  return (
    <View className="page">
      <BackBar title={isCandidate ? "候选详情" : "弟子详情"} />
      <View className="page-body">
        <View className="card">
          <View className="card-title detail-head">
            <View className="detail-name-wrap">
              <Text className="detail-name">{disciple.name}</Text>
              {isCandidate && <Text className="candidate-badge">候选预览</Text>}
            </View>
            <Text className={realmToneClass(disciple.realmLevel)}>{view.stageName}</Text>
          </View>
          <Text className="muted">
            {GENDER_DISPLAY_NAMES[disciple.gender]} · {disciple.age}/{disciple.maxLifespan} 岁 ·
            灵根：{ROOT_TYPE_DISPLAY_NAMES[disciple.rootType]}（
            {disciple.rootElements.map((element) => ROOT_ELEMENT_DISPLAY_NAMES[element]).join("")}）
          </Text>
          {isCandidate && <Text className="muted">入门后按此档案直接录入内门。</Text>}
        </View>

        <View className="card">
          <View className="card-title">五维</View>
          <View className="attr-grid">
            {ATTRIBUTE_KEYS.map((key) => (
              <View key={key} className="attr-cell">
                <Text className="muted">{ATTRIBUTE_DISPLAY_NAMES[key]}</Text>
                <Text className="attr-cell-value">{effective[key]}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="card">
          <View className="card-title">战斗属性</View>
          <View className="combat-grid">
            {(
              [
                ["生命", combat.maxHp],
                ["物理攻击", combat.physicalAttack],
                ["法术威力", combat.magicPower],
                ["防御", combat.defense],
                ["先攻", combat.firstStrike],
                ["暴击率", `${combat.critRate}%`],
              ] as const
            ).map(([label, value]) => (
              <View key={label} className="combat-cell">
                <Text className="muted">{label}</Text>
                <Text className="attr-cell-value">{value}</Text>
              </View>
            ))}
          </View>
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
              {disciple.zhenyuan}/{formatZhenyuanRequirement(view.requiredZhenyuan)}
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
        </View>

        <View className="card">
          <View className="card-title">功法 · 法术 · 法宝 · 伤势</View>
          <View className="attr-row">
            <Text>功法</Text>
            <Text>
              {disciple.techniqueId
                ? `《${getTechniqueById(disciple.techniqueId)?.name}》`
                : "未修"}
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
          {GEAR_SLOT_KEYS.map((slot) => (
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
      </View>
    </View>
  );
}
