import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useProjectStore } from "./project-store";

const demoBytes = new Uint8Array(readFileSync(join(process.cwd(), "public/samples/demo.ustx")));

const store = useProjectStore;

describe("useProjectStore", () => {
  beforeEach(() => store.getState().close());

  it("読み込みに成功すると loaded になり、互換性チェックが通る", async () => {
    await store.getState().loadBytes("demo.ustx", async () => demoBytes);
    const { load, partIndex } = store.getState();
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.loaded.project.voiceParts).toHaveLength(2);
    expect(load.roundTrip).toEqual({ ok: true });
    expect(partIndex).toBe(0);
  });

  it("読み込み中は loading になる", () => {
    const pending = store.getState().loadBytes("demo.ustx", async () => demoBytes);
    expect(store.getState().load.status).toBe("loading");
    return pending;
  });

  it("不正なファイルはエラーメッセージ付きの error になる", async () => {
    await store
      .getState()
      .loadBytes("bad.ustx", async () => new TextEncoder().encode("foo: bar\n"));
    expect(store.getState().load).toMatchObject({
      status: "error",
      message: expect.stringContaining("USTX ファイルではない"),
    });
  });

  it("想定外の例外は汎用メッセージにする", async () => {
    await store.getState().loadBytes("demo.ustx", async () => {
      throw new TypeError("network");
    });
    expect(store.getState().load).toEqual({
      status: "error",
      message: "ファイルの読み込み中に予期しないエラーが発生しました。",
    });
  });

  it("後から始めた読み込みが優先され、先に始めた読み込みの結果は捨てる", async () => {
    let resolveFirst: (bytes: Uint8Array) => void = () => {};
    const first = store
      .getState()
      .loadBytes("first.ustx", () => new Promise((resolve) => (resolveFirst = resolve)));
    const second = store
      .getState()
      .loadBytes("bad.ustx", async () => new TextEncoder().encode("foo: bar\n"));
    await second;
    resolveFirst(demoBytes);
    await first;
    expect(store.getState().load.status).toBe("error");
  });

  it("selectPart は範囲内の添字だけを受け付ける", async () => {
    await store.getState().loadBytes("demo.ustx", async () => demoBytes);
    store.getState().selectPart(1);
    expect(store.getState().partIndex).toBe(1);
    store.getState().selectPart(2);
    store.getState().selectPart(-1);
    store.getState().selectPart(0.5);
    expect(store.getState().partIndex).toBe(1);
  });

  it("close で初期状態に戻り、読み込み中の結果も反映しない", async () => {
    const pending = store.getState().loadBytes("demo.ustx", async () => demoBytes);
    store.getState().close();
    await pending;
    expect(store.getState().load).toEqual({ status: "idle" });
  });
});
