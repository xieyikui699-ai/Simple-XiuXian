import assert from "node:assert/strict";
// sha256 对拍测试：纯 JS 实现必须与 node:crypto 逐字节一致（小程序环境的正确性前提）。
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { Digest, deterministicRoll, sha256 } from "./hash.js";

function nodeDigestHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function engineDigestHex(input: string): string {
  return [...sha256(input).bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("sha256 纯 JS 实现", () => {
  it("标准测试向量", () => {
    assert.equal(
      engineDigestHex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(
      engineDigestHex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("与 node:crypto 对拍（含中文与长输入）", () => {
    const inputs = [
      "seed:disciple-name:1:0",
      "九州问道:弟子:林·修远:17",
      "x".repeat(55),
      "y".repeat(56),
      "z".repeat(64),
      "掌门，不好了！".repeat(100),
    ];
    for (const input of inputs) {
      assert.equal(
        engineDigestHex(input),
        nodeDigestHex(input),
        `mismatch for ${input.slice(0, 32)}`,
      );
    }
  });

  it("Digest 定宽大端读取与 Buffer 一致", () => {
    for (let i = 0; i < 50; i++) {
      const input = `digest-read:${i}`;
      const buffer = createHash("sha256").update(input).digest();
      const digest = sha256(input);
      assert.equal(digest.readUInt8(0), buffer.readUInt8(0));
      assert.equal(digest.readUInt16BE(1), buffer.readUInt16BE(1));
      assert.equal(digest.readUInt32BE(0), buffer.readUInt32BE(0));
      assert.equal(digest.readUInt32BE(4), buffer.readUInt32BE(4));
    }
  });

  it("确定性掷骰同输入恒定且在 [0, 100)", () => {
    const first = deterministicRoll("roll-seed:1");
    assert.equal(deterministicRoll("roll-seed:1"), first);
    for (let i = 0; i < 200; i++) {
      const value = deterministicRoll(`roll-seed:${i}`);
      assert.ok(value >= 0 && value < 100);
    }
  });

  it("Digest 类独立可用", () => {
    const digest = new Digest(sha256("abc").bytes);
    assert.equal(digest.readUInt8(0), 0xba);
  });
});
