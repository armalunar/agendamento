type Option<T extends string> = {
  value: T;
  label: string;
};

export const UNKNOWN_INFO = "Não sei informar";

export const EQUIPMENT_OPTIONS = [
  { value: "desktop", label: "Computador de mesa" },
  { value: "notebook", label: "Notebook" },
  { value: "all-in-one", label: "All in one" },
  { value: "mini-pc", label: "Mini PC" },
  { value: "unknown", label: UNKNOWN_INFO }
] as const satisfies readonly Option<string>[];

export type EquipmentType = (typeof EQUIPMENT_OPTIONS)[number]["value"];

export const OPERATING_SYSTEM_OPTIONS = [
  { value: "windows", label: "Windows" },
  { value: "linux", label: "Linux" },
  { value: "macos", label: "macOS" },
  { value: "other", label: "Outro sistema" },
  { value: "unknown", label: UNKNOWN_INFO }
] as const satisfies readonly Option<string>[];

export type OperatingSystemFamily = (typeof OPERATING_SYSTEM_OPTIONS)[number]["value"];

export const HARDWARE_KNOWLEDGE_OPTIONS = [
  { value: "known", label: "Vou informar" },
  { value: "unknown", label: UNKNOWN_INFO }
] as const satisfies readonly Option<string>[];

export type HardwareKnowledge = (typeof HARDWARE_KNOWLEDGE_OPTIONS)[number]["value"];

export const RAM_OPTIONS = [
  "2 GB ou menos",
  "4 GB",
  "8 GB",
  "16 GB",
  "32 GB ou mais",
  UNKNOWN_INFO
] as const;

export type RamOption = (typeof RAM_OPTIONS)[number];

export const STORAGE_TYPE_OPTIONS = [
  "SSD SATA",
  "SSD NVMe",
  "HD tradicional",
  "SSD + HD",
  "eMMC",
  UNKNOWN_INFO
] as const;

export type StorageTypeOption = (typeof STORAGE_TYPE_OPTIONS)[number];

export const STORAGE_CAPACITY_OPTIONS = [
  "120/128 GB",
  "240/256 GB",
  "480/512 GB",
  "1 TB",
  "Mais de 1 TB",
  UNKNOWN_INFO
] as const;

export type StorageCapacityOption = (typeof STORAGE_CAPACITY_OPTIONS)[number];

export const YES_NO_UNKNOWN_OPTIONS = [
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
  { value: "unknown", label: UNKNOWN_INFO }
] as const satisfies readonly Option<string>[];

export type YesNoUnknown = (typeof YES_NO_UNKNOWN_OPTIONS)[number]["value"];

export const OPERATING_SYSTEM_VERSIONS: Record<OperatingSystemFamily, readonly string[]> = {
  windows: ["Windows 11", "Windows 10", "Windows 8 / 8.1", "Windows 7", "Windows Vista / XP", UNKNOWN_INFO],
  linux: ["Ubuntu", "Debian", "Linux Mint", "Fedora", "Arch / Manjaro", "Outra distribuição", UNKNOWN_INFO],
  macos: ["macOS Sequoia / Sonoma", "macOS Ventura", "macOS Monterey", "macOS Big Sur ou anterior", UNKNOWN_INFO],
  other: ["Outro sistema", UNKNOWN_INFO],
  unknown: [UNKNOWN_INFO]
};

export type SystemProfileInput = {
  operatingSystemFamily: unknown;
  operatingSystemVersion: unknown;
  hardwareKnowledge: unknown;
  processor: unknown;
  ram: unknown;
  storageType: unknown;
  storageCapacity: unknown;
  hasSsd: unknown;
  gpu: unknown;
};

export type SystemProfile = {
  operatingSystemFamily: OperatingSystemFamily;
  operatingSystemVersion: string;
  hardwareKnowledge: HardwareKnowledge;
  processor: string;
  ram: RamOption;
  storageType: StorageTypeOption;
  storageCapacity: StorageCapacityOption;
  hasSsd: YesNoUnknown;
  gpu: string;
};

function pickOption<T extends string>(value: unknown, options: readonly Option<T>[], fallback: T) {
  if (typeof value !== "string") {
    return fallback;
  }

  return options.find((item) => item.value === value)?.value || fallback;
}

function pickText(value: unknown, fallback = UNKNOWN_INFO) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || fallback;
}

function pickStringOption<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }

  return options.find((item) => item === value) || fallback;
}

export function normalizeEquipmentType(value: unknown): EquipmentType {
  return pickOption(value, EQUIPMENT_OPTIONS, "unknown");
}

export function getEquipmentLabel(value: EquipmentType) {
  return EQUIPMENT_OPTIONS.find((item) => item.value === value)?.label || UNKNOWN_INFO;
}

export function getOperatingSystemLabel(value: OperatingSystemFamily) {
  return OPERATING_SYSTEM_OPTIONS.find((item) => item.value === value)?.label || UNKNOWN_INFO;
}

export function getOperatingSystemVersionOptions(value: OperatingSystemFamily) {
  return OPERATING_SYSTEM_VERSIONS[value] || OPERATING_SYSTEM_VERSIONS.unknown;
}

export function getYesNoUnknownLabel(value: YesNoUnknown) {
  return YES_NO_UNKNOWN_OPTIONS.find((item) => item.value === value)?.label || UNKNOWN_INFO;
}

export function normalizeSystemProfile(value: unknown): SystemProfile {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const operatingSystemFamily = pickOption(source.operatingSystemFamily, OPERATING_SYSTEM_OPTIONS, "unknown");
  const operatingSystemOptions = getOperatingSystemVersionOptions(operatingSystemFamily);
  const hardwareKnowledge = pickOption(source.hardwareKnowledge, HARDWARE_KNOWLEDGE_OPTIONS, "unknown");

  if (hardwareKnowledge === "unknown") {
    return {
      operatingSystemFamily,
      operatingSystemVersion: pickStringOption(source.operatingSystemVersion, operatingSystemOptions, operatingSystemOptions[0]),
      hardwareKnowledge,
      processor: UNKNOWN_INFO,
      ram: UNKNOWN_INFO,
      storageType: UNKNOWN_INFO,
      storageCapacity: UNKNOWN_INFO,
      hasSsd: "unknown",
      gpu: UNKNOWN_INFO
    };
  }

  return {
    operatingSystemFamily,
    operatingSystemVersion: pickStringOption(source.operatingSystemVersion, operatingSystemOptions, operatingSystemOptions[0]),
    hardwareKnowledge,
    processor: pickText(source.processor),
    ram: pickStringOption(source.ram, RAM_OPTIONS, UNKNOWN_INFO),
    storageType: pickStringOption(source.storageType, STORAGE_TYPE_OPTIONS, UNKNOWN_INFO),
    storageCapacity: pickStringOption(source.storageCapacity, STORAGE_CAPACITY_OPTIONS, UNKNOWN_INFO),
    hasSsd: pickOption(source.hasSsd, YES_NO_UNKNOWN_OPTIONS, "unknown"),
    gpu: pickText(source.gpu)
  };
}

export function describeSystemProfile(profile: SystemProfile) {
  const osLine = `${getOperatingSystemLabel(profile.operatingSystemFamily)} - ${profile.operatingSystemVersion}`;

  if (profile.hardwareKnowledge === "unknown") {
    return `${osLine}. Hardware: ${UNKNOWN_INFO}.`;
  }

  return [
    osLine,
    `Processador: ${profile.processor}`,
    `Memória RAM: ${profile.ram}`,
    `Armazenamento: ${profile.storageType} / ${profile.storageCapacity}`,
    `Tem SSD: ${getYesNoUnknownLabel(profile.hasSsd)}`,
    `Placa de vídeo: ${profile.gpu}`
  ].join(" | ");
}

export function buildSystemProfileList(profile: SystemProfile) {
  return [
    { label: "Sistema operacional", value: `${getOperatingSystemLabel(profile.operatingSystemFamily)} - ${profile.operatingSystemVersion}` },
    { label: "Processador", value: profile.processor },
    { label: "Memória RAM", value: profile.ram },
    { label: "Armazenamento", value: `${profile.storageType} / ${profile.storageCapacity}` },
    { label: "Tem SSD", value: getYesNoUnknownLabel(profile.hasSsd) },
    { label: "Placa de vídeo", value: profile.gpu }
  ];
}
