import {
  CRAFT_JOB_KINDS,
  GEAR_COST_PER_OUTER_MONTH,
  GEAR_SLOT_DISPLAY_NAMES,
  GEAR_SLOT_KEYS,
  GEAR_TIERS,
  PILL_COST_PER_OUTER_MONTH,
  WORKSHOP_MASTER_LIMIT,
  effectiveOuterJobsOf,
  estimateCraftMonths,
  jobsOf,
  maxForgeTierForRank,
  sectLimitsFor,
  workshopPauseReason,
  workshopSpeedMultiplier,
  workshopTaskTotalPoints,
} from "@simple-xiuxian/engine";
import type {
  CraftJobKind,
  Disciple,
  GameState,
  GearSlot,
  GearTier,
  WorkshopTask,
} from "@simple-xiuxian/engine";
import { Button, Slider, Text, View } from "@tarojs/components";
import { reLaunch, useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getGameStore, useGame } from "../../store/use-game";
import { formatNumber, formatTurn } from "../../ui/display";
import { BackBar } from "../../ui/nav";
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

function masterCandidates(state: GameState): Disciple[] {
  const busy = new Set(CRAFT_JOB_KINDS.flatMap((entry) => jobsOf(state)[entry].workers));
  return state.disciples.filter((disciple) => disciple.age >= 16 && !busy.has(disciple.id));
}

function taskProgressPct(task: WorkshopTask): number {
  const total = workshopTaskTotalPoints(task);
  if (total <= 0) return 0;
  return Math.min(100, Math.round((task.accumulatedPoints / total) * 100));
}

export default function AlchemyPage() {
  const store = getGameStore();
  const { state, errorMessage } = useGame();
  const [assigning, setAssigning] = useState<CraftJobKind | null>(null);
  const [forgeSlot, setForgeSlot] = useState<GearSlot>("talisman");
  const [forgeTier, setForgeTier] = useState<GearTier>(1);

  useDidShow(() => {
    if (!state) reLaunch({ url: "/pages/index/index" });
  });

  if (!state) return null;
  const ended = state.ending !== undefined;
  const allJobs = jobsOf(state);

  const renderWorkshop = (kind: CraftJobKind) => {
    const workshop = allJobs[kind];
    const masterId = workshop.workers[0];
    const master = masterId
      ? state.disciples.find((disciple) => disciple.id === masterId)
      : undefined;
    const speed = workshopSpeedMultiplier(state, kind);
    const otherAssigned = kind === "pill" ? allJobs.gear.assignedOuter : allJobs.pill.assignedOuter;
    // 挖矿/练气在编同样占用外门人数（外门分工合计 ≤ 外门总数，恒按宗门等级上限满员）。
    const outerJobs = effectiveOuterJobsOf(state);
    const staffCap = Math.max(
      0,
      sectLimitsFor(state.sectRank).outerLimit - otherAssigned - outerJobs.mining - outerJobs.qi,
    );
    const pause = workshopPauseReason(state, kind);
    const months = estimateCraftMonths(state, kind);
    const task = workshop.task;
    const staff = workshop.assignedOuter;
    const monthlyCost =
      staff * (kind === "pill" ? PILL_COST_PER_OUTER_MONTH : GEAR_COST_PER_OUTER_MONTH);
    const selectedSlot = task?.kind === "gear" ? task.slot : forgeSlot;
    const selectedTier = task?.kind === "gear" ? task.tier : forgeTier;

    return (
      <View key={kind} className="card">
        <View className="card-title-row">
          <View className="card-title">
            {WORKSHOP_TITLES[kind]}（主持 {workshop.workers.length}/{WORKSHOP_MASTER_LIMIT}）
          </View>
          {assigning !== kind && master && (
            <Button
              className="btn-mini"
              disabled={ended}
              onClick={() => store.removeJob(kind, master.id)}
            >
              卸任
            </Button>
          )}
          {assigning !== kind && !master && workshop.workers.length < WORKSHOP_MASTER_LIMIT && (
            <Button className="btn-mini" disabled={ended} onClick={() => setAssigning(kind)}>
              任命{WORKSHOP_ROLE_NAMES[kind]}
            </Button>
          )}
        </View>
        {master && (
          <Text className="muted">
            {WORKSHOP_ROLE_NAMES[kind]} {master.name} · 加成 +{Math.round((speed - 1) * 100)}%
          </Text>
        )}
        {assigning === kind && (
          <DisciplePicker
            title={`任命${WORKSHOP_ROLE_NAMES[kind]}（无职成年弟子，任内不战斗不修炼）`}
            hint="已被他房或长老占用的弟子不可再任。"
            disciples={masterCandidates(state)}
            onPick={(discipleId) => {
              store.assignJob(kind, discipleId);
              setAssigning(null);
            }}
          />
        )}

        {task && (
          <View className="furnace-box">
            <View className="craft-progress-track">
              <View
                className="craft-progress-fill"
                style={{ width: `${taskProgressPct(task)}%` }}
              />
            </View>
            <Text className="muted">
              进度 {Math.floor(task.accumulatedPoints)}/{workshopTaskTotalPoints(task)} 点
              {pause === "no_funds" && " · 停摆：灵石不敷月耗"}
              {!pause && months !== undefined && ` · 预计 ${months} 月后出炉（连炉续炼）`}
            </Text>
          </View>
        )}

        <View className="staff-box">
          <View className="staff-row">
            <Text className="picker-title">投入外门弟子</Text>
            <Text className="muted">{monthlyCost}灵石/月</Text>
            <Text className="staff-count">已投入 {staff} 人</Text>
          </View>
          <Slider
            className="staff-slider"
            min={0}
            max={staffCap}
            step={1}
            value={Math.min(workshop.assignedOuter, staffCap)}
            disabled={ended}
            activeColor="#8c5a2b"
            blockColor="#8c5a2b"
            onChange={(event) => store.setStaff(kind, event.detail.value)}
          />
        </View>

        {kind === "pill" && (
          <View className="craft-panel">
            <Text className="muted">延寿丹（寿命 +10 年）</Text>
            <Text className="muted">聚灵丹（12 月真元 ×1.5）</Text>
          </View>
        )}

        {kind === "gear" && (
          <View className="craft-panel">
            <View className="forge-options">
              {GEAR_SLOT_KEYS.map((slot) => (
                <Text
                  key={slot}
                  className={`forge-chip${selectedSlot === slot ? " forge-chip-active" : ""}`}
                  onClick={() => {
                    setForgeSlot(slot);
                    if (!ended) store.setGearTask(slot, selectedTier);
                  }}
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
                    className={`forge-chip${selectedTier === tier ? " forge-chip-active" : ""}`}
                    onClick={() => {
                      setForgeTier(tier);
                      if (!ended) store.setGearTask(selectedSlot, tier);
                    }}
                  >
                    档{tier}
                  </Text>
                ),
              )}
            </View>
            <Text className="muted">
              本宗可炼至档{maxForgeTierForRank(state.sectRank)}
              ；投入外门弟子即自动开工，点选图纸换目标（进度作废）。
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View className="page">
      <BackBar title="丹房 · 器坊" />
      <View className="page-body">
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
      </View>
    </View>
  );
}
