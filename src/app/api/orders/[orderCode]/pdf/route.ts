import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { normalizeOrderRecord } from "@/lib/orders";
import { generateOrderPdf, type OrderPdfVersion } from "@/lib/orderPdf";

export const runtime = "nodejs";

type Params = {
  params: Promise<{
    orderCode: string;
  }>;
};

function getVersion(value: string | null): OrderPdfVersion {
  return value === "completion" ? "completion" : "initial";
}

export async function GET(request: NextRequest, context: Params) {
  const { orderCode } = await context.params;
  const normalizedCode = orderCode.trim().toUpperCase();
  const version = getVersion(request.nextUrl.searchParams.get("version"));

  if (!/^OS-\d{8}-[A-Z0-9]{6}$/.test(normalizedCode)) {
    return NextResponse.json({ error: "Código de ordem inválido." }, { status: 400 });
  }

  const snap = await adminDb.collection("orders").doc(normalizedCode).get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
  }

  const order = normalizeOrderRecord(snap.id, snap.data());

  if (version === "completion" && order.status !== "completed") {
    return NextResponse.json({ error: "A ordem ainda não foi concluída." }, { status: 409 });
  }

  const pdfBytes = await generateOrderPdf(order, version);
  const body = pdfBytes.slice().buffer as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=\"${normalizedCode}-${version}.pdf\"`
    }
  });
}
