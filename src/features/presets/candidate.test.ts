import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { noteKey, type NoteEdit } from "../../lib/ustx/edits";
import { loadUstx } from "../../lib/ustx/load";
import { TimeAxis } from "../../lib/ustx/time-axis";
import { vibratoSchema } from "../../lib/ustx/types";
import { buildPresetChanges, withCandidate } from "./candidate";

const { project } = loadUstx(
  "demo.ustx",
  new Uint8Array(readFileSync(join(process.cwd(), "public/samples/demo.ustx"))),
);
const part = project.voiceParts[0];
const timeAxis = new TimeAxis(project.tempos);

describe("buildPresetChanges", () => {
  it("選んでいなければ候補を作らない", () => {
    expect(buildPresetChanges(part, new Map(), new Set(), timeAxis, "wistful", 1)).toEqual([]);
  });

  it("選んだノートの変更を、パートとノートのキーで返す", () => {
    const changes = buildPresetChanges(part, new Map(), new Set([0, 3]), timeAxis, "wistful", 1);
    expect(changes.map((c) => c.key)).toEqual([noteKey(0, 0), noteKey(0, 3)]);
    expect(changes[0].after?.pitch).toBeDefined();
  });

  it("プリセットが変えない項目は、今の差分のまま残す", () => {
    const vibrato = { ...vibratoSchema.parse({}), length: 33 };
    const current = new Map([[noteKey(0, 0), { vibrato } as NoteEdit]]);
    // 「しゃくり」はピッチ点だけを変え、ビブラートには触れない
    const [change] = buildPresetChanges(part, current, new Set([0]), timeAxis, "scoop", 1);
    expect(change.after?.vibrato).toEqual(vibrato);
    expect(change.after?.pitch).toBeDefined();
  });

  it("「ビブラート」の個別プリセットはピッチ点を変えず、短い音には何もしない", () => {
    const changes = buildPresetChanges(part, new Map(), new Set([0, 11]), timeAxis, "vibrato", 1);
    // 「そ」（500ms）は対象外、「く」（1750ms）にだけ付く
    expect(changes.map((c) => c.key)).toEqual([noteKey(0, 11)]);
    expect(changes[0].after?.pitch).toBeUndefined();
    expect(changes[0].after?.vibrato?.length).toBeGreaterThan(0);
  });

  it("「フォール」の個別プリセットは、選んだすべてのノートの終わりで下げる", () => {
    const changes = buildPresetChanges(part, new Map(), new Set([0, 1]), timeAxis, "fall", 1);
    for (const change of changes) expect(change.after?.pitch?.data.at(-1)?.y).toBe(-15);
  });
});

describe("withCandidate", () => {
  it("候補を今の差分に重ね、候補が無ければ同じ差分を返す", () => {
    const edits = new Map();
    expect(withCandidate(edits, [])).toBe(edits);
    const changes = buildPresetChanges(part, edits, new Set([2]), timeAxis, "strong", 1);
    expect(withCandidate(edits, changes).get(noteKey(0, 2))).toEqual(changes[0].after);
  });
});
