export const BUSINESS_TIMEZONE = "America/Sao_Paulo";

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

function getDateParts(date = new Date(), timeZone = BUSINESS_TIMEZONE): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(date);

  return {
    year: parts.find((item) => item.type === "year")?.value || "0000",
    month: parts.find((item) => item.type === "month")?.value || "00",
    day: parts.find((item) => item.type === "day")?.value || "00",
    hour: parts.find((item) => item.type === "hour")?.value || "00",
    minute: parts.find((item) => item.type === "minute")?.value || "00"
  };
}

export function getBusinessNow(date = new Date()) {
  const parts = getDateParts(date);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);

  return {
    ...parts,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes
  };
}

export function getBusinessTodayISO(date = new Date()) {
  return getBusinessNow(date).date;
}

export function formatDateBR(date: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return "A combinar";
  }

  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateTimeBR(value: string | null | undefined) {
  if (!value) return "Não informado";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Não informado";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: BUSINESS_TIMEZONE
  }).format(date);
}

export function slotToMinutes(slot: string) {
  const [hour, minute] = slot.split(":").map(Number);
  return hour * 60 + minute;
}

export function isPastBusinessDate(date: string, reference = new Date()) {
  return date < getBusinessTodayISO(reference);
}

export function isScheduleSlotPast(date: string, slot: string, reference = new Date()) {
  const now = getBusinessNow(reference);

  if (date < now.date) {
    return true;
  }

  if (date > now.date) {
    return false;
  }

  return slotToMinutes(slot) <= now.minutes;
}
