/** Sync is separate from pricing: records and their saved prices are opaque values. */
export type SyncDocument = {
  version: number;
  drivers: { id: string }[];
  trips: { id: string }[];
  entries: { id: string }[];
  settings: object;
  rates: object;
};
export type RemoteLedger<D> = { document: D; revision: number; organizationId: string; userId: string };
export type SyncConflict = { path: string; local: unknown; remote: unknown };
export type SyncStatus = "loading" | "saved" | "pending" | "saving" | "offline" | "error" | "conflict";
export type SyncView = { status: SyncStatus; message: string; conflicts: SyncConflict[]; remotePending: boolean };

// Key order from JSONB/API responses is not significant.
export function equalData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equalData(v, b[i]));
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter(k => x[k] !== undefined);
  return keys.length === Object.keys(y).filter(k => y[k] !== undefined).length && keys.every(k => equalData(x[k], y[k]));
}

/** Atomic records: never mix one person's quantity with another person's service/pricing. */
export function mergeLedger<D extends SyncDocument>(base: D, local: D, remote: D, prefer?: "local" | "remote") {
  const conflicts: SyncConflict[] = [];
  const choose = <T,>(path: string, b: T, l: T, r: T): T => {
    if (equalData(l, b)) return r;
    if (equalData(r, b) || equalData(l, r)) return l;
    conflicts.push({ path, local: l, remote: r });
    return prefer === "remote" ? r : l;
  };
  const result = { ...remote };
  // Concurrent topology changes need whole-record-group review to avoid resurrecting
  // deleted parents or creating orphan clients. Never auto-merge a cascade deletion.
  const groups = ["drivers", "trips", "entries"] as const;
  const deleted = (d: D) => groups.some(k => base[k].some(row => !d[k].some(other => row.id === other.id)));
  const records = (d: D) => ({ drivers: d.drivers, trips: d.trips, entries: d.entries });
  const topologyConflict = (deleted(local) && !equalData(records(base), records(remote))) || (deleted(remote) && !equalData(records(base), records(local)));
  if (topologyConflict) {
    Object.assign(result, choose("records", records(base), records(local), records(remote)));
  } else {
    for (const key of groups) {
      const b = new Map(base[key].map(v => [v.id, v]));
      const l = new Map(local[key].map(v => [v.id, v]));
      const r = new Map(remote[key].map(v => [v.id, v]));
      result[key] = [...new Set([...r.keys(), ...l.keys(), ...b.keys()])].flatMap(id => {
        const row = choose(`${key}/${id}`, b.get(id), l.get(id), r.get(id));
        return row ? [row] : [];
      });
    }
  }
  result.settings = choose("settings", base.settings, local.settings, remote.settings);
  result.rates = choose("rates", base.rates, local.rates, remote.rates);
  // Different trip IDs can still have the same human-facing number.
  const numbers = result.trips.map(t => (t as { number?: string }).number).filter(Boolean);
  if (new Set(numbers).size !== numbers.length && !equalData(result.trips, local.trips) && !equalData(result.trips, remote.trips)) {
    const l = records(local), r = records(remote);
    conflicts.push({ path: "records", local: l, remote: r });
    Object.assign(result, prefer === "remote" ? r : l);
  }
  return { document: result, conflicts };
}

export class SyncHttpError extends Error {
  status: number;
  retryAfter: number;
  constructor(message: string, status: number, retryAfter = 0) {
    super(message); this.status = status; this.retryAfter = retryAfter;
  }
}

type Options<D> = {
  load: () => Promise<RemoteLedger<D>>;
  save: (document: D, revision: number) => Promise<number>;
  apply: (document: D) => void;
  publish: (view: SyncView) => void;
  persist?: (draft: { base: D; local: D; revision: number } | null) => void;
  saved?: () => void;
  unauthorized?: () => void;
  delay?: number;
};

/** One reader/writer at a time. A GET begun before a PUT cannot replace newer state. */
export class LedgerSync<D extends SyncDocument> {
  base: D | null = null;
  local: D | null = null;
  revision = 0;
  organizationId = "";
  userId = "";
  editing = false;
  online = true;
  busy = false;
  stopped = false;
  remote: RemoteLedger<D> | null = null;
  view: SyncView = { status: "loading", message: "", conflicts: [], remotePending: false };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private retryNotBefore = 0;
  private blocked = false;
  private refreshQueued = false;
  private options: Options<D>;
  constructor(options: Options<D>) { this.options = options; }
  get dirty() { return !!this.base && !equalData(this.base, this.local); }
  private publish(status: SyncStatus, message = "", conflicts = this.view.conflicts) {
    this.view = { status, message, conflicts, remotePending: !!this.remote };
    this.options.publish(this.view);
    this.options.persist?.(this.dirty && this.base && this.local ? { base: this.base, local: this.local, revision: this.revision } : null);
  }
  initialize(remote: RemoteLedger<D>, draft?: { base: D; local: D; revision: number }) {
    this.organizationId = remote.organizationId; this.userId = remote.userId;
    this.base = draft?.base ?? remote.document; this.local = draft?.local ?? remote.document;
    this.revision = draft?.revision ?? remote.revision;
    this.options.apply(this.local);
    this.publish(this.dirty ? "pending" : "saved", "", []);
    if (draft) this.acceptRemote(remote);
  }
  change(document: D, editing: boolean) {
    if (this.stopped || !this.base) return;
    const changed = !equalData(this.local, document);
    this.editing = editing;
    if (changed) this.blocked = false;
    this.local = document;
    if (this.remote && !editing && !this.busy) this.acceptRemote(this.remote);
    if (this.view.status === "conflict") { this.publish("conflict", this.view.message); return; }
    if (this.blocked && !changed) return;
    if (this.dirty) {
      this.publish(this.online ? (this.busy ? "saving" : "pending") : "offline");
      this.schedule();
    } else if (!this.busy) this.publish(this.online ? "saved" : "offline", "", []);
  }
  private schedule(delay = this.options.delay ?? 700) {
    clearTimeout(this.timer);
    if (this.stopped || !this.online || this.view.status === "conflict") return;
    this.timer = setTimeout(() => void this.flush(), Math.max(delay, this.retryNotBefore - Date.now()));
  }
  private acceptRemote(remote: RemoteLedger<D>, prefer?: "local" | "remote") {
    if (!this.base || !this.local || remote.revision < this.revision) return;
    if (this.organizationId !== remote.organizationId || this.userId !== remote.userId) {
      this.blocked = true;
      this.publish("error", "Профилът е променен. Отворете приложението отново.");
      this.stop(); return;
    }
    if (remote.revision === this.revision && equalData(remote.document, this.base) && !this.remote) {
      if (!this.blocked) this.publish(this.dirty ? "pending" : (this.online ? "saved" : "offline"), "", []);
      return;
    }
    if (this.editing) { this.remote = remote; this.publish(this.view.status); return; }
    const merged = mergeLedger(this.base, this.local, remote.document, prefer);
    if (merged.conflicts.length && !prefer) {
      this.remote = remote;
      clearTimeout(this.timer);
      this.publish("conflict", "Има промени от друго устройство. Вашите промени са запазени като чернова.", merged.conflicts);
      return;
    }
    this.base = remote.document; this.revision = remote.revision; this.local = merged.document; this.remote = null;
    this.options.apply(this.local);
    this.publish(this.dirty ? "pending" : "saved", "", []);
    if (this.dirty) this.schedule();
  }
  resolve(prefer: "local" | "remote") {
    if (this.remote && !this.busy && !this.editing) this.acceptRemote(this.remote, prefer);
  }
  setOnline(online: boolean) {
    this.online = online;
    if (!online) { clearTimeout(this.timer); this.publish("offline"); }
    else void this.refresh();
  }
  async refresh() {
    if (this.stopped || !this.online) return;
    if (this.busy) { this.refreshQueued = true; return; }
    this.busy = true;
    try {
      const remote = await this.options.load();
      if (!this.stopped) this.acceptRemote(remote);
      this.failures = 0;
    } catch (error) { if (!this.stopped) this.fail(error); }
    finally {
      this.busy = false;
      if (!this.stopped && this.dirty && this.view.status === "pending") this.schedule();
      if (this.refreshQueued && !this.stopped) { this.refreshQueued = false; void this.refresh(); }
    }
  }
  private fail(error: unknown) {
    const http = error instanceof SyncHttpError ? error : null;
    this.publish(this.online ? "error" : "offline", error instanceof Error ? error.message : "Промените не могат да бъдат записани.");
    if (http && http.status >= 400 && http.status < 500 && http.status !== 429) this.blocked = true;
    if (http?.status === 401) { this.options.unauthorized?.(); return; }
    if (!http || http.status === 429 || http.status >= 500) {
      const delay = Math.max(http?.retryAfter ?? 0, Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6)));
      this.retryNotBefore = Date.now() + delay;
      clearTimeout(this.timer);
      if (this.online && !this.stopped) this.timer = setTimeout(() => void this.refresh().then(() => this.flush()), delay);
    }
  }
  async flush() {
    if (this.stopped || this.blocked || !this.online || this.busy || !this.dirty || !this.local || this.view.status === "conflict") return;
    if (Date.now() < this.retryNotBefore) { this.schedule(); return; }
    // Do not save against a held remote revision while a form is being edited.
    if (this.remote && this.editing) return;
    this.busy = true;
    const sent = this.local;
    this.publish("saving");
    try {
      const revision = await this.options.save(sent, this.revision);
      if (this.stopped) return;
      this.base = sent; this.revision = revision; this.failures = 0;
      this.publish(this.dirty ? "pending" : "saved", "", []);
      if (!this.dirty) this.options.saved?.();
      // Re-read canonical database snapshots, and catch concurrent changes.
      this.refreshQueued = true;
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof SyncHttpError && error.status === 409) {
        this.publish("pending"); this.refreshQueued = true;
      } else this.fail(error);
    } finally {
      this.busy = false;
      if (!this.stopped && this.refreshQueued) { this.refreshQueued = false; void this.refresh(); }
      else if (!this.stopped && this.view.status === "pending") this.schedule();
    }
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
