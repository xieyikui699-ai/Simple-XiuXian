// 自动存档适配层单测：round-trip 还原与损坏/异格式拒绝。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGame, settleMonthly } from "@simple-xiuxian/engine";
import { type AutoSaveData, autoSaveMeta, parseAutoSave, serializeAutoSave } from "./auto-save.js";

function makeSave(): AutoSaveData {
  let state = createGame({ seed: "save-001", sectName: "青云门", rivalDifficulty: 1 });
  state = settleMonthly(state).state;
  return { version: 1, savedAt: 1_700_000_000_000, difficulty: "normal", state };
}

describe("自动存档 round-trip", () => {
  it("序列化→解析还原同一状态与元数据", () => {
    const data = makeSave();
    const parsed = parseAutoSave(serializeAutoSave(data));
    assert.ok(parsed);
    assert.deepEqual(parsed.state, data.state);
    assert.equal(parsed.savedAt, data.savedAt);
    assert.equal(parsed.difficulty, data.difficulty);
    assert.equal(parsed.version, 1);
  });

  it("元信息取自状态（宗门名/回合/难度）", () => {
    const data = makeSave();
    const meta = autoSaveMeta(data);
    assert.equal(meta.sectName, "青云门");
    assert.equal(meta.turn, data.state.currentTurn);
    assert.equal(meta.savedAt, data.savedAt);
    assert.equal(meta.difficulty, "normal");
  });

  it("空串/非 JSON/异版本/非法难度/字段缺失一律按无档处理", () => {
    assert.equal(parseAutoSave(null), null);
    assert.equal(parseAutoSave(""), null);
    assert.equal(parseAutoSave("not-json"), null);

    const base = JSON.parse(serializeAutoSave(makeSave())) as Record<string, unknown>;
    assert.equal(parseAutoSave(JSON.stringify({ ...base, version: 2 })), null);
    assert.equal(parseAutoSave(JSON.stringify({ ...base, savedAt: "yesterday" })), null);
    assert.equal(parseAutoSave(JSON.stringify({ ...base, difficulty: "impossible" })), null);
    assert.equal(parseAutoSave(JSON.stringify({ ...base, state: "oops" })), null);
    const brokenState = { ...(base.state as Record<string, unknown>), currentTurn: "x" };
    assert.equal(parseAutoSave(JSON.stringify({ ...base, state: brokenState })), null);
  });
});
