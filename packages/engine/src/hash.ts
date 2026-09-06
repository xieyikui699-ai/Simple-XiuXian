// 确定性种子哈希：纯 JS sha256（小程序环境无 node:crypto）。
// 输出与 node:crypto sha256 逐字节一致，对拍测试见 hash.test.ts。

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const w = new Uint32Array(64);
const wView = new DataView(w.buffer);
const h = new Uint32Array(8);
const hView = new DataView(h.buffer);
const encoder = new TextEncoder();

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(message: Uint8Array): Uint8Array {
  const length = message.length;
  const bitLength = length * 8;
  const padded = new Uint8Array((((length + 8) >> 6) << 6) + 64);
  padded.set(message);
  padded[length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(padded.length - 4, bitLength >>> 0);
  for (let i = 0; i < 8; i++) hView.setUint32(i * 4, H0[i] ?? 0);

  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) wView.setUint32(i * 4, paddedView.getUint32(block + i * 4));
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr(wView.getUint32((i - 15) * 4), 7) ^
        rotr(wView.getUint32((i - 15) * 4), 18) ^
        (wView.getUint32((i - 15) * 4) >>> 3);
      const s1 =
        rotr(wView.getUint32((i - 2) * 4), 17) ^
        rotr(wView.getUint32((i - 2) * 4), 19) ^
        (wView.getUint32((i - 2) * 4) >>> 10);
      const sum = (wView.getUint32((i - 7) * 4) + s0 + wView.getUint32((i - 16) * 4) + s1) | 0;
      wView.setUint32(i * 4, sum);
    }

    let a = hView.getUint32(0);
    let b = hView.getUint32(4);
    let c = hView.getUint32(8);
    let d = hView.getUint32(12);
    let e = hView.getUint32(16);
    let f = hView.getUint32(20);
    let g = hView.getUint32(24);
    let hh = hView.getUint32(28);

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] ?? 0) + wView.getUint32(i * 4)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    hView.setUint32(0, (hView.getUint32(0) + a) | 0);
    hView.setUint32(4, (hView.getUint32(4) + b) | 0);
    hView.setUint32(8, (hView.getUint32(8) + c) | 0);
    hView.setUint32(12, (hView.getUint32(12) + d) | 0);
    hView.setUint32(16, (hView.getUint32(16) + e) | 0);
    hView.setUint32(20, (hView.getUint32(20) + f) | 0);
    hView.setUint32(24, (hView.getUint32(24) + g) | 0);
    hView.setUint32(28, (hView.getUint32(28) + hh) | 0);
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, hView.getUint32(i * 4));
  return out;
}

/** sha256 摘要视图：提供 Buffer 风格的定宽大端读取，便于移植主仓的派生代码。 */
export class Digest {
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  readUInt8(offset: number): number {
    return this.bytes[offset] ?? 0;
  }

  readUInt16BE(offset: number): number {
    return (this.readUInt8(offset) << 8) | this.readUInt8(offset + 1);
  }

  readUInt32BE(offset: number): number {
    return (
      ((this.readUInt8(offset) << 24) |
        (this.readUInt8(offset + 1) << 16) |
        (this.readUInt8(offset + 2) << 8) |
        this.readUInt8(offset + 3)) >>>
      0
    );
  }
}

const digestCache = new Map<string, Digest>();

/** sha256(UTF-8 输入) → Digest；同输入恒定，带进程内缓存（引擎同 seed 派生会被反复调用）。 */
export function sha256(input: string): Digest {
  const cached = digestCache.get(input);
  if (cached) return cached;
  const digest = new Digest(sha256Bytes(encoder.encode(input)));
  if (digestCache.size < 4096) digestCache.set(input, digest);
  return digest;
}

/** 确定性掷骰：返回 [0, 100) 浮点，同 seed 恒定。 */
export function deterministicRoll(seed: string): number {
  return (sha256(seed).readUInt32BE(0) / 0xffffffff) * 100;
}
