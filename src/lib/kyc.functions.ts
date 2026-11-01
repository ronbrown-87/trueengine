import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const dataUrl = z
  .string()
  .max(6_000_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,/);

export type OcrResult = {
  fullName: string;
  documentNumber: string;
  dateOfBirth: string;
  expiryDate: string;
  documentType: string;
  isIdentityDocument: boolean;
  tamperingSuspected: boolean;
  mrzOrBarcodePresent: boolean;
  securityFeaturesVisible: boolean;
  confidence: number;
  notes: string;
  gender: string;
  dateOfIssue: string;
  placeOfIssue: string;
};

const ocrSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "fullName",
    "documentNumber",
    "dateOfBirth",
    "expiryDate",
    "documentType",
    "isIdentityDocument",
    "tamperingSuspected",
    "mrzOrBarcodePresent",
    "securityFeaturesVisible",
    "confidence",
    "notes",
    "gender",
    "dateOfIssue",
    "placeOfIssue",
  ],
  properties: {
    fullName: { type: "string" },
    documentNumber: { type: "string" },
    dateOfBirth: { type: "string", description: "YYYY-MM-DD or empty" },
    expiryDate: { type: "string", description: "YYYY-MM-DD or empty" },
    documentType: { type: "string", enum: ["National ID", "Passport", "Driver's License", "Other"] },
    isIdentityDocument: { type: "boolean" },
    tamperingSuspected: { type: "boolean" },
    mrzOrBarcodePresent: { type: "boolean" },
    securityFeaturesVisible: { type: "boolean" },
    confidence: { type: "number", description: "0-100 overall read confidence" },
    notes: { type: "string", description: "One short sentence" },
    gender: { type: "string", description: "Male, Female or empty" },
    dateOfIssue: { type: "string", description: "YYYY-MM-DD or empty" },
    placeOfIssue: { type: "string" },
  },
};

export const analyzeDocument = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ image: dataUrl, side: z.enum(["front", "back"]).default("front") }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { enforceRateLimit } = await import("./rate-limit.server");
      enforceRateLimit("analyze", 20, 10 * 60_000);
      const { visionJSON } = await import("./ai.server");
      const result = await visionJSON<OcrResult>({
        system:
          "You are an identity document OCR and forensics engine. Read the document in the image exactly. Use empty strings for unreadable fields. Never invent values.",
        parts: [
          {
            type: "input_text",
            text: `This is the ${data.side} side of the document. Extract every identity field visible and assess authenticity.`,
          },
          { type: "input_image", image_url: data.image },
        ],
        schemaName: "id_document",
        schema: ocrSchema,
      });
      return { ok: true as const, result };
    } catch (e) {
      console.warn("AI OCR unavailable", e instanceof Error ? e.message : e);
      // Don't leak gateway/billing details to anonymous callers.
      const msg = e instanceof Error && e.message.startsWith("Too many requests") ? e.message : "Document analysis is unavailable.";
      return { ok: false as const, error: msg };
    }
  });

const descriptor = z.array(z.number().finite()).length(128).nullable().catch(null);
const clip = (n: number) => z.string().catch("").transform((v) => v.trim().slice(0, n));
const dateField = z.string().catch("").transform((v) => v.trim().slice(0, 20));

const submitInput = z.object({
  documentImage: dataUrl,
  backImage: dataUrl.nullable(),
  selfieImage: dataUrl.nullable(),
  consent: z.record(z.string(), z.boolean()).catch({}),
  liveness: z.object({
    completed: z.boolean(),
    challenges: z.array(z.object({ id: z.string().catch("step").transform((v) => v.slice(0, 20)), passed: z.boolean().catch(false), ms: z.number().catch(0) })).catch([]).transform((a) => a.slice(0, 10)),
  }),
  face: z
    .object({
      selfieDescriptor: descriptor,
      idDescriptor: descriptor,
      similarity: z.number().nullable().catch(null).transform((v) => (v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, v)))),
      samePerson: z.boolean().nullable().catch(null),
    })
    .nullable()
    .catch(null),
  fields: z.object({
    fullName: clip(120).transform((v) => v || "Unknown applicant"),
    documentNumber: clip(60),
    dateOfBirth: dateField,
    expiryDate: dateField,
    documentType: clip(40),
    gender: clip(20),
    dateOfIssue: dateField,
    placeOfIssue: clip(80),
  }),
  ocr: z.object({
    tamperingSuspected: z.boolean(),
    isIdentityDocument: z.boolean(),
    confidence: z.number().catch(0),
  }),
});
export type SubmitInput = z.infer<typeof submitInput>;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Decode a data URL and verify the bytes really are the image type claimed.
function toBytes(url: string): { bytes: Uint8Array; contentType: string } {
  const b64 = url.split(",")[1] ?? "";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const is = (sig: number[], off = 0) => sig.every((v, i) => bytes[off + i] === v);
  if (is([0xff, 0xd8, 0xff])) return { bytes, contentType: "image/jpeg" };
  if (is([0x89, 0x50, 0x4e, 0x47])) return { bytes, contentType: "image/png" };
  if (is([0x52, 0x49, 0x46, 0x46]) && is([0x57, 0x45, 0x42, 0x50], 8)) return { bytes, contentType: "image/webp" };
  throw new Error("Invalid image data");
}
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);

function euclid(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - (b[i] ?? 0)) ** 2;
  return Math.sqrt(s);
}

// Shared by the server and the offline fallback so both score identically.
export function scoreVerification(input: {
  liveness: { completed: boolean; challenges: { passed: boolean }[] };
  hasSelfie: boolean;
  face: { similarity: number | null; samePerson: boolean | null } | null;
  ocr: { tamperingSuspected: boolean; isIdentityDocument: boolean; confidence: number };
  duplicate: boolean;
}) {
  const allPassed = input.liveness.challenges.length > 0 && input.liveness.challenges.every((c) => c.passed);
  const liveness = !input.hasSelfie || !input.liveness.completed ? "Review" : allPassed ? "Passed" : "Failed";
  const authenticity = !input.ocr.isIdentityDocument
    ? "Not an ID"
    : input.ocr.tamperingSuspected
      ? "Suspicious"
      : "Verified";
  let score = 100;
  if (authenticity === "Suspicious") score -= 30;
  if (authenticity === "Not an ID") score -= 50;
  if (liveness === "Failed") score -= 35;
  if (liveness === "Review") score -= 20;
  const sim = input.face?.similarity;
  if (sim == null) score -= 15;
  else score -= Math.max(0, Math.round((90 - sim) * 0.6));
  if (input.face?.samePerson === false) score -= 25;
  if (input.duplicate) score -= 30;
  if (input.ocr.confidence < 70) score -= 10;
  score = Math.max(0, Math.min(100, score));
  // SECURITY: every input above is client-supplied, so the system must never
  // auto-approve. A human reviewer approves; automation may only reject or queue.
  const status = score < 40 ? "Rejected" : "Pending";
  return { score, status, liveness, authenticity };
}

export const submitVerification = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => d)
  .handler(async ({ data: raw }) => {
    const parsed = submitInput.safeParse(raw);
    if (!parsed.success) {
      console.error("submitVerification invalid input", parsed.error.issues.slice(0, 5));
      return { ok: false as const, error: "Some details were missing. Please retake the photos." };
    }
    const data = parsed.data;
    const started = Date.now();
    try {
      const { enforceRateLimit } = await import("./rate-limit.server");
      enforceRateLimit("submit", 5, 10 * 60_000);
      if (!["doc", "bio", "retention"].every((k) => data.consent[k] === true)) {
        return { ok: false as const, error: "Consent is required to submit a verification." };
      }
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const docNum = data.fields.documentNumber.replace(/\s+/g, "").toUpperCase();
      const identityKey = `${data.fields.fullName.toLowerCase().replace(/\s+/g, " ")}|${data.fields.dateOfBirth}`;
      const vectorHash = await sha256(identityKey);
      let matchCase: string | null = null;
      let matchSimilarity: number | null = null;
      try {
        // Separate parameterised .eq() queries: never interpolate client input into a PostgREST filter string.
        const [byHash, byDoc] = await Promise.all([
          supabaseAdmin.from("verifications").select("case_code, doc_number, vector_hash").eq("vector_hash", vectorHash).limit(1),
          docNum
            ? supabaseAdmin.from("verifications").select("case_code, doc_number, vector_hash").eq("doc_number", docNum).limit(1)
            : Promise.resolve({ data: null }),
        ]);
        const dupes = [...(byHash.data ?? []), ...(byDoc.data ?? [])];
        const hit = dupes?.[0];
        if (hit) {
          matchCase = hit.case_code;
          matchSimilarity = hit.vector_hash === vectorHash && hit.doc_number === docNum ? 99.5 : 94;
        }
        const selfieVec = data.face?.selfieDescriptor;
        if (!matchCase && selfieVec) {
          const { data: faces } = await supabaseAdmin
            .from("verifications")
            .select("case_code, face_descriptor")
            .not("face_descriptor", "is", null)
            .order("created_at", { ascending: false })
            .limit(1000);
          let best: { code: string; d: number } | null = null;
          for (const f of faces ?? []) {
            if (!f.face_descriptor || f.face_descriptor.length !== 128) continue;
            const d = euclid(selfieVec, f.face_descriptor);
            if (!best || d < best.d) best = { code: f.case_code, d };
          }
          if (best && best.d < 0.45) {
            matchCase = best.code;
            matchSimilarity = Math.round((1 - best.d / 1.2) * 1000) / 10;
          }
        }
      } catch (e) {
        console.warn("Duplicate check failed", e);
      }

      const { score, status, liveness, authenticity } = scoreVerification({
        liveness: data.liveness,
        hasSelfie: !!data.selfieImage,
        face: data.face,
        ocr: data.ocr,
        duplicate: !!matchCase,
      });

      const folder = crypto.randomUUID();
      const front = toBytes(data.documentImage);
      const back = data.backImage ? toBytes(data.backImage) : null;
      const selfie = data.selfieImage ? toBytes(data.selfieImage) : null;
      const docPath = `${folder}/document-front.${EXT[front.contentType]}`;
      const backPath = back ? `${folder}/document-back.${EXT[back.contentType]}` : null;
      const selfiePath = selfie ? `${folder}/selfie.${EXT[selfie.contentType]}` : null;
      const uploads: [string, { bytes: Uint8Array; contentType: string }][] = [[docPath, front]];
      if (backPath && back) uploads.push([backPath, back]);
      if (selfiePath && selfie) uploads.push([selfiePath, selfie]);
      const results = await Promise.all(
        uploads.map(([path, f]) => supabaseAdmin.storage.from("kyc-media").upload(path, f.bytes, { contentType: f.contentType })),
      );
      if (results.some((r) => r.error)) {
        console.error("Photo upload failed");
        return { ok: false as const, error: "Could not store your documents. Please try again." };
      }

      const processingMs = Date.now() - started;
      const passedCount = data.liveness.challenges.filter((c) => c.passed).length;
      const { data: row, error } = await supabaseAdmin
        .from("verifications")
        .insert({
          full_name: data.fields.fullName,
          doc_type: data.fields.documentType || "National ID",
          doc_number: docNum || null,
          date_of_birth: isoDate(data.fields.dateOfBirth),
          expiry_date: isoDate(data.fields.expiryDate),
          gender: data.fields.gender || null,
          date_of_issue: isoDate(data.fields.dateOfIssue),
          place_of_issue: data.fields.placeOfIssue || null,
          authenticity,
          face_match: data.face?.similarity ?? null,
          liveness,
          duplicate: matchCase ? "Flagged" : "Clear",
          match_case_code: matchCase,
          match_similarity: matchSimilarity,
          trust_score: score,
          status,
          ai_notes: `Liveness ${passedCount}/${data.liveness.challenges.length} gestures verified on-device. ${
            data.face?.similarity != null ? `Face similarity ${data.face.similarity}%.` : "ID face not compared."
          }`,
          vector_hash: vectorHash,
          document_path: docPath,
          back_document_path: backPath,
          selfie_path: selfiePath,
          face_descriptor: data.face?.selfieDescriptor ?? null,
          id_face_descriptor: data.face?.idDescriptor ?? null,
          consent: data.consent,
          liveness_challenges: data.liveness.challenges,
          processing_ms: processingMs,
        })
        .select("case_code")
        .single();
      if (error || !row) {
        console.error(error);
        return { ok: false as const, error: "Could not save your verification." };
      }

      await supabaseAdmin
        .from("audit_log")
        .insert([
          { actor: "system", event: `New verification submitted, trust score ${score}`, case_code: row.case_code },
          ...(matchCase
            ? [{ actor: "system", event: `Duplicate identity match with ${matchCase}`, case_code: row.case_code }]
            : []),
          ...(status !== "Pending"
            ? [{ actor: "system", event: `Automatically ${status.toLowerCase()}`, case_code: row.case_code }]
            : []),
        ])
        .then(undefined, (e: unknown) => console.warn("Audit insert failed", e));

      return {
        ok: true as const,
        result: {
          caseCode: row.case_code,
          trustScore: score,
          status,
          authenticity,
          liveness,
          faceMatch: data.face?.similarity ?? null,
          samePerson: data.face?.samePerson ?? null,
          duplicate: matchCase ? "Flagged" : null,
          seconds: Math.round(processingMs / 100) / 10,
          offline: false,
        },
      };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Too many requests")) {
        return { ok: false as const, error: e.message };
      }
      console.error("submitVerification failed", e);
      return { ok: false as const, error: "The verification service is busy." };
    }
  });
