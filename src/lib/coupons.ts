import { formatBRL } from "./catalog";

export type CouponKind = "fixed" | "percentage";

export type DiscountCoupon = {
  code: string;
  label: string;
  description: string;
  kind: CouponKind;
  value: number;
  minimumSubtotal: number;
  active: boolean;
};

export type CouponResolution =
  | {
      ok: true;
      code: string;
      label: string;
      description: string;
      discount: number;
    }
  | {
      ok: false;
      code: string;
      error: "COUPON_INVALID" | "COUPON_MINIMUM";
      message: string;
    };

// Cupons padrÃ£o usados como fallback e primeira carga do Firestore.
export const DEFAULT_DISCOUNT_COUPONS: DiscountCoupon[] = [
  {
    code: "BEMVINDO10",
    label: "10% OFF",
    description: "10% de desconto no primeiro fechamento a partir de R$ 80.",
    kind: "percentage",
    value: 10,
    minimumSubtotal: 80,
    active: true
  },
  {
    code: "SISTALVO15",
    label: "R$ 15 OFF",
    description: "Desconto fixo de R$ 15 para pedidos a partir de R$ 120.",
    kind: "fixed",
    value: 15,
    minimumSubtotal: 120,
    active: true
  }
];

export function normalizeCouponCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCouponKind(value: unknown): CouponKind {
  return value === "fixed" ? "fixed" : "percentage";
}

function normalizeCouponNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function cleanCouponText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || fallback;
}

export function findCouponInList(coupons: DiscountCoupon[], code: string) {
  const normalized = normalizeCouponCode(code);
  return coupons.find((coupon) => coupon.active && coupon.code === normalized) || null;
}

export function findCoupon(code: string, coupons: DiscountCoupon[] = DEFAULT_DISCOUNT_COUPONS) {
  return findCouponInList(coupons, code);
}

export function formatCouponValue(coupon: Pick<DiscountCoupon, "kind" | "value">) {
  return coupon.kind === "percentage" ? `${coupon.value}% OFF` : `${formatBRL(coupon.value)} OFF`;
}

export function normalizeDiscountCouponRecord(id: string, value: unknown): DiscountCoupon {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const code = normalizeCouponCode(source.code || id);
  const kind = normalizeCouponKind(source.kind);
  const valueNumber = Math.max(0, normalizeCouponNumber(source.value, 0));
  const minimumSubtotal = Math.max(0, normalizeCouponNumber(source.minimumSubtotal, 0));

  return {
    code,
    label: cleanCouponText(source.label, formatCouponValue({ kind, value: valueNumber })),
    description: cleanCouponText(source.description, "Cupom promocional."),
    kind,
    value: valueNumber,
    minimumSubtotal,
    active: source.active !== false
  };
}

export function sortDiscountCoupons(coupons: DiscountCoupon[]) {
  return [...coupons].sort((left, right) => left.code.localeCompare(right.code));
}

export function resolveCouponFromList(
  subtotal: number,
  rawCode: string,
  coupons: DiscountCoupon[] = DEFAULT_DISCOUNT_COUPONS
): CouponResolution {
  const code = normalizeCouponCode(rawCode);

  if (!code) {
    return {
      ok: true,
      code: "",
      label: "",
      description: "",
      discount: 0
    };
  }

  const coupon = findCoupon(code, coupons);

  if (!coupon) {
    return {
      ok: false,
      code,
      error: "COUPON_INVALID",
      message: "Cupom inválido."
    };
  }

  if (subtotal < coupon.minimumSubtotal) {
    return {
      ok: false,
      code,
      error: "COUPON_MINIMUM",
      message: `Esse cupom exige pedido mínimo de ${formatBRL(coupon.minimumSubtotal)}.`
    };
  }

  const rawDiscount = coupon.kind === "percentage" ? subtotal * (coupon.value / 100) : coupon.value;
  const discount = Math.min(subtotal, Math.round(rawDiscount * 100) / 100);

  return {
    ok: true,
    code: coupon.code,
    label: coupon.label || formatCouponValue(coupon),
    description: coupon.description,
    discount
  };
}

export function resolveCoupon(subtotal: number, rawCode: string): CouponResolution {
  return resolveCouponFromList(subtotal, rawCode, DEFAULT_DISCOUNT_COUPONS);
}
