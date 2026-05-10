"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import BrandLogo from "@/components/shared/BrandLogo";
import useAccessibilityMode from "@/components/shared/useAccessibilityMode";
import { formatBRL } from "@/lib/catalog";
import { formatDateBR, formatDateTimeBR } from "@/lib/date";
import { buildServicePriceLabel } from "@/lib/orderShared";

type PublicOrder = {
  orderCode: string;
  status: "open" | "completed" | "cancelled";
  isArchived: boolean;
  services: { name: string; price: number; priceLabel: string }[];
  total: number;
  pricing: {
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
  paymentStatus: "pending" | "partial" | "paid";
  paymentLabel: string;
  paymentMethodLabel: string;
  amountPaid: number;
  deliveryStatus: "pending" | "delivered";
  deliveryLabel: string;
  schedule: { date: string; slot: string };
  customerName: string;
  customerPhone: string;
  completionNotes: string;
  diagnosis: string;
  solution: string;
  checklist: string;
  warranty: string;
  completedAt: string | null;
};

function statusLabel(status: PublicOrder["status"]) {
  if (status === "completed") return "Concluída";
  if (status === "cancelled") return "Cancelada";
  return "Aberta";
}

export default function ConsultaPage() {
  const accessibilityMode = useAccessibilityMode();
  const isEasy = accessibilityMode === "easy";
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialCode = params.get("code");

    if (initialCode) {
      setCode(initialCode.toUpperCase());
      void searchOrder(initialCode.toUpperCase(), "");
    }
  }, []);

  async function searchOrder(nextCode = code, nextPhone = phone) {
    setLoading(true);
    setError("");
    setOrder(null);

    try {
      const search = new URLSearchParams({
        code: nextCode.trim().toUpperCase()
      });

      if (nextPhone.trim()) {
        search.set("phone", nextPhone.trim());
      }

      const response = await fetch(`/api/orders/status?${search.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || (isEasy ? "Não achei esse pedido." : "Ordem não encontrada."));
      }

      setOrder(data.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : isEasy ? "Não consegui procurar seu pedido agora." : "Erro ao consultar ordem.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <nav className="nav store-nav">
        <Link href="/" className="brand brand-home" aria-label="Sistalvo">
          <BrandLogo />
        </Link>
        <div className="nav-links">
          <Link href="/" className="nav-link">
            Catálogo
          </Link>
          <Link href="/consulta" className="nav-link">
            Consultar ordem
          </Link>
        </div>
      </nav>

      <section className="consulta-hero consulta-hero-soft">
        <div className="section-head">
          <div className="badge">Consulta</div>
          <h1>{isEasy ? "Digite o código do pedido." : "Acompanhe sua ordem com o código e, se quiser, confirme com o telefone."}</h1>
          <p>
            Status, pagamento, itens da ordem, cupom aplicado e PDF em um lugar só.
          </p>
        </div>

        <div className="card consulta-search-card consulta-search-robot">
          <div className="robot-stage robot-stage-compact">
            <div className="robot-bubble robot-bubble-inline">Digite o código da ordem que eu localizo tudo aqui.</div>
            <Image className="robot-float" src="/robo1.png" alt="Robô ajudando a consultar a ordem" width={180} height={180} />
          </div>
          <label>
            <span>Código da ordem</span>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ex.: OS-20260507-ABC123" />
          </label>
          <label>
            <span>Telefone usado no pedido</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Opcional, mas recomendado" />
          </label>
          <button className="btn btn-primary btn-full" onClick={() => searchOrder()} disabled={loading}>
            {loading ? "Consultando..." : "Ver ordem"}
          </button>
          {error && <p className="notice-error">{error}</p>}
        </div>
      </section>

      {order && (
        <section className="consulta-layout consulta-layout-wide">
          <div className="card order-view-card">
            <div className="order-card-top">
              <div>
                <div className="order-code">{order.orderCode}</div>
                <h2>{order.customerName}</h2>
              </div>
              <div className="order-public-badges">
                <span className={`status-pill status-${order.status}`}>{statusLabel(order.status)}</span>
                <span className="chip">{order.paymentLabel}</span>
                <span className="chip">{order.deliveryLabel}</span>
              </div>
            </div>

            <div className="detail-grid">
              <div>
                <span className="detail-label">Data</span>
                <strong>{formatDateBR(order.schedule.date)}</strong>
              </div>
              <div>
                <span className="detail-label">Horário</span>
                <strong>{order.schedule.slot}</strong>
              </div>
              <div>
                <span className="detail-label">Telefone</span>
                <strong>{order.customerPhone}</strong>
              </div>
              <div>
                <span className="detail-label">Total final</span>
                <strong>{formatBRL(order.total)}</strong>
              </div>
              <div>
                <span className="detail-label">Valor pago</span>
                <strong>{formatBRL(order.amountPaid)}</strong>
              </div>
              <div>
                <span className="detail-label">Forma de pagamento</span>
                <strong>{order.paymentMethodLabel}</strong>
              </div>
              <div className="field-full">
                <span className="detail-label">Serviços da ordem</span>
                <strong>{order.services.map((service) => service.name).join(", ")}</strong>
              </div>
            </div>

            {(order.pricing.extras > 0 || order.pricing.discount > 0 || order.pricing.extrasDescription || order.pricing.couponCode) && (
              <div className="note-box">
                <span className="detail-label">Ajustes de orçamento</span>
                <p>
                  Base: {formatBRL(order.pricing.baseTotal)} | Extras: {formatBRL(order.pricing.extras)} | Cupom: {formatBRL(order.pricing.couponDiscount)} | Desconto manual: {formatBRL(order.pricing.manualDiscount)}
                </p>
                {order.pricing.couponCode && <p>Cupom aplicado: {order.pricing.couponCode}</p>}
                {order.pricing.extrasDescription && <p>{order.pricing.extrasDescription}</p>}
              </div>
            )}

            <div className="note-box">
                <span className="detail-label">Itens e preços</span>
              <p className="stacked-copy-text">{order.services.map((service) => `${service.name} - ${buildServicePriceLabel(service)}`).join("\n")}</p>
            </div>

            {order.completionNotes && (
              <div className="note-box note-box-strong">
                <span className="detail-label">Observações finais do atendimento</span>
                <p>{order.completionNotes}</p>
              </div>
            )}

            {(order.diagnosis || order.solution || order.checklist || order.warranty) && (
              <div className="system-sheet">
                <span className="detail-label">Resumo técnico</span>
                <div className="system-list">
                  {order.diagnosis && (
                    <div className="system-item">
                      <span>Diagnóstico</span>
                      <strong>{order.diagnosis}</strong>
                    </div>
                  )}
                  {order.solution && (
                    <div className="system-item">
                      <span>Solução aplicada</span>
                      <strong>{order.solution}</strong>
                    </div>
                  )}
                  {order.checklist && (
                    <div className="system-item">
                      <span>Checklist final</span>
                      <strong>{order.checklist}</strong>
                    </div>
                  )}
                  {order.warranty && (
                    <div className="system-item">
                      <span>Garantia / observação</span>
                      <strong>{order.warranty}</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() =>
                  window.open(
                    `/api/orders/${order.orderCode}/pdf?version=${order.status === "completed" ? "completion" : "initial"}`,
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                {order.status === "completed" ? "Baixar PDF final" : "Baixar PDF da ordem"}
              </button>
              {order.status === "completed" && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => window.open(`/api/orders/${order.orderCode}/pdf?version=initial`, "_blank", "noopener,noreferrer")}
                >
                  Ver PDF inicial
                </button>
              )}
            </div>
          </div>

          <aside className="card consulta-help-panel">
            <div className="robot-stage robot-stage-compact">
              <div className="robot-bubble robot-bubble-inline">O PDF, o histórico e o pagamento ficam organizados aqui.</div>
              <Image className="robot-float" src="/robo3.png" alt="Robô explicando a consulta da ordem" width={130} height={130} />
            </div>
            <div className="help">
              <p className="gentle-help">
                {order.status === "completed"
                  ? "Sua ordem já foi concluída. Se quiser guardar o histórico técnico, baixe o PDF final."
                  : order.paymentMethodLabel === "Pix"
                    ? "Sua ordem ainda está em andamento. O PDF inicial mostra os dados do Pix e o resumo da solicitação."
                    : `Sua ordem ainda está em andamento. O PDF inicial mostra a forma de pagamento escolhida em ${order.paymentMethodLabel.toLowerCase()}.`}
              </p>
              <p className="gentle-help">
                Pagamento: <strong>{order.paymentLabel}</strong>.
              </p>
              <p className="gentle-help">
                Entrega: <strong>{order.deliveryLabel}</strong>.
              </p>
              {order.completedAt && (
                <p className="gentle-help">
                  Concluída em: <strong>{formatDateTimeBR(order.completedAt)}</strong>.
                </p>
              )}
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
