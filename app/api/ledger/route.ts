import { NextResponse, type NextRequest } from "next/server";

import { ledgerSaveSchema } from "@/lib/ledger-schema";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...noStoreHeaders, ...headers } });
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;
  return { supabase, subject: typeof subject === "string" ? subject : null, error };
}

export async function GET() {
  const { supabase, subject, error: authError } = await authenticatedClient();
  if (authError || !subject) return json({ error: "Необходим е вход." }, 401);

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", subject)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) {
    return json({ error: "Профилът няма достъп до организация." }, 403);
  }

  const { data: state, error } = await supabase
    .from("ledger_states")
    .select("document, revision, updated_at")
    .eq("organization_id", membership.organization_id)
    .single();

  if (error || !state) return json({ error: "Данните не могат да бъдат заредени." }, 500);

  return json({
    document: state.document,
    revision: Number(state.revision),
    updatedAt: state.updated_at,
    role: membership.role,
  });
}

export async function PUT(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== request.nextUrl.origin) {
    return json({ error: "Невалиден произход на заявката." }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_100_000) return json({ error: "Данните са твърде големи." }, 413);

  const { supabase, subject, error: authError } = await authenticatedClient();
  if (authError || !subject) return json({ error: "Необходим е вход." }, 401);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Невалиден формат на данните." }, 400);
  }

  const parsed = ledgerSaveSchema.safeParse(input);
  if (!parsed.success) return json({ error: "Данните не преминаха проверката." }, 422);

  const { data, error } = await supabase.rpc("save_ledger_state", {
    new_document: parsed.data.document,
    expected_revision: parsed.data.expectedRevision,
  });

  if (error) {
    if (error.message.includes("rate_limit_exceeded")) {
      return json({ error: "Твърде много промени. Опитайте отново след минута." }, 429, { "Retry-After": "60" });
    }
    if (error.message.includes("revision_conflict")) {
      return json({ error: "Данните са променени от друго устройство." }, 409);
    }
    if (error.message.includes("insufficient_permissions")) {
      return json({ error: "Нямате право да редактирате данните." }, 403);
    }
    return json({ error: "Промените не могат да бъдат записани." }, 500);
  }

  return json({ revision: Number(data) });
}
