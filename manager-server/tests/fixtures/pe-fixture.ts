/**
 * PE/CLI 二进制 fixture 构造器。
 *
 * 服务端测试要求"可重现、不依赖外部"——手工构造最小合法 PE + CLI Buffer，
 * 嵌入 AssemblyVersionAttribute 自定义属性，让 `parsePeAssemblyVersion` 能
 * 走完整解析路径。
 *
 * 真实集成测试（端到端 `.dll` 文件）用 mock fs。
 */

/** fixture 构造选项 */
export interface BuildPeOptions {
  /** 版本字符串（默认 '1.2.3.4'） */
  versionString?: string;
  /** MemberRef 名称（默认 'AssemblyVersionAttribute'） */
  memberRefName?: string;
  /** 强制 CLR RVA = 0（模拟非托管 .dll） */
  forceUnmanaged?: boolean;
  /** 截断 PE 头（模拟坏文件） */
  truncatePe?: boolean;
  /** 损坏 metadata 头（写 'XXXX' 替 'BSJB'） */
  corruptMetadataHeader?: boolean;
}

/** 写 ECMA-335 压缩 unsigned int（II.23.2） */
export function writeCompressedUInt(value: number): Buffer {
  if (value < 0x80) return Buffer.from([value]);
  if (value < 0x4000) {
    return Buffer.from([0x80 | (value >> 8), value & 0xff]);
  }
  return Buffer.from([
    0xc0 | ((value >> 24) & 0x1f),
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
}

/** 4 字节对齐 padding */
function pad4(b: Buffer): Buffer {
  const rem = b.length % 4;
  return rem === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - rem)]);
}

/**
 * 构造最小 PE/CLI Buffer，嵌入 AssemblyVersionAttribute "<versionString>"。
 */
export function buildPeFixture(opts: BuildPeOptions = {}): Buffer {
  const versionString = opts.versionString ?? "1.2.3.4";
  const memberRefName = opts.memberRefName ?? "AssemblyVersionAttribute";

  // ── 1. CA blob：0x0001 0E <len> <utf8> ─────────────────────
  const versionBytes = Buffer.from(versionString, "utf8");
  const lenComp = writeCompressedUInt(versionBytes.length);
  const caBlob = Buffer.concat([
    Buffer.from([0x01, 0x00, 0x0e]),
    lenComp,
    versionBytes,
  ]);

  // ── 2. MemberRef signature（空 blob 0x01 0x00 = 1 字节数据） ──
  const memberRefSig = Buffer.from([0x01, 0x00]);

  // ── 3. MemberRef 行：Class(2) + Name(2) + Sig(2) = 6 bytes ──
  const memberRefRow = Buffer.alloc(6);
  memberRefRow.writeUInt16LE(0, 0); // Class
  memberRefRow.writeUInt16LE(2, 2); // Name idx ("AssemblyVersionAttribute")
  memberRefRow.writeUInt16LE(1, 4); // Sig idx

  // ── 4. CustomAttribute 行：Parent(2) + Type(2) + Value(2) = 6 bytes ──
  // Parent = (Assembly row 1 << 5) | tag=9 → 0x29
  // Type = (MemberRef row 1 << 3) | tag=1 → 0x09
  // Value = CA blob 在 #Blob 堆内的偏移（= 2，MemberRef sig 占 2 字节）
  const customAttrRow = Buffer.alloc(6);
  customAttrRow.writeUInt16LE(0x29, 0);
  customAttrRow.writeUInt16LE(0x09, 2);
  customAttrRow.writeUInt16LE(2, 4);

  // ── 5. Assembly 行：22 bytes ──
  const assemblyRow = Buffer.alloc(22);

  // ── 6. #Strings heap：0x00 (idx 0) + 0x00 (idx 1, 空终止位置) + Name\0 (idx 2) ──
  const strHeap = Buffer.concat([
    Buffer.from([0x00, 0x00]),
    Buffer.from(memberRefName + "\0", "utf8"),
  ]);

  // ── 7. #Blob heap：MemberRefSig (2 bytes) + CA blob ──
  const blobHeap = Buffer.concat([memberRefSig, caBlob]);

  // ── 8. '#~' 表头（24 字节） ──
  const tblHeader = Buffer.alloc(24);
  tblHeader.writeUInt8(2, 1); // major
  tblHeader.writeUInt8(0, 2); // minor
  tblHeader.writeUInt8(0, 6); // heapSizes = 0
  // valid bits = bit10 (MemberRef) | bit12 (CustomAttribute) | bit32 (Assembly)
  const validBits = (1n << 32n) | (1n << 12n) | (1n << 10n);
  tblHeader.writeBigUInt64LE(validBits, 8);

  // 64 个 row counts
  const counts = Buffer.alloc(64 * 4);
  for (let i = 0; i < 64; i++) {
    counts.writeUInt32LE(i === 10 || i === 12 || i === 32 ? 1 : 0, i * 4);
  }

  const tablesStream = Buffer.concat([tblHeader, counts, memberRefRow, customAttrRow, assemblyRow]);

  // ── 9. Metadata root ──────────────────────────────────────
  const versionStr = Buffer.from("v4.0.30319\0", "utf8");
  const versionStrPad = pad4(versionStr);
  const numStreams = 3;

  const nameTilde = pad4(Buffer.from("#~\0", "utf8"));
  const nameStrings = pad4(Buffer.from("#Strings\0", "utf8"));
  const nameBlob = pad4(Buffer.from("#Blob\0", "utf8"));

  const headerPrefix = Buffer.concat([
    Buffer.from("BSJB"),
    Buffer.from([0x02, 0x00]),
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from([
      versionStr.length & 0xff,
      (versionStr.length >> 8) & 0xff,
      (versionStr.length >> 16) & 0xff,
      (versionStr.length >> 24) & 0xff,
    ]),
    versionStrPad,
    Buffer.from([0x00, 0x00]), // flags
    Buffer.from([numStreams & 0xff, (numStreams >> 8) & 0xff]),
  ]);

  // stream data 起始 = headerPrefix + (3 stream headers * 8) + (3 names lengths)
  const tblStart = headerPrefix.length + numStreams * 8 + nameTilde.length + nameStrings.length + nameBlob.length;
  const strStart = tblStart + tablesStream.length;
  const blobStart = strStart + strHeap.length;

  const streamTable = Buffer.alloc(8);
  streamTable.writeUInt32LE(tblStart, 0);
  streamTable.writeUInt32LE(tablesStream.length, 4);
  const streamStrings = Buffer.alloc(8);
  streamStrings.writeUInt32LE(strStart, 0);
  streamStrings.writeUInt32LE(strHeap.length, 4);
  const streamBlob = Buffer.alloc(8);
  streamBlob.writeUInt32LE(blobStart, 0);
  streamBlob.writeUInt32LE(blobHeap.length, 4);

  const metadata = Buffer.concat([
    headerPrefix,
    streamTable,
    streamStrings,
    streamBlob,
    nameTilde,
    nameStrings,
    nameBlob,
    tablesStream,
    strHeap,
    blobHeap,
  ]);

  // ── 10. Section payload + CLR Header ─────────────────────
  const metaRva = 0x2000;
  const clrHeader = Buffer.alloc(16);
  clrHeader.writeUInt32LE(72, 0);
  clrHeader.writeUInt16LE(2, 4);
  clrHeader.writeUInt16LE(5, 6);
  clrHeader.writeUInt32LE(metaRva, 8);
  clrHeader.writeUInt32LE(metadata.length, 12);

  // ── 11. PE + Optional Header + Section ────────────────────
  const clrRva = 0x1000;
  const sectionRawPtr = 0x800;
  const optHeader = Buffer.alloc(96 + 16 * 8);
  optHeader.writeUInt16LE(0x10b, 0); // PE32
  optHeader.writeUInt32LE(16, 92);
  optHeader.writeUInt32LE(clrRva, 96 + 14 * 8);
  optHeader.writeUInt32LE(clrHeader.length, 96 + 14 * 8 + 4);

  const peHeader = Buffer.alloc(24);
  peHeader.write("PE\0\0", 0, 4, "ascii");
  peHeader.writeUInt16LE(0x14c, 4);
  peHeader.writeUInt16LE(1, 6);
  peHeader.writeUInt16LE(optHeader.length, 20);

  const section = Buffer.alloc(40);
  section.writeUInt32LE(clrRva, 12);
  section.writeUInt32LE(0x4000, 8);
  section.writeUInt32LE(0x1000, 16);
  section.writeUInt32LE(sectionRawPtr, 20);

  // Section payload 0x1000 字节：CLR Header + metadata
  const payload = Buffer.concat([clrHeader, metadata], 0x1000);
  // 但 metadata 可能比 0x1000 - 16 大；无所谓，我们只读用到的 RVA
  const sectionPayload = payload.length >= 0x1000 ? payload : Buffer.concat([payload, Buffer.alloc(0x1000 - payload.length)]);

  const pePart = Buffer.concat([peHeader, optHeader, section, sectionPayload]);

  // ── 12. DOS 头 ─────────────────────────────────────────
  const eLfanew = 0x80;
  const dos = Buffer.alloc(eLfanew);
  dos.write("MZ", 0, 2, "ascii");
  dos.writeUInt32LE(eLfanew, 0x3c);

  const fullPe = Buffer.concat([dos, pePart], eLfanew + pePart.length);

  // 故障注入
  if (opts.forceUnmanaged) {
    fullPe.writeUInt32LE(0, eLfanew + 24 + 96 + 14 * 8);
  }
  if (opts.truncatePe) {
    return fullPe.subarray(0, 0x40);
  }
  if (opts.corruptMetadataHeader) {
    "XXXX".split("").forEach((c, i) => {
      fullPe[sectionRawPtr + clrHeader.length + i] = c.charCodeAt(0);
    });
  }

  return fullPe;
}
