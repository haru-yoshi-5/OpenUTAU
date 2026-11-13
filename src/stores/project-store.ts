import { create } from "zustand";
import { UstxError } from "../lib/ustx/errors";
import { serializeVerified } from "../lib/ustx/export";
import { LIMITS, type LoadedUstx, loadUstx, validateFileMeta } from "../lib/ustx/load";

/** 読み込み直後に行う、再シリアライズの互換性チェック結果 */
export type RoundTripStatus = { ok: true } | { ok: false; message: string };

export type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; detail?: string }
  | { status: "loaded"; loaded: LoadedUstx; roundTrip: RoundTripStatus };

interface ProjectState {
  load: LoadState;
  /** 表示中の歌声パート（voiceParts の添字） */
  partIndex: number;
  loadBytes: (fileName: string, getBytes: () => Promise<Uint8Array>) => Promise<void>;
  loadFile: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  selectPart: (index: number) => void;
  /** 読み込んだデータを破棄して初期状態に戻す */
  close: () => void;
}

export const SAMPLE_FILE_NAME = "demo.ustx";
const sampleUrl = () => `${import.meta.env?.BASE_URL ?? "/"}samples/${SAMPLE_FILE_NAME}`;

export function checkRoundTrip(loaded: LoadedUstx): RoundTripStatus {
  if (!loaded.exportable) return { ok: false, message: "この形式は書き出し対象外です。" };
  try {
    serializeVerified(loaded);
    return { ok: true };
  } catch (e) {
    const detail = e instanceof UstxError && e.detail ? `（${e.detail}）` : "";
    return {
      ok: false,
      message: `元データとの不一致を検出したため、編集後の書き出しは停止されます${detail}。`,
    };
  }
}

function toErrorState(e: unknown): LoadState {
  if (e instanceof UstxError) return { status: "error", message: e.message, detail: e.detail };
  return { status: "error", message: "ファイルの読み込み中に予期しないエラーが発生しました。" };
}

/** 新しい読み込みが始まったら、それより前の読み込み結果は捨てる */
let latestRequest = 0;

export const useProjectStore = create<ProjectState>()((set, get) => ({
  load: { status: "idle" },
  partIndex: 0,

  loadBytes: async (fileName, getBytes) => {
    const request = ++latestRequest;
    set({ load: { status: "loading" } });
    try {
      const bytes = await getBytes();
      // 「解析しています」の表示を先に描画させてから、重い解析を行う
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (request !== latestRequest) return;
      const loaded = loadUstx(fileName, bytes);
      const roundTrip = checkRoundTrip(loaded);
      if (request !== latestRequest) return;
      set({ load: { status: "loaded", loaded, roundTrip }, partIndex: 0 });
    } catch (e) {
      if (request !== latestRequest) return;
      set({ load: toErrorState(e) });
    }
  },

  loadFile: (file) =>
    get().loadBytes(file.name, async () => {
      // 中身を読む前に、拡張子とサイズを確認する
      validateFileMeta(file.name, file.size);
      return new Uint8Array(await file.arrayBuffer());
    }),

  loadSample: () =>
    get().loadBytes(SAMPLE_FILE_NAME, async () => {
      const res = await fetch(sampleUrl());
      if (!res.ok) {
        throw new UstxError("empty-file", "サンプルファイルを取得できませんでした。");
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > LIMITS.maxFileBytes) {
        throw new UstxError("file-too-large", "サンプルが大きすぎます。");
      }
      return new Uint8Array(buf);
    }),

  selectPart: (index) => {
    const { load } = get();
    if (load.status !== "loaded") return;
    const count = load.loaded.project.voiceParts.length;
    if (!Number.isInteger(index) || index < 0 || index >= count) return;
    set({ partIndex: index });
  },

  close: () => {
    latestRequest++;
    set({ load: { status: "idle" }, partIndex: 0 });
  },
}));
