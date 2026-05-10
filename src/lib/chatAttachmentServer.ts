import type { DocumentReference } from "firebase-admin/firestore";
import {
  CHAT_MAX_ATTACHMENT_BYTES,
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_ATTACHMENT_RETENTION_DAYS,
  buildChatMessagePreview,
  cleanChatText,
  normalizeChatConversation,
  type ChatAttachmentKind,
  type ChatAttachmentMeta,
  type ChatConversation
} from "@/lib/chatShared";

type StoredAttachmentDoc = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  createdAt: string;
  expiresAt: string;
  dataUrl?: string;
  bytes?: Uint8Array;
};

type ParsedChatAttachment = {
  meta: ChatAttachmentMeta;
  doc: StoredAttachmentDoc;
  url: string;
};

export class ChatAttachmentValidationError extends Error {}

function addDaysToIso(isoDate: string, days: number) {
  const base = new Date(isoDate);
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

function createAttachmentId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanChatFileName(value: unknown, fallback = "Arquivo") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/[\r\n\t]+/g, " ").slice(0, 140);
  return normalized || fallback;
}

function extractBase64Content(value: string) {
  const dataUrlMatch = value.match(/^data:([\w.+/-]+);base64,([a-z0-9+/=]+)$/i);

  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1].toLowerCase(),
      base64: dataUrlMatch[2]
    };
  }

  return {
    mimeType: "",
    base64: value.trim()
  };
}

function bytesToDataUrl(mimeType: string, bytesValue: unknown) {
  if (bytesValue instanceof Uint8Array) {
    const base64 = Buffer.from(bytesValue).toString("base64");
    return `data:${mimeType};base64,${base64}`;
  }

  if (typeof bytesValue !== "object" || bytesValue === null || !("toUint8Array" in bytesValue) || typeof bytesValue.toUint8Array !== "function") {
    return "";
  }

  const bytes = bytesValue.toUint8Array() as Uint8Array;
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

export function parseIncomingChatAttachments(value: unknown, createdAt = new Date().toISOString()) {
  if (value == null) {
    return [] as ParsedChatAttachment[];
  }

  if (!Array.isArray(value)) {
    throw new ChatAttachmentValidationError("Os anexos enviados são inválidos.");
  }

  if (value.length > CHAT_MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new ChatAttachmentValidationError(`Envie no máximo ${CHAT_MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem.`);
  }

  return value.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new ChatAttachmentValidationError("O anexo enviado é inválido.");
    }

    const raw = item as Record<string, unknown>;
    const providedMimeType = cleanChatText(raw.mimeType, "application/octet-stream", 120).toLowerCase();
    const providedContent = typeof raw.content === "string" ? raw.content : "";
    const extracted = extractBase64Content(providedContent);
    const mimeType = extracted.mimeType || providedMimeType || "application/octet-stream";
    const kind: ChatAttachmentKind = mimeType.startsWith("image/") ? "image" : "file";
    const base64 = extracted.base64;

    if (!base64) {
      throw new ChatAttachmentValidationError("Não foi possível ler o anexo enviado.");
    }

    const bytes = Buffer.from(base64, "base64");

    if (!bytes.length) {
      throw new ChatAttachmentValidationError("O anexo enviado está vazio.");
    }

    if (bytes.length > CHAT_MAX_ATTACHMENT_BYTES) {
      throw new ChatAttachmentValidationError("Cada anexo do chat precisa ter até 450 KB.");
    }

    const id = createAttachmentId();
    const name = cleanChatFileName(raw.name, kind === "image" ? "imagem-chat" : "arquivo-chat");
    const meta: ChatAttachmentMeta = {
      id,
      name,
      mimeType,
      size: bytes.length,
      kind
    };

    if (kind === "image") {
      const dataUrl = providedContent.startsWith("data:") ? providedContent : `data:${mimeType};base64,${base64}`;

      return {
        meta,
        doc: {
          ...meta,
          createdAt,
          expiresAt: addDaysToIso(createdAt, CHAT_ATTACHMENT_RETENTION_DAYS),
          dataUrl
        },
        url: dataUrl
      };
    }

    const fileDataUrl = `data:${mimeType};base64,${base64}`;

    return {
      meta,
      doc: {
        ...meta,
        createdAt,
        expiresAt: addDaysToIso(createdAt, CHAT_ATTACHMENT_RETENTION_DAYS),
        bytes: new Uint8Array(bytes)
      },
      url: fileDataUrl
    };
  });
}

function stripMissingAttachments(conversation: ChatConversation) {
  const nextMessages = conversation.messages
    .map((message) => ({
      ...message,
      attachments: message.attachments.filter((attachment) => Boolean(attachment.url))
    }))
    .filter((message) => message.text || message.attachments.length);

  const lastMessage = nextMessages[nextMessages.length - 1] || null;

  return {
    ...conversation,
    lastMessage: lastMessage ? buildChatMessagePreview(lastMessage) : "",
    lastMessageAt: lastMessage?.createdAt || conversation.createdAt,
    messages: nextMessages
  };
}

function stripExpiredAttachments(conversation: ChatConversation, expiredIds: Set<string>) {
  if (!expiredIds.size) {
    return conversation;
  }

  const nextMessages = conversation.messages
    .map((message) => ({
      ...message,
      attachments: message.attachments.filter((attachment) => !expiredIds.has(attachment.id))
    }))
    .filter((message) => message.text || message.attachments.length);

  const lastMessage = nextMessages[nextMessages.length - 1] || null;

  return {
    ...conversation,
    lastMessage: lastMessage ? buildChatMessagePreview(lastMessage) : "",
    lastMessageAt: lastMessage?.createdAt || conversation.createdAt,
    messages: nextMessages
  };
}

export async function cleanupExpiredChatAttachments(chatRef: DocumentReference, conversation: ChatConversation) {
  const nowIso = new Date().toISOString();
  const expiredSnap = await chatRef.collection("attachments").where("expiresAt", "<=", nowIso).get();

  if (expiredSnap.empty) {
    return conversation;
  }

  const expiredIds = new Set(expiredSnap.docs.map((doc) => doc.id));
  const nextConversation = stripExpiredAttachments(conversation, expiredIds);
  const batch = chatRef.firestore.batch();

  for (const doc of expiredSnap.docs) {
    batch.delete(doc.ref);
  }

  batch.set(
    chatRef,
    {
      messages: nextConversation.messages,
      lastMessage: nextConversation.lastMessage,
      lastMessageAt: nextConversation.lastMessageAt
    },
    { merge: true }
  );

  await batch.commit();

  return nextConversation;
}

export async function hydrateChatConversationAttachments(chatRef: DocumentReference, conversation: ChatConversation) {
  const attachmentIds = conversation.messages.flatMap((message) => message.attachments.map((attachment) => attachment.id));

  if (!attachmentIds.length) {
    return conversation;
  }

  const attachmentSnap = await chatRef.collection("attachments").get();
  const attachmentUrlMap: Record<string, string> = {};

  for (const doc of attachmentSnap.docs) {
    const data = doc.data();
    const mimeType = cleanChatText(data.mimeType, "application/octet-stream", 120).toLowerCase();

    if (typeof data.dataUrl === "string" && data.dataUrl.startsWith("data:")) {
      attachmentUrlMap[doc.id] = data.dataUrl;
      continue;
    }

    const dataUrl = bytesToDataUrl(mimeType, data.bytes);

    if (dataUrl) {
      attachmentUrlMap[doc.id] = dataUrl;
    }
  }

  return stripMissingAttachments(normalizeChatConversation(chatRef.id, { ...conversation }, attachmentUrlMap));
}
