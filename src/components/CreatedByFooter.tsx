import { useEffect, useState } from "react";
import { Sparkles, Phone, X } from "lucide-react";

export function CreatedByFooter() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <footer className="mt-auto flex flex-col items-center gap-3 border-t border-border/70 py-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-gradient-to-r from-primary/15 via-accent/15 to-primary/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary shadow-glow transition-all hover:border-primary/70 hover:shadow-[0_0_24px_-6px_color-mix(in_oklab,var(--primary)_60%,transparent)] active:scale-95"
      >
        <Sparkles className="size-3.5 transition-transform group-hover:rotate-12" />
        Created by
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="panel relative w-full max-w-sm p-6 text-center shadow-glow"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" />
            </button>

            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Created by
            </p>
            <p className="mt-2 bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-2xl font-bold tracking-tight text-transparent">
              THANDIWE NYIRONGO
            </p>

            <a
              href="tel:0976902839"
              className="pulse-ring mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-success px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-success-foreground transition-transform hover:scale-105 active:scale-95"
            >
              <Phone className="size-4" />
              Call now 0976902839
            </a>
          </div>
        </div>
      )}
    </footer>
  );
}
