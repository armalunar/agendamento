import { NextRequest, NextResponse } from "next/server";
import { recordAdminAudit } from "@/lib/adminAudit";
import { getAdminProfile, saveAdminProfile } from "@/lib/adminProfile";
import { verifyAdminRequest } from "@/lib/adminGuard";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAdminRequest(request);
    const profile = await getAdminProfile(decoded.uid, decoded.name || "", decoded.email || "");
    return NextResponse.json({ profile }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const decoded = await verifyAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const actor = decoded.name || decoded.email || "Admin";

    await saveAdminProfile(decoded.uid, {
      email: decoded.email || "",
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      photoDataUrl: typeof body.photoDataUrl === "string" ? body.photoDataUrl : undefined
    });

    const profile = await getAdminProfile(decoded.uid, decoded.name || "", decoded.email || "");

    await recordAdminAudit(
      "admin-profile-updated",
      "Perfil do administrador atualizado",
      "Nome de usuário ou foto de perfil ajustados no painel.",
      actor
    );

    return NextResponse.json({ profile }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "ADMIN_PHOTO_INVALID") {
      return NextResponse.json({ error: "A foto enviada não está em um formato base64 válido." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (message === "ADMIN_PHOTO_TOO_LARGE") {
      return NextResponse.json({ error: "A foto base64 ficou grande demais. Tente uma imagem menor." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Não foi possível atualizar o perfil do administrador." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
