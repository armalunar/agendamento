import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyAdminRequest } from "@/lib/adminGuard";
import { normalizeOrderRecord } from "@/lib/orders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await verifyAdminRequest(request);

    const snap = await adminDb.collection("orders").orderBy("createdAt", "desc").limit(500).get();
    const orders = snap.docs.map((doc) => normalizeOrderRecord(doc.id, doc.data()));

    return NextResponse.json({ orders });
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401 });
  }
}
