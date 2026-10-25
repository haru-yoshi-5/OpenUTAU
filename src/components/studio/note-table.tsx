import { toneName } from "@/lib/music";
import type { VoicePart } from "@/lib/ustx/load";

/** ピアノロールと同じ内容を表で示す（スクリーンリーダー・数値確認用） */
export function NoteTable({ part }: { part: VoicePart }) {
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        ノート一覧（{part.notes.length} 件）
      </summary>
      <div className="max-h-80 overflow-auto border-t">
        <table className="w-full text-sm">
          <caption className="sr-only">
            パート「{part.name}」のノート一覧
          </caption>
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
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                ビブラート
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {part.notes.map((note, i) => (
              <tr key={note.index} className="border-t">
                <td className="px-3 py-1 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-1">{note.lyric}</td>
                <td className="px-3 py-1">{toneName(note.tone)}</td>
                <td className="px-3 py-1 text-right">{note.position}</td>
                <td className="px-3 py-1 text-right">{note.duration}</td>
                <td className="px-3 py-1 text-right">
                  {note.pitch.data.length}
                </td>
                <td className="px-3 py-1 text-right">
                  {note.vibrato.length > 0 ? `${note.vibrato.length}%` : "なし"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
