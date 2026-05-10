import { FieldValue } from "firebase-admin/firestore";
import { DAILY_LIMIT, SCHEDULE_SLOTS, buildCatalogPriceLabel, isValidScheduleSlot, type ServiceId, selectedServices, servicesTotal } from "./catalog";
import { listDiscountCoupons } from "./couponStore";
import { resolveCouponFromList } from "./coupons";
import {
  buildSystemProfileList,
  describeSystemProfile,
  normalizeEquipmentType,
  normalizeSystemProfile,
  type EquipmentType,
  type SystemProfileInput
} from "./deviceProfile";
import { formatDateBR, formatDateTimeBR, getBusinessTodayISO, isPastBusinessDate, isScheduleSlotPast } from "./date";
import { adminDb } from "./firebaseAdmin";
import type {
  AttachmentCategory,
  DeliveryStatus,
  OrderAttachment,
  OrderCompletion,
  OrderCustomer,
  OrderDelivery,
  OrderHistoryEntry,
  OrderPayment,
  OrderPricing,
  OrderRecord,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ServiceLine
} from "./orderShared";

export type CreateOrderInput = {
  name: string;
  phone: string;
  city: string;
  date: string;
  slot: string;
  couponCode?: string;
  paymentMethod: PaymentMethod;
  equipment: EquipmentType;
  issue: string;
  systemProfile: SystemProfileInput;
  services: ServiceId[];
};

export type AvailabilityDay = {
  date: string;
  bookedCount: number;
  limit: number;
  isBlocked: boolean;
  blockedReason: string;
  customSlots: string[];
  slots: Array<{
    slot: string;
    available: boolean;
    orderCode: string | null;
  }>;
};

const DEFAULT_PAYMENT_METHOD: PaymentMethod = "pix";

function normalizePaymentMethod(value: unknown): PaymentMethod {
  if (value === "card" || value === "cash") {
    return value;
  }

  return "pix";
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

function normalizeNumber(value: unknown, fallback = 0) {
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

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSlotList(value: unknown) {
  const rawSlots = normalizeStringList(value);
  const slots = rawSlots.filter((slot) => /^\d{2}:\d{2}$/.test(slot));
  const uniqueSlots = [...new Set(slots)];

  return uniqueSlots.sort((left, right) => left.localeCompare(right));
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanText(value: unknown, fallback = "Não informado") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || fallback;
}

type PricingComputationInput = {
  extras?: number;
  manualDiscount?: number;
  couponDiscount?: number;
  couponCode?: string;
  couponLabel?: string;
  couponDescription?: string;
  extrasDescription?: string;
};

export function computePricing(baseTotal: number, input: PricingComputationInput = {}): OrderPricing {
  const safeBase = Math.max(0, normalizeNumber(baseTotal, 0));
  const safeExtras = Math.max(0, normalizeNumber(input.extras, 0));
  const safeManualDiscount = Math.max(0, normalizeNumber(input.manualDiscount, 0));
  const safeCouponDiscount = Math.max(0, normalizeNumber(input.couponDiscount, 0));
  const safeDiscount = safeManualDiscount + safeCouponDiscount;
  const finalTotal = Math.max(0, safeBase + safeExtras - safeDiscount);

  return {
    baseTotal: safeBase,
    extras: safeExtras,
    manualDiscount: safeManualDiscount,
    couponDiscount: safeCouponDiscount,
    discount: safeDiscount,
    couponCode: cleanText(input.couponCode, ""),
    couponLabel: cleanText(input.couponLabel, ""),
    couponDescription: cleanText(input.couponDescription, ""),
    extrasDescription: cleanText(input.extrasDescription, ""),
    finalTotal
  };
}

export function createOrderHistoryEntry(type: string, label: string, note = "", actor = "Sistema"): OrderHistoryEntry {
  return {
    id: createId("evt"),
    type,
    label,
    note: cleanText(note, ""),
    actor: cleanText(actor, "Sistema"),
    createdAt: new Date().toISOString()
  };
}

export function generateOrderCode(date: string) {
  const stamp = date.replaceAll("-", "");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `OS-${stamp}-${random}`;
}

function defaultPayment(source: Record<string, unknown> | null, baseTotal: number): OrderPayment {
  const status = source?.status;
  const normalizedStatus: PaymentStatus = status === "paid" || status === "partial" ? status : "pending";
  const amountPaid = Math.min(Math.max(0, normalizeNumber(source?.amountPaid, 0)), baseTotal + 100000);

  return {
    status: normalizedStatus,
    method: normalizePaymentMethod(source?.method),
    amountPaid,
    paidAt: serializeTimestamp(source?.paidAt)
  };
}

function defaultCompletion(source: Record<string, unknown> | null): OrderCompletion {
  const legacyNotes = source ? cleanText(source.notes, "") : "";

  return {
    clientNotes: cleanText(source?.clientNotes, legacyNotes),
    privateNotes: cleanText(source?.privateNotes, ""),
    diagnosis: cleanText(source?.diagnosis, ""),
    solution: cleanText(source?.solution, ""),
    checklist: cleanText(source?.checklist, ""),
    warranty: cleanText(source?.warranty, ""),
    completedAt: serializeTimestamp(source?.completedAt)
  };
}

function defaultDelivery(source: Record<string, unknown> | null): OrderDelivery {
  const status = source?.status;
  const normalizedStatus: DeliveryStatus = status === "delivered" ? "delivered" : "pending";

  return {
    status: normalizedStatus,
    deliveredAt: serializeTimestamp(source?.deliveredAt),
    recipientName: cleanText(source?.recipientName, ""),
    confirmation: cleanText(source?.confirmation, "")
  };
}

function normalizeAttachments(value: unknown): OrderAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => {
      const category = item.category;
      const normalizedCategory: AttachmentCategory =
        category === "after" || category === "document" ? category : "before";

      return {
        id: cleanText(item.id, createId("file")),
        name: cleanText(item.name, "Arquivo"),
        url: cleanText(item.url, ""),
        category: normalizedCategory,
        createdAt: serializeTimestamp(item.createdAt)
      };
    })
    .filter((item) => item.url);
}

function normalizeHistory(value: unknown): OrderHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      id: cleanText(item.id, createId("evt")),
      type: cleanText(item.type, "update"),
      label: cleanText(item.label, "Atualização"),
      note: cleanText(item.note, ""),
      actor: cleanText(item.actor, "Sistema"),
      createdAt: serializeTimestamp(item.createdAt) || new Date().toISOString()
    }))
    .sort((left, right) => (left.createdAt || "").localeCompare(right.createdAt || ""));
}

function normalizeStatus(value: unknown): OrderStatus {
  return value === "completed" || value === "cancelled" ? value : "open";
}

function normalizeServices(value: unknown): ServiceLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => {
      const price = normalizeNumber(item.price, 0);

      return {
        id: item.id as ServiceId,
        name: cleanText(item.name),
        price,
        priceLabel: cleanText(item.priceLabel, buildCatalogPriceLabel({ price, priceLabel: "", priceMode: "fixed" }))
      };
    });
}

function serializeTimestamp(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  return null;
}

export function normalizeOrderRecord(id: string, value: unknown): OrderRecord {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const customer = typeof source.customer === "object" && source.customer !== null ? (source.customer as Record<string, unknown>) : {};
  const schedule = typeof source.schedule === "object" && source.schedule !== null ? (source.schedule as Record<string, unknown>) : {};
  const payment = typeof source.payment === "object" && source.payment !== null ? (source.payment as Record<string, unknown>) : null;
  const pricingSource = typeof source.pricing === "object" && source.pricing !== null ? (source.pricing as Record<string, unknown>) : null;
  const completionSource = typeof source.completion === "object" && source.completion !== null ? (source.completion as Record<string, unknown>) : null;
  const deliverySource = typeof source.delivery === "object" && source.delivery !== null ? (source.delivery as Record<string, unknown>) : null;
  const services = normalizeServices(source.services);
  const baseTotal = pricingSource ? normalizeNumber(pricingSource.baseTotal, services.reduce((sum, service) => sum + service.price, 0)) : normalizeNumber(source.total, services.reduce((sum, service) => sum + service.price, 0));
  const pricing = computePricing(
    baseTotal,
    {
      extras: pricingSource ? normalizeNumber(pricingSource.extras, 0) : 0,
      manualDiscount: pricingSource
        ? "manualDiscount" in pricingSource
          ? normalizeNumber(pricingSource.manualDiscount, 0)
          : normalizeNumber(pricingSource.discount, 0)
        : 0,
      couponDiscount: pricingSource ? normalizeNumber(pricingSource.couponDiscount, 0) : 0,
      couponCode: pricingSource ? cleanText(pricingSource.couponCode, "") : "",
      couponLabel: pricingSource ? cleanText(pricingSource.couponLabel, "") : "",
      couponDescription: pricingSource ? cleanText(pricingSource.couponDescription, "") : "",
      extrasDescription: pricingSource ? cleanText(pricingSource.extrasDescription, "") : ""
    }
  );
  const finalTotal = pricingSource?.finalTotal ? Math.max(0, normalizeNumber(pricingSource.finalTotal, pricing.finalTotal)) : pricing.finalTotal;
  pricing.finalTotal = finalTotal;
  pricing.discount = pricing.manualDiscount + pricing.couponDiscount;

  return {
    id,
    orderCode: cleanText(source.orderCode, id),
    status: normalizeStatus(source.status),
    isArchived: normalizeBoolean(source.isArchived),
    archivedAt: serializeTimestamp(source.archivedAt),
    services,
    total: normalizeNumber(source.total, finalTotal),
    pricing,
    payment: defaultPayment(payment, finalTotal),
    schedule: {
      date: cleanText(schedule.date, getBusinessTodayISO()),
      slot: cleanText(schedule.slot, "")
    },
    customer: {
      name: cleanText(customer.name, "Cliente"),
      phone: cleanText(customer.phone),
      city: cleanText(customer.city),
      equipment: normalizeEquipmentType(customer.equipment),
      issue: cleanText(customer.issue),
      systemProfile: normalizeSystemProfile(customer.systemProfile)
    },
    completion: defaultCompletion(completionSource),
    delivery: defaultDelivery(deliverySource),
    attachments: normalizeAttachments(source.attachments),
    history: normalizeHistory(source.history),
    createdAt: serializeTimestamp(source.createdAt),
    updatedAt: serializeTimestamp(source.updatedAt)
  };
}

export async function createOrder(input: CreateOrderInput) {
  const orderCode = generateOrderCode(input.date);
  const dayRef = adminDb.collection("availability").doc(input.date);
  const orderRef = adminDb.collection("orders").doc(orderCode);
  const systemProfile = normalizeSystemProfile(input.systemProfile);
  const services = selectedServices(input.services).map(({ id, name, price, priceLabel }) => ({ id, name, price, priceLabel }));
  const baseTotal = servicesTotal(input.services);
  const activeCoupons = await listDiscountCoupons(false);
  const coupon = resolveCouponFromList(baseTotal, input.couponCode || "", activeCoupons);

  if (!coupon.ok) {
    throw new Error(coupon.error);
  }

  const pricing = computePricing(baseTotal, {
    couponDiscount: coupon.discount,
    couponCode: coupon.code,
    couponLabel: coupon.label,
    couponDescription: coupon.description
  });
  const createdHistory = createOrderHistoryEntry(
    "created",
    "Ordem criada",
    [
      `Agendamento aberto para ${formatDateBR(input.date)} às ${input.slot}.`,
      coupon.code ? `Cupom ${coupon.code} aplicado.` : ""
    ]
      .filter(Boolean)
      .join(" "),
    "Site"
  );

  if (isPastBusinessDate(input.date)) {
    throw new Error("DATE_PAST");
  }

  if (!isValidScheduleSlot(input.slot)) {
    throw new Error("INVALID_SLOT");
  }

  if (isScheduleSlotPast(input.date, input.slot)) {
    throw new Error("SLOT_PASSED");
  }

  const payload = {
    orderCode,
    status: "open" as OrderStatus,
    isArchived: false,
    archivedAt: null,
    services,
    total: pricing.finalTotal,
    pricing,
    payment: {
      status: "pending" as PaymentStatus,
      method: normalizePaymentMethod(input.paymentMethod),
      amountPaid: 0,
      paidAt: null
    },
    schedule: {
      date: input.date,
      slot: input.slot
    },
    customer: {
      name: input.name,
      phone: input.phone,
      city: input.city,
      equipment: input.equipment,
      issue: input.issue,
      systemProfile
    },
    completion: {
      clientNotes: "",
      privateNotes: "",
      diagnosis: "",
      solution: "",
      checklist: "",
      warranty: "",
      completedAt: null
    },
    delivery: {
      status: "pending" as DeliveryStatus,
      deliveredAt: null,
      recipientName: "",
      confirmation: ""
    },
    attachments: [],
    history: [createdHistory],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  await adminDb.runTransaction(async (transaction) => {
    const daySnap = await transaction.get(dayRef);
    const dayData = daySnap.exists ? daySnap.data() || {} : {};
    const bookedCount = Number(dayData.bookedCount || 0);
    const slots = (dayData.slots || {}) as Record<string, string>;
    const customSlots = normalizeSlotList(dayData.customSlots);
    const daySlots = customSlots.length ? customSlots : [...SCHEDULE_SLOTS];
    const isBlocked = dayData.isBlocked === true;

    if (isBlocked) {
      throw new Error("DATE_BLOCKED");
    }

    if (bookedCount >= DAILY_LIMIT) {
      throw new Error("DAY_FULL");
    }

    if (isScheduleSlotPast(input.date, input.slot)) {
      throw new Error("SLOT_PASSED");
    }

    if (!daySlots.includes(input.slot)) {
      throw new Error("INVALID_SLOT");
    }

    if (slots[input.slot]) {
      throw new Error("SLOT_TAKEN");
    }

    transaction.set(orderRef, payload);
    transaction.set(
      dayRef,
      {
        date: input.date,
        bookedCount: bookedCount + 1,
        slots: {
          ...slots,
          [input.slot]: orderCode
        },
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });

  return normalizeOrderRecord(orderCode, payload);
}

export async function getAvailability(date: string): Promise<AvailabilityDay> {
  if (isPastBusinessDate(date)) {
    return {
      date,
      bookedCount: 0,
      limit: DAILY_LIMIT,
      isBlocked: false,
      blockedReason: "",
      customSlots: [],
      slots: SCHEDULE_SLOTS.map((slot) => ({
        slot,
        available: false,
        orderCode: null
      }))
    };
  }

  const daySnap = await adminDb.collection("availability").doc(date).get();
  const data = daySnap.exists ? daySnap.data() || {} : {};
  const slots = (data.slots || {}) as Record<string, string>;
  const customSlots = normalizeSlotList(data.customSlots);
  const daySlots = customSlots.length ? customSlots : [...SCHEDULE_SLOTS];
  const isBlocked = data.isBlocked === true;
  const blockedReason = cleanText(data.blockedReason, "");

  return {
    date,
    bookedCount: Number(data.bookedCount || 0),
    limit: DAILY_LIMIT,
    isBlocked,
    blockedReason,
    customSlots,
    slots: daySlots.map((slot) => ({
      slot,
      available: !isBlocked && !slots[slot] && !isScheduleSlotPast(date, slot),
      orderCode: slots[slot] || null
    }))
  };
}

export async function listUpcomingAvailability(fromDate: string, days: number) {
  const results: AvailabilityDay[] = [];
  const base = new Date(`${fromDate}T12:00:00`);

  for (let offset = 0; offset < days; offset += 1) {
    const nextDate = new Date(base);
    nextDate.setDate(base.getDate() + offset);
    const iso = nextDate.toISOString().slice(0, 10);
    const availability = await getAvailability(iso);
    results.push(availability);
  }

  return results;
}

export function buildOrderScheduleLabel(order: OrderRecord) {
  return `${formatDateBR(order.schedule.date)} as ${order.schedule.slot}`;
}

export function buildOrderTechnicalSummary(order: OrderRecord) {
  return {
    systemProfile: describeSystemProfile(order.customer.systemProfile),
    systemFields: buildSystemProfileList(order.customer.systemProfile)
  };
}

export function buildCompletionLabel(order: OrderRecord) {
  if (!order.completion.completedAt) {
    return "Ainda não concluído";
  }

  return formatDateTimeBR(order.completion.completedAt);
}
