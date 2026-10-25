import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UstxError } from "./errors";
import { LIMITS, loadUstx } from "./load";

const demoText = readFileSync(
  join(process.cwd(), "public/samples/demo.ustx"),
  "utf8",
);
const enc = (text: string) => new TextEncoder().encode(text);

function expectUstxError(fn: () => unknown, code: UstxError["code"]) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(UstxError);
    expect((e as UstxError).code).toBe(code);
    return;
  }
  throw new Error(`UstxError(${code}) が発生しませんでした`);
}

describe("loadUstx: 正常系", () => {
  const loaded = loadUstx("demo.ustx", enc(demoText));

  it("プロジェクト情報を読み取れる", () => {
    const p = loaded.project;
    expect(p.name).toBe("AI Tuning Studio デモ");
    expect(p.version.raw).toBe("0.10");
    expect(p.tempos).toEqual([
      { position: 0, bpm: 120 },
      { position: 7680, bpm: 100 },
    ]);
    expect(p.timeSignatures).toEqual([
      { bar_position: 0, beat_per_bar: 4, beat_unit: 4 },
    ]);
    expect(p.tracks[0]).toMatchObject({ name: "Vocal", singer: null });
    expect(p.voiceParts.map((v) => v.name)).toEqual(["Aメロ", "Bメロ"]);
    expect(p.noteCount).toBe(18);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.exportable).toBe(true);
  });

  it("ノートとピッチ点・ビブラート・カーブを読み取れる", () => {
    const b = loaded.project.voiceParts[1];
    expect(b.position).toBe(7680);
    const mi = b.notes[3];
    expect(mi).toMatchObject({
      lyric: "み",
      tone: 74,
      position: 1920,
      duration: 1440,
    });
    expect(mi.pitch.data[1]).toEqual({ x: 60, y: 3, shape: "o" });
    expect(mi.vibrato).toMatchObject({
      length: 50,
      period: 190,
      depth: 25,
      vol_link: 0,
    });
    expect(b.curves[0].abbr).toBe("pitd");
    expect(b.curves[0].xs.length).toBe(b.curves[0].ys.length);
  });

  it("BOM と CRLF を検出する", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...enc(demoText.replace(/\n/g, "\r\n")),
    ]);
    const l = loadUstx("demo.ustx", bytes);
    expect(l.hasBom).toBe(true);
    expect(l.eol).toBe("\r\n");
    expect(l.project.noteCount).toBe(18);
  });

  it("数字だけの歌詞も文字列として扱う", () => {
    const text = demoText.replace("lyric: そ", "lyric: 1");
    expect(
      loadUstx("a.ustx", enc(text)).project.voiceParts[0].notes[0].lyric,
    ).toBe("1");
  });

  it("v0.6 未満の古い形式は bpm からテンポを補い、警告を出す", () => {
    const text = demoText
      .replace("ustx_version: 0.10", "ustx_version: 0.5")
      .replace("bpm: 120", "bpm: 140");
    const l = loadUstx("old.ustx", enc(text));
    expect(l.project.tempos).toEqual([{ position: 0, bpm: 140 }]);
    expect(l.warnings.length).toBe(1);
    expect(l.exportable).toBe(true);
  });

  it("対応確認済みより新しい形式は表示のみ許可し、書き出しを止める", () => {
    const l = loadUstx(
      "new.ustx",
      enc(demoText.replace("ustx_version: 0.10", "ustx_version: 0.11")),
    );
    expect(l.exportable).toBe(false);
    expect(l.warnings[0]).toContain("0.11");
  });

  it("0.9 は 0.10 より古いと判定する（小数比較しない）", () => {
    const l = loadUstx(
      "a.ustx",
      enc(demoText.replace("ustx_version: 0.10", "ustx_version: 0.9")),
    );
    expect(l.exportable).toBe(true);
  });
});

describe("loadUstx: 不正入力の拒否", () => {
  it("拡張子が .ustx 以外", () => {
    expectUstxError(
      () => loadUstx("a.txt", enc(demoText)),
      "invalid-extension",
    );
  });

  it("空ファイル", () => {
    expectUstxError(() => loadUstx("a.ustx", new Uint8Array()), "empty-file");
  });

  it("サイズ上限超過", () => {
    expectUstxError(
      () =>
        loadUstx("a.ustx", new Uint8Array(LIMITS.maxFileBytes + 1).fill(0x20)),
      "file-too-large",
    );
  });

  it("UTF-8 として不正なバイト列（Shift_JIS 等）", () => {
    expectUstxError(
      () => loadUstx("a.ustx", new Uint8Array([0x82, 0xa0, 0x0a])),
      "invalid-encoding",
    );
  });

  it("YAML 構文エラー", () => {
    expectUstxError(
      () => loadUstx("a.ustx", enc("ustx_version: 0.10\nname: [unclosed\n")),
      "yaml-syntax",
    );
  });

  it("キー重複", () => {
    expectUstxError(
      () => loadUstx("a.ustx", enc("ustx_version: 0.10\nname: a\nname: b\n")),
      "yaml-syntax",
    );
  });

  it("複数文書", () => {
    expectUstxError(
      () =>
        loadUstx(
          "a.ustx",
          enc("ustx_version: 0.10\n---\nustx_version: 0.10\n"),
        ),
      "multiple-documents",
    );
  });

  it("エイリアスによる展開攻撃（Billion Laughs）", () => {
    const bomb = [
      "ustx_version: 0.10",
      "a: &a [x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
    ].join("\n");
    expectUstxError(() => loadUstx("a.ustx", enc(bomb)), "forbidden-alias");
  });

  it("独自タグ（オブジェクト生成を狙うタグ等）", () => {
    expectUstxError(
      () =>
        loadUstx(
          "a.ustx",
          enc("ustx_version: 0.10\nname: !!python/object:os.system ls\n"),
        ),
      "forbidden-tag",
    );
    expectUstxError(
      () => loadUstx("a.ustx", enc("ustx_version: 0.10\nname: !custom x\n")),
      "forbidden-tag",
    );
  });

  it("USTX ではない YAML", () => {
    expectUstxError(() => loadUstx("a.ustx", enc("foo: bar\n")), "not-ustx");
    expectUstxError(() => loadUstx("a.ustx", enc("- a\n- b\n")), "not-ustx");
  });

  it("型が想定と異なる構造", () => {
    const text = demoText.replace("tone: 64", "tone: high");
    try {
      loadUstx("a.ustx", enc(text));
      throw new Error("例外が発生しませんでした");
    } catch (e) {
      expect((e as UstxError).code).toBe("invalid-structure");
      expect((e as UstxError).detail).toContain("voice_parts[0].notes[0].tone");
    }
  });

  it("未知のピッチ点形状", () => {
    expectUstxError(
      () =>
        loadUstx("a.ustx", enc(demoText.replace("shape: l}", "shape: zz}"))),
      "invalid-structure",
    );
  });

  it("解釈できないバージョン表記", () => {
    expectUstxError(
      () =>
        loadUstx(
          "a.ustx",
          enc(demoText.replace("ustx_version: 0.10", "ustx_version: latest")),
        ),
      "unsupported-version",
    );
  });
});
