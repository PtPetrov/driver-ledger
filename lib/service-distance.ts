// Only address/packing services qualify. Cartons remains an alias for old records.
const eligibleServices = new Set([
  "address-loading", "address-delivery", "packing-furniture", "loading-packed",
  "unpacking", "blanket-packing", "aerofol-packing", "carton-packing",
]);
export const supportsDistance = (serviceId?: string) => eligibleServices.has(serviceId ?? "");
export function distancePercent(serviceId?: string, meters = 0) {
  if (!supportsDistance(serviceId) || !Number.isFinite(meters) || meters <= 0) return 0;
  return Math.ceil(meters / 30) * 25;
}
