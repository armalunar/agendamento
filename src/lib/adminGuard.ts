import { NextRequest } from "next/server";
import { hasAdminAccessFromRequest } from "./adminAccess";
import { adminAuth, adminDb } from "./firebaseAdmin";

export async function verifyAdminRequest(request: NextRequest) {
  if (!hasAdminAccessFromRequest(request)) {
    throw new Error("ADMIN_ROUTE_LOCKED");
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    throw new Error("AUTH_MISSING");
  }

  const decoded = await adminAuth.verifyIdToken(token, true);

  if (decoded.admin === true) {
    return decoded;
  }

  const adminDoc = await adminDb.collection("admins").doc(decoded.uid).get();
  const data = adminDoc.data();

  if (data?.isAdmin === true) {
    return decoded;
  }

  throw new Error("ADMIN_REQUIRED");
}
