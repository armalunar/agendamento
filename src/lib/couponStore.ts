import { FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_DISCOUNT_COUPONS,
  normalizeCouponCode,
  normalizeDiscountCouponRecord,
  sortDiscountCoupons,
  type CouponKind,
  type DiscountCoupon
} from "./coupons";
import { adminDb } from "./firebaseAdmin";

const COUPON_COLLECTION = "discountCoupons";

type CouponInput = {
  code: string;
  label: string;
  description: string;
  kind: CouponKind;
  value: number;
  minimumSubtotal: number;
  active: boolean;
};

function couponCollection() {
  return adminDb.collection(COUPON_COLLECTION);
}

async function seedDefaultCouponsIfNeeded() {
  const snapshot = await couponCollection().limit(1).get();

  if (!snapshot.empty) {
    return;
  }

  const batch = adminDb.batch();

  for (const coupon of DEFAULT_DISCOUNT_COUPONS) {
    const ref = couponCollection().doc(coupon.code);
    batch.set(ref, {
      ...coupon,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  await batch.commit();
}

function normalizeCouponInput(input: CouponInput) {
  const code = normalizeCouponCode(input.code);
  const kind: CouponKind = input.kind === "fixed" ? "fixed" : "percentage";
  const value = Math.max(0, Number(input.value) || 0);
  const minimumSubtotal = Math.max(0, Number(input.minimumSubtotal) || 0);
  const label = String(input.label || "").trim() || (kind === "percentage" ? `${value}% OFF` : `R$ ${value} OFF`);
  const description = String(input.description || "").trim() || "Cupom promocional.";

  return {
    code,
    label,
    description,
    kind,
    value,
    minimumSubtotal,
    active: input.active !== false
  } satisfies DiscountCoupon;
}

export async function listDiscountCoupons(includeInactive = true) {
  await seedDefaultCouponsIfNeeded();

  const snapshot = await couponCollection().get();
  const coupons = sortDiscountCoupons(snapshot.docs.map((doc) => normalizeDiscountCouponRecord(doc.id, doc.data())));

  return includeInactive ? coupons : coupons.filter((coupon) => coupon.active);
}

export async function saveDiscountCoupon(input: CouponInput) {
  const coupon = normalizeCouponInput(input);

  if (!coupon.code) {
    throw new Error("COUPON_CODE_REQUIRED");
  }

  if (coupon.value <= 0) {
    throw new Error("COUPON_VALUE_INVALID");
  }

  await adminDb.runTransaction(async (transaction) => {
    const ref = couponCollection().doc(coupon.code);
    const snapshot = await transaction.get(ref);

    transaction.set(
      ref,
      {
        ...coupon,
        updatedAt: FieldValue.serverTimestamp(),
        ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
      },
      { merge: true }
    );
  });

  return coupon;
}

export async function setDiscountCouponActive(code: string, active: boolean) {
  const normalizedCode = normalizeCouponCode(code);

  if (!normalizedCode) {
    throw new Error("COUPON_CODE_REQUIRED");
  }

  const ref = couponCollection().doc(normalizedCode);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new Error("COUPON_NOT_FOUND");
  }

  await ref.set(
    {
      active,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return normalizeDiscountCouponRecord(snapshot.id, {
    ...snapshot.data(),
    active
  });
}
