import { NextRequest, NextResponse } from "next/server";
import { recordAdminAudit } from "@/lib/adminAudit";
import { getAdminProfile } from "@/lib/adminProfile";
import { verifyAdminRequest } from "@/lib/adminGuard";
import { cleanupExpiredChatAttachments, hydrateChatConversationAttachments } from "@/lib/chatAttachmentServer";
import {
  applyChatLifecycle,
  buildChatMessagePreview,
  cleanChatText,
  createChatMessage,
  isValidChatSessionId,
  limitChatMessages,
  normalizeChatConversation
} from "@/lib/chatShared";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

type Params = {
  params: Promise<{
    chatId: string;
  }>;
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest, context: Params) {
  try {
    await verifyAdminRequest(request);
    const { chatId } = await context.params;

    if (!isValidChatSessionId(chatId)) {
      return NextResponse.json({ error: "Chat inválido." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const chatRef = adminDb.collection("supportChats").doc(chatId);
    const snap = await chatRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const cleanedConversation = await cleanupExpiredChatAttachments(chatRef, normalizeChatConversation(snap.id, snap.data()));
    const lifecycle = applyChatLifecycle(cleanedConversation);
    const conversation = {
      ...lifecycle.conversation,
      unreadForAdmin: false
    };

    if (lifecycle.changed || cleanedConversation.unreadForAdmin) {
      await chatRef.set(
        {
          ...lifecycle.conversation,
          unreadForAdmin: false
        },
        { merge: true }
      );
    }

    const hydratedConversation = await hydrateChatConversationAttachments(chatRef, conversation);

    return NextResponse.json({ conversation: hydratedConversation }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(request: NextRequest, context: Params) {
  let adminActor = "Admin";
  let adminId = "";
  let adminPhotoUrl = "";

  try {
    const decoded = await verifyAdminRequest(request);
    adminId = decoded.uid;
    const adminProfile = await getAdminProfile(decoded.uid, decoded.name || "", decoded.email || "");
    adminActor = adminProfile.displayName || decoded.name || decoded.email || "Admin";
    adminPhotoUrl = adminProfile.photoUrl || adminProfile.photoDataUrl || "";
    const { chatId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const messageText = cleanChatText(body.message, "", 1200);
    const nextStatus = body.status === "closed" || body.status === "open" ? body.status : null;
    const action = body.action === "connect" ? "connect" : null;

    if (!isValidChatSessionId(chatId)) {
      return NextResponse.json({ error: "Chat inválido." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (!messageText && !nextStatus && !action) {
      return NextResponse.json({ error: "Envie uma resposta ou altere o status da conversa." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const chatRef = adminDb.collection("supportChats").doc(chatId);
    const result = await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(chatRef);

      if (!snap.exists) {
        throw new Error("CHAT_NOT_FOUND");
      }

      const current = applyChatLifecycle(normalizeChatConversation(snap.id, snap.data())).conversation;
      const now = new Date().toISOString();
      const next = {
        ...current,
        status: nextStatus || (messageText ? "open" : current.status),
        closedReason: nextStatus === "closed" ? ("manual" as const) : ("" as const),
        closedAt: nextStatus === "closed" ? now : "",
        unreadForAdmin: false,
        updatedAt: now
      };
      const adminChanged = current.activeAdminId !== adminId;

      const canConnectAdmin = current.status === "open" || nextStatus === "open" || Boolean(messageText);

      if ((action === "connect" || messageText) && canConnectAdmin) {
        next.activeAdminId = adminId;
        next.activeAdminName = adminActor;
        next.activeAdminPhotoUrl = adminPhotoUrl;
        next.activeAdminConnectedAt = adminChanged ? now : current.activeAdminConnectedAt || now;

        if (adminChanged) {
          const connectionMessage = createChatMessage("system", `${adminActor} se conectou ao chat.`, "Sistema", now);
          next.messages = limitChatMessages([...current.messages, connectionMessage]);
          next.lastMessage = buildChatMessagePreview(connectionMessage);
          next.lastMessageAt = connectionMessage.createdAt;
          next.updatedAt = connectionMessage.createdAt;
        }
      }

      if (messageText) {
        const reply = createChatMessage("admin", messageText, adminActor, now);
        const baseMessages = next.messages.length === current.messages.length ? current.messages : next.messages;
        next.messages = limitChatMessages([...baseMessages, reply]);
        next.status = "open";
        next.closedReason = "" as const;
        next.closedAt = "";
        next.lastMessage = buildChatMessagePreview(reply);
        next.lastMessageAt = reply.createdAt;
        next.lastAdminMessageAt = reply.createdAt;
        next.updatedAt = reply.createdAt;
      }

      transaction.set(chatRef, next);
      return next;
    });

    if (messageText) {
      await recordAdminAudit(
        "chat-reply",
        "Resposta enviada no chat",
        `Conversa ${chatId} respondida para ${result.customerName}.`,
        adminActor
      );
    }

    if (action === "connect" && result.status === "open" && result.activeAdminId === adminId) {
      await recordAdminAudit(
        "chat-connected",
        "Administrador conectado ao chat",
        `${adminActor} assumiu a conversa ${chatId}.`,
        adminActor
      );
    }

    if (nextStatus) {
      await recordAdminAudit(
        "chat-status",
        nextStatus === "closed" ? "Conversa encerrada" : "Conversa reaberta",
        `Conversa ${chatId} agora está ${nextStatus === "closed" ? "encerrada" : "aberta"}.`,
        adminActor
      );
    }

    const cleanedConversation = await cleanupExpiredChatAttachments(chatRef, result);
    const hydratedConversation = await hydrateChatConversationAttachments(chatRef, cleanedConversation);

    return NextResponse.json({ conversation: hydratedConversation }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof Error && error.message === "CHAT_NOT_FOUND") {
      return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Não foi possível atualizar a conversa." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
