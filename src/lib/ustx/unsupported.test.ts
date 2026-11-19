import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { loadUstx } from "./load";
import { detectUnsupported } from "./unsupported";

const demoText = readFileSync(join(process.cwd(), "public/samples/demo.ustx"), "utf8");
const load = (text: string) => loadUstx("a.ustx", new TextEncoder().encode(text)).project;

describe("detectUnsupported", () => {
  it("音声パートと、PITD 以外の値を持つカーブを知らせる", () => {
    const project = load(demoText);
    project.wavePartCount = 2;
    project.voiceParts[0].curves = [
      { abbr: "pitd", xs: [0], ys: [10] },
      { abbr: "dyn", xs: [0, 10], ys: [1, 2] },
      { abbr: "vel", xs: [], ys: [] },
    ];
    project.voiceParts[1].curves = [{ abbr: "clr", xs: [0], ys: [1] }];

    expect(detectUnsupported(project)).toEqual([
      "音声パート 2 個は表示の対象外です。",
      "表現カーブ（clr, dyn）は表示に反映していません。ピッチには PITD のみ反映しています。",
    ]);
  });

  it("対象外のデータが無ければ空", () => {
    const project = load(demoText);
    project.wavePartCount = 0;
    for (const part of project.voiceParts) part.curves = [];
    expect(detectUnsupported(project)).toEqual([]);
  });
});
