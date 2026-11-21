import { describe, expect, it } from "vite-plus/test";
import { partEndTick } from "./part";

const notes = (...ends: [number, number][]) =>
  ends.map(([position, duration]) => ({ position, duration }));

describe("partEndTick", () => {
  it("パートの長さと、最後に終わるノートの終わりの遅い方を返す", () => {
    expect(partEndTick({ duration: 1920, notes: notes([0, 480], [480, 480]) } as never)).toBe(1920);
    expect(partEndTick({ duration: 960, notes: notes([0, 480], [960, 960]) } as never)).toBe(1920);
  });

  it("ノートが無ければパートの長さを返す", () => {
    expect(partEndTick({ duration: 7680, notes: [] })).toBe(7680);
  });
});
