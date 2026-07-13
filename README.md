# 🚀 Sistema Fiscal IA + Abbax — ERP Completo

ERP fiscal mexicano con 24 módulos, asistente IA por voz (Abbax), RAG con 9 leyes fiscales, y deploy listo para Vercel.

## 📦 Stack
- Next.js 16 + Tailwind CSS + shadcn/ui
- Prisma ORM (SQLite en dev, PostgreSQL en Vercel)
- GLM-4.6 vía z-ai-web-dev-sdk (23 tools)
- ElevenLabs (voz Stark) + Web Speech API fallback
- RAG con 9 leyes fiscales (3,301 artículos)

## 🛠️ Setup local

```bash
bun install
cp .env.example .env
# Edita .env con tu DATABASE_URL y ZAI_API_KEY

# SQLite para desarrollo local:
# En prisma/schema.prisma, asegúrate de que provider = "sqlite"
# DATABASE_URL="file:./db/custom.db"

bun run db:push
bun run db:seed
bun run dev
```

## ☁️ Deploy en Vercel

### 1. Subir a GitHub
```bash
git init
git add .
git commit -m "Sistema Fiscal IA + Abbax"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/sistema-fiscal-ia.git
git push -u origin main
```

### 2. Crear BD PostgreSQL en Neon
1. Ve a https://neon.tech → crea cuenta gratis
2. Crea un proyecto → copia la `DATABASE_URL`

### 3. Cambiar Prisma a PostgreSQL
En `prisma/schema.prisma`, cambia:
```prisma
datasource db {
  provider = "postgresql"  # ← cambiar de "sqlite"
  url      = env("DATABASE_URL")
}
```
Haz commit y push.

### 4. Importar en Vercel
1. https://vercel.com → New Project → importa tu repo
2. Environment Variables:
   - `DATABASE_URL` → string de Neon
   - `ZAI_API_KEY` → tu API key de Z.AI
   - `ELEVENLABS_API_KEY` → (opcional) tu key de ElevenLabs
3. Deploy

### 5. Inicializar BD en producción
```bash
npm i -g vercel
vercel login
vercel link
vercel env pull .env.production
npx prisma db push
bun run scripts/seed-completo.ts
```

### 6. Login
- `admin@hernandez.mx` / `admin123`

## 📊 Módulos (24)
Dashboard, Empresas, Clientes, Proveedores, Empleados, Facturación CFDI, Nómina, Compras, Inventario, Bancos, Contabilidad, SAT, IA Fiscal, Auditoría Fiscal (RAG), IMSS, INFONAVIT, Tributario, DIOT, INEGI, Finanzas, CRM, Reportes, Balance General, Abbax, Admin

## ⚡ Abbax — Asistente IA Stark
- 23 tools activas
- Voz con ElevenLabs (grave tipo Tony Stark)
- RAG con 9 leyes fiscales mexicanas
- Personalidad sarcástica pero precisa

<!-- Build: Mon Jul 13 05:15:12 UTC 2026 -->
