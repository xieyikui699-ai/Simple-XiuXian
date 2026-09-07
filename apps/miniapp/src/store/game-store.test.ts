// 存档 round-trip 单测（F01 通过标准）：写读 deepEqual、损坏容错、指针、体积上限、推进冒烟。
// E05-F03 补充：管理命令 action（岗位/开炉/研读/穿戴/服丹/长老/宣战）与会战三战报回放数据。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGame, settleMonthly } from "@simple-xiuxian/engine";
import { createGameStore } from "./game-store.js";
import {
  AUTO_SLOT,
  clearCurrentSlot,
  createMemoryBackend,
  deleteSave,
  readCurrentSlot,
  readSave,
  saveKey,
  writeCurrentSlot,
  writeSave,
} from "./save-adapter.js";

describe("存档适配层", () => {
  it("key 命名符合设计（simple-xiuxian-save-1..4）", () => {
    assert.equal(saveKey(1), "simple-xiuxian-save-1");
    assert.equal(saveKey(4), "simple-xiuxian-save-4");
  });

  it("GameState JSON round-trip：开局态写读 deepEqual", () => {
    const backend = createMemoryBackend();
    const state = createGame({ seed: "round-trip-1", sectName: "青云门" });
    writeSave(backend, 1, state, "normal", 1725600000000);
    const loaded = readSave(backend, 1);
    assert.ok(loaded);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.slot, 1);
    assert.equal(loaded.difficulty, "normal");
    assert.equal(loaded.savedAt, 1725600000000);
    assert.deepEqual(loaded.state, state);
  });

  it("推进 3 月后的状态 round-trip 依然 deepEqual", () => {
    const backend = createMemoryBackend();
    let state = createGame({ seed: "round-trip-2", sectName: "小竹峰" });
    for (let i = 0; i < 3; i++) {
      state = settleMonthly(state, "cultivate").state;
    }
    writeSave(backend, 2, state, "hard", 1);
    const loaded = readSave(backend, 2);
    assert.ok(loaded);
    assert.deepEqual(loaded.state, state);
  });

  it("缺失与损坏的存档读取返回 null", () => {
    const backend = createMemoryBackend();
    assert.equal(readSave(backend, 3), null);
    backend.setItem(saveKey(3), "{not-json");
    assert.equal(readSave(backend, 3), null);
    backend.setItem(saveKey(3), JSON.stringify({ version: 2, slot: 3 }));
    assert.equal(readSave(backend, 3), null);
  });

  it("当前局指针写读与清除", () => {
    const backend = createMemoryBackend();
    assert.equal(readCurrentSlot(backend), null);
    writeCurrentSlot(backend, AUTO_SLOT);
    assert.equal(readCurrentSlot(backend), 4);
    clearCurrentSlot(backend);
    assert.equal(readCurrentSlot(backend), null);
  });

  it("删除存档后读取为空", () => {
    const backend = createMemoryBackend();
    const state = createGame({ seed: "del", sectName: "合欢派" });
    writeSave(backend, 4, state, "easy", 1);
    assert.ok(readSave(backend, 4));
    deleteSave(backend, 4);
    assert.equal(readSave(backend, 4), null);
  });
});

describe("会话仓库冒烟", () => {
  it("创建游戏→推进 3 月→自动格与指针同步", () => {
    const backend = createMemoryBackend();
    const store = createGameStore(backend, () => 42);
    assert.equal(store.getState().state, null);
    assert.equal(
      store.newGame({ sectName: "测试宗门", seed: "seed-001", difficulty: "normal" }),
      true,
    );
    assert.equal(store.getState().state?.currentTurn, 1);
    for (let i = 0; i < 3; i++) store.settleMonth("cultivate");
    assert.equal(store.getState().state?.currentTurn, 4);
    const autoSave = readSave(backend, 4);
    assert.ok(autoSave);
    assert.equal(autoSave.state.currentTurn, 4);
    assert.equal(readCurrentSlot(backend), 4);
  });

  it("手动格保存与读档复制开局", () => {
    const backend = createMemoryBackend();
    const store = createGameStore(backend, () => 42);
    store.newGame({ sectName: "手动格宗门", seed: "seed-002", difficulty: "hard" });
    store.settleMonth("rest");
    store.saveToSlot(1);
    const manualTurn = store.getState().state?.currentTurn;
    store.settleMonth("rest");
    assert.equal(store.getState().state?.currentTurn, (manualTurn ?? 0) + 1);
    assert.equal(store.loadSlot(1), true);
    assert.equal(store.getState().state?.currentTurn, manualTurn);
  });

  it("非法宗门名被拒绝并给出可读错误", () => {
    const backend = createMemoryBackend();
    const store = createGameStore(backend, () => 42);
    assert.equal(store.newGame({ sectName: "门", seed: "seed-003", difficulty: "easy" }), false);
    assert.ok(store.getState().errorMessage);
  });

  it("提拔内门弟子走引擎命令并落存档", () => {
    const backend = createMemoryBackend();
    const store = createGameStore(backend, () => 42);
    store.newGame({ sectName: "提拔宗门", seed: "seed-004", difficulty: "normal" });
    const outer = store.getState().state?.disciples.find((d) => d.role === "outer");
    assert.ok(outer);
    store.promote(outer.id);
    const promoted = store.getState().state?.disciples.find((d) => d.id === outer.id);
    assert.equal(promoted?.role, "inner");
  });

  it("120 月推进后快照 JSON 体积 <100KB（设计 D-022 上限）", () => {
    const backend = createMemoryBackend();
    const store = createGameStore(backend, () => 42);
    store.newGame({ sectName: "体积宗门", seed: "size-001", difficulty: "normal" });
    for (let i = 0; i < 120; i++) store.settleMonth("explore");
    const state = store.getState().state;
    assert.ok(state);
    const bytes = JSON.stringify(state).length;
    assert.ok(bytes < 100 * 1024, `快照体积 ${bytes} 字节应 <102400 字节`);
  });
});

describe("管理命令 action（E05-F03 接线）", () => {
  it("岗位任命/卸任 + 丹房开炉扣灵石入在炉任务", () => {
    const backend = createMemoryBackend();
    const store = createGameStore(backend, () => 42);
    store.newGame({ sectName: "丹房宗门", seed: "mng-001", difficulty: "normal" });
    const inner = store.getState().state?.disciples.find((d) => d.role === "inner");
    assert.ok(inner);
    store.assignJob("pill", inner.id);
    assert.deepEqual(store.getState().state?.jobs?.pill.workers, [inner.id]);
    // 点数池为 0 → 开炉被拒并给出可读错误。
    store.craftPill("pill-juling");
    assert.ok(store.getState().errorMessage?.includes("点数不足"));
    store.clearError();
    store.removeJob("pill", inner.id);
    assert.deepEqual(store.getState().state?.jobs?.pill.workers, []);
  });

  it("宣战 → 来月会战 → 三份战报可回放（1v1v1 逐回合记录）", () => {
    const backend = createMemoryBackend();
    const store = createGameStore(backend, () => 42);
    store.newGame({ sectName: "会战宗门", seed: "war-001", difficulty: "normal" });
    store.wageWar();
    assert.equal(store.getState().state?.warWithRival, true);
    store.settleMonth("rest");
    const state = store.getState().state;
    assert.ok(state);
    assert.equal(state.warWithRival, false);
    assert.equal((state.sectWars ?? []).length, 1);
    const record = (state.sectWars ?? [])[0];
    assert.ok(record);
    assert.equal(record.pairOutcomes.length, 3);
    assert.ok(state.battles);
    assert.ok(state.battles.length >= 3, "会战三份战报入 state.battles");
    // 回放数据同源：战报含逐回合 action、终局生命与会战来源标记。
    for (const report of state.battles.slice(0, 3)) {
      assert.ok(report.actions.length > 0);
      assert.ok(report.finalHp.A >= 0 && report.finalHp.B >= 0);
      assert.equal(report.source, "sect-war");
      assert.equal(report.turn, state.currentTurn);
    }
  });

  it("研读/穿戴/服丹/长老命令走引擎并自动落自动格", () => {
    const backend = createMemoryBackend();
    // 藏经阁为空 → 研读被拒；仓库无丹药 → 服丹被拒（错误文案可读）。
    const probe = createGameStore(backend, () => 42);
    probe.newGame({ sectName: "命令宗门", seed: "mng-002", difficulty: "normal" });
    const probeDisciple = probe.getState().state?.disciples.find((d) => d.role === "inner");
    assert.ok(probeDisciple);
    probe.study(probeDisciple.id, "tech-hunyuan");
    assert.ok(probe.getState().errorMessage?.includes("藏经阁"));
    probe.clearError();
    probe.takePill(probeDisciple.id, "pill-yanshou");
    assert.ok(probe.getState().errorMessage?.includes("仓库"));
    probe.clearError();
    // 铺底：手动格注入藏经阁功法书与一颗聚灵丹，读档后走命令。
    const seeded = createGame({ seed: "mng-002", sectName: "命令宗门" });
    const seededWarehouse = seeded.warehouse ?? { gear: [], pills: [] };
    const seededLibrary = seeded.library ?? { techniqueIds: [], spellIds: [] };
    seededWarehouse.pills.push({ pillId: "pill-juling", count: 1 });
    seededLibrary.techniqueIds.push("tech-hunyuan");
    writeSave(backend, 1, seeded, "normal", 1);
    const store = createGameStore(backend, () => 42);
    assert.equal(store.loadSlot(1), true);
    const loaded = store.getState().state;
    assert.ok(loaded);
    const target = loaded.disciples.find((d) => d.role === "inner");
    assert.ok(target);
    store.study(target.id, "tech-hunyuan");
    assert.equal(
      store.getState().state?.disciples.find((d) => d.id === target.id)?.techniqueId,
      "tech-hunyuan",
    );
    store.takePill(target.id, "pill-juling");
    assert.ok(
      (store.getState().state?.disciples.find((d) => d.id === target.id)?.spiritFocusUntilTurn ??
        0) > 0,
    );
    store.appointElder(target.id, "resource");
    assert.equal(store.getState().state?.elders?.resource, target.id);
    // 命令后自动落自动格（读回一致）。
    const autoSave = readSave(backend, AUTO_SLOT);
    assert.ok(autoSave);
    assert.equal(autoSave.state.elders?.resource, target.id);
  });
});
