import { create } from "zustand";
import type { PresetId } from "../lib/tuning/presets";

/** 強さの初期値（%）。効果を確かめやすいよう、少し控えめにする */
export const DEFAULT_STRENGTH = 70;

interface PresetState {
  presetId: PresetId;
  /** 強さ（0〜100%） */
  strength: number;
  /** 候補をピアノロールに重ねて表示しているか */
  previewing: boolean;
  setPreset: (id: PresetId) => void;
  setStrength: (strength: number) => void;
  /** 候補を表示する（採用・却下するまで、選択や設定の変更に合わせて候補を作り直す） */
  startPreview: () => void;
  /** 候補を消す（採用したあと・却下したとき） */
  stopPreview: () => void;
  /** ファイルを読み込み直したとき・破棄したときに、候補を消す（選んだプリセットと強さは残す） */
  reset: () => void;
}

export const usePresetStore = create<PresetState>()((set) => ({
  presetId: "natural",
  strength: DEFAULT_STRENGTH,
  previewing: false,
  setPreset: (presetId) => set({ presetId }),
  setStrength: (strength) =>
    set({ strength: Number.isFinite(strength) ? Math.min(100, Math.max(0, strength)) : 0 }),
  startPreview: () => set({ previewing: true }),
  stopPreview: () => set({ previewing: false }),
  reset: () => set({ previewing: false }),
}));
