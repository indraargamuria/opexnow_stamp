import { inflateSync, unzlibSync } from "fflate";
import { AppError } from "./errors";

/**
 * PDF Processing Module
 *
 * Note: This module uses Latin1 encoding for text extraction which works for most
 * Indonesian documents. For full UTF-8 support (including emojis and special characters),
 * consider upgrading the TextDecoder to use UTF-8 encoding and handle CMaps properly.
 */

export interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export interface PageInfo {
  index: number;
  width: number;
  height: number;
}

export interface ExtractedDocument {
  pageCount: number;
  pages: PageInfo[];
  lines: TextLine[];
}

// ---------------------------------------------------------------------------
// Low-level object parser (xref tables + xref streams, FlateDecode, ObjStm)
// ---------------------------------------------------------------------------

type PdfValue =
  | { kind: "dict"; value: Record<string, PdfValue> }
  | { kind: "array"; value: PdfValue[] }
  | { kind: "string"; value: string }
  | { kind: "name"; value: string }
  | { kind: "number"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "ref"; num: number; gen: number }
  | { kind: "null" }
  | { kind: "kw"; value: string };

interface StreamData {
  dict: Record<string, PdfValue>;
  data: Uint8Array;
}

interface XrefEntry {
  type: 0 | 1 | 2;
  offset?: number;
  objstm?: number;
  index?: number;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

class Lexer {
  pos = 0;
  constructor(readonly data: Uint8Array) {}

  private skipWs() {
    while (this.pos < this.data.length) {
      const b = this.data[this.pos];
      if (b === 0x25) {
        // Fix: Add bounds checking for comment parsing
        this.pos++;
        while (this.pos < this.data.length && this.data[this.pos] !== 0x0a && this.data[this.pos] !== 0x0d) this.pos++;
        continue;
      }
      if (WS.has(b)) {
        this.pos++;
        continue;
      }
      break;
    }
  }

  next(): PdfValue | null {
    this.skipWs();
    const d = this.data;
    const i = this.pos;
    if (i >= d.length) return null;
    const b = d[i];

    if (b === 0x3c) {
      if (d[i + 1] === 0x3c) return this.readDict();
      return this.readHexString();
    }
    if (b === 0x3e && d[i + 1] === 0x3e) {
      this.pos += 2;
      return { kind: "kw", value: ">>" };
    }
    if (b === 0x28) return this.readString();
    if (b === 0x5b) {
      this.pos++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skipWs();
        if (this.data[this.pos] === 0x5d) {
          this.pos++;
          break;
        }
        const v = this.next();
        if (!v) break;
        arr.push(v);
      }
      return { kind: "array", value: arr };
    }
    if (b === 0x2f) return this.readName();
    if (b === 0x2b || b === 0x2d || b === 0x2e || (b >= 0x30 && b <= 0x39)) return this.readNumber();
    if (b === 0x74 || b === 0x66) {
      // true / false
      const word = this.readWord();
      if (word === "true") return { kind: "bool", value: true };
      if (word === "false") return { kind: "bool", value: false };
      return { kind: "kw", value: word };
    }
    return { kind: "kw", value: this.readWord() };
  }

  private readDict(): PdfValue {
    this.pos += 2;
    const dict: Record<string, PdfValue> = {};
    for (;;) {
      this.skipWs();
      if (this.data[this.pos] === 0x3e && this.data[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      const key = this.next();
      const val = this.next();
      if (!key || !val) break;
      if (key.kind === "name") dict[key.value] = val;
    }
    return { kind: "dict", value: dict };
  }

  private readName(): PdfValue {
    this.pos++;
    let name = "";
    while (this.pos < this.data.length) {
      const b = this.data[this.pos];
      if (WS.has(b) || b === 0x3c || b === 0x3e || b === 0x28 || b === 0x29 || b === 0x5b || b === 0x5d || b === 0x2f) break;
      this.pos++;
      if (b === 0x23) {
        // Fix: Properly construct hex string from two bytes
        const byte1 = this.data[this.pos];
        const byte2 = this.data[this.pos + 1];
        if (byte1 !== undefined && byte2 !== undefined) {
          const hex = String.fromCharCode(byte1) + String.fromCharCode(byte2);
          const charCode = parseInt(hex, 16);
          if (!isNaN(charCode)) {
            name += String.fromCharCode(charCode);
          }
        }
        this.pos += 2;
      } else {
        name += String.fromCharCode(b);
      }
    }
    return { kind: "name", value: name };
  }

  private readString(): PdfValue {
    this.pos++;
    let out = "";
    const d = this.data;
    while (this.pos < d.length) {
      const b = d[this.pos++];
      if (b === 0x29) break;
      if (b === 0x5c) {
        const n = d[this.pos++];
        if (n === 0x6e) out += "\n";
        else if (n === 0x72) out += "\r";
        else if (n === 0x74) out += "\t";
        else if (n === 0x62) out += "\b";
        else if (n === 0x66) out += "\f";
        else if (n === 0x28 || n === 0x29 || n === 0x5c) out += String.fromCharCode(n);
        else if (n >= 0x30 && n <= 0x37) {
          let octal = String.fromCharCode(n);
          for (let k = 0; k < 2; k++) {
            const m = d[this.pos];
            if (m >= 0x30 && m <= 0x37) {
              octal += String.fromCharCode(m);
              this.pos++;
            } else break;
          }
          out += String.fromCharCode(parseInt(octal, 8));
        } else out += String.fromCharCode(n);
      } else if (b === 0x0d) {
        if (d[this.pos] === 0x0a) this.pos++;
      } else {
        out += String.fromCharCode(b);
      }
    }
    return { kind: "string", value: out };
  }

  private readHexString(): PdfValue {
    this.pos++;
    let hex = "";
    while (this.pos < this.data.length) {
      const b = this.data[this.pos++];
      if (b === 0x3e) break;
      if (!WS.has(b)) hex += String.fromCharCode(b);
    }
    if (hex.length % 2 !== 0) hex += "0";
    let out = "";
    for (let i = 0; i < hex.length; i += 2) {
      const byteVal = parseInt(hex.slice(i, i + 2), 16);
      // Fix: Add validation for hex parsing
      if (!isNaN(byteVal)) {
        out += String.fromCharCode(byteVal);
      }
    }
    return { kind: "string", value: out };
  }

  private readNumber(): PdfValue {
    const start = this.pos;
    while (this.pos < this.data.length && /[0-9+\-.eE]/.test(String.fromCharCode(this.data[this.pos]))) this.pos++;
    const text = this.sliceToText(start, this.pos);
    // possible ref "N G R"
    const save = this.pos;
    this.skipWs();
    const d = this.data;
    let n2 = -1;
    if (d[this.pos] && /[0-9]/.test(String.fromCharCode(d[this.pos]))) {
      const s2 = this.pos;
      while (this.pos < this.data.length && /[0-9]/.test(String.fromCharCode(d[this.pos]))) this.pos++;
      n2 = parseInt(this.sliceToText(s2, this.pos), 10);
      this.skipWs();
      if (String.fromCharCode(d[this.pos] ?? 0) === "R") {
        this.pos++;
        return { kind: "ref", num: parseInt(text, 10), gen: n2 };
      }
    }
    this.pos = save;
    return { kind: "number", value: parseFloat(text) };
  }

  private readWord(): string {
    const start = this.pos;
    while (this.pos < this.data.length && !WS.has(this.data[this.pos])) this.pos++;
    return this.sliceToText(start, this.pos);
  }

  private sliceToText(a: number, b: number): string {
    let s = "";
    for (let i = a; i < b; i++) s += String.fromCharCode(this.data[i]);
    return s;
  }
}

class PdfDocument2 {
  private xrefs = new Map<number, XrefEntry>();
  private cache = new Map<number, PdfValue | undefined>();
  private textDecoder = new TextDecoder("latin1");
  private rootRef: PdfValue | null = null;

  constructor(readonly bytes: Uint8Array) {}

  /** Catalog object (the trailer /Root), captured during xref parsing. */
  get root(): PdfValue | null {
    return this.rootRef;
  }

  /** Parse the trailer dict at a position that begins with the "trailer" keyword. */
  parseTrailerDict(pos: number): Record<string, PdfValue> | null {
    const lexer = new Lexer(this.bytes);
    lexer.pos = pos;
    const kw = lexer.next();
    const dict = lexer.next();
    if (kw?.kind === "kw" && kw.value === "trailer" && dict?.kind === "dict") return dict.value;
    return null;
  }

  private findStartXref(): number {
    const tail = this.bytes.subarray(Math.max(0, this.bytes.length - 2048));
    let tailStr = "";
    for (const b of tail) tailStr += String.fromCharCode(b);
    const idx = tailStr.lastIndexOf("startxref");
    if (idx === -1) throw new Error("no startxref");
    const numStr = tailStr.slice(idx + 9).trim().split(/\s+/)[0] ?? "";
    const n = parseInt(numStr, 10);
    if (!Number.isFinite(n)) throw new Error("bad startxref");
    return n;
  }

  parseXrefs(): void {
    const visited = new Set<number>();
    let offset = this.findStartXref();
    for (let depth = 0; depth < 32 && offset > 0 && !visited.has(offset); depth++) {
      visited.add(offset);
      if (this.startsAt(offset, "xref")) {
        offset = this.parseXrefTable(offset);
      } else {
        offset = this.parseXrefStream(offset);
      }
    }
  }

  private startsAt(offset: number, word: string): boolean {
    const b = this.bytes.subarray(offset, offset + word.length + 1);
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return s.startsWith(word);
  }

  private parseXrefTable(start: number): number {
    let pos = start + 4;
    for (;;) {
      pos = this.skipWsAt(pos);
      const tok = this.wordAt(pos);
      if (tok === "trailer") {
        const trailer = this.parseTrailerDict(pos);
        if (trailer) {
          if (!this.rootRef) this.rootRef = trailer["Root"] ?? null;
          const prev = trailer["Prev"];
          if (prev && prev.kind === "number") return prev.value;
        }
        return 0;
      }
      // subsection: "start count"
      const startNum = parseInt(tok, 10);
      pos = this.skipWsAt(pos);
      const count = parseInt(this.wordAt(pos), 10);
      if (!Number.isFinite(startNum) || !Number.isFinite(count)) return 0;
      pos = this.skipWsAt(pos);
      for (let i = 0; i < count; i++) {
        const entryLine = this.lineAt(pos);
        const m = /^(\d{10}) (\d{5}) ([nf])\b/.exec(entryLine);
        pos += entryLine.length + 1;
        if (!m) continue;
        const objNum = startNum + i;
        if (m[3] === "n") {
          this.xrefs.set(objNum, { type: 1, offset: parseInt(m[1], 10) });
        } else {
          this.xrefs.set(objNum, { type: 0 });
        }
      }
    }
  }

  private parseXrefStream(start: number): number {
    const obj = this.parseObjectAt(start);
    if (!obj || obj.value.kind !== "dict") return 0;
    const dict = obj.value.value;
    if (dict["Type"]?.kind !== "name" || dict["Type"].value !== "XRef") return 0;
    const stream = this.readStreamAt(obj.end, dict);
    if (!stream) return 0;

    const w = this.numArray(dict["W"], [1, 4, 2]);
    const size = this.asNumber(dict["Size"], 0);
    const indexArr = this.numArray(dict["Index"], [0, size]);
    const fields = w[0] + w[1] + w[2];
    let entries: Uint8Array;
    try {
      entries = this.decodeStream(stream.data, dict);
    } catch {
      entries = stream.data;
    }

    for (let s = 0; s < indexArr.length; s += 2) {
      const startNum = indexArr[s];
      const count = indexArr[s + 1];
      for (let i = 0; i < count; i++) {
        // Fix: Proper index calculation for xref stream entries
        const objIndex = i + (indexArr[s] - (indexArr[0] === 0 ? 0 : indexArr[0]));
        const base = objIndex * fields;
        if (base + fields > entries.length || base < 0) break;
        const f1 = this.readInt(entries, base, w[0]);
        const f2 = this.readInt(entries, base + w[0], w[1]);
        const f3 = this.readInt(entries, base + w[0] + w[1], w[2]);
        const objNum = startNum + i;
        if (f1 === 1) this.xrefs.set(objNum, { type: 1, offset: f2 });
        else if (f1 === 2) this.xrefs.set(objNum, { type: 2, objstm: f2, index: f3 });
        else this.xrefs.set(objNum, { type: 0 });
      }
    }
    const prev = dict["Prev"];
    if (!this.rootRef) this.rootRef = dict["Root"] ?? null;
    return prev && prev.kind === "number" ? prev.value : 0;
  }

  private readInt(data: Uint8Array, base: number, len: number): number {
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + (data[base + i] ?? 0);
    return v;
  }

  private numArray(v: PdfValue | undefined, fallback: number[]): number[] {
    if (v && v.kind === "array") return v.value.map((x) => (x.kind === "number" ? x.value : 0));
    return fallback;
  }

  private asNumber(v: PdfValue | undefined, fallback: number): number {
    return v && v.kind === "number" ? v.value : fallback;
  }

  decodeStream(data: Uint8Array, dict: Record<string, PdfValue>): Uint8Array {
    const filter = dict["Filter"] ?? dict["F"];
    if (!filter) return data;
    const filters: string[] = [];
    if (filter.kind === "name") filters.push(filter.value);
    else if (filter.kind === "array") filters.push(...filter.value.map((x) => (x.kind === "name" ? x.value : "")));
    let out = data;
    for (const f of filters) {
      if (f === "FlateDecode" || f === "Fl") {
        try {
          // Most PDF producers emit zlib-wrapped deflate; some use raw deflate.
          out = unzlibSync(out);
        } catch (zlibErr) {
          try {
            out = inflateSync(out);
          } catch (inflateErr) {
            // Fix: Better error message for debugging
            throw new Error(`FlateDecode failed: zlib error (${zlibErr instanceof Error ? zlibErr.message : 'unknown'}), inflate error (${inflateErr instanceof Error ? inflateErr.message : 'unknown'})`);
          }
        }
      } else {
        throw new Error(`unsupported filter ${f}`);
      }
    }
    // predictor (png up to 13)
    const params = dict["DecodeParms"] ?? dict["DP"];
    if (params && params.kind === "dict") {
      const predictor = this.asNumber(params.value["Predictor"], 1);
      if (predictor === 2) out = this.applyTiffPredictor(out, this.asNumber(params.value["Colors"], 1), this.asNumber(params.value["BitsPerComponent"], 8), this.asNumber(params.value["Columns"], 1));
      else if (predictor >= 10) out = this.applyPngPredictor(out, predictor, this.asNumber(params.value["Colors"], 1), this.asNumber(params.value["BitsPerComponent"], 8), this.asNumber(params.value["Columns"], 1));
    }
    return out;
  }

  private applyPngPredictor(data: Uint8Array, predictor: number, colors: number, bpc: number, columns: number): Uint8Array {
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    for (let r = 0; r < rows; r++) {
      const ft = data[r * (rowLen + 1)];
      const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      const outRow = out.subarray(r * rowLen, (r + 1) * rowLen);
      const prevRow = r > 0 ? out.subarray((r - 1) * rowLen, r * rowLen) : undefined;
      for (let i = 0; i < rowLen; i++) {
        const a = i >= bpp ? outRow[i - bpp] : 0;
        const b = prevRow ? prevRow[i] : 0;
        const c = prevRow && i >= bpp ? prevRow[i - bpp] : 0;
        const rawer = row[i];
        switch (ft) {
          case 0:
            outRow[i] = rawer;
            break;
          case 1:
            outRow[i] = rawer + a;
            break;
          case 2:
            outRow[i] = rawer + b;
            break;
          case 3:
            outRow[i] = rawer + ((a + b) >> 1);
            break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            outRow[i] = rawer + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default:
            outRow[i] = rawer;
        }
      }
    }
    return out;
  }

  private applyTiffPredictor(data: Uint8Array, colors: number, bpc: number, columns: number): Uint8Array {
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    const rows = Math.floor(data.length / rowLen);
    const out = data.slice();
    for (let r = 0; r < rows; r++) {
      const base = r * rowLen;
      for (let i = bpp; i < rowLen; i++) out[base + i] = (out[base + i] + out[base + i - bpp]) & 0xff;
    }
    return out;
  }

  private readStreamAt(pos: number, dict: Record<string, PdfValue>): StreamData | null {
    const lexer = new Lexer(this.bytes);
    lexer.pos = pos;
    const kw = lexer.next();
    if (!kw || kw.kind !== "kw" || kw.value !== "stream") return null;
    // skip one EOL
    if (this.bytes[lexer.pos] === 0x0d) lexer.pos++;
    if (this.bytes[lexer.pos] === 0x0a) lexer.pos++;
    let length = this.asNumber(dict["Length"], -1);
    if (length < 0 && dict["Length"] && dict["Length"].kind === "ref") {
      const resolved = this.resolve(dict["Length"]);
      if (resolved && resolved.kind === "number") length = resolved.value;
    }
    if (length >= 0 && lexer.pos + length <= this.bytes.length) {
      return { dict, data: this.bytes.subarray(lexer.pos, lexer.pos + length) };
    }
    // fallback: search for "endstream"
    let end = -1;
    for (let i = lexer.pos; i < this.bytes.length; i++) {
      if (
        this.bytes[i] === 0x65 &&
        this.bytes[i + 1] === 0x6e &&
        this.bytes[i + 2] === 0x64 &&
        this.bytes[i + 3] === 0x73 &&
        this.bytes[i + 4] === 0x74 &&
        this.bytes[i + 5] === 0x72 &&
        this.bytes[i + 6] === 0x65 &&
        this.bytes[i + 7] === 0x61 &&
        this.bytes[i + 8] === 0x6d
      ) {
        end = i;
        break;
      }
    }
    if (end === -1) return null;
    // strip trailing EOL
    let dataEnd = end;
    if (this.bytes[dataEnd - 1] === 0x0a) dataEnd--;
    if (this.bytes[dataEnd - 1] === 0x0d) dataEnd--;
    return { dict, data: this.bytes.subarray(lexer.pos, dataEnd) };
  }

  readStreamForObject(num: number): StreamData | null {
    const entry = this.xrefs.get(num);
    if (!entry || entry.type !== 1 || entry.offset === undefined) return null;
    const parsed = this.parseObjectAt(entry.offset);
    if (!parsed || parsed.value.kind !== "dict") return null;
    return this.readStreamAt(parsed.end, parsed.value.value);
  }

  parseObjectAt(start: number): { value: PdfValue; end: number } | null {
    const lexer = new Lexer(this.bytes);
    lexer.pos = start;
    const first = lexer.next();
    if (!first) return null;
    if (first.kind === "kw" && first.value === "obj") {
      // offset points at "N G obj"
      const num = lexer.next();
      const gen = lexer.next();
      const obj = lexer.next();
      void num;
      void gen;
      if (obj) return { value: obj, end: lexer.pos };
      return null;
    }
    if (first.kind === "number") {
      const gen = lexer.next();
      const obj = lexer.next();
      void gen;
      if (obj && obj.kind === "kw" && obj.value === "obj") {
        const body = lexer.next();
        if (body) return { value: body, end: lexer.pos };
        return null;
      }
    }
    return null;
  }

  resolve(v: PdfValue): PdfValue | null {
    if (v.kind !== "ref") return v;
    return this.getObject(v.num);
  }

  getObject(num: number): PdfValue | null {
    if (this.cache.has(num)) {
      const c = this.cache.get(num);
      return c ?? null;
    }
    const entry = this.xrefs.get(num);
    if (!entry) return null;
    let result: PdfValue | null = null;
    if (entry.type === 1 && entry.offset !== undefined) {
      const parsed = this.parseObjectAt(entry.offset);
      if (parsed) result = parsed.value;
    } else if (entry.type === 2 && entry.objstm !== undefined) {
      result = this.resolveFromObjStm(entry.objstm, entry.index ?? 0);
    }
    this.cache.set(num, result ?? undefined);
    return result;
  }

  private resolveFromObjStm(objstmNum: number, index: number): PdfValue | null {
    const streamEntry = this.xrefs.get(objstmNum);
    if (!streamEntry || streamEntry.type !== 1 || streamEntry.offset === undefined) return null;
    const obj = this.parseObjectAt(streamEntry.offset);
    if (!obj || obj.value.kind !== "dict") return null;
    const dict = obj.value.value;
    const stream = this.readStreamAt(obj.end, dict);
    if (!stream) return null;
    let data: Uint8Array;
    try {
      data = this.decodeStream(stream.data, dict);
    } catch {
      return null;
    }
    const n = this.asNumber(dict["N"], 0);
    const first = this.asNumber(dict["First"], 0);
    const header = new Lexer(data);
    const offsets: number[] = [];
    for (let i = 0; i < n; i++) {
      header.next(); // object number
      offsets.push((header.next() as { kind: "number"; value: number } | null)?.value ?? 0);
    }
    if (index < 0 || index >= offsets.length) return null;
    const lexer = new Lexer(data);
    lexer.pos = first + offsets[index];
    const v = lexer.next();
    return v;
  }

  private skipWsAt(pos: number): number {
    while (pos < this.bytes.length && WS.has(this.bytes[pos])) pos++;
    return pos;
  }

  private wordAt(pos: number): string {
    let s = "";
    while (pos < this.bytes.length && !WS.has(this.bytes[pos])) s += String.fromCharCode(this.bytes[pos++]);
    return s;
  }

  private lineAt(pos: number): string {
    let s = "";
    while (pos < this.bytes.length && this.bytes[pos] !== 0x0a) s += String.fromCharCode(this.bytes[pos++]);
    return s;
  }
}

// ---------------------------------------------------------------------------
// Content stream text extraction
// ---------------------------------------------------------------------------

interface TextRun {
  text: string;
  x: number;
  y: number;
  size: number;
}

type Matrix = [number, number, number, number, number, number];

function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

class ContentProcessor {
  private stack: { tm: Matrix; lm: Matrix; fs: number; leading: number; th: number }[] = [];
  private tm: Matrix = IDENTITY;
  private lm: Matrix = IDENTITY;
  private fs = 0;
  private leading = 14;
  private th = 1;
  runs: TextRun[] = [];

  private applyString(s: string) {
    const size = this.fs || 8;
    const x = this.tm[4];
    const y = this.tm[5];
    let text = "";
    let advance = 0;
    const norm = s.replace(/\r\n|\r/g, "\n");
    for (const ch of norm) {
      const w = size * 0.5 * this.th;
      advance += w;
      if (ch === "\n") {
        if (text) this.runs.push({ text, x, y, size });
        text = "";
        this.tm[4] = x + advance;
      } else {
        text += ch;
      }
    }
    // Fix: Only push if there's actual text content
    if (text) {
      this.runs.push({ text, x, y, size });
    }
    this.tm[4] += advance;
  }

  process(stream: Uint8Array) {
    const lexer = new Lexer(stream);
    const ops: PdfValue[] = [];
    for (;;) {
      const tok = lexer.next();
      if (!tok) break;
      if (tok.kind === "kw") {
        this.applyOperator(tok.value, ops);
        ops.length = 0;
      } else {
        ops.push(tok);
      }
    }
  }

  private num(ops: PdfValue[], i: number): number {
    const v = ops[i];
    return v && v.kind === "number" ? v.value : NaN;
  }

  private applyOperator(op: string, ops: PdfValue[]) {
    switch (op) {
      case "BT":
        this.tm = [...IDENTITY];
        this.lm = [...IDENTITY];
        break;
      case "q":
        // Fix: Prevent stack overflow on malformed PDFs
        if (this.stack.length < 100) {
          this.stack.push({ tm: [...this.tm], lm: [...this.lm], fs: this.fs, leading: this.leading, th: this.th });
        }
        break;
      case "Q": {
        const saved = this.stack.pop();
        if (saved) {
          this.tm = saved.tm;
          this.lm = saved.lm;
          this.fs = saved.fs;
          this.leading = saved.leading;
          this.th = saved.th;
        }
        break;
      }
      case "Td":
      case "TD": {
        const tx = this.num(ops, 0);
        const ty = this.num(ops, 1);
        if (!Number.isNaN(tx) && !Number.isNaN(ty)) {
          const m = mul(this.lm, [1, 0, 0, 1, tx, ty]);
          this.tm = m;
          this.lm = [...m];
          if (op === "TD") this.leading = -ty;
        }
        break;
      }
      case "Tm": {
        if (ops.length >= 6) {
          const m = [this.num(ops, 0), this.num(ops, 1), this.num(ops, 2), this.num(ops, 3), this.num(ops, 4), this.num(ops, 5)] as Matrix;
          this.tm = m;
          this.lm = [...m];
        }
        break;
      }
      case "T*":
        this.tm = mul(this.lm, [1, 0, 0, 1, 0, -this.leading]);
        break;
      case "Tf": {
        const size = this.num(ops, 1);
        if (!Number.isNaN(size)) this.fs = size;
        break;
      }
      case "TL": {
        const l = this.num(ops, 0);
        if (!Number.isNaN(l)) this.leading = l;
        break;
      }
      case "Tz": {
        const z = this.num(ops, 0);
        if (!Number.isNaN(z)) this.th = z / 100;
        break;
      }
      case "Tj": {
        const s = ops[0];
        if (s && s.kind === "string") this.applyString(s.value);
        break;
      }
      case "'": {
        this.tm = mul(this.lm, [1, 0, 0, 1, 0, -this.leading]);
        const s = ops[0];
        if (s && s.kind === "string") this.applyString(s.value);
        break;
      }
      case '"': {
        const s = ops[2];
        this.tm = mul(this.lm, [1, 0, 0, 1, 0, -this.leading]);
        if (s && s.kind === "string") this.applyString(s.value);
        break;
      }
      case "TJ": {
        const arr = ops[0];
        if (arr && arr.kind === "array") {
          // Fix: Add bounds check for large arrays to prevent performance issues
          const maxItems = 10000;
          const items = arr.value.slice(0, maxItems);
          for (const item of items) {
            if (item.kind === "string") {
              this.applyString(item.value);
            } else if (item.kind === "number") {
              this.tm[4] -= (item.value / 1000) * (this.fs || 8) * this.th;
            }
          }
        }
        break;
      }
      default:
        // graphics and other operators: ignore
        break;
    }
  }
}

const LINE_TOLERANCE = 2.5;

function groupLines(runs: TextRun[], page: number): TextLine[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: (TextLine & { __y: number })[] = [];
  for (const r of sorted) {
    const text = r.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.__y - r.y) <= LINE_TOLERANCE) {
      const left = Math.min(last.x, r.x);
      const right = Math.max(last.x + last.width, r.x + text.length * r.size * 0.5);
      last.text = `${last.text} ${text}`;
      last.x = left;
      last.width = right - left;
      last.height = Math.max(last.height, r.size);
    } else {
      lines.push({
        text,
        x: r.x,
        y: r.y,
        width: text.length * r.size * 0.5,
        height: r.size,
        page,
        __y: r.y,
      });
    }
  }
  for (const l of lines) delete (l as { __y?: number }).__y;
  return lines as TextLine[];
}

// ---------------------------------------------------------------------------

export async function extractTextLayers(data: Uint8Array): Promise<ExtractedDocument> {
  try {
    // Validate input size to prevent memory issues
    const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100MB limit
    if (data.length > MAX_PDF_SIZE) {
      throw new AppError(400, "pdf_too_large", `PDF size (${Math.round(data.length / 1024 / 1024)}MB) exceeds maximum allowed size (100MB)`, "input");
    }

    const pdf = new PdfDocument2(data);
    pdf.parseXrefs();

    const catalog = findCatalog(pdf);
    const pageTree = catalog ? (catalog.kind === "dict" ? catalog.value["Pages"] : undefined) : undefined;
    const pages: PdfValue[] = [];
    collectPages(pdf, pageTree, pages, 0);

    if (pages.length === 0) {
      // Fallback: some single-page PDFs simply have page tree reachable from object 1.
      const direct = pdf.getObject(1);
      if (direct && direct.kind === "dict" && direct.value["Type"]?.kind === "name" && direct.value["Type"].value === "Catalog") {
        collectPages(pdf, direct.value["Pages"], pages, 0);
      }
      if (pages.length === 0) {
        for (let n = 2; n <= 64; n++) {
          const o = pdf.getObject(n);
          if (o && o.kind === "dict") {
            const t = o.value["Type"]?.kind === "name" ? o.value["Type"].value : "";
            if (t === "Page") {
              pages.push(o);
              break;
            }
          }
        }
      }
    }

    const lines: TextLine[] = [];
    const pageInfos: PageInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const pageObj = pages[i];
      if (!pageObj || pageObj.kind !== "dict") continue;

      let width = 612;
      let height = 792;
      const media = pageObj.value["MediaBox"] ?? pageObj.value["CropBox"];
      if (media && media.kind === "array" && media.value.length >= 4) {
        const coords = media.value.map((v) => (v.kind === "number" ? v.value : 0));
        width = Math.abs(coords[2] - coords[0]);
        height = Math.abs(coords[3] - coords[1]);
      }

      const runs: TextRun[] = [];
      const contents = pageObj.value["Contents"];
      const contentNums: number[] = [];
      if (contents?.kind === "ref") contentNums.push(contents.num);
      else if (contents?.kind === "array") for (const c of contents.value) if (c.kind === "ref") contentNums.push(c.num);

      for (const num of contentNums) {
        const stream = pdf.readStreamForObject(num);
        if (!stream) continue;
        try {
          const decoded = pdf.decodeStream(stream.data, stream.dict);
          const processor = new ContentProcessor();
          processor.process(decoded);
          runs.push(...processor.runs);
        } catch (streamErr) {
          // Fix: Log stream processing errors for debugging while continuing
          console.warn(`Failed to process content stream ${num}:`, streamErr instanceof Error ? streamErr.message : streamErr);
          /* skip un-decodable stream */
        }
      }

      lines.push(...groupLines(runs, i + 1));
      pageInfos.push({ index: i + 1, width, height });
    }

    return { pageCount: pageInfos.length, pages: pageInfos, lines };
  } catch (err) {
    throw new AppError(
      400,
      "invalid_pdf",
      err instanceof Error ? `Could not read PDF text layer: ${err.message}` : "Could not read PDF text layer",
      "input",
    );
  }
}

function findCatalog(pdf: PdfDocument2): PdfValue | null {
  // Prefer the /Root captured during xref parsing (works for xref streams too).
  if (pdf.root) return pdf.resolve(pdf.root) ?? pdf.root;
  try {
    // Scan the last 8 KB for a legacy trailer dict and use its /Root.
    const start = Math.max(0, pdf.bytes.length - 8192);
    const tail = pdf.bytes.subarray(start);
    let from = tail.length;
    for (;;) {
      const found = lastIndexOfBytes(tail, "trailer", from);
      if (found === -1) return null;
      const dict = pdf.parseTrailerDict(start + found);
      if (dict) {
        const root = dict["Root"];
        if (root) return pdf.resolve(root) ?? root;
      }
      from = found - 1;
    }
  } catch {
    return null;
  }
}

function lastIndexOfBytes(data: Uint8Array, needle: string, from: number): number {
  const b = needle.charCodeAt(0);
  const len = needle.length;
  let i = Math.min(from, data.length - len);
  for (; i >= 0; i--) {
    if (data[i] !== b) continue;
    let j = 1;
    for (; j < len; j++) {
      if (data[i + j] !== needle.charCodeAt(j)) break;
    }
    if (j === len) return i;
  }
  return -1;
}

function collectPages(pdf: PdfDocument2, node: PdfValue | undefined, out: PdfValue[], depth: number): void {
  if (!node || depth > 24) return;
  const resolved = node.kind === "ref" ? pdf.resolve(node) : node;
  if (!resolved || resolved.kind !== "dict") return;
  const type = resolved.value["Type"]?.kind === "name" ? resolved.value["Type"].value : "";
  if (type === "Page") {
    out.push(resolved);
    return;
  }
  const kids = resolved.value["Kids"];
  if (!kids) {
    // No kids found, this is a leaf node or malformed
    return;
  }
  if (kids.kind === "array") for (const kid of kids.value) collectPages(pdf, kid, out, depth + 1);
}
