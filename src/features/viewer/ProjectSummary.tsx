import type { Project } from "../../lib/ustx/load";

interface ProjectSummaryProps {
  project: Project;
  fileName: string;
}

export function ProjectSummary({ project, fileName }: ProjectSummaryProps) {
  const firstSig = project.timeSignatures[0];
  const items: { label: string; value: string }[] = [
    { label: "ファイル", value: fileName },
    { label: "形式", value: `USTX v${project.version.raw}` },
    {
      label: "テンポ",
      value:
        project.tempos.length > 1
          ? `${project.tempos[0].bpm} BPM ほか ${project.tempos.length - 1} 箇所で変化`
          : `${project.tempos[0].bpm} BPM`,
    },
    {
      label: "拍子",
      value: `${firstSig.beat_per_bar}/${firstSig.beat_unit}${project.timeSignatures.length > 1 ? " ほか" : ""}`,
    },
    { label: "トラック", value: `${project.tracks.length}` },
    {
      label: "パート",
      value: `歌声 ${project.voiceParts.length}${project.wavePartCount > 0 ? ` / 音声 ${project.wavePartCount}` : ""}`,
    },
    { label: "ノート", value: `${project.noteCount}` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="truncate font-medium" title={item.value}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {project.tracks.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm whitespace-nowrap">
            <caption className="sr-only">トラック一覧</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  #
                </th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  トラック名
                </th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  歌声ライブラリ
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  歌声パート
                </th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  状態
                </th>
              </tr>
            </thead>
            <tbody>
              {project.tracks.map((track, i) => (
                // トラックは並び順（track_no）で識別する
                // oxlint-disable-next-line react/no-array-index-key
                <tr key={i} className="border-t">
                  <td className="px-3 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="max-w-48 truncate px-3 py-1">{track.name}</td>
                  <td className="max-w-48 truncate px-3 py-1">
                    {track.singer ?? <span className="text-muted-foreground">未指定</span>}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {project.voiceParts.filter((p) => p.trackNo === i).length}
                  </td>
                  <td className="px-3 py-1">{track.mute ? "ミュート" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
