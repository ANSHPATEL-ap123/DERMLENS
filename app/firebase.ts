// app/firebase.ts
// ---------------------------------------------------------------
// Firestore initialization for DermLens.
// Analytics is intentionally excluded per project requirements.
// ---------------------------------------------------------------
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  limit,
  type Firestore,
} from "firebase/firestore";

// Replace these values with your own Firebase project config.
// Keep them in .env in production.
const firebaseConfig = {
 apiKey: "AIzaSyCc-LCQWeh34EegyJPTfBFuhuaXsyWOlcM",
  authDomain: "dermlens.firebaseapp.com",
  projectId: "dermlens",
  storageBucket: "dermlens.firebasestorage.app",
  messagingSenderId: "845591400333",
  appId: "1:845591400333:web:8685330f65f6fdf56e37c4",
  measurementId: "G-SFD4DSBMVX"
};

let app: FirebaseApp;
let db: Firestore;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  console.warn("[firebase] init failed, falling back to offline mock:", err);
  // @ts-ignore — assigned lazily
  app = null as unknown as FirebaseApp;
  // @ts-ignore — assigned lazily
  db = null as unknown as Firestore;
}

export { app, db };
export { collection, addDoc, getDocs, serverTimestamp, query, orderBy, limit };

// ---------------------------------------------------------------------------
// High-level helpers used by the UI. They gracefully degrade to localStorage
// when Firestore is unreachable (handy for demo/offline environments).
// ---------------------------------------------------------------------------
export type PatientRecord = {
  id: string;
  name: string;
  age: number;
  classification: string;
  riskScore: number;
  timestamp: string;
};

const LOCAL_KEY = "dermlens_vault_v1";

const readLocal = (): PatientRecord[] => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as PatientRecord[]) : seedRecords();
  } catch {
    return seedRecords();
  }
};

const writeLocal = (records: PatientRecord[]) =>
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records));

const seedRecords = (): PatientRecord[] => {
  const seed: PatientRecord[] = [
    { id: "p-1001", name: "Aarav Shah", age: 24, classification: "Grade III Acne Vulgaris", riskScore: 7.8, timestamp: "2026-02-14T10:21:00Z" },
    { id: "p-1002", name: "Priya Menon", age: 31, classification: "Melasma (Epidermal)", riskScore: 4.2, timestamp: "2026-02-19T14:02:00Z" },
    { id: "p-1003", name: "Daniel Ortiz", age: 47, classification: "Seborrheic Keratosis", riskScore: 2.1, timestamp: "2026-03-02T09:45:00Z" },
    { id: "p-1004", name: "Fatima Al-Hassan", age: 28, classification: "Contact Dermatitis", riskScore: 5.6, timestamp: "2026-03-08T17:12:00Z" },
    { id: "p-1005", name: "Liam O'Connor", age: 52, classification: "Actinic Keratosis (Pre-Malignant)", riskScore: 8.9, timestamp: "2026-03-11T11:33:00Z" },
  ];
  localStorage.setItem(LOCAL_KEY, JSON.stringify(seed));
  return seed;
};

export async function commitReport(record: Omit<PatientRecord, "id" | "timestamp">) {
  const newRecord: PatientRecord = {
    ...record,
    id: "p-" + Math.floor(1000 + Math.random() * 9000),
    timestamp: new Date().toISOString(),
  };

  try {
    if (db) {
      await addDoc(collection(db, "patient_records"), {
        ...newRecord,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn("[firebase] write failed, falling back to localStorage:", err);
  }

  // Always mirror to localStorage so the Vault UI stays responsive offline.
  const existing = readLocal();
  writeLocal([newRecord, ...existing].slice(0, 25));
  return newRecord;
}

export async function fetchRecords(): Promise<PatientRecord[]> {
  try {
    if (db) {
      const q = query(collection(db, "patient_records"), orderBy("createdAt", "desc"), limit(10));
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PatientRecord, "id">) }));
      if (rows.length > 0) return rows;
    }
  } catch (err) {
    console.warn("[firebase] read failed, using local vault:", err);
  }
  return readLocal();
}
