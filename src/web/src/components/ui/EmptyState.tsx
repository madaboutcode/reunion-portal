import type { ReactNode } from "react";

export interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ message, icon, className }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-12 px-4${className ? ` ${className}` : ""}`}
    >
      {icon && (
        <div className="text-muted/40 mb-3">{icon}</div>
      )}
      <p className="text-sm text-muted text-center">{message}</p>
    </div>
  );
}
