import { buildCatalogPriceLabel, type ServiceId } from "./catalog";
import { buildSystemProfileList, describeSystemProfile, type EquipmentType, type SystemProfile } from "./deviceProfile";
import { formatDateBR, formatDateTimeBR } from "./date";

export type OrderStatus = "open" | "completed" | "cancelled";
export type PaymentStatus = "pending" | "partial" | "paid";
export type PaymentMethod = "pix" | "card" | "cash";
export type DeliveryStatus = "pending" | "delivered";
export type AttachmentCategory = "before" | "after" | "document";

export type ServiceLine = {
  id: ServiceId;
  name: string;
  price: number;
  priceLabel: string;
};

export type OrderPayment = {
  status: PaymentStatus;
  method: PaymentMethod;
  amountPaid: number;
  paidAt: string | null;
};

export type OrderPricing = {
  baseTotal: number;
  extras: number;
  manualDiscount: number;
  couponDiscount: number;
  discount: number;
  couponCode: string;
  couponLabel: string;
  couponDescription: string;
  extrasDescription: string;
  finalTotal: number;
};

export type OrderCompletion = {
  clientNotes: string;
  privateNotes: string;
  diagnosis: string;
  solution: string;
  checklist: string;
  warranty: string;
  completedAt: string | null;
};

export type OrderDelivery = {
  status: DeliveryStatus;
  deliveredAt: string | null;
  recipientName: string;
  confirmation: string;
};

export type OrderAttachment = {
  id: string;
  name: string;
  url: string;
  category: AttachmentCategory;
  createdAt: string | null;
};

export type OrderHistoryEntry = {
  id: string;
  type: string;
  label: string;
  note: string;
  actor: string;
  createdAt: string | null;
};

export type OrderCustomer = {
  name: string;
  phone: string;
  city: string;
  equipment: EquipmentType;
  issue: string;
  systemProfile: SystemProfile;
};

export type OrderRecord = {
  id: string;
  orderCode: string;
  status: OrderStatus;
  isArchived: boolean;
  archivedAt: string | null;
  services: ServiceLine[];
  total: number;
  pricing: OrderPricing;
  payment: OrderPayment;
  schedule: {
    date: string;
    slot: string;
  };
  customer: OrderCustomer;
  completion: OrderCompletion;
  delivery: OrderDelivery;
  attachments: OrderAttachment[];
  history: OrderHistoryEntry[];
  createdAt: string | null;
  updatedAt: string | null;
};

export function buildOrderScheduleLabel(order: OrderRecord) {
  return `${formatDateBR(order.schedule.date)} às ${order.schedule.slot}`;
}

export function buildOrderTechnicalSummary(order: OrderRecord) {
  return {
    systemProfile: describeSystemProfile(order.customer.systemProfile),
    systemFields: buildSystemProfileList(order.customer.systemProfile)
  };
}

export function buildCompletionLabel(order: OrderRecord) {
  if (!order.completion.completedAt) {
    return "Ainda não concluída";
  }

  return formatDateTimeBR(order.completion.completedAt);
}

export function buildPaymentStatusLabel(status: PaymentStatus) {
  if (status === "paid") return "Pago";
  if (status === "partial") return "Parcial";
  return "Pendente";
}

export function buildPaymentMethodLabel(method: PaymentMethod) {
  if (method === "card") return "Cartão";
  if (method === "cash") return "Dinheiro";
  return "Pix";
}

export function buildDeliveryStatusLabel(status: DeliveryStatus) {
  return status === "delivered" ? "Entregue" : "Aguardando entrega";
}

export function buildArchiveStatusLabel(order: OrderRecord) {
  return order.isArchived ? "Arquivada" : "Ativa";
}

export function buildServicePriceLabel(service: Pick<ServiceLine, "price" | "priceLabel">) {
  return service.priceLabel?.trim() || buildCatalogPriceLabel({ price: service.price, priceLabel: "", priceMode: "fixed" });
}
