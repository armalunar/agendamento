import { NextRequest, NextResponse } from "next/server";
import { isValidDateString, isValidScheduleSlot, normalizeServiceIds } from "@/lib/catalog";
import { normalizeEquipmentType, normalizeSystemProfile } from "@/lib/deviceProfile";
import { isPastBusinessDate, isScheduleSlotPast } from "@/lib/date";
import { cleanText, createOrder } from "@/lib/orders";
import type { PaymentMethod } from "@/lib/orderShared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const services = normalizeServiceIds(body.services);
    const date = cleanText(body.date, "");
    const slot = cleanText(body.slot, "");
    const couponCode = cleanText(body.couponCode, "");
    const name = cleanText(body.name, "");
    const phone = cleanText(body.phone, "");
    const city = cleanText(body.city, "");
    const paymentMethod: PaymentMethod = body.paymentMethod === "card" || body.paymentMethod === "cash" ? body.paymentMethod : "pix";

    if (!services.length) {
      return NextResponse.json({ error: "Selecione pelo menos um serviço." }, { status: 400 });
    }

    if (!name || !phone || !city) {
      return NextResponse.json({ error: "Informe nome, WhatsApp e cidade ou bairro para continuar." }, { status: 400 });
    }

    if (!isValidDateString(date)) {
      return NextResponse.json({ error: "Informe uma data válida." }, { status: 400 });
    }

    if (isPastBusinessDate(date)) {
      return NextResponse.json({ error: "Não é possível abrir pedidos em datas que já passaram." }, { status: 400 });
    }

    if (!isValidScheduleSlot(slot)) {
      return NextResponse.json({ error: "Horário inválido." }, { status: 400 });
    }

    if (isScheduleSlotPast(date, slot)) {
      return NextResponse.json({ error: "Esse horário de hoje já passou. Escolha outro disponível." }, { status: 409 });
    }

    const order = await createOrder({
      services,
      date,
      slot,
      couponCode,
      paymentMethod,
      name,
      phone,
      city,
      equipment: normalizeEquipmentType(body.equipment),
      issue: cleanText(body.issue),
      systemProfile: normalizeSystemProfile(body.systemProfile)
    });

    return NextResponse.json({ order });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";

    if (message === "DATE_PAST") {
      return NextResponse.json({ error: "Não é possível abrir pedidos em datas que já passaram." }, { status: 400 });
    }

    if (message === "SLOT_PASSED") {
      return NextResponse.json({ error: "Esse horário de hoje já passou. Escolha outro disponível." }, { status: 409 });
    }

    if (message === "DAY_FULL") {
      return NextResponse.json({ error: "Este dia já atingiu o limite de atendimentos." }, { status: 409 });
    }

    if (message === "DATE_BLOCKED") {
      return NextResponse.json({ error: "Essa data foi bloqueada para atendimento. Escolha outro dia." }, { status: 409 });
    }

    if (message === "SLOT_TAKEN") {
      return NextResponse.json({ error: "Este horário acabou de ser reservado. Escolha outro." }, { status: 409 });
    }

    if (message === "INVALID_SLOT") {
      return NextResponse.json({ error: "Esse horário não está disponível para a data escolhida." }, { status: 409 });
    }

    if (message === "COUPON_INVALID") {
      return NextResponse.json({ error: "Cupom inválido." }, { status: 400 });
    }

    if (message === "COUPON_MINIMUM") {
      return NextResponse.json({ error: "O cupom informado exige um valor mínimo de pedido." }, { status: 400 });
    }

    return NextResponse.json({ error: "Não foi possível criar o pedido." }, { status: 500 });
  }
}
