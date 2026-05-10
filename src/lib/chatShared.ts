export type ChatSender = "customer" | "admin" | "system";
export type ChatStatus = "open" | "closed";
export type ChatCloseReason = "" | "manual" | "timeout";
export type ChatAttachmentKind = "image" | "file";

export const CHAT_MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const CHAT_MAX_ATTACHMENT_BYTES = 700 * 1024;
export const CHAT_ATTACHMENT_RETENTION_DAYS = 7;
export const CHAT_CUSTOMER_REPLY_TIMEOUT_MS = 5 * 60 * 1000;

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  url: string;
};

export type ChatAttachmentMeta = Omit<ChatAttachment, "url">;

export type ChatMessage = {
  id: string;
  sender: ChatSender;
  text: string;
  createdAt: string;
  author: string;
  attachments: ChatAttachment[];
};

export type ChatConversation = {
  id: string;
  sessionId: string;
  source: "site";
  status: ChatStatus;
  closedReason: ChatCloseReason;
  closedAt: string;
  customerName: string;
  customerPhone: string;
  orderCode: string;
  activeAdminId: string;
  activeAdminName: string;
  activeAdminPhotoUrl: string;
  activeAdminConnectedAt: string;
  unreadForAdmin: boolean;
  lastMessage: string;
  lastMessageAt: string;
  lastCustomerMessageAt: string;
  lastAdminMessageAt: string;
  createdAt: string;
  updatedAt: string;
  resetCount: number;
  messages: ChatMessage[];
};

export type ChatConversationSummary = {
  id: string;
  sessionId: string;
  status: ChatStatus;
  closedReason: ChatCloseReason;
  closedAt: string;
  customerName: string;
  customerPhone: string;
  orderCode: string;
  activeAdminId: string;
  activeAdminName: string;
  activeAdminPhotoUrl: string;
  activeAdminConnectedAt: string;
  unreadForAdmin: boolean;
  lastMessage: string;
  lastMessageAt: string;
  lastCustomerMessageAt: string;
  lastAdminMessageAt: string;
  createdAt: string;
  updatedAt: string;
  resetCount: number;
  messageCount: number;
};

type ChatLifecycleResult = {
  conversation: ChatConversation;
  changed: boolean;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeTimestamp(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  return "";
}

function cleanChatFileName(value: unknown, fallback = "Arquivo") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/[\r\n\t]+/g, " ").slice(0, 140);
  return normalized || fallback;
}

function normalizeChatAttachmentMeta(value: unknown): ChatAttachmentMeta[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => {
      const kind: ChatAttachmentKind = item.kind === "image" ? "image" : "file";

      return {
        id: cleanChatText(item.id, createId("att"), 80),
        name: cleanChatFileName(item.name, "Arquivo"),
        mimeType: cleanChatText(item.mimeType, "application/octet-stream", 120).toLowerCase(),
        size: Math.max(0, Number(item.size) || 0),
        kind
      };
    })
    .slice(0, CHAT_MAX_ATTACHMENTS_PER_MESSAGE);
}

function getTimestampMs(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function cleanChatText(value: unknown, fallback = "", maxLength = 1200) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  const limited = trimmed.slice(0, maxLength);
  return limited || fallback;
}

export function isValidChatSessionId(value: string) {
  return /^chat-[a-z0-9-]{8,80}$/.test(value);
}

export function buildChatMessagePreview(message: Pick<ChatMessage, "text" | "attachments">) {
  if (message.text) {
    return message.text;
  }

  if (!message.attachments.length) {
    return "";
  }

  return message.attachments.length === 1 ? "1 anexo enviado" : `${message.attachments.length} anexos enviados`;
}

export function createChatMessage(
  sender: ChatSender,
  text: string,
  author: string,
  createdAt = new Date().toISOString(),
  attachments: ChatAttachmentMeta[] = []
): ChatMessage {
  return {
    id: createId("msg"),
    sender,
    text: cleanChatText(text, "", 1200),
    createdAt,
    author: cleanChatText(author, sender === "admin" ? "Admin" : sender === "system" ? "Sistema" : "Cliente", 120),
    attachments: attachments.map((attachment) => ({
      ...attachment,
      url: ""
    }))
  };
}

export function limitChatMessages(messages: ChatMessage[], max = 150) {
  return messages.slice(-max);
}

export function normalizeChatConversation(id: string, value: unknown, attachmentUrls: Record<string, string> = {}): ChatConversation {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const messages: ChatMessage[] = Array.isArray(source.messages)
    ? source.messages
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => {
          const attachments = normalizeChatAttachmentMeta(item.attachments).map((attachment) => ({
            ...attachment,
            url: attachmentUrls[attachment.id] || ""
          }));

          return {
            id: cleanChatText(item.id, createId("msg"), 80),
            sender: (item.sender === "admin" ? "admin" : item.sender === "system" ? "system" : "customer") as ChatSender,
            text: cleanChatText(item.text, "", 1200),
            createdAt: serializeTimestamp(item.createdAt) || new Date().toISOString(),
            author: cleanChatText(item.author, item.sender === "admin" ? "Admin" : item.sender === "system" ? "Sistema" : "Cliente", 120),
            attachments
          };
        })
        .filter((item) => item.text || item.attachments.length)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];

  const lastMessage = messages[messages.length - 1] || null;
  const lastCustomerMessage = [...messages].reverse().find((item) => item.sender === "customer") || null;
  const lastAdminMessage = [...messages].reverse().find((item) => item.sender === "admin") || null;
  const normalizedStatus: ChatStatus = source.status === "closed" ? "closed" : "open";
  const normalizedClosedReason: ChatCloseReason =
    normalizedStatus === "closed" && source.closedReason === "timeout"
      ? "timeout"
      : normalizedStatus === "closed" && source.closedReason === "manual"
        ? "manual"
        : "";

  return {
    id,
    sessionId: cleanChatText(source.sessionId, id, 90),
    source: "site",
    status: normalizedStatus,
    closedReason: normalizedClosedReason,
    closedAt: normalizedStatus === "closed" ? serializeTimestamp(source.closedAt) || "" : "",
    customerName: cleanChatText(source.customerName, "Cliente", 120),
    customerPhone: cleanChatText(source.customerPhone, "", 40),
    orderCode: cleanChatText(source.orderCode, "", 40).toUpperCase(),
    activeAdminId: cleanChatText(source.activeAdminId, "", 120),
    activeAdminName: cleanChatText(source.activeAdminName, "", 120),
    activeAdminPhotoUrl: cleanChatText(source.activeAdminPhotoUrl, "", 1000),
    activeAdminConnectedAt: serializeTimestamp(source.activeAdminConnectedAt) || "",
    unreadForAdmin: source.unreadForAdmin === true,
    lastMessage: cleanChatText(source.lastMessage, lastMessage ? buildChatMessagePreview(lastMessage) : "", 240),
    lastMessageAt: serializeTimestamp(source.lastMessageAt) || lastMessage?.createdAt || new Date().toISOString(),
    lastCustomerMessageAt: serializeTimestamp(source.lastCustomerMessageAt) || lastCustomerMessage?.createdAt || "",
    lastAdminMessageAt: serializeTimestamp(source.lastAdminMessageAt) || lastAdminMessage?.createdAt || "",
    createdAt: serializeTimestamp(source.createdAt) || messages[0]?.createdAt || new Date().toISOString(),
    updatedAt: serializeTimestamp(source.updatedAt) || lastMessage?.createdAt || new Date().toISOString(),
    resetCount: Math.max(0, Number(source.resetCount) || 0),
    messages
  };
}

export function buildChatConversationSummary(conversation: ChatConversation): ChatConversationSummary {
  return {
    id: conversation.id,
    sessionId: conversation.sessionId,
    status: conversation.status,
    closedReason: conversation.closedReason,
    closedAt: conversation.closedAt,
    customerName: conversation.customerName,
    customerPhone: conversation.customerPhone,
    orderCode: conversation.orderCode,
    activeAdminId: conversation.activeAdminId,
    activeAdminName: conversation.activeAdminName,
    activeAdminPhotoUrl: conversation.activeAdminPhotoUrl,
    activeAdminConnectedAt: conversation.activeAdminConnectedAt,
    unreadForAdmin: conversation.unreadForAdmin,
    lastMessage: conversation.lastMessage,
    lastMessageAt: conversation.lastMessageAt,
    lastCustomerMessageAt: conversation.lastCustomerMessageAt,
    lastAdminMessageAt: conversation.lastAdminMessageAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    resetCount: conversation.resetCount,
    messageCount: conversation.messages.length
  };
}

export function getChatWaitingDeadline(conversation: Pick<ChatConversation, "lastAdminMessageAt" | "lastCustomerMessageAt">) {
  const adminTimestamp = getTimestampMs(conversation.lastAdminMessageAt);
  const customerTimestamp = getTimestampMs(conversation.lastCustomerMessageAt);

  if (!adminTimestamp || adminTimestamp <= customerTimestamp) {
    return "";
  }

  return new Date(adminTimestamp + CHAT_CUSTOMER_REPLY_TIMEOUT_MS).toISOString();
}

export function applyChatLifecycle(conversation: ChatConversation, now = new Date().toISOString()): ChatLifecycleResult {
  const deadline = getChatWaitingDeadline(conversation);

  if (!deadline || conversation.status !== "open") {
    return { conversation, changed: false };
  }

  if (getTimestampMs(deadline) > getTimestampMs(now)) {
    return { conversation, changed: false };
  }

  return {
    conversation: {
      ...conversation,
      status: "closed",
      closedReason: "timeout",
      closedAt: now,
      updatedAt: now
    },
    changed: true
  };
}
