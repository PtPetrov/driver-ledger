import { z } from "zod";

const boundedMoney = z.number().finite().min(0).max(1_000_000);
const boundedQuantity = z.number().finite().min(0).max(1_000_000);
const shortText = z.string().trim().max(160);

const driverSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  rate: boundedMoney,
  level: z.enum(["senior", "junior"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const tripSchema = z.object({
  id: z.string().min(1).max(100),
  number: z.string().min(1).max(30),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalKilometers: boundedQuantity,
  restDays: boundedQuantity,
});

const entrySchema = z.object({
  id: z.string().min(1).max(100),
  tripId: z.string().max(100).optional(),
  date: z.string().max(20),
  documentNo: z.string().trim().min(1).max(80),
  direction: z.enum(["outbound", "return"]),
  reference: shortText,
  client: z.string().trim().min(1).max(160),
  country: z.string().max(10),
  kilometers: boundedQuantity,
  activity: shortText,
  workAmount: boundedMoney,
  vehicleClass: z.enum(["up-to-8-8", "up-to-11-99"]).optional(),
  rateItemId: z.string().max(100).optional(),
  quantity: boundedQuantity.optional(),
  driverIds: z.array(z.string().max(80)).max(20),
});

const rateItemSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().trim().min(1).max(180),
  rate: boundedMoney,
  unit: z.enum(["m3", "day", "hour", "linear_m"]),
  minimumApplies: z.boolean().optional(),
});

export const ledgerDocumentSchema = z.object({
  version: z.literal(8),
  drivers: z.array(driverSchema).min(1).max(20),
  entries: z.array(entrySchema).max(5_000),
  trips: z.array(tripSchema).max(1_000),
  settings: z.object({
    vehicle: z.string().trim().max(40),
    vehicleClass: z.enum(["up-to-8-8", "up-to-11-99"]),
    currency: z.enum(["EUR", "BGN"]),
    company: z.string().trim().max(160),
    singleDriverKilometerRate: boundedMoney,
  }),
  rates: z.object({
    effectiveDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
    minimumBusiness: boundedMoney,
    restPerDay: boundedMoney,
    kilometer: z.object({
      "up-to-8-8": z.object({ senior: boundedMoney, junior: boundedMoney }),
      "up-to-11-99": z.object({ senior: boundedMoney, junior: boundedMoney }),
    }),
    activities: z.array(rateItemSchema).max(100),
  }),
});

export const ledgerSaveSchema = z.object({
  document: ledgerDocumentSchema,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type LedgerDocument = z.infer<typeof ledgerDocumentSchema>;
