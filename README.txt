# 🔧 Mejora al Módulo de Bancos — ZIP de Instalación

## Archivos incluidos

```
bancos-fix/
├── SCHEMA-UPDATE.prisma                          → Agregar al final de prisma/schema.prisma
├── src_app_api_bancos_route.ts                   → REEMPLAZAR src/app/api/bancos/route.ts
├── src_app_api_bancos_[cuentaId]_estados-cuenta_route.ts  → src/app/api/bancos/[cuentaId]/estados-cuenta/route.ts
├── src_app_api_bancos_conciliar_route.ts         → src/app/api/bancos/conciliar/route.ts
├── src_app_api_bancos_reporte-pagos_route.ts     → src/app/api/bancos/reporte-pagos/route.ts
├── src_app_(dashboard)_bancos_estados-cuenta_page.tsx      → src/app/(dashboard)/bancos/estados-cuenta/page.tsx
├── src_app_(dashboard)_bancos_conciliacion_page.tsx        → src/app/(dashboard)/bancos/conciliacion/page.tsx
└── README.txt                                    → Este archivo
```

---

## 🚀 Instalación paso a paso

### 1. Corregir el build error (IMPORTANTE)

El archivo `src/app/api/bancos/route.ts` tiene código duplicado y roto que impide el deploy.

**Reemplaza TODO el contenido** de `src/app/api/bancos/route.ts` con el código de `src_app_api_bancos_route.ts`

### 2. Actualizar Prisma Schema

Abre `prisma/schema.prisma` y agrega al final el contenido de `SCHEMA-UPDATE.prisma`.

Luego, dentro de los modelos existentes, agrega las relaciones:

```prisma
// Dentro de model MovimientoBanco, agregar esta línea:
  conciliacion ConciliacionBancaria?

// Dentro de model Factura, agregar esta línea:
  conciliaciones ConciliacionBancaria[]
```

### 3. Generar migración

```bash
npx prisma generate
npx prisma db push
```

### 4. Crear las nuevas APIs

Crea estos directorios y copia el contenido de cada archivo:

```bash
mkdir -p "src/app/api/bancos/[cuentaId]/estados-cuenta"
mkdir -p "src/app/api/bancos/conciliar"
mkdir -p "src/app/api/bancos/reporte-pagos"
```

| Archivo del ZIP | Ruta destino en tu proyecto |
|---|---|
| `src_app_api_bancos_[cuentaId]_estados-cuenta_route.ts` | `src/app/api/bancos/[cuentaId]/estados-cuenta/route.ts` |
| `src_app_api_bancos_conciliar_route.ts` | `src/app/api/bancos/conciliar/route.ts` |
| `src_app_api_bancos_reporte-pagos_route.ts` | `src/app/api/bancos/reporte-pagos/route.ts` |

### 5. Crear las nuevas páginas

```bash
mkdir -p "src/app/(dashboard)/bancos/estados-cuenta"
mkdir -p "src/app/(dashboard)/bancos/conciliacion"
```

| Archivo del ZIP | Ruta destino en tu proyecto |
|---|---|
| `src_app_(dashboard)_bancos_estados-cuenta_page.tsx` | `src/app/(dashboard)/bancos/estados-cuenta/page.tsx` |
| `src_app_(dashboard)_bancos_conciliacion_page.tsx` | `src/app/(dashboard)/bancos/conciliacion/page.tsx` |

### 6. Agregar navegación

En tu sidebar o menú de navegación, agrega los nuevos enlaces:

```tsx
{
  title: "Bancos",
  items: [
    { title: "Cuentas", href: "/bancos" },
    { title: "Estados de Cuenta", href: "/bancos/estados-cuenta" },
    { title: "Conciliación", href: "/bancos/conciliacion" },
  ],
}
```

### 7. Commit y push

```bash
git add .
git commit -m "fix: corrige build error bancos + agrega estados de cuenta y conciliacion"
git push origin main
```

Vercel hará el deploy automáticamente.

---

## 📊 Funcionalidades

### /bancos/estados-cuenta
- Selector de cuenta bancaria + año
- 12 pestañas por mes (Enero–Diciembre)
- KPIs anuales y mensuales (saldo inicial, ingresos, egresos, saldo final)
- Tabla de movimientos con búsqueda
- Badge conciliado/pendiente
- Detalle de factura relacionada
- Diálogo de detalle por movimiento

### /bancos/conciliacion
- 4 KPIs: Cobros, Pagos, Ingresos Bancarios, Egresos Bancarios
- Barras de progreso con % pagado/cobrado
- 3 tabs: Cobros (emitidas), Pagos (recibidas), Movimientos Bancarios
- Conciliar factura con movimiento bancario desde la tabla
- Detección de diferencias de monto
- Desconciliar con un click
- Filtro por cuenta, año y mes

---

## ⚠️ Notas

- Las APIs usan `empresaId` desde `localStorage`. Si tu app usa otro método (zustand, context, etc.), ajústalo.
- Asegúrate de tener `date-fns` instalado: `bun add date-fns`
- Si usas `next-auth` en lugar de JWT manual, reemplaza la auth en las APIs.
