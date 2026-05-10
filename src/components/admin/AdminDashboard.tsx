"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User
} from "firebase/auth";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import AdminChatInbox from "@/components/admin/AdminChatInbox";
import { getAdminPhotoStoragePath } from "@/lib/adminProfileShared";
import { auth, storage } from "@/lib/firebaseClient";
import { SCHEDULE_SLOTS, formatBRL, SERVICES, type ServiceId } from "@/lib/catalog";
import { formatCouponValue, normalizeCouponCode, type CouponKind, type DiscountCoupon } from "@/lib/coupons";
import { formatDateBR, formatDateTimeBR, getBusinessTodayISO } from "@/lib/date";
import { getEquipmentLabel, type EquipmentType } from "@/lib/deviceProfile";
import {
  buildCompletionLabel,
  buildDeliveryStatusLabel,
  buildOrderTechnicalSummary,
  buildPaymentMethodLabel,
  buildPaymentStatusLabel,
  buildServicePriceLabel,
  type AttachmentCategory,
  type DeliveryStatus,
  type OrderRecord,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus
} from "@/lib/orderShared";

type StatusFilter = "all" | OrderStatus;
type ArchiveFilter = "all" | "active" | "archived";
type PaymentFilter = "all" | PaymentStatus;
type DeliveryFilter = "all" | DeliveryStatus;

type CalendarDay = {
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

type AuditEntry = {
  id: string;
  type: string;
  label: string;
  details: string;
  actor: string;
  createdAt: string;
};

type PricingDraft = {
  extras: string;
  discount: string;
  extrasDescription: string;
};

type PaymentDraft = {
  status: PaymentStatus;
  amountPaid: string;
  method: PaymentMethod;
};

type CompletionDraft = {
  clientNotes: string;
  privateNotes: string;
  diagnosis: string;
  solution: string;
  checklist: string;
  warranty: string;
};

type DeliveryDraft = {
  status: DeliveryStatus;
  recipientName: string;
  confirmation: string;
};

type CouponDraft = {
  code: string;
  label: string;
  description: string;
  kind: CouponKind;
  value: string;
  minimumSubtotal: string;
  active: boolean;
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "open", label: "Abertas" },
  { value: "completed", label: "Concluídas" },
  { value: "cancelled", label: "Canceladas" }
];

const DEFAULT_CUSTOM_SLOTS = [...SCHEDULE_SLOTS];
const ADMIN_PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const ADMIN_PROFILE_PHOTO_OUTPUT_MAX_BYTES = 120 * 1024;
const ADMIN_PROFILE_PHOTO_MAX_DIMENSION = 160;
const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "pix", label: "Pix" },
  { value: "card", label: "Cartão" },
  { value: "cash", label: "Dinheiro" }
];

const DEFAULT_COUPON_DRAFT: CouponDraft = {
  code: "",
  label: "",
  description: "",
  kind: "percentage",
  value: "10",
  minimumSubtotal: "0",
  active: true
};

function statusLabel(status: OrderRecord["status"]) {
  if (status === "completed") return "Concluída";
  if (status === "cancelled") return "Cancelada";
  return "Aberta";
}

function normalizeSearchValue(value: string) {
  return value.toLowerCase().trim();
}

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function parseCurrencyInput(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCustomSlots(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{2}:\d{2}$/.test(item))
    .sort();
}

function makeAttachmentId() {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function base64ByteLength(dataUrl: string) {
  const payload = dataUrl.split(",", 2)[1] || "";
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("NÃ£o foi possÃ­vel ler a imagem selecionada."));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("NÃ£o foi possÃ­vel preparar a imagem selecionada."));
    image.src = dataUrl;
  });
}

async function buildAdminProfilePhotoDataUrl(file: File) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);
  const canvas = document.createElement("canvas");
  const ratio = Math.min(1, ADMIN_PROFILE_PHOTO_MAX_DIMENSION / Math.max(image.width, image.height));

  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("NÃ£o foi possÃ­vel preparar a imagem selecionada.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const candidateTypes = ["image/webp", "image/jpeg", "image/png"];
  let bestDataUrl = originalDataUrl;
  let bestSize = base64ByteLength(originalDataUrl);

  for (const mimeType of candidateTypes) {
    for (const quality of [0.84, 0.72, 0.6]) {
      const dataUrl = canvas.toDataURL(mimeType, quality);
      const size = base64ByteLength(dataUrl);

      if (size < bestSize) {
        bestDataUrl = dataUrl;
        bestSize = size;
      }

      if (size <= ADMIN_PROFILE_PHOTO_OUTPUT_MAX_BYTES) {
        return dataUrl;
      }
    }
  }

  if (bestSize <= ADMIN_PROFILE_PHOTO_OUTPUT_MAX_BYTES) {
    return bestDataUrl;
  }

  throw new Error("A imagem ficou grande demais em base64. Tente uma foto menor.");
}

function formatPhoneForWhatsApp(phone: string) {
  const digits = normalizePhoneDigits(phone);

  if (!digits) {
    return "";
  }

  return digits.startsWith("55") ? digits : `55${digits}`;
}

function buildAdminWhatsAppMessage(order: OrderRecord) {
  return [
    `Olá, ${order.customer.name}!`,
    "",
    `Sua ordem ${order.orderCode} está em acompanhamento.`,
    `Agendamento: ${formatDateBR(order.schedule.date)} às ${order.schedule.slot}.`,
    `Status atual: ${statusLabel(order.status)}.`,
    `Pagamento: ${buildPaymentStatusLabel(order.payment.status)} via ${buildPaymentMethodLabel(order.payment.method)}.`,
    order.delivery.status === "delivered" ? "Entrega confirmada." : "Entrega ainda pendente.",
    "",
    "Se precisar responder algo, pode mandar por aqui."
  ].join("\n");
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildCsv(orders: OrderRecord[]) {
  const header = [
    "ID",
    "Cliente",
    "Telefone",
    "Cidade",
    "Data",
    "Horário",
    "Status",
    "Pagamento",
    "Valor pago",
    "Entrega",
    "Arquivada",
    "Total",
    "Serviços"
  ];

  const rows = orders.map((order) => [
    order.orderCode,
    order.customer.name,
    order.customer.phone,
    order.customer.city,
    order.schedule.date,
    order.schedule.slot,
    statusLabel(order.status),
    buildPaymentStatusLabel(order.payment.status),
    order.payment.amountPaid.toFixed(2),
    buildDeliveryStatusLabel(order.delivery.status),
    order.isArchived ? "Sim" : "Não",
    order.total.toFixed(2),
    order.services.map((service) => service.name).join(" | ")
  ]);

  return [header, ...rows]
    .map((columns) => columns.map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","))
    .join("\n");
}

function FileCategoryUploader({
  label,
  accept,
  onFiles
}: {
  label: string;
  accept?: string;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <label className="upload-chip">
      <input type="file" accept={accept} multiple onChange={(event) => onFiles(event.target.files)} />
      <span>{label}</span>
    </label>
  );
}

function CopyButton({
  copyKey,
  copiedKey,
  onCopy,
  value,
  label = "Copiar"
}: {
  copyKey: string;
  copiedKey: string;
  onCopy: (key: string, value: string) => void;
  value: string;
  label?: string;
}) {
  return (
    <button className="inline-copy-btn" type="button" onClick={() => onCopy(copyKey, value)}>
      {copiedKey === copyKey ? "Copiado" : label}
    </button>
  );
}

export default function AdminDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentType | "all">("all");
  const [serviceFilter, setServiceFilter] = useState<ServiceId | "all">("all");
  const [selectedDateFilter, setSelectedDateFilter] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [calendarDate, setCalendarDate] = useState(getBusinessTodayISO());
  const [calendarBlocked, setCalendarBlocked] = useState(false);
  const [calendarBlockedReason, setCalendarBlockedReason] = useState("");
  const [calendarCustomSlots, setCalendarCustomSlots] = useState(DEFAULT_CUSTOM_SLOTS.join(", "));
  const [pricingDrafts, setPricingDrafts] = useState<Record<string, PricingDraft>>({});
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, PaymentDraft>>({});
  const [completionDrafts, setCompletionDrafts] = useState<Record<string, CompletionDraft>>({});
  const [deliveryDrafts, setDeliveryDrafts] = useState<Record<string, DeliveryDraft>>({});
  const [historyNoteDrafts, setHistoryNoteDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingProfilePhoto, setSavingProfilePhoto] = useState(false);
  const [removingProfilePhoto, setRemovingProfilePhoto] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [coupons, setCoupons] = useState<DiscountCoupon[]>([]);
  const [couponDraft, setCouponDraft] = useState<CouponDraft>(DEFAULT_COUPON_DRAFT);
  const [savingCoupon, setSavingCoupon] = useState(false);

  const selectedCalendarDay = useMemo(
    () => calendarDays.find((day) => day.date === calendarDate) || null,
    [calendarDate, calendarDays]
  );

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setProfileName(currentUser?.displayName || "");
      setProfileDisplayName(currentUser?.displayName || "");
      setProfilePhotoUrl(currentUser?.photoURL || "");
      setLoading(false);

      if (currentUser) {
        void loadDashboard(currentUser);
      } else {
        setOrders([]);
        setAdminReady(false);
        setProfileName("");
        setProfileDisplayName("");
        setProfilePhotoUrl("");
        setCoupons([]);
        setCouponDraft(DEFAULT_COUPON_DRAFT);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedCalendarDay) {
      return;
    }

    setCalendarBlocked(selectedCalendarDay.isBlocked);
    setCalendarBlockedReason(selectedCalendarDay.blockedReason);
    setCalendarCustomSlots(
      (selectedCalendarDay.customSlots.length ? selectedCalendarDay.customSlots : DEFAULT_CUSTOM_SLOTS).join(", ")
    );
  }, [selectedCalendarDay]);

  async function authHeader(currentUser = auth.currentUser) {
    if (!currentUser) {
      throw new Error("Faça login para continuar.");
    }

    const token = await currentUser.getIdToken(true);
    return { Authorization: `Bearer ${token}` };
  }

  function ensureDraftState(nextOrders: OrderRecord[]) {
    setPricingDrafts((current) => {
      const draft = { ...current };

      for (const order of nextOrders) {
        draft[order.id] = draft[order.id] || {
          extras: String(order.pricing.extras || 0),
          discount: String(order.pricing.manualDiscount || 0),
          extrasDescription: order.pricing.extrasDescription
        };
      }

      return draft;
    });

    setPaymentDrafts((current) => {
      const draft = { ...current };

      for (const order of nextOrders) {
        draft[order.id] = draft[order.id] || {
          status: order.payment.status,
          amountPaid: String(order.payment.amountPaid || 0),
          method: order.payment.method
        };
      }

      return draft;
    });

    setCompletionDrafts((current) => {
      const draft = { ...current };

      for (const order of nextOrders) {
        draft[order.id] = draft[order.id] || {
          clientNotes: order.completion.clientNotes,
          privateNotes: order.completion.privateNotes,
          diagnosis: order.completion.diagnosis,
          solution: order.completion.solution,
          checklist: order.completion.checklist,
          warranty: order.completion.warranty
        };
      }

      return draft;
    });

    setDeliveryDrafts((current) => {
      const draft = { ...current };

      for (const order of nextOrders) {
        draft[order.id] = draft[order.id] || {
          status: order.delivery.status,
          recipientName: order.delivery.recipientName,
          confirmation: order.delivery.confirmation
        };
      }

      return draft;
    });

    setHistoryNoteDrafts((current) => {
      const draft = { ...current };

      for (const order of nextOrders) {
        draft[order.id] = draft[order.id] || "";
      }

      return draft;
    });
  }

  async function loadDashboard(currentUser = auth.currentUser) {
    setError("");
    setWorking(true);

    try {
      const headers = await authHeader(currentUser);
      const [ordersResponse, calendarResponse, auditResponse, profileResponse, couponsResponse] = await Promise.all([
        fetch("/api/admin/orders", { headers }),
        fetch(`/api/admin/calendar?from=${getBusinessTodayISO()}&days=14`, { headers }),
        fetch("/api/admin/audit", { headers }),
        fetch("/api/admin/profile", { headers }),
        fetch("/api/admin/coupons", { headers })
      ]);

      const [ordersData, calendarData, auditData, profileData, couponsData] = await Promise.all([
        ordersResponse.json(),
        calendarResponse.json(),
        auditResponse.json(),
        profileResponse.json(),
        couponsResponse.json()
      ]);

      if (!profileResponse.ok) {
        throw new Error(profileData.error || "Erro ao carregar o perfil do administrador.");
      }

      if (!couponsResponse.ok) {
        throw new Error(couponsData.error || "Erro ao carregar os cupons.");
      }

      if (!ordersResponse.ok) {
        throw new Error(ordersData.error || "Não foi possível carregar as ordens.");
      }

      if (!calendarResponse.ok) {
        throw new Error(calendarData.error || "Não foi possível carregar a agenda.");
      }

      if (!auditResponse.ok) {
        throw new Error(auditData.error || "Não foi possível carregar o log.");
      }

      const nextOrders = (ordersData.orders || []) as OrderRecord[];
      const nextCalendarDays = (calendarData.days || []) as CalendarDay[];
      const nextAuditEntries = (auditData.entries || []) as AuditEntry[];
      const nextCoupons = (couponsData.coupons || []) as DiscountCoupon[];
      const profile = (profileData.profile || {}) as { displayName?: string; photoDataUrl?: string; photoUrl?: string };

      setOrders(nextOrders);
      setCalendarDays(nextCalendarDays);
      setAuditEntries(nextAuditEntries);
      setCoupons(nextCoupons);
      setProfileName(profile.displayName || currentUser?.displayName || currentUser?.email || "");
      setProfileDisplayName(profile.displayName || currentUser?.displayName || currentUser?.email || "");
      setProfilePhotoUrl(profile.photoUrl || profile.photoDataUrl || currentUser?.photoURL || "");
      setAdminReady(true);
      ensureDraftState(nextOrders);

      setExpandedOrderId((current) => (nextOrders.some((order) => order.id === current) ? current : nextOrders[0]?.id || ""));
      setCalendarDate((current) =>
        nextCalendarDays.some((day) => day.date === current) ? current : nextCalendarDays[0]?.date || getBusinessTodayISO()
      );
    } catch (err) {
      setOrders([]);
      setCalendarDays([]);
      setAuditEntries([]);
      setCoupons([]);
      setAdminReady(false);
      setError(err instanceof Error ? err.message : "Erro ao carregar painel.");
    } finally {
      setWorking(false);
    }
  }

  async function activateAdmin() {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error("Faça login antes de ativar o admin.");
    }

    await currentUser.reload();
    const refreshedUser = auth.currentUser;

    if (!refreshedUser?.emailVerified) {
      throw new Error("Confirme seu e-mail antes de ativar o painel admin.");
    }

    const token = await refreshedUser.getIdToken(true);
    const response = await fetch("/api/admin/bootstrap", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Não foi possível ativar o admin.");
    }

    await refreshedUser.getIdToken(true);
    return data.message || "Admin ativado com sucesso.";
  }

  async function createAccount() {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(credential.user);
      setMessage("Conta criada. Verifique seu e-mail e depois clique em ativar admin.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a conta.");
    } finally {
      setWorking(false);
    }
  }

  async function loginPassword() {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      setMessage("Login feito. Se o e-mail já estiver verificado, ative o admin logo abaixo.");
      await loadDashboard(credential.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setWorking(false);
    }
  }

  async function loginGoogle() {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);

      try {
        const activationMessage = await activateAdmin();
        setMessage(`${activationMessage} Painel pronto para uso.`);
      } catch (activationError) {
        setMessage(
          activationError instanceof Error
            ? activationError.message
            : "Login feito, mas o admin ainda precisa ser ativado."
        );
      }

      await loadDashboard(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar com Google.");
    } finally {
      setWorking(false);
    }
  }

  async function handleActivateAdmin() {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const activationMessage = await activateAdmin();
      setMessage(`${activationMessage} Você já pode usar o painel.`);
      await loadDashboard(auth.currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ativar o admin.");
    } finally {
      setWorking(false);
    }
  }

  async function resendVerification() {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      if (!auth.currentUser) {
        throw new Error("Faça login primeiro.");
      }

      await sendEmailVerification(auth.currentUser);
      setMessage("E-mail de verificação reenviado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reenviar.");
    } finally {
      setWorking(false);
    }
  }

  async function saveProfileName() {
    setSavingProfile(true);
    setError("");
    setMessage("");

    try {
      const currentUser = auth.currentUser;
      const nextName = profileName.trim();

      if (!currentUser) {
        throw new Error("Faça login novamente para atualizar seu nome.");
      }

      if (!nextName) {
        throw new Error("Digite o nome de usuário que você quer usar.");
      }

      await updateProfile(currentUser, { displayName: nextName });
      const response = await fetch("/api/admin/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeader(currentUser))
        },
        body: JSON.stringify({
          displayName: nextName
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "NÃ£o foi possÃ­vel salvar o nome de usuÃ¡rio.");
      }

      setProfileName(data.profile?.displayName || nextName);
      setProfileDisplayName(data.profile?.displayName || nextName);
      setMessage("Nome de usuário atualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o nome.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleProfilePhotoPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    if (!file) {
      return;
    }

    setSavingProfilePhoto(true);
    setError("");
    setMessage("");

    try {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("Faça login novamente para atualizar sua foto.");
      }

      if (!file.type.startsWith("image/")) {
        throw new Error("Escolha um arquivo de imagem para a foto de perfil.");
      }

      if (file.size > ADMIN_PROFILE_PHOTO_MAX_BYTES) {
        throw new Error("A foto de perfil precisa ter no máximo 2 MB.");
      }

      const avatarRef = ref(storage, getAdminPhotoStoragePath(currentUser.uid));
      await uploadBytes(avatarRef, file, {
        contentType: file.type,
        cacheControl: "public,max-age=3600"
      });
      const nextPhotoUrl = await getDownloadURL(avatarRef);
      const headers = await authHeader(currentUser);
      const response = await fetch("/api/admin/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: JSON.stringify({
          photoUrl: nextPhotoUrl
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Nao foi possivel salvar a foto de perfil.");
      }

      await updateProfile(currentUser, { photoURL: nextPhotoUrl });
      await currentUser.getIdToken(true);
      await currentUser.reload();
      setUser(auth.currentUser);
      setProfilePhotoUrl(data.profile?.photoUrl || auth.currentUser?.photoURL || nextPhotoUrl);
      setMessage("Foto de perfil atualizada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar a foto de perfil.");
    } finally {
      setSavingProfilePhoto(false);
    }
  }

  async function removeProfilePhoto() {
    setRemovingProfilePhoto(true);
    setError("");
    setMessage("");

    try {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("Faça login novamente para remover sua foto.");
      }

      try {
        await deleteObject(ref(storage, getAdminPhotoStoragePath(currentUser.uid)));
      } catch {}

      const headers = await authHeader(currentUser);
      const response = await fetch("/api/admin/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: JSON.stringify({
          photoUrl: ""
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Nao foi possivel remover a foto de perfil.");
      }

      await updateProfile(currentUser, { photoURL: null });
      await currentUser.getIdToken(true);
      await currentUser.reload();
      setUser(auth.currentUser);
      setProfilePhotoUrl(data.profile?.photoUrl || "");
      setMessage("Foto de perfil removida.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a foto de perfil.");
    } finally {
      setRemovingProfilePhoto(false);
    }
  }

  async function patchOrder(orderId: string, payload: Record<string, unknown>, successMessage: string) {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeader())
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível atualizar a ordem.");
      }

      setMessage(successMessage);
      await loadDashboard();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar a ordem.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function saveCalendarConfig() {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/calendar", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeader())
        },
        body: JSON.stringify({
          date: calendarDate,
          isBlocked: calendarBlocked,
          blockedReason: calendarBlockedReason,
          customSlots: formatCustomSlots(calendarCustomSlots)
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível salvar a agenda.");
      }

      setMessage("Agenda do dia atualizada.");
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar a agenda.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteOrder(order: OrderRecord) {
    const shouldDelete = window.confirm(
      `Apagar a ordem ${order.orderCode} de ${order.customer.name}? O horário ${order.schedule.slot} em ${formatDateBR(order.schedule.date)} será liberado novamente.`
    );

    if (!shouldDelete) {
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/orders/${order.id}`, {
        method: "DELETE",
        headers: await authHeader()
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível apagar a ordem.");
      }

      setExpandedOrderId("");
      setMessage("Ordem apagada e horário liberado com sucesso.");
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao apagar a ordem.");
    } finally {
      setWorking(false);
    }
  }

  async function handleLogout() {
    setWorking(true);
    setError("");
    setMessage("");

    try {
      await fetch("/api/admin/access", { method: "DELETE" });
      await signOut(auth);
      window.location.reload();
    } finally {
      setWorking(false);
    }
  }

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? "" : current));
      }, 2200);
    } catch {
      setError("Não foi possível copiar esse dado agora.");
    }
  }

  function downloadPdf(orderCode: string, version: "initial" | "completion") {
    window.open(`/api/orders/${orderCode}/pdf?version=${version}`, "_blank", "noopener,noreferrer");
  }

  function printOrder(orderCode: string, version: "initial" | "completion") {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = `/api/orders/${orderCode}/pdf?version=${version}`;

    iframe.onload = () => {
      window.setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      }, 500);
    };

    document.body.appendChild(iframe);
  }

  function openClientWhatsApp(order: OrderRecord) {
    const phone = formatPhoneForWhatsApp(order.customer.phone);

    if (!phone) {
      setError("Esse cliente não possui telefone válido para WhatsApp.");
      return;
    }

    const messageText = encodeURIComponent(buildAdminWhatsAppMessage(order));
    window.open(`https://wa.me/${phone}?text=${messageText}`, "_blank", "noopener,noreferrer");
  }

  async function uploadFiles(order: OrderRecord, files: FileList | null, category: AttachmentCategory) {
    if (!files?.length) {
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");

    try {
      const headers = await authHeader();

      for (const file of Array.from(files)) {
        const storageRef = ref(storage, `orders/${order.orderCode}/${Date.now()}-${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        const response = await fetch(`/api/admin/orders/${order.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...headers
          },
          body: JSON.stringify({
            attachmentAction: {
              type: "add",
              id: makeAttachmentId(),
              name: file.name,
              url,
              category
            }
          })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Não foi possível anexar o arquivo.");
        }
      }

      setMessage("Arquivos anexados com sucesso.");
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} Se o upload falhar no deploy, confira as regras do Firebase Storage.`
          : "Erro ao anexar arquivo."
      );
    } finally {
      setWorking(false);
    }
  }

  async function removeAttachment(order: OrderRecord, attachmentId: string, attachmentUrl: string) {
    const shouldRemove = window.confirm("Remover este anexo da ordem?");

    if (!shouldRemove) {
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeader())
        },
        body: JSON.stringify({
          attachmentAction: {
            type: "remove",
            id: attachmentId
          }
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível remover o anexo.");
      }

      try {
        await deleteObject(ref(storage, attachmentUrl));
      } catch {}

      setMessage("Anexo removido.");
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover anexo.");
    } finally {
      setWorking(false);
    }
  }

  function exportCsv() {
    downloadTextFile(`ordens-${getBusinessTodayISO()}.csv`, buildCsv(filteredOrders), "text/csv;charset=utf-8");
  }

  function exportJson() {
    downloadTextFile(`backup-ordens-${getBusinessTodayISO()}.json`, JSON.stringify(orders, null, 2), "application/json;charset=utf-8");
  }

  const counts = useMemo(
    () => ({
      all: orders.length,
      open: orders.filter((order) => order.status === "open").length,
      completed: orders.filter((order) => order.status === "completed").length,
      cancelled: orders.filter((order) => order.status === "cancelled").length
    }),
    [orders]
  );

  const normalizedTerm = normalizeSearchValue(searchTerm);
  const numericTerm = normalizePhoneDigits(searchTerm);

  const filteredOrders = orders.filter((order) => {
    if (statusFilter !== "all" && order.status !== statusFilter) {
      return false;
    }

    if (archiveFilter === "active" && order.isArchived) {
      return false;
    }

    if (archiveFilter === "archived" && !order.isArchived) {
      return false;
    }

    if (paymentFilter !== "all" && order.payment.status !== paymentFilter) {
      return false;
    }

    if (deliveryFilter !== "all" && order.delivery.status !== deliveryFilter) {
      return false;
    }

    if (equipmentFilter !== "all" && order.customer.equipment !== equipmentFilter) {
      return false;
    }

    if (serviceFilter !== "all" && !order.services.some((service) => service.id === serviceFilter)) {
      return false;
    }

    if (selectedDateFilter && order.schedule.date !== selectedDateFilter) {
      return false;
    }

    if (!normalizedTerm) {
      return true;
    }

    const searchableText = [
      order.orderCode,
      order.customer.name,
      order.customer.phone,
      order.customer.city,
      order.services.map((service) => service.name).join(" "),
      order.customer.issue
    ]
      .join(" ")
      .toLowerCase();
    const phoneDigits = normalizePhoneDigits(order.customer.phone);

    return searchableText.includes(normalizedTerm) || (numericTerm ? phoneDigits.includes(numericTerm) : false);
  });

  const groupedOrders = useMemo(() => {
    const groups = new Map<string, OrderRecord[]>();

    for (const order of filteredOrders) {
      const current = groups.get(order.schedule.date) || [];
      current.push(order);
      groups.set(order.schedule.date, current);
    }

    return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [filteredOrders]);

  return (
    <section className="admin-shell">
      <div className="section-head">
        <div className="badge">Painel reservado</div>
        <h1>Ordens, agenda, pagamentos e histórico</h1>
        <p>Agora o painel cuida do fluxo completo: chat do site, agendamento, bloqueios, pagamento, conclusão, entrega, anexos e backup.</p>
      </div>

      {!user && !loading && (
        <div className="auth-grid">
          <div className="card">
            <h2>Entrar no painel</h2>
            <p className="mini">Use seu e-mail/senha ou o mesmo Google autorizado em OWNER_ADMIN_EMAIL.</p>

            <label>
              <span>E-mail</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="seuemail@gmail.com" />
            </label>

            <label>
              <span>Senha</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" />
            </label>

            <div className="actions">
              <button className="btn btn-primary" onClick={loginPassword} disabled={working}>
                Entrar
              </button>
              <button className="btn btn-ghost" onClick={loginGoogle} disabled={working}>
                Entrar com Google
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Primeiro acesso</h2>
            <p className="mini">Crie a conta, confirme o e-mail e depois ative o admin.</p>

            <label>
              <span>E-mail do dono</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="seuemail@gmail.com" />
            </label>

            <label>
              <span>Senha</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimo de 6 caracteres"
              />
            </label>

            <div className="actions">
              <button className="btn btn-primary" onClick={createAccount} disabled={working}>
                Criar conta
              </button>
              <button className="btn btn-ghost" onClick={resendVerification} disabled={working}>
                Reenviar verificação
              </button>
            </div>
          </div>
        </div>
      )}

      {user && !adminReady && (
        <div className="card admin-activation-card">
          <div className="detail-grid compact">
            <div>
              <span className="detail-label">Logado como</span>
              <strong>{user.email}</strong>
            </div>
            <div>
              <span className="detail-label">Status</span>
              <strong>Admin ainda não ativado</strong>
            </div>
          </div>

          <p className="mini">Seu login já foi reconhecido, mas o Firebase ainda não marcou essa conta como administradora.</p>

          <div className="actions">
            <button className="btn btn-primary" onClick={handleActivateAdmin} disabled={working}>
              Ativar admin
            </button>
            <button className="btn btn-ghost" onClick={resendVerification} disabled={working}>
              Reenviar verificação
            </button>
            <button className="btn btn-ghost" onClick={handleLogout} disabled={working}>
              Fechar area
            </button>
          </div>
        </div>
      )}

      {user && adminReady && (
        <>
          <AdminChatInbox />

          <div className="card admin-toolbar">
            <div className="admin-toolbar-main">
              <div className="admin-toolbar-head">
                <div>
                  <span className="detail-label">Administrador autenticado</span>
                  <strong>{profileDisplayName || user.displayName || user.email}</strong>
                  <p className="mini">{user.email}</p>
                </div>

                <div className="admin-profile-block">
                  <div className="admin-profile-media">
                    {profilePhotoUrl ? (
                      <img className="admin-profile-avatar" src={profilePhotoUrl} alt={profileDisplayName || user.email || "Administrador"} />
                    ) : (
                      <div className="admin-profile-avatar admin-profile-avatar-fallback" aria-hidden="true">
                        {(profileDisplayName || user.email || "A").slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div className="admin-profile-actions">
                      <label className="btn btn-ghost btn-small admin-profile-upload">
                        {savingProfilePhoto ? "Enviando foto..." : "Enviar foto"}
                        <input type="file" accept="image/*" onChange={handleProfilePhotoPick} disabled={savingProfilePhoto || removingProfilePhoto || working} />
                      </label>
                      {profilePhotoUrl && (
                        <button className="btn btn-ghost btn-small" type="button" onClick={removeProfilePhoto} disabled={savingProfilePhoto || removingProfilePhoto || working}>
                          {removingProfilePhoto ? "Removendo..." : "Remover foto"}
                        </button>
                      )}
                    </div>
                  </div>

                  <label>
                    <span>Nome de usuário</span>
                    <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Como seu nome vai aparecer no painel" />
                  </label>
                  <button className="btn btn-ghost btn-small" type="button" onClick={saveProfileName} disabled={savingProfile || working}>
                    {savingProfile ? "Salvando..." : "Salvar nome"}
                  </button>
                </div>
              </div>

              <div className="admin-search-block">
                <span className="detail-label">Busca rápida</span>
                <label>
                  <span>Buscar por ID, nome, telefone, cidade ou serviço</span>
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Ex.: OS-20260507-ABC123, Maria, 11999999999 ou formatação"
                  />
                </label>
                <p className="mini">
                  {filteredOrders.length} resultado(s) em {orders.length} ordem(ns).
                </p>
              </div>
            </div>

            <div className="actions">
              <button className="btn btn-ghost" onClick={exportCsv} disabled={!filteredOrders.length}>
                Exportar CSV
              </button>
              <button className="btn btn-ghost" onClick={exportJson} disabled={!orders.length}>
                Backup JSON
              </button>
              <button className="btn btn-ghost" onClick={() => loadDashboard()} disabled={working}>
                {working ? "Atualizando..." : "Atualizar"}
              </button>
              <button className="btn btn-ghost" onClick={handleLogout} disabled={working}>
                Fechar area
              </button>
            </div>
          </div>

          <div className="card admin-filter-bar">
            <div className="admin-filter-label">
              <span className="detail-label">Filtro rapido</span>
              <strong>Visualizar ordens</strong>
            </div>
            <div className="status-filter-group" role="tablist" aria-label="Filtros de ordens">
              {STATUS_FILTERS.map((filter) => {
                const count =
                  filter.value === "all"
                    ? counts.all
                    : filter.value === "open"
                      ? counts.open
                      : filter.value === "completed"
                        ? counts.completed
                        : counts.cancelled;

                return (
                  <button
                    key={filter.value}
                    type="button"
                    className={`status-filter-btn ${statusFilter === filter.value ? "active" : ""}`}
                    aria-pressed={statusFilter === filter.value}
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    <span>{filter.label}</span>
                    <strong>{count}</strong>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card admin-select-filters">
            <label>
              <span>Ativas ou arquivadas</span>
              <select value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value as ArchiveFilter)}>
                <option value="all">Todas</option>
                <option value="active">Somente ativas</option>
                <option value="archived">Somente arquivadas</option>
              </select>
            </label>

            <label>
              <span>Pagamento</span>
              <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}>
                <option value="all">Todos</option>
                <option value="pending">Pendentes</option>
                <option value="partial">Parciais</option>
                <option value="paid">Pagos</option>
              </select>
            </label>

            <label>
              <span>Entrega</span>
              <select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value as DeliveryFilter)}>
                <option value="all">Todas</option>
                <option value="pending">Pendentes</option>
                <option value="delivered">Entregues</option>
              </select>
            </label>

            <label>
              <span>Equipamento</span>
              <select value={equipmentFilter} onChange={(event) => setEquipmentFilter(event.target.value as EquipmentType | "all")}>
                <option value="all">Todos</option>
                <option value="desktop">Computador de mesa</option>
                <option value="notebook">Notebook</option>
                <option value="all-in-one">All in one</option>
                <option value="mini-pc">Mini PC</option>
                <option value="unknown">Não informado</option>
              </select>
            </label>

            <label>
              <span>Serviço</span>
              <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value as ServiceId | "all")}>
                <option value="all">Todos</option>
                {(Object.keys(SERVICES) as ServiceId[]).map((serviceId) => (
                  <option value={serviceId} key={serviceId}>
                    {SERVICES[serviceId].name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Data</span>
              <input type="date" value={selectedDateFilter} onChange={(event) => setSelectedDateFilter(event.target.value)} />
            </label>

            <button className="btn btn-ghost btn-small" type="button" onClick={() => setSelectedDateFilter("")}>
              Limpar data
            </button>
          </div>

          <div className="card admin-calendar-shell">
            <div className="section-head admin-inline-head">
              <div>
                <div className="badge">Agenda visual</div>
                <h2>Proximos dias de atendimento</h2>
                <p>Selecione um dia para filtrar a lista, bloquear atendimento ou ajustar horários especiais.</p>
              </div>
            </div>

            <div className="calendar-day-strip">
              {calendarDays.map((day) => {
                const booked = day.slots.filter((slot) => slot.orderCode).length;
                const available = day.slots.filter((slot) => slot.available).length;

                return (
                  <button
                    className={`calendar-day-chip ${calendarDate === day.date ? "active" : ""} ${day.isBlocked ? "blocked" : ""}`}
                    key={day.date}
                    type="button"
                    onClick={() => {
                      setCalendarDate(day.date);
                      setSelectedDateFilter(day.date);
                    }}
                  >
                    <strong>{formatDateBR(day.date)}</strong>
                    <span>{day.isBlocked ? "Bloqueado" : `${booked}/${day.limit} agendados`}</span>
                    <small>{day.isBlocked ? day.blockedReason || "Sem atendimento" : `${available} horário(s) livres`}</small>
                  </button>
                );
              })}
            </div>

            <div className="calendar-editor-grid">
              <div className="calendar-editor-card">
                <span className="detail-label">Dia selecionado</span>
                <strong>{formatDateBR(calendarDate)}</strong>

                <label className="checkbox-line">
                  <input type="checkbox" checked={calendarBlocked} onChange={(event) => setCalendarBlocked(event.target.checked)} />
                  <span>Bloquear este dia</span>
                </label>

                <label>
                  <span>Motivo do bloqueio</span>
                  <input
                    value={calendarBlockedReason}
                    onChange={(event) => setCalendarBlockedReason(event.target.value)}
                    placeholder="Ex.: folga, feriado, agenda fechada..."
                  />
                </label>

                <label>
                  <span>Horários desse dia</span>
                  <input
                    value={calendarCustomSlots}
                    onChange={(event) => setCalendarCustomSlots(event.target.value)}
                    placeholder="09:00, 11:00, 13:00, 15:00, 17:00"
                  />
                </label>

                <button className="btn btn-primary btn-small" type="button" onClick={saveCalendarConfig} disabled={working}>
                  Salvar agenda do dia
                </button>
              </div>

              <div className="calendar-editor-card">
                <span className="detail-label">Mapa rapido</span>
                <div className="calendar-slot-list">
                  {(selectedCalendarDay?.slots || []).map((slot) => (
                    <div className={`calendar-slot-item ${slot.available ? "free" : slot.orderCode ? "busy" : "blocked"}`} key={slot.slot}>
                      <strong>{slot.slot}</strong>
                      <span>{slot.orderCode ? slot.orderCode : slot.available ? "Livre" : "Indisponível"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="order-list">
            {groupedOrders.map(([date, grouped]) => (
              <section className="card order-group-card" key={date}>
                <div className="order-group-head">
                  <div>
                    <span className="detail-label">Dia de atendimento</span>
                    <h3>{formatDateBR(date)}</h3>
                  </div>
                  <span className="group-counter">{grouped.length} ordem(ns)</span>
                </div>

                <div className="order-list">
                  {grouped.map((order) => {
                    const technical = buildOrderTechnicalSummary(order);
                    const completionDraft = completionDrafts[order.id] || {
                      clientNotes: "",
                      privateNotes: "",
                      diagnosis: "",
                      solution: "",
                      checklist: "",
                      warranty: ""
                    };
                    const paymentDraft =
                      paymentDrafts[order.id] || { status: "pending" as PaymentStatus, amountPaid: "0", method: "pix" as PaymentMethod };
                    const pricingDraft = pricingDrafts[order.id] || { extras: "0", discount: "0", extrasDescription: "" };
                    const deliveryDraft = deliveryDrafts[order.id] || { status: "pending" as DeliveryStatus, recipientName: "", confirmation: "" };
                    const historyNote = historyNoteDrafts[order.id] || "";
                    const isExpanded = expandedOrderId === order.id;

                    return (
                      <article className={`card order-list-item ${isExpanded ? "expanded" : ""}`} key={order.id}>
                        <div className="order-list-summary">
                          <div className="order-summary-main">
                            <div className="order-inline-meta">
                              <span className="order-code">Ordem #{order.orderCode}</span>
                              <CopyButton copyKey={`id-${order.id}`} copiedKey={copiedKey} onCopy={copyValue} value={order.orderCode} label="Copiar ID" />
                              {order.isArchived && <span className="mini-badge">Arquivada</span>}
                            </div>
                            <h3 className="order-customer-name">{order.customer.name}</h3>
                            <p className="order-summary-line">
                              {order.schedule.slot} • {getEquipmentLabel(order.customer.equipment)} • {order.services.map((service) => service.name).join(", ")}
                            </p>
                          </div>

                          <div className="order-summary-side">
                            <div className="summary-mini-card">
                              <span>Total</span>
                              <strong>{formatBRL(order.total)}</strong>
                            </div>
                            <div className="summary-mini-card">
                              <span>Pagamento</span>
                              <strong>{buildPaymentStatusLabel(order.payment.status)}</strong>
                              <small>{buildPaymentMethodLabel(order.payment.method)}</small>
                            </div>
                            <div className="summary-mini-card">
                              <span>Entrega</span>
                              <strong>{buildDeliveryStatusLabel(order.delivery.status)}</strong>
                            </div>
                            <span className={`status-pill status-${order.status}`}>{statusLabel(order.status)}</span>
                            <button
                              className="btn btn-ghost btn-small"
                              type="button"
                              onClick={() => setExpandedOrderId((current) => (current === order.id ? "" : order.id))}
                            >
                              {isExpanded ? "Fechar detalhes" : "Abrir detalhes"}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="order-expand-panel">
                            <div className="order-detail-actions">
                              <button className="btn btn-ghost btn-small" type="button" onClick={() => openClientWhatsApp(order)}>
                                Chamar no WhatsApp
                              </button>
                              <button className="btn btn-ghost btn-small" type="button" onClick={() => printOrder(order.orderCode, order.status === "completed" ? "completion" : "initial")}>
                                Imprimir ordem
                              </button>
                              <button className="btn btn-ghost btn-small" type="button" onClick={() => downloadPdf(order.orderCode, "initial")}>
                                PDF inicial
                              </button>
                              <button
                                className="btn btn-ghost btn-small"
                                type="button"
                                onClick={() => downloadPdf(order.orderCode, "completion")}
                                disabled={order.status !== "completed"}
                              >
                                PDF final
                              </button>
                              <button
                                className="btn btn-ghost btn-small"
                                type="button"
                                onClick={() =>
                                  patchOrder(
                                    order.id,
                                    { isArchived: !order.isArchived },
                                    order.isArchived ? "Ordem reativada." : "Ordem arquivada."
                                  )
                                }
                              >
                                {order.isArchived ? "Desarquivar" : "Arquivar"}
                              </button>
                              <button
                                className="btn btn-ghost btn-small"
                                type="button"
                                onClick={() => patchOrder(order.id, { status: "cancelled" }, "Ordem cancelada.")}
                                disabled={order.status === "cancelled"}
                              >
                                Cancelar ordem
                              </button>
                              <button className="btn btn-danger btn-small" type="button" onClick={() => deleteOrder(order)} disabled={working}>
                                Apagar ordem
                              </button>
                            </div>

                            <div className="copy-field-grid">
                              {[
                                ["ID da ordem", order.orderCode],
                                ["Nome", order.customer.name],
                                ["WhatsApp", order.customer.phone],
                                ["Cidade / bairro", order.customer.city],
                                ["Data e horário", `${formatDateBR(order.schedule.date)} às ${order.schedule.slot}`],
                                ["Equipamento", getEquipmentLabel(order.customer.equipment)],
                                ["Total final", formatBRL(order.total)],
                                ["Forma de pagamento", buildPaymentMethodLabel(order.payment.method)],
                                ["Conclusão", buildCompletionLabel(order)]
                              ].map(([label, value]) => (
                                <div className="copy-field-card" key={`${order.id}-${label}`}>
                                  <div className="copy-field-head">
                                    <span className="detail-label">{label}</span>
                                    <CopyButton copyKey={`${order.id}-${label}`} copiedKey={copiedKey} onCopy={copyValue} value={value} />
                                  </div>
                                  <strong>{value}</strong>
                                </div>
                              ))}
                            </div>

                            <div className="order-detail-panels">
                              <div className="note-box copy-panel">
                                <div className="copy-panel-head">
                                  <span className="detail-label">Relato do cliente</span>
                                  <CopyButton copyKey={`issue-${order.id}`} copiedKey={copiedKey} onCopy={copyValue} value={order.customer.issue} />
                                </div>
                                <p>{order.customer.issue}</p>
                              </div>

                              <div className="note-box copy-panel">
                                <div className="copy-panel-head">
                                  <span className="detail-label">Serviços da ordem</span>
                                  <CopyButton
                                    copyKey={`services-${order.id}`}
                                    copiedKey={copiedKey}
                                    onCopy={copyValue}
                                    value={order.services.map((service) => `${service.name} - ${buildServicePriceLabel(service)}`).join("\n")}
                                  />
                                </div>
                                <p className="stacked-copy-text">{order.services.map((service) => `${service.name} - ${buildServicePriceLabel(service)}`).join("\n")}</p>
                              </div>
                            </div>

                            <div className="admin-multi-grid">
                              <div className="card nested-card">
                                <div className="copy-panel-head">
                                  <div>
                                    <span className="detail-label">Pagamento e valores</span>
                                    <strong>Controle financeiro da ordem</strong>
                                  </div>
                                  <CopyButton
                                    copyKey={`payment-summary-${order.id}`}
                                    copiedKey={copiedKey}
                                    onCopy={copyValue}
                                    value={`Status: ${buildPaymentStatusLabel(order.payment.status)} | Método: ${buildPaymentMethodLabel(order.payment.method)} | Pago: ${formatBRL(order.payment.amountPaid)} | Total: ${formatBRL(order.total)}`}
                                    label="Copiar resumo"
                                  />
                                </div>

                                <div className="form-grid">
                                  <label>
                                    <span>Extras</span>
                                    <input
                                      value={pricingDraft.extras}
                                      onChange={(event) =>
                                        setPricingDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...pricingDraft, extras: event.target.value }
                                        }))
                                      }
                                      placeholder="0"
                                    />
                                  </label>

                                  <label>
                                    <span>Desconto manual</span>
                                    <input
                                      value={pricingDraft.discount}
                                      onChange={(event) =>
                                        setPricingDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...pricingDraft, discount: event.target.value }
                                        }))
                                      }
                                      placeholder="0"
                                    />
                                  </label>

                                  <label className="field-full">
                                    <span>Descrição dos extras</span>
                                    <input
                                      value={pricingDraft.extrasDescription}
                                      onChange={(event) =>
                                        setPricingDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...pricingDraft, extrasDescription: event.target.value }
                                        }))
                                      }
                                      placeholder="Ex.: troca de SSD, visita extra, adaptador..."
                                    />
                                  </label>

                                  <label>
                                    <span>Status do pagamento</span>
                                    <select
                                      value={paymentDraft.status}
                                      onChange={(event) =>
                                        setPaymentDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...paymentDraft, status: event.target.value as PaymentStatus }
                                        }))
                                      }
                                    >
                                      <option value="pending">Pendente</option>
                                      <option value="partial">Parcial</option>
                                      <option value="paid">Pago</option>
                                    </select>
                                  </label>

                                  <label>
                                    <span>Valor pago</span>
                                    <input
                                      value={paymentDraft.amountPaid}
                                      onChange={(event) =>
                                        setPaymentDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...paymentDraft, amountPaid: event.target.value }
                                        }))
                                      }
                                      placeholder="0"
                                    />
                                  </label>

                                  <label className="field-full">
                                    <span>Método</span>
                                    <select
                                      value={paymentDraft.method}
                                      onChange={(event) =>
                                        setPaymentDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...paymentDraft, method: event.target.value as PaymentMethod }
                                        }))
                                      }
                                    >
                                      {PAYMENT_METHOD_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>

                                <div className="actions">
                                  <button
                                    className="btn btn-primary btn-small"
                                    type="button"
                                    onClick={() =>
                                      patchOrder(
                                        order.id,
                                        {
                                          extras: parseCurrencyInput(pricingDraft.extras),
                                          discount: parseCurrencyInput(pricingDraft.discount),
                                          extrasDescription: pricingDraft.extrasDescription,
                                          paymentStatus: paymentDraft.status,
                                          amountPaid: parseCurrencyInput(paymentDraft.amountPaid),
                                          paymentMethod: paymentDraft.method
                                        },
                                        "Pagamento e valores atualizados."
                                      )
                                    }
                                  >
                                    Salvar pagamento
                                  </button>
                                </div>
                              </div>

                              <div className="card nested-card">
                                <div className="copy-panel-head">
                                  <div>
                                    <span className="detail-label">Entrega e confirmação</span>
                                    <strong>Separada da conclusão técnica</strong>
                                  </div>
                                </div>

                                <div className="form-grid">
                                  <label>
                                    <span>Status da entrega</span>
                                    <select
                                      value={deliveryDraft.status}
                                      onChange={(event) =>
                                        setDeliveryDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...deliveryDraft, status: event.target.value as DeliveryStatus }
                                        }))
                                      }
                                    >
                                      <option value="pending">Aguardando entrega</option>
                                      <option value="delivered">Entregue</option>
                                    </select>
                                  </label>

                                  <label>
                                    <span>Recebido por</span>
                                    <input
                                      value={deliveryDraft.recipientName}
                                      onChange={(event) =>
                                        setDeliveryDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...deliveryDraft, recipientName: event.target.value }
                                        }))
                                      }
                                      placeholder="Nome da pessoa que recebeu"
                                    />
                                  </label>

                                  <label className="field-full">
                                    <span>Confirmação do cliente</span>
                                    <textarea
                                      value={deliveryDraft.confirmation}
                                      onChange={(event) =>
                                        setDeliveryDrafts((current) => ({
                                          ...current,
                                          [order.id]: { ...deliveryDraft, confirmation: event.target.value }
                                        }))
                                      }
                                      placeholder="Ex.: cliente confirmou recebimento, testado na frente do cliente..."
                                    />
                                  </label>
                                </div>

                                <div className="actions">
                                  <button
                                    className="btn btn-primary btn-small"
                                    type="button"
                                    onClick={() =>
                                      patchOrder(
                                        order.id,
                                        { delivery: deliveryDraft },
                                        deliveryDraft.status === "delivered" ? "Entrega confirmada." : "Entrega voltou para pendente."
                                      )
                                    }
                                  >
                                    Salvar entrega
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="system-sheet">
                              <div className="copy-panel-head">
                                <span className="detail-label">Ficha técnica informada</span>
                                <CopyButton copyKey={`system-summary-${order.id}`} copiedKey={copiedKey} onCopy={copyValue} value={technical.systemProfile} label="Copiar resumo" />
                              </div>

                              <div className="system-list">
                                {technical.systemFields.map((item) => (
                                  <div className="system-item copy-system-item" key={`${order.id}-${item.label}`}>
                                    <div className="copy-field-head">
                                      <span>{item.label}</span>
                                      <CopyButton copyKey={`${order.id}-${item.label}`} copiedKey={copiedKey} onCopy={copyValue} value={item.value} />
                                    </div>
                                    <strong>{item.value}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="card nested-card">
                              <div className="copy-panel-head">
                                <div>
                                  <span className="detail-label">Fechamento técnico</span>
                                  <strong>PDF final, cliente e anotações internas</strong>
                                </div>
                              </div>

                              <div className="form-grid">
                                <label className="field-full">
                                  <span>Observações para o cliente</span>
                                  <textarea
                                    value={completionDraft.clientNotes}
                                    onChange={(event) =>
                                      setCompletionDrafts((current) => ({
                                        ...current,
                                        [order.id]: { ...completionDraft, clientNotes: event.target.value }
                                      }))
                                    }
                                    placeholder="Texto que vai para o cliente e para o PDF final..."
                                  />
                                </label>

                                <label className="field-full">
                                  <span>Anotações privadas</span>
                                  <textarea
                                    value={completionDraft.privateNotes}
                                    onChange={(event) =>
                                      setCompletionDrafts((current) => ({
                                        ...current,
                                        [order.id]: { ...completionDraft, privateNotes: event.target.value }
                                      }))
                                    }
                                    placeholder="Visível só no admin..."
                                  />
                                </label>

                                <label>
                                  <span>Diagnóstico</span>
                                  <textarea
                                    value={completionDraft.diagnosis}
                                    onChange={(event) =>
                                      setCompletionDrafts((current) => ({
                                        ...current,
                                        [order.id]: { ...completionDraft, diagnosis: event.target.value }
                                      }))
                                    }
                                    placeholder="Ex.: sistema corrompido, HD degradado..."
                                  />
                                </label>

                                <label>
                                  <span>Solução aplicada</span>
                                  <textarea
                                    value={completionDraft.solution}
                                    onChange={(event) =>
                                      setCompletionDrafts((current) => ({
                                        ...current,
                                        [order.id]: { ...completionDraft, solution: event.target.value }
                                      }))
                                    }
                                    placeholder="Ex.: formatação limpa, troca de SSD, limpeza..."
                                  />
                                </label>

                                <label>
                                  <span>Checklist final</span>
                                  <textarea
                                    value={completionDraft.checklist}
                                    onChange={(event) =>
                                      setCompletionDrafts((current) => ({
                                        ...current,
                                        [order.id]: { ...completionDraft, checklist: event.target.value }
                                      }))
                                    }
                                    placeholder="Ex.: inicializa, internet ok, drivers ok..."
                                  />
                                </label>

                                <label>
                                  <span>Garantia / observação final</span>
                                  <textarea
                                    value={completionDraft.warranty}
                                    onChange={(event) =>
                                      setCompletionDrafts((current) => ({
                                        ...current,
                                        [order.id]: { ...completionDraft, warranty: event.target.value }
                                      }))
                                    }
                                    placeholder="Ex.: garantia de 7 dias para configuração..."
                                  />
                                </label>
                              </div>

                              <div className="actions">
                                <button
                                  className="btn btn-ghost btn-small"
                                  type="button"
                                  onClick={() =>
                                    patchOrder(
                                      order.id,
                                      { completion: completionDraft },
                                      "Rascunho técnico salvo."
                                    )
                                  }
                                >
                                  Salvar rascunho
                                </button>
                                <button
                                  className="btn btn-primary btn-small"
                                  type="button"
                                  onClick={() =>
                                    patchOrder(
                                      order.id,
                                      { status: "completed", completion: completionDraft },
                                      "Ordem concluída com sucesso."
                                    )
                                  }
                                >
                                  {order.status === "completed" ? "Atualizar conclusão" : "Concluir ordem"}
                                </button>
                                <button
                                  className="btn btn-ghost btn-small"
                                  type="button"
                                  onClick={() => patchOrder(order.id, { status: "open" }, "Ordem reaberta.")}
                                  disabled={order.status === "open"}
                                >
                                  Reabrir ordem
                                </button>
                              </div>
                            </div>

                            <div className="card nested-card">
                              <div className="copy-panel-head">
                                <div>
                                  <span className="detail-label">Fotos e anexos</span>
                                  <strong>Antes, depois e documentos</strong>
                                </div>
                              </div>

                              <div className="upload-chip-row">
                                <FileCategoryUploader label="Enviar fotos antes" accept="image/*" onFiles={(files) => uploadFiles(order, files, "before")} />
                                <FileCategoryUploader label="Enviar fotos depois" accept="image/*" onFiles={(files) => uploadFiles(order, files, "after")} />
                                <FileCategoryUploader label="Enviar documento" onFiles={(files) => uploadFiles(order, files, "document")} />
                              </div>

                              <div className="attachment-grid">
                                {order.attachments.map((attachment) => (
                                  <div className="attachment-card" key={attachment.id}>
                                    <span className="detail-label">{attachment.category}</span>
                                    {attachment.url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i) ? (
                                      <img src={attachment.url} alt={attachment.name} className="attachment-preview" />
                                    ) : (
                                      <div className="attachment-file-fallback">{attachment.name}</div>
                                    )}
                                    <strong>{attachment.name}</strong>
                                    <div className="actions">
                                      <a className="btn btn-ghost btn-small" href={attachment.url} target="_blank" rel="noreferrer">
                                        Abrir
                                      </a>
                                      <button
                                        className="btn btn-ghost btn-small"
                                        type="button"
                                        onClick={() => removeAttachment(order, attachment.id, attachment.url)}
                                      >
                                        Remover
                                      </button>
                                    </div>
                                  </div>
                                ))}

                                {!order.attachments.length && <p className="mini">Nenhum anexo enviado ainda.</p>}
                              </div>
                            </div>

                            <div className="card nested-card">
                              <div className="copy-panel-head">
                                <div>
                                  <span className="detail-label">Histórico da ordem</span>
                                  <strong>Tudo que aconteceu com esse atendimento</strong>
                                </div>
                              </div>

                              <label className="field-full">
                                <span>Nova anotação de histórico</span>
                                <textarea
                                  value={historyNote}
                                  onChange={(event) =>
                                    setHistoryNoteDrafts((current) => ({
                                      ...current,
                                      [order.id]: event.target.value
                                    }))
                                  }
                                  placeholder="Ex.: cliente ligou pedindo mudança de horário..."
                                />
                              </label>

                              <div className="actions">
                                <button
                                  className="btn btn-ghost btn-small"
                                  type="button"
                                  onClick={async () => {
                                    const ok = await patchOrder(
                                      order.id,
                                      { privateHistoryNote: historyNote },
                                      "Anotação adicionada ao histórico."
                                    );

                                    if (ok) {
                                      setHistoryNoteDrafts((current) => ({
                                        ...current,
                                        [order.id]: ""
                                      }));
                                    }
                                  }}
                                  disabled={!historyNote.trim()}
                                >
                                  Adicionar ao histórico
                                </button>
                              </div>

                              <div className="history-list">
                                {[...order.history].reverse().map((entry) => (
                                  <div className="history-item" key={entry.id}>
                                    <div className="history-item-head">
                                      <strong>{entry.label}</strong>
                                      <span>{formatDateTimeBR(entry.createdAt)}</span>
                                    </div>
                                    {entry.note && <p>{entry.note}</p>}
                                    <small>{entry.actor}</small>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

            {!orders.length && (
              <div className="card empty-state">
                <h2>Nenhuma ordem ainda</h2>
                <p className="mini">Assim que um cliente abrir um agendamento pelo site, a ordem vai aparecer aqui.</p>
              </div>
            )}

            {!!orders.length && !filteredOrders.length && (
              <div className="card empty-state">
                <h2>Nenhuma ordem encontrada</h2>
                <p className="mini">Ajuste os filtros de data, serviço, pagamento ou a busca principal.</p>
              </div>
            )}
          </div>

          <div className="card admin-audit-card">
            <div className="copy-panel-head">
              <div>
                <div className="badge">Log administrativo</div>
                <h2>Últimas ações do painel</h2>
              </div>
            </div>

            <div className="history-list">
              {auditEntries.map((entry) => (
                <div className="history-item" key={entry.id}>
                  <div className="history-item-head">
                    <strong>{entry.label}</strong>
                    <span>{formatDateTimeBR(entry.createdAt)}</span>
                  </div>
                  {entry.details && <p>{entry.details}</p>}
                  <small>{entry.actor}</small>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {message && <p className="notice-success">{message}</p>}
      {error && <p className="notice-error">{error}</p>}
    </section>
  );
}
