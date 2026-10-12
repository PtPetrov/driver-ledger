"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { LedgerSync, SyncHttpError, type RemoteLedger, type SyncDocument, type SyncView } from "@/lib/ledger-sync";

export function useLedgerSync<D extends SyncDocument, F>({ document: localDocument, formDraft, editing, apply, restoreForm, normalize, onUnauthorized }: {
  document: D; formDraft: F; editing: boolean;
  apply: (document: D) => void; restoreForm: (draft: F) => void;
  normalize: (document: D) => D; onUnauthorized: () => void;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<SyncView>({ status: "loading", message: "", conflicts: [], remotePending: false });
  const [live, setLive] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const controller = useRef<LedgerSync<D> | null>(null);
  const callbacks = useRef({ apply, restoreForm, normalize, onUnauthorized });
  const draftRef = useRef({ formDraft, editing });
  const storageKey = useRef("");
  const saveSession = useCallback((key: string, value: unknown) => {
    try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); }
    catch { setStorageError(true); }
  }, []);

  useLayoutEffect(() => {
    callbacks.current = { apply, restoreForm, normalize, onUnauthorized };
  }, [apply, restoreForm, normalize, onUnauthorized]);

  useLayoutEffect(() => {
    draftRef.current = { formDraft, editing };
    if (hydrated) {
      controller.current?.change(localDocument, editing);
      const sync = controller.current;
      saveSession(`${storageKey.current}:form`, editing ? { form: formDraft, base: sync?.base, local: sync?.local, revision: sync?.revision } : null);
    }
  }, [localDocument, formDraft, editing, hydrated, saveSession]);

  useEffect(() => {
    let active = true;
    let disconnect = () => {};
    let initialRetry: ReturnType<typeof setTimeout> | undefined;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    let liveConnected = false;
    const readJson = async (response: Response) => {
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) throw new SyncHttpError(typeof body?.error === "string" ? body.error : "Връзката със сървъра е прекъсната.", response.status, Number(response.headers.get("Retry-After") || 0) * 1000);
      return body;
    };
    const load = async (): Promise<RemoteLedger<D>> => {
      const result = await readJson(await fetch("/api/ledger", { cache: "no-store", signal: AbortSignal.timeout(15000) }));
      if (!result || !Number.isSafeInteger(result.revision) || !result.organizationId || !result.userId) throw new SyncHttpError("Обновете приложението, за да заредите актуалната версия.", 426);
      return { revision: result.revision as number, organizationId: String(result.organizationId), userId: String(result.userId), document: callbacks.current.normalize(result.document as D) };
    };
    const sync = new LedgerSync<D>({
      load,
      save: async (document, expectedRevision) => {
        const result = await readJson(await fetch("/api/ledger", {
          method: "PUT", headers: { "Content-Type": "application/json", "X-Ledger-Organization": sync.organizationId, "X-Ledger-User": sync.userId },
          body: JSON.stringify({ document, expectedRevision }), signal: AbortSignal.timeout(15000),
        }));
        if (!Number.isSafeInteger(result?.revision)) throw new Error("Сървърът не потвърди записа.");
        return result!.revision as number;
      },
      apply: document => { if (active) callbacks.current.apply(document); },
      publish: next => { if (active) setView(next); },
      persist: draft => { if (active && storageKey.current) saveSession(storageKey.current, draft); },
      saved: () => { if (active) toast.success("Промените са запазени.", { id: "ledger-sync", duration: 1800 }); },
      unauthorized: () => { if (active) callbacks.current.onUnauthorized(); },
    });
    controller.current = sync;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      // Mobile browsers can suspend a tab and miss its online/offline events.
      if (!navigator.onLine) { sync.setOnline(false); return; }
      if (!sync.online) sync.setOnline(true);
      else void sync.refresh();
    };
    const connect = (organizationId: string) => {
      try {
        const supabase = createClient();
        const channel = supabase.channel(`ledger:${organizationId}`, { config: { private: true } });
        channel.on("broadcast", { event: "ledger_changed" }, ({ payload }) => {
          if (!Number.isSafeInteger(payload?.revision) || payload.revision <= sync.revision) return;
          clearTimeout(eventTimer);
          eventTimer = setTimeout(refresh, 150);
        });
        // The SSR browser client keeps Realtime's JWT in step with Auth refreshes.
        void supabase.realtime.setAuth().then(() => {
          if (!active) return;
          channel.subscribe(status => {
            if (!active) return;
            liveConnected = status === "SUBSCRIBED";
            setLive(liveConnected);
            if (liveConnected) refresh(); // closes initial subscribe/load and reconnect gaps
          });
        }).catch(() => { if (active) setLive(false); });
        disconnect = () => { void supabase.removeChannel(channel); };
      } catch { if (active) setLive(false); }
    };
    let initialAttempts = 0;
    const start = async () => {
      try {
        const remote = await load();
        if (!active) return;
        storageKey.current = `driver-ledger-draft:${remote.userId}:${remote.organizationId}`;
        let draft: { base: D; local: D; revision: number } | undefined;
        let form: F | undefined;
        try {
          const raw = sessionStorage.getItem(storageKey.current);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.base?.version === remote.document.version && saved.local?.version === remote.document.version && Number.isSafeInteger(saved.revision) && saved.revision <= remote.revision) {
              draft = { base: callbacks.current.normalize(saved.base), local: callbacks.current.normalize(saved.local), revision: saved.revision };
            }
          }
          const rawForm = sessionStorage.getItem(`${storageKey.current}:form`);
          if (rawForm) {
            const saved = JSON.parse(rawForm);
            if (saved.form && saved.base?.version === remote.document.version && Number.isSafeInteger(saved.revision) && saved.revision <= remote.revision) {
              form = saved.form;
              // The form must retain its original base, not silently overwrite a newer record.
              draft = draft ?? { base: callbacks.current.normalize(saved.base), local: callbacks.current.normalize(saved.local ?? saved.base), revision: saved.revision };
            }
          }
        } catch { setStorageError(true); }
        sync.editing = !!form;
        sync.initialize(remote, draft);
        if (form) callbacks.current.restoreForm(form);
        setHydrated(true);
        if (draft || form) toast.info("Незапазената чернова е възстановена.");
        sync.online = navigator.onLine;
        connect(remote.organizationId);
      } catch (error) {
        if (!active) return;
        setView({ status: "error", message: error instanceof Error ? error.message : "Данните не могат да бъдат заредени.", conflicts: [], remotePending: false });
        if (error instanceof SyncHttpError && error.status === 401) callbacks.current.onUnauthorized();
        else if (!(error instanceof SyncHttpError) || error.status === 429 || error.status >= 500) {
          initialRetry = setTimeout(() => void start(), Math.min(60000, 1000 * 2 ** Math.min(initialAttempts++, 6)));
        }
      }
    };
    void start();
    const online = () => { sync.setOnline(true); };
    const offline = () => { sync.setOnline(false); setLive(false); liveConnected = false; };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (sync.dirty || draftRef.current.editing) { event.preventDefault(); event.returnValue = ""; }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeunload", beforeUnload);
    // Low-frequency safety net only when live delivery is unavailable, never hidden/offline.
    const fallback = setInterval(() => { if (!liveConnected && navigator.onLine) refresh(); }, 60000);
    return () => {
      active = false; sync.stop(); disconnect();
      clearInterval(fallback); clearTimeout(initialRetry); clearTimeout(eventTimer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [saveSession]);

  const resolve = (prefer: "local" | "remote") => {
    const sync = controller.current;
    if (!sync) return;
    // Keep both versions recoverable for this browser tab even after explicit resolution.
    saveSession(`${storageKey.current}:recovery`, { base: sync.base, local: sync.local, remote: sync.remote, form: draftRef.current.formDraft });
    sync.resolve(prefer);
  };
  const downloadDraft = () => {
    const sync = controller.current;
    if (!sync) return;
    const blob = new Blob([JSON.stringify({ base: sync.base, local: sync.local, remote: sync.remote, form: draftRef.current.formDraft }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "driver-ledger-draft.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canLeave = () => !controller.current?.dirty && !draftRef.current.editing && !controller.current?.busy;
  const clearDraft = () => {
    if (!storageKey.current) return;
    for (const suffix of ["", ":form", ":recovery"]) saveSession(`${storageKey.current}${suffix}`, null);
  };
  return { hydrated, view, live, storageError, resolve, downloadDraft, canLeave, clearDraft, retry: () => void controller.current?.refresh().then(() => controller.current?.flush()) };
}
