import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  applyEditsToProject,
  editedFileName,
  type EditMap,
  exportEdited,
  pruneEdit,
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

describe("pruneEdit", () => {
  const original = load().project.voiceParts[0].notes[0];

  it("元データと異なる項目だけを、正規化して差分として残す", () => {
    expect(pruneEdit(original, { vibrato: vibrato({ length: 60, period: 9999 }) })).toEqual({
      vibrato: vibrato({ length: 60, period: 500 }),
    });
  });

  it("元データと同じ値の項目は外し、何も残らなければ undefined を返す", () => {
    expect(pruneEdit(original, { vibrato: original.vibrato })).toBeUndefined();
    const pitch = { snap_first: true, data: [{ x: -10, y: 0, shape: "io" as const }] };
    expect(pruneEdit(original, { pitch, vibrato: original.vibrato })).toEqual({ pitch });
  });

  it("元データのピッチ点が昇順でなくても、並べ替えると同じなら差分にしない", () => {
    const unsorted = {
      ...original,
      pitch: { snap_first: true, data: [...original.pitch.data].reverse() },
    };
    expect(pruneEdit(unsorted, { pitch: original.pitch })).toBeUndefined();
  });

  it("元データのビブラートが範囲外でも、読み込み時に丸めた値と同じなら差分にしない", () => {
    const text = demoText.replace(
      "    vibrato: {length: 0, period: 175,",
      "    vibrato: {length: 0, period: 1000,",
    );
    const note = load(text).project.voiceParts[0].notes[0];
    expect(note.vibrato.period).toBe(500);
    expect(pruneEdit(note, { vibrato: { ...note.vibrato } })).toBeUndefined();
  });
});

describe("ビブラートの in / out の解釈（OpenUtau はキーの順にセッターを呼ぶ）", () => {
  const firstNoteVibrato = (vibratoLine: string) =>
    load(
      demoText.replace(
        "    vibrato: {length: 0, period: 175, depth: 25, in: 10, out: 10,",
        `    vibrato: ${vibratoLine}`,
      ),
    ).project.voiceParts[0].notes[0].vibrato;

  it("in → out の順なら、合計が 100 を超えた分を in から削る", () => {
    const v = firstNoteVibrato("{length: 50, period: 175, depth: 25, in: 80, out: 50,");
    expect([v.in, v.out]).toEqual([50, 50]);
  });

  it("out → in の順なら、合計が 100 を超えた分を out から削る", () => {
    const v = firstNoteVibrato("{length: 50, period: 175, depth: 25, out: 50, in: 80,");
    expect([v.in, v.out]).toEqual([80, 20]);
  });

  it("書き出した値は合計が 100 以下になり、キーの順に関係なく同じ値で読み込まれる", () => {
    const text = demoText.replace(
      "    vibrato: {length: 0, period: 175, depth: 25, in: 10, out: 10,",
      "    vibrato: {length: 50, period: 175, depth: 25, out: 50, in: 80,",
    );
    const loaded = load(text);
    const v = loaded.project.voiceParts[0].notes[0].vibrato;
    const out = exportEdited(loaded, edits([[noteKey(0, 0), { vibrato: { ...v, depth: 30 } }]]));
    const reloaded = loadUstx("a.ustx", out).project.voiceParts[0].notes[0].vibrato;
    expect(reloaded).toMatchObject({ in: 80, out: 20, depth: 30 });
  });
});

describe("pitch・vibrato の行が無いノートへの書き出し", () => {
  // OpenUtau は欠けたフィールドを既定値で補うため、このようなノートも正当に存在しうる
  const lines = demoText.split("\n");
  const at = lines.indexOf("    lyric: そ");
  const removed = [...lines.slice(0, at + 1), ...lines.slice(at + 7)].join("\n");

  it("前提：先頭ノートの pitch と vibrato の行を取り除いている", () => {
    expect(lines.slice(at + 1, at + 7).join("\n")).toMatch(/^ {4}pitch:[\s\S]*\n {4}vibrato: /);
    expect(load(removed).project.voiceParts[0].notes[0].pitch.data).toEqual([]);
  });

  it("新しいノードを作って書き出し、読み込み直すと差分どおりになる", () => {
    const loaded = load(removed);
    const pitch = {
      snap_first: true,
      data: [
        { x: -30, y: 0, shape: "io" as const },
        { x: 30, y: 0, shape: "io" as const },
      ],
    };
    const v = vibrato({ length: 75 });
    const out = dec(exportEdited(loaded, edits([[noteKey(0, 0), { pitch, vibrato: v }]])));
    expect(out).toContain(
      [
        "    pitch:",
        "      data:",
        "      - {x: -30, y: 0, shape: io}",
        "      - {x: 30, y: 0, shape: io}",
        "      snap_first: true",
        `    vibrato: {length: 75, period: 175, depth: 25, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}`,
      ].join("\n"),
    );
    const note = loadUstx("a.ustx", enc(out)).project.voiceParts[0].notes[0];
    expect(note.pitch).toEqual(pitch);
    expect(note.vibrato).toEqual(v);
  });
});

describe("editedFileName", () => {
  it("拡張子の前に _edited を付ける", () => {
    expect(editedFileName("song.ustx")).toBe("song_edited.ustx");
    expect(editedFileName("Song.USTX")).toBe("Song_edited.ustx");
    expect(editedFileName("a.b.ustx")).toBe("a.b_edited.ustx");
  });
});
