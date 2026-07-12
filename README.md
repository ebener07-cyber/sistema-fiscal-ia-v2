# 🚀 Sistema Fiscal IA + Abbax — Guía de Deploy en Vercel

ERP fiscal completo con 20 módulos + asistente IA por voz (Abbax) con personalidad Tony Stark.

## 📦 Stack

- **Frontend**: Next.js 16 + Tailwind CSS + shadcn/ui
- **Backend**: API Routes Next.js
- **BD**: Prisma ORM (SQLite en dev, PostgreSQL en prod)
- **IA**: GLM-4.6 vía z-ai-web-dev-sdk (22 tools)
- **Voz**: ElevenLabs (grave Stark) + Web Speech API fallback

## 🛠️ Setup local

```bash
# 1. Instalar dependencias
bun install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env y agrega tu ZAI_API_KEY

# 3. Crear base de datos
bun run db:push

# 4. Cargar datos de ejemplo
bun run db:seed

# 5. Iniciar servidor
bun run dev
```

Abre http://localhost:3000

## ☁️ Deploy en Vercel (5 pasos)

### 1. Subir a GitHub
```bash
git init
git add .
git commit -m "Sistema Fiscal IA + Abbax"
git branch -M main
git remote add origin https://github.com/tu-usuario/sistema-fiscal-ia.git
git push -u origin main
```

### 2. Crear base de datos PostgreSQL

Recomendado: **Neon** (gratis, serverless)
1. Ve a https://neon.tech → crea cuenta
2. Crea un proyecto → copia la `DATABASE_URL`
3. Guarda el string de conexión (formato `postgresql://...`)

### 3. Importar en Vercel

1. Ve a https://vercel.com → New Project
2. Importa tu repo de GitHub
3. Vercel detecta Next.js automáticamente

### 4. Configurar variables de entorno

En Vercel → Settings → Environment Variables, agrega:

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | `postgresql://...` (de Neon) |
| `ZAI_API_KEY` | Tu API key de Z.AI |
| `ELEVENLABS_API_KEY` | Tu API key de ElevenLabs (opcional) |
| `ELEVENLABS_VOICE_ID` | `pNInz6obpgDQGcFmaJgB` (Adam) |

### 5. Cambiar Prisma a PostgreSQL

Edita `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"  // ← cambiar de "sqlite"
  url      = env("DATABASE_URL")
}
```

Haz commit y push:

```bash
git add prisma/schema.prisma
git commit -m "Switch to PostgreSQL for production"
git push
```

Vercel hará deploy automático. ✅

### 6. Inicializar base de datos en producción

Después del primer deploy, ejecuta el seed en producción:

```bash
# Instalar Vercel CLI
npm i -g vercel

# Login y link
vercel login
vercel link

# Ejecutar migrate
vercel env pull .env.production
npx prisma migrate deploy
npx prisma db seed  # o ejecuta bun run db:seed con DATABASE_URL de prod
```

## 🎯 Módulos incluidos (20)

### Catálogos
- Clientes (RFC, saldo, facturación)
- Proveedores (RFC, servicio, saldos)
- Empleados (RH, salarios, altas)

### Operación
- Facturación CFDI (emitidas/recibidas)
- Nómina (recibos CFDI)
- Compras (órdenes de compra)
- Inventario (productos, stock)
- Bancos (cuentas, movimientos)
- Contabilidad (pólizas)

### Fiscal
- SAT / Descarga masiva
- IA Fiscal (simuladores ISR, IVA, PTU)
- Tributario (calendario de obligaciones)

### Análisis
- Reestructura Financiera (avalancha de deudas)
- CRM (oportunidades, pipeline)
- Reportes (gráficas, mensual)

### Asistente IA
- **Abbax** · 22 tools + voz Stark + personalidad Tony Stark

## 🛠️ Scripts disponibles

```bash
bun run dev        # Servidor desarrollo
bun run build      # Build producción
bun run lint       # ESLint
bun run db:push    # Aplicar schema a BD
bun run db:generate # Regenerar Prisma client
bun run db:seed    # Cargar datos de ejemplo
```

## 🔧 APIs REST disponibles

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/stats` | GET | KPIs globales del dashboard |
| `/api/facturas` | GET | Lista facturas con filtros |
| `/api/clientes` | GET | Lista clientes |
| `/api/proveedores` | GET | Lista proveedores |
| `/api/empleados` | GET | Lista empleados |
| `/api/nomina` | GET | Recibos de nómina |
| `/api/compras` | GET | Órdenes de compra |
| `/api/inventario` | GET | Productos |
| `/api/bancos` | GET | Cuentas y movimientos |
| `/api/polizas` | GET | Pólizas contables |
| `/api/crm` | GET | Oportunidades CRM |
| `/api/assistant` | POST | Chat con Abbax (SSE streaming) |
| `/api/speak` | POST | Text-to-Speech con ElevenLabs |
| `/api/tareas` | GET/POST | CRUD tareas Abbax |
| `/api/notas` | GET/POST | CRUD notas Abbax |
| `/api/recordatorios` | GET/POST | CRUD recordatorios |
| `/api/conversaciones` | GET/DELETE | Historial chat Abbax |
| `/api/buscar` | GET | Búsqueda global |

## 🎤 Configurar voz Stark de Abbax

1. Crea cuenta en https://elevenlabs.io (gratis, 10K chars/mes)
2. Settings → API Keys → copia tu key
3. Pégala en `.env` (o variables de entorno de Vercel):
   ```
   ELEVENLABS_API_KEY=tu_key_aqui
   ```
4. Reinicia el servidor
5. Activa el botón 🔊 en la esquina superior del chat de Abbax
6. Pídele algo: "Dame el resumen fiscal" → escucharás voz Stark

## 🐛 Troubleshooting

### "Cannot find module '@prisma/client'"
```bash
bun run db:generate
```

### "Database connection error" en Vercel
- Verifica que `DATABASE_URL` apunta a PostgreSQL (no SQLite)
- Verifica que el schema dice `provider = "postgresql"`

### Herramientas de Abbax no responden
- Verifica `ZAI_API_KEY` en variables de entorno
- Revisa logs en Vercel → Functions → /api/assistant

### Voz de Abbax no suena
- Sin ElevenLabs: usa fallback Web Speech (Chrome/Edge escritorio)
- Con ElevenLabs: verifica `ELEVENLABS_API_KEY` y que tengas crédito

## 📞 Soporte

- Documentación completa: ver código comentado
- Issues: crea un issue en GitHub
- Stack: Next.js 16 + Prisma + Z.AI + ElevenLabs

## 📄 Licencia

MIT — Libre uso comercial y personal.
