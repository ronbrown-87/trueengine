import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useCamera } from "@/hooks/use-camera";
import { toJpegDataUrl } from "@/lib/image";
import {
  analyzeDocument,
  scoreVerification,
  submitVerification,
  type OcrResult,
} from "@/lib/kyc.functions";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  Fingerprint,
  FileCheck2,
  Lock,
  Loader2,
  ScanFace,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRoundCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Customer Verification Portal — VeriAuth AI" },
      {
        name: "description",
        content:
          "Complete consent, document scanning, biometric liveness and duplicate checks in a guided four-step eKYC flow.",
      },
      { property: "og:title", content: "Customer Verification Portal — VeriAuth AI" },
      {
        property: "og:description",
        content: "Guided eKYC onboarding: consent, document OCR, liveness and trust scoring.",
      },
    ],
  }),
  component: Portal,
});

const steps = [
  { title: "Consent & Privacy", icon: Lock },
  { title: "Document & OCR", icon: ScanLine },
  { title: "Liveness Check", icon: Camera },
  { title: "Result & Audit", icon: BadgeCheck },
];

const consents = [
  {
    key: "doc",
    label: "Document scanning",
    detail: "Allow optical capture and MRZ/OCR parsing of my identity document.",
  },
  {
    key: "bio",
    label: "Biometric processing",
    detail: "Allow facial template extraction for liveness and match verification.",
  },
  {
    key: "retention",
    label: "Data retention policy",
    detail: "Your ID images, selfie and face data are stored securely for compliance review and handled under our retention policy.",
  },
] as const;

const emptyCapture: Captured = {
  doc: null,
  selfie: null,
  selfieDescriptor: null,
  liveness: { completed: false, challenges: [] },
};

function Portal() {
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [captured, setCaptured] = useState<Captured>(emptyCapture);
  const allAccepted = consents.every((c) => accepted[c.key]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <div className="mb-8">
        <Badge className="mb-3 bg-primary/15 text-primary ring-1 ring-primary/30 hover:bg-primary/15">
          <Sparkles className="mr-1 size-3.5" /> AI-assisted onboarding
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Customer Verification Portal
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Four guided steps: consent, document capture, liveness challenge and your verification
          outcome. Your ID is read by AI and your selfie is matched to your ID photo.
        </p>
      </div>

      <Stepper step={step} />

      <div className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            {step === 0 && (
              <ConsentStep
                accepted={accepted}
                setAccepted={setAccepted}
                allAccepted={allAccepted}
                onNext={() => setStep(1)}
              />
            )}
            {step === 1 && (
              <DocumentStep
                onBack={() => setStep(0)}
                onNext={(doc) => {
                  setCaptured((c) => ({ ...c, doc }));
                  setStep(2);
                }}
              />
            )}
            {step === 2 && (
              <LivenessStep
                onBack={() => setStep(1)}
                onNext={(live) => {
                  setCaptured((c) => ({ ...c, ...live }));
                  setStep(3);
                }}
              />
            )}
            {step === 3 && (
              <ResultStep
                data={captured}
                consent={accepted}
                onRestart={() => {
                  setCaptured(emptyCapture);
                  setAccepted({});
                  setStep(0);
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-4">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const state = i < step ? "done" : i === step ? "active" : "todo";
        return (
          <li
            key={s.title}
            className={`panel flex items-center gap-3 p-3 transition-colors ${
              state === "active" ? "ring-1 ring-primary/50" : ""
            }`}
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                state === "done"
                  ? "bg-success/20 text-success"
                  : state === "active"
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary text-muted-foreground"
              }`}
            >
              {state === "done" ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
                Step {i + 1}
              </span>
              <span className="block truncate text-sm font-medium">{s.title}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ConsentStep({
  accepted,
  setAccepted,
  allAccepted,
  onNext,
}: {
  accepted: Record<string, boolean>;
  setAccepted: (v: Record<string, boolean>) => void;
  allAccepted: boolean;
  onNext: () => void;
}) {
  const [showPolicy, setShowPolicy] = useState(false);

  return (
    <Card className="panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-5 text-primary" /> Consent & Privacy Agreement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl border border-success/30 bg-success/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-6 text-success" />
              <div>
                <p className="text-sm font-semibold text-success">Zero-Trust Privacy Guarantee</p>
                <p className="text-xs text-muted-foreground">
                  Encrypted in transit and at rest. No data sold, ever.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              View data handling policy
              <Switch checked={showPolicy} onCheckedChange={setShowPolicy} />
            </label>
          </div>
          <AnimatePresence initial={false}>
            {showPolicy && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-3 space-y-1.5 overflow-hidden text-xs text-muted-foreground"
              >
                <li>• Media encrypted with AES-256-GCM; keys rotated every 24 hours.</li>
                <li>• Biometric templates stored as irreversible vector hashes only.</li>
                <li>• Raw document and selfie media auto-purged after 30 days.</li>
                <li>• Every access is written to an immutable audit log.</li>
                <li>• You may request deletion at any time via the data portal.</li>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-3">
          {consents.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2/40 p-4 transition-colors hover:border-primary/40"
            >
              <Checkbox
                checked={!!accepted[c.key]}
                onCheckedChange={(v) => setAccepted({ ...accepted, [c.key]: !!v })}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.detail}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {allAccepted ? "All consents granted." : "Accept all three consents to continue."}
          </p>
          <Button disabled={!allAccepted} onClick={onNext}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type Fields = {
  fullName: string;
  documentNumber: string;
  dateOfBirth: string;
  gender: string;
  expiryDate: string;
  dateOfIssue: string;
  placeOfIssue: string;
  documentType: string;
};
type OcrFlags = { tamperingSuspected: boolean; isIdentityDocument: boolean; confidence: number };
type DocCapture = {
  front: string;
  back: string | null;
  fields: Fields;
  ocr: OcrFlags;
  idDescriptor: number[] | null;
};
type ChallengeLog = { id: string; passed: boolean; ms: number };
export type Captured = {
  doc: DocCapture | null;
  selfie: string | null;
  selfieDescriptor: number[] | null;
  liveness: { completed: boolean; challenges: ChallengeLog[] };
};

const fieldLabels: { key: keyof Fields; label: string; side: "Front" | "Back" | "Front/Back" }[] = [
  { key: "fullName", label: "Full Name", side: "Front" },
  { key: "documentNumber", label: "Document / NRC Number", side: "Front/Back" },
  { key: "dateOfBirth", label: "Date of Birth", side: "Front" },
  { key: "gender", label: "Gender", side: "Front/Back" },
  { key: "dateOfIssue", label: "Date of Issue", side: "Back" },
  { key: "placeOfIssue", label: "Place of Issue", side: "Back" },
  { key: "expiryDate", label: "Expiry Date", side: "Front/Back" },
  { key: "documentType", label: "Document Type", side: "Front" },
];

const emptyFields: Fields = {
  fullName: "", documentNumber: "", dateOfBirth: "", gender: "", expiryDate: "",
  dateOfIssue: "", placeOfIssue: "", documentType: "",
};

async function readSide(
  analyze: (a: { data: { image: string; side: "front" | "back" } }) => Promise<
    { ok: true; result: OcrResult } | { ok: false; error: string }
  >,
  image: string,
  side: "front" | "back",
): Promise<{ r: OcrResult | null; engine: "ai" | "device" | "none" }> {
  try {
    const res = await analyze({ data: { image, side } });
    if (res.ok) return { r: res.result, engine: "ai" };
    console.warn("AI reader unavailable, using on-device reader:", res.error);
  } catch (e) {
    console.warn("AI reader unreachable, using on-device reader", e);
  }
  try {
    const { browserOcr } = await import("@/lib/ocr-fallback");
    return { r: await browserOcr(image), engine: "device" };
  } catch (e) {
    console.warn("On-device reader failed", e);
    return { r: null, engine: "none" };
  }
}

function DocumentStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: (doc: DocCapture) => void;
}) {
  const analyze = useServerFn(analyzeDocument);
  const [side, setSide] = useState<"front" | "back">("front");
  const [images, setImages] = useState<{ front: string | null; back: string | null }>({ front: null, back: null });
  const [busy, setBusy] = useState<"front" | "back" | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [engine, setEngine] = useState<string | null>(null);
  const [idDescriptor, setIdDescriptor] = useState<number[] | null>(null);
  const [faceStatus, setFaceStatus] = useState<"idle" | "checking" | "found" | "missing">("idle");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cam = useCamera("environment");

  const merge = (r: OcrResult, overwrite: boolean) =>
    setFields((f) => {
      const next = { ...f };
      for (const k of Object.keys(emptyFields) as (keyof Fields)[]) {
        const v = (r[k as keyof OcrResult] as string | undefined) ?? "";
        if (k === "documentType" && v === "Other") continue;
        if (v && (overwrite || !next[k])) next[k] = v;
      }
      return next;
    });

  const scan = async (src: string, which: "front" | "back") => {
    setBusy(which);
    try {
      let jpeg: string;
      try {
        jpeg = await toJpegDataUrl(src);
      } catch {
        toast.error("We couldn't open that image. Please try another photo.");
        return;
      }
      setImages((i) => ({ ...i, [which]: jpeg }));

      if (which === "front") {
        setFaceStatus("checking");
        void import("@/lib/face")
          .then(({ descriptorFromImage }) => descriptorFromImage(jpeg))
          .then((d) => {
            setIdDescriptor(d ? Array.from(d) : null);
            setFaceStatus(d ? "found" : "missing");
          })
          .catch((e) => {
            console.warn("ID face extraction failed", e);
            setFaceStatus("missing");
          });
      }

      const { r, engine: used } = await readSide(analyze, jpeg, which);
      if (!r) {
        toast.message("Automatic reading wasn't possible", { description: "Please type in your details." });
        return;
      }
      merge(r, which === "front");
      if (which === "front") {
        setOcr(r);
        setEngine(used === "ai" ? "AI reader" : "On-device reader");
        if (!r.isIdentityDocument) toast.warning("This doesn't look like an ID document");
        else toast.success("Front side read", { description: r.notes });
        setSide("back");
      } else {
        setOcr((o) => (o ? { ...o, mrzOrBarcodePresent: o.mrzOrBarcodePresent || r.mrzOrBarcodePresent } : r));
        toast.success("Back side read");
      }
    } catch (e) {
      console.error(e);
      toast.error("Something went wrong reading the card. You can type the details in.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = (file?: File | null) => {
    if (!file) return;
    cam.stop();
    const which = side;
    const reader = new FileReader();
    reader.onload = () => void scan(String(reader.result), which);
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsDataURL(file);
  };

  const takePhoto = () => {
    const shot = cam.capture();
    if (!shot) return;
    cam.stop();
    void scan(shot, side);
  };

  const current = images[side];
  const good = "bg-success/15 text-success ring-1 ring-success/30 hover:bg-success/15";
  const bad = "bg-warning/15 text-warning ring-1 ring-warning/30 hover:bg-warning/15";
  const canContinue = !!images.front && !!fields.fullName.trim() && !busy;

  return (
    <Card className="panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="size-5 text-primary" /> ID Card Capture — Front & Back
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {(["front", "back"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  cam.stop();
                  setSide(s);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  side === s ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface-2/40 text-muted-foreground"
                }`}
              >
                {images[s] ? <CheckCircle2 className="size-4 text-success" /> : <ScanLine className="size-4" />}
                {s === "front" ? "Front side" : "Back side"}
              </button>
            ))}
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files[0]);
            }}
            className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-primary/35 bg-surface-2/40"
          >
            {cam.active && (
              <video ref={cam.videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
            )}
            {!cam.active && current && (
              <img src={current} alt={`ID ${side} side`} className="absolute inset-0 size-full object-cover opacity-85" />
            )}
            <div className="pointer-events-none absolute inset-4 rounded-lg border border-scanner/40" />
            {busy === side && (
              <>
                <div className="scanline absolute inset-x-6 h-0.5 bg-scanner shadow-[0_0_18px_2px_var(--scanner)]" />
                <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_10px,color-mix(in_oklab,var(--scanner)_9%,transparent)_11px)]" />
              </>
            )}
            {!cam.active && !current && (
              <div className="relative z-10 px-6 text-center">
                <Upload className="mx-auto size-10 text-primary" />
                <p className="mt-2 text-sm font-medium">
                  {side === "front" ? "Front of your NRC, ID or licence" : "Back of your card"}
                </p>
                <p className="text-xs text-muted-foreground">Drag & drop, upload or use the camera</p>
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <Upload className="size-4" /> Upload {side}
            </Button>
            {cam.active ? (
              <>
                <Button onClick={takePhoto}>
                  <Camera className="size-4" /> Capture {side}
                </Button>
                <Button variant="ghost" onClick={cam.stop}>Cancel</Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => void cam.start()} disabled={!!busy}>
                <Camera className="size-4" /> Capture {side}
              </Button>
            )}
          </div>
          {busy && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Reading the {busy} side…
            </p>
          )}
        </div>

        <div className="space-y-3">
          {ocr && (
            <div className="flex flex-wrap gap-2">
              <Badge className={good}>Text extraction: Complete</Badge>
              <Badge className={ocr.mrzOrBarcodePresent ? good : bad}>
                MRZ / Barcode: {ocr.mrzOrBarcodePresent ? "Found" : "Not found"}
              </Badge>
              <Badge className={ocr.tamperingSuspected ? bad : good}>
                Tampering: {ocr.tamperingSuspected ? "Suspected" : "Clear"}
              </Badge>
              <Badge className={faceStatus === "found" ? good : bad}>
                ID photo face:{" "}
                {faceStatus === "checking" ? "Checking…" : faceStatus === "found" ? "Extracted" : "Not found"}
              </Badge>
              {engine && <Badge variant="outline">{engine}</Badge>}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {fieldLabels.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="flex justify-between text-xs text-muted-foreground">
                  <span>{f.label}</span>
                  <span className="font-mono text-[10px] opacity-70">{f.side}</span>
                </Label>
                <Input
                  value={fields[f.key]}
                  placeholder={f.key.startsWith("date") || f.key === "expiryDate" ? "YYYY-MM-DD" : ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Details fill in automatically after each scan. Check them and correct anything that is wrong.
          </p>

          <div className="flex justify-between gap-3 pt-1">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button
              disabled={!canContinue}
              onClick={() => {
                if (!images.front) return;
                if (!images.back) toast.message("Continuing without the back side");
                onNext({
                  front: images.front,
                  back: images.back,
                  fields,
                  ocr: {
                    tamperingSuspected: ocr?.tamperingSuspected ?? false,
                    isIdentityDocument: ocr?.isIdentityDocument ?? true,
                    confidence: ocr?.confidence ?? 50,
                  },
                  idDescriptor,
                });
              }}
            >
              Confirm & continue
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type ChallengeId = "smile" | "left" | "right" | "blink";
type Challenge = { id: ChallengeId; label: string; hint: string };

const ALL_CHALLENGES: Challenge[] = [
  { id: "smile", label: "Smile at the camera", hint: "Give a clear, wide smile and hold it." },
  { id: "left", label: "Turn your head to the left", hint: "Slowly turn your head to YOUR left and hold it." },
  { id: "right", label: "Turn your head to the right", hint: "Slowly turn your head to YOUR right and hold it." },
  { id: "blink", label: "Blink twice", hint: "Face the camera and blink slowly, twice." },
];

// Random order each attempt, so a pre-recorded clip can't simply be replayed.
function shuffleChallenges(): Challenge[] {
  const a = [...ALL_CHALLENGES];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

// Liveness tuning. Gestures are held for a real amount of TIME, so results don't depend on device speed.
const HOLD_MS = 350; // a smile / head turn must be held this long
const NEUTRAL_MS = 600; // neutral face before the selfie is taken
const STEP_TIMEOUT_MS = 15000; // per attempt at a gesture
const MAX_ATTEMPTS = 3; // attempts per gesture before the whole check fails
const TURN_YAW = 0.3; // how far the head must turn from the neutral pose
const SMILE_MIN = 0.8;
const FACE_LOST_MS = 1500;

type Live = { score: number; yaw: number; ear: number; smile: number } | null;

function LivenessStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: (live: Pick<Captured, "selfie" | "selfieDescriptor" | "liveness">) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "done" | "failed" | "nocam">("idle");
  const [seq, setSeq] = useState<Challenge[]>(ALL_CHALLENGES);
  const [index, setIndex] = useState(-1); // -1 = capturing the neutral selfie
  const [log, setLog] = useState<ChallengeLog[]>([]);
  const [live, setLive] = useState<Live>(null);
  const [blinks, setBlinks] = useState(0);
  const [hint, setHint] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [selfieDescriptor, setSelfieDescriptor] = useState<number[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef(false);
  const runIdRef = useRef(0);
  const cam = useCamera("user");

  useEffect(
    () => () => {
      runRef.current = false;
      runIdRef.current += 1;
    },
    [],
  );

  const loop = async (sequence: Challenge[], runId: number) => {
    const { analyzeVideoFrame } = await import("@/lib/face");
    const active = () => runRef.current && runIdRef.current === runId;

    let step = -1;
    let stepStart = performance.now();
    let prevT = stepStart;
    let attempts = 0;
    let armed = false; // each gesture must start from a neutral pose
    let heldSince: number | null = null;
    let eyesClosed = false;
    let closedAt = 0;
    let blinkCount = 0;
    let lastSeen = stepStart;
    let lastIdCheck = 0;
    let mismatches = 0;
    let baseYaw = 0;
    let earOpen = 0; // this person's normal "eyes open" ratio
    let sYaw = 0;
    let sSmile = 0;
    let first = true;
    let ref: Float32Array | null = null;
    const results: ChallengeLog[] = [];

    const resetProgress = () => {
      heldSince = null;
      eyesClosed = false;
      blinkCount = 0;
      armed = false;
      setBlinks(0);
    };
    const restartFromSelfie = () => {
      step = -1;
      ref = null;
      results.length = 0;
      attempts = 0;
      mismatches = 0;
      stepStart = performance.now();
      resetProgress();
      setSelfie(null);
      setSelfieDescriptor(null);
      setLog([]);
      setHint("");
      setIndex(-1);
    };
    const pass = (now: number) => {
      results.push({ id: sequence[step]!.id, passed: true, ms: Math.round(now - stepStart) });
      setLog([...results]);
      setHint("");
      step += 1;
      attempts = 0;
      stepStart = now;
      resetProgress();
      setIndex(step);
    };

    while (active()) {
      const v = cam.videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const now = performance.now();

      // The slow face fingerprint is only computed when needed: for the selfie, and ~1x/second to confirm it is still the same person.
      const nearFront = Math.abs(sYaw - baseYaw) < 0.2;
      const wantSelfie = step === -1 && heldSince !== null && now - heldSince >= NEUTRAL_MS;
      const wantIdCheck = step >= 0 && ref !== null && nearFront && now - lastIdCheck > 1000;
      let f: Awaited<ReturnType<typeof analyzeVideoFrame>> = null;
      try {
        f = await analyzeVideoFrame(v, { descriptor: wantSelfie || wantIdCheck });
      } catch (e) {
        console.warn("Frame analysis failed", e);
      }
      if (!active()) return;
      const t = performance.now();

      const c = canvasRef.current;
      if (c) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, c.width, c.height);
          if (f) {
            ctx.lineWidth = Math.max(2, c.width / 320);
            ctx.strokeStyle = f.score > 0.7 ? "#34d399" : "#fbbf24";
            ctx.strokeRect(f.box.x, f.box.y, f.box.width, f.box.height);
          }
        }
      }

      if (f && f.score > 0.5) {
        lastSeen = t;
        if (first) {
          sYaw = f.yaw;
          sSmile = f.smile;
          baseYaw = f.yaw;
          first = false;
        } else {
          sYaw = sYaw * 0.5 + f.yaw * 0.5;
          sSmile = sSmile * 0.5 + f.smile * 0.5;
        }
        const rel = sYaw - baseYaw;
        setLive({ score: f.score, yaw: rel, ear: f.ear, smile: sSmile });

        // Learn this person's normal open-eye ratio while the eyes look open.
        if (!eyesClosed && (earOpen === 0 || f.ear > earOpen * 0.85)) {
          earOpen = earOpen === 0 ? f.ear : earOpen * 0.9 + f.ear * 0.1;
        }

        // Same person throughout? (compared while facing the camera, so head turns don't cause false alarms)
        if (step >= 0 && ref && f.descriptor) {
          lastIdCheck = t;
          let sq = 0;
          for (let i = 0; i < f.descriptor.length; i++) sq += (f.descriptor[i]! - ref[i]!) ** 2;
          if (Math.sqrt(sq) > 0.7) mismatches += 1;
          else mismatches = 0;
          if (mismatches >= 3) {
            toast.error("A different face was detected", { description: "Please start again with the same person in view." });
            restartFromSelfie();
            continue;
          }
        }

        if (step === -1) {
          const neutral = Math.abs(sYaw) < 0.12 && f.score > 0.6 && sSmile < 0.5;
          if (!neutral) heldSince = null;
          else if (heldSince === null) heldSince = t;
          else if (wantSelfie && f.descriptor) {
            const shot = cam.capture();
            if (shot) {
              const jpeg = await toJpegDataUrl(shot, 1024).catch(() => shot);
              setSelfie(jpeg);
              setSelfieDescriptor(Array.from(f.descriptor));
              ref = f.descriptor;
              baseYaw = sYaw;
              step = 0;
              stepStart = performance.now();
              lastIdCheck = stepStart;
              resetProgress();
              setIndex(0);
            }
          }
        } else if (step >= 0 && step < sequence.length) {
          const id = sequence[step]!.id;
          const neutral = Math.abs(rel) < 0.12 && sSmile < 0.4 && (earOpen === 0 || f.ear > earOpen * 0.85);
          if (!armed) {
            if (neutral) armed = true;
          } else if (id === "blink") {
            if (Math.abs(rel) < 0.25 && earOpen > 0) {
              if (!eyesClosed && f.ear < earOpen * 0.75) {
                eyesClosed = true;
                closedAt = t;
              } else if (eyesClosed) {
                if (f.ear > earOpen * 0.88) {
                  eyesClosed = false;
                  if (t - closedAt < 1200) {
                    blinkCount += 1;
                    setBlinks(blinkCount);
                    if (blinkCount >= 2) pass(t);
                  }
                } else if (t - closedAt > 1200) {
                  eyesClosed = false; // eyes simply held shut: not a blink
                }
              }
            }
          } else {
            const ok =
              id === "smile"
                ? sSmile > SMILE_MIN && Math.abs(rel) < 0.2
                : id === "left"
                  ? rel > TURN_YAW
                  : rel < -TURN_YAW;
            if (!ok) heldSince = null;
            else if (heldSince === null) heldSince = t;
            else if (t - heldSince >= HOLD_MS) pass(t);
          }
        }
      } else {
        setLive(null);
        if (t - lastSeen > FACE_LOST_MS) {
          resetProgress(); // face lost: nothing counts until it is back
          if (step === -1) heldSince = null;
        }
        if (step >= 0) stepStart += t - prevT; // pause the countdown while no face is visible
      }
      prevT = t;

      if (step >= sequence.length) {
        runRef.current = false;
        setPhase("done");
        toast.success("Liveness confirmed", { description: "All gestures verified live." });
        setTimeout(() => cam.stop(), 400);
        return;
      }

      // Time ran out on this gesture: it is NOT counted. Retry it, and fail the whole check after too many misses.
      if (step >= 0 && t - stepStart > STEP_TIMEOUT_MS) {
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          runRef.current = false;
          setPhase("failed");
          cam.stop();
          toast.error("Liveness check failed", {
            description: "We couldn't confirm the gestures. Try again in good light, facing the camera.",
          });
          return;
        }
        const h = sequence[step]!.hint;
        setHint(h);
        toast.message("Gesture not detected yet", { description: h });
        stepStart = t;
        resetProgress();
      }
      await new Promise((r) => setTimeout(r, 16));
    }
  };

  const begin = async () => {
    setPhase("loading");
    try {
      const [{ loadFaceApi }, ok] = await Promise.all([import("@/lib/face"), cam.start()]);
      if (!ok) {
        setPhase("nocam");
        return;
      }
      await loadFaceApi();
      const sequence = shuffleChallenges();
      setSeq(sequence);
      setPhase("running");
      setIndex(-1);
      setLog([]);
      setBlinks(0);
      setHint("");
      setSelfie(null);
      setSelfieDescriptor(null);
      runRef.current = true;
      runIdRef.current += 1;
      const runId = runIdRef.current;
      void loop(sequence, runId).catch((e) => {
        console.error(e);
        runRef.current = false;
        setPhase("nocam");
        cam.stop();
        toast.error("Face tracking stopped", { description: "You can continue — your case will be reviewed manually." });
      });
    } catch (e) {
      console.error(e);
      cam.stop();
      setPhase("nocam");
      toast.error("Face tracking couldn't load", { description: "Check your internet connection and try again." });
    }
  };

  const done = phase === "done";
  const progress = done ? 100 : Math.round((log.length / seq.length) * 100);
  const current = seq[index];
  const prompt =
    phase === "loading"
      ? "Loading face tracking…"
      : phase === "running"
        ? !live
          ? "Move your face into the frame"
          : index === -1
            ? "Look straight at the camera, neutral face"
            : (current?.label ?? "")
        : done
          ? "Liveness confirmed"
          : phase === "failed"
            ? "Liveness check failed"
            : phase === "nocam"
              ? "Camera or face tracking unavailable"
              : "Center your face in the frame";

  const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  return (
    <Card className="panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="size-5 text-primary" /> Live Gesture Liveness Check
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl bg-surface-2/60">
            {cam.active && (
              <>
                <video
                  ref={cam.videoRef}
                  playsInline
                  muted
                  className="absolute inset-0 size-full -scale-x-100 object-cover"
                />
                <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full -scale-x-100 object-cover" />
              </>
            )}
            {!cam.active && selfie && (
              <img src={selfie} alt="Your verified selfie" className="absolute inset-0 size-full -scale-x-100 object-cover opacity-70" />
            )}
            <div
              className={`pointer-events-none absolute size-56 rounded-full border-2 md:size-64 ${
                done ? "border-success" : "border-scanner"
              } ${phase === "running" ? "pulse-ring" : ""}`}
            />
            <AnimatePresence>
              {phase === "running" && log.length > 0 && (
                <motion.div
                  key={log.length}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute right-3 top-3 z-10 rounded-full bg-success p-1.5 text-success-foreground"
                >
                  <CheckCircle2 className="size-5" />
                </motion.div>
              )}
            </AnimatePresence>
            <div className={`relative z-10 text-center ${cam.active ? "mt-auto mb-4 rounded-lg bg-background/75 px-3 py-2 backdrop-blur" : ""}`}>
              {!cam.active &&
                (done ? (
                  <UserRoundCheck className="mx-auto size-12 text-success" />
                ) : phase === "loading" ? (
                  <Loader2 className="mx-auto size-12 animate-spin text-scanner" />
                ) : (
                  <ScanFace className="mx-auto size-12 text-scanner" />
                ))}
              <p className="mt-2 max-w-[16rem] text-sm font-medium">
                {prompt}
                {phase === "running" && current?.id === "blink" ? ` (${blinks}/2)` : ""}
              </p>
              {phase === "running" && hint && live && index >= 0 && (
                <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">{hint}</p>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Gestures verified</span>
              <span className="font-mono">{log.length}/{seq.length}</span>
            </div>
            <Progress value={progress} />
          </div>

          {phase === "failed" && (
            <p className="mt-3 text-sm text-destructive">
              The gestures weren't detected, so this check can't be completed. Make sure your face is well lit and fully in
              view, then try again.
            </p>
          )}

          {(phase === "idle" || phase === "nocam" || phase === "failed") && (
            <Button className="mt-4 w-full" onClick={() => void begin()}>
              {phase === "idle" ? "Start liveness check" : "Try again"}
            </Button>
          )}
          {phase === "nocam" && (
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() =>
                onNext({ selfie: null, selfieDescriptor: null, liveness: { completed: false, challenges: log } })
              }
            >
              Continue without camera (manual review)
            </Button>
          )}
        </div>

        <div className="space-y-4">
          <SignalBar label="Face detection confidence" value={live ? pct(live.score * 100) : 0} tone="success" />
          <SignalBar label="Smile intensity" value={live ? pct(live.smile * 100) : 0} tone="primary" />
          <SignalBar label="Head turn from centre" value={live ? pct(Math.abs(live.yaw) * 250) : 0} tone="accent" />
          <SignalBar label="Eye openness" value={live ? pct(live.ear * 300) : 0} tone="primary" />

          <Separator />
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <CheckCircle2 className={`size-4 ${selfie ? "text-success" : "text-muted-foreground/40"}`} />
              Neutral selfie captured
            </li>
            {seq.map((c, i) => (
              <li key={c.id} className={`flex items-center gap-2 ${i === index && phase === "running" ? "text-primary" : ""}`}>
                <CheckCircle2 className={`size-4 ${i < log.length ? "text-success" : "text-muted-foreground/40"}`} />
                {c.label}
                {log[i] && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{(log[i].ms / 1000).toFixed(1)}s</span>}
              </li>
            ))}
          </ul>

          <div className="flex justify-between gap-3 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                runRef.current = false;
                runIdRef.current += 1;
                cam.stop();
                onBack();
              }}
            >
              Back
            </Button>
            <Button
              disabled={!done || log.length < seq.length}
              onClick={() => {
                if (!done || log.length < seq.length) return; // never continue unless every gesture was performed
                onNext({ selfie, selfieDescriptor, liveness: { completed: true, challenges: log } });
              }}
            >
              View result
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SignalBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "primary" | "accent";
}) {
  const bg = tone === "success" ? "bg-success" : tone === "primary" ? "bg-primary" : "bg-accent";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <motion.div className={`h-full rounded-full ${bg}`} animate={{ width: `${value}%` }} transition={{ duration: 0.2 }} />
      </div>
    </div>
  );
}

type SubmitResult = {
  caseCode: string;
  trustScore: number;
  status: string;
  authenticity: string;
  liveness: string;
  faceMatch: number | null;
  samePerson: boolean | null;
  duplicate: string | null;
  seconds: number;
  offline: boolean;
};

const OFFLINE_KEY = "veriauth-offline-queue";

function ResultStep({
  data,
  consent,
  onRestart,
}: {
  data: Captured;
  consent: Record<string, boolean>;
  onRestart: () => void;
}) {
  const submit = useServerFn(submitVerification);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const sent = useRef(false);

  const run = async () => {
    if (!data.doc) return;
    const started = performance.now();
    let face: { selfieDescriptor: number[] | null; idDescriptor: number[] | null; similarity: number | null; samePerson: boolean | null } = {
      selfieDescriptor: data.selfieDescriptor,
      idDescriptor: data.doc.idDescriptor,
      similarity: null,
      samePerson: null,
    };
    if (data.selfieDescriptor && data.doc.idDescriptor) {
      try {
        const { compareFaces } = await import("@/lib/face");
        const cmp = compareFaces(Float32Array.from(data.selfieDescriptor), Float32Array.from(data.doc.idDescriptor));
        face = { ...face, similarity: cmp.similarity, samePerson: cmp.samePerson };
      } catch (e) {
        console.warn("Face comparison failed", e);
      }
    }
    const payload = {
      documentImage: data.doc.front,
      backImage: data.doc.back,
      selfieImage: data.selfie,
      consent,
      liveness: data.liveness,
      face,
      fields: data.doc.fields,
      ocr: data.doc.ocr,
    };
    try {
      const res = await submit({ data: payload });
      if (res.ok) {
        setResult(res.result);
        return;
      }
      console.warn("Save failed:", res.error);
    } catch (e) {
      console.warn("Verification service unreachable", e);
    }
    // Fallback: score on this device and keep the case so it isn't lost.
    const s = scoreVerification({
      liveness: data.liveness,
      hasSelfie: !!data.selfie,
      face,
      ocr: data.doc.ocr,
      duplicate: false,
    });
    const caseCode = `LOCAL-${Date.now().toString(36).toUpperCase()}`;
    try {
      const q = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? "[]") as unknown[];
      q.push({ caseCode, savedAt: new Date().toISOString() }); // no personal data kept on-device
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(q.slice(-20)));
    } catch {
      /* storage full or blocked */
    }
    toast.message("Not submitted", { description: "The server couldn't be reached. Nothing was saved on this device — please try again." });
    setResult({
      caseCode,
      trustScore: s.score,
      status: s.status === "Approved" ? "Pending" : s.status,
      authenticity: s.authenticity,
      liveness: s.liveness,
      faceMatch: face.similarity,
      samePerson: face.samePerson,
      duplicate: null,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      offline: true,
    });
  };

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void run().catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data.doc) {
    return (
      <Card className="panel">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">No document was captured.</p>
          <Button onClick={onRestart}>Start over</Button>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card className="panel">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Fingerprint className="size-10 animate-pulse text-primary" />
          <p className="text-sm font-medium">Comparing your face to your ID and checking for duplicates…</p>
        </CardContent>
      </Card>
    );
  }

  const tone = (good: boolean) => (good ? "success" : "warning") as "success" | "warning";
  const checks = [
    { label: "ID Authenticity", value: result.authenticity, tone: tone(result.authenticity === "Verified") },
    {
      label: "Biometric Face Match",
      value:
        result.faceMatch == null
          ? "Not compared (no face found)"
          : `${Math.round(result.faceMatch)}% ${result.samePerson ? "Match" : "— different person?"}`,
      tone: tone(!!result.samePerson),
    },
    { label: "Liveness Detection", value: result.liveness, tone: tone(result.liveness === "Passed") },
    {
      label: "Duplicate Check",
      value: result.offline
        ? "Pending — server offline"
        : result.duplicate
          ? "Flagged — under manual review"
          : "Clear — no matching identity",
      tone: tone(!result.duplicate && !result.offline),
    },
  ];
  const scoreTone = result.trustScore >= 85 ? "success" : result.trustScore >= 40 ? "warning" : "destructive";
  const toneCls = {
    success: { ring: "border-success/50 bg-success/10", text: "text-success", badge: "bg-success/15 text-success ring-1 ring-success/30" },
    warning: { ring: "border-warning/50 bg-warning/10", text: "text-warning", badge: "bg-warning/15 text-warning ring-1 ring-warning/30" },
    destructive: { ring: "border-destructive/50 bg-destructive/10", text: "text-destructive", badge: "bg-destructive/15 text-destructive ring-1 ring-destructive/30" },
  }[scoreTone];
  const statusLabel =
    result.status === "Approved" ? "APPROVED" : result.status === "Rejected" ? "REJECTED" : "UNDER REVIEW";
  const f = data.doc.fields;

  const downloadCertificate = () => {
    const text = [
      "VeriAuth AI — Verification Certificate",
      `Case: ${result.caseCode}`,
      `Name: ${f.fullName}`,
      `Document: ${f.documentType} ${f.documentNumber}`,
      `Date of birth: ${f.dateOfBirth}  Gender: ${f.gender}`,
      `Issued: ${f.dateOfIssue} ${f.placeOfIssue}`,
      `Trust score: ${result.trustScore}/100`,
      `Status: ${statusLabel}`,
      ...checks.map((c) => `${c.label}: ${c.value}`),
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.caseCode}-certificate.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BadgeCheck className="size-5 text-success" /> Verification Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <div className="panel flex flex-col items-center justify-center p-6 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 180, damping: 14 }}
            className={`flex size-32 items-center justify-center rounded-full border-4 ${toneCls.ring}`}
          >
            <span className={`text-3xl font-semibold ${toneCls.text}`}>{result.trustScore}</span>
          </motion.div>
          <p className="mt-3 text-sm text-muted-foreground">Trust Score</p>
          <Badge className={`mt-2 ${toneCls.badge}`}>{statusLabel}</Badge>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Case {result.caseCode} · {result.seconds}s
          </p>
        </div>

        <div className="space-y-3">
          {checks.map((c) => (
            <div
              key={c.label}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/40 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm">
                <Fingerprint className="size-4 text-muted-foreground" />
                {c.label}
              </span>
              <span className={`text-right text-sm font-medium ${c.tone === "success" ? "text-success" : "text-warning"}`}>
                {c.value}
              </span>
            </div>
          ))}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="secondary" onClick={downloadCertificate}>
              <Download className="size-4" /> Download Certificate
            </Button>
            <Button
              onClick={() =>
                toast.success(
                  result.status === "Approved"
                    ? "Onboarding complete — welcome aboard!"
                    : "Submitted — a compliance officer will review your case.",
                )
              }
            >
              Complete Onboarding
            </Button>
            <Button variant="ghost" onClick={onRestart}>
              <RefreshCw className="size-4" /> New verification
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
