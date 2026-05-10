import { NextResponse } from "next/server";
import { listDiscountCoupons } from "@/lib/couponStore";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET() {
  try {
    const coupons = await listDiscountCoupons(false);
    return NextResponse.json({ coupons }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ coupons: [] }, { headers: NO_STORE_HEADERS });
  }
}
