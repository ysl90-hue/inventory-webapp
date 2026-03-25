export const UNIT_OPTIONS = ["EA", "SET"] as const;

export function normalizeUnit(unit: string | null | undefined) {
  const normalized = (unit || "").trim().toUpperCase();
  return normalized === "EA" || normalized === "SET" ? normalized : null;
}

export function normalizeCategory(category: string | null | undefined) {
  const normalized = (category || "").trim().toUpperCase();
  return normalized || null;
}

export function normalizeText(value: string | null | undefined) {
  const normalized = (value || "").trim();
  return normalized || null;
}

export function parseBooleanFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value === "true" || value === "1";
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return false;
}

export function stockTransactionErrorMessage(raw: string) {
  if (raw.includes("Part not found")) {
    return "품종등록을 진행해 주세요.";
  }
  if (raw.includes("Insufficient stock")) {
    return "현재 재고보다 많이 출고할 수 없습니다.";
  }
  return raw;
}

export function txTypeToStockDelta(txType: "IN" | "OUT" | "ADJUST", qty: number) {
  if (txType === "IN") return qty;
  if (txType === "OUT") return -qty;
  return 0;
}
