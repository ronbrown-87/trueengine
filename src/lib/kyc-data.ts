export type VerificationRow = {
  id: string;
  name: string;
  docType: string;
  trustScore: number;
  liveness: "Passed" | "Failed" | "Review";
  duplicate: "Flagged" | "Clear";
  status: "Pending" | "Approved" | "Rejected";
  vectorHash: string;
  match?: {
    name: string;
    customerId: string;
    similarity: number;
    enrolled: string;
    hash: string;
  };
};

export const verifications: VerificationRow[] = [
  {
    id: "VA-10241",
    name: "Chanda Mwansa",
    docType: "National ID",
    trustScore: 96,
    liveness: "Passed",
    duplicate: "Clear",
    status: "Approved",
    vectorHash: "0x8f2a…c41d",
  },
  {
    id: "VA-10242",
    name: "Lerato Ndlovu",
    docType: "Passport",
    trustScore: 62,
    liveness: "Review",
    duplicate: "Flagged",
    status: "Pending",
    vectorHash: "0x4b77…9e02",
    match: {
      name: "L. Ndlovu-Banda",
      customerId: "VA-08812",
      similarity: 94.8,
      enrolled: "2026-02-14",
      hash: "0x4b77…9e11",
    },
  },
  {
    id: "VA-10243",
    name: "Daniel Phiri",
    docType: "Driver's License",
    trustScore: 88,
    liveness: "Passed",
    duplicate: "Clear",
    status: "Pending",
    vectorHash: "0x1c09…77ab",
  },
  {
    id: "VA-10244",
    name: "Amina Yusuf",
    docType: "Passport",
    trustScore: 41,
    liveness: "Failed",
    duplicate: "Flagged",
    status: "Pending",
    vectorHash: "0x9de3…20fa",
    match: {
      name: "A. Yousef",
      customerId: "VA-07430",
      similarity: 97.3,
      enrolled: "2025-11-02",
      hash: "0x9de3…20fb",
    },
  },
  {
    id: "VA-10245",
    name: "Kabelo Sithole",
    docType: "National ID",
    trustScore: 91,
    liveness: "Passed",
    duplicate: "Clear",
    status: "Approved",
    vectorHash: "0x33c1…8b6e",
  },
  {
    id: "VA-10246",
    name: "Grace Tembo",
    docType: "National ID",
    trustScore: 74,
    liveness: "Review",
    duplicate: "Clear",
    status: "Pending",
    vectorHash: "0x6a20…4fd7",
  },
];

export const attackResilience = [
  { attack: "Print Attacks", detection: 99.8, rejection: 0.4 },
  { attack: "2D Screens", detection: 99.3, rejection: 0.9 },
  { attack: "3D Masks", detection: 97.6, rejection: 1.8 },
  { attack: "Generative Deepfakes", detection: 96.1, rejection: 2.4 },
];

export const latencyBreakdown = [
  { stage: "OCR Parsing", seconds: 4.1 },
  { stage: "Liveness", seconds: 6.8 },
  { stage: "Duplicate Hash Match", seconds: 2.2 },
  { stage: "Risk Scoring", seconds: 1.1 },
];

export const auditLog = [
  { time: "07:42:11", actor: "system", event: "Biometric template hashed and encrypted (AES-256-GCM)" },
  { time: "07:41:58", actor: "analyst.mbewe", event: "Override approved for VA-10239 with reason: sibling match" },
  { time: "07:39:04", actor: "system", event: "Duplicate vector match 94.8% raised on VA-10242" },
  { time: "07:35:22", actor: "system", event: "Auto-purge cycle removed 412 expired records (30-day policy)" },
  { time: "07:30:47", actor: "analyst.zulu", event: "Fraud block applied to VA-10236" },
];
