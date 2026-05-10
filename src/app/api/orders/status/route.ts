import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { normalizeOrderRecord } from "@/lib/orders";
import { buildDeliveryStatusLabel, buildPaymentMethodLabel, buildPaymentStatusLabel } from "@/lib/orderShared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
  const phone = (request.nextUrl.searchParams.get("phone") || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");

  if (!code || !/^OS-\d{8}-[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "Informe um ID de pedido válido." }, { status: 400 });
  }

  const snap = await adminDb.collection("orders").doc(code).get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }

  const order = normalizeOrderRecord(snap.id, snap.data());
  const orderPhoneDigits = order.customer.phone.replace(/\D/g, "");

  if (phoneDigits && orderPhoneDigits !== phoneDigits) {
    return NextResponse.json({ error: "Telefone não confere com a ordem informada." }, { status: 403 });
  }

  return NextResponse.json({
    order: {
      orderCode: order.orderCode,
      status: order.status,
      isArchived: order.isArchived,
      services: order.services,
      total: order.total,
      pricing: order.pricing,
      paymentStatus: order.payment.status,
      paymentLabel: buildPaymentStatusLabel(order.payment.status),
      paymentMethodLabel: buildPaymentMethodLabel(order.payment.method),
      amountPaid: order.payment.amountPaid,
      deliveryStatus: order.delivery.status,
      deliveryLabel: buildDeliveryStatusLabel(order.delivery.status),
      schedule: order.schedule,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      completionNotes: order.completion.clientNotes,
      diagnosis: order.completion.diagnosis,
      solution: order.completion.solution,
      checklist: order.completion.checklist,
      warranty: order.completion.warranty,
      completedAt: order.completion.completedAt
    }
  });
}
