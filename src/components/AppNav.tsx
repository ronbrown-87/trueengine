import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

const links = [
  { to: "/", label: "Customer Verification Portal" },
  { to: "/admin", label: "Admin Compliance Dashboard" },
  { to: "/analytics", label: "System Analytics & Security" },
] as const;

export function AppNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <ShieldCheck className="size-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-semibold tracking-tight">
              Veri<span className="text-gradient-tech">Auth</span> AI
            </span>
            <span className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              eKYC Identity Assurance
            </span>
          </span>
        </Link>

        <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 md:mx-0 md:pb-0">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeOptions={{ exact: l.to === "/" }}
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              activeProps={{
                className: "bg-primary/15 text-primary ring-1 ring-primary/30",
              }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
