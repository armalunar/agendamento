"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import BrandLogo from "@/components/shared/BrandLogo";
import { BUSINESS_CITY, SUPPORT_WHATSAPP_NUMBER } from "@/lib/business";
import {
  DEFAULT_SCHEDULE_SLOTS,
  SERVICES,
  SCHEDULE_SLOTS,
  buildCatalogPriceLabel,
  formatBRL,
  groupServicesBySection,
  hasEstimatedPricing,
  toggleCatalogSelection,
  type ServiceId
} from "@/lib/catalog";
import { DEFAULT_DISCOUNT_COUPONS, normalizeCouponCode, resolveCouponFromList, type DiscountCoupon } from "@/lib/coupons";
import {
  EQUIPMENT_OPTIONS,
  HARDWARE_KNOWLEDGE_OPTIONS,
  OPERATING_SYSTEM_OPTIONS,
  RAM_OPTIONS,
  STORAGE_CAPACITY_OPTIONS,
  STORAGE_TYPE_OPTIONS,
  YES_NO_UNKNOWN_OPTIONS,
  describeSystemProfile,
  getEquipmentLabel,
  getOperatingSystemVersionOptions,
  type EquipmentType,
  type HardwareKnowledge,
  type OperatingSystemFamily,
  type RamOption,
  type StorageCapacityOption,
  type StorageTypeOption,
  type YesNoUnknown
} from "@/lib/deviceProfile";
import { formatDateBR, getBusinessTodayISO } from "@/lib/date";
import { buildPaymentMethodLabel, buildServicePriceLabel, type OrderRecord, type PaymentMethod } from "@/lib/orderShared";

type AvailabilityDay = {
  date: string;
  bookedCount: number;
  limit: number;
  isBlocked: boolean;
  blockedReason: string;
  customSlots: string[];
  slots: Array<{
    slot: string;
    available: boolean;
  }>;
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "pix", label: "Pix" },
  { value: "card", label: "Cartão" },
  { value: "cash", label: "Dinheiro" }
];

function buildWhatsAppMessage(order: OrderRecord) {
  const serviceText = order.services.map((service) => `- ${service.name}: ${buildServicePriceLabel(service)}`).join("\n");
  const couponText = order.pricing.couponCode
    ? `*Cupom aplicado:* ${order.pricing.couponCode} (-${formatBRL(order.pricing.couponDiscount)})`
    : "*Cupom aplicado:* Nenhum";

  return [
    "*Novo pedido de atendimento técnico*",
    "",
    `*ID da ordem:* ${order.orderCode}`,
    `*Cliente:* ${order.customer.name}`,
    `*WhatsApp:* ${order.customer.phone}`,
    `*Cidade/Bairro:* ${order.customer.city}`,
    "",
    "*Agendamento solicitado:*",
    `- Data: ${formatDateBR(order.schedule.date)}`,
    `- Horário: ${order.schedule.slot}`,
    "",
    "*Serviços escolhidos:*",
    serviceText,
    "",
    couponText,
    `*Total estimado:* ${formatBRL(order.total)}`,
    `*Forma de pagamento escolhida:* ${buildPaymentMethodLabel(order.payment.method)}`,
    "",
    "*Equipamento e problema:*",
    `- Equipamento: ${getEquipmentLabel(order.customer.equipment)}`,
    `- Relato: ${order.customer.issue}`,
    "",
    "*Sistema e hardware informado:*",
    describeSystemProfile(order.customer.systemProfile),
    "",
    "Pode confirmar esse agendamento? O cliente foi orientado a guardar o PDF da ordem."
  ].join("\n");
}

export default function HomePage() {
  const groupedSections = useMemo(() => groupServicesBySection(), []);
  const [selected, setSelected] = useState<ServiceId[]>(["formatacao"]);
  const [availabilityDay, setAvailabilityDay] = useState<AvailabilityDay | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [couponMessage, setCouponMessage] = useState("");
  const [createdOrder, setCreatedOrder] = useState<OrderRecord | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState("");
  const [availableCoupons, setAvailableCoupons] = useState<DiscountCoupon[]>(DEFAULT_DISCOUNT_COUPONS);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    city: "",
    date: getBusinessTodayISO(),
    slot: "",
    paymentMethod: "pix" as PaymentMethod,
    equipment: "desktop" as EquipmentType,
    issue: "",
    operatingSystemFamily: "windows" as OperatingSystemFamily,
    operatingSystemVersion: getOperatingSystemVersionOptions("windows")[0],
    hardwareKnowledge: "unknown" as HardwareKnowledge,
    processor: "",
    ram: RAM_OPTIONS[RAM_OPTIONS.length - 1],
    storageType: STORAGE_TYPE_OPTIONS[STORAGE_TYPE_OPTIONS.length - 1],
    storageCapacity: STORAGE_CAPACITY_OPTIONS[STORAGE_CAPACITY_OPTIONS.length - 1],
    hasSsd: "unknown" as YesNoUnknown,
    gpu: ""
  });

  const selectedItems = selected.map((id) => SERVICES[id]);
  const subtotal = selectedItems.reduce((sum, service) => sum + service.price, 0);
  const couponPreview = useMemo(
    () => resolveCouponFromList(subtotal, appliedCouponCode, availableCoupons),
    [subtotal, appliedCouponCode, availableCoupons]
  );
  const couponDiscount = couponPreview.ok ? couponPreview.discount : 0;
  const total = Math.max(0, subtotal - couponDiscount);
  const hasVariablePricing = hasEstimatedPricing(selected);
  const operatingSystemVersions = getOperatingSystemVersionOptions(form.operatingSystemFamily);
  const knowsHardware = form.hardwareKnowledge === "known";
  const availableSlots = availabilityDay?.slots || [];
  const selectedDateIsBlocked = availabilityDay?.isBlocked === true;
  const slotReference = availabilityDay?.customSlots.length ? availabilityDay.customSlots : SCHEDULE_SLOTS;
  const couponFeedbackTone = appliedCouponCode ? "notice-success" : couponMessage === "Cupom removido." ? "mini" : "notice-error";

  useEffect(() => {
    let active = true;

    async function loadCoupons() {
      try {
        const response = await fetch("/api/coupons", { cache: "no-store" });
        const data = await response.json();

        if (!response.ok || !Array.isArray(data.coupons) || !data.coupons.length) {
          return;
        }

        if (active) {
          setAvailableCoupons(data.coupons as DiscountCoupon[]);
        }
      } catch {}
    }

    void loadCoupons();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!operatingSystemVersions.includes(form.operatingSystemVersion)) {
      setForm((current) => ({
        ...current,
        operatingSystemVersion: operatingSystemVersions[0]
      }));
    }
  }, [form.operatingSystemVersion, operatingSystemVersions]);

  useEffect(() => {
    async function loadAvailability() {
      if (!form.date) return;

      setLoadingSlots(true);
      setError("");

      try {
        const response = await fetch(`/api/availability?date=${form.date}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Não foi possível consultar os horários.");
        }

        const nextDay = data as AvailabilityDay;
        setAvailabilityDay(nextDay);

        setForm((current) => {
          const currentSlot = nextDay.slots.find((item) => item.slot === current.slot && item.available);
          const firstAvailable = nextDay.slots.find((item) => item.available)?.slot || "";

          return {
            ...current,
            slot: currentSlot?.slot || firstAvailable
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar horários.");
      } finally {
        setLoadingSlots(false);
      }
    }

    void loadAvailability();
  }, [form.date]);

  useEffect(() => {
    if (!appliedCouponCode) {
      return;
    }

    const nextPreview = resolveCouponFromList(subtotal, appliedCouponCode, availableCoupons);

    if (!nextPreview.ok) {
      setAppliedCouponCode("");
      setCouponMessage(nextPreview.message);
    }
  }, [appliedCouponCode, availableCoupons, subtotal]);

  function toggleService(id: ServiceId) {
    setSelected((current) => toggleCatalogSelection(current, id));
  }

  function updateField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function applyCoupon() {
    const normalized = normalizeCouponCode(couponInput);

    if (!normalized) {
      setAppliedCouponCode("");
      setCouponInput("");
      setCouponMessage("Cupom removido.");
      return;
    }

    const preview = resolveCouponFromList(subtotal, normalized, availableCoupons);

    if (!preview.ok) {
      setAppliedCouponCode("");
      setCouponMessage(preview.message);
      return;
    }

    setAppliedCouponCode(preview.code);
    setCouponInput(preview.code);
    setCouponMessage(`${preview.label} aplicado com sucesso.`);
  }

  async function submitOrder() {
    setError("");
    setSuccess("");
    setCreatedOrder(null);

    if (!selected.length) {
      setError("Escolha pelo menos um serviço.");
      return;
    }

    if (!form.name.trim() || !form.phone.trim() || !form.city.trim()) {
      setError("Preencha nome, WhatsApp e cidade ou bairro para continuar.");
      return;
    }

    if (!form.date || !form.slot) {
      setError("Escolha um dia e um horário disponível.");
      return;
    }

    if (selectedDateIsBlocked) {
      setError("Esse dia está bloqueado para atendimento. Escolha outra data.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          city: form.city,
          date: form.date,
          slot: form.slot,
          couponCode: appliedCouponCode,
          paymentMethod: form.paymentMethod,
          equipment: form.equipment,
          issue: form.issue,
          services: selected,
          systemProfile: {
            operatingSystemFamily: form.operatingSystemFamily,
            operatingSystemVersion: form.operatingSystemVersion,
            hardwareKnowledge: form.hardwareKnowledge,
            processor: form.processor,
            ram: form.ram,
            storageType: form.storageType,
            storageCapacity: form.storageCapacity,
            hasSsd: form.hasSsd,
            gpu: form.gpu
          }
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível criar a ordem.");
      }

      const order = data.order as OrderRecord;
      const message = encodeURIComponent(buildWhatsAppMessage(order));

      setCreatedOrder(order);
      setSuccess(`Ordem ${order.orderCode} criada com sucesso.`);
      window.open(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${message}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a ordem.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container store-shell store-shell-minimal">
      <nav className="nav store-nav store-nav-minimal">
        <Link href="/" className="brand brand-home" aria-label="Sistalvo">
          <BrandLogo priority />
        </Link>

        <div className="nav-links">
          <a href="#servicos" className="nav-link">
            Serviços
          </a>
          <a href="#agendar" className="nav-link">
            Agendar
          </a>
          <Link href="/consulta" className="nav-link">
            Consultar ordem
          </Link>
        </div>
      </nav>

      <section className="store-hero store-hero-minimal">
        <div className="store-hero-copy store-hero-copy-minimal">
          <div className="badge">Atendimento em {BUSINESS_CITY}</div>
          <h1>Escolha os serviços e agende seu atendimento.</h1>
          <p className="lead">
            Fluxo direto: selecione o que precisa, escolha um horário disponível e finalize sua ordem com cupom, pagamento e WhatsApp.
          </p>

          <div className="actions">
            <a href="#servicos" className="btn btn-primary">
              Ver serviços
            </a>
            <a href="#agendar" className="btn btn-ghost">
              Ir para agendamento
            </a>
          </div>
        </div>

        <aside className="store-hero-panel store-hero-panel-minimal">
          <div className="robot-stage robot-stage-compact store-robot-stage-minimal">
            <div className="robot-bubble robot-bubble-inline">Escolha os serviços e eu organizo o resumo para você.</div>
            <Image className="robot-float" src="/robo2.png" alt="Robô mascote da loja" width={220} height={220} priority />
          </div>

          <div className="store-simple-info">
            <div className="store-simple-info-item">
              <strong>1</strong>
              <span>Marque os serviços</span>
            </div>
            <div className="store-simple-info-item">
              <strong>2</strong>
              <span>Escolha a data</span>
            </div>
            <div className="store-simple-info-item">
              <strong>3</strong>
              <span>Confirme no WhatsApp</span>
            </div>
          </div>

          <div className="store-hours-compact">
            <span className="detail-label">Horários base</span>
            <p className="mini">{DEFAULT_SCHEDULE_SLOTS.join(" / ")}</p>
          </div>
        </aside>
      </section>

      <section className="section-space store-main-layout">
        <div className="store-main-content">
          <section id="servicos" className="section-space store-main-section">
            <div className="section-head store-section-head-compact">
              <div className="badge">Serviços</div>
              <h2>Escolha o que você quer fazer</h2>
              <p>Marque um ou mais serviços. A visita técnica é só para avaliação e fica separada dos consertos.</p>
            </div>

            <div className="store-section-stack">
              {groupedSections.map((section) => (
                <section className="catalog-section catalog-section-minimal" key={section.id}>
                  <div className="catalog-section-head catalog-section-head-minimal">
                    <span className="detail-label">{section.label}</span>
                    <p className="mini">{section.description}</p>
                  </div>

                  <div className="catalog-grid catalog-grid-minimal">
                    {section.items.map((service) => {
                      const active = selected.includes(service.id);

                      return (
                        <label className={`catalog-card catalog-card-minimal ${active ? "active" : ""}`} key={service.id}>
                          <input type="checkbox" checked={active} onChange={() => toggleService(service.id)} />
                          <div className="catalog-card-top">
                            <h3>{service.name}</h3>
                            <span className="catalog-card-price">{buildCatalogPriceLabel(service)}</span>
                          </div>
                          <p>{service.description}</p>
                          <div className="catalog-card-meta">
                            <span className="mini-badge">{service.kind === "combo" ? "Combo" : "Serviço"}</span>
                            <span className={`catalog-card-selection ${active ? "active" : ""}`}>{active ? "Selecionado" : "Selecionar"}</span>
                          </div>
                          {service.note && <p className="catalog-card-note-text">{service.note}</p>}
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <section id="agendar" className="section-space store-main-section">
            <div className="section-head store-section-head-compact">
              <div className="badge">Agendamento</div>
              <h2>Preencha os dados da ordem</h2>
              <p>Somente o essencial aparece primeiro. As informações técnicas ficam opcionais logo abaixo.</p>
            </div>

            <div className="card store-form-card">
              <div className="form-grid">
                <label>
                  <span>Nome</span>
                  <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Digite seu nome" />
                </label>

                <label>
                  <span>WhatsApp</span>
                  <input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="(83) 99999-9999" />
                </label>

                <label>
                  <span>Cidade ou bairro</span>
                  <input value={form.city} onChange={(event) => updateField("city", event.target.value)} placeholder="Ex.: Patos - PB, Centro" />
                </label>

                <label>
                  <span>Equipamento</span>
                  <select value={form.equipment} onChange={(event) => updateField("equipment", event.target.value as EquipmentType)}>
                    {EQUIPMENT_OPTIONS.map((item) => (
                      <option value={item.value} key={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Data</span>
                  <input type="date" min={getBusinessTodayISO()} value={form.date} onChange={(event) => updateField("date", event.target.value)} />
                </label>

                <label>
                  <span>Pagamento</span>
                  <select value={form.paymentMethod} onChange={(event) => updateField("paymentMethod", event.target.value as PaymentMethod)}>
                    {PAYMENT_METHOD_OPTIONS.map((item) => (
                      <option value={item.value} key={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-full">
                  <span>O que está acontecendo com o computador?</span>
                  <textarea value={form.issue} onChange={(event) => updateField("issue", event.target.value)} placeholder="Ex.: está lento, travando, preciso formatar, fazer backup ou uma avaliação técnica..." />
                </label>

                <div className="field-full store-slots-shell">
                  <div className="store-inline-meta">
                    <span className="detail-label">Horários disponíveis</span>
                    <span className="mini">{slotReference.join(" / ")}</span>
                  </div>

                  {selectedDateIsBlocked && (
                    <p className="notice-error">
                      Esse dia está bloqueado para atendimento. {availabilityDay?.blockedReason ? `Motivo: ${availabilityDay.blockedReason}.` : ""}
                    </p>
                  )}

                  <div className="slot-grid">
                    {availableSlots.map((slot) => {
                      const disabled = loadingSlots || slot.available === false;

                      return (
                        <button
                          key={slot.slot}
                          type="button"
                          className={`slot ${form.slot === slot.slot ? "active" : ""}`}
                          disabled={disabled}
                          onClick={() => updateField("slot", slot.slot)}
                        >
                          {slot.slot}
                        </button>
                      );
                    })}
                  </div>

                  {!availableSlots.length && !loadingSlots && <p className="mini">Não há horários disponíveis para essa data.</p>}
                </div>
              </div>

              <details className="minimal-details">
                <summary>Informações técnicas opcionais</summary>

                <div className="minimal-details-body">
                  <div className="form-grid">
                    <label>
                      <span>Sistema operacional</span>
                      <select value={form.operatingSystemFamily} onChange={(event) => updateField("operatingSystemFamily", event.target.value as OperatingSystemFamily)}>
                        {OPERATING_SYSTEM_OPTIONS.map((item) => (
                          <option value={item.value} key={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Versão</span>
                      <select value={form.operatingSystemVersion} onChange={(event) => updateField("operatingSystemVersion", event.target.value)}>
                        {operatingSystemVersions.map((item) => (
                          <option value={item} key={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-full">
                      <span>Você sabe informar as configurações do PC?</span>
                      <select value={form.hardwareKnowledge} onChange={(event) => updateField("hardwareKnowledge", event.target.value as HardwareKnowledge)}>
                        {HARDWARE_KNOWLEDGE_OPTIONS.map((item) => (
                          <option value={item.value} key={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {knowsHardware ? (
                      <>
                        <label>
                          <span>Processador</span>
                          <input value={form.processor} onChange={(event) => updateField("processor", event.target.value)} placeholder="Ex.: Intel Core i5" />
                        </label>

                        <label>
                          <span>Memória RAM</span>
                          <select value={form.ram} onChange={(event) => updateField("ram", event.target.value as RamOption)}>
                            {RAM_OPTIONS.map((item) => (
                              <option value={item} key={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Armazenamento</span>
                          <select value={form.storageType} onChange={(event) => updateField("storageType", event.target.value as StorageTypeOption)}>
                            {STORAGE_TYPE_OPTIONS.map((item) => (
                              <option value={item} key={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Tamanho do armazenamento</span>
                          <select value={form.storageCapacity} onChange={(event) => updateField("storageCapacity", event.target.value as StorageCapacityOption)}>
                            {STORAGE_CAPACITY_OPTIONS.map((item) => (
                              <option value={item} key={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Tem SSD?</span>
                          <select value={form.hasSsd} onChange={(event) => updateField("hasSsd", event.target.value as YesNoUnknown)}>
                            {YES_NO_UNKNOWN_OPTIONS.map((item) => (
                              <option value={item.value} key={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Placa de vídeo</span>
                          <input value={form.gpu} onChange={(event) => updateField("gpu", event.target.value)} placeholder="Ex.: Integrada" />
                        </label>
                      </>
                    ) : (
                      <div className="field-full help gentle-help">
                        Sem problema. Essas informações podem ser confirmadas no atendimento.
                      </div>
                    )}
                  </div>
                </div>
              </details>
            </div>
          </section>
        </div>

        <aside className="card store-summary-panel store-summary-panel-minimal">
          <div className="summary-header">
            <div>
              <span className="detail-label">Resumo</span>
              <h3>Seu pedido</h3>
              <p className="mini">{selectedItems.length} serviço(s) selecionado(s)</p>
            </div>
            <span className="summary-total">{formatBRL(total)}</span>
          </div>

          <div className="store-summary-pricing">
            <div className="summary-line">
              <span>{hasVariablePricing ? "Subtotal base" : "Subtotal"}</span>
              <strong>{formatBRL(subtotal)}</strong>
            </div>

            {couponDiscount > 0 && (
              <div className="summary-line store-discount-line">
                <span>Cupom {appliedCouponCode}</span>
                <strong>-{formatBRL(couponDiscount)}</strong>
              </div>
            )}

            <div className="summary-line">
              <span>Total da ordem</span>
              <strong>{formatBRL(total)}</strong>
            </div>
          </div>

          <div className="store-coupon-box store-coupon-box-minimal">
            <span className="detail-label">Cupom</span>
            <div className="store-coupon-form">
              <input value={couponInput} onChange={(event) => setCouponInput(event.target.value.toUpperCase())} placeholder="Digite seu cupom" />
              <button className="btn btn-ghost btn-small" type="button" onClick={applyCoupon}>
                Aplicar
              </button>
            </div>
            {couponMessage && <p className={couponFeedbackTone}>{couponMessage}</p>}
            {couponPreview.ok && couponPreview.code && <p className="mini">{couponPreview.description}</p>}
          </div>

          <div className="store-summary-list">
            {selectedItems.length ? (
              selectedItems.map((service) => (
                <div className="summary-line" key={service.id}>
                  <span>{service.name}</span>
                  <strong>{buildCatalogPriceLabel(service)}</strong>
                </div>
              ))
            ) : (
              <div className="summary-line">
                <span>Nenhum serviço selecionado</span>
                <strong>{formatBRL(0)}</strong>
              </div>
            )}
          </div>

          {hasVariablePricing && (
            <p className="mini">Itens com valor inicial ou taxa a combinar aparecem aqui como base do pedido.</p>
          )}

          <div className="store-summary-helper">
            <Image className="robot-float" src="/robo3.png" alt="Robô ajudando no resumo" width={84} height={84} />
            <p className="mini">
              Pagamento escolhido: <strong>{buildPaymentMethodLabel(form.paymentMethod)}</strong>.
            </p>
          </div>

          <button className="btn btn-primary btn-full" disabled={submitting || !form.slot || !selected.length} onClick={submitOrder}>
            {submitting ? "Criando ordem..." : "Finalizar ordem"}
          </button>

          {error && <p className="notice-error">{error}</p>}
          {success && <p className="notice-success">{success}</p>}
        </aside>
      </section>

      {createdOrder && (
        <section className="section-space">
          <div className="card success-order store-success-order">
            <div>
              <span className="detail-label">Ordem criada</span>
              <h3>{createdOrder.orderCode}</h3>
              <p className="mini">Seu pedido foi salvo. Agora você pode consultar a ordem ou baixar o PDF inicial.</p>
            </div>

            <div className="actions">
              <Link href={`/consulta?code=${createdOrder.orderCode}`} className="btn btn-primary">
                Ver minha ordem
              </Link>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => window.open(`/api/orders/${createdOrder.orderCode}/pdf?version=initial`, "_blank", "noopener,noreferrer")}
              >
                Baixar PDF
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
