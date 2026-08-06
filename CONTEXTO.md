# Sistema Fiscal IA + Abbax — Contexto del Proyecto

> **Lee este archivo al inicio de cada sesión.** Contiene TODO el contexto necesario para continuar el desarrollo sin reiniciar desde cero.

## 📋 Información General

- **Proyecto:** ERP Fiscal Mexicano con asistente IA (Abbax)
- **Uso:** Exclusivamente interno (no comercializar)
- **Repo GitHub:** https://github.com/ebener07-cyber/sistema-fiscal-ia-v2
- **Deploy:** https://sistema-fiscal-ia-v2.vercel.app
- **BD:** Neon PostgreSQL (ep-red-smoke-atnx331h-pooler.c-9.us-east-1.aws.neon.tech)
- **Versión actual:** v3.4 (contabilidad partida doble + conciliación)
- **Fecha última actualización:** 3 agosto 2026

---

## 🛠️ Stack Tecnológico

| Componente | Tecnología | Versión |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | 16.1.3 |
| Lenguaje | TypeScript | 5.9 |
| ORM | Prisma | 6.19 |
| BD | PostgreSQL (Neon) | — |
| UI | Tailwind CSS 4 + shadcn/ui | — |
| Charts | Recharts | 2.15 |
| IA | GLM-4.6 via z-ai-web-dev-sdk | 0.0.18 |
| Voz | ElevenLabs + Web Speech API | — |
| PDF | pdfjs-dist (legacy build) | 3.11.174 |
| Excel | exceljs | 4.4 |
| XML | fast-xml-parser | 5.9 |
| Deploy | Vercel (serverless) | — |
| Runtime | Node.js 20+ | — |

---

## ⚠️ REGLAS CRÍTICAS — NUNCA ROMPER ESTO

### 1. NUNCA crear `src/middleware.ts`
Next.js 16 usa `src/proxy.ts` como reemplazo de middleware. Si existen ambos, el build falla con:
```
Error: Both middleware file "./src/src/middleware.ts" and proxy file "./src/src/proxy.ts" are detected.
```
- **SIEMPRE** usar `src/proxy.ts` (nunca middleware.ts)
- `.gitignore` ya bloquea `src/middleware.ts`
- Si aparece el error, borrar `src/middleware.ts` y hacer push

### 2. `empresaId` obligatorio en TODAS las APIs
Todas las APIs deben filtrar por `empresaId` para mantener el aislamiento entre empresas:
```typescript
const empresaId = searchParams.get('empresaId');
if (!empresaId) {
  return NextResponse.json({ error: 'Falta empresaId' }, { status: 400 });
}
```

### 3. `useApiData` valida `r.ok` antes de usar datos
El hook `useApiData` (usado por 17+ módulos) DEBE validar la respuesta:
```typescript
if (!r.ok) {
  if (r.status === 401) {
    window.location.href = '/login';
    return;
  }
  const errorData = await r.json().catch(() => ({}));
  setError(errorData.error || `Error ${r.status}`);
  setData(null);
  return;
}
```

### 4. PDFs en Vercel — polyfills necesarios
`pdfjs-dist` necesita `DOMMatrix` y `Path2D` que no existen en Vercel serverless:
```typescript
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class { ... };
}
if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = class { ... };
}
```
Usar `pdfjs-dist/legacy/build/pdf.js` (no el build principal).

### 5. Fechas con mediodía para evitar desfase
```typescript
fecha = new Date(anio, mes, dia, 12, 0, 0); // NO new Date(anio, mes, dia)
```

### 6. Notas de crédito se RESTAN (no se suman)
En el Concentrado Excel y totales:
- Ingresos (I) → se SUMAN
- Notas de crédito (E) → se RESTAN (montos negativos en Excel)
- Nómina (N) → va a tabla ReciboNomina separada
- Pago (P) y Traslado (T) → se OMITEN del concentrado

---

## 📁 Estructura del Proyecto

```
sistema-fiscal-ia-github/
├── src/
│   ├── app/
│   │   ├── api/                    # 40+ endpoints
│   │   │   ├── auth/               # login, logout, me
│   │   │   ├── bancos/             # GET (con filtros mes/año/cuenta)
│   │   │   ├── facturas/           # GET (paginado), eliminar-mes
│   │   │   ├── upload-cfdi/        # POST (XML/ZIP con force=true)
│   │   │   ├── upload-estado-cuenta/  # POST (Excel/CSV/PDF con auto-detect)
│   │   │   ├── export/
│   │   │   │   ├── concentrado/    # Excel 14 hojas (estilo ELECTRONICMA)
│   │   │   │   ├── facturas/       # Excel facturas mensual
│   │   │   │   └── nomina/         # Excel nómina mensual
│   │   │   ├── finanzas/analisis/  # KPIs profesionales + préstamos
│   │   │   ├── proyectos/          # CRUD + conciliacion (POST auto-crea)
│   │   │   ├── conciliacion/       # Compara Excel vs BD
│   │   │   ├── polizas/            # GET + generar (POST auto desde facturas)
│   │   │   ├── empresas/[id]/      # DELETE (cascada) + PATCH
│   │   │   ├── usuarios/           # CRUD (solo admin)
│   │   │   ├── stats/              # Dashboard con empresaId
│   │   │   ├── auditoria-fiscal/   # RAG con 9 leyes
│   │   │   └── assistant/          # Abbax con 23 tools
│   │   ├── login/                  # Página de login
│   │   ├── admin/                  # Panel admin usuarios
│   │   ├── layout.tsx              # Root layout con ThemeProvider + EmpresaProvider
│   │   ├── page.tsx                # Server wrapper → HomePage (client)
│   │   └── globals.css             # Design system (paleta fintech)
│   │
│   ├── components/
│   │   ├── sistema-completo.tsx    # ⭐ 5000+ líneas — 24 módulos
│   │   ├── home-page.tsx           # Auth check → SistemaCompleto
│   │   ├── theme-provider.tsx      # SSR-safe dark/light
│   │   ├── empresa-provider.tsx    # Context con empresa activa + version
│   │   ├── ui/                     # shadcn/ui (40+ componentes)
│   │   ├── abbax/arc-reactor.tsx   # Animación Abbax
│   │   └── dashboard/              # Stats dashboard, global search
│   │
│   ├── hooks/
│   │   ├── use-abbax-voice.ts      # Voz Stark (ElevenLabs)
│   │   ├── use-toast.ts            # Sistema de toasts shadcn
│   │   ├── use-mobile.ts           # Responsive
│   │   └── use-speech.ts           # Web Speech API
│   │
│   └── lib/
│       ├── auth.ts                 # hashPassword, verifyPassword, createToken, verifyToken
│       ├── db.ts                   # Prisma client singleton
│       ├── zai.ts                  # Z.AI SDK helper (env vars o config)
│       ├── toast.ts                # Wrapper de toasts (toast.success/error/warning)
│       ├── rfc-validator.ts        # Validador RFC mexicano (física + moral + CURP)
│       └── utils.ts                # cn() y utilidades
│
├── prisma/
│   └── schema.prisma               # 18 modelos (Empresa, Usuario, Factura, etc.)
│
├── skills/
│   └── auditoria-fiscal/
│       └── laws/                   # 9 leyes fiscales en JSON (RAG)
│           ├── LISR.json + .lite.json
│           ├── LIVA.json + .lite.json
│           ├── CFF.json + .lite.json
│           ├── LFT.json + .lite.json
│           ├── LSS.json + .lite.json
│           ├── LINFONAVIT.json + .lite.json
│           ├── LFPDPPP.json + .lite.json
│           ├── LGA.json + .lite.json
│           ├── DOF.json + .lite.json
│           └── _indice.json
│
├── scripts/
│   ├── seed-completo.ts            # Seed con empresa + usuarios demo
│   ├── process-laws.ts             # Procesa leyes a JSON
│   └── package_github_zip.py       # Genera ZIP para GitHub
│
├── next.config.ts                  # serverExternalPackages: canvas, pdfjs-dist
├── vercel.json                     # Build: prisma generate && next build
├── .env.example                    # Template de variables de entorno
├── .gitignore                      # Bloquea middleware.ts, skills/*, etc.
└── CONTEXTO.md                     # ← Este archivo
```

---

## 📊 Los 24 Módulos

| # | Módulo | Estado | Notas |
|---|---|---|---|
| 1 | Dashboard | ✅ Con charts reales (bar + dona) | KPIs + top clientes |
| 2 | Empresas | ✅ Alta + constancia + eliminar | Cascada con transacción Prisma |
| 3 | Clientes | ✅ Cards visuales | Auto-creados desde CFDI |
| 4 | Proveedores | ✅ Cards visuales | Auto-creados desde CFDI |
| 5 | Empleados | ✅ Cards visuales | Auto-creados desde nómina |
| 6 | Facturación CFDI | ✅ Paginación + filtros | Todas/Recibidas/Emitidas |
| 7 | Nómina | ✅ Eliminar mes + Todo el año | Tabla + resumen mensual |
| 8 | Compras | ✅ Filtrado por empresa | — |
| 9 | Inventario | ✅ Filtrado por empresa | — |
| 10 | Bancos | ✅ Auto-detect banco/cuenta | Excel + CSV + PDF Banorte |
| 11 | Contabilidad | ✅ Pólizas automáticas | Genera desde facturas + nómina |
| 12 | SAT / CFDI Upload | ✅ Force update + paginación | Filtra Pago(P) y Traslado(T) |
| 13 | IA Fiscal | ✅ Simuladores ISR/IVA/PTU | Pre-llenado con datos reales |
| 14 | Auditoría Fiscal | ✅ RAG con 9 leyes | GLM-4.6 + streaming SSE |
| 15 | IMSS | ✅ Cálculos 2026 | UMA 2026 |
| 16 | INFONAVIT | ✅ Cálculos 2026 | — |
| 17 | Tributario | ✅ Datos reales | IVA/ISR/DIOT/Nómina + alertas |
| 18 | DIOT | ✅ Excel + filtrado empresa | — |
| 19 | INEGI | ✅ Excel + filtrado empresa | — |
| 20 | Finanzas | ✅ KPIs pro + préstamos | Business analyst + forecasting |
| 21 | CRM | ✅ Filtrado por empresa | — |
| 22 | Reportes | ✅ Concentrado + conciliación | Excel Anthropic style |
| 23 | Balance General | ✅ Excel + filtrado empresa | — |
| 24 | Proyectos | ✅ Auto-detección + conciliación | Crea desde conceptos de CFDI |
| 25 | Abbax | ✅ UI rediseñada + voz | 23 tools + RAG + streaming |
| 26 | Admin | ✅ Gestión usuarios | /admin página separada |

---

## 🗄️ Modelos de Prisma (18)

```
Empresa → Usuarios, Clientes, Proveedores, Facturas, Empleados, CuentasBancarias, Productos, Proyectos
Usuario → empresaId (nullable, para admin global)
Cliente → Facturas, Oportunidades, Proyectos
Proveedor → Facturas, OrdenesCompra
Empleado → RecibosNomina
Factura → descuento, impuestoRetenido, proyectoId (campos nuevos)
ReciboNomina → empleadoId, empresaId
CuentaBancaria → MovimientoBanco
MovimientoBanco → cuentaId
Proyecto → clienteId, empresaId, Facturas[]
Poliza → (sin empresaId aún — TODO)
Oportunidad → clienteId
Tarea, Nota, Recordatorio, Conversacion → independientes
```

---

## 🔐 Autenticación

- **Cookie:** `token` (httpOnly, 7 días)
- **Hash:** Base64 (mejorar con bcrypt en producción)
- **Token:** Base64 de JSON { sub, email, iat, exp }
- **proxy.ts:** Valida cookie en todas las APIs excepto `/api/auth/*`
- **Login:** `admin@hernandez.mx` / `admin123` (seed)
- **Usuario 2:** `maria@hernandez.mx` / `maria123`

---

## 📄 Parser de PDF de Banorte

El PDF de Banorte tiene formato especial:
- **Fechas:** `08-ENE-26` (día + mes abreviado español + año 2 dígitos)
- **2 cuentas en el mismo PDF:** ENLACE NEGOCIOS AVANZADA + INVERSION ENLACE NEGOCIOS
- **Montos en líneas separadas:** descripción ocupa 3-5 líneas, luego una línea con `monto saldo`
- **SALDO ANTERIOR:** Se debe SALTAR (no es movimiento real) pero extraer como referencia

### Keywords de signo:
- **Retiro (negativo):** COMPRA, PAGO, RETIRO, CARGO, TRASPASO, TRANSFERENCIA, I.V.A., INTERESES EXENTO, PAGO DE CAPITAL, PAGO DE CREDITO, PAGO DE LDC, ADMINISTRACION, COM. DISPERSION
- **Depósito (positivo):** DISPOSICION, RECIBIDO, DEPOSITO, DEV. DEPOSITO, DEPOSITO DE CUENTA

### Auto-detección de banco/cuenta:
- Busca "No. de Cuenta: 1282396470" (formato explícito)
- NO busca números aleatorios (causaba cuentas duplicadas)
- Si no detecta → formulario manual

---

## 📊 Concentrado Excel

Replica exactamente el formato del Excel ELECTRONICMA del usuario:
- **14 hojas:** Ene, FEB, MAR, ABRIL, MAYO, Jun, Jul, Ago, Sep, Oct, Nov, Dic, Concentrado, NOMINA
- **Hoja Concentrado:** Tabla pivote Mes × {Emitidas (SubTotal, Descuentos, Impuesto, Retenido, Total) + Recibidas (igual) + Nómina}
- **Notas de crédito:** Montos NEGATIVOS en hojas mensuales
- **Formato financiero Anthropic:** Ceros como "-", negativos con paréntesis, colores azul/negro/verde

---

## 💰 Análisis Financiero (Reestructura Fin.)

Endpoint `/api/finanzas/analisis` calcula:
- Calificación financiera (A+ a D, score 0-100)
- Saldo en bancos + meses de reserva
- Razones financieras (corriente, rápida, endeudamiento)
- KPIs profesionales: Ticket promedio, Revenue/Empleado, Burn Rate, Runway, LTV/CAC, Forecasting
- Flujo de caja mensual (gráfico de barras)
- Alertas críticas con recomendaciones
- Sugerencias expertas (corto/mediano/largo plazo)
- **Préstamos:** Campo de texto donde el usuario describe sus deudas, la IA extrae montos y tipos
- Top 5 clientes (cohort analysis)

---

## 🔧 Configuración de Deploy

### Variables de entorno (Vercel):
```
DATABASE_URL=postgresql://neondb_owner:...@ep-red-smoke-atnx331h-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require
ZAI_API_KEY=tu_api_key
ZAI_BASE_URL=https://api.z.ai/v1
ELEVENLABS_API_KEY=tu_key (opcional)
ELEVENLABS_VOICE_ID=tu_voice_id (opcional)
```

### Build command:
```
prisma generate && next build
```

### Install command:
```
bun install
```

### serverExternalPackages:
```
['canvas', 'pdfjs-dist']
```

### MaxDuration (vercel.json):
- `/api/assistant`: 60s
- `/api/speak`: 30s
- `/api/auditoria-fiscal`: 60s

---

## 🐛 Problemas Conocidos y Soluciones

| Problema | Solución |
|---|---|
| `middleware.ts` reaparece | Borrar físicamente + `.gitignore` + `git rm --cached` |
| `DOMMatrix is not defined` | Polyfills en upload-estado-cuenta/route.ts |
| `proyectoId does not exist` | `ALTER TABLE "Factura" ADD COLUMN "proyectoId" TEXT;` en Neon SQL Editor |
| `descuento does not exist` | `ALTER TABLE "Factura" ADD COLUMN "descuento" DOUBLE PRECISION DEFAULT 0;` |
| `impuestoRetenido does not exist` | `ALTER TABLE "Factura" ADD COLUMN "impuestoRetenido" DOUBLE PRECISION DEFAULT 0;` |
| `prisma db push` va a localhost | Cambiar `.env` a URL de Neon, o usar `$env:DATABASE_URL` en PowerShell |
| Neon "idle" | Reintentar 3 veces (se despierta solo) |
| Cuentas bancarias duplicadas | SQL: `DELETE FROM "CuentaBancaria" WHERE cuenta NOT IN ('1282396470', '1282397637');` |
| CFDIs tipo Pago aparecen | Se filtran automáticamente en upload-cfdi |

---

## 📦 Skills Instaladas (51 útiles)

### Críticas para el ERP:
- `auditoria-fiscal` — RAG con 9 leyes (3,301 artículos)
- `fullstack-dev` — Scaffolding Next.js + Prisma
- `coding-agent` — Workflow plan→code→test
- `ui-ux-pro-max` — Auditoría UI/UX
- `charts` — Visualizaciones
- `version-management` — Git semántico
- `skill-creator` — Crear skills custom
- `qingyan-research` — Deep research (actualizaciones fiscales)

### Para diseño digital (futuro):
- `image-generation`, `image-edit`, `image-search`
- `visual-design-foundations`, `design`
- `marketing-mode`, `content-strategy`, `seo-content-writer`
- `pdf`, `xlsx`, `pptx`, `docx`

### Skills de referencia (en /skills-referencia/):
- `anthropics/skills` — xlsx, pdf, docx, pptx (estándares financieros Anthropic)
- `archify` — Diagramas de arquitectura HTML
- NO se incluyen en el ZIP del ERP (solo referencia local)

---

## 🚀 Próximos Pasos Pendientes

1. ✅ ~~Bug middleware.ts~~ — Resuelto
2. ✅ ~~Bug useApiData~~ — Resuelto
3. ✅ ~~Parser PDF Banorte~~ — Funcionando (89 movimientos detectados)
4. ✅ ~~Auto-detección banco/cuenta~~ — Funcionando
5. ✅ ~~Concentrado Excel con NC negativas~~ — Funcionando
6. ✅ ~~Módulo Proyectos con conciliación~~ — Funcionando
7. ✅ ~~Reestructura Financiera con KPIs~~ — Funcionando
8. ✅ ~~CFDIs mezclados entre empresas~~ — Resuelto (v2.3): script de limpieza + defensa doble en API (empresaId + RFC)
9. ✅ ~~Pestañas mensuales en Bancos y SAT~~ — Resuelto (v2.3): estilo Nómina con contador por mes
10. ✅ ~~Cuenta Banorte Inversión~~ — Resuelto (v2.3): parser detecta 2 secciones en PDF y asigna automáticamente
11. ✅ ~~Dashboard con tarjetas vacías~~ — Resuelto (v2.3): manejo robusto de stats null + banner informativo
12. ✅ ~~Rediseño Clientes/Proveedores/Empleados~~ — Resuelto (v2.3): agendas profesionales con búsqueda y filtros
13. ⏳ Security audit del ERP (OWASP, JWT, rate limiting)
14. ⏳ Skeleton loaders en tablas
15. ⏳ Botón eliminar cuenta bancaria desde UI
16. ⏳ Tests E2E con Playwright
17. ⏳ Soporte PDF para BBVA y Santander
18. ⏳ Generar CFDI mock para pruebas sin timbrar
19. ⏳ Reportes PDF profesionales con logo

---

## 📝 v2.3 — Correcciones de aislamiento entre empresas y rediseños UX (2 agosto 2026)

### Problemas resueltos:
1. **CFDIs mezclados entre empresas**: 
   - ELECTRONICMA tenía 58 emisores distintos en "emitidas" (solo ALO980508ID6 era correcto)
   - Causa: cuando el usuario subía CFDIs sin empresa seleccionada, se asignaban a la primera empresa
   - Fix: script `limpiar-cfdi-mezclados.ts` reasigna por RFC del emisor/receptor
   - Defensa doble en API: valida empresaId + que el RFC coincida con la dirección (emitida→emisorRfc, recibida→receptorRfc)

2. **Bancos sin pestañas mensuales**:
   - BancosView solo tenía selector `<select>` de mes
   - Rediseñado con pestañas tipo Nómina: "Todo {año}" + 12 botones por mes con contador
   - Resumen anual carga en paralelo sin afectar render principal

3. **Cuenta Banorte Inversión sin datos**:
   - El PDF de Banorte tiene 2 secciones (operaciones + inversión) en el mismo archivo
   - Parser viejo procesaba todo junto en una sola cuenta
   - Fix: nueva función `parsePDFTextoMultiCuenta` detecta headers "ENLACE NEGOCIOS AVANZADA" / "INVERSION ENLACE NEGOCIOS"
   - Backend busca/crea cuenta de inversión automáticamente y enruta movimientos por flag `esInversion`

4. **Dashboard con tarjetas vacías**:
   - Causa: empresa activa no tenía facturas en periodo actual
   - Fix: manejo seguro con `stats.fiscal?.totalEmitido || 0` en todos los KPIs
   - Banner informativo cuando no hay datos + botón directo al módulo SAT

5. **Rediseño Proveedores y Empleados**:
   - ProveedoresView: agenda con búsqueda + filtro por servicio + tabla con avatares
   - EmpleadosView: toggle Cards/Tabla + filtro activos/inactivos + búsqueda por puesto/departamento
   - KPIs mejorados (promedio salario, nómina anual, saldo pendiente)

### Archivos modificados:
- `src/app/api/facturas/route.ts` — Defensa doble empresaId + RFC
- `src/app/api/bancos/route.ts` — Soporte `all=true` para resumen anual
- `src/app/api/upload-cfdi/route.ts` — Fix variable `forzar` para ZIPs
- `src/app/api/upload-estado-cuenta/route.ts` — Parser multi-cuenta
- `src/components/sistema-completo.tsx` — BancosView, SatView, ProveedoresView, EmpleadosView, DashboardView rediseñados
- `scripts/limpiar-cfdi-mezclados.ts` — Script de limpieza de BD
- `scripts/diagnostico-completo.ts` — Diagnóstico de CFDIs por RFC

---

## 📝 v2.4 — Soporte Santander + corrección CFDIs mal clasificados (2 agosto 2026 tarde)

### Problemas resueltos:
1. **SAT Emitidas sin mostrar nada**:
   - ELECTRONICMA tenía 190 emitidas en BD pero solo 96 con RFC matching (ALO980508ID6)
   - 94 eran facturas de proveedores (CFE, BANORTE, IMSS, HOME DEPOT, etc.) mal clasificadas como 'emitidas'
   - Script `convertir-mal-clasificadas.ts` las convirtió a `direccion='recibida'` (94 convertidas)
   - Quitado el filtro RFC restrictivo de la API GET (mantener solo filtro empresaId)
   - Estado final: ELECTRONICMA tiene 96 emitidas propias + 95 recibidas (94 + 1 NC)

2. **Agregar cuenta Santander**:
   - Creada cuenta SANTANDER 65-50908535-6 (tipo operaciones) en BD de ELECTRONICMA
   - Subidos 30 movimientos del PDF Santander-Enero a la BD
   - Saldo final: -$45,712.01

3. **Soporte PDF Santander**:
   - Formato fecha: DD-ENE-2026 (compatible con parser Banorte)
   - Estructura: línea de fecha + descripción + línea con monto y saldo
   - Agregados keywords: ABONO (depósito), CGO/CARGO CAPITAL/CARGO POR/CGO INTERESES (retiro)
   - Auto-detección de banco: si el PDF contiene "SANTANDER" o "BANORTE", identifica el banco
   - Auto-creación de cuenta: si la cuenta detectada no existe, la crea automáticamente
   - Auto-redirección: si la cuenta seleccionada no coincide con el banco del PDF, redirige a la cuenta correcta

### Archivos modificados:
- `src/app/api/facturas/route.ts` — Quitado filtro RFC restrictivo del GET
- `src/app/api/upload-estado-cuenta/route.ts` — Auto-detección de banco Santander/Banorte + auto-creación de cuenta + keywords Santander
- `scripts/convertir-mal-clasificadas.ts` — Script para corregir 94 facturas mal clasificadas
- `scripts/agregar-cuenta-santander.ts` — Script para crear cuenta Santander
- `scripts/subir-santander-bd.ts` — Script para procesar PDF Santander y subir a BD

---

## 📝 v2.5 — Parser PDF Santander reescrito + 6 PDFs procesados (2 agosto 2026 noche)

### Problemas resueltos:
1. **Parser PDF Santander impreciso**:
   - El parser viejo confundía folios (7113421), CLABEs (014180655090853560), y refs con montos
   - No detectaba movimientos cuando el saldo final era $0.00 (filtro > 0.5 los descartaba)
   - No distinguía correctamente las 2 secciones (operaciones + inversión)
   - Reescrito completamente `parsePDFTextoMultiCuenta` con:
     * FASE 1: Detección explícita de secciones por headers conocidos
     * FASE 2: Parsear cada sección con su propio saldo inicial
     * FASE 3: Combinar resultados
   * Extracción ESTRICTA de montos: NN,NNN.NN con 2 decimales obligatorios
   * Función inclusiva para detectar saldos en $0.00
   * Maneja movimientos multi-línea correctamente

2. **Cuenta Santander Inversión**:
   - Creada cuenta SANTANDER Inversión 66-50908535-6 en BD de ELECTRONICMA
   - En los 6 PDFs analizados, la cuenta de inversión no tuvo movimientos (saldo $0)

3. **Procesamiento de 6 PDFs (Enero-Junio 2026)**:
   - Enero: 32 movs | saldo inicial $119,827.38 → $62,073.29 ✓
   - Febrero: 44 movs | saldo inicial $62,073.29 → $108,842.68 ✓
   - Marzo: 46 movs | saldo inicial $108,842.68 → $299,955.21 ✓
   - Abril: 30 movs | saldo inicial $299,955.21 → $82,075.16 ✓
   - Mayo: 26 movs | saldo inicial $82,075.16 → $508,141.20 ✓
   - Junio: 44 movs | saldo inicial $508,141.20 → $1,652.57 ✓
   - **Saldo final de cuenta SANTANDER: $1,652.57** (coincide exactamente con el PDF)

4. **Movimiento de apertura automático**:
   - Cuando se sube el primer PDF a una cuenta vacía, se agrega el saldo inicial
     como movimiento de apertura ("SALDO INICIAL DE APERTURA")
   - Esto hace que el saldo de la cuenta cuadre con el saldo final del último PDF

### Archivos modificados:
- `src/app/api/upload-estado-cuenta/route.ts` — Parser reescrito + detección multi-cuenta + movimiento de apertura
- `scripts/procesar-todos-santander.ts` — Script para procesar los 6 PDFs
- `scripts/probar-parser-santander-v2.js` — Script de prueba del nuevo parser
- `scripts/analizar-pdf-santander.js` — Script para extraer texto del PDF

---

## 📝 v3.0 — Arquitectura Multi-Agente Maker-Checker + Router + MCP (3 agosto 2026)

### Nuevos componentes:

1. **Audit Trail (Trazabilidad obligatoria)**:
   - Modelo `AuditTrail` en Prisma con campos: agente, herramienta, input, output, scoreConfianza, verificado, observaciones, empresaId, duracionMs, error
   - Helper `src/lib/audit-trail.ts` con funciones `registrarAuditTrail`, `marcarVerificado`, `conAuditoria`
   - Endpoint `GET /api/audit-trail` con filtros y estadísticas
   - Cada llamada de un agente IA queda registrada con score de confianza

2. **Maker-Checker en Auditoría Fiscal**:
   - Helper `src/lib/agentes/checker-fiscal.ts` que verifica citas de artículos
   - API `/api/auditoria-fiscal` ahora hace:
     1. **Maker** (GLM-4.6): genera respuesta citando artículos → audit trail
     2. Stream token por token al frontend
     3. **Checker** (determinista, NO LLM): verifica que las citas existan en los JSON
     4. Score de confianza 0.0 a 1.0, verificado=true solo si >= 0.7
   - El frontend recibe evento `{type: 'verificacion', scoreConfianza, verificado, citas, observaciones}`

3. **Orchestrator Router** (`/api/agentes/router`):
   - Clasifica la intención del usuario en 4 subagentes:
     - **rag-fiscal** → preguntas sobre leyes
     - **cfdi-validator** → validar CFDIs
     - **erp-query** → consultas a BD
     - **assistant** → tareas/notas/recordatorios
   - Usa GLM-4.6 con prompt corto + few-shot examples
   - Fallback heurístico por keywords si falla el LLM
   - Devuelve `{subagente, razon, confianza, endpointSugerido, auditTrailId}`

4. **Subagente ERP-Query** (`/api/agentes/erp-query`):
   - Clasifica consulta con LLM (6 tipos: facturas, saldos, kpis, clientes, proveedores, nómina)
   - Ejecuta función Prisma predefinida (NO genera SQL dinámico, seguro)
   - 6 consultas soportadas con parámetros extraídos automáticamente

5. **Subagente CFDI-Validator** (`/api/agentes/cfdi-validator`):
   - Determinista (sin LLM) para garantizar consistencia
   - Valida: estructura XML, campos obligatorios, RFC (12/13 chars), UUID (36 chars), tipo comprobante, fechas
   - Verifica duplicados de UUID en BD
   - Score de confianza 0.0 a 1.0

6. **MCP Server Ligero** (`/api/mcp`):
   - Implementación simplificada de Model Context Protocol
   - 7 tools estandarizadas:
     1. `buscar_articulo_cff(frase_clave, ley?)` — busca en 8 leyes JSON
     2. `validar_estructura_cfdi(xml_string)` — valida XML de CFDI
     3. `consultar_saldo_bancario(empresaId)` — saldos de cuentas
     4. `calcular_isr_persona_moral(utilidad)` — ISR 30% (LISR Art. 9)
     5. `calcular_iva(ventas, compras)` — IVA 16% (LIVA Art. 1)
     6. `verificar_rfc(rfc)` — valida formato RFC
     7. `listar_facturas_empresa(empresaId, direccion?)` — facturas de empresa
   - GET devuelve manifest de tools con esquema de parámetros
   - POST ejecuta tool y registra audit trail automáticamente
   - Las tools son testeables independientemente del LLM

### Arquitectura resultante:
```
Usuario → /api/agentes/router (Orchestrator)
              ↓
         [rag-fiscal]  → /api/auditoria-fiscal (Maker) → Checker → AuditTrail
         [cfdi-valid]  → /api/agentes/cfdi-validator → AuditTrail
         [erp-query]   → /api/agentes/erp-query → AuditTrail
         [assistant]   → /api/assistant (23 tools) → AuditTrail

APIs pueden llamar al MCP server (/api/mcp) para tools estandarizadas
```

### Archivos creados/modificados:
- `prisma/schema.prisma` — + modelo AuditTrail
- `src/lib/audit-trail.ts` — helper de trazabilidad
- `src/lib/agentes/checker-fiscal.ts` — checker determinista
- `src/app/api/audit-trail/route.ts` — endpoint de consulta
- `src/app/api/agentes/router/route.ts` — orchestrator
- `src/app/api/agentes/erp-query/route.ts` — subagente ERP
- `src/app/api/agentes/cfdi-validator/route.ts` — subagente CFDI
- `src/app/api/mcp/route.ts` — MCP server
- `src/app/api/auditoria-fiscal/route.ts` — Maker-Checker implementado

---

## 📝 v3.1 — Categorizador + Conciliador Bancario + PII Masking (3 agosto 2026)

### Nuevos componentes:

1. **Agente Categorizador** (`/api/agentes/categorizador`):
   - Clasifica movimientos bancarios en 10 categorías contables
   - Estrategia de 2 pasadas:
     - PASADA 1: Determinista por keywords (28 reglas, 100% preciso, gratis)
     - PASADA 2: LLM GLM-4.6 con few-shot (solo si la determinista falla)
   - Categorías: Nómina, Proveedores, Comisiones, Transferencias, Renta, Servicios, Impuestos, Inversión, Préstamos, Otros
   - Persiste en MovimientoBanco: categoria, subcategoria, scoreConfianza
   - Estadísticas: GET /api/agentes/categorizador?empresaId=xxx

2. **Agente Conciliador Banco-Facturas** (`/api/agentes/conciliador-banco`):
   - Concilia movimientos bancarios con facturas (emitidas/recibidas)
   - Match por:
     - Monto (tolerancia ±2% para comisiones)
     - Fecha (tolerancia ±3 días, penaliza score)
     - RFC (si el concepto menciona el RFC del emisor/receptor)
   - Reglas:
     - Movimiento positivo (depósito) → busca factura EMITIDA
     - Movimiento negativo (pago) → busca factura RECIBIDA
     - Match único → conciliado
     - Múltiples matches score >= 0.85 → conciliado
     - Múltiples matches ambiguos → pendiente_revision (HITL)
   - Persiste en MovimientoBanco: facturaConciliadaId, conciliadoEn
   - Estadísticas: GET /api/agentes/conciliador-banco?empresaId=xxx

3. **PII Masking** (`/src/lib/pii-mask.ts`):
   - Enmascara datos sensibles en logs y audit trail
   - 8 patrones regex: RFC moral/física, CURP, CLABE, cuenta bancaria, tarjeta, teléfono, email
   - Integrado en audit-trail.ts: todo input/output se enmascara automáticamente
   - Funciones: maskPII(texto), maskPIIObject(obj), contienePII(texto), listarTiposPII()

### Cambios en Prisma Schema:
- **MovimientoBanco**: + campos categoria, subcategoria, scoreConfianza, facturaConciliadaId, conciliadoEn
- **Factura**: + relación inversa movimientosConciliados
- Nuevos índices: [categoria], [facturaConciliadaId]

### MCP Server actualizado (11 tools):
- 7 tools existentes: buscar_articulo_cff, validar_estructura_cfdi, consultar_saldo_bancario, calcular_isr_persona_moral, calcular_iva, verificar_rfc, listar_facturas_empresa
- 4 tools nuevas: categorizar_movimiento, categorizar_movimientos_empresa, conciliar_movimientos_facturas, enmascarar_pii

### Arquitectura multi-agente completa:
```
Usuario → /api/agentes/router (Orchestrator GLM-4.6)
              ↓
         [rag-fiscal]      → /api/auditoria-fiscal (Maker → Checker) → AuditTrail (PII masked)
         [cfdi-validator]  → /api/agentes/cfdi-validator → AuditTrail
         [erp-query]       → /api/agentes/erp-query → AuditTrail
         [assistant]       → /api/assistant (23 tools) → AuditTrail

Procesos batch:
         Bancos → /api/agentes/categorizador → MovimientoBanco.categoria
              → /api/agentes/conciliador-banco → MovimientoBanco.facturaConciliadaId

MCP Server (/api/mcp): 11 tools estandarizadas accesibles por cualquier agente
```

### Archivos creados/modificados:
- `prisma/schema.prisma` — + campos en MovimientoBanco, + relación en Factura
- `src/lib/pii-mask.ts` — helper de enmascaramiento
- `src/lib/audit-trail.ts` — integrado PII masking automático
- `src/lib/agentes/categorizador.ts` — agente clasificador
- `src/lib/agentes/conciliador-banco.ts` — agente conciliador
- `src/app/api/agentes/categorizador/route.ts` — endpoint
- `src/app/api/agentes/conciliador-banco/route.ts` — endpoint
- `src/app/api/mcp/route.ts` — + 4 tools nuevas (total 11)

---

## 📝 Notas del Desarrollador

- El usuario (Ebener) trabaja desde Windows con PowerShell
- Usa GitHub Desktop para commits
- El proyecto es personal/empresarial (no comercial)
- Empresa principal: ELECTRONICMA SA DE CV (RFC: ALO980508ID6)
- Segunda empresa: RIDEN (en proceso de configuración)
- Banco principal: Banorte (cuenta 1282396470 + inversión 1282397637)
- El usuario prefiere que TODO se haga en este chat (no Cursor/Copilot)
- Todas las skills y repos de referencia son locales (no se suben a GitHub)
- El ZIP se genera con `python3 scripts/package_github_zip.py`
