import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";

export type AdminProfileRecord = {
  uid: string;
  email: string;
  displayName: string;
  photoDataUrl: string;
  photoUrl: string;
  isAdmin: boolean;
};

const ADMIN_PHOTO_PREFIX = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i;
const ADMIN_PHOTO_MAX_LENGTH = 160 * 1024;
const ADMIN_PHOTO_URL_MAX_LENGTH = 2048;

function cleanAdminText(value: unknown, fallback = "", maxLength = 240) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, maxLength) || fallback;
}

function cleanAdminUrl(value: unknown, fallback = "", maxLength = ADMIN_PHOTO_URL_MAX_LENGTH) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().slice(0, maxLength) || fallback;
}

export function normalizeAdminPhotoDataUrl(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();

  if (!normalized) {
    return "";
  }

  if (!ADMIN_PHOTO_PREFIX.test(normalized)) {
    throw new Error("ADMIN_PHOTO_INVALID");
  }

  if (normalized.length > ADMIN_PHOTO_MAX_LENGTH) {
    throw new Error("ADMIN_PHOTO_TOO_LARGE");
  }

  return normalized;
}

export function normalizeAdminPhotoUrl(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length > ADMIN_PHOTO_URL_MAX_LENGTH) {
    throw new Error("ADMIN_PHOTO_URL_INVALID");
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("ADMIN_PHOTO_URL_INVALID");
    }
  } catch {
    throw new Error("ADMIN_PHOTO_URL_INVALID");
  }

  return normalized;
}

export function normalizeAdminProfileRecord(
  uid: string,
  value: unknown,
  fallbackDisplayName = "",
  fallbackEmail = ""
): AdminProfileRecord {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const photoDataUrl = cleanAdminText(source.photoDataUrl, "", ADMIN_PHOTO_MAX_LENGTH);
  const photoUrl = cleanAdminUrl(source.photoUrl);

  return {
    uid: cleanAdminText(source.uid, uid, 120),
    email: cleanAdminText(source.email, fallbackEmail, 160).toLowerCase(),
    displayName: cleanAdminText(source.displayName, fallbackDisplayName || fallbackEmail || "Administrador", 120),
    photoDataUrl,
    photoUrl,
    isAdmin: source.isAdmin === true
  };
}

export async function getAdminProfile(uid: string, fallbackDisplayName = "", fallbackEmail = "") {
  const snapshot = await adminDb.collection("admins").doc(uid).get();
  return normalizeAdminProfileRecord(uid, snapshot.data(), fallbackDisplayName, fallbackEmail);
}

export async function saveAdminProfile(
  uid: string,
  {
    email,
    displayName,
    photoDataUrl,
    photoUrl
  }: {
    email?: string;
    displayName?: string;
    photoDataUrl?: string;
    photoUrl?: string;
  }
) {
  const payload: Record<string, unknown> = {
    uid,
    updatedAt: FieldValue.serverTimestamp()
  };

  if (typeof email === "string" && email.trim()) {
    payload.email = cleanAdminText(email, "", 160).toLowerCase();
  }

  if (typeof displayName === "string") {
    payload.displayName = cleanAdminText(displayName, "", 120);
  }

  if (typeof photoDataUrl === "string") {
    payload.photoDataUrl = normalizeAdminPhotoDataUrl(photoDataUrl);
  }

  if (typeof photoUrl === "string") {
    payload.photoUrl = normalizeAdminPhotoUrl(photoUrl);
  }

  await adminDb.runTransaction(async (transaction) => {
    const ref = adminDb.collection("admins").doc(uid);
    const snapshot = await transaction.get(ref);

    transaction.set(
      ref,
      {
        ...payload,
        ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp(), isAdmin: true })
      },
      { merge: true }
    );
  });
}
