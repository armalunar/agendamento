"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { formatDateTimeBR } from "@/lib/date";
import type { ChatAttachment, ChatCloseReason, ChatConversation, ChatConversationSummary, ChatStatus } from "@/lib/chatShared";

const CHAT_LIST_POLL_MS = 3000;

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1).replace(".0", "")} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".0", "")} MB`;
}

function chatStatusLabel(status: ChatStatus, closedReason: ChatCloseReason = "") {
  if (status === "closed" && closedReason === "timeout") {
    return "Reiniciado";
  }

  return status === "closed" ? "Fechado" : "Aberto";
}

function chatStatusHint(conversation: Pick<ChatConversation, "status" | "closedReason" | "lastAdminMessageAt" | "closedAt">) {
  if (conversation.status !== "closed") {
    return "";
  }

  if (conversation.closedReason === "timeout") {
    return "Sem resposta do cliente por mais de 5 minutos. A proxima mensagem dele abre um novo atendimento.";
  }

  if (conversation.closedReason === "manual") {
    return "Chat fechado manualmente. Se o cliente voltar a escrever, o atendimento recomeca.";
  }

  return "";
}

function ChatAttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.kind === "image" && attachment.url) {
    return (
      <a className="chat-attachment-image-link" href={attachment.url} target="_blank" rel="noreferrer" download={attachment.name}>
        <img className="chat-attachment-preview" src={attachment.url} alt={attachment.name} />
        <span className="chat-attachment-caption">
          <strong>{attachment.name}</strong>
          <small>{formatFileSize(attachment.size)}</small>
        </span>
      </a>
    );
  }

  return (
    <a className="chat-attachment-file" href={attachment.url} target="_blank" rel="noreferrer" download={attachment.name}>
      <strong>{attachment.name}</strong>
      <span>{formatFileSize(attachment.size)}</span>
    </a>
  );
}

export default function AdminChatInbox() {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [chats, setChats] = useState<ChatConversationSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [reply, setReply] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedSummary = useMemo(
    () => chats.find((item) => item.id === selectedChatId) || null,
    [chats, selectedChatId]
  );

  useEffect(() => {
    void loadChats();
  }, []);

  useEffect(() => {
    if (!selectedChatId) {
      setConversation(null);
      return;
    }

    void connectConversation(selectedChatId);
  }, [selectedChatId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadChats(true);

      if (selectedChatId) {
        void loadConversation(selectedChatId, true);
      }
    }, CHAT_LIST_POLL_MS);

    return () => window.clearInterval(interval);
  }, [selectedChatId]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [conversation]);

  async function authHeaders() {
    if (!auth.currentUser) {
      throw new Error("Faça login novamente para acessar o chat.");
    }

    const token = await auth.currentUser.getIdToken();
    return {
      Authorization: `Bearer ${token}`
    };
  }

  async function loadChats(silent = false) {
    if (!silent) {
      setLoadingList(true);
    }

    try {
      const response = await fetch("/api/admin/chat?limit=80", {
        headers: await authHeaders(),
        cache: "no-store"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível carregar as conversas.");
      }

      const nextChats = (data.chats || []) as ChatConversationSummary[];
      setChats(nextChats);
      setSelectedChatId((current) => {
        if (current && nextChats.some((item) => item.id === current)) {
          return current;
        }

        return nextChats[0]?.id || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar conversas.");
    } finally {
      if (!silent) {
        setLoadingList(false);
      }
    }
  }

  async function loadConversation(chatId: string, silent = false) {
    if (!chatId) {
      return;
    }

    if (!silent) {
      setLoadingConversation(true);
    }

    try {
      const response = await fetch(`/api/admin/chat/${chatId}`, {
        headers: await authHeaders(),
        cache: "no-store"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível abrir a conversa.");
      }

      setConversation(data.conversation as ChatConversation);
      setChats((current) =>
        current.map((item) =>
          item.id === chatId
            ? {
                ...item,
                unreadForAdmin: false
              }
            : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao abrir conversa.");
    } finally {
      if (!silent) {
        setLoadingConversation(false);
      }
    }
  }

  async function connectConversation(chatId: string) {
    if (!chatId) {
      return;
    }

    setLoadingConversation(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/chat/${chatId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders())
        },
        body: JSON.stringify({ action: "connect" })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível conectar ao chat.");
      }

      setConversation(data.conversation as ChatConversation);
      await loadChats(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao conectar ao chat.");
    } finally {
      setLoadingConversation(false);
    }
  }

  async function patchConversation(payload: Record<string, unknown>, successMessage: string) {
    if (!selectedChatId) {
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/chat/${selectedChatId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders())
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível atualizar a conversa.");
      }

      setConversation(data.conversation as ChatConversation);
      setMessage(successMessage);
      await loadChats(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar conversa.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function sendReply() {
    if (!reply.trim()) {
      setError("Digite uma resposta antes de enviar.");
      return;
    }

    const ok = await patchConversation({ message: reply }, "Resposta enviada no chat.");

    if (ok) {
      setReply("");
    }
  }

  return (
    <div className="card admin-chat-card">
      <div className="copy-panel-head">
        <div>
          <div className="badge">Chat ao vivo</div>
          <h2>Mensagens recebidas pelo site</h2>
          <p className="mini">
            Você já responde pelo admin. Agora o cliente também pode mandar anexos direto pelo webchat.
          </p>
        </div>

        <button className="btn btn-ghost btn-small" type="button" onClick={() => loadChats()} disabled={loadingList || working}>
          {loadingList ? "Atualizando..." : "Atualizar conversas"}
        </button>
      </div>

      <div className="admin-chat-layout">
        <aside className="admin-chat-sidebar">
          {chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              className={`admin-chat-item ${selectedChatId === chat.id ? "active" : ""}`}
              onClick={() => setSelectedChatId(chat.id)}
            >
              <div className="admin-chat-item-head">
                <strong>{chat.customerName}</strong>
                {chat.unreadForAdmin && <span className="mini-badge">Nova</span>}
              </div>
              <span className="mini">{chat.orderCode || chat.customerPhone || "Sem telefone informado"}</span>
              <p>{chat.lastMessage}</p>
              <div className="admin-chat-item-foot">
                <span>{chatStatusLabel(chat.status, chat.closedReason)}</span>
                <span>{formatDateTimeBR(chat.lastMessageAt)}</span>
              </div>
            </button>
          ))}

          {!loadingList && !chats.length && <p className="mini">Nenhuma conversa iniciada pelo site até agora.</p>}
        </aside>

        <div className="admin-chat-thread">
          {conversation ? (
            <>
              <div className="admin-chat-thread-head">
                <div>
                  <span className="detail-label">Cliente</span>
                  <h3>{conversation.customerName}</h3>
                  <div className="chip-row">
                    {conversation.customerPhone && <span className="chip">{conversation.customerPhone}</span>}
                    {conversation.orderCode && <span className="chip">{conversation.orderCode}</span>}
                    <span className="chip">{chatStatusLabel(conversation.status, conversation.closedReason)}</span>
                    {conversation.resetCount > 0 && <span className="chip">{conversation.resetCount} reinicio(s)</span>}
                  </div>
                  {conversation.status === "open" && conversation.activeAdminName && (
                    <div className="admin-chat-active-admin">
                      {conversation.activeAdminPhotoUrl ? (
                        <img className="admin-chat-active-admin-avatar" src={conversation.activeAdminPhotoUrl} alt={conversation.activeAdminName} />
                      ) : (
                        <span className="admin-chat-active-admin-avatar admin-chat-active-admin-fallback" aria-hidden="true">
                          {conversation.activeAdminName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span>Atendendo agora: {conversation.activeAdminName}</span>
                    </div>
                  )}
                  {chatStatusHint(conversation) && <p className="mini">{chatStatusHint(conversation)}</p>}
                </div>

                <div className="actions">
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={() =>
                      patchConversation(
                        { status: conversation.status === "closed" ? "open" : "closed" },
                        conversation.status === "closed" ? "Chat reaberto." : "Chat fechado."
                      )
                    }
                    disabled={working}
                  >
                    {conversation.status === "closed" ? "Reabrir chat" : "Fechar chat"}
                  </button>
                </div>
              </div>

              <div className="admin-chat-messages" ref={messagesRef}>
                {conversation.messages.map((item) => (
                  <div className={`chat-bubble ${item.sender}`} key={item.id}>
                    <div className="chat-bubble-meta">
                      <strong>{item.author}</strong>
                      <span>{formatDateTimeBR(item.createdAt)}</span>
                    </div>
                    {item.text && <p className="chat-bubble-text">{item.text}</p>}
                    {!!item.attachments.length && (
                      <div className="chat-attachment-list">
                        {item.attachments.map((attachment) => (
                          <ChatAttachmentPreview attachment={attachment} key={attachment.id} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <label>
                <span>Responder pelo admin</span>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Digite aqui sua resposta para o cliente..."
                />
              </label>

              <div className="actions">
                <button className="btn btn-primary" type="button" onClick={sendReply} disabled={working || loadingConversation}>
                  {working ? "Enviando..." : "Enviar resposta"}
                </button>
              </div>
            </>
          ) : (
            <div className="chat-empty-state">
              <p>{loadingConversation ? "Carregando conversa..." : "Escolha uma conversa à esquerda para responder."}</p>
            </div>
          )}
        </div>
      </div>

      {selectedSummary && !conversation && <p className="mini">Abrindo conversa de {selectedSummary.customerName}...</p>}
      {message && <p className="notice-success">{message}</p>}
      {error && <p className="notice-error">{error}</p>}
    </div>
  );
}
