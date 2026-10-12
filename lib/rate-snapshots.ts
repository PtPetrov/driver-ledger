/** Saved prices, not references to the editable rate catalogue. */
export type ServicePricing = {
  id: string;
  label: string;
  unit: "m3" | "day" | "hour" | "linear_m";
  rate: number;
  minimum: number;
};
export type TripPricing = { kilometer: Record<string, number>; restPerDay: number };
export type EntryPricing = { service: ServicePricing | null; kilometer: Record<string, number> };
type Driver = { id: string; level: "senior" | "junior"; rate: number };
type VehicleClass = "up-to-8-8" | "up-to-11-99";
type Rates = {
  kilometer: Record<VehicleClass, Record<Driver["level"], number>>;
  restPerDay: number;
  minimumBusiness: number;
  activities: Array<Omit<ServicePricing, "minimum"> & { minimumApplies?: boolean }>;
};
type Settings = { vehicleClass: VehicleClass; singleDriverKilometerRate: number };

export function captureTripPricing(drivers: Driver[], rates: Rates, settings: Settings): TripPricing {
  return {
    kilometer: Object.fromEntries(drivers.map((driver) => [driver.id,
      drivers.length === 1 ? settings.singleDriverKilometerRate : rates.kilometer[settings.vehicleClass][driver.level] ?? driver.rate,
    ])),
    restPerDay: rates.restPerDay,
  };
}

export function captureEntryPricing(rateItemId: string | undefined, drivers: Driver[], rates: Rates, settings: Settings): EntryPricing {
  const service = rates.activities.find((item) => item.id === rateItemId);
  return {
    service: service ? {
      id: service.id, label: service.label, unit: service.unit, rate: service.rate,
      minimum: service.minimumApplies ? rates.minimumBusiness : 0,
    } : null,
    kilometer: captureTripPricing(drivers, rates, settings).kilometer,
  };
}

export function serviceAmount(entry: { rateItemId?: string; quantity?: number; workAmount: number; pricing?: EntryPricing }, rates: Rates) {
  if (entry.rateItemId === "none") return 0;
  if (!entry.rateItemId || entry.rateItemId === "manual") return entry.workAmount;
  const service = entry.pricing ? entry.pricing.service : captureEntryPricing(entry.rateItemId, [], rates, { vehicleClass: "up-to-8-8", singleDriverKilometerRate: 0 }).service;
  if (!service) return entry.workAmount;
  const amount = Math.max(entry.quantity || 0, 0) * service.rate;
  return amount > 0 ? Math.max(amount, service.minimum) : 0;
}

export function tripDriverAmounts(trip: { totalKilometers: number; restDays: number; pricing?: TripPricing }, driverId: string, fallback: TripPricing) {
  const pricing = trip.pricing ?? fallback;
  const rate = pricing.kilometer[driverId];
  return {
    kilometers: trip.totalKilometers * (rate ?? 0),
    rest: rate === undefined ? 0 : trip.restDays * pricing.restPerDay / Math.max(Object.keys(pricing.kilometer).length, 1),
  };
}
