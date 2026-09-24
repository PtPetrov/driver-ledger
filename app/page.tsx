"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Calculator,
  ChevronRight,
  CircleGauge,
  FileText,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  Trash2,
  Truck,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DriverLevel = "senior" | "junior";
type VehicleClass = "up-to-8-8" | "up-to-11-99";
type RateUnit = "m3" | "day" | "hour" | "linear_m";
type Driver = { id: string; name: string; rate: number; level: DriverLevel; color: string };
type Direction = "outbound" | "return";
type ReportPeriod = "past" | "future";
type BusinessTrip = { id: string; number: string; departureDate: string; totalKilometers: number; restDays: number };
type Entry = {
  id: string;
  tripId?: string;
  date: string;
  documentNo: string;
  direction: Direction;
  reference: string;
  client: string;
  country: string;
  kilometers: number;
  activity: string;
  workAmount: number;
  vehicleClass?: VehicleClass;
  rateItemId?: string;
  quantity?: number;
  driverIds: string[];
};
type Settings = { vehicle: string; vehicleClass: VehicleClass; currency: string; company: string; singleDriverKilometerRate: number };
type RateItem = { id: string; label: string; rate: number; unit: RateUnit; minimumApplies?: boolean };
type RateSettings = {
  effectiveDate: string;
  minimumBusiness: number;
  restPerDay: number;
  kilometer: Record<VehicleClass, Record<DriverLevel, number>>;
  activities: RateItem[];
};

const initialRates: RateSettings = {
  effectiveDate: "2026-01-01",
  minimumBusiness: 20,
  restPerDay: 70,
  kilometer: {
    "up-to-8-8": { senior: 0.09, junior: 0.08 },
    "up-to-11-99": { senior: 0.10, junior: 0.09 },
  },
  activities: [
    { id: "warehouse-loading", label: "Товарене от склад на РОССИН-90", rate: 3, unit: "m3", minimumApplies: true },
    { id: "warehouse-unloading", label: "Разтоварване в склад на РОССИН-90", rate: 3, unit: "m3", minimumApplies: true },
    { id: "agent-warehouse-loading", label: "Товарене от склад на агент", rate: 3, unit: "m3", minimumApplies: true },
    { id: "agent-warehouse-unloading", label: "Разтоварване в склад на агент", rate: 3, unit: "m3", minimumApplies: true },
    { id: "commercial-loading", label: "Товарене на търговски пратки (линеен метър)", rate: 5, unit: "linear_m" },
    { id: "commercial-unloading", label: "Разтоварване на търговски пратки (линеен метър)", rate: 5, unit: "linear_m" },
    { id: "address-loading", label: "Товарене от адрес без разопаковане", rate: 9, unit: "m3", minimumApplies: true },
    { id: "address-delivery", label: "Доставка до адрес без разопаковане", rate: 9, unit: "m3", minimumApplies: true },
    { id: "packing-furniture", label: "Опаковане на мебели, дрехи и кашони PBO", rate: 11, unit: "m3" },
    { id: "loading-packed", label: "Товарене на опаковани мебели, дрехи и кашони PBO", rate: 11, unit: "m3" },
    { id: "delivery", label: "Доставка", rate: 12, unit: "m3", minimumApplies: true },
    { id: "unpacking", label: "Разопаковане", rate: 12, unit: "m3" },
    { id: "blanket-packing", label: "Опаковане с одеала", rate: 9, unit: "m3" },
    { id: "transfer-truck", label: "Претоварване от камион в камион", rate: 3, unit: "m3", minimumApplies: true },
    { id: "transfer-van", label: "Претоварване от/на бус", rate: 3, unit: "m3", minimumApplies: true },
    { id: "aerofol-packing", label: "Опаковане с еврорап", rate: 17, unit: "m3" },
    { id: "carton-packing", label: "Опаковане с кашони", rate: 17, unit: "m3" },
    { id: "hourly-loading", label: "Допълнително товарене", rate: 5, unit: "hour", minimumApplies: true },
    { id: "hourly-unloading", label: "Допълнително разтоварване", rate: 5, unit: "hour", minimumApplies: true },
    { id: "assembly", label: "Сглобяване", rate: 0, unit: "hour" },
    { id: "disassembly", label: "Разглобяване", rate: 0, unit: "hour" },
  ],
};

const initialDrivers: Driver[] = [
  { id: "ni", name: "NI", rate: 0.09, level: "senior", color: "#62e6a7" },
  { id: "di", name: "DI", rate: 0.08, level: "junior", color: "#ffb86b" },
];

const initialEntries: Entry[] = [];

const initialSettings: Settings = {
  vehicle: "CB6514PP",
  vehicleClass: "up-to-8-8",
  currency: "EUR",
  company: "Финансов отчет 2026",
  singleDriverKilometerRate: 0.17,
};

const initialTrips: BusinessTrip[] = [];
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const fullDate = (value: string) => new Intl.DateTimeFormat("bg-BG").format(new Date(`${value}T12:00:00`));

const emptyEntry = (): Entry => ({
  id: "",
  date: "",
  documentNo: "",
  direction: "outbound",
  reference: "",
  client: "",
  country: "BG",
  kilometers: 0,
  activity: "",
  workAmount: 0,
  vehicleClass: "up-to-8-8",
  rateItemId: "none",
  quantity: 0,
  driverIds: [],
});

const money = (value: number, currency = "EUR") =>
  new Intl.NumberFormat("bg-BG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);

const number = (value: number, digits = 1) =>
  new Intl.NumberFormat("bg-BG", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const clientCount = (value: number) => `${value} ${value === 1 ? "клиент" : "клиенти"}`;

const unitLabel = (unit: RateUnit) => unit === "m3" ? "м³" : unit === "linear_m" ? "л/м" : unit === "day" ? "ден" : "час";

const workForEntry = (entry: Entry, rates: RateSettings) => {
  if (!entry.rateItemId || entry.rateItemId === "manual") return entry.workAmount;
  const item = rates.activities.find((rate) => rate.id === entry.rateItemId);
  if (!item) return entry.workAmount;
  const amount = Math.max(entry.quantity || 0, 0) * item.rate;
  return item.minimumApplies && amount > 0 ? Math.max(amount, rates.minimumBusiness) : amount;
};

const driverRateForEntry = (entry: Entry, driver: Driver, rates: RateSettings) =>
  rates.kilometer[entry.vehicleClass || "up-to-8-8"]?.[driver.level || "junior"] ?? driver.rate;

const driverRateForClass = (vehicleClass: VehicleClass, driver: Driver, rates: RateSettings) =>
  rates.kilometer[vehicleClass]?.[driver.level || "junior"] ?? driver.rate;

const entryForDriver = (entry: Entry, driver: Driver, rates: RateSettings) => {
  if (!entry.driverIds.includes(driver.id)) return 0;
  const split = Math.max(entry.driverIds.length, 1);
  return workForEntry(entry, rates) / split;
};

const legacyRateSources: Record<string, string> = {
  "warehouse-loading": "warehouse",
  "warehouse-unloading": "warehouse",
  "address-loading": "address-no-unpack",
  "address-delivery": "address-no-unpack",
  "packing-furniture": "pack-load",
  "loading-packed": "pack-load",
  delivery: "delivery-unpack",
  unpacking: "delivery-unpack",
  "material-collection": "delivery-unpack",
  "transfer-truck": "transfer",
  "transfer-van": "transfer",
  "aerofol-packing": "aerofol",
  "carton-packing": "aerofol",
  "hourly-loading": "hourly-loading",
  "hourly-unloading": "hourly-loading",
  assembly: "assembly",
  disassembly: "assembly",
};

const legacyEntryRateIds: Record<string, string> = {
  warehouse: "warehouse-loading",
  "address-no-unpack": "address-delivery",
  "pack-load": "packing-furniture",
  "delivery-unpack": "delivery",
  transfer: "transfer-truck",
  aerofol: "aerofol-packing",
  "hourly-loading": "hourly-loading",
  assembly: "assembly",
};

const migrateRates = (saved?: Partial<RateSettings>) => {
  if (!saved) return initialRates;
  const oldActivities = saved.activities || [];
  return {
    ...initialRates,
    ...saved,
    restPerDay: saved.restPerDay ?? oldActivities.find((item) => item.id === "waiting")?.rate ?? initialRates.restPerDay,
    kilometer: {
      "up-to-8-8": { ...initialRates.kilometer["up-to-8-8"], ...saved.kilometer?.["up-to-8-8"] },
      "up-to-11-99": { ...initialRates.kilometer["up-to-11-99"], ...saved.kilometer?.["up-to-11-99"] },
    },
    activities: initialRates.activities.map((item) => {
      const source = oldActivities.find((old) => old.id === item.id)
        || oldActivities.find((old) => old.id === legacyRateSources[item.id]);
      return source ? { ...item, rate: source.rate } : item;
    }),
  };
};

export default function Home() {
  const [drivers, setDrivers] = useState<Driver[]>(initialDrivers);
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [trips, setTrips] = useState<BusinessTrip[]>(initialTrips);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [formPage, setFormPage] = useState<"trip" | "entry" | "rest" | null>(null);
  const [editingRestDays, setEditingRestDays] = useState(0);
  const [editingTrip, setEditingTrip] = useState<BusinessTrip>({ id: "", number: "", departureDate: "", totalKilometers: 0, restDays: 0 });
  const [tripError, setTripError] = useState("");
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [rates, setRates] = useState<RateSettings>(initialRates);
  const [activeTab, setActiveTab] = useState("overview");
  const [editingEntry, setEditingEntry] = useState<Entry>(emptyEntry());
  const [quantityInput, setQuantityInput] = useState("");
  const [search, setSearch] = useState("");
  const [reportTripId, setReportTripId] = useState("");
  const [reportDriverId, setReportDriverId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const effectiveDriverRateForClass = (vehicleClass: VehicleClass, driver: Driver) =>
    drivers.length === 1 ? settings.singleDriverKilometerRate : driverRateForClass(vehicleClass, driver, rates);

  const effectiveDriverRateForEntry = (entry: Entry, driver: Driver) =>
    drivers.length === 1 ? settings.singleDriverKilometerRate : driverRateForEntry(entry, driver, rates);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("driver-ledger-demo");
      if (saved) {
        const parsed = JSON.parse(saved) as {
          version?: number;
          drivers?: Driver[];
          entries?: Entry[];
          settings?: Settings;
          trips?: BusinessTrip[];
          rates?: RateSettings;
        };
        if (parsed.drivers?.length) setDrivers(parsed.drivers.map((driver, index) => ({ ...driver, level: driver.level || (index === 0 ? "senior" : "junior") })));
        const clearExistingRecords = (parsed.version || 0) < 6;
        const savedEntries = !clearExistingRecords && Array.isArray(parsed.entries) ? parsed.entries : [];
        const restEntries = savedEntries.filter((entry) => entry.rateItemId === "waiting" || /престой|почивка/i.test(entry.activity || ""));
        if (Array.isArray(parsed.entries)) setEntries(savedEntries.filter((entry) => !restEntries.includes(entry)).map((entry, index) => {
          const oldRateId = entry.rateItemId || "manual";
          return {
            vehicleClass: "up-to-8-8",
            quantity: 0,
            ...entry,
            rateItemId: legacyEntryRateIds[oldRateId] || oldRateId,
            documentNo: /^SEE-/i.test(entry.documentNo || "")
              ? entry.documentNo.toUpperCase()
              : /^SE-/i.test(entry.documentNo || "")
                ? entry.documentNo.toUpperCase().replace(/^SE-/i, "SEE-")
                : `SEE-${(entry.reference?.match(/\d+/)?.[0] || `OLD-${index + 1}`).toUpperCase()}`,
          };
        }));
        const oldRestRate = parsed.rates?.activities?.find((item) => item.id === "waiting")?.rate || initialRates.restPerDay;
        // Older browser data stored kilometres and rest as client rows. Move
        // both values to the parent business trip without losing client work.
        setTrips(!clearExistingRecords && Array.isArray(parsed.trips) ? parsed.trips.map((trip) => ({
          ...trip,
          totalKilometers: Number.isFinite(trip.totalKilometers)
            ? trip.totalKilometers
            : savedEntries.filter((entry) => entry.tripId === trip.id).reduce((sum, entry) => sum + (entry.kilometers || 0), 0),
          restDays: Number.isFinite(trip.restDays)
            ? trip.restDays
            : restEntries.filter((entry) => entry.tripId === trip.id).reduce((sum, entry) => sum + (entry.quantity || (entry.workAmount ? entry.workAmount / oldRestRate : 1)), 0),
        })) : []);
        if (parsed.settings) setSettings({ ...initialSettings, ...parsed.settings });
        const migratedRates = migrateRates(parsed.rates);
        setRates((parsed.version || 0) < 7 ? { ...migratedRates, restPerDay: 70 } : migratedRates);
      }
    } catch {
      toast.error("Запазените данни не можаха да бъдат заредени.");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("driver-ledger-demo", JSON.stringify({ version: 7, drivers, entries, trips, settings, rates }));
    } catch {
      toast.error("Промените не могат да се запазят в този браузър.");
    }
  }, [hydrated, drivers, entries, trips, settings, rates]);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId);
  const unassignedEntries = entries.filter((entry) => !trips.some((trip) => trip.id === entry.tripId));
  const scopedEntries = selectedTripId === "unassigned" ? unassignedEntries : entries.filter((entry) => entry.tripId === selectedTripId);
  const editingEntryTrip = trips.find((trip) => trip.id === editingEntry.tripId);
  const openTrip = (id: string | null) => {
    setSelectedTripId(id);
    setSearch("");
    setActiveTab("trips");
  };
  const openNewTrip = () => {
    setEditingTrip({ id: "", number: "", departureDate: "", totalKilometers: 0, restDays: 0 });
    setTripError("");
    setFormPage("trip");
  };
  const saveTrip = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const departureDate = event.currentTarget.querySelector<HTMLInputElement>("#trip-date")?.value || editingTrip.departureDate;
    const serial = Number(editingTrip.number);
    if (!Number.isSafeInteger(serial) || serial < 1 || !departureDate || editingTrip.totalKilometers < 0 || editingTrip.restDays < 0) {
      setTripError("Въведете положителен пореден номер и дата. Километрите не могат да са отрицателни.");
      return;
    }
    if (trips.some((trip) => trip.id !== editingTrip.id && Number(trip.number) === serial)) {
      setTripError("Вече има командировка с този номер. Изберете друг.");
      return;
    }
    if (entries.some((entry) => entry.tripId === editingTrip.id && entry.date < departureDate)) {
      setTripError("Датата на тръгване не може да е след вече въведен клиент.");
      return;
    }
    const saved = { ...editingTrip, departureDate, id: editingTrip.id || `trip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, number: String(serial) };
    setTrips((current) => editingTrip.id ? current.map((trip) => trip.id === saved.id ? saved : trip) : [...current, saved]);
    setFormPage(null);
    openTrip(saved.id);
    toast.success(editingTrip.id ? "Командировката е обновена." : `Командировка № ${saved.number} е създадена. Добавете първия клиент.`);
  };

  const totals = useMemo(() => {
    const legacyEntries = entries.filter((entry) => !trips.some((trip) => trip.id === entry.tripId));
    const kilometers = trips.reduce((sum, trip) => sum + trip.totalKilometers, 0) + legacyEntries.reduce((sum, entry) => sum + entry.kilometers, 0);
    const rest = trips.reduce((sum, trip) => sum + trip.restDays * rates.restPerDay, 0);
    const work = entries.reduce((sum, entry) => sum + workForEntry(entry, rates), 0) + rest;
    const byDriver = drivers.map((driver) => {
      const tripKmTotal = trips.reduce((sum, trip) => sum + trip.totalKilometers * effectiveDriverRateForClass(settings.vehicleClass, driver), 0);
      const legacyKmTotal = legacyEntries.reduce((sum, entry) => sum + (entry.driverIds.includes(driver.id) ? entry.kilometers * effectiveDriverRateForEntry(entry, driver) : 0), 0);
      const workTotal = entries.reduce((sum, entry) => sum + entryForDriver(entry, driver, rates), 0);
      const restTotal = drivers.length ? rest / drivers.length : 0;
      return { ...driver, total: tripKmTotal + legacyKmTotal + workTotal + restTotal, kmTotal: tripKmTotal + legacyKmTotal };
    });
    return {
      kilometers,
      work,
      byDriver,
      total: byDriver.reduce((sum, driver) => sum + driver.total, 0),
    };
  }, [drivers, entries, trips, rates, settings.vehicleClass, settings.singleDriverKilometerRate]);

  const earningsForTrip = (trip: BusinessTrip, driver: Driver) => {
    const tripEntries = entries.filter((entry) => entry.tripId === trip.id);
    const kilometers = trip.totalKilometers * effectiveDriverRateForClass(settings.vehicleClass, driver);
    const services = tripEntries.reduce((sum, entry) => sum + entryForDriver(entry, driver, rates), 0);
    const rest = drivers.length ? trip.restDays * rates.restPerDay / drivers.length : 0;
    return { kilometers, services, rest, total: kilometers + services + rest };
  };

  const reportTrips = [...trips].sort((a, b) => b.departureDate.localeCompare(a.departureDate) || Number(b.number) - Number(a.number));
  const reportTrip = trips.find((trip) => trip.id === reportTripId) || reportTrips[0];
  const reportDriver = drivers.find((driver) => driver.id === reportDriverId);
  const reportTripTotal = reportTrip
    ? drivers.reduce((sum, driver) => sum + earningsForTrip(reportTrip, driver).total, 0)
    : 0;
  const driverTripHistory = reportDriver
    ? [...trips]
      .sort((a, b) => b.departureDate.localeCompare(a.departureDate))
      .map((trip) => ({ trip, earnings: earningsForTrip(trip, reportDriver) }))
    : [];
  const driverPast = driverTripHistory.filter(({ trip }) => trip.departureDate <= today());
  const driverFuture = driverTripHistory.filter(({ trip }) => trip.departureDate > today()).reverse();

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("bg");
    return scopedEntries.filter((entry) => {
      const haystack = `${entry.documentNo} ${entry.client} ${entry.activity}`.toLocaleLowerCase("bg");
      return !query || haystack.includes(query);
    });
  }, [scopedEntries, search]);

  const openNewEntry = () => {
    if (!selectedTrip) {
      openTrip(null);
      return;
    }
    setEditingEntry({ ...emptyEntry(), tripId: selectedTrip.id, driverIds: drivers.map((driver) => driver.id) });
    setQuantityInput("");
    setFormPage("entry");
  };

  const openEditEntry = (entry: Entry) => {
    setEditingEntry({ ...entry, driverIds: drivers.map((driver) => driver.id) });
    setQuantityInput(entry.quantity ? String(entry.quantity) : "");
    setFormPage("entry");
  };

  const openRestPage = () => {
    if (!selectedTrip) return;
    setEditingRestDays(selectedTrip.restDays || 0);
    setFormPage("rest");
  };

  const saveRest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTrip || !Number.isSafeInteger(editingRestDays) || editingRestDays <= 0) {
      toast.error("Въведете валиден брой 24-часови почивки.");
      return;
    }
    setTrips((current) => current.map((trip) => trip.id === selectedTrip.id ? { ...trip, restDays: editingRestDays } : trip));
    setFormPage(null);
    toast.success(selectedTrip.restDays ? "Почивката е обновена." : "Почивката е добавена.");
  };

  const saveEntry = (event: FormEvent) => {
    event.preventDefault();
    const trip = trips.find((item) => item.id === editingEntry.tripId);
    const service = rates.activities.find((item) => item.id === editingEntry.rateItemId);
    if (!trip) {
      toast.error("Първо създайте или изберете командировка за този клиент.");
      return;
    }
    if (!/^SEE-[A-Z0-9][A-Z0-9-]*$/i.test(editingEntry.documentNo.trim())) {
      toast.error("Номерът на файла трябва да започва с SEE- и да съдържа номер след него.");
      return;
    }
    if (!editingEntry.client.trim()) {
      toast.error("Добавете име на клиент.");
      return;
    }
    if (!service || (editingEntry.quantity || 0) <= 0) {
      toast.error("Изберете услуга и въведете валидно количество.");
      return;
    }
    const isEditing = Boolean(editingEntry.id);
    const normalized = { ...editingEntry, driverIds: drivers.map((driver) => driver.id), documentNo: editingEntry.documentNo.trim().toUpperCase(), date: trip.departureDate, kilometers: 0, activity: service.label };
    const saved = isEditing ? normalized : { ...normalized, id: `entry-${Date.now()}` };
    setEntries((current) =>
      isEditing
        ? current.map((entry) => (entry.id === saved.id ? saved : entry))
        : [saved, ...current],
    );
    setFormPage(null);
    toast.success(isEditing ? "Клиентът е обновен." : "Новият клиент е добавен.");
  };

  const deleteEntry = (id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setFormPage(null);
    toast.success("Клиентът е изтрит.");
  };

  const deleteTrip = (trip: BusinessTrip) => {
    const linkedClients = entries.filter((entry) => entry.tripId === trip.id).length;
    setEntries((current) => current.filter((entry) => entry.tripId !== trip.id));
    setTrips((current) => current.filter((item) => item.id !== trip.id));
    setSelectedTripId(null);
    setReportTripId((current) => current === trip.id ? "" : current);
    setReportDriverId(null);
    setFormPage(null);
    toast.success(linkedClients
      ? `Командировката и ${clientCount(linkedClients)} са изтрити.`
      : "Командировката е изтрита.");
  };

  const addDriver = () => {
    const id = `driver-${Date.now()}`;
    const palette = ["#7dd3fc", "#c4b5fd", "#fda4af", "#fde047"];
    setDrivers((current) => [
      ...current,
      { id, name: `Шофьор ${current.length + 1}`, rate: 0.08, level: "junior", color: palette[current.length % palette.length] },
    ]);
    toast.success("Добавен е нов шофьор.");
  };

  const removeDriver = (id: string) => {
    if (drivers.length === 1) return;
    setDrivers((current) => current.filter((driver) => driver.id !== id));
    setEntries((current) => current.map((entry) => ({
      ...entry,
      driverIds: entry.driverIds.filter((driverId) => driverId !== id),
    })));
    toast.success("Шофьорът е премахнат.");
  };

  const clearTripData = () => {
    setEntries([]);
    setTrips([]);
    openTrip(null);
    setReportTripId("");
    setReportDriverId(null);
    setFormPage(null);
    toast.success("Всички командировки и клиенти са изтрити.");
  };

  useEffect(() => {
    const context = (document as Document & {
      modelContext?: {
        registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn("WebMCP registration failed", error);
    const register = (tool: Record<string, unknown>) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(report);
      } catch (error) {
        report(error);
      }
    };
    register({
      name: "read_finance_summary",
      title: "Преглед на финансовото обобщение",
      description: "Връща текущите километри и общото възнаграждение по шофьори.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({
        vehicle: settings.vehicle,
        kilometers: totals.kilometers,
        drivers: totals.byDriver.map((driver) => ({ name: driver.name, total: Number(driver.total.toFixed(2)) })),
      }),
    });
    register({
      name: "start_trip_entry",
      title: "Отвори нов запис",
      description: "Отваря нов клиент в избраната командировка; ако няма избрана, показва командировките.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        openNewEntry();
        return { status: selectedTrip ? "ready" : "select_business_trip_first" };
      },
    });
    return () => lifecycle.abort();
  }, [settings.vehicle, totals, selectedTrip, trips]);

  const selectedRateItem = rates.activities.find((item) => item.id === editingEntry.rateItemId);
  const editingWorkAmount = workForEntry(editingEntry, rates);
  const formPageContent = formPage === "trip" ? (
    <section className="form-page" aria-labelledby="trip-form-title">
      <Button type="button" variant="ghost" className="trip-back" onClick={() => setFormPage(null)}><ArrowLeft /> Назад</Button>
      <div className="form-page-heading"><p className="eyebrow">Командировка</p><h1 id="trip-form-title">{editingTrip.id ? "Редакция на командировка" : "Нова командировка"}</h1><p>Въведете номер, дата на тръгване и общи километри. Клиентите и почивката се добавят отделно.</p></div>
      <Card className="panel form-page-card"><CardContent className="panel-content">
        <form onSubmit={saveTrip} className="entry-form">
          <div className="field"><Label htmlFor="trip-number">Пореден номер</Label><Input id="trip-number" type="number" inputMode="numeric" min="1" step="1" required value={editingTrip.number} onChange={(event) => { setEditingTrip((current) => ({ ...current, number: event.target.value })); setTripError(""); }} aria-invalid={Boolean(tripError)} aria-describedby={tripError ? "trip-error" : "trip-number-help"} /><p id="trip-number-help" className="field-help">Уникален номер на командировката.</p></div>
          <div className="form-grid two"><div className="field"><Label htmlFor="trip-date">Дата на тръгване</Label><Input id="trip-date" type="date" required value={editingTrip.departureDate} onChange={(event) => { setEditingTrip((current) => ({ ...current, departureDate: event.target.value })); setTripError(""); }} /></div><div className="field"><Label htmlFor="trip-km">Общо километри</Label><Input id="trip-km" type="number" inputMode="decimal" min="0" step="0.1" value={editingTrip.totalKilometers || ""} onChange={(event) => { setEditingTrip((current) => ({ ...current, totalKilometers: Number(event.target.value) || 0 })); setTripError(""); }} /><p className="field-help">Незадължително поле. Може да добавите пробега по-късно.</p></div></div>
          {tripError && <p className="form-error" id="trip-error" role="alert">{tripError}</p>}
          <div className="form-page-actions"><Button type="button" variant="outline" onClick={() => setFormPage(null)}>Отказ</Button><Button type="submit">{editingTrip.id ? "Запази промените" : "Създай командировка"}</Button></div>
        </form>
      </CardContent></Card>
    </section>
  ) : formPage === "entry" ? (
    <section className="form-page" aria-labelledby="entry-form-title">
      <Button type="button" variant="ghost" className="trip-back" onClick={() => setFormPage(null)}><ArrowLeft /> Назад</Button>
      <div className="form-page-heading"><p className="eyebrow">Клиент</p><h1 id="entry-form-title">{editingEntry.id ? "Редакция на клиент" : "Нов клиент"}</h1><p>Добавете файла, клиента и извършената услуга. Стойността се изчислява автоматично.</p></div>
      <Card className="panel form-page-card"><CardContent className="panel-content">
        <form onSubmit={saveEntry} className="entry-form">
          {editingEntry.id ? <div className="field"><Label htmlFor="entry-trip">Командировка</Label><Select value={editingEntryTrip?.id || ""} onValueChange={(value) => setEditingEntry((current) => ({ ...current, tripId: value }))}><SelectTrigger id="entry-trip" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{trips.map((trip) => <SelectItem key={trip.id} value={trip.id}>№ {trip.number} · {fullDate(trip.departureDate)}</SelectItem>)}</SelectContent></Select><p className="field-help">Командировката, към която принадлежи клиентът.</p></div> : <div className="entry-trip-context"><BriefcaseBusiness /><span>Командировка № {editingEntryTrip?.number}<small>Тръгване: {editingEntryTrip ? fullDate(editingEntryTrip.departureDate) : ""}</small></span></div>}
          <div className="form-grid two"><div className="field"><Label htmlFor="entry-document">Номер на файл</Label><Input id="entry-document" required value={editingEntry.documentNo} onChange={(event) => { const value = event.target.value.toUpperCase(); const suffix = value.replace(/^SEE?-?/i, ""); setEditingEntry((current) => ({ ...current, documentNo: value ? `SEE-${suffix}` : "" })); }} /><p className="field-help">Номерът винаги започва с SEE-.</p></div><div className="field"><Label htmlFor="entry-client">Име на клиент</Label><Input id="entry-client" required value={editingEntry.client} onChange={(event) => setEditingEntry((current) => ({ ...current, client: event.target.value }))} /><p className="field-help">Име на лице или фирма.</p></div></div>
          <div className="activity-calculator"><div className="field"><Label>Услуга</Label><Select value={editingEntry.rateItemId || "none"} onValueChange={(value) => { setQuantityInput(""); setEditingEntry((current) => ({ ...current, rateItemId: value, quantity: 0, activity: rates.activities.find((item) => item.id === value)?.label || "" })); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem>{rates.activities.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select><p className="field-help">Изберете извършената дейност по действащите ставки.</p></div>{selectedRateItem && <><div className="field"><Label htmlFor="entry-quantity">Количество ({unitLabel(selectedRateItem.unit)})</Label><Input id="entry-quantity" type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required value={quantityInput} onChange={(event) => { const value = event.target.value; if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return; setQuantityInput(value); setEditingEntry((current) => ({ ...current, quantity: Number(value) || 0 })); }} /><p className="field-help">Можете да използвате десетична точка, например 1.25.</p></div><div className="calculated-work"><span>Стойност на услугата</span><strong>{money(editingWorkAmount, settings.currency)}</strong><small>{number(editingEntry.quantity || 0, 2)} {unitLabel(selectedRateItem.unit)} × {money(selectedRateItem.rate, settings.currency)}{selectedRateItem.minimumApplies && editingWorkAmount === rates.minimumBusiness ? ` · приложен минимум ${money(rates.minimumBusiness, settings.currency)}` : ""}</small></div></>}</div>
          <div className="field"><Label htmlFor="entry-note">Бележка</Label><Input id="entry-note" value={editingEntry.reference} onChange={(event) => setEditingEntry((current) => ({ ...current, reference: event.target.value }))} /><p className="field-help">Незадължителна допълнителна информация.</p></div>
          <div className="live-calculation"><div><span>Труд за клиента</span><strong>{money(workForEntry(editingEntry, rates), settings.currency)}</strong></div><div className="calculation-split">{drivers.filter((driver) => editingEntry.driverIds.includes(driver.id)).map((driver) => <span key={driver.id}>{driver.name}: <b>{money(entryForDriver(editingEntry, driver, rates), settings.currency)}</b></span>)}</div></div>
          <div className={`form-page-actions ${editingEntry.id ? "with-delete" : ""}`}>
            {editingEntry.id && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" className="delete-action"><Trash2 /> Изтрий клиента</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Изтриване на клиента?</AlertDialogTitle><AlertDialogDescription>Клиентът и изчислената за него сума ще бъдат премахнати от командировката.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отказ</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleteEntry(editingEntry.id)}>Изтрий клиента</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
            <Button type="button" variant="outline" onClick={() => setFormPage(null)}>Отказ</Button><Button type="submit">{editingEntry.id ? "Запази промените" : "Добави клиента"}</Button>
          </div>
        </form>
      </CardContent></Card>
    </section>
  ) : formPage === "rest" && selectedTrip ? (
    <section className="form-page" aria-labelledby="rest-form-title">
      <Button type="button" variant="ghost" className="trip-back" onClick={() => setFormPage(null)}><ArrowLeft /> Назад</Button>
      <div className="form-page-heading"><p className="eyebrow">Командировка № {selectedTrip.number}</p><h1 id="rest-form-title">{selectedTrip.restDays ? "Редакция на почивка" : "Добавяне на почивка"}</h1><p>Една почивка е 24 часа и се заплаща общо {money(rates.restPerDay, settings.currency)} за двамата шофьори.</p></div>
      <Card className="panel form-page-card"><CardContent className="panel-content">
        <form onSubmit={saveRest} className="entry-form">
          <div className="field"><Label htmlFor="rest-days">Брой почивки по 24 часа</Label><Input id="rest-days" type="number" inputMode="numeric" min="1" step="1" required value={editingRestDays || ""} onChange={(event) => setEditingRestDays(Number(event.target.value) || 0)} /><p className="field-help">Въведете броя на завършените 24-часови периоди.</p></div>
          <div className="live-calculation"><div><span>Общо за двамата шофьори</span><strong>{money(editingRestDays * rates.restPerDay, settings.currency)}</strong></div><div className="calculation-split"><span>{number(editingRestDays, 0)} × 24 часа × <b>{money(rates.restPerDay, settings.currency)}</b></span><span>За всеки: <b>{money(editingRestDays * rates.restPerDay / 2, settings.currency)}</b></span></div></div>
          <div className="form-page-actions"><Button type="button" variant="outline" onClick={() => setFormPage(null)}>Отказ</Button><Button type="submit">{selectedTrip.restDays ? "Запази промените" : "Добави почивка"}</Button></div>
        </form>
      </CardContent></Card>
    </section>
  ) : null;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Truck /></div>
          <div><p className="brand-name">Driver Ledger</p><p className="brand-context">{settings.vehicle}</p></div>
        </div>
        <div className="header-period"><BriefcaseBusiness /><span>{trips.length} командировки · {clientCount(entries.length)}</span></div>
        <Button className="primary-action" disabled={!hydrated} aria-label={activeTab === "trips" && selectedTrip ? "Нов клиент" : "Нова командировка"} onClick={activeTab === "trips" && selectedTrip ? openNewEntry : openNewTrip}><Plus /> <span>{activeTab === "trips" && selectedTrip ? "Нов клиент" : "Нова командировка"}</span></Button>
      </header>

      <Tabs value={activeTab} onValueChange={(value) => { setFormPage(null); setActiveTab(value); }} className="app-tabs">
        <nav className="nav-wrap" aria-label="Основна навигация">
          <TabsList variant="line" className="app-nav">
            <TabsTrigger value="overview"><CircleGauge /> Отчет</TabsTrigger>
            <TabsTrigger value="trips"><BriefcaseBusiness /> Командировки</TabsTrigger>
            <TabsTrigger value="rates"><Calculator /> Ставки</TabsTrigger>
            <TabsTrigger value="settings"><Settings2 /> Настройки</TabsTrigger>
          </TabsList>
        </nav>

        <div className="content-wrap">
          {formPage ? formPageContent : <>
          <TabsContent value="overview" className="space-y-6">
            {reportDriver ? <>
              <Button variant="ghost" className="trip-back" onClick={() => setReportDriverId(null)}><ArrowLeft /> Назад към отчета</Button>
              <section className="overview-heading driver-detail-heading">
                <div className="driver-detail-title"><span className="driver-avatar large" style={{ backgroundColor: reportDriver.color }}>{reportDriver.name.slice(0, 2).toUpperCase()}</span><div><p className="eyebrow">Подробен отчет</p><h1>{reportDriver.name}</h1><p>{reportDriver.level === "senior" ? "Старши шофьор" : "Младши шофьор"} · {money(effectiveDriverRateForClass(settings.vehicleClass, reportDriver), settings.currency)}/км</p></div></div>
              </section>

              <section className="driver-detail-summary" aria-label={`Обобщение за ${reportDriver.name}`}>
                {reportTrip && <Card className="driver-summary-card current"><CardContent className="p-0"><span>Текуща командировка № {reportTrip.number}</span><strong>{money(earningsForTrip(reportTrip, reportDriver).total, settings.currency)}</strong><small>{fullDate(reportTrip.departureDate)} · {number(reportTrip.totalKilometers)} км</small></CardContent></Card>}
              </section>

              {(["future", "past"] as ReportPeriod[]).map((period) => {
                const rows = period === "future" ? driverFuture : driverPast;
                return <Card className="panel driver-history-panel" key={period}><CardContent className="panel-content"><div className="panel-heading"><div><p className="eyebrow">{period === "future" ? "Предстоящи" : "История"}</p><h2>{period === "future" ? "Бъдещи командировки" : "Минали командировки"}</h2></div><Badge variant="outline">{rows.length}</Badge></div>{rows.length ? <div className="driver-trip-list">{rows.map(({ trip, earnings }) => <button className="driver-trip-row" key={trip.id} onClick={() => openTrip(trip.id)}><span className="driver-trip-main"><b>Командировка № {trip.number}</b><small>{fullDate(trip.departureDate)} · {number(trip.totalKilometers)} км</small></span><span><small>Километри</small><b>{money(earnings.kilometers, settings.currency)}</b></span><span><small>Услуги</small><b>{money(earnings.services, settings.currency)}</b></span><span><small>Почивка (дял)</small><b>{money(earnings.rest, settings.currency)}</b></span><span className="driver-trip-total"><small>Общо</small><b>{money(earnings.total, settings.currency)}</b></span><ChevronRight /></button>)}</div> : <div className="driver-history-empty"><CalendarDays /><span>{period === "future" ? "Няма планирани бъдещи командировки." : "Няма завършени командировки."}</span></div>}</CardContent></Card>;
              })}
            </> : <>
              <section className="overview-heading">
                <div><p className="eyebrow">Текущ отчет</p><h1>Възнаграждения по шофьор</h1><p>Изберете командировка, за да видите изчисленото възнаграждение.</p></div>
                {reportTrip && <div className="report-trip-picker"><Label>Командировка</Label><Select value={reportTrip.id} onValueChange={setReportTripId}><SelectTrigger aria-label="Избери командировка"><SelectValue /></SelectTrigger><SelectContent>{reportTrips.map((trip) => <SelectItem key={trip.id} value={trip.id}>№ {trip.number} · {fullDate(trip.departureDate)}</SelectItem>)}</SelectContent></Select></div>}
              </section>

              {reportTrip ? <section className="current-earnings" aria-label={`Възнаграждения за командировка № ${reportTrip.number}`}>
                <div className="selected-trip-line"><span>Командировка № {reportTrip.number}</span><small>{fullDate(reportTrip.departureDate)} · {number(reportTrip.totalKilometers)} км · {clientCount(entries.filter((entry) => entry.tripId === reportTrip.id).length)}</small></div>
                <div className="report-driver-grid">
                  {drivers.map((driver, index) => {
                    const earnings = earningsForTrip(reportTrip, driver);
                    return <button className={index === 0 ? "report-driver-card featured" : "report-driver-card"} key={driver.id} onClick={() => setReportDriverId(driver.id)}><span className="report-driver-top"><span className="report-driver-title"><span>Шофьор</span><b>{driver.name}</b></span><span className="report-driver-icon" style={{ backgroundColor: index === 0 ? "#62e6a7" : driver.color }}>{driver.name.slice(0, 2).toUpperCase()}</span></span><strong>{money(earnings.total, settings.currency)}</strong><span className="report-driver-meta">{driver.level === "senior" ? "Старши шофьор" : "Младши шофьор"} · {money(effectiveDriverRateForClass(settings.vehicleClass, driver), settings.currency)}/км</span><span className="report-driver-link">Подробен отчет <ChevronRight /></span></button>;
                  })}
                </div>
                <div className="report-combined-total"><span><Users /> {drivers.length === 2 ? "Общо за двамата шофьори" : `Общо за ${drivers.length} шофьори`}</span><strong>{money(reportTripTotal, settings.currency)}</strong></div>
              </section> : <Card className="panel"><CardContent className="empty-state"><CalendarDays /><h3>Няма командировки</h3><p>Създайте командировка, за да се изчислят възнагражденията.</p></CardContent></Card>}
            </>}
          </TabsContent>

          <TabsContent value="trips" className="space-y-5">
            {!selectedTripId ? <>
              <section className="page-heading">
                <div><p className="eyebrow">{trips.length} командировки</p><h1>Вашите командировки</h1><p>Изберете командировка, за да въведете клиентите в нея.</p></div>
                <Button disabled={!hydrated} onClick={openNewTrip}><Plus /> Нова командировка</Button>
              </section>
              {unassignedEntries.length > 0 && <div className="legacy-notice"><FileText /><div><strong>{clientCount(unassignedEntries.length)} без командировка</strong><p>Старите ви записи са запазени и участват в отчета. Отворете клиент и изберете към коя командировка принадлежи.</p></div><Button variant="outline" onClick={() => openTrip("unassigned")}>Разпредели клиентите <ChevronRight /></Button></div>}
              <div className="trips-grid">
                {[...trips].sort((a, b) => b.departureDate.localeCompare(a.departureDate) || Number(b.number) - Number(a.number)).map((trip) => {
                  const records = entries.filter((entry) => entry.tripId === trip.id);
                  const km = trip.totalKilometers;
                  const total = drivers.reduce((sum, driver) => sum + trip.totalKilometers * effectiveDriverRateForClass(settings.vehicleClass, driver) + records.reduce((amount, entry) => amount + entryForDriver(entry, driver, rates), 0), 0) + trip.restDays * rates.restPerDay;
                  return <button className="trip-card" key={trip.id} onClick={() => openTrip(trip.id)}>
                    <span className="trip-card-top"><span className="trip-icon"><BriefcaseBusiness /></span><Badge variant="secondary">{records.length ? clientCount(records.length) : "Без клиенти"}</Badge></span>
                    <strong className="trip-card-title">Командировка № {trip.number}</strong>
                    <span className="trip-departure"><CalendarDays /> Тръгване: {fullDate(trip.departureDate)}{trip.restDays ? ` · ${number(trip.restDays, 0)} × 24 ч. почивка` : ""}</span>
                    <span className="trip-card-metrics"><span><small>Изминати километри</small><b>{number(km)} км</b></span><span><small>За изплащане</small><b>{money(total, settings.currency)}</b></span></span>
                    <span className="trip-card-link">{records.length ? "Отвори командировката" : "Добави първия клиент"}<ChevronRight /></span>
                  </button>;
                })}
              </div>
              {!trips.length && <Card className="panel"><CardContent className="empty-state"><BriefcaseBusiness /><h2>Първо създайте командировка</h2><p>Нужни са пореден номер и дата на тръгване. Километрите може да добавите по-късно.</p><Button className="mt-5" onClick={openNewTrip}><Plus /> Създай командировка</Button></CardContent></Card>}
              <p className="local-data-note">Интерактивно демо · Данните се пазят само в този браузър.</p>
            </> : <>
            <Button variant="ghost" className="trip-back" onClick={() => openTrip(null)}><ArrowLeft /> Всички командировки</Button>
            <section className="page-heading">
              <div><p className="eyebrow">{clientCount(scopedEntries.length)}</p><h1>{selectedTrip ? `Командировка № ${selectedTrip.number}` : "Без командировка"}</h1><p>{selectedTrip ? `${fullDate(selectedTrip.departureDate)} · ${number(selectedTrip.totalKilometers)} км · ${settings.vehicle}` : "Отворете клиент, за да го свържете с командировка."}</p></div>
              <div className="heading-actions">{selectedTrip && <><Button variant="outline" aria-label="Редактирай командировката" onClick={() => { setEditingTrip({ ...selectedTrip }); setTripError(""); setFormPage("trip"); }}><Pencil /><span>Редактирай</span></Button><Button variant="outline" onClick={openRestPage}><CalendarDays /> {selectedTrip.restDays ? "Редактирай почивка" : "Добави почивка"}</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="destructive-outline"><Trash2 /> Изтрий</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Изтриване на командировка № {selectedTrip.number}?</AlertDialogTitle><AlertDialogDescription>{scopedEntries.length ? `Командировката и свързаните с нея ${clientCount(scopedEntries.length)} ще бъдат изтрити.` : "Командировката ще бъде изтрита."} Това действие не може да бъде отменено.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отказ</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleteTrip(selectedTrip)}>Изтрий командировката</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Button onClick={openNewEntry}><Plus /> Нов клиент</Button></>}</div>
            </section>
            {selectedTrip && <div className="trip-summary"><div><span>Общо километри</span><strong>{number(selectedTrip.totalKilometers)} км</strong></div><div><span>Услуги</span><strong>{money(scopedEntries.reduce((sum, entry) => sum + workForEntry(entry, rates), 0), settings.currency)}</strong></div><div><span>Почивка (общо)</span><strong>{money(selectedTrip.restDays * rates.restPerDay, settings.currency)}</strong></div>{drivers.map((driver) => <div key={driver.id}><span>За {driver.name}</span><strong>{money(selectedTrip.totalKilometers * effectiveDriverRateForClass(settings.vehicleClass, driver) + scopedEntries.reduce((sum, entry) => sum + entryForDriver(entry, driver, rates), 0) + (drivers.length ? selectedTrip.restDays * rates.restPerDay / drivers.length : 0), settings.currency)}</strong></div>)}</div>}
            <Card className="panel entries-panel">
              <CardContent className="panel-content entries-content">
                <div className="filters-row">
                  <div className="search-box"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Търсене в клиентите" /></div>
                  <span className="filter-count">{filteredEntries.length} резултата</span>
                </div>

                <div className="desktop-table">
                  <Table>
                    <TableHeader><TableRow><TableHead>Номер на файл</TableHead><TableHead>Клиент</TableHead><TableHead>Услуга</TableHead><TableHead className="text-right">Количество</TableHead>{drivers.map((driver) => <TableHead key={driver.id} className="text-right">{driver.name}</TableHead>)}<TableHead className="w-12" /></TableRow></TableHeader>
                    <TableBody>
                      {filteredEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell><div className="table-primary">{entry.documentNo}</div><div className="table-secondary">Командировка № {selectedTrip?.number}</div></TableCell>
                          <TableCell><div className="table-primary">{entry.client || "-"}</div></TableCell>
                          <TableCell><div className="table-primary">{rates.activities.find((item) => item.id === entry.rateItemId)?.label || entry.activity || "-"}</div></TableCell>
                          <TableCell className="text-right table-primary">{entry.quantity ? `${number(entry.quantity, 2)} ${unitLabel(rates.activities.find((item) => item.id === entry.rateItemId)?.unit || "m3")}` : "-"}</TableCell>
                          {drivers.map((driver) => <TableCell key={driver.id} className="text-right table-primary">{entry.driverIds.includes(driver.id) ? money(entryForDriver(entry, driver, rates), settings.currency) : "-"}</TableCell>)}
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Действия за записа"><MoreHorizontal /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditEntry(entry)}><Pencil /> Редактирай</DropdownMenuItem>
                                <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={(event) => event.preventDefault()} className="text-destructive"><Trash2 /> Изтрий</DropdownMenuItem></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Да изтрием ли записа?</AlertDialogTitle><AlertDialogDescription>Това ще премахне реда и ще преизчисли сумите за всички шофьори.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отказ</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleteEntry(entry.id)}>Изтрий</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="mobile-entry-list">
                  {filteredEntries.map((entry) => (
                    <button className="mobile-entry-card" key={entry.id} onClick={() => openEditEntry(entry)}>
                      <span className="mobile-entry-top"><span>{entry.documentNo}</span><Badge variant="secondary">{entry.quantity ? `${number(entry.quantity, 2)} ${unitLabel(rates.activities.find((item) => item.id === entry.rateItemId)?.unit || "m3")}` : "Услуга"}</Badge></span>
                      <strong>{entry.client || "Без клиент"}</strong>
                      <small>{rates.activities.find((item) => item.id === entry.rateItemId)?.label || entry.activity || "Услуга"}</small>
                      <span className="mobile-entry-bottom"><span>Труд общо</span><b>{money(workForEntry(entry, rates), settings.currency)}</b></span>
                    </button>
                  ))}
                </div>
                {!filteredEntries.length && <div className="empty-state"><ReceiptText /><h3>{scopedEntries.length ? "Няма намерени клиенти" : selectedTrip ? "Командировката е готова за първия клиент" : "Всички клиенти са разпределени"}</h3><p>{scopedEntries.length ? "Променете търсенето." : selectedTrip ? "Добавете SEE-номер, име на клиент, услуга и количество." : "Ще ги намерите в съответните командировки."}</p>{selectedTrip && !scopedEntries.length && <Button className="mt-5" onClick={openNewEntry}><Plus /> Добави първи клиент</Button>}</div>}
              </CardContent>
            </Card>
            </>}
          </TabsContent>

          <TabsContent value="rates" className="space-y-5">
            <section className="page-heading"><div><p className="eyebrow">{rates.effectiveDate ? `В сила от ${fullDate(rates.effectiveDate)}` : "Дата на влизане в сила не е зададена"}</p><h1>Ставки</h1><p>Тези стойности се използват автоматично при изчисляване на клиентите, услугите и почивката.</p></div></section>

            <section className="rates-summary">
              <Card className="rate-summary-card featured"><CardContent className="p-0"><span>Минимално заплащане</span><strong>{money(rates.minimumBusiness, settings.currency)}</strong><small>за товарене, разтоварване или доставка</small></CardContent></Card>
              <Card className="rate-summary-card"><CardContent className="p-0"><span>Почивка за двама</span><strong>{money(rates.restPerDay, settings.currency)}</strong><small>общо за 24 часа · {money(rates.restPerDay / 2, settings.currency)} на шофьор</small></CardContent></Card>
              <Card className="rate-summary-card"><CardContent className="p-0"><span>Допълнителен труд</span><strong>{money(rates.activities.find((item) => item.id === "hourly-loading")?.rate || 0, settings.currency)}</strong><small>на час</small></CardContent></Card>
            </section>

            <div className="rate-vehicle-grid">
              {(["up-to-8-8", "up-to-11-99"] as VehicleClass[]).map((vehicleClass) => <Card className="panel rate-vehicle-card" key={vehicleClass}><CardContent className="panel-content"><div className="rate-card-heading"><span className="settings-icon"><Truck /></span><div><p className="eyebrow">Ставки на километър</p><h2>Камион до {vehicleClass === "up-to-8-8" ? "8,8" : "11,99"} тона</h2></div></div><div className="rate-pair"><div className="field"><Label>Старши шофьор</Label><div className="money-input"><Input type="number" min="0" step="0.01" value={rates.kilometer[vehicleClass].senior || ""} onChange={(event) => setRates((current) => ({ ...current, kilometer: { ...current.kilometer, [vehicleClass]: { ...current.kilometer[vehicleClass], senior: Number(event.target.value) || 0 } } }))} /><span>€/км</span></div></div><div className="field"><Label>Младши шофьор</Label><div className="money-input"><Input type="number" min="0" step="0.01" value={rates.kilometer[vehicleClass].junior || ""} onChange={(event) => setRates((current) => ({ ...current, kilometer: { ...current.kilometer, [vehicleClass]: { ...current.kilometer[vehicleClass], junior: Number(event.target.value) || 0 } } }))} /><span>€/км</span></div></div></div></CardContent></Card>)}
            </div>

            <Card className="panel rates-card"><CardContent className="panel-content"><div className="panel-heading"><div><p className="eyebrow">Отделна ставка</p><h2>Почивка</h2></div><CalendarDays /></div><div className="rates-footer"><div className="field"><Label htmlFor="rest-rate">Ставка за 24 часа — общо за двама</Label><div className="money-input"><Input id="rest-rate" type="number" min="0" step="1" value={rates.restPerDay || ""} onChange={(event) => setRates((current) => ({ ...current, restPerDay: Number(event.target.value) || 0 }))} /><span>€/24 ч.</span></div><p className="field-help">Сумата се разделя поравно: {money(rates.restPerDay / 2, settings.currency)} на шофьор.</p></div></div></CardContent></Card>

            <Card className="panel rates-card"><CardContent className="panel-content"><div className="panel-heading"><div><p className="eyebrow">Одобрени дейности</p><h2>Труд и услуги</h2></div><PackageOpen /></div><div className="rates-list">{rates.activities.map((item) => <div className="rate-row" key={item.id}><div className="rate-row-copy"><strong>{item.label}</strong><small>{item.rate === 0 ? "Въведете одобрената стойност, за да се изчислява автоматично." : item.minimumApplies ? `Минимум ${money(rates.minimumBusiness, settings.currency)} при извършена дейност` : `Изчислява се на ${unitLabel(item.unit)}`}</small></div><div className="money-input rate-input"><Input aria-label={`Ставка за ${item.label}`} type="number" min="0" step="0.01" value={item.rate || ""} onChange={(event) => setRates((current) => ({ ...current, activities: current.activities.map((rate) => rate.id === item.id ? { ...rate, rate: Number(event.target.value) || 0 } : rate) }))} /><span>{item.unit === "linear_m" ? "€ л/м" : `€/${unitLabel(item.unit)}`}</span></div></div>)}</div><div className="rates-footer"><div className="field"><Label htmlFor="minimum-rate">Минимално заплащане</Label><div className="money-input"><Input id="minimum-rate" type="number" min="0" step="1" value={rates.minimumBusiness || ""} onChange={(event) => setRates((current) => ({ ...current, minimumBusiness: Number(event.target.value) || 0 }))} /><span>€</span></div></div><div className="field"><Label htmlFor="rates-date">В сила от</Label><Input id="rates-date" type="date" value={rates.effectiveDate} onChange={(event) => setRates((current) => ({ ...current, effectiveDate: event.target.value }))} /></div></div></CardContent></Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-5">
            <section className="page-heading"><div><p className="eyebrow">Конфигурация</p><h1>Настройки на отчета</h1><p>Основни данни за превозното средство, валутата и шофьорите.</p></div></section>
            <Card className="panel settings-card">
              <CardContent className="panel-content settings-content">
                <div className="settings-section"><div className="settings-icon"><Truck /></div><div className="settings-fields"><h2>Превозно средство</h2><p>Категорията определя ставката на километър за всички командировки.</p><div className="settings-grid"><div className="field"><Label htmlFor="vehicle">Регистрационен номер</Label><Input id="vehicle" value={settings.vehicle} onChange={(event) => setSettings((current) => ({ ...current, vehicle: event.target.value.toUpperCase() }))} /></div><div className="field"><Label>Категория камион</Label><Select value={settings.vehicleClass} onValueChange={(value: VehicleClass) => setSettings((current) => ({ ...current, vehicleClass: value }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="up-to-8-8">До 8,8 тона</SelectItem><SelectItem value="up-to-11-99">До 11,99 тона</SelectItem></SelectContent></Select></div><div className="field report-name-field"><Label htmlFor="report-name">Име на отчета</Label><Input id="report-name" value={settings.company} onChange={(event) => setSettings((current) => ({ ...current, company: event.target.value }))} /></div><div className="field"><Label htmlFor="single-driver-rate">Ставка при един шофьор</Label><div className="money-input"><Input id="single-driver-rate" type="number" min="0" step="0.01" value={settings.singleDriverKilometerRate || ""} onChange={(event) => setSettings((current) => ({ ...current, singleDriverKilometerRate: Number(event.target.value) || 0 }))} /><span>€/км</span></div><p className="field-help">При само един шофьор той получава общата ставка за двама.</p></div></div></div></div>
                <div className="settings-divider" />
                <div className="settings-section"><div className="settings-icon"><WalletCards /></div><div className="settings-fields"><h2>Валута</h2><p>Използва се за всички суми и изчисления в приложението.</p><Select value={settings.currency} onValueChange={(value) => setSettings((current) => ({ ...current, currency: value }))}><SelectTrigger className="currency-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EUR">EUR - Евро</SelectItem><SelectItem value="BGN">BGN - Български лев</SelectItem></SelectContent></Select></div></div>
                <div className="settings-divider" />
                <div className="settings-section danger-section"><div className="settings-icon"><Trash2 /></div><div className="settings-fields"><h2>Изтриване на данни</h2><p>Премахнете всички командировки и свързаните с тях клиенти. Шофьорите, ставките и настройките ще бъдат запазени.</p><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="destructive-outline"><Trash2 /> Изтрий всички командировки и клиенти</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Изтриване на всички командировки и клиенти?</AlertDialogTitle><AlertDialogDescription>Всички командировки и клиенти в този браузър ще бъдат изтрити. Това действие не може да бъде отменено.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отказ</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={clearTripData}>Изтрий всичко</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>
              </CardContent>
            </Card>
            <section className="page-heading settings-team-heading"><div><p className="eyebrow">Екип</p><h2>Шофьори</h2><p>Нивото на шофьора определя правилната ставка за избраната категория камион.</p></div><Button onClick={addDriver}><UserPlus /> Добави шофьор</Button></section>
            <div className="drivers-grid">
              {drivers.map((driver, index) => {
                const total = totals.byDriver.find((item) => item.id === driver.id);
                return (
                  <Card className="panel driver-card" key={driver.id}>
                    <CardContent className="panel-content">
                      <div className="driver-card-head"><span className="driver-avatar large" style={{ backgroundColor: driver.color }}>{driver.name.slice(0, 2).toUpperCase()}</span><div><p className="eyebrow">Шофьор {index + 1}</p><h2>{driver.name}</h2></div>{drivers.length > 1 && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="driver-remove" aria-label={`Премахни ${driver.name}`}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Премахване на {driver.name}</AlertDialogTitle><AlertDialogDescription>Шофьорът ще бъде премахнат и от свързаните записи. Историческите суми ще бъдат преизчислени.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отказ</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => removeDriver(driver.id)}>Премахни</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>
                      <div className="driver-edit-grid"><div className="field"><Label htmlFor={`name-${driver.id}`}>Име / инициали</Label><Input id={`name-${driver.id}`} value={driver.name} onChange={(event) => setDrivers((current) => current.map((item) => item.id === driver.id ? { ...item, name: event.target.value } : item))} /></div><div className="field"><Label>Ниво</Label><Select value={driver.level} onValueChange={(value: DriverLevel) => setDrivers((current) => current.map((item) => item.id === driver.id ? { ...item, level: value } : item))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="senior">Старши шофьор</SelectItem><SelectItem value="junior">Младши шофьор</SelectItem></SelectContent></Select></div></div>
                      <div className="driver-rate-note"><Calculator />{drivers.length === 1 ? <span>Един шофьор: <b>{money(settings.singleDriverKilometerRate, settings.currency)}/км</b></span> : <><span>До 8,8 т: <b>{money(rates.kilometer["up-to-8-8"][driver.level], settings.currency)}/км</b></span><span>До 11,99 т: <b>{money(rates.kilometer["up-to-11-99"][driver.level], settings.currency)}/км</b></span></>}</div>
                      <div className="driver-summary"><div><span>Километри</span><strong>{number(totals.kilometers)} км</strong></div><div><span>От километри</span><strong>{money(total?.kmTotal || 0, settings.currency)}</strong></div><div className="accent-total"><span>Общо за изплащане</span><strong>{money(total?.total || 0, settings.currency)}</strong></div></div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
          </>}
        </div>
      </Tabs>
      <Toaster richColors position="top-right" />
    </main>
  );
}
