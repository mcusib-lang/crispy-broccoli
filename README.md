# AMRAP · App de entrenamiento adaptativo

PWA estática (sin build) lista para desplegar en Vercel, con sincronización opcional en Supabase.

## Estructura

- `index.html` — punto de entrada. Splash + router: si hay perfil → `hub.html`, si no → `onboarding.html`.
- `onboarding.html` — configuración inicial (perfil, objetivos, nivel, días, material, lesiones, cardio).
- `hub.html` — pantalla principal con pestañas: Hoy · Calendario · Cardio · Progreso · Cuenta.
- `sesion.dc.html` — sesión AMRAP (calentar → AMRAP → enfriar → RPE → medidas).
- `biblioteca.html` — 108 ejercicios con fichas de técnica. Usa `exercises-data.js` e `image-slot.js`.
- `config.js` — configuración de Supabase (vacío = sincronización desactivada).
- `supabase-sync.js` — capa de sincronización en la nube.
- `sw.js`, `manifest.webmanifest`, `icon-*.png` — PWA instalable y offline.

Los datos del usuario se guardan en `localStorage` bajo la clave `amrap_fn`. Si Supabase está configurado y el usuario inicia sesión, se sincronizan en la nube.

## Desplegar en Vercel

1. Sube esta carpeta a un repositorio de GitHub (todos los archivos en la raíz).
2. En Vercel: **New Project → importa el repo**. Framework preset: **Other** (sin build). Deploy.
3. Vercel sirve `index.html` con HTTPS — necesario para instalar la PWA.

Mantén todos los archivos en la misma carpeta: los enlaces son relativos.

## Activar cuentas y sincronización (Supabase)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **Project Settings → API** copia la **Project URL** y la **anon public key**, y pégalas en `config.js`:

   ```js
   window.AMRAP_CONFIG = {
     SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
     SUPABASE_ANON_KEY: 'TU-ANON-KEY'
   };
   ```

3. En **Authentication → Providers** deja activado **Email** (enlace mágico / OTP).
   En **Authentication → URL Configuration** añade la URL de tu app de Vercel a *Redirect URLs*.
4. En el **SQL Editor** ejecuta este esquema:

   ```sql
   create table if not exists public.perfiles (
     user_id uuid primary key references auth.users (id) on delete cascade,
     data jsonb not null default '{}'::jsonb,
     updated_at timestamptz not null default now()
   );

   alter table public.perfiles enable row level security;

   create policy "el usuario ve su fila"
     on public.perfiles for select using (auth.uid() = user_id);
   create policy "el usuario inserta su fila"
     on public.perfiles for insert with check (auth.uid() = user_id);
   create policy "el usuario actualiza su fila"
     on public.perfiles for update using (auth.uid() = user_id);
   ```

Con eso, en la app: **avatar (arriba a la derecha) → Cuenta → Iniciar sesión** con email.
El progreso se guarda en la nube y se fusiona entre dispositivos (historial, cardio, medidas y cargas).

Si `config.js` queda vacío, la app funciona igual pero solo en local.
