import { redirect } from "next/navigation";

import LedgerApp from "@/components/ledger-app";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) redirect("/login");

  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  return <LedgerApp userEmail={email} />;
}
