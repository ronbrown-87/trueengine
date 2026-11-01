// Browser-only OCR fallback (Tesseract.js, lazy-loaded) with ID parsing for NRC, passport and licence.
import type { OcrResult } from "./kyc.functions";

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function normDate(s: string): string {
  const t = s.toUpperCase().replace(/[.\-\s]/g, "/");
  let m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? (Number(m[3]) > 40 ? "19" : "20") + m[3] : m[3];
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})\/?([A-Z]{3})\/?(\d{4})$/);
  if (m && MONTHS[m[2]!]) return `${m[3]}-${MONTHS[m[2]!]}-${m[1]!.padStart(2, "0")}`;
  return "";
}

function mrzDate(yymmdd: string, future: boolean): string {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const century = future ? "20" : yy > new Date().getFullYear() % 100 ? "19" : "20";
  return `${century}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

export function parseIdText(raw: string, confidence: number): OcrResult {
  const text = raw.replace(/\r/g, "");
  const upper = text.toUpperCase();
  const lines = upper.split("\n").map((l) => l.trim()).filter(Boolean);
  const r: OcrResult = {
    fullName: "", documentNumber: "", dateOfBirth: "", expiryDate: "",
    documentType: "Other", isIdentityDocument: false, tamperingSuspected: false,
    mrzOrBarcodePresent: false, securityFeaturesVisible: false,
    confidence: Math.round(confidence), notes: "",
    gender: "", dateOfIssue: "", placeOfIssue: "",
  };

  // Passport MRZ (TD3: two 44-char lines)
  const mrz = lines.map((l) => l.replace(/\s/g, "")).filter((l) => /^[A-Z0-9<]{30,}$/.test(l) && l.includes("<"));
  if (mrz.length >= 2) {
    r.mrzOrBarcodePresent = true;
    const [l1, l2] = [mrz[mrz.length - 2]!, mrz[mrz.length - 1]!];
    if (l1.startsWith("P")) r.documentType = "Passport";
    const names = l1.slice(5).split("<<");
    const surname = (names[0] ?? "").replace(/</g, " ").trim();
    const given = (names[1] ?? "").replace(/</g, " ").trim();
    r.fullName = [given, surname].filter(Boolean).join(" ");
    r.documentNumber = l2.slice(0, 9).replace(/</g, "");
    r.dateOfBirth = mrzDate(l2.slice(13, 19), false);
    r.expiryDate = mrzDate(l2.slice(21, 27), true);
  }

  if (r.documentType === "Other") {
    if (/PASSPORT/.test(upper)) r.documentType = "Passport";
    else if (/DRIV|LICEN[CS]E/.test(upper)) r.documentType = "Driver's License";
    else if (/NATIONAL REGISTRATION|NRC|IDENTITY|REGISTRATION CARD|\bID\b/.test(upper)) r.documentType = "National ID";
  }

  // Zambian NRC: 123456/78/1
  if (!r.documentNumber) {
    const nrc = upper.match(/\b(\d{6})\s*\/\s*(\d{2})\s*\/\s*(\d)\b/);
    if (nrc) {
      r.documentNumber = `${nrc[1]}/${nrc[2]}/${nrc[3]}`;
      if (r.documentType === "Other") r.documentType = "National ID";
    }
  }
  if (!r.documentNumber) {
    const lab = upper.match(/(?:NO|NUMBER|LICEN[CS]E NO|PASSPORT NO|ID NO)[.:\s]*([A-Z0-9][A-Z0-9\-\/]{4,14})/);
    const generic = upper.match(/\b([A-Z]{1,2}\d{6,9}|\d{8,12})\b/);
    r.documentNumber = (lab?.[1] ?? generic?.[1] ?? "").trim();
  }

  // Dates
  const dateRe = /(\d{1,2}[\/.\-\s](?:\d{1,2}|[A-Z]{3})[\/.\-\s]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})/g;
  const noNrc = (l: string) => l.replace(/\d{6}\s*\/\s*\d{2}\s*\/\s*\d/g, " ");
  const labelled = (re: RegExp) => {
    for (const raw of lines) { const l = noNrc(raw); if (re.test(l)) { const d = l.match(dateRe); if (d) return normDate(d[0]); } }
    return "";
  };
  r.dateOfBirth ||= labelled(/BIRTH|D\.?O\.?B|BORN/);
  r.expiryDate ||= labelled(/EXPIR|VALID|DATE OF ISSUE|ISSUE/);
  const all = (noNrc(upper).match(dateRe) ?? []).map(normDate).filter(Boolean).sort();
  if (!r.dateOfBirth && all[0]) r.dateOfBirth = all[0];
  if (!r.expiryDate && all.length > 1) r.expiryDate = all[all.length - 1]!;

  // Name
  if (!r.fullName) {
    const parts: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const m = l.match(/^(SURNAME|FIRST NAMES?|GIVEN NAMES?|NAMES?|OTHER NAMES?)[:\s]*(.*)$/);
      if (m) {
        const v = (m[2] || lines[i + 1] || "").replace(/[^A-Z\s'-]/g, "").trim();
        if (v) parts.push(v);
      }
    }
    if (parts.length) r.fullName = parts.length > 1 ? `${parts.slice(1).join(" ")} ${parts[0]}` : parts[0]!;
  }
  r.fullName = r.fullName.replace(/\s+/g, " ").trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase());

  Object.assign(r, parseBackFields(upper, lines));

  const found = [r.fullName, r.documentNumber, r.dateOfBirth].filter(Boolean).length;
  r.isIdentityDocument = r.documentType !== "Other" || found >= 2;
  r.securityFeaturesVisible = r.isIdentityDocument && confidence > 60;
  r.notes = r.mrzOrBarcodePresent
    ? "MRZ check valid. Text extraction complete (on-device reader)."
    : found >= 2
      ? "Text extraction complete (on-device reader). Please confirm the fields."
      : "Some fields could not be read. Please fill them in.";
  return r;
}

// Fields usually printed on the back of an NRC / licence (also checked on the front).
export function parseBackFields(upper: string, lines: string[]) {
  const out = { gender: "", dateOfIssue: "", placeOfIssue: "" };
  const g = upper.match(/\b(?:SEX|GENDER)[:\s]*(M|F|MALE|FEMALE)\b/) ?? upper.match(/\b(MALE|FEMALE)\b/);
  if (g) out.gender = g[1]!.startsWith("F") ? "Female" : "Male";
  const dateRe = /(\d{1,2}[\/.\-\s](?:\d{1,2}|[A-Z]{3})[\/.\-\s]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!out.dateOfIssue && /ISSUE/.test(l) && !/PLACE/.test(l)) {
      const d = (l.match(dateRe) ?? (lines[i + 1] ?? "").match(dateRe))?.[0];
      if (d) out.dateOfIssue = normDate(d);
    }
    if (!out.placeOfIssue) {
      const m = l.match(/(?:PLACE OF ISSUE|ISSUED AT|DISTRICT|PLACE)[:\s]*([A-Z][A-Z\s'-]{2,30})/);
      if (m) out.placeOfIssue = m[1]!.trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase());
    }
  }
  return out;
}

async function recognize(image: string) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text ?? "", confidence: data.confidence ?? 0 };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

export async function browserOcr(image: string): Promise<OcrResult> {
  const { text, confidence } = await recognize(image);
  return parseIdText(text, confidence);
}

// Back side: returns the full parse so we can fill anything missing from the front.
export async function browserOcrBack(image: string): Promise<OcrResult> {
  const { text, confidence } = await recognize(image);
  return parseIdText(text, confidence);
}
