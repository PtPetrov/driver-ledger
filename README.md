# Driver Ledger

Защитено приложение за командировки, клиенти, ставки и възнаграждения на шофьори.

## Технологии

- Next.js 16, React 19, TypeScript и Tailwind CSS 4
- Supabase Auth и Postgres с Row Level Security
- Zod валидация на всички записвани документи
- Vercel за production hosting

## Локално стартиране

1. Инсталирайте зависимостите с `pnpm install`.
2. Създайте `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

3. Приложете миграциите от `supabase/migrations` по ред.
4. Стартирайте `pnpm dev`.

## Проверки

```bash
pnpm lint
pnpm build
```

Приложението не използва service-role ключ. Достъпът се контролира с Supabase Auth, RLS политики, роли в организацията, проверка на произхода на записващите заявки, оптимистично заключване и database rate limiting.
