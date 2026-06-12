/**
 * Tiny self-contained QR code generator (byte mode, error-correction level L).
 * Produces a boolean matrix; the caller renders it as SVG. Supports versions
 * 1–10 (up to ~78 alphanumeric / ~62 byte chars at level Q-ish), which is more
 * than enough for short share URLs.
 *
 * This is a compact, dependency-free implementation. It is NOT a general-purpose
 * QR library — it covers exactly what the Share tab needs (encode a short URL).
 */

// ─── Galois field (GF(256)) tables for Reed–Solomon ─────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i], factor);
  }
  return res;
}

// ─── Capacity / EC tables for level L, versions 1–10 (byte mode) ────────────
// [version]: { size, ecPerBlock, dataCodewords, blocks: [[count, dataPerBlock]...] }
interface VerInfo {
  ec: number;
  groups: Array<[number, number]>; // [blockCount, dataCodewordsPerBlock]
  totalData: number;
  align: number[];
}

const VERSIONS: Record<number, VerInfo> = {
  1: { ec: 7, groups: [[1, 19]], totalData: 19, align: [] },
  2: { ec: 10, groups: [[1, 34]], totalData: 34, align: [6, 18] },
  3: { ec: 15, groups: [[1, 55]], totalData: 55, align: [6, 22] },
  4: { ec: 20, groups: [[1, 80]], totalData: 80, align: [6, 26] },
  5: { ec: 26, groups: [[1, 108]], totalData: 108, align: [6, 30] },
  6: { ec: 18, groups: [[2, 68]], totalData: 136, align: [6, 34] },
  7: { ec: 20, groups: [[2, 78]], totalData: 156, align: [6, 22, 38] },
  8: { ec: 24, groups: [[2, 97]], totalData: 194, align: [6, 24, 42] },
  9: { ec: 30, groups: [[2, 116]], totalData: 232, align: [6, 26, 46] },
  10: { ec: 18, groups: [[2, 68], [2, 69]], totalData: 274, align: [6, 28, 50] },
};

function chooseVersion(byteLen: number): number {
  // charCountIndicator is 1 byte (versions 1-9) or 2 bytes (>=10); add mode+count overhead.
  for (let v = 1; v <= 10; v++) {
    const ccBits = v >= 10 ? 16 : 8;
    const overheadBits = 4 + ccBits;
    const cap = VERSIONS[v].totalData * 8 - overheadBits;
    if (byteLen * 8 <= cap) return v;
  }
  throw new Error('QR: payload too long');
}

function bytesToBits(text: string): number[] {
  const enc = new TextEncoder();
  return Array.from(enc.encode(text));
}

// ─── Matrix placement ───────────────────────────────────────────────────────
function buildMatrix(version: number, codewords: number[]): boolean[][] {
  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array(size).fill(null),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );

  const setF = (r: number, c: number, val: boolean) => {
    modules[r][c] = val;
    reserved[r][c] = true;
  };

  // Finder patterns
  const placeFinder = (r: number, c: number) => {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const rr = r + i;
        const cc = c + j;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const isBorder =
          (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
          (j >= 0 && j <= 6 && (i === 0 || i === 6));
        const isCore = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        setF(rr, cc, isBorder || isCore);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const al = VERSIONS[version].align;
  for (const ar of al) {
    for (const ac of al) {
      // Skip those overlapping finders
      if (
        (ar <= 8 && ac <= 8) ||
        (ar <= 8 && ac >= size - 9) ||
        (ar >= size - 9 && ac <= 8)
      )
        continue;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const isRing = Math.max(Math.abs(i), Math.abs(j)) !== 1;
          setF(ar + i, ac + j, isRing);
        }
      }
    }
  }

  // Dark module
  setF(size - 8, 8, true);

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  // Version info (v>=7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[i][size - 11 + j] = true;
        reserved[size - 11 + j][i] = true;
      }
    }
  }

  // Place data bits (zig-zag)
  const bits: number[] = [];
  for (const cw of codewords) for (let b = 7; b >= 0; b--) bits.push((cw >> b) & 1);

  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        const bit = bitIdx < bits.length ? bits[bitIdx] : 0;
        bitIdx++;
        modules[row][cc] = bit === 1;
      }
    }
    upward = !upward;
  }

  // Apply mask 0 ((r+c) % 2 === 0) and matching format info
  const masked: boolean[][] = Array.from({ length: size }, (_, r) =>
    modules[r].map((v, c) => {
      const val = v ?? false;
      if (reserved[r][c]) return val;
      return (r + c) % 2 === 0 ? !val : val;
    }),
  );

  // Format info for EC level L (01) + mask 0 → 15-bit string 111011111000100
  const FORMAT_L_MASK0 = '111011111000100';
  const fbits = FORMAT_L_MASK0.split('').map((x) => x === '1');
  // Place format bits (standard layout)
  for (let i = 0; i <= 5; i++) masked[8][i] = fbits[i];
  masked[8][7] = fbits[6];
  masked[8][8] = fbits[7];
  masked[7][8] = fbits[8];
  for (let i = 9; i <= 14; i++) masked[14 - i][8] = fbits[i];
  for (let i = 0; i <= 7; i++) masked[size - 1 - i][8] = fbits[i];
  for (let i = 8; i <= 14; i++) masked[8][size - 15 + i] = fbits[i];

  return masked;
}

/** Generate a QR boolean matrix for the given text. */
export function makeQrMatrix(text: string): boolean[][] {
  const data = bytesToBits(text);
  const version = chooseVersion(data.length);
  const info = VERSIONS[version];
  const ccBits = version >= 10 ? 16 : 8;

  // Build the bit stream
  const bitArr: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bitArr.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  pushBits(data.length, ccBits);
  for (const b of data) pushBits(b, 8);

  const totalDataBits = info.totalData * 8;
  // Terminator
  const term = Math.min(4, totalDataBits - bitArr.length);
  for (let i = 0; i < term; i++) bitArr.push(0);
  // Pad to byte boundary
  while (bitArr.length % 8 !== 0) bitArr.push(0);
  // Pad bytes
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bitArr.length < totalDataBits) {
    pushBits(padBytes[pi % 2], 8);
    pi++;
  }

  // To data codewords
  const dataCw: number[] = [];
  for (let i = 0; i < bitArr.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bitArr[i + j];
    dataCw.push(byte);
  }

  // Split into blocks, compute EC, interleave
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, dataPer] of info.groups) {
    for (let b = 0; b < count; b++) {
      const blkData = dataCw.slice(offset, offset + dataPer);
      offset += dataPer;
      blocks.push({ data: blkData, ec: rsEncode(blkData, info.ec) });
    }
  }

  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const finalCw: number[] = [];
  for (let i = 0; i < maxData; i++) {
    for (const blk of blocks) if (i < blk.data.length) finalCw.push(blk.data[i]);
  }
  for (let i = 0; i < info.ec; i++) {
    for (const blk of blocks) finalCw.push(blk.ec[i]);
  }

  return buildMatrix(version, finalCw);
}
