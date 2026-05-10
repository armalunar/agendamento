import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_ACCESS_COOKIE_NAME = "pc_admin_access";

type CookieStoreLike = {
  get(name: string): { value?: string } | string | undefined;
};

function readCookie(store: CookieStoreLike, name: string) {
  const cookie = store.get(name);

  if (typeof cookie === "string") {
    return cookie;
  }

  return cookie?.value || "";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeCompare(left: string, right: string) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function getAdminRouteSecret() {
  return process.env.ADMIN_ROUTE_SECRET?.trim() || "";
}

export function hasAdminRouteSecretConfigured() {
  return Boolean(getAdminRouteSecret());
}

export function matchesAdminRouteSecret(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  const expected = getAdminRouteSecret();

  if (!expected) {
    return false;
  }

  return safeCompare(value.trim(), expected);
}

export function getAdminAccessCookieValue() {
  const secret = getAdminRouteSecret();
  return secret ? sha256(secret) : "";
}

export function hasAdminAccess(store: CookieStoreLike) {
  const expected = getAdminAccessCookieValue();
  const current = readCookie(store, ADMIN_ACCESS_COOKIE_NAME);

  if (!expected) {
    return false;
  }

  return safeCompare(current, expected);
}

export function hasAdminAccessFromRequest(request: NextRequest) {
  return hasAdminAccess(request.cookies);
}

export function getAdminAccessCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  };
}
