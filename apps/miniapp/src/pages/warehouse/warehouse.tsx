import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  PILLS,
  SPELLS,
  type Technique,
  getSpellById,
  getTechniqueById,
} from "@simple-xiuxian/engine";
import type { Disciple, GameState, GearSlot, GearTier } from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { navigateBack, reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { formatNumber, formatTurn } from "../../ui/display";
import { DisciplePicker } from "../../ui/picker";
import "./warehouse.css";

type Usage =
  | { kind: "wear"; slot: GearSlot; tier: GearTier }
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
  return state.disciples.filter((disciple) => disciple.role === "inner");
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
    const tiers = warehouse.gear
      .filter((entry) => entry.slot === slot)
      .reduce((counts, entry) => {
        counts.set(entry.tier, (counts.get(entry.tier) ?? 0) + 1);
        return counts;
      }, new Map<GearTier, number>());
    return [...tiers.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([tier, count]) => ({ slot, tier, count }));
  });

  const pickerDisciples = usableInner(state);

  const renderPicker = () => {
    if (!usage) return null;
    if (usage.kind === "wear") {
      return (
        <DisciplePicker
          title={`穿戴${GEAR_SLOT_DISPLAY_NAMES[usage.slot]}（档${usage.tier}）`}
          hint="同槽已穿装备将卸下回仓。"
          disciples={pickerDisciples}
          onPick={(discipleId) => {
            store.wear(discipleId, usage.slot, usage.tier);
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
            pill?.effect.zhenyuanBuff !== undefined ? "聚灵丹同弟子不叠加、只刷新时长。" : undefined
          }
          disciples={pickerDisciples}
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
        hint="功法限修 1 门、法术限修 2 门。"
        disciples={pickerDisciples}
        disabledReason={(disciple) => {
          if (getSpellById(usage.artId)) {
            const known = disciple.spellIds ?? [];
            if (known.includes(usage.artId)) return "已在修此法术";
            if (known.length >= 2) return "法术已满 2 门";
          } else if (disciple.techniqueId) {
            return "已有功法在修";
          }
          return "";
        }}
        onPick={(discipleId) => {
          store.study(discipleId, usage.artId);
          setUsage(null);
        }}
      />
    );
  };

  return (
    <View className="page">
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
          <View key={`${row.slot}-${row.tier}`} className="stock-row">
            <Text>
              {GEAR_SLOT_DISPLAY_NAMES[row.slot]} · 档{row.tier} ×{row.count}
            </Text>
            <Button
              className="btn-mini"
              disabled={ended}
              onClick={() => setUsage({ kind: "wear", slot: row.slot, tier: row.tier })}
            >
              穿戴
            </Button>
          </View>
        ))}
      </View>

      <View className="card">
        <View className="card-title">丹药</View>
        {warehouse.pills.length === 0 && <Text className="muted">仓库暂无丹药。</Text>}
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
          <Text className="muted">藏经阁暂无藏书。历练奇遇可入功法书/法术书。</Text>
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
      <Button className="btn-primary" onClick={() => navigateBack()}>
        返回
      </Button>
    </View>
  );
}
