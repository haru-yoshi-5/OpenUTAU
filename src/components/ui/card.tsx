import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** 見出し（h2） */
  title: ReactNode;
  description?: ReactNode;
  /** 見出しの右側に置く操作 */
  action?: ReactNode;
}

export function Card({
  title,
  description,
  action,
  children,
  className = "",
  ...props
}: CardProps) {
  return (
    <section className={`rounded-xl border bg-card shadow-sm ${className}`} {...props}>
      <header className="flex items-start gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      <div className="flex flex-col gap-4 px-4 pt-4 pb-4 sm:px-6 sm:pb-5">{children}</div>
    </section>
  );
}
