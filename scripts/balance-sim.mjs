// E06-F01 千局调平模拟（设计 §数值调平 D-024）。
// 确定性批量模拟：难度三档 × 若干 seed，跑至结局或月数上限；统计对照锚点：
//   ① 标准难度中位首飞升 30–60 游戏年；② 吞并/被吞并各 ≤25%；③ 两宗等级差多数时间 ≤1。
// 只调常量表（引擎），不改公式与月结顺序；本脚本不进小程序包。
// 用法：
//   node scripts/balance-sim.mjs                                # 默认 400 局/档、上限 7200 月
//   node scripts/balance-sim.mjs --games-per-tier 50 --max-months 600 --only standard   # 快速调参
//   node scripts/balance-sim.mjs --json scripts/balance-report.json                     # 输出 JSON 报告
import {
  appointElder,
  assignWorkshopJob,
  canPlayerDeclareWar,
  createGame,
  declareWar,
  learnArt,
  promoteToInner,
  recruitDisciple,
  sectUpgradeFailureReason,
  settleMonthly,
  startGearCraft,
  startPillCraft,
  upgradeSect,
  usePill,
  wearGear,
} from "../packages/engine/dist/index.js";

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
const MAX_MONTHS = argValue("--max-months", 7200); // epic 上限 600 游戏年
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
    const requirement = state.sectRank === 1 ? 5000 : 30000;
    if (state.spiritStones >= requirement + 2000) state = tryCommand(state, upgradeSect);
  }
  const limits = state.sectRank === 1 ? 100 : state.sectRank === 2 ? 300 : 500;
  const innerLimit = state.sectRank === 1 ? 10 : state.sectRank === 2 ? 24 : 48;
  const inner = state.disciples.filter((d) => d.role === "inner");
  const outer = state.disciples.filter((d) => d.role === "outer");

  // 2. 招募外门（留 500 缓冲；外门供奉是收入根基）。
  if (outer.length < limits && state.spiritStones >= 300 + 500) {
    state = tryCommand(state, (s) => recruitDisciple(s, `cand-${s.currentTurn}-0`));
  }

  // 3. 提拔最强外门补内门空位：严格经济配比（供奉 = 俸禄平衡）+ 有余量才扩编。
  const targetInner = Math.min(innerLimit, Math.max(3, Math.floor(outer.length / 5)));
  if (inner.length < targetInner && outer.length > 3 && state.spiritStones >= 1200) {
    const strongest = [...state.disciples]
      .filter((d) => d.role === "outer")
      .sort(
        (a, b) =>
          b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan || a.id.localeCompare(b.id),
      )[0];
    if (strongest) state = tryCommand(state, (s) => promoteToInner(s, strongest.id));
  }

  // 4-5. 长老与工匠岗位：只占用最弱的内门弟子，且至少留 2 人自由修炼。
  const busy = new Set([
    ...(state.elders ? Object.values(state.elders) : []),
    ...(state.jobs ? Object.values(state.jobs).flatMap((j) => j.workers) : []),
  ]);
  const occupiedCount = busy.size;
  const weakestIdle = () =>
    [...state.disciples]
      .filter((d) => d.role === "inner" && d.age >= 16 && !busy.has(d.id))
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

  // 6. 开炉：优先聚灵丹（修炼加速），再延寿丹，再档 1 武器。
  const jobs = state.jobs;
  if (jobs) {
    const pillBusy = (jobs.pill?.tasks ?? []).length > 0;
    const gearBusy = (jobs.gear?.tasks ?? []).length > 0;
    if (!pillBusy && state.spiritStones >= 300 + 1000) {
      state = tryCommand(state, (s) => startPillCraft(s, "pill-juling"));
    } else if (!pillBusy && state.spiritStones >= 500 + 1500) {
      state = tryCommand(state, (s) => startPillCraft(s, "pill-yanshou"));
    }
    if (!gearBusy && state.spiritStones >= 200 + 2500) {
      state = tryCommand(state, (s) => startGearCraft(s, "weapon", 1));
    }
  }

  // 7. 研读功法/法术（藏经阁拥有即学）。
  const library = state.library ?? { techniqueIds: [], spellIds: [] };
  for (const disciple of state.disciples) {
    if (disciple.role !== "inner") continue;
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
    if (disciple.role !== "inner") continue;
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
      .filter((d) => d.role === "inner" && (d.spiritFocusUntilTurn ?? 0) <= state.currentTurn)
      .sort((a, b) => b.realmLevel - a.realmLevel || b.zhenyuan - a.zhenyuan)[0];
    if (target) state = tryCommand(state, (s) => usePill(s, target.id, "pill-juling"));
  }

  // 10. 宣战：我方顶级弟子领先 2 级以上，或对方声望 ≤15（压制局），且声望健康。
  const rival = state.rival;
  if (rival && canPlayerDeclareWar(state)) {
    const myTop = Math.max(
      ...state.disciples.filter((d) => d.role === "inner").map((d) => d.realmLevel),
    );
    const rivalTop = Math.max(
      ...rival.disciples.filter((d) => d.role === "inner").map((d) => d.realmLevel),
    );
    if ((myTop - rivalTop >= 2 || rival.prestige <= 15) && state.prestige >= 40) {
      state = tryCommand(state, (s) => ({ state: declareWar(s) }));
    }
  }
  return state;
}

function choosePolicy(state) {
  const innerSalary = state.disciples.filter((d) => d.role === "inner").length * 10;
  const offering = state.disciples.filter((d) => d.role === "outer").length * 2;
  const canSurvive = state.spiritStones + offering - innerSalary >= 200;
  // 士气低落但经济尚可 → 休养；经济吃紧 → 历练谋生（赤字月休养会陷入危机死锁）。
  if (state.morale <= 35 && canSurvive) return "rest";
  if (state.spiritStones < 2500 || !canSurvive) return "explore";
  return "cultivate";
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
    state = settleMonthly(state, choosePolicy(state)).state;
    if (state.currentTurn === before) break; // 终局后拒绝月结（保险）
    if (TRACE === seed && state.currentTurn % 24 === 0) {
      const top = [...state.disciples]
        .filter((d) => d.role === "inner")
        .sort((a, b) => b.realmLevel - a.realmLevel)[0];
      console.log(
        `m${String(state.currentTurn).padStart(3)} top ${top?.realmLevel} zy ${top?.zhenyuan} fail ${top?.breakthroughFailures} | rivTop ${Math.max(...state.rival.disciples.filter((d) => d.role === "inner").map((d) => d.realmLevel))} | stones ${state.spiritStones} morale ${state.morale} prest ${state.prestige} wars ${(state.sectWars ?? []).length} in/out ${state.disciples.filter((d) => d.role === "inner").length}/${state.disciples.filter((d) => d.role === "outer").length}`,
      );
    }
    const myTop = Math.max(
      ...state.disciples.filter((d) => d.role === "inner").map((d) => d.realmLevel),
    );
    const rivalTop = Math.max(
      ...state.rival.disciples.filter((d) => d.role === "inner").map((d) => d.realmLevel),
    );
    if (Math.abs(myTop - rivalTop) <= 1) diffOkMonths++;
    if (Math.abs(state.sectRank - state.rival.sectRank) <= 1) rankDiffOkMonths++;
  }
  const myTop = Math.max(
    ...state.disciples.filter((d) => d.role === "inner").map((d) => d.realmLevel),
    0,
  );
  const rivalTop = Math.max(
    ...state.rival.disciples.filter((d) => d.role === "inner").map((d) => d.realmLevel),
    0,
  );
  return {
    seed,
    ending: state.ending?.kind ?? "timeout",
    endTurn: state.ending?.turn ?? maxMonths,
    ascensionYears: state.ending?.kind === "ascension" ? state.ending.turn / 12 : undefined,
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
  const ascensionYears = games
    .filter((g) => g.ending === "ascension")
    .map((g) => g.ascensionYears)
    .sort((a, b) => a - b);
  const count = (kind) => games.filter((g) => g.ending === kind).length;
  const verdict = {
    games: games.length,
    ascension: count("ascension"),
    annexation: count("annexation"),
    annexed: count("annexed"),
    bankrupt: count("bankrupt"),
    timeout: count("timeout"),
    ascensionYears: {
      p25: percentile(ascensionYears, 0.25),
      median: percentile(ascensionYears, 0.5),
      p75: percentile(ascensionYears, 0.75),
      mean: mean(ascensionYears),
    },
    annexationPct: (count("annexation") / games.length) * 100,
    annexedPct: (count("annexed") / games.length) * 100,
    bankruptPct: (count("bankrupt") / games.length) * 100,
    diffOkMedianShare: median(games.map((g) => g.diffOkShare)),
    rankDiffOkMedianShare: median(games.map((g) => g.rankDiffOkShare)),
    meanWars: mean(games.map((g) => g.wars)),
    meanDeaths: mean(games.map((g) => g.deaths)),
  };
  // 锚点判定（标准难度为主，其余档位仅报告）。
  verdict.anchors = {
    medianAscensionWithin30to60:
      verdict.ascensionYears.median !== undefined &&
      verdict.ascensionYears.median >= 30 &&
      verdict.ascensionYears.median <= 60,
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
    `[${tier.name}] 局数 ${s.games} | 飞升 ${s.ascension}（中位 ${s.ascensionYears.median ?? "—"} 年, P25 ${s.ascensionYears.p25 ?? "—"} / P75 ${s.ascensionYears.p75 ?? "—"}）| 吞并 ${s.annexationPct.toFixed(1)}% 被吞并 ${s.annexedPct.toFixed(1)}% 凋敝 ${s.bankruptPct.toFixed(1)}% 超时 ${s.timeout} | 等级差≤1 中位占比 ${(s.diffOkMedianShare ?? 0).toFixed(2)} | 会战均值 ${s.meanWars.toFixed(1)} | 用时 ${(s.elapsedMs / 1000).toFixed(0)}s`,
  );
  console.log(`  锚点: ${JSON.stringify(s.anchors)}`);
}
if (JSON_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`报告已写入 ${JSON_OUT}`);
}
