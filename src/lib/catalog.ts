export type CatalogSectionId = "servicos" | "avaliacao" | "combos";
export type CatalogItemKind = "service" | "combo";
export type CatalogPriceMode = "fixed" | "starting" | "range" | "custom";

type CatalogSeed = {
  id: string;
  name: string;
  description: string;
  price: number;
  priceLabel?: string;
  priceMode?: CatalogPriceMode;
  kind: CatalogItemKind;
  section: CatalogSectionId;
  featured?: boolean;
  note?: string;
  includes?: string[];
  standaloneOnly?: boolean;
};

export const CATALOG_SECTIONS = [
  {
    id: "servicos",
    label: "Serviços",
    description: "Escolha somente o que você realmente quer resolver agora."
  },
  {
    id: "avaliacao",
    label: "Avaliação",
    description: "Para quem quer primeiro uma visita técnica antes de decidir o conserto."
  },
  {
    id: "combos",
    label: "Combos",
    description: "Pacotes mais em conta para fechar tudo de uma vez."
  }
] as const;

// Adicione novos servicos ou combos aqui.
// A vitrine, o resumo, a ordem, a consulta e o admin usam esta mesma lista.
const CATALOG_ITEMS = [
  {
    id: "formatacao",
    name: "Formatação",
    description: "Instalação limpa do sistema para devolver o computador pronto para uso.",
    price: 50,
    kind: "service",
    section: "servicos",
    featured: true
  },
  {
    id: "otimizacao",
    name: "Otimização",
    description: "Ajustes de desempenho para reduzir lentidão, travamentos e tarefas em segundo plano.",
    price: 25,
    kind: "service",
    section: "servicos",
    featured: true
  },
  {
    id: "backup",
    name: "Backup",
    description: "Separação e cópia dos arquivos importantes antes da manutenção.",
    price: 15,
    kind: "service",
    section: "servicos",
    featured: true
  },
  {
    id: "limpeza",
    name: "Limpeza",
    description: "Limpeza geral do sistema com remoção de excesso, resíduos e ajustes leves.",
    price: 30,
    kind: "service",
    section: "servicos",
    featured: true
  },
  {
    id: "visita_tecnica",
    name: "Visita técnica",
    description: "Avaliação presencial para entender o problema e indicar o melhor caminho.",
    price: 25,
    kind: "service",
    section: "avaliacao",
    featured: true,
    standaloneOnly: true,
    note: "Se o conserto for aprovado depois da avaliação, a visita não é cobrada separadamente."
  },
  {
    id: "combo_limpeza_otimizacao",
    name: "Limpeza + Otimização",
    description: "Boa escolha para deixar o PC mais leve e organizado pagando menos no conjunto.",
    price: 45,
    kind: "combo",
    section: "combos",
    featured: true,
    includes: ["limpeza", "otimizacao"]
  },
  {
    id: "combo_formatacao_backup",
    name: "Formatação + Backup",
    description: "Pacote direto para reinstalar o sistema sem perder seus arquivos principais.",
    price: 60,
    kind: "combo",
    section: "combos",
    includes: ["formatacao", "backup"]
  },
  {
    id: "combo_formatacao_otimizacao_backup",
    name: "Formatação + Otimização + Backup",
    description: "Combo mais completo para reinstalar, salvar os arquivos e entregar o PC mais fluido.",
    price: 80,
    kind: "combo",
    section: "combos",
    featured: true,
    includes: ["formatacao", "otimizacao", "backup"]
  }
] as const satisfies readonly CatalogSeed[];

export type ServiceId = (typeof CATALOG_ITEMS)[number]["id"];

export type ServiceItem = {
  id: ServiceId;
  name: string;
  description: string;
  price: number;
  priceLabel: string;
  priceMode: CatalogPriceMode;
  kind: CatalogItemKind;
  section: CatalogSectionId;
  featured: boolean;
  note: string;
  includes: string[];
  standaloneOnly: boolean;
};

export const DEFAULT_SCHEDULE_SLOTS = ["08:00", "09:30", "11:00", "13:30", "15:00", "16:30"] as const;
export const SCHEDULE_SLOTS = [...DEFAULT_SCHEDULE_SLOTS];
export const DAILY_LIMIT = 6;

export function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

export function buildCatalogPriceLabel(item: Pick<ServiceItem, "price" | "priceLabel" | "priceMode">) {
  if (item.priceLabel) {
    return item.priceLabel;
  }

  if (item.priceMode === "custom") {
    return "A combinar";
  }

  if (item.priceMode === "starting") {
    return `A partir de ${formatBRL(item.price)}`;
  }

  return formatBRL(item.price);
}

const CATALOG_ITEMS_LIST: CatalogSeed[] = [...CATALOG_ITEMS];

export const SERVICES = Object.fromEntries(
  CATALOG_ITEMS_LIST.map((item) => [
    item.id,
    {
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      priceLabel: item.priceLabel || buildCatalogPriceLabel({ price: item.price, priceLabel: "", priceMode: item.priceMode || "fixed" }),
      priceMode: item.priceMode || "fixed",
      kind: item.kind,
      section: item.section,
      featured: item.featured === true,
      note: item.note || "",
      includes: item.includes ? [...item.includes] : [],
      standaloneOnly: item.standaloneOnly === true
    }
  ])
) as Record<ServiceId, ServiceItem>;

export const SERVICE_IDS = CATALOG_ITEMS_LIST.map((item) => item.id as ServiceId);
export const SERVICE_ITEMS = SERVICE_IDS.map((id) => SERVICES[id]);

export function isValidDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isValidScheduleSlot(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

export function normalizeServiceIds(value: unknown): ServiceId[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is ServiceId => typeof item === "string" && item in SERVICES);
}

export function selectedServices(ids: ServiceId[]) {
  return ids.map((id) => SERVICES[id]);
}

export function servicesTotal(ids: ServiceId[]) {
  return ids.reduce((sum, id) => sum + SERVICES[id].price, 0);
}

export function groupServicesBySection() {
  return CATALOG_SECTIONS.map((section) => ({
    ...section,
    items: SERVICE_ITEMS.filter((item) => item.section === section.id)
  })).filter((section) => section.items.length);
}

export function getFeaturedServices() {
  return SERVICE_ITEMS.filter((item) => item.featured);
}

export function hasEstimatedPricing(ids: ServiceId[]) {
  return ids.some((id) => SERVICES[id].priceMode !== "fixed");
}

export function findCatalogOverlap(ids: ServiceId[]) {
  const selected = new Set(ids);

  return ids
    .map((id) => SERVICES[id])
    .filter((item) => item.kind === "combo" && item.includes.some((serviceId) => selected.has(serviceId as ServiceId)));
}

export function toggleCatalogSelection(current: ServiceId[], nextId: ServiceId) {
  const nextItem = SERVICES[nextId];

  if (current.includes(nextId)) {
    return current.filter((item) => item !== nextId);
  }

  if (nextItem.standaloneOnly) {
    return [nextId];
  }

  const nextSelected = new Set(
    current.filter((item) => {
      const itemData = SERVICES[item];

      if (itemData.standaloneOnly) {
        return false;
      }

      if (itemData.kind === "combo" && itemData.includes.includes(nextId)) {
        return false;
      }

      if (nextItem.kind === "combo") {
        if (itemData.kind === "combo" && itemData.includes.some((serviceId) => nextItem.includes.includes(serviceId))) {
          return false;
        }

        if (nextItem.includes.includes(item)) {
          return false;
        }
      }

      return true;
    })
  );

  nextSelected.add(nextId);
  return [...nextSelected];
}
