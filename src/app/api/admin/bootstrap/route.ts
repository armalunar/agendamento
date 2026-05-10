import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { hasAdminAccessFromRequest } from "@/lib/adminAccess";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!hasAdminAccessFromRequest(request)) {
      return NextResponse.json({ error: "Área administrativa bloqueada." }, { status: 401 });
    }

    const ownerEmail = process.env.OWNER_ADMIN_EMAIL?.trim().toLowerCase();
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!ownerEmail) {
      return NextResponse.json({ error: "OWNER_ADMIN_EMAIL não foi configurado." }, { status: 500 });
    }

    if (!token) {
      return NextResponse.json({ error: "Token de login ausente." }, { status: 401 });
    }

    const decoded = await adminAuth.verifyIdToken(token, true);
    const userEmail = decoded.email?.toLowerCase();

    if (userEmail !== ownerEmail) {
      return NextResponse.json({ error: "Este e-mail não está autorizado como dono do sistema." }, { status: 403 });
    }

    if (decoded.email_verified !== true) {
      return NextResponse.json({ error: "Confirme seu e-mail antes de ativar o painel admin." }, { status: 403 });
    }

    await adminAuth.setCustomUserClaims(decoded.uid, { admin: true });

    await adminDb.collection("admins").doc(decoded.uid).set(
      {
        uid: decoded.uid,
        email: userEmail,
        displayName: decoded.name || userEmail,
        photoDataUrl: "",
        isAdmin: true,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, message: "Admin ativado com sucesso." });
  } catch {
    return NextResponse.json({ error: "Não foi possível ativar o admin." }, { status: 500 });
  }
}
