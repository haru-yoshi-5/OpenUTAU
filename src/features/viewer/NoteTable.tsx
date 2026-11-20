import { toneName } from "../../lib/music";
import type { Note, VoicePart } from "../../lib/ustx/load";

interface NoteTableProps {
  /** 編集差分を当てたパート */
  part: VoicePart;
  /** 編集差分のあるノートの Note.index */
  editedNotes: ReadonlySet<number>;
  onToggleVibrato: (note: Note, enabled: boolean) => void;
}

/** ピアノロールと同じ内容を表で示す（スクリーンリーダー・数値確認用）。ビブラートのオン・オフもここで切り替えられる */
export function NoteTable({ part, editedNotes, onToggleVibrato }: NoteTableProps) {
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        ノート一覧（{part.notes.length} 件）
      </summary>
      <div className="max-h-80 overflow-auto border-t">
        <table className="w-full text-sm">
          <caption className="sr-only">パート「{part.name}」のノート一覧</caption>
          <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                #
              </th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                歌詞
              </th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                音高
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                位置（tick）
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                長さ（tick）
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                ピッチ点
              </th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                ビブラート
              </th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                状態
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {part.notes.map((note, i) => {
              const edited = editedNotes.has(note.index);
              const vibratoOn = note.vibrato.length > 0;
              return (
                <tr key={note.index} className={`border-t ${edited ? "bg-primary/5" : ""}`}>
                  <td className="px-3 py-1 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-1">{note.lyric}</td>
                  <td className="px-3 py-1">{toneName(note.tone)}</td>
                  <td className="px-3 py-1 text-right">{note.position}</td>
                  <td className="px-3 py-1 text-right">{note.duration}</td>
                  <td className="px-3 py-1 text-right">{note.pitch.data.length}</td>
                  <td className="px-3 py-1">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={vibratoOn}
                        onChange={(e) => onToggleVibrato(note, e.target.checked)}
                        aria-label={`${i + 1} 番目のノート「${note.lyric}」のビブラート`}
                      />
                      {vibratoOn ? `${note.vibrato.length}%` : "なし"}
                    </label>
                  </td>
                  <td className="px-3 py-1 text-xs">
                    {edited ? (
                      <span className="font-medium text-primary">編集済み</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
