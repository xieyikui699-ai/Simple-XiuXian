import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  ROOT_ELEMENT_DISPLAY_NAMES,
  ROOT_TYPE_DISPLAY_NAMES,
  SPELL_AFFINITY_PCT,
  buildCombatProfile,
  discipleCultivationView,
  effectiveAttributes,
  getSpellById,
  getTechniqueById,
  getTreasureById,
  injuryMonthsLeftFor,
  listRecruitCandidates,
  spellAffinityMultiplier,
  talentById,
} from "@simple-xiuxian/engine";
import type { RootElement, Spell, TechniqueEffect, Treasure } from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { getCurrentInstance, navigateBack, reLaunch } from "@tarojs/taro";
import { Fragment, useState } from "react";
import { useGame } from "../../store/use-game";
import { AdvanceBar } from "../../ui/advance-bar";
import { GENDER_DISPLAY_NAMES, formatZhenyuanRequirement, realmToneClass } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import "./disciple-detail.css";

/** 功法被动效果 → 展示文案（逐行，数值与 catalog 目录同源）。 */
function techniqueEffectLines(effect: TechniqueEffect): string[] {
  const lines: string[] = [];
  if (effect.zhenyuanPct) lines.push(`真元修炼速度 +${Math.round(effect.zhenyuanPct * 100)}%`);
  const flats = ATTRIBUTE_KEYS.map((key) => effect.attributeFlat?.[key] ?? 0);
  if (flats[0] !== 0 && flats.every((value) => value === flats[0])) {
    lines.push(`五维 +${flats[0]}`);
  } else {
    for (const [index, key] of ATTRIBUTE_KEYS.entries()) {
      if (flats[index]) {
        lines.push(`${ATTRIBUTE_DISPLAY_NAMES[key]} +${flats[index]}`);
      }
    }
  }
  if (effect.defenseFlat) lines.push(`防御 +${effect.defenseFlat}`);
  if (effect.breakthroughFlat) lines.push(`突破成功率 +${effect.breakthroughFlat}%`);
  return lines;
}

/** 法宝单项效果 → 展示文案（逐行，数值与 catalog 目录同源）。 */
function treasureEffectLines(treasure: Treasure): string[] {
  const effect = treasure.effect;
  const lines: string[] = [];
  if (effect.attributeFlat) {
    const entries = ATTRIBUTE_KEYS.map((key) => effect.attributeFlat?.[key] ?? 0).filter(
      (value) => value !== 0,
    );
    if (
      entries.length === ATTRIBUTE_KEYS.length &&
      entries.every((value) => value === entries[0])
    ) {
      lines.push(`五维 +${entries[0]}`);
    } else {
      for (const key of ATTRIBUTE_KEYS) {
        const value = effect.attributeFlat?.[key];
        if (value) lines.push(`${ATTRIBUTE_DISPLAY_NAMES[key]} +${value}`);
      }
    }
    lines.push("提升对应属性的战斗成长");
  }
  if (effect.attackFlat) lines.push(`攻击 +${effect.attackFlat}`);
  if (effect.attackPct) lines.push(`攻击 +${effect.attackPct}%`);
  if (effect.defenseFlat) lines.push(`防御 +${effect.defenseFlat}`);
  if (effect.defensePct) lines.push(`防御 +${effect.defensePct}%`);
  if (effect.maxHpFlat) lines.push(`最大生命 +${effect.maxHpFlat}`);
  if (effect.critFlat) lines.push(`暴击率 +${effect.critFlat}%`);
  if (effect.spellPowerFlat) {
    lines.push(`法术威力 +${effect.spellPowerFlat}`);
    lines.push("战斗中所有法术伤害提升");
  }
  return lines;
}

/** 法术主动战技效果 → 展示文案（逐行，含与当前弟子灵根同系的威力加成）。 */
function spellEffectLines(spell: Spell, rootElements: readonly RootElement[]): string[] {
  const lines: string[] = [
    spell.element === "none" ? "无系法术" : `${ROOT_ELEMENT_DISPLAY_NAMES[spell.element]}系法术`,
  ];
  if (spell.multiplier > 0) lines.push(`伤害 = 法威 × ${spell.multiplier}`);
  lines.push(`冷却 ${spell.cooldown} 回合`);
  const status = spell.status;
  if (status.burn) {
    lines.push(
      `灼烧：目标每回合损失最大生命 ${status.burn.hpPctPerTurn}%，持续 ${status.burn.turns} 回合`,
    );
  }
  if (status.freeze) {
    const chance = status.freeze.chancePct ?? 100;
    lines.push(
      chance >= 100
        ? `冰冻：目标无法行动 ${status.freeze.turns} 回合`
        : `冰冻：${chance}% 概率使目标无法行动 ${status.freeze.turns} 回合`,
    );
  }
  if (status.slow)
    lines.push(`减速：目标先攻 −${status.slow.firstStrikeFlat}，持续 ${status.slow.turns} 回合`);
  if (status.shieldHpPct) lines.push(`护盾：获得最大生命 ${status.shieldHpPct}% 的护盾`);
  if (status.reflectPct) lines.push(`反伤：受击时反弹 ${status.reflectPct}% 伤害`);
  if (status.lifestealPct) lines.push(`吸血：按造成伤害的 ${status.lifestealPct}% 治疗自身`);
  if (status.ignoreDefensePct) lines.push(`破防：无视目标 ${status.ignoreDefensePct}% 防御`);
  if (spellAffinityMultiplier(spell, rootElements) > 1) {
    lines.push(`灵根同系，威力 +${Math.round(SPELL_AFFINITY_PCT * 100)}%`);
  }
  return lines;
}

export default function DiscipleDetailPage() {
  const { state } = useGame();
  // 功法/法术/法宝行可点按，在行下展开效果明细；同一时间只展开一节。
  const [expandedSection, setExpandedSection] = useState<"technique" | "spell" | "gear" | null>(
    null,
  );
  const toggleSection = (key: "technique" | "spell" | "gear") =>
    setExpandedSection((current) => (current === key ? null : key));

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
        <AdvanceBar />
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
          <Text className="muted">点按功法 / 法术 / 法宝行查看效果。</Text>
          {(() => {
            const technique = disciple.techniqueId
              ? getTechniqueById(disciple.techniqueId)
              : undefined;
            return (
              <>
                <View
                  className={`attr-row${technique ? " attr-row-tap" : ""}`}
                  onClick={technique ? () => toggleSection("technique") : undefined}
                >
                  <Text>功法</Text>
                  <Text>
                    {technique ? (
                      <>
                        《{technique.name}》 {expandedSection === "technique" ? "▾" : "▸"}
                      </>
                    ) : (
                      "未修"
                    )}
                  </Text>
                </View>
                {technique && expandedSection === "technique" && (
                  <View className="effect-panel">
                    {techniqueEffectLines(technique.effect).map((line) => (
                      <Text key={line} className="effect-line">
                        {line}
                      </Text>
                    ))}
                  </View>
                )}
              </>
            );
          })()}
          <View
            className={`attr-row${spellIds.length > 0 ? " attr-row-tap" : ""}`}
            onClick={spellIds.length > 0 ? () => toggleSection("spell") : undefined}
          >
            <Text>法术</Text>
            <Text>
              {spellIds.length === 0 ? (
                "未修"
              ) : (
                <>
                  {spellIds.map((id) => `《${getSpellById(id)?.name ?? id}》`).join("、")}{" "}
                  {expandedSection === "spell" ? "▾" : "▸"}
                </>
              )}
            </Text>
          </View>
          {expandedSection === "spell" && (
            <View className="effect-panel">
              {spellIds.map((id) => {
                const spell = getSpellById(id);
                if (!spell) return null;
                return (
                  <View key={id} className="effect-block">
                    <Text className="effect-title">《{spell.name}》</Text>
                    {spellEffectLines(spell, disciple.rootElements).map((line) => (
                      <Text key={line} className="effect-line">
                        {line}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </View>
          )}
          {GEAR_SLOT_KEYS.map((slot) => {
            const treasure = equipped[slot] ? getTreasureById(equipped[slot]) : undefined;
            return (
              <Fragment key={slot}>
                <View
                  className={`attr-row${treasure ? " attr-row-tap" : ""}`}
                  onClick={treasure ? () => toggleSection("gear") : undefined}
                >
                  <Text>{GEAR_SLOT_DISPLAY_NAMES[slot]}</Text>
                  <Text>
                    {treasure ? (
                      <>
                        「{treasure.name}」 {expandedSection === "gear" ? "▾" : "▸"}
                      </>
                    ) : (
                      "未穿戴"
                    )}
                  </Text>
                </View>
                {treasure && expandedSection === "gear" && (
                  <View className="effect-panel">
                    {treasureEffectLines(treasure).map((line) => (
                      <Text key={line} className="effect-line">
                        {line}
                      </Text>
                    ))}
                  </View>
                )}
              </Fragment>
            );
          })}
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
      <AdvanceBar />
    </View>
  );
}
