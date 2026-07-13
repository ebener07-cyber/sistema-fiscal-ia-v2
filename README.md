# 🚀 Sistema Fiscal IA + Abbax — ERP Completo

ERP fiscal mexicano con **24 módulos**, asistente IA por voz (**Abbax** — personalidad Tony Stark), **RAG con 9 leyes fiscales** (3,301 artículos, 5.4M caracteres), y deploy listo para Vercel.

## 📦 Stack
- **Next.js 16** (App Router, Turbopack) + TypeScript + Tailwind CSS + shadcn/ui
- **Prisma ORM** (SQLite en dev, PostgreSQL en Vercel/Neon)
- **GLM-4.6** vía `z-ai-web-dev-sdk` (23 tools para Abbax)
- **ElevenLabs** (voz grave tipo Tony Stark) + Web Speech API fallback
- **RAG fiscal**: 9 leyes federales mexicanas indexadas en `skills/auditoria-fiscal/laws/`
- **proxy.ts** (reemplazo de middleware en Next.js 16) — protege APIs con cookie httpOnly

## 🛠️ Setup local

```bash
bun install
cp .env.example .env
# Edita .env con tu DATABASE_URL y ZAI_API_KEY

# SQLite para desarrollo local:
# En prisma/schema.prisma, cambia provider a "sqlite"
# DATABASE_URL="file:./db/custom.db"

bun run db:push
bun run scripts/seed-completo.ts
bun run dev
```

Abre http://localhost:3000 → te redirige a `/login`.

**Credenciales demo:**
- `admin@hernandez.mx` / `admin123` (rol admin)
- `maria@hernandez.mx` / `maria123` (rol usuario, limitada a su empresa)

## ☁️ Deploy en Vercel

### 1. Subir a GitHub
```bash
git init
git add .
git commit -m "Sistema Fiscal IA + Abbax v2.2"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/sistema-fiscal-ia.git
git push -u origin main
```

### 2. Crear BD PostgreSQL en Neon
1. Ve a https://neon.tech → crea cuenta gratis
2. Crea un proyecto → copia la `DATABASE_URL` (formato `postgresql://...`)

### 3. Importar en Vercel
1. https://vercel.com → New Project → importa tu repo
2. **Environment Variables** (Settings → Environment Variables):
   - `DATABASE_URL` → string de Neon
   - `ZAI_API_KEY` → tu API key de Z.AI (https://z.ai)
   - `ZAI_BASE_URL` → `https://api.z.ai/v1`
   - `ELEVENLABS_API_KEY` → (opcional) tu key de ElevenLabs
   - `ELEVENLABS_VOICE_ID` → (opcional) ID de voz Stark
3. **Build Command** (auto-detectado desde vercel.json): `prisma generate && next build`
4. Deploy

### 4. Inicializar BD en producción
```bash
npm i -g vercel
vercel login
vercel link
vercel env pull .env.production
npx prisma db push
bun run scripts/seed-completo.ts
```

### 5. Login
- `admin@hernandez.mx` / `admin123`
- Accede a `/admin` para gestionar usuarios

## 📊 Módulos (24)
Dashboard, Empresas, Clientes, Proveedores, Empleados, Facturación CFDI, Nómina, Compras, Inventario, Bancos, Contabilidad, SAT, IA Fiscal, Auditoría Fiscal (RAG), IMSS, INFONAVIT, Tributario, DIOT, INEGI, Finanzas, CRM, Reportes, Balance General, Abbax, Admin

## ⚡ Abbax — Asistente IA Stark
- **23 tools** activas (consultar facturas, crear notas, generar reportes, etc.)
- Voz con ElevenLabs (grave tipo Tony Stark) + Web Speech API fallback
- **RAG con 9 leyes fiscales**: LISR, LIVA, CFF, LFT, LSS, LINFONAVIT, LFPDPPP, LGA, DOF
- Personalidad sarcástica pero precisa, siempre cita el artículo exacto

## 🛡️ Seguridad
- **proxy.ts** valida cookie `token` (httpOnly) en TODAS las rutas `/api/*` excepto `/api/auth/*`
- Contraseñas hasheadas con base64 (mejorar con bcrypt en producción real)
- Tokens JWT de 7 días con expiración verificada
- Rutas de admin verifican `rol === 'admin'` en cada request
- Eliminación en cascada de empresas con transacción Prisma

## 🎯 Skills fiscal (RAG)
Los archivos en `skills/auditoria-fiscal/laws/*.lite.json` están **incluidos en el repo** (ver `.gitignore`). Estos contienen los artículos extraídos de cada ley, indexados para búsqueda por keywords. El endpoint `/api/auditoria-fiscal` los carga dinámicamente en runtime.

<!-- Build: Tue Jul 14 2026 -->

