import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Eye,
  LogOut,
  ShieldAlert,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

type Row = Tables<"verifications">;

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin Compliance Dashboard — VeriAuth AI" },
      {
        name: "description",
        content:
          "Review flagged verifications, inspect duplicate identity matches and track the immutable audit log.",
      },
      { property: "og:title", content: "Admin Compliance Dashboard — VeriAuth AI" },
      {
        property: "og:description",
        content: "Queue triage, duplicate comparison and compliance audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admin,
});

function Admin() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useQuery({ queryKey: ["admin-role"], queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { isAdmin: false };
      const { data, error } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      return { isAdmin: !error && data === true };
    },
  });
  const isAdmin = role.data?.isAdmin === true;

  const rowsQ = useQuery({
    queryKey: ["verifications"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("verifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const auditQ = useQuery({
    queryKey: ["audit"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!isAdmin) return;
    const t = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["verifications"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    }, 15000);
    return () => clearInterval(t);
  }, [isAdmin, qc]);

  const rows = rowsQ.data ?? [];
  const [selected, setSelected] = useState<Row | null>(null);

  const stats = useMemo(
    () => [
      { label: "Total Verifications", value: rows.length, icon: Users, tone: "text-primary" },
      { label: "Approved", value: rows.filter((r) => r.status === "Approved").length, icon: CheckCircle2, tone: "text-success" },
      { label: "Awaiting Review", value: rows.filter((r) => r.status === "Pending").length, icon: ClipboardList, tone: "text-warning" },
      { label: "Flagged Duplicates", value: rows.filter((r) => r.duplicate === "Flagged").length, icon: ShieldAlert, tone: "text-destructive" },
    ],
    [rows],
  );

  const act = async (row: Row, status: "Approved" | "Rejected", reason: string) => {
    const { error } = await supabase.rpc("review_verification", {
      _id: row.id,
      _status: status,
      _reason: reason || "",
    });
    if (error) {
      toast.error("Could not update case", { description: error.message });
      return;
    }
    toast.success(`Case ${row.case_code} ${status.toLowerCase()}`);
    setSelected(null);
    void qc.invalidateQueries({ queryKey: ["verifications"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    qc.clear();
    navigate({ to: "/auth" });
  };

  if (role.isLoading) {
    return <main className="mx-auto max-w-7xl px-4 py-16 text-sm text-muted-foreground">Checking access…</main>;
  }
  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <ShieldAlert className="mx-auto size-10 text-destructive" />
        <h1 className="mt-3 text-xl font-semibold">Access restricted</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account is not an administrator. Ask an existing administrator to grant you access.
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => void signOut()}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Admin Compliance Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live verification queue, duplicate identity matches and audit history.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="panel p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">{s.label}</span>
                <Icon className={`size-4 ${s.tone}`} />
              </div>
              <p className={`mt-2 text-3xl font-semibold ${s.tone}`}>{s.value}</p>
            </motion.div>
          );
        })}
      </div>

      <Card className="panel mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recent verifications</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {rowsQ.isLoading ? "Loading…" : "No verifications yet. Complete one on the Customer Verification Portal."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Doc Type</TableHead>
                  <TableHead>Trust Score</TableHead>
                  <TableHead>Liveness</TableHead>
                  <TableHead>Duplicate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer ${r.duplicate === "Flagged" ? "bg-destructive/5" : ""}`}
                    onClick={() => setSelected(r)}
                  >
                    <TableCell className="font-mono text-xs">{r.case_code}</TableCell>
                    <TableCell className="font-medium">{r.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.doc_type}</TableCell>
                    <TableCell>
                      <span className={r.trust_score >= 85 ? "text-success" : r.trust_score >= 40 ? "text-warning" : "text-destructive"}>
                        {r.trust_score}/100
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={r.liveness} tone={r.liveness === "Passed" ? "success" : r.liveness === "Review" ? "warning" : "destructive"} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={r.duplicate} tone={r.duplicate === "Flagged" ? "destructive" : "success"} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={r.status} tone={r.status === "Approved" ? "success" : r.status === "Pending" ? "warning" : "destructive"} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>
                        <Eye className="size-4" /> Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="panel mt-6">
        <CardHeader>
          <CardTitle className="text-base">Immutable audit log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(auditQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
          {(auditQ.data ?? []).map((a) => (
            <div key={a.id} className="flex flex-wrap gap-x-3 text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(a.created_at).toLocaleString()}
              </span>
              <span className="font-mono text-xs text-primary">{a.actor}</span>
              {a.case_code && <span className="font-mono text-xs">{a.case_code}</span>}
              <span className="text-muted-foreground">{a.event}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <ReviewDialog row={selected} rows={rows} onClose={() => setSelected(null)} onAct={act} />
    </main>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "destructive" }) {
  const cls =
    tone === "success"
      ? "bg-success/15 text-success ring-success/30 hover:bg-success/15"
      : tone === "warning"
        ? "bg-warning/15 text-warning ring-warning/30 hover:bg-warning/15"
        : "bg-destructive/15 text-destructive ring-destructive/30 hover:bg-destructive/15";
  return <Badge className={`${cls} ring-1`}>{label}</Badge>;
}

function useSignedUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["media", path],
    enabled: !!path,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.storage.from("kyc-media").createSignedUrl(path!, 600);
      return data?.signedUrl ?? null;
    },
  });
}

function ReviewDialog({
  row,
  rows,
  onClose,
  onAct,
}: {
  row: Row | null;
  rows: Row[];
  onClose: () => void;
  onAct: (row: Row, status: "Approved" | "Rejected", reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const match = row?.match_case_code ? rows.find((r) => r.case_code === row.match_case_code) : undefined;
  const doc = useSignedUrl(row?.document_path);
  const selfie = useSignedUrl(row?.selfie_path);
  const matchSelfie = useSignedUrl(match?.selfie_path ?? match?.document_path);

  useEffect(() => setReason(""), [row?.id]);

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {row.duplicate === "Flagged" && <AlertTriangle className="size-5 text-destructive" />}
                Case {row.case_code} — {row.full_name}
              </DialogTitle>
              <DialogDescription>
                {row.doc_type} {row.doc_number ?? ""} · DOB {row.date_of_birth ?? "—"} · Expires {row.expiry_date ?? "—"}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <MediaBox label="ID document" url={doc.data} />
              <MediaBox label="Live selfie" url={selfie.data} />
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Info k="Trust score" v={`${row.trust_score}/100`} />
              <Info k="ID authenticity" v={row.authenticity} />
              <Info k="Face match" v={row.face_match != null ? `${Math.round(Number(row.face_match))}%` : "—"} />
              <Info k="Liveness" v={row.liveness} />
              <Info k="Status" v={row.status} />
              <Info k="Processing time" v={row.processing_ms ? `${(row.processing_ms / 1000).toFixed(1)}s` : "—"} />
            </div>
            {row.ai_notes && <p className="text-xs text-muted-foreground">AI note: {row.ai_notes}</p>}

            {row.duplicate === "Flagged" && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                <p className="font-semibold text-destructive">
                  {row.match_similarity}% identity match with {row.match_case_code}
                </p>
                {match && (
                  <div className="mt-3 flex items-center gap-3">
                    {matchSelfie.data && <img src={matchSelfie.data} alt="Existing record" className="size-16 rounded-lg object-cover" />}
                    <div className="text-sm">
                      <p className="font-medium">{match.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Enrolled {new Date(match.created_at).toLocaleDateString()} · {match.status}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Separator />
            <Input placeholder="Reason (saved to the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="destructive" onClick={() => void onAct(row, "Rejected", reason || (row.duplicate === "Flagged" ? "Blocked — suspected duplicate" : ""))}>
                <ShieldAlert className="size-4" /> {row.duplicate === "Flagged" ? "Block & Flag Fraud" : "Reject"}
              </Button>
              <Button
                onClick={() => {
                  if (row.duplicate === "Flagged" && !reason.trim()) {
                    toast.error("Enter a reason to override a duplicate flag");
                    return;
                  }
                  void onAct(row, "Approved", reason);
                }}
              >
                {row.duplicate === "Flagged" ? "Approve Override with Reason" : "Approve"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MediaBox({ label, url }: { label: string; url: string | null | undefined }) {
  return (
    <div className="panel overflow-hidden">
      <p className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      {url ? (
        <img src={url} alt={label} className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center text-xs text-muted-foreground">Not provided</div>
      )}
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
