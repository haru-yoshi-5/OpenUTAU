import type { Project } from "@/lib/ustx/load";

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
  );
}
