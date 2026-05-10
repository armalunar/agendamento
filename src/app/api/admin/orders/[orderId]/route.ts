import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { recordAdminAudit } from "@/lib/adminAudit";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  buildPaymentMethodLabel,
  buildPaymentStatusLabel,
  type PaymentMethod
} from "@/lib/orderShared";
import {
  cleanText,
  computePricing,
  createOrderHistoryEntry,
  normalizeOrderRecord
} from "@/lib/orders";
import { verifyAdminRequest } from "@/lib/adminGuard";

export const runtime = "nodejs";

type Params = {
  params: Promise<{
    orderId: string;
  }>;
};

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePaymentMethod(value: unknown, fallback: PaymentMethod): PaymentMethod {
  if (value === "card" || value === "cash" || value === "pix") {
    return value;
  }

  return fallback;
}

export async function PATCH(request: NextRequest, context: Params) {
  let adminActor = "Admin";

  try {
    const decoded = await verifyAdminRequest(request);
    adminActor = decoded.name || decoded.email || "Admin";
    const { orderId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const orderRef = adminDb.collection("orders").doc(orderId);
    const snap = await orderRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
    }

    const current = normalizeOrderRecord(snap.id, snap.data());
    const next = normalizeOrderRecord(current.id, {
      ...snap.data(),
      updatedAt: new Date().toISOString()
    });
    const historyEntries = [];

    if (body.status && ["open", "completed", "cancelled"].includes(body.status)) {
      next.status = body.status;
    }

    if (typeof body.isArchived === "boolean") {
      next.isArchived = body.isArchived;
      next.archivedAt = body.isArchived ? new Date().toISOString() : null;

      historyEntries.push(
        createOrderHistoryEntry(
          body.isArchived ? "archived" : "unarchived",
          body.isArchived ? "Ordem arquivada" : "Ordem reativada",
          body.isArchived ? "A ordem foi movida para arquivo." : "A ordem voltou para a lista ativa.",
          adminActor
        )
      );
    }

    if (isFiniteNumber(body.extras) || isFiniteNumber(body.discount) || typeof body.extrasDescription === "string") {
      next.pricing = computePricing(
        current.pricing.baseTotal,
        {
          extras: isFiniteNumber(body.extras) ? body.extras : current.pricing.extras,
          manualDiscount: isFiniteNumber(body.discount) ? body.discount : current.pricing.manualDiscount,
          couponDiscount: current.pricing.couponDiscount,
          couponCode: current.pricing.couponCode,
          couponLabel: current.pricing.couponLabel,
          couponDescription: current.pricing.couponDescription,
          extrasDescription: typeof body.extrasDescription === "string" ? body.extrasDescription : current.pricing.extrasDescription
        }
      );
      next.total = next.pricing.finalTotal;

      historyEntries.push(
        createOrderHistoryEntry(
          "pricing",
          "Valores atualizados",
          `Total final ajustado para ${next.total.toFixed(2)}.`,
          adminActor
        )
      );
    }

    if (
      body.paymentStatus ||
      isFiniteNumber(body.amountPaid) ||
      typeof body.paymentMethod === "string"
    ) {
      next.payment = {
        status:
          body.paymentStatus === "paid" || body.paymentStatus === "partial" || body.paymentStatus === "pending"
            ? body.paymentStatus
            : current.payment.status,
        amountPaid: Math.max(0, isFiniteNumber(body.amountPaid) ? body.amountPaid : current.payment.amountPaid),
        method: normalizePaymentMethod(body.paymentMethod, current.payment.method),
        paidAt: current.payment.paidAt
      };

      if (next.payment.status === "paid" && next.payment.amountPaid <= 0) {
        next.payment.amountPaid = next.total;
      }

      if (next.payment.amountPaid >= next.total && next.total > 0) {
        next.payment.status = "paid";
        next.payment.paidAt = new Date().toISOString();
      } else if (next.payment.amountPaid > 0) {
        next.payment.status = "partial";
        next.payment.paidAt = null;
      } else {
        next.payment.status = body.paymentStatus === "paid" ? "paid" : "pending";
        next.payment.paidAt = next.payment.status === "paid" ? new Date().toISOString() : null;
      }

      historyEntries.push(
        createOrderHistoryEntry(
          "payment",
          "Pagamento atualizado",
          `Status ${buildPaymentStatusLabel(next.payment.status)} em ${buildPaymentMethodLabel(next.payment.method)} com valor pago de ${next.payment.amountPaid.toFixed(2)}.`,
          adminActor
        )
      );
    }

    if (body.completion && typeof body.completion === "object") {
      const completion = body.completion as Record<string, unknown>;
      next.completion = {
        ...current.completion,
        clientNotes: typeof completion.clientNotes === "string" ? cleanText(completion.clientNotes, "") : current.completion.clientNotes,
        privateNotes: typeof completion.privateNotes === "string" ? cleanText(completion.privateNotes, "") : current.completion.privateNotes,
        diagnosis: typeof completion.diagnosis === "string" ? cleanText(completion.diagnosis, "") : current.completion.diagnosis,
        solution: typeof completion.solution === "string" ? cleanText(completion.solution, "") : current.completion.solution,
        checklist: typeof completion.checklist === "string" ? cleanText(completion.checklist, "") : current.completion.checklist,
        warranty: typeof completion.warranty === "string" ? cleanText(completion.warranty, "") : current.completion.warranty,
        completedAt: current.completion.completedAt
      };
    }

    if (next.status === "completed") {
      const hasPublicContent =
        next.completion.clientNotes || next.completion.diagnosis || next.completion.solution || next.completion.checklist;

      if (!hasPublicContent) {
        return NextResponse.json(
          { error: "Preencha pelo menos observações ao cliente, diagnóstico, solução ou checklist antes de concluir." },
          { status: 400 }
        );
      }

      if (!current.completion.completedAt) {
        next.completion.completedAt = new Date().toISOString();
      }

      if (current.status !== "completed") {
        historyEntries.push(
          createOrderHistoryEntry(
            "completed",
            "Ordem concluída",
            "Atendimento marcado como concluído.",
            adminActor
          )
        );
      }
    }

    if (current.status !== "open" && next.status === "open") {
      next.completion.completedAt = null;
      next.delivery = {
        ...current.delivery,
        status: "pending",
        deliveredAt: null
      };

      historyEntries.push(
        createOrderHistoryEntry(
          "reopened",
          "Ordem reaberta",
          "A ordem voltou para o status aberto.",
          adminActor
        )
      );
    }

    if (body.delivery && typeof body.delivery === "object") {
      const delivery = body.delivery as Record<string, unknown>;
      const nextStatus = delivery.status === "delivered" ? "delivered" : "pending";

      next.delivery = {
        status: nextStatus,
        deliveredAt: nextStatus === "delivered" ? new Date().toISOString() : null,
        recipientName:
          typeof delivery.recipientName === "string"
            ? cleanText(delivery.recipientName, "")
            : current.delivery.recipientName,
        confirmation:
          typeof delivery.confirmation === "string"
            ? cleanText(delivery.confirmation, "")
            : current.delivery.confirmation
      };

      if (
        nextStatus !== current.delivery.status ||
        next.delivery.recipientName !== current.delivery.recipientName ||
        next.delivery.confirmation !== current.delivery.confirmation
      ) {
        historyEntries.push(
          createOrderHistoryEntry(
            nextStatus === "delivered" ? "delivered" : "delivery-reset",
            nextStatus === "delivered" ? "Entrega confirmada" : "Entrega reaberta",
            nextStatus === "delivered" ? "Entrega confirmada pelo administrador." : "Entrega voltou para pendente.",
            adminActor
          )
        );
      }
    }

    if (body.attachmentAction && typeof body.attachmentAction === "object") {
      const attachmentAction = body.attachmentAction as Record<string, unknown>;

      if (
        attachmentAction.type === "add" &&
        typeof attachmentAction.id === "string" &&
        typeof attachmentAction.url === "string" &&
        typeof attachmentAction.name === "string"
      ) {
        next.attachments = [
          ...current.attachments,
          {
            id: cleanText(attachmentAction.id, ""),
            url: cleanText(attachmentAction.url, ""),
            name: cleanText(attachmentAction.name, "Arquivo"),
            category:
              attachmentAction.category === "after" || attachmentAction.category === "document"
                ? attachmentAction.category
                : "before",
            createdAt: new Date().toISOString()
          }
        ];

        historyEntries.push(
          createOrderHistoryEntry(
            "attachment",
            "Arquivo anexado",
            `Arquivo ${cleanText(attachmentAction.name, "Arquivo")} anexado a ordem.`,
            adminActor
          )
        );
      }

      if (attachmentAction.type === "remove" && typeof attachmentAction.id === "string") {
        next.attachments = current.attachments.filter((item) => item.id !== attachmentAction.id);

        historyEntries.push(
          createOrderHistoryEntry(
            "attachment-remove",
            "Arquivo removido",
            "Um anexo foi removido da ordem.",
            adminActor
          )
        );
      }
    }

    if (typeof body.privateHistoryNote === "string" && cleanText(body.privateHistoryNote, "")) {
      historyEntries.push(
        createOrderHistoryEntry("note", "Anotacao interna", cleanText(body.privateHistoryNote, ""), adminActor)
      );
    }

    next.history = [...current.history, ...historyEntries].slice(-120);
    next.updatedAt = new Date().toISOString();

    await orderRef.set(
      {
        status: next.status,
        isArchived: next.isArchived,
        archivedAt: next.archivedAt,
        total: next.total,
        pricing: next.pricing,
        payment: next.payment,
        completion: next.completion,
        delivery: next.delivery,
        attachments: next.attachments,
        history: next.history,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    if (historyEntries.length) {
      await recordAdminAudit(
        "order-update",
        `Ordem ${next.orderCode} atualizada`,
        historyEntries.map((entry) => entry.label).join(" | "),
        adminActor
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error instanceof Error &&
      ["ADMIN_ROUTE_LOCKED", "AUTH_MISSING", "ADMIN_REQUIRED"].includes(error.message)
    ) {
      return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401 });
    }

    return NextResponse.json({ error: "Não foi possível atualizar a ordem." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: Params) {
  let adminActor = "Admin";

  try {
    const decoded = await verifyAdminRequest(request);
    adminActor = decoded.name || decoded.email || "Admin";
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401 });
  }

  try {
    const { orderId } = await context.params;
    const orderRef = adminDb.collection("orders").doc(orderId);
    let deletedOrderCode = "";
    let deletedCustomer = "";

    await adminDb.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);

      if (!orderSnap.exists) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const order = normalizeOrderRecord(orderSnap.id, orderSnap.data());
      const dayRef = adminDb.collection("availability").doc(order.schedule.date);
      const daySnap = await transaction.get(dayRef);
      deletedOrderCode = order.orderCode;
      deletedCustomer = order.customer.name;

      if (daySnap.exists) {
        const dayData = daySnap.data() || {};
        const slotsSource = typeof dayData.slots === "object" && dayData.slots !== null ? (dayData.slots as Record<string, string>) : {};
        const nextSlots = { ...slotsSource };

        if (nextSlots[order.schedule.slot] === order.orderCode) {
          delete nextSlots[order.schedule.slot];

          transaction.set(
            dayRef,
            {
              bookedCount: Math.max(0, Number(dayData.bookedCount || 0) - 1),
              slots: nextSlots,
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
      }

      transaction.delete(orderRef);
    });

    await recordAdminAudit(
      "order-delete",
      `Ordem ${deletedOrderCode} apagada`,
      `A ordem de ${deletedCustomer} foi removida e o horário voltou para a agenda.`,
      adminActor
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ error: "Não foi possível apagar a ordem." }, { status: 500 });
  }
}
