import { adminDb } from "./firebaseAdmin";

export type AdminAuditEntry = {
  id: string;
  type: string;
  label: string;
  details: string;
  actor: string;
  createdAt: string;
};

function cleanAuditText(value: string, fallback: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || fallback;
}

export async function recordAdminAudit(
  type: string,
  label: string,
  details: string,
  actor = "Admin"
) {
  const now = new Date().toISOString();

  await adminDb.collection("adminAudit").add({
    type: cleanAuditText(type, "update"),
    label: cleanAuditText(label, "Atualizacao"),
    details: cleanAuditText(details, ""),
    actor: cleanAuditText(actor, "Admin"),
    createdAt: now
  });
}

export async function listAdminAudit(limit = 30): Promise<AdminAuditEntry[]> {
  const snap = await adminDb.collection("adminAudit").orderBy("createdAt", "desc").limit(limit).get();

  return snap.docs.map((doc) => {
    const source = doc.data() || {};

    return {
      id: doc.id,
      type: typeof source.type === "string" ? source.type : "update",
      label: typeof source.label === "string" ? source.label : "Atualizacao",
      details: typeof source.details === "string" ? source.details : "",
      actor: typeof source.actor === "string" ? source.actor : "Admin",
      createdAt:
        typeof source.createdAt === "string"
          ? source.createdAt
          : typeof source.createdAt?.toDate === "function"
            ? source.createdAt.toDate().toISOString()
            : new Date().toISOString()
    };
  });
}
