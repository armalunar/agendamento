import { NextRequest, NextResponse } from "next/server";
import { recordAdminAudit } from "@/lib/adminAudit";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  getAdminAccessCookieOptions,
  getAdminAccessCookieValue,
  hasAdminAccessFromRequest,
  hasAdminRouteSecretConfigured,
  matchesAdminRouteSecret
} from "@/lib/adminAccess";

export const runtime = "nodejs";

const ACCESS_LIMIT = 5;
const ACCESS_WINDOW_MS = 10 * 60 * 1000;
const accessAttempts = new Map<string, { count: number; blockedUntil: number; updatedAt: number }>();

function getAccessKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for") || "local";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return `${forwarded.split(",")[0].trim()}::${userAgent.slice(0, 80)}`;
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    configured: hasAdminRouteSecretConfigured(),
    unlocked: hasAdminAccessFromRequest(request)
  });
}

export async function POST(request: NextRequest) {
  if (!hasAdminRouteSecretConfigured()) {
    return NextResponse.json(
      { error: "Configure ADMIN_ROUTE_SECRET no servidor para liberar o painel." },
      { status: 503 }
    );
  }

  const key = getAccessKey(request);
  const now = Date.now();
  const currentAttempt = accessAttempts.get(key);

  if (currentAttempt?.blockedUntil && currentAttempt.blockedUntil > now) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em alguns minutos." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));

  if (!matchesAdminRouteSecret(body.secret)) {
    const nextCount =
      currentAttempt && now - currentAttempt.updatedAt < ACCESS_WINDOW_MS ? currentAttempt.count + 1 : 1;
    const blockedUntil = nextCount >= ACCESS_LIMIT ? now + ACCESS_WINDOW_MS : 0;

    accessAttempts.set(key, {
      count: nextCount,
      blockedUntil,
      updatedAt: now
    });

    void recordAdminAudit(
      "admin-access-failed",
      "Tentativa falhou no painel privado",
      blockedUntil
        ? "Bloqueio temporário ativado por excesso de tentativas."
        : `Tentativa inválida número ${nextCount}.`,
      "Sistema"
    );

    return NextResponse.json({ error: "Chave de acesso inválida." }, { status: 401 });
  }

  accessAttempts.delete(key);
  void recordAdminAudit("admin-access-success", "Painel privado liberado", "Chave privada validada com sucesso.", "Sistema");
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_ACCESS_COOKIE_NAME, getAdminAccessCookieValue(), getAdminAccessCookieOptions());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_ACCESS_COOKIE_NAME, "", {
    ...getAdminAccessCookieOptions(),
    maxAge: 0
  });
  return response;
}
