import { NextRequest, NextResponse } from "next/server";
import { listAdminAudit } from "@/lib/adminAudit";
import { verifyAdminRequest } from "@/lib/adminGuard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await verifyAdminRequest(request);
    const entries = await listAdminAudit(40);
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401 });
  }
}
