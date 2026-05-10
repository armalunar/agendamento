import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { recordAdminAudit } from "@/lib/adminAudit";
import { verifyAdminRequest } from "@/lib/adminGuard";
import { isValidDateString } from "@/lib/catalog";
import { adminDb } from "@/lib/firebaseAdmin";
import { cleanText, getAvailability, listUpcomingAvailability } from "@/lib/orders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await verifyAdminRequest(request);
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date");
  const from = request.nextUrl.searchParams.get("from");
  const days = Number(request.nextUrl.searchParams.get("days") || 14);

  if (date) {
    if (!isValidDateString(date)) {
      return NextResponse.json({ error: "Data inválida." }, { status: 400 });
    }

    const availability = await getAvailability(date);
    return NextResponse.json({ day: availability });
  }

  const fromDate = isValidDateString(from || "") ? (from as string) : new Date().toISOString().slice(0, 10);
  const rangeDays = Number.isFinite(days) ? Math.min(Math.max(days, 1), 31) : 14;
  const upcoming = await listUpcomingAvailability(fromDate, rangeDays);

  return NextResponse.json({ days: upcoming });
}

export async function PATCH(request: NextRequest) {
  let adminActor = "Admin";

  try {
    const decoded = await verifyAdminRequest(request);
    adminActor = decoded.name || decoded.email || "Admin";
    const body = await request.json().catch(() => ({}));
    const date = cleanText(body.date, "");

    if (!isValidDateString(date)) {
      return NextResponse.json({ error: "Data inválida." }, { status: 400 });
    }

    const isBlocked = body.isBlocked === true;
    const blockedReason = cleanText(body.blockedReason, "");
    const customSlots = Array.isArray(body.customSlots)
      ? body.customSlots.filter((item: unknown): item is string => typeof item === "string" && /^\d{2}:\d{2}$/.test(item)).sort()
      : [];

    await adminDb
      .collection("availability")
      .doc(date)
      .set(
        {
          date,
          isBlocked,
          blockedReason: isBlocked ? blockedReason : "",
          customSlots,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

    await recordAdminAudit(
      "calendar-update",
      `Agenda de ${date} atualizada`,
      isBlocked ? `Dia bloqueado. Motivo: ${blockedReason || "Não informado"}.` : "Dia liberado para atendimento.",
      adminActor
    );

    const day = await getAvailability(date);
    return NextResponse.json({ ok: true, day });
  } catch (error) {
    if (error instanceof Error && ["ADMIN_ROUTE_LOCKED", "AUTH_MISSING", "ADMIN_REQUIRED"].includes(error.message)) {
      return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401 });
    }

    return NextResponse.json({ error: "Não foi possível atualizar a agenda." }, { status: 500 });
  }
}
