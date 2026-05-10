import { NextRequest, NextResponse } from "next/server";
import { recordAdminAudit } from "@/lib/adminAudit";
import { saveDiscountCoupon, listDiscountCoupons, setDiscountCouponActive } from "@/lib/couponStore";
import { verifyAdminRequest } from "@/lib/adminGuard";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest) {
  try {
    await verifyAdminRequest(request);
    const coupons = await listDiscountCoupons(true);
    return NextResponse.json({ coupons }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401, headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const actor = decoded.name || decoded.email || "Admin";
    const coupon = await saveDiscountCoupon({
      code: body.code,
      label: body.label,
      description: body.description,
      kind: body.kind === "fixed" ? "fixed" : "percentage",
      value: Number(body.value) || 0,
      minimumSubtotal: Number(body.minimumSubtotal) || 0,
      active: body.active !== false
    });

    await recordAdminAudit("coupon-saved", "Cupom salvo", `Cupom ${coupon.code} salvo no painel administrativo.`, actor);

    return NextResponse.json({ coupon }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "COUPON_CODE_REQUIRED") {
      return NextResponse.json({ error: "Informe o código do cupom." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (message === "COUPON_VALUE_INVALID") {
      return NextResponse.json({ error: "Informe um valor válido para o cupom." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Não foi possível salvar o cupom." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const decoded = await verifyAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const actor = decoded.name || decoded.email || "Admin";
    const coupon = await setDiscountCouponActive(String(body.code || ""), body.active === true);

    await recordAdminAudit(
      "coupon-status",
      coupon.active ? "Cupom ativado" : "Cupom desativado",
      `Cupom ${coupon.code} ${coupon.active ? "ativado" : "desativado"} no painel administrativo.`,
      actor
    );

    return NextResponse.json({ coupon }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "COUPON_CODE_REQUIRED") {
      return NextResponse.json({ error: "Informe o código do cupom." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (message === "COUPON_NOT_FOUND") {
      return NextResponse.json({ error: "Cupom não encontrado." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Não foi possível atualizar o cupom." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
