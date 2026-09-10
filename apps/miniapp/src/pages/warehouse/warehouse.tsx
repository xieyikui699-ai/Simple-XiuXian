import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  PILLS,
  SPELLS,
  TREASURES,
  type Technique,
  type Treasure,
  getSpellById,
  getTechniqueById,
  getTreasureById,
  realmStageForLevel,
  treasureEffectDescription,
} from "@simple-xiuxian/engine";
import type { Disciple, GameState, GearSlot } from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { AdvanceBar } from "../../ui/advance-bar";
import { formatNumber, formatTurn, formatZhenyuanRequirement } from "../../ui/display";
import { BackBar } from "../../ui/nav";
import { DisciplePicker } from "../../ui/picker";
import "./warehouse.css";

type Usage =
  | { kind: "wear"; slot: GearSlot; treasureId: string }
  | { kind: "pill"; pillId: string }
  | { kind: "learn"; artId: string }
  | null;

function techniqueEffectText(technique: Technique): string {
  const parts: string[] = [];
  if (technique.effect.zhenyuanPct !== undefined) {
    parts.push(`真元 +${Math.round(technique.effect.zhenyuanPct * 100)}%`);
  }
  if (technique.effect.breakthroughFlat !== undefined) {
    parts.push(`突破率 +${technique.effect.breakthroughFlat}`);
  }
  if (technique.effect.defenseFlat !== undefined) {
    parts.push(`防御 +${technique.effect.defenseFlat}`);
  }
  if (technique.effect.attributeFlat) {
    const attrs = ATTRIBUTE_KEYS.map((key) => {
      const value = technique.effect.attributeFlat?.[key];
      return value !== undefined && value > 0 ? `${ATTRIBUTE_DISPLAY_NAMES[key]} +${value}` : "";
    }).filter((text) => text.length > 0);
    if (attrs.length > 0) parts.push(attrs.join("、"));
  }
  return parts.join("；") || "无效果";
}

function spellEffectText(spellId: string): string {
  const spell = getSpellById(spellId);
  if (!spell) return spellId;
  const parts = [`倍率 ${spell.multiplier}×`, `CD ${spell.cooldown}`];
  const status = spell.status;
  if (status.burn) {
    parts.push(
      `灼烧 ${Math.round(status.burn.hpPctPerTurn * 100)}%/回合 ×${status.burn.turns} 回合`,
    );
  }
  if (status.freeze) {
    parts.push(
      status.freeze.chancePct === undefined
        ? "冰冻 1 回合"
        : `冰冻（${status.freeze.chancePct}% 概率）`,
    );
  }
  if (status.slow) {
    parts.push(`减速先攻 −${status.slow.firstStrikeFlat} ×${status.slow.turns} 回合`);
  }
  if (status.shieldHpPct !== undefined)
    parts.push(`护盾 ${Math.round(status.shieldHpPct * 100)}% 最大生命`);
  if (status.reflectPct !== undefined) parts.push(`反伤 ${Math.round(status.reflectPct * 100)}%`);
  if (status.lifestealPct !== undefined)
    parts.push(`吸血 ${Math.round(status.lifestealPct * 100)}%`);
  if (status.ignoreDefensePct !== undefined) {
    parts.push(`无视防御 ${Math.round(status.ignoreDefensePct * 100)}%`);
  }
  return parts.join(" · ");
}

function usableInner(state: GameState): Disciple[] {
  return state.disciples;
}

export default function WarehousePage() {
  const store = getGameStore();
  const { state, errorMessage } = useGame();
  const [usage, setUsage] = useState<Usage>(null);

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;
  const ended = state.ending !== undefined;
  const warehouse = state.warehouse ?? { gear: [], pills: [] };
  const library = state.library ?? { techniqueIds: [], spellIds: [] };

  const gearRows = GEAR_SLOT_KEYS.flatMap((slot) => {
    const counts = new Map<string, number>();
    for (const entry of warehouse.gear) {
      if (entry.slot !== slot) continue;
      counts.set(entry.treasureId, (counts.get(entry.treasureId) ?? 0) + 1);
    }
    return TREASURES.filter((treasure) => counts.has(treasure.id)).map((treasure) => ({
      slot,
      treasure,
      count: counts.get(treasure.id) ?? 0,
    }));
  });

  const pickerDisciples = usableInner(state);

  const renderPicker = () => {
    if (!usage) return null;
    if (usage.kind === "wear") {
      const treasure: Treasure | undefined = getTreasureById(usage.treasureId);
      return (
        <DisciplePicker
          title={`穿戴${GEAR_SLOT_DISPLAY_NAMES[usage.slot]}「${treasure?.name ?? usage.treasureId}」`}
          hint={`${treasure ? `${treasureEffectDescription(treasure)}。` : ""}同槽已穿法宝将卸下回仓。`}
          disciples={pickerDisciples}
          subText={(disciple) => {
            const worn = GEAR_SLOT_KEYS.flatMap((slot) => {
              const id = disciple.equippedGear?.[slot];
              if (id === undefined) return [];
              const treasure = getTreasureById(id);
              return [
                `「${treasure?.name ?? id}」${treasure ? treasureEffectDescription(treasure) : ""}`,
              ];
            });
            return worn.length > 0 ? `已穿 ${worn.join("、")}` : "未穿戴法宝";
          }}
          onCancel={() => setUsage(null)}
          onPick={(discipleId) => {
            store.wear(discipleId, usage.slot, usage.treasureId);
            setUsage(null);
          }}
        />
      );
    }
    if (usage.kind === "pill") {
      const pill = PILLS.find((entry) => entry.id === usage.pillId);
      return (
        <DisciplePicker
          title={`服用${pill?.name ?? usage.pillId}`}
          hint={
            pill?.effect.zhenyuanBuff !== undefined
              ? "聚灵丹同弟子倍率不叠加、时长累加。"
              : undefined
          }
          subText={
            pill?.effect.lifespanFlat !== undefined
              ? (disciple) => `寿命 ${disciple.age}/${disciple.maxLifespan} 岁`
              : pill?.effect.zhenyuanBuff !== undefined
                ? (disciple) => {
                    const zhenyuanText = `真元 ${disciple.zhenyuan}/${formatZhenyuanRequirement(
                      realmStageForLevel(disciple.realmLevel).requiredZhenyuan,
                    )}`;
                    const until = disciple.spiritFocusUntilTurn;
                    if (until === undefined || until < state.currentTurn) return zhenyuanText;
                    const remaining = until - state.currentTurn;
                    return remaining > 0
                      ? `${zhenyuanText} · 聚灵丹生效中（剩 ${remaining} 个月）`
                      : `${zhenyuanText} · 聚灵丹生效中（本月到期）`;
                  }
                : undefined
          }
          disciples={pickerDisciples}
          onCancel={() => setUsage(null)}
          onPick={(discipleId) => {
            store.takePill(discipleId, usage.pillId);
            setUsage(null);
          }}
        />
      );
    }
    const spell = getSpellById(usage.artId);
    return (
      <DisciplePicker
        title={`研读《${getTechniqueById(usage.artId)?.name ?? spell?.name ?? usage.artId}》`}
        hint="功法限修 1 门、法术限修 2 门，研读后书册均消耗。"
        disciples={pickerDisciples}
        disabledReason={(disciple) => {
          if (getSpellById(usage.artId)) {
            const known = disciple.spellIds ?? [];
            if (known.includes(usage.artId)) return "已在修此法术";
            if (known.length >= 2) return "法术已满 2 门";
          } else if (disciple.techniqueId) {
            const tech = getTechniqueById(disciple.techniqueId);
            return `已修《${tech?.name ?? disciple.techniqueId}》`;
          }
          return "";
        }}
        subText={(disciple) => {
          const stageName = realmStageForLevel(disciple.realmLevel);
          return `真元 ${disciple.zhenyuan}/${formatZhenyuanRequirement(stageName.requiredZhenyuan)}`;
        }}
        onCancel={() => setUsage(null)}
        onPick={(discipleId) => {
          store.study(discipleId, usage.artId);
          setUsage(null);
        }}
      />
    );
  };

  return (
    <View className="page">
      <BackBar title="仓库 · 藏经阁" />
      <View className="page-body">
        <View className="card">
          <View className="card-title">仓库 · 藏经阁</View>
          <Text className="muted">
            当前灵石：{formatNumber(state.spiritStones)} · {formatTurn(state.currentTurn)}
          </Text>
          {errorMessage !== null && (
            <Text className="error-line" onClick={() => store.clearError()}>
              {errorMessage}（点击关闭）
            </Text>
          )}
        </View>

        <View className="card">
          <View className="card-title">装备（未穿戴 {warehouse.gear.length} 件）</View>
          {gearRows.length === 0 && (
            <Text className="muted">仓库暂无装备。历练掉落与器坊炼制可得。</Text>
          )}
          {gearRows.map((row) => (
            <View key={`${row.slot}-${row.treasure.id}`} className="stock-row">
              <View className="stock-info">
                <Text>
                  {GEAR_SLOT_DISPLAY_NAMES[row.slot]}「{row.treasure.name}」 ×{row.count}
                </Text>
                <Text className="muted">{treasureEffectDescription(row.treasure)}</Text>
              </View>
              <Button
                className="btn-mini"
                disabled={ended}
                onClick={() =>
                  setUsage({ kind: "wear", slot: row.slot, treasureId: row.treasure.id })
                }
              >
                穿戴
              </Button>
            </View>
          ))}
        </View>

        <View className="card">
          <View className="card-title">丹药</View>
          {warehouse.pills.length === 0 && (
            <Text className="muted">仓库暂无丹药。丹房炼制可得。</Text>
          )}
          {warehouse.pills.map((entry) => {
            const pill = PILLS.find((item) => item.id === entry.pillId);
            return (
              <View key={entry.pillId} className="stock-row">
                <View className="stock-info">
                  <Text>
                    {pill?.name ?? entry.pillId} ×{entry.count}
                  </Text>
                  <Text className="muted">
                    {pill?.effect.lifespanFlat !== undefined
                      ? `最大寿命 +${pill.effect.lifespanFlat} 年`
                      : `${pill?.effect.zhenyuanBuff?.months} 月内真元 ×${pill?.effect.zhenyuanBuff?.multiplier}`}
                  </Text>
                </View>
                <Button
                  className="btn-mini"
                  disabled={ended}
                  onClick={() => setUsage({ kind: "pill", pillId: entry.pillId })}
                >
                  服用
                </Button>
              </View>
            );
          })}
        </View>

        <View className="card">
          <View className="card-title">
            藏经阁（功法 {library.techniqueIds.length} / 法术 {library.spellIds.length}）
          </View>
          {library.techniqueIds.length === 0 && library.spellIds.length === 0 && (
            <Text className="muted">藏经阁暂无藏书，先等历练奇遇入阁。</Text>
          )}
          {library.techniqueIds.map((artId) => {
            const technique = getTechniqueById(artId);
            return (
              <View key={artId} className="stock-row">
                <View className="stock-info">
                  <Text>《{technique?.name ?? artId}》</Text>
                  <Text className="muted">{technique ? techniqueEffectText(technique) : ""}</Text>
                </View>
                <Button
                  className="btn-mini"
                  disabled={ended}
                  onClick={() => setUsage({ kind: "learn", artId })}
                >
                  研读
                </Button>
              </View>
            );
          })}
          {SPELLS.filter((spell) => library.spellIds.includes(spell.id)).map((spell) => (
            <View key={spell.id} className="stock-row">
              <View className="stock-info">
                <Text>《{spell.name}》</Text>
                <Text className="muted">{spellEffectText(spell.id)}</Text>
              </View>
              <Button
                className="btn-mini"
                disabled={ended}
                onClick={() => setUsage({ kind: "learn", artId: spell.id })}
              >
                研读
              </Button>
            </View>
          ))}
        </View>

        {renderPicker()}
      </View>
      <AdvanceBar />
    </View>
  );
}
