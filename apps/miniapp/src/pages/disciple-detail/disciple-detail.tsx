import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  MAX_SPELLS_PER_DISCIPLE,
  ROOT_ELEMENT_DISPLAY_NAMES,
  ROOT_TYPE_DISPLAY_NAMES,
  SPELLS,
  SPELL_AFFINITY_PCT,
  TREASURES,
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
import type {
  GearSlot,
  RootElement,
  Spell,
  TechniqueEffect,
  Treasure,
} from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { getCurrentInstance, navigateBack, reLaunch } from "@tarojs/taro";
import { Fragment, useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { AdvanceBar } from "../../ui/advance-bar";
import { GENDER_DISPLAY_NAMES, formatZhenyuanRequirement, realmToneClass } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import { OptionPicker } from "../../ui/picker";
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
  const store = getGameStore();
  const { state, errorMessage } = useGame();
  // 功法/法术/法宝行可点按：已有条目时展开效果明细；未修/未穿戴时点按从仓库/藏经阁选用。
  const [expandedSection, setExpandedSection] = useState<"technique" | "spell" | "gear" | null>(
    null,
  );
  const toggleSection = (key: "technique" | "spell" | "gear") =>
    setExpandedSection((current) => (current === key ? null : key));
  // 从仓库选用弹层：功法/法术共用 artPicker（藏经阁研读），法宝按槽位从仓库穿戴。
  const [artPicker, setArtPicker] = useState<"technique" | "spell" | null>(null);
  const [gearPickerSlot, setGearPickerSlot] = useState<GearSlot | null>(null);

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
  // 聚灵丹：生效期内在真元行中间标注 buff 效果与剩余月数（与结算侧 monthlyZhenyuanGain 同口径）。
  const focusUntil = disciple.spiritFocusUntilTurn ?? 0;
  const focusActive = focusUntil >= state.currentTurn;
  const focusMonthsLeft = Math.max(0, focusUntil - state.currentTurn + 1);
  const spellIds = disciple.spellIds ?? [];
  const equipped = disciple.equippedGear ?? {};
  const injuryMonths = injuryMonthsLeftFor(disciple, state.currentTurn);

  // 从仓库/藏经阁选用：候选未入门不可操作；终局后锁定。
  const canManage = !isCandidate && state.ending === undefined;
  const library = state.library ?? { techniqueIds: [], spellIds: [] };
  const warehouse = state.warehouse ?? { gear: [], pills: [] };
  const techniqueOptions = library.techniqueIds.map((artId) => {
    const technique = getTechniqueById(artId);
    return {
      key: artId,
      title: `《${technique?.name ?? artId}》`,
      sub: technique ? techniqueEffectLines(technique.effect).join("；") : undefined,
      disabledReason: disciple.techniqueId
        ? `已修《${getTechniqueById(disciple.techniqueId)?.name ?? disciple.techniqueId}》，限修一门`
        : "",
    };
  });
  const spellOptions = SPELLS.filter((spell) => library.spellIds.includes(spell.id)).map(
    (spell) => ({
      key: spell.id,
      title: `《${spell.name}》`,
      sub: spellEffectLines(spell, disciple.rootElements).join("；"),
      disabledReason: spellIds.includes(spell.id)
        ? "已在修此法术"
        : spellIds.length >= MAX_SPELLS_PER_DISCIPLE
          ? `法术已满 ${MAX_SPELLS_PER_DISCIPLE} 门`
          : "",
    }),
  );
  const gearOptionsFor = (slot: GearSlot) => {
    const counts = new Map<string, number>();
    for (const entry of warehouse.gear) {
      if (entry.slot !== slot) continue;
      counts.set(entry.treasureId, (counts.get(entry.treasureId) ?? 0) + 1);
    }
    return TREASURES.filter((treasure) => counts.has(treasure.id)).map((treasure) => ({
      key: treasure.id,
      title: `「${treasure.name}」 ×${counts.get(treasure.id)}`,
      sub: treasureEffectLines(treasure).join("；"),
    }));
  };

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
          {canManage && (
            <View className="auto-pill-block">
              <View className="auto-pill-row">
                <Text className="auto-pill-label">自动服用丹药</Text>
                <View
                  className={`auto-pill-chip${disciple.autoPillYanshou ? " auto-pill-chip-on" : ""}`}
                  onClick={() =>
                    store.setAutoPill(disciple.id, "pill-yanshou", !disciple.autoPillYanshou)
                  }
                >
                  <Text>{disciple.autoPillYanshou ? "☑" : "☐"} 延寿丹</Text>
                </View>
                <View
                  className={`auto-pill-chip${disciple.autoPillJuling ? " auto-pill-chip-on" : ""}`}
                  onClick={() =>
                    store.setAutoPill(disciple.id, "pill-juling", !disciple.autoPillJuling)
                  }
                >
                  <Text>{disciple.autoPillJuling ? "☑" : "☐"} 聚灵丹</Text>
                </View>
              </View>
              <Text className="muted">
                延寿丹：剩余寿命 ≤30 年自动服 · 聚灵丹：增益失效自动续服
              </Text>
            </View>
          )}
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
            {focusActive && (
              <Text className="pill-badge">聚灵丹 ×1.5 · 剩 {focusMonthsLeft} 月</Text>
            )}
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
          {errorMessage !== null && (
            <Text className="error-line" onClick={() => store.clearError()}>
              {errorMessage}（点击关闭）
            </Text>
          )}
          {(() => {
            const technique = disciple.techniqueId
              ? getTechniqueById(disciple.techniqueId)
              : undefined;
            return (
              <>
                <View
                  className={`attr-row${technique || canManage ? " attr-row-tap" : ""}`}
                  onClick={() => {
                    if (technique) toggleSection("technique");
                    else if (canManage) setArtPicker("technique");
                  }}
                >
                  <Text>功法</Text>
                  <Text>
                    {technique ? (
                      <>
                        《{technique.name}》 {expandedSection === "technique" ? "▾" : "▸"}
                      </>
                    ) : (
                      "未修 · 点按选用"
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
            className={`attr-row${spellIds.length > 0 || canManage ? " attr-row-tap" : ""}`}
            onClick={() => {
              if (spellIds.length > 0) toggleSection("spell");
              else if (canManage) setArtPicker("spell");
            }}
          >
            <Text>法术</Text>
            <Text>
              {spellIds.length === 0 ? (
                "未修 · 点按选用"
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
              {canManage && (
                <Button className="btn-mini" onClick={() => setArtPicker("spell")}>
                  从藏经阁加修法术（{spellIds.length}/{MAX_SPELLS_PER_DISCIPLE}）
                </Button>
              )}
            </View>
          )}
          {GEAR_SLOT_KEYS.map((slot) => {
            const treasure = equipped[slot] ? getTreasureById(equipped[slot]) : undefined;
            return (
              <Fragment key={slot}>
                <View
                  className={`attr-row${treasure || canManage ? " attr-row-tap" : ""}`}
                  onClick={() => {
                    if (treasure) toggleSection("gear");
                    else if (canManage) setGearPickerSlot(slot);
                  }}
                >
                  <Text>{GEAR_SLOT_DISPLAY_NAMES[slot]}</Text>
                  <Text>
                    {treasure ? (
                      <>
                        「{treasure.name}」 {expandedSection === "gear" ? "▾" : "▸"}
                      </>
                    ) : (
                      "未穿戴 · 点按选用"
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
                    {canManage && (
                      <Button className="btn-mini" onClick={() => setGearPickerSlot(slot)}>
                        从仓库更换{GEAR_SLOT_DISPLAY_NAMES[slot]}
                      </Button>
                    )}
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
        </View>

        {artPicker === "technique" && (
          <OptionPicker
            title={`为${disciple.name}选用功法`}
            hint="研读藏经阁书册；功法限修 1 门，书册研读后消耗。"
            emptyText="藏经阁暂无功法书册，历练奇遇可得。"
            items={techniqueOptions}
            onCancel={() => setArtPicker(null)}
            onPick={(artId) => {
              store.study(disciple.id, artId);
              setArtPicker(null);
            }}
          />
        )}
        {artPicker === "spell" && (
          <OptionPicker
            title={`为${disciple.name}选用法术`}
            hint={`法术限修 ${MAX_SPELLS_PER_DISCIPLE} 门，研读后书册消耗。`}
            emptyText="藏经阁暂无藏书，历练奇遇可得。"
            items={spellOptions}
            onCancel={() => setArtPicker(null)}
            onPick={(artId) => {
              store.study(disciple.id, artId);
              setArtPicker(null);
            }}
          />
        )}
        {gearPickerSlot !== null && (
          <OptionPicker
            title={`为${disciple.name}选用${GEAR_SLOT_DISPLAY_NAMES[gearPickerSlot]}`}
            hint="穿戴仓库法宝；同槽已穿法宝将卸下回仓。"
            emptyText="仓库暂无该槽位法宝，历练掉落与器坊炼制可得。"
            items={gearOptionsFor(gearPickerSlot)}
            onCancel={() => setGearPickerSlot(null)}
            onPick={(treasureId) => {
              store.wear(disciple.id, gearPickerSlot, treasureId);
              setGearPickerSlot(null);
            }}
          />
        )}
      </View>
      <AdvanceBar />
    </View>
  );
}
