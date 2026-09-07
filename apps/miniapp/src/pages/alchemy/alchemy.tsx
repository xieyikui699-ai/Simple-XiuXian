import {
  CRAFT_JOB_KINDS,
  GEAR_CRAFT_COST,
  GEAR_CRAFT_POINTS,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  GEAR_TIERS,
  PILLS,
  WORKSHOP_JOB_LIMIT,
  WORKSHOP_POINTS_PER_JOB,
  maxForgeTierForRank,
  workerMonthlyPoints,
} from "@simple-xiuxian/engine";
import type { CraftJobKind, Disciple, GameState, GearSlot, GearTier } from "@simple-xiuxian/engine";
import { Button, Text, View } from "@tarojs/components";
import { navigateBack, reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { formatNumber, formatTurn } from "../../ui/display";
import { DisciplePicker } from "../../ui/picker";
import "./alchemy.css";

const WORKSHOP_TITLES: Record<CraftJobKind, string> = {
  pill: "丹房",
  gear: "器坊",
};

const WORKSHOP_ROLE_NAMES: Record<CraftJobKind, string> = {
  pill: "丹师",
  gear: "工匠",
};

function usableDisciples(state: GameState): Disciple[] {
  return state.disciples.filter((disciple) => disciple.role === "inner" && disciple.age >= 16);
}

function pillRowClass(affordable: boolean): string {
  return `craft-row${affordable ? "" : " craft-row-disabled"}`;
}

export default function AlchemyPage() {
  const store = getGameStore();
  const { state, errorMessage } = useGame();
  const [assigning, setAssigning] = useState<CraftJobKind | null>(null);
  const [forgeSlot, setForgeSlot] = useState<GearSlot>("weapon");
  const [forgeTier, setForgeTier] = useState<GearTier>(1);

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;
  const ended = state.ending !== undefined;

  const renderWorkshop = (kind: CraftJobKind) => {
    const workshop = state.jobs?.[kind];
    const workers = (workshop?.workers ?? [])
      .map((workerId) => state.disciples.find((disciple) => disciple.id === workerId))
      .filter((disciple): disciple is Disciple => disciple !== undefined);
    const candidates = usableDisciples(state).filter(
      (disciple) => !workers.some((worker) => worker.id === disciple.id),
    );
    const busy = (workshop?.tasks.length ?? 0) > 0;
    return (
      <View key={kind} className="card">
        <View className="card-title">
          {WORKSHOP_TITLES[kind]}（岗位 {workers.length}/{WORKSHOP_JOB_LIMIT}）
        </View>
        <Text className="muted">
          点数池 {formatNumber(workshop?.points ?? 0)} · 每岗每月 +{WORKSHOP_POINTS_PER_JOB} 点
          （丹道/器道天赋再 +20%）
        </Text>
        {workers.length === 0 && (
          <Text className="muted">尚无{WORKSHOP_ROLE_NAMES[kind]}，无岗位则点数不增长。</Text>
        )}
        {workers.map((worker) => (
          <View key={worker.id} className="workshop-row">
            <Text>
              {WORKSHOP_ROLE_NAMES[kind]} {worker.name} · 每月 +
              {workerMonthlyPoints(kind, worker.talentIds)} 点
            </Text>
            <Button
              className="btn-mini"
              disabled={ended}
              onClick={() => store.removeJob(kind, worker.id)}
            >
              卸任
            </Button>
          </View>
        ))}
        {kind === "pill" && (
          <View className="furnace-box">
            <Text className="picker-title">在炉丹药</Text>
            {(workshop?.tasks.length ?? 0) === 0 && (
              <Text className="muted">炉火未起。开炉后按月自动出炉入仓库。</Text>
            )}
            {(workshop?.tasks ?? []).map((task, index) => {
              const pill = PILLS.find((entry) => entry.id === task.pillId);
              return (
                <Text key={`${task.pillId}-${index}`} className="furnace-task">
                  {pill?.name ?? task.pillId} · 出炉剩余 {task.monthsLeft} 月
                </Text>
              );
            })}
          </View>
        )}

        {kind === "pill" && (
          <View className="craft-panel">
            {PILLS.map((pill) => {
              const affordable =
                !ended &&
                !busy &&
                state.spiritStones >= pill.craftCost &&
                (workshop?.points ?? 0) >= pill.craftPoints;
              return (
                <View key={pill.id} className={pillRowClass(affordable)}>
                  <Text>
                    {pill.name}（{pill.craftPoints} 点 / {formatNumber(pill.craftCost)} 灵石 /{" "}
                    {pill.craftMonths} 月）
                  </Text>
                  <Text className="muted">
                    {pill.effect.lifespanFlat !== undefined
                      ? `服用者最大寿命 +${pill.effect.lifespanFlat} 年`
                      : `服用者 ${pill.effect.zhenyuanBuff?.months} 月内真元 ×${pill.effect.zhenyuanBuff?.multiplier}（不叠加刷新）`}
                  </Text>
                  <Button
                    className="btn-mini"
                    disabled={!affordable}
                    onClick={() => store.craftPill(pill.id)}
                  >
                    开炉
                  </Button>
                </View>
              );
            })}
          </View>
        )}

        {kind === "gear" && (
          <View className="craft-panel">
            <Text className="picker-title">
              炼制装备（本宗可炼至档{maxForgeTierForRank(state.sectRank)}）
            </Text>
            <View className="forge-options">
              {GEAR_SLOT_KEYS.map((slot) => (
                <Text
                  key={slot}
                  className={`forge-chip${forgeSlot === slot ? " forge-chip-active" : ""}`}
                  onClick={() => setForgeSlot(slot)}
                >
                  {GEAR_SLOT_DISPLAY_NAMES[slot]}
                </Text>
              ))}
            </View>
            <View className="forge-options">
              {GEAR_TIERS.filter((tier) => tier <= maxForgeTierForRank(state.sectRank)).map(
                (tier) => (
                  <Text
                    key={tier}
                    className={`forge-chip${forgeTier === tier ? " forge-chip-active" : ""}`}
                    onClick={() => setForgeTier(tier)}
                  >
                    档{tier}
                  </Text>
                ),
              )}
            </View>
            <Text className="muted">
              需 {GEAR_CRAFT_POINTS[forgeTier]} 点 / {formatNumber(GEAR_CRAFT_COST[forgeTier])}{" "}
              灵石，开炉即出炉入仓库。
            </Text>
            <Button
              className="btn-mini"
              disabled={
                ended ||
                state.spiritStones < GEAR_CRAFT_COST[forgeTier] ||
                (workshop?.points ?? 0) < GEAR_CRAFT_POINTS[forgeTier]
              }
              onClick={() => store.craftGear(forgeSlot, forgeTier)}
            >
              炼制{GEAR_SLOT_DISPLAY_NAMES[forgeSlot]}（档{forgeTier}）
            </Button>
          </View>
        )}

        {assigning === kind && (
          <DisciplePicker
            title={`任命${WORKSHOP_ROLE_NAMES[kind]}（成年内门，任内不战斗不修炼）`}
            hint="已被他岗或长老占用的弟子不可再任。"
            disciples={candidates}
            onPick={(discipleId) => {
              store.assignJob(kind, discipleId);
              setAssigning(null);
            }}
          />
        )}
        {assigning !== kind && (
          <Button
            className="btn-mini"
            disabled={ended || workers.length >= WORKSHOP_JOB_LIMIT}
            onClick={() => setAssigning(kind)}
          >
            任命{WORKSHOP_ROLE_NAMES[kind]}
          </Button>
        )}
      </View>
    );
  };

  return (
    <View className="page">
      <View className="card">
        <View className="card-title">丹房 · 器坊</View>
        <Text className="muted">
          当前灵石：{formatNumber(state.spiritStones)} · {formatTurn(state.currentTurn)}
        </Text>
        {errorMessage !== null && (
          <Text className="error-line" onClick={() => store.clearError()}>
            {errorMessage}（点击关闭）
          </Text>
        )}
      </View>
      {CRAFT_JOB_KINDS.map(renderWorkshop)}
      <Button className="btn-primary" onClick={() => navigateBack()}>
        返回
      </Button>
    </View>
  );
}
