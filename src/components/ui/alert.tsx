import { AlertTriangle, CircleX, Info } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "error" | "warning" | "info";

const styles: Record<Tone, { box: string; icon: ReactNode }> = {
  error: {
    box: "border-destructive/40 bg-destructive/5 [&_h3]:text-destructive",
    icon: <CircleX aria-hidden className="size-4 text-destructive" />,
  },
  warning: {
    box: "border-warning/40 bg-warning/5",
    icon: <AlertTriangle aria-hidden className="size-4 text-warning" />,
  },
  info: {
    box: "bg-muted/50",
    icon: <Info aria-hidden className="size-4 text-muted-foreground" />,
  },
};

interface AlertProps {
  tone: Tone;
  title: string;
  children: ReactNode;
}

export function Alert({ tone, title, children }: AlertProps) {
  const { box, icon } = styles[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-2.5 rounded-lg border px-4 py-3 text-sm ${box}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium">{title}</h3>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
