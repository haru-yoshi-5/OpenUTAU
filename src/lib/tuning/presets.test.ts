import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { exportEdited, noteKey } from "../ustx/edits";
import { loadUstx } from "../ustx/load";
import { TimeAxis } from "../ustx/time-axis";
import { EXPRESSION_PRESETS, type ExpressionId, generatePresetEdits } from "./presets";

const demoBytes = new Uint8Array(readFileSync(join(process.cwd(), "public/samples/demo.ustx")));
const loaded = loadUstx("demo.ustx", demoBytes);
const { project } = loaded;
const partA = project.voiceParts[0];
const timeAxis = new TimeAxis(project.tempos);
const allA = new Set(partA.notes.map((n) => n.index));

const generate = (id: ExpressionId, strength: number, targets: ReadonlySet<number> = allA) =>
  generatePresetEdits(
    { notes: partA.notes, targets, partPosition: partA.position, timeAxis },
    id,
    strength,
  );

const ids = Object.keys(EXPRESSION_PRESETS) as ExpressionId[];

describe("generatePresetEdits", () => {
  it.each(ids)("「%s」は選んだノートにだけ差分を作る", (id) => {
    const edits = generate(id, 1, new Set([0, 2]));
    expect([...edits.keys()].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  it.each(ids)("「%s」の出力は同じ入力から同じになる", (id) => {
    expect(generate(id, 0.7)).toEqual(generate(id, 0.7));
  });

  it("強さ 0 では何も変えない", () => {
    expect(generate("wistful", 0).size).toBe(0);
  });

  it("強さに比例して、しゃくりの深さが変わる", () => {
    // 前の音から続く 2 番目のノート（index 1）で、下がった点の深さを見る
    const dip = (strength: number) => generate("wistful", strength).get(1)?.pitch?.data[1].y;
    expect(dip(1)).toBe(-10);
    expect(dip(0.5)).toBe(-5);
  });

  it("「切なく」はフレーズの終わり（次のノートとの間に隙間がある所・最後のノート）にだけフォールを付ける", () => {
    const edits = generate("wistful", 1);
    const lastY = (index: number) => edits.get(index)?.pitch?.data.at(-1)?.y;
    // A メロのノートはすべて隙間なく続き、最後（index 11）だけがフレーズの終わり
    expect(lastY(11)).toBe(-15);
    expect(lastY(0)).toBe(0);
  });

  it("短いノートのビブラートは変えず、長いノートにだけ付ける", () => {
    const edits = generate("natural", 1);
    // 「そ」は 480 tick（120 BPM の 4 分音符で 500ms）、「く」は 1680 tick（1750ms）
    expect(edits.get(0)?.vibrato).toBeUndefined();
    expect(edits.get(11)?.vibrato).toMatchObject({ length: 50, period: 180, depth: 20 });
  });

  it("強さを下げると、ビブラートの長さと深さも下がる（深さは 5 cent まで）", () => {
    expect(generate("strong", 0.1).get(11)?.vibrato).toMatchObject({ length: 4, depth: 5 });
  });
});

describe("編集差分としての書き出し", () => {
  it.each(ids)("「%s」の結果を書き出して読み込み直すと、差分どおりになる", (id) => {
    const edits = generate(id, 0.8);
    const map = new Map([...edits].map(([index, edit]) => [noteKey(partA.index, index), edit]));
    const reloaded = loadUstx("demo_edited.ustx", exportEdited(loaded, map));
    for (const [index, edit] of edits) {
      const note = reloaded.project.voiceParts[0].notes.find((n) => n.index === index);
      const original = partA.notes.find((n) => n.index === index);
      expect(note?.pitch).toEqual(edit.pitch);
      // ビブラートを変えなかったノートは、元の値のまま
      expect(note?.vibrato).toEqual(edit.vibrato ?? original?.vibrato);
    }
  });
});

describe("フレーズの途中の休符", () => {
  // A メロの 6 番目（「ひ」、index 6）から後ろを 240 tick 遅らせ、「ぶ」（index 5）の後に休符を作る
  const withRest = partA.notes.map((n) =>
    n.index >= 6 ? { ...n, position: n.position + 240 } : n,
  );
  const edits = generatePresetEdits(
    { notes: withRest, targets: allA, partPosition: partA.position, timeAxis },
    "wistful",
    1,
  );

  it("休符の前のノートにフォールを付け、続いているノートには付けない", () => {
    expect(edits.get(5)?.pitch?.data.at(-1)?.y).toBe(-15);
    expect(edits.get(4)?.pitch?.data.at(-1)?.y).toBe(0);
  });

  it("休符の後のノートは、下からしゃくり上げて入る", () => {
    const pitch = edits.get(6)?.pitch;
    expect(pitch?.snap_first).toBe(false);
    expect(pitch?.data[0]).toMatchObject({ x: 0, y: -10 });
  });

  it("前に続くノートがあるノートは、前の音からつながる（snap_first のまま）", () => {
    expect(edits.get(7)?.pitch?.snap_first).toBe(true);
  });
});
