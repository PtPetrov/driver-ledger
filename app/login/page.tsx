"use client";

import { FormEvent, useState } from "react";
import { CircleGauge, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "signin" | "signup";

const AUTH_TOAST_ID = "authentication";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setSuccess(false);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const fullName = String(form.get("fullName") || "").trim();
    const supabase = createClient();

    toast.loading(mode === "signin" ? "Влизане в профила…" : "Създаване на профила…", {
      id: AUTH_TOAST_ID,
    });

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Успешен вход.", { id: AUTH_TOAST_ID });
        router.replace("/");
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: { full_name: fullName },
        },
      });
      if (error) throw error;

      if (data.session) {
        toast.success("Профилът е създаден.", { id: AUTH_TOAST_ID });
        router.replace("/");
        router.refresh();
        return;
      }

      setSuccess(true);
      setMessage("Проверете имейла си и потвърдете регистрацията.");
      toast.success("Изпратихме имейл за потвърждение.", { id: AUTH_TOAST_ID });
    } catch (error) {
      const text = error instanceof Error ? error.message.toLocaleLowerCase() : "";
      let errorMessage: string;
      if (text.includes("invalid login credentials")) {
        errorMessage = "Невалиден имейл или парола.";
      } else if (text.includes("already registered")) {
        errorMessage = "Вече има профил с този имейл.";
      } else if (text.includes("password")) {
        errorMessage = "Паролата трябва да е поне 8 знака.";
      } else {
        errorMessage = "Заявката не може да бъде изпълнена. Опитайте отново.";
      }
      setMessage(errorMessage);
      toast.error(errorMessage, { id: AUTH_TOAST_ID });
    } finally {
      setPending(false);
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setMessage("");
    setSuccess(false);
  };

  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <div className="auth-brand"><span><CircleGauge /></span><strong>Driver Ledger</strong></div>
        <div>
          <p className="eyebrow">Сигурен финансов отчет</p>
          <h1>Командировки, клиенти и ставки на едно място.</h1>
          <p>Данните се синхронизират между устройствата и са защитени за вашата организация.</p>
        </div>
      </section>

      <Card className="auth-card">
        <CardContent className="auth-card-content">
          <div className="auth-tabs" role="tablist" aria-label="Достъп до профила">
            <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => switchMode("signin")}>Вход</button>
            <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => switchMode("signup")}>Регистрация</button>
          </div>

          <div className="auth-copy">
            <h2>{mode === "signin" ? "Добре дошли" : "Създайте профил"}</h2>
            <p>{mode === "signin" ? "Влезте, за да отворите вашия отчет." : "Ще създадем защитено работно пространство за вас."}</p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === "signup" && <div className="field"><Label htmlFor="full-name">Име</Label><div className="auth-input"><UserRound /><Input id="full-name" name="fullName" autoComplete="name" required /></div><p className="field-help">Името се използва за вашия профил.</p></div>}
            <div className="field"><Label htmlFor="email">Имейл</Label><div className="auth-input"><Mail /><Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required /></div></div>
            <div className="field"><Label htmlFor="password">Парола</Label><div className="auth-input"><LockKeyhole /><Input id="password" name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required /></div>{mode === "signup" && <p className="field-help">Минимум 8 знака.</p>}</div>
            {message && <p className={success ? "auth-message success" : "auth-message"} role="status">{message}</p>}
            <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle className="auth-spinner" />}{mode === "signin" ? "Вход" : "Създай профил"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
