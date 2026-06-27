interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-6 pb-8 border-b border-border">
      <div>
        {eyebrow && (
          <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full gradient-brand shadow-[0_0_8px_2px_oklch(0.66_0.2_285_/_0.6)]" />
            {eyebrow}
          </p>
        )}
        <h1 className="mt-3 text-3xl font-light tracking-tight text-gradient">{title}</h1>
        {description && (
          <p className="mt-2.5 text-sm text-muted-foreground max-w-xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
