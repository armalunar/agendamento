import { NextRequest, NextResponse } from "next/server";
import { isValidDateString } from "@/lib/catalog";
import { getAvailability } from "@/lib/orders";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || "";

  if (!isValidDateString(date)) {
    return NextResponse.json({ error: "Data inválida." }, { status: 400 });
  }

  const availability = await getAvailability(date);
  return NextResponse.json(availability);
}
