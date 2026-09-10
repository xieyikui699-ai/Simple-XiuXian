// E06-F01 千局调平模拟（设计 §数值调平 D-024）。
// 确定性批量模拟：难度三档 × 若干 seed，一直玩到胜利（吞并）或失败（被吞并/凋敝）为止；
// 游戏本体没有时间上限、没有「超时」结局——模拟的月数上限只是「玩家退出」：到点未分胜负
// 即视为玩家自己结束本局，与引擎结局区分统计。锚点：
//   ① 吞并/被吞并各 ≤25%；② 两宗等级差多数时间 ≤1。
//   （2026-09-08 飞升结局移除：原锚点「标准难度中位首飞升 30–60 游戏年」废止，胜利收敛为吞并单一。）
// 只调常量表（引擎），不改公式与月结顺序；本脚本不进小程序包。
// 用法：
//   node scripts/balance-sim.mjs                                # 默认 400 局/档、上限 7200 月
//   node scripts/balance-sim.mjs --games-per-tier 50 --max-months 600 --only standard   # 快速调参
//   node scripts/balance-sim.mjs --json scripts/balance-report.json                     # 输出 JSON 报告
// 命名空间导入：车间开炉命令在「外门投入制」车间改造中更名/移除，缺失时跳过开炉步骤。
const engine = await import("../packages/engine/dist/index.js");
const {
  appointElder,
  assignWorkshopJob,
  canPlayerDeclareWar,
  sectLimitsFor,
  createGame,
  declareWar,
  learnArt,
  recruitDisciple,
  sectUpgradeFailureReason,
  setWorkshopStaff,
  settleMonthly,
  startWorkshopTask,
  upgradeRequirementFor,
  upgradeSect,
  usePill,
  wearGear,
} = engine;

const TIERS = [
  { name: "easy", multiplier: 0.8 },
  { name: "standard", multiplier: 1.0 },
  { name: "hard", multiplier: 1.2 },
];

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? Number(args[index + 1]) : fallback;
}
const hasFlag = (flag) => args.includes(flag);
const GAMES_PER_TIER = argValue("--games-per-tier", 400);
const MAX_MONTHS = argValue("--max-months", 7200); // 到点未分胜负 = 玩家退出（600 游戏年，实际玩家远早于此）
const ONLY = hasFlag("--only") ? args[args.indexOf("--only") + 1] : undefined;
const JSON_OUT = hasFlag("--json") ? args[args.indexOf("--json") + 1] : undefined;

// ─── 模拟玩家策略（确定性、合理趋优）────────────────────────────────────
const TECHNIQUE_PREFERENCE = [
  "tech-hunyuan",
  "tech-yangqi",
  "tech-fenxin",
  "tech-zixia",
  "tech-xuanbing",
];
const SPELL_PREFERENCE = [
  "spell-yanbao",
  "spell-jinfeng",
  "spell-hanbing",
  "spell-shehun",
  "spell-liedi",
  "spell-qingmu",
  "spell-sanmei",
  "spell-yehuo",
  "spell-xuanbingci",
  "spell-ningshuang",
];

function tryCommand(state, fn) {
  try {
    return fn(state).state;
  } catch {
    return state;
  }
}

function manageSect(stateInput) {
  let state = stateInput;
  // 1. 升阶（留 2000 灵石缓冲）。
  const reason = sectUpgradeFailureReason(state);
  if (!reason) {
    const cost = upgradeRequirementFor(state.sectRank)?.cost ?? 0;
    if (state.spiritStones >= cost + 2000) state = tryCommand(state, upgradeSect);
  }
  const innerLimit = state.sectRank === 1 ? 10 : state.sectRank === 2 ? 24 : 48;
  const inner = state.disciples;
  // 外门恒按宗门等级上限满员（100/300/500），无法手招。
  const outer = sectLimitsFor(state.sectRank).outerLimit;

  // 2-3. 招募直入内门（外门不再经手）：供奉已删除后无被动收入（模拟玩家尚未配挖矿，策略待重调），
  // 有 1200 灵石余量才扩编（俸禄 10/月/人）。
  const targetInner = Math.min(innerLimit, Math.max(3, Math.floor(outer / 5)));
  if (inner.length < targetInner && state.spiritStones >= 1200) {
    state = tryCommand(state, (s) => recruitDisciple(s, `cand-${s.currentTurn}-0`));
  }

  // 4-5. 长老与工匠岗位：只占用最弱的内门弟子，且至少留 2 人自由修炼。
  const busy = new Set([
    ...(state.elders ? Object.values(state.elders) : []),
    ...(state.jobs ? Object.values(state.jobs).flatMap((j) => j.workers) : []),
  ]);
  const occupiedCount = busy.size;
  const weakestIdle = () =>
    [...state.disciples]
      .filter((d) => d.age >= 16 && !busy.has(d.id))
      .sort(
        (a, b) =>
          a.realmLevel - b.realmLevel || a.zhenyuan - b.zhenyuan || a.id.localeCompare(b.id),
      )[0];
  const canTakeJob =
    occupiedCount + (state.elders ? Object.values(state.elders).filter(Boolean).length : 0) <
    inner.length - 2;
  const jobOpen = inner.length >= 6;
  if (state.elders?.resource === undefined && jobOpen) {
    const candidate = weakestIdle();
    if (candidate) {
      const before = busy.size;
      state = tryCommand(state, (s) => appointElder(s, candidate.id, "resource"));
      if (busy.size === before) busy.add(candidate.id);
    }
  }
  if (state.elders?.war === undefined && jobOpen) {
    const candidate = weakestIdle();
    if (candidate) {
      const before = busy.size;
      state = tryCommand(state, (s) => appointElder(s, candidate.id, "war"));
      if (busy.size === before) busy.add(candidate.id);
    }
  }
  for (const kind of ["pill", "gear"]) {
    if ((state.jobs?.[kind]?.workers.length ?? 0) < 1 && jobOpen) {
      const candidate = weakestIdle();
      if (candidate) {
        const before = busy.size;
        state = tryCommand(state, (s) => assignWorkshopJob(s, kind, candidate.id));
        if (busy.size === before) busy.add(candidate.id);
      }
    }
  }

  // 6. 车间（外门投入制）：挂任务免费——丹房单一炼制任务（不选丹方，统一点数、出炉随机两种丹各半）；
  //    器坊档 1 武器。滑杆投入：丹房 15 / 器坊 10（两房合计 ≤ 外门总数，不足按剩余分配）。
  //    月耗 丹房 195 + 器坊 100 = 295/月；连炉续炼，灵石不敷月耗自动停摆不致破产。
  const jobs = state.jobs;
  if (jobs) {
    if (!jobs.pill?.task && state.spiritStones >= 195 + 1000) {
      state = tryCommand(state, (s) => startWorkshopTask(s, "pill", { kind: "pill" }));
    }
    if (!jobs.gear?.task && state.spiritStones >= 100 + 2500) {
      state = tryCommand(state, (s) =>
        startWorkshopTask(s, "gear", { kind: "gear", slot: "weapon", tier: 1 }),
      );
    }
    const pillStaff = Math.max(0, Math.min(15, sectLimitsFor(state.sectRank).outerLimit));
    state = tryCommand(state, (s) => setWorkshopStaff(s, "pill", pillStaff));
    const gearStaff = Math.max(
      0,
      Math.min(10, sectLimitsFor(state.sectRank).outerLimit - pillStaff),
    );
    state = tryCommand(state, (s) => setWorkshopStaff(s, "gear", gearStaff));
  }

  // 7. 研读功法/法术（藏经阁拥有即学；功法书研读后消耗，逐人重读藏书避免重复投同一册）。
  for (const disciple of state.disciples) {
    const library = state.library ?? { techniqueIds: [], spellIds: [] };
    if (!disciple.techniqueId) {
      const artId =
        TECHNIQUE_PREFERENCE.find((id) => library.techniqueIds.includes(id)) ??
        library.techniqueIds[0];
      if (artId) state = tryCommand(state, (s) => learnArt(s, disciple.id, artId));
    }
    const known = disciple.spellIds ?? [];
    if (known.length < 2) {
      const spellId = SPELL_PREFERENCE.find(
        (id) => library.spellIds.includes(id) && !known.includes(id),
      );
      if (spellId) state = tryCommand(state, (s) => learnArt(s, disciple.id, spellId));
    }
  }

  // 8. 穿戴仓库装备（缺槽补最强档）。
  const warehouse = state.warehouse ?? { gear: [], pills: [] };
  for (const disciple of state.disciples) {
    for (const slot of ["weapon", "armor", "accessory", "artifact"]) {
      const worn = disciple.gear?.[slot];
      const best = warehouse.gear
        .filter((entry) => entry.slot === slot && entry.tier !== worn?.tier)
        .sort((a, b) => b.tier - a.tier)[0];
      if (best && (!worn || best.tier > worn.tier)) {
        state = tryCommand(state, (s) => wearGear(s, disciple.id, slot, best.tier));
      }
    }
  }

  // 9. 服用聚灵丹：给境界最高的内门（无生效 buff 时）。
  if ((warehouse.pills.find((entry) => entry.pillId === "pill-juling")?.count ?? 0) > 0) {
    const target = [...state.disciples]
      .filter((d) => (d.spiritFocusUntilTurn ?? 0) <= state.currentTurn)
      .sort((a, b) => b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan)[0];
    if (target) state = tryCommand(state, (s) => usePill(s, target.id, "pill-juling"));
  }

  // 10. 宣战：我方顶级弟子领先 2 级以上，或对方声望 ≤15（压制局），且声望健康。
  const rival = state.rival;
  if (rival && canPlayerDeclareWar(state)) {
    const myTop = Math.max(...state.disciples.map((d) => d.realmLevel));
    const rivalTop = Math.max(...rival.disciples.map((d) => d.realmLevel));
    if ((myTop - rivalTop >= 2 || rival.prestige <= 15) && state.prestige >= 55) {
      state = tryCommand(state, (s) => ({ state: declareWar(s) }));
    }
  }
  return state;
}

// ─── 单局模拟 ──────────────────────────────────────────────────────────
const TRACE = hasFlag("--trace") ? args[args.indexOf("--trace") + 1] : undefined;

function runGame(seed, difficultyMultiplier, maxMonths) {
  let state = createGame({ seed, sectName: "模拟宗门", rivalDifficulty: difficultyMultiplier });
  let diffOkMonths = 0;
  let rankDiffOkMonths = 0;
  let months = 0;
  for (; months < maxMonths; months++) {
    if (state.ending) break;
    state = manageSect(state);
    if (state.ending) break;
    const before = state.currentTurn;
    state = settleMonthly(state).state;
    if (state.currentTurn === before) break; // 终局后拒绝月结（保险）
    if (TRACE === seed && state.currentTurn % 24 === 0) {
      const top = [...state.disciples].sort((a, b) => b.realmLevel - a.realmLevel)[0];
      console.log(
        `m${String(state.currentTurn).padStart(3)} top ${top?.realmLevel} zy ${top?.zhenyuan} fail ${top?.breakthroughFailures} | rivTop ${Math.max(...state.rival.disciples.map((d) => d.realmLevel))} | stones ${state.spiritStones} morale ${state.morale} prest ${state.prestige} wars ${(state.sectWars ?? []).length} in/out ${state.disciples.length}/${sectLimitsFor(state.sectRank).outerLimit}`,
      );
    }
    const myTop = Math.max(...state.disciples.map((d) => d.realmLevel));
    const rivalTop = Math.max(...state.rival.disciples.map((d) => d.realmLevel));
    if (Math.abs(myTop - rivalTop) <= 1) diffOkMonths++;
    if (Math.abs(state.sectRank - state.rival.sectRank) <= 1) rankDiffOkMonths++;
  }
  const myTop = Math.max(...state.disciples.map((d) => d.realmLevel), 0);
  const rivalTop = Math.max(...state.rival.disciples.map((d) => d.realmLevel), 0);
  return {
    seed,
    // 玩家退出：到月数上限未分胜负（游戏本体无「超时」结局，见文件头注释）。
    ending: state.ending?.kind ?? "player_quit",
    endTurn: state.ending?.turn ?? maxMonths,
    topPlayer: myTop,
    topRival: rivalTop,
    diffOkShare: months > 0 ? diffOkMonths / months : 1,
    rankDiffOkShare: months > 0 ? rankDiffOkMonths / months : 1,
    wars: state.sectWars?.length ?? 0,
    warWins: (state.sectWars ?? []).filter((w) => w.winner === "player").length,
    deaths: state.fallen.length,
    breakthroughs: state.disciples.reduce((sum, d) => sum + (d.realmLevel - 1), 0),
    stones: state.spiritStones,
    disciples: state.disciples.length,
  };
}

// ─── 统计与锚点判定 ────────────────────────────────────────────────────
function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}
function median(values) {
  return percentile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
}
function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function summarize(games) {
  const count = (kind) => games.filter((g) => g.ending === kind).length;
  const verdict = {
    games: games.length,
    annexation: count("annexation"),
    annexed: count("annexed"),
    bankrupt: count("bankrupt"),
    playerQuit: count("player_quit"),
    annexationPct: (count("annexation") / games.length) * 100,
    annexedPct: (count("annexed") / games.length) * 100,
    bankruptPct: (count("bankrupt") / games.length) * 100,
    playerQuitPct: (count("player_quit") / games.length) * 100,
    diffOkMedianShare: median(games.map((g) => g.diffOkShare)),
    rankDiffOkMedianShare: median(games.map((g) => g.rankDiffOkShare)),
    meanWars: mean(games.map((g) => g.wars)),
    meanDeaths: mean(games.map((g) => g.deaths)),
  };
  // 锚点判定（标准难度为主，其余档位仅报告）。
  verdict.anchors = {
    annexationAtMost25Pct: verdict.annexationPct <= 25,
    annexedAtMost25Pct: verdict.annexedPct <= 25,
    levelDiffMostlyWithin1: verdict.diffOkMedianShare >= 0.5,
  };
  return verdict;
}

// ─── 主流程 ────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  gamesPerTier: GAMES_PER_TIER,
  maxMonths: MAX_MONTHS,
  tiers: {},
};
for (const tier of ONLY ? TIERS.filter((t) => t.name === ONLY) : TIERS) {
  const games = [];
  const startedAt = Date.now();
  for (let i = 0; i < GAMES_PER_TIER; i++) {
    games.push(runGame(`${tier.name}-${i + 1}`, tier.multiplier, MAX_MONTHS));
  }
  report.tiers[tier.name] = summarize(games);
  report.tiers[tier.name].elapsedMs = Date.now() - startedAt;
  const s = report.tiers[tier.name];
  console.log(
    `[${tier.name}] 局数 ${s.games} | 吞并 ${s.annexationPct.toFixed(1)}% 被吞并 ${s.annexedPct.toFixed(1)}% 凋敝 ${s.bankruptPct.toFixed(1)}% 玩家退出 ${s.playerQuit} | 等级差≤1 中位占比 ${(s.diffOkMedianShare ?? 0).toFixed(2)} | 会战均值 ${s.meanWars.toFixed(1)} | 用时 ${(s.elapsedMs / 1000).toFixed(0)}s`,
  );
  console.log(`  锚点: ${JSON.stringify(s.anchors)}`);
}
if (JSON_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`报告已写入 ${JSON_OUT}`);
}
