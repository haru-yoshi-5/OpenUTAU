import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  applyEditsToProject,
  type EditMap,
  exportEdited,
  type NoteEdit,
  noteKey,
  normalizePitch,
  normalizeVibrato,
} from "./edits";
import { UstxError } from "./errors";
import { loadUstx } from "./load";
import type { Vibrato } from "./types";

const demoText = readFileSync(join(process.cwd(), "public/samples/demo.ustx"), "utf8");
const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const load = (text = demoText) => loadUstx("demo.ustx", enc(text));

const vibrato = (overrides: Partial<Vibrato> = {}): Vibrato => ({
  length: 75,
  period: 175,
  depth: 25,
  in: 10,
  out: 10,
  shift: 0,
  drift: 0,
  vol_link: 0,
  ...overrides,
});

const edits = (entries: [ReturnType<typeof noteKey>, NoteEdit][]): EditMap => new Map(entries);

/** 編集したノート以外が元データと一致することを確かめるため、該当ノートの値を差し替えた期待データを作る */
function expectedJs(text: string, mutate: (js: Record<string, any>) => void) {
  const js = load(text).doc.toJS() as Record<string, any>;
  mutate(js);
  return js;
}

describe("normalizePitch", () => {
  it("x の昇順に並べ替える（同じ x は元の順序を保つ）", () => {
    const result = normalizePitch({
      snap_first: true,
      data: [
        { x: 40, y: 0, shape: "io" },
        { x: -40, y: 0, shape: "l" },
        { x: 40, y: 5, shape: "o" },
      ],
    });
    expect(result.data.map((p) => [p.x, p.y])).toEqual([
      [-40, 0],
      [40, 0],
      [40, 5],
    ]);
  });

  it("snap_first が有効なとき、ピッチ点を 0 個にできない", () => {
    expect(() => normalizePitch({ snap_first: true, data: [] })).toThrow(UstxError);
    expect(normalizePitch({ snap_first: false, data: [] }).data).toEqual([]);
  });

  it("数値以外の位置・高さを拒否する", () => {
    expect(() =>
      normalizePitch({ snap_first: false, data: [{ x: Number.NaN, y: 0, shape: "io" }] }),
    ).toThrow(UstxError);
  });
});

describe("normalizeVibrato", () => {
  it("OpenUtau と同じ範囲に丸める", () => {
    expect(
      normalizeVibrato(
        vibrato({ length: 120, period: 1, depth: 999, shift: -5, drift: 300, vol_link: -300 }),
      ),
    ).toEqual(
      vibrato({ length: 100, period: 5, depth: 200, shift: 0, drift: 100, vol_link: -100 }),
    );
  });

  it("in と out の合計が 100 を超えないよう、out を優先して in を削る", () => {
    expect(normalizeVibrato(vibrato({ in: 80, out: 50 }))).toMatchObject({ in: 50, out: 50 });
  });
});

describe("applyEditsToProject", () => {
  it("差分のあるノートだけを差し替え、ほかのパート・ノートは同じオブジェクトを返す", () => {
    const { project } = load();
    const target = project.voiceParts[1].notes[2];
    const result = applyEditsToProject(
      project,
      edits([[noteKey(1, target.index), { vibrato: vibrato() }]]),
    );
    expect(result).not.toBe(project);
    expect(result.voiceParts[0]).toBe(project.voiceParts[0]);
    expect(result.voiceParts[1].notes[2].vibrato).toEqual(vibrato());
    expect(result.voiceParts[1].notes[1]).toBe(project.voiceParts[1].notes[1]);
  });

  it("差分が無ければ元のプロジェクトをそのまま返す", () => {
    const { project } = load();
    expect(applyEditsToProject(project, new Map())).toBe(project);
  });
});

describe("exportEdited", () => {
  it("差分が無ければ読み込んだバイト列をそのまま返す", () => {
    const bytes = enc(demoText);
    expect(exportEdited(loadUstx("demo.ustx", bytes), new Map())).toEqual(bytes);
  });

  it("ビブラートの差分を書き出し、読み込み直すと差分どおりになる", () => {
    const loaded = load();
    const v = vibrato({ length: 60, depth: 40 });
    const out = exportEdited(loaded, edits([[noteKey(0, 1), { vibrato: v }]]));
    const reloaded = loadUstx("demo.ustx", out);
    expect(reloaded.doc.toJS()).toEqual(
      expectedJs(demoText, (js) => {
        js.voice_parts[0].notes[1].vibrato = v;
      }),
    );
    // 既存のフロー形式とキーの順序を保つ
    expect(dec(out)).toContain(
      "    vibrato: {length: 60, period: 175, depth: 40, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}",
    );
  });

  it("ピッチ点の差分を x の昇順・フロー形式で書き出す", () => {
    const loaded = load();
    const pitch = {
      snap_first: true,
      data: [
        { x: 30, y: -5, shape: "o" as const },
        { x: -60, y: 0, shape: "io" as const },
        { x: 0, y: 2.5, shape: "l" as const },
      ],
    };
    const out = dec(exportEdited(loaded, edits([[noteKey(0, 0), { pitch }]])));
    expect(out).toContain(
      [
        "      - {x: -60, y: 0, shape: io}",
        "      - {x: 0, y: 2.5, shape: l}",
        "      - {x: 30, y: -5, shape: o}",
        "      snap_first: true",
      ].join("\n"),
    );
    const reloaded = loadUstx("demo.ustx", enc(out));
    expect(reloaded.project.voiceParts[0].notes[0].pitch.data.map((p) => p.x)).toEqual([
      -60, 0, 30,
    ]);
  });

  it("範囲外のビブラートは丸めてから書き出す", () => {
    const out = exportEdited(
      load(),
      edits([[noteKey(0, 0), { vibrato: vibrato({ period: 9999 }) }]]),
    );
    expect(loadUstx("demo.ustx", out).project.voiceParts[0].notes[0].vibrato.period).toBe(500);
  });

  it("未対応のフィールドと BOM・CRLF を保ったまま書き出す", () => {
    const text = demoText.replace(
      "    tuning: 0\n",
      "    tuning: 0\n    future_note_field: keep-me\n",
    );
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(text.replace(/\n/g, "\r\n"))]);
    const out = exportEdited(
      loadUstx("demo.ustx", bytes),
      edits([[noteKey(0, 0), { vibrato: vibrato() }]]),
    );
    expect(Array.from(out.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const outText = dec(out);
    expect(outText).toContain("future_note_field: keep-me\r\n");
    expect(outText.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("存在しないノートへの差分は書き出さずにエラーにする", () => {
    expect(() => exportEdited(load(), edits([[noteKey(0, 999), { vibrato: vibrato() }]]))).toThrow(
      UstxError,
    );
  });

  it("snap_first が有効なノートのピッチ点を 0 個にする差分は書き出さない", () => {
    expect(() =>
      exportEdited(load(), edits([[noteKey(0, 0), { pitch: { snap_first: true, data: [] } }]])),
    ).toThrow(UstxError);
  });

  it("書き出し対象外の形式では書き出さない", () => {
    const loaded = load(demoText.replace("ustx_version: 0.10", "ustx_version: 0.11"));
    expect(() => exportEdited(loaded, edits([[noteKey(0, 0), { vibrato: vibrato() }]]))).toThrow(
      UstxError,
    );
  });
});
