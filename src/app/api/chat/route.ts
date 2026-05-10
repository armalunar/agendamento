import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { ChatAttachmentValidationError, cleanupExpiredChatAttachments, hydrateChatConversationAttachments, parseIncomingChatAttachments } from "@/lib/chatAttachmentServer";
import {
  applyChatLifecycle,
  buildChatMessagePreview,
  cleanChatText,
  createChatMessage,
  isValidChatSessionId,
  limitChatMessages,
  normalizeChatConversation
} from "@/lib/chatShared";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest) {
  const sessionId = cleanChatText(request.nextUrl.searchParams.get("sessionId") || "", "", 90);

  if (!sessionId) {
    return NextResponse.json({ conversation: null }, { headers: NO_STORE_HEADERS });
  }

  if (!isValidChatSessionId(sessionId)) {
    return NextResponse.json({ error: "Sessão de chat inválida." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const chatRef = adminDb.collection("supportChats").doc(sessionId);
  const snap = await chatRef.get();

  if (!snap.exists) {
    return NextResponse.json({ conversation: null }, { headers: NO_STORE_HEADERS });
  }

  const cleanedConversation = await cleanupExpiredChatAttachments(chatRef, normalizeChatConversation(snap.id, snap.data()));
  const lifecycle = applyChatLifecycle(cleanedConversation);

  if (lifecycle.changed) {
    await chatRef.set(lifecycle.conversation, { merge: true });
  }

  const conversation = await hydrateChatConversationAttachments(chatRef, lifecycle.conversation);

  return NextResponse.json({ conversation }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = cleanChatText(body.sessionId, "", 90);
    const customerName = cleanChatText(body.customerName, "", 120);
    const customerPhone = cleanChatText(body.customerPhone, "", 40);
    const orderCode = cleanChatText(body.orderCode, "", 40).toUpperCase();
    const messageText = cleanChatText(body.message, "", 1200);
    const createdAt = new Date().toISOString();
    const parsedAttachments = parseIncomingChatAttachments(body.attachments, createdAt);

    if (!sessionId || !isValidChatSessionId(sessionId)) {
      return NextResponse.json({ error: "Sessão de chat inválida." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (!customerName) {
      return NextResponse.json({ error: "Informe seu nome para iniciar o atendimento." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (!messageText && !parsedAttachments.length) {
      return NextResponse.json({ error: "Digite sua dúvida ou envie um anexo antes de continuar." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const chatRef = adminDb.collection("supportChats").doc(sessionId);
    const nextConversation = await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(chatRef);
      const current = snap.exists ? applyChatLifecycle(normalizeChatConversation(snap.id, snap.data())).conversation : null;
      const message = createChatMessage(
        "customer",
        messageText,
        customerName,
        createdAt,
        parsedAttachments.map((item) => item.meta)
      );
      const shouldRestart = current?.status === "closed";

      const next = current
        ? shouldRestart
          ? {
              ...current,
              status: "open" as const,
              closedReason: "" as const,
              closedAt: "",
              customerName: customerName || current.customerName,
              customerPhone: customerPhone || current.customerPhone,
              orderCode: orderCode || current.orderCode,
              activeAdminId: "",
              activeAdminName: "",
              activeAdminPhotoUrl: "",
              activeAdminConnectedAt: "",
              unreadForAdmin: true,
              lastMessage: buildChatMessagePreview(message),
              lastMessageAt: message.createdAt,
              lastCustomerMessageAt: message.createdAt,
              lastAdminMessageAt: "",
              createdAt: message.createdAt,
              updatedAt: message.createdAt,
              resetCount: current.resetCount + 1,
              messages: [message]
            }
          : {
              ...current,
              status: "open" as const,
              closedReason: "" as const,
              closedAt: "",
              customerName: customerName || current.customerName,
              customerPhone: customerPhone || current.customerPhone,
              orderCode: orderCode || current.orderCode,
              unreadForAdmin: true,
              lastMessage: buildChatMessagePreview(message),
              lastMessageAt: message.createdAt,
              lastCustomerMessageAt: message.createdAt,
              updatedAt: message.createdAt,
              messages: limitChatMessages([...current.messages, message])
            }
        : {
            id: sessionId,
            sessionId,
            source: "site" as const,
            status: "open" as const,
            closedReason: "" as const,
            closedAt: "",
            customerName,
            customerPhone,
            orderCode,
            activeAdminId: "",
            activeAdminName: "",
            activeAdminPhotoUrl: "",
            activeAdminConnectedAt: "",
            unreadForAdmin: true,
            lastMessage: buildChatMessagePreview(message),
            lastMessageAt: message.createdAt,
            lastCustomerMessageAt: message.createdAt,
            lastAdminMessageAt: "",
            createdAt: message.createdAt,
            updatedAt: message.createdAt,
            resetCount: 0,
            messages: [message]
          };

      transaction.set(chatRef, next);

      for (const attachment of parsedAttachments) {
        transaction.set(chatRef.collection("attachments").doc(attachment.meta.id), attachment.doc);
      }

      return next;
    });

    const cleanedConversation = await cleanupExpiredChatAttachments(chatRef, nextConversation);
    const hydratedConversation = normalizeChatConversation(
      cleanedConversation.id,
      cleanedConversation,
      Object.fromEntries(parsedAttachments.map((attachment) => [attachment.meta.id, attachment.url]))
    );

    return NextResponse.json({ conversation: hydratedConversation }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar sua mensagem agora.";
    const status = error instanceof ChatAttachmentValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
  }
}
