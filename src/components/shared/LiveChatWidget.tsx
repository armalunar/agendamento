"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import useAccessibilityMode from "@/components/shared/useAccessibilityMode";
import {
  CHAT_ATTACHMENT_RETENTION_DAYS,
  CHAT_MAX_ATTACHMENT_BYTES,
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  type ChatAttachment,
  type ChatCloseReason,
  type ChatConversation
} from "@/lib/chatShared";

const SESSION_KEY = "pc-live-chat-session";
const PROFILE_KEY = "pc-live-chat-profile";
const CHAT_POLL_MS_OPEN = 2500;
const CHAT_POLL_MS_IDLE = 8000;
const IMAGE_MAX_DIMENSION = 1280;

type ChatProfile = {
  name: string;
  phone: string;
  orderCode: string;
  message: string;
};

type DraftChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "file";
  content: string;
};

function createSessionId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDraftAttachmentId() {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1).replace(".0", "")} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".0", "")} MB`;
}

function base64ByteLength(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function getDataUrlPayload(dataUrl: string) {
  const parts = dataUrl.split(",", 2);
  return parts[1] || "";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
}

function replaceExtension(name: string, mimeType: string) {
  const extensionMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const extension = extensionMap[mimeType];

  if (!extension) {
    return name;
  }

  return name.replace(/\.[^.]+$/, "") + `.${extension}`;
}

function loadImageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não consegui preparar a imagem para envio."));
    image.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Não consegui ler o arquivo selecionado."));
    reader.readAsDataURL(file);
  });
}

async function prepareImageAttachment(file: File): Promise<DraftChatAttachment> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);
  const canvas = document.createElement("canvas");
  const ratio = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(image.width, image.height));

  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Não consegui preparar a imagem para envio.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const candidateTypes = file.type === "image/png" ? ["image/webp", "image/jpeg", "image/png"] : [file.type || "image/jpeg", "image/webp", "image/jpeg"];
  let bestDataUrl = originalDataUrl;
  let bestMimeType = file.type || "image/jpeg";
  let bestSize = base64ByteLength(getDataUrlPayload(originalDataUrl));

  for (const mimeType of candidateTypes) {
    for (const quality of [0.86, 0.76, 0.66]) {
      const dataUrl = canvas.toDataURL(mimeType, quality);
      const size = base64ByteLength(getDataUrlPayload(dataUrl));

      if (size < bestSize) {
        bestDataUrl = dataUrl;
        bestMimeType = mimeType;
        bestSize = size;
      }

      if (size <= CHAT_MAX_ATTACHMENT_BYTES) {
        return {
          id: createDraftAttachmentId(),
          name: replaceExtension(file.name, mimeType),
          mimeType,
          size,
          kind: "image",
          content: dataUrl
        };
      }
    }
  }

  if (bestSize <= CHAT_MAX_ATTACHMENT_BYTES) {
    return {
      id: createDraftAttachmentId(),
      name: replaceExtension(file.name, bestMimeType),
      mimeType: bestMimeType,
      size: bestSize,
      kind: "image",
      content: bestDataUrl
    };
  }

  throw new Error("Essa imagem ficou grande demais para o Firestore. Para 10 MB, precisa mudar para Firebase Storage.");
}

async function prepareFileAttachment(file: File): Promise<DraftChatAttachment> {
  if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
    throw new Error("Esse arquivo ficou grande demais para o Firestore. Para 10 MB, precisa usar Firebase Storage.");
  }

  const buffer = await file.arrayBuffer();
  const base64 = bytesToBase64(new Uint8Array(buffer));

  return {
    id: createDraftAttachmentId(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind: "file",
    content: base64
  };
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

function getClosedChatLabel(reason: ChatCloseReason, easy: boolean) {
  if (reason === "timeout") {
    return easy ? "Chat reiniciado por falta de resposta" : "Chat reiniciado por inatividade";
  }

  return easy ? "Atendimento encerrado" : "Chat encerrado";
}

function getClosedChatHint(reason: ChatCloseReason, easy: boolean) {
  if (reason === "timeout") {
    return easy
      ? "Ficou mais de 5 minutos sem resposta. Sua proxima mensagem abre um novo atendimento."
      : "Passaram mais de 5 minutos sem resposta do cliente. Sua proxima mensagem comeca um novo atendimento.";
  }

  return easy
    ? "Se quiser continuar, mande outra mensagem e eu abro um novo atendimento."
    : "Se quiser voltar a falar, envie outra mensagem para abrir um novo atendimento.";
}

export default function LiveChatWidget() {
  const accessibilityMode = useAccessibilityMode();
  const isEasy = accessibilityMode === "easy";
  const pathname = usePathname();
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [attachments, setAttachments] = useState<DraftChatAttachment[]>([]);
  const [form, setForm] = useState<ChatProfile>({
    name: "",
    phone: "",
    orderCode: "",
    message: ""
  });

  const hidden = pathname.startsWith("/admin") || pathname === "/login";

  useEffect(() => {
    setMounted(true);

    try {
      const storedSession = localStorage.getItem(SESSION_KEY) || "";
      const storedProfile = localStorage.getItem(PROFILE_KEY);

      if (storedSession) {
        setSessionId(storedSession);
      }

      if (storedProfile) {
        const parsed = JSON.parse(storedProfile) as Partial<ChatProfile>;
        setForm((current) => ({
          ...current,
          name: typeof parsed.name === "string" ? parsed.name : "",
          phone: typeof parsed.phone === "string" ? parsed.phone : "",
          orderCode: typeof parsed.orderCode === "string" ? parsed.orderCode : ""
        }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!sessionId || hidden) {
      return;
    }

    void loadConversation(sessionId, true);
  }, [sessionId, hidden]);

  useEffect(() => {
    if (!sessionId || hidden) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadConversation(sessionId, true);
    }, open ? CHAT_POLL_MS_OPEN : CHAT_POLL_MS_IDLE);

    return () => window.clearInterval(interval);
  }, [sessionId, hidden, open]);

  useEffect(() => {
    if (!sessionId || hidden || !open) {
      return;
    }

    void loadConversation(sessionId, true);
  }, [sessionId, hidden, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [conversation, open]);

  function updateField<K extends keyof ChatProfile>(field: K, value: ChatProfile[K]) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function removeDraftAttachment(attachmentId: string) {
    setAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }

  function ensureSession() {
    if (sessionId) {
      return sessionId;
    }

    const next = createSessionId();
    setSessionId(next);

    try {
      localStorage.setItem(SESSION_KEY, next);
    } catch {}

    return next;
  }

  async function handleAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const pickedFiles = Array.from(event.target.files || []);
    event.target.value = "";

    if (!pickedFiles.length) {
      return;
    }

    if (attachments.length + pickedFiles.length > CHAT_MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(`Envie no maximo ${CHAT_MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem.`);
      return;
    }

    setPreparingAttachments(true);
    setError("");

    try {
      const prepared: DraftChatAttachment[] = [];

      for (const file of pickedFiles) {
        prepared.push(file.type.startsWith("image/") ? await prepareImageAttachment(file) : await prepareFileAttachment(file));
      }

      setAttachments((current) => [...current, ...prepared]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui preparar o anexo enviado.");
    } finally {
      setPreparingAttachments(false);
    }
  }

  async function loadConversation(nextSessionId: string, silent = false) {
    if (!nextSessionId) {
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await fetch(`/api/chat?sessionId=${encodeURIComponent(nextSessionId)}`, {
        cache: "no-store"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || (isEasy ? "Não consegui abrir a conversa agora." : "Não foi possível carregar a conversa."));
      }

      if (data.conversation) {
        const nextConversation = data.conversation as ChatConversation;
        setConversation(nextConversation);
        setForm((current) => ({
          ...current,
          name: nextConversation.customerName || current.name,
          phone: nextConversation.customerPhone || current.phone,
          orderCode: nextConversation.orderCode || current.orderCode
        }));
      } else {
        setConversation(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : isEasy ? "Não consegui abrir a conversa agora." : "Erro ao carregar a conversa.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function sendMessage() {
    setError("");

    if (!form.name.trim()) {
      setError(isEasy ? "Escreva seu nome para eu saber com quem estou falando." : "Informe seu nome para iniciar o atendimento.");
      return;
    }

    if (!form.message.trim() && !attachments.length) {
      setError(isEasy ? "Escreva sua dúvida ou envie um anexo antes de continuar." : "Digite sua dúvida ou envie um anexo antes de continuar.");
      return;
    }

    setSending(true);

    try {
      const nextSessionId = ensureSession();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: nextSessionId,
          customerName: form.name,
          customerPhone: form.phone,
          orderCode: form.orderCode,
          message: form.message,
          attachments: attachments.map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            content: attachment.content
          }))
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || (isEasy ? "Não consegui enviar sua mensagem agora." : "Não foi possível enviar sua mensagem."));
      }

      setConversation(data.conversation as ChatConversation);
      setForm((current) => ({
        ...current,
        message: ""
      }));
      setAttachments([]);

      try {
        localStorage.setItem(
          PROFILE_KEY,
          JSON.stringify({
            name: form.name,
            phone: form.phone,
            orderCode: form.orderCode
          })
        );
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : isEasy ? "Não consegui enviar sua mensagem agora." : "Erro ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  }

  if (!mounted || hidden) {
    return null;
  }

  return (
    <div className={`live-chat-widget ${open ? "open" : ""}`}>
      {open && (
        <div className="live-chat-panel">
          <div className="live-chat-header">
            <div>
              <span className="detail-label">{isEasy ? "Ajuda rápida" : "Atendimento ao vivo"}</span>
              <strong>{isEasy ? "Escreva sua dúvida aqui" : "Tire sua dúvida pelo site"}</strong>
            </div>
            <button className="live-chat-close" type="button" onClick={() => setOpen(false)} aria-label="Fechar chat">
              x
            </button>
          </div>

          <div className="live-chat-content">
            <p className="mini live-chat-intro">
              {isEasy
                ? "Escreva aqui sua mensagem e, se quiser, envie imagem ou arquivo."
                : "A conversa fica salva no painel para resposta. Você também pode mandar imagem ou arquivo."}
            </p>

            {!conversation && (
              <div className="live-chat-form">
                <label>
                  <span>{isEasy ? "Como você se chama?" : "Seu nome"}</span>
                  <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder={isEasy ? "Seu nome" : "Digite seu nome"} />
                </label>

                <label>
                  <span>{isEasy ? "Seu WhatsApp" : "WhatsApp"}</span>
                  <input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="(83) 99999-9999" />
                </label>

                <label>
                  <span>{isEasy ? "Código do pedido, se tiver" : "ID da ordem, se já tiver"}</span>
                  <input value={form.orderCode} onChange={(event) => updateField("orderCode", event.target.value.toUpperCase())} placeholder="Ex.: OS-20260507-ABC123" />
                </label>
              </div>
            )}

            {conversation && (
              <>
                <div className="live-chat-meta">
                  <span>{conversation.customerName}</span>
                  {conversation.orderCode && <span>{conversation.orderCode}</span>}
                  {conversation.status === "closed" && <span>{getClosedChatLabel(conversation.closedReason, isEasy)}</span>}
                </div>
                {conversation.status === "closed" && <p className="mini">{getClosedChatHint(conversation.closedReason, isEasy)}</p>}

                <div className="live-chat-messages" ref={messagesRef}>
                  {conversation.messages.map((message) => (
                    <div className={`chat-bubble ${message.sender}`} key={message.id}>
                      <div className="chat-bubble-meta">
                        <strong>{message.author}</strong>
                        <span>{new Date(message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {message.text && <p className="chat-bubble-text">{message.text}</p>}
                      {!!message.attachments.length && (
                        <div className="chat-attachment-list">
                          {message.attachments.map((attachment) => (
                            <ChatAttachmentPreview attachment={attachment} key={attachment.id} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {loading && <p className="mini">{isEasy ? "Buscando novas mensagens..." : "Atualizando conversa..."}</p>}
                </div>
              </>
            )}

            <label>
              <span>{isEasy ? "O que você quer perguntar?" : "Sua mensagem"}</span>
              <textarea
                className="live-chat-textarea"
                value={form.message}
                onChange={(event) => updateField("message", event.target.value)}
                placeholder={isEasy ? "Escreva aqui sua dúvida do seu jeito..." : "Digite sua dúvida aqui..."}
              />
            </label>

            <div className="live-chat-upload-panel">
              <label className="btn btn-ghost btn-small live-chat-upload-btn">
                {preparingAttachments ? "Preparando..." : isEasy ? "Adicionar anexo" : "Enviar anexo"}
                <input
                  type="file"
                  multiple
                  onChange={handleAttachmentPick}
                  accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z"
                  disabled={preparingAttachments || sending}
                />
              </label>

              <p className="mini live-chat-upload-note">
                {`Até ${CHAT_MAX_ATTACHMENTS_PER_MESSAGE} anexos de ${formatFileSize(CHAT_MAX_ATTACHMENT_BYTES)} por mensagem. Os anexos apagam sozinhos depois de ${CHAT_ATTACHMENT_RETENTION_DAYS} dias.`}
              </p>

              {!!attachments.length && (
                <div className="chat-draft-attachment-list">
                  {attachments.map((attachment) => (
                    <div className="chat-draft-attachment" key={attachment.id}>
                      {attachment.kind === "image" ? <img className="chat-draft-attachment-preview" src={attachment.content} alt={attachment.name} /> : <div className="chat-draft-file-badge">ARQ</div>}
                      <div className="chat-draft-attachment-copy">
                        <strong>{attachment.name}</strong>
                        <span>{formatFileSize(attachment.size)}</span>
                      </div>
                      <button className="inline-copy-btn" type="button" onClick={() => removeDraftAttachment(attachment.id)}>
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="actions live-chat-actions">
              <button className="btn btn-primary" type="button" onClick={sendMessage} disabled={sending || preparingAttachments}>
                {sending
                  ? "Enviando..."
                  : conversation?.status === "closed"
                    ? isEasy
                      ? "Mandar nova mensagem"
                      : "Iniciar novo atendimento"
                    : conversation
                      ? isEasy
                        ? "Enviar"
                        : "Enviar mensagem"
                      : isEasy
                        ? "Mandar pergunta"
                        : "Iniciar atendimento"}
              </button>
            </div>

            {error && <p className="notice-error">{error}</p>}
          </div>
        </div>
      )}

      {!open && (
        <button className="live-chat-trigger" type="button" onClick={() => setOpen(true)}>
          <span className="live-chat-trigger-dot" aria-hidden="true" />
          {isEasy ? "Tirar dúvida" : "Falar agora"}
        </button>
      )}
    </div>
  );
}
