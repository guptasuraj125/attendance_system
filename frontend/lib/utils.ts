const IST = "Asia/Kolkata";

export const dateLabel = (value: string) => new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value}T00:00:00Z`));

export const timeLabel = (value: number | null) => value === null
  ? "\u2014"
  : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST }).format(value);

const datePartsIST = () => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(new Date()).map(part => [part.type, part.value]));

export const thisMonth = () => {
  const parts = datePartsIST();
  return `${parts.year}-${parts.month}`;
};

export const today = () => {
  const parts = datePartsIST();
  return `${parts.year}-${parts.month}-${parts.day}`;
};
