#!/bin/bash
# Package the corrected project as a ZIP file for the user to download.
# Excludes node_modules, .next, env files, build cache, and other non-source files.

set -e

SRC="/home/z/my-project/nuevo-proyecto"
STAGING="/tmp/nuevo-proyecto-staging"
OUT="/home/z/my-project/download/nuevo-proyecto-corregido.zip"

# Clean staging
rm -rf "$STAGING" "$OUT"
mkdir -p "$STAGING" "$(dirname "$OUT")"

# Copy the source tree, excluding heavy/non-source directories
# Using rsync so we can use --exclude patterns
rsync -a \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='build/' \
  --exclude='dist/' \
  --exclude='.turbo/' \
  --exclude='out/' \
  --exclude='coverage/' \
  --exclude='.git/' \
  --exclude='*.log' \
  --exclude='server.log' \
  --exclude='build-output.txt' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.production' \
  --exclude='.env.*.local' \
  --exclude='uploads/' \
  --exclude='certificados/' \
  --exclude='*.cer' \
  --exclude='*.key' \
  --exclude='*.pem' \
  --exclude='*.pfx' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  "$SRC/" "$STAGING/"

# Create a fresh .env.example so the user knows which env vars to set
cat > "$STAGING/.env.example" << 'EOF'
# ============================================================================
# VARIABLES DE ENTORNO - nuevo-proyecto (Next.js + Prisma + PostgreSQL)
# ============================================================================
# Copia este archivo a .env y completa los valores reales.

# URL de conexión a PostgreSQL (formato: postgresql://USUARIO:PASSWORD@HOST:PUERTO/BD)
DATABASE_URL="postgresql://usuario:password@localhost:5432/nuevo_proyecto?schema=public"

# Secreto para JWT / sesión (usa un string aleatorio largo en producción)
# Genera uno con: openssl rand -base64 32
JWT_SECRET="cambia-esto-por-un-secreto-largo-y-aleatorio"

# Configuración del servidor
NEXTAUTH_URL="http://localhost:3000"
NODE_ENV="development"

# API keys (si usas IA fiscal con OpenAI/Groq/etc.)
OPENAI_API_KEY=""
GROQ_API_KEY=""

# Configuración SAT (solo si usas descarga masiva)
SAT_RFC=""
SAT_PASSWORD=""
EOF

# Create a small CHANGES.md summarizing what was fixed
cat > "$STAGING/CAMBIOS_CORRECCION.md" << 'EOF'
# Cambios aplicados a nuevo-proyecto

Fecha: 2026-07-10
Herramienta: GLM-5.2 (Z.ai)

## Resumen

El proyecto no compilaba con `npx next build`. Se identificaron y corrigieron
**6 errores** en distintos archivos. Después de los cambios el build se completa
exitosamente (53 rutas generadas, sin errores ni warnings).

## Errores corregidos

### 1. `lib/cfdi-parser.ts` — falta función `validateCFDI`
**Antes:** `app/api/descarga-sat/procesar/route.ts` importaba `validateCFDI`
pero esa función no existía en `lib/cfdi-parser.ts`, lo que rompía el build.

**Ahora:** Se agregó la función `validateCFDI(cfdi)` con su interfaz
`CFDIValidationResult`. Valida:
- UUID con formato canónico (36 caracteres)
- Fecha, folio, subtotal, total presentes y coherentes
- Coherencia matemática: total = subtotal - descuento + traslados - retenidos
- RFC de emisor y receptor (longitud 12 o 13)
- Tipo de comprobante válido (I, E, T, N, P)
- Al menos un concepto (excepto nómina)

### 2. `middleware.ts` → `proxy.ts` (cambio obligatorio Next.js 16)
**Antes:** Next.js 16 muestra warning:
> The "middleware" file convention is deprecated. Please use "proxy" instead.

**Ahora:** El archivo `middleware.ts` se renombró a `proxy.ts` y la función
exportada `middleware` se renombró a `proxy`. Comportamiento idéntico.

### 3. `app/api/procesar-xmls/route.ts` — imports faltantes + auth incorrecta
**Antes:** El archivo usaba `getServerSession(authOptions)` de next-auth,
pero next-auth no está instalado. También referenciaba `prisma.empresaUsuario`
(modelo que no existe en el schema) y campos inexistentes en `CFDIData`
(`cfdi.tipoCambio`, `cfdi.estado`, `c.objetoImp`).

**Ahora:** Se reescribió usando el sistema de autenticación real del proyecto
(cookie `auth-token` + `verifyToken` de `lib/auth.ts`), eliminando la
referencia a `empresaUsuario` (se valida vía `usuario.empresaId`), y usando
valores por defecto coherentes para los campos que no existen en `CFDIData`.

### 4. `lib/graphify-utils.ts` — path de import incorrecto
**Antes:** `import { GraphifySectionKey } from '@/types/graphify';`
Pero el archivo de tipos está en `src/types/graphify.ts`, no en `types/`.

**Ahora:** `import { GraphifySectionKey } from '@/src/types/graphify';`

### 5. `lib/sat-firma.ts` — tipo incompatible en `signer.sign()`
**Antes:** Se pasaba un `forge.pki.PrivateKey` directamente a
`crypto.createSign().sign()`, que espera `KeyLike | SignPrivateKeyInput`.

**Ahora:** Se convierte el objeto forge de vuelta a PEM antes de firmar.
Adicionalmente, se arregló el manejo del password (las llaves .key del SAT
suelen estar encriptadas con PKCS#8) y se soporta tanto PEM como DER binario.

### 6. `sync-nomina.ts` — tipo `string | null` no asignable a `string`
**Antes:** `factura.receptorRfc` es `String?` (nullable) en el schema, pero
se usaba directamente en `prisma.empleado.findFirst({ where: { rfc: ... } })`
donde `rfc` es `String` (no nullable).

**Ahora:** Se filtran las facturas con `receptorRfc: { not: null }` en la
query, y se agrega un guard `if (!factura.receptorRfc) continue;` dentro
del bucle para satisfacer al type checker.

### 7. `tsconfig.json` — excluir scripts standalone
**Antes:** Archivos como `test-sat.ts` (que importa `sat-descarga-masiva`,
paquete no instalado) rompían el type check del build.

**Ahora:** Se agregaron a `exclude` los scripts standalone:
`test-sat.ts`, `sync-nomina.ts`, `test-import.js`, `test-nomina.js`,
`check-facturas.js`, `clean-db.js`, `scripts/**/*`.

### 8. `src/components/examples/GraphifyInfoExample.tsx` — import path incorrecto
**Antes:** Importaba `useGraphifySection` desde `@/providers/GraphifyProvider`
(versión básica sin ese hook).

**Ahora:** Importa desde `@/src/providers/GraphifyProvider` (versión
extendida que sí exporta el hook).

## Cómo aplicar estos cambios en tu computadora

1. Descarga `nuevo-proyecto-corregido.zip`
2. En tu computadora, ve a `C:\Users\compu\nuevo-proyecto`
3. **IMPORTANTE:** Haz una copia de seguridad de tu carpeta actual:
   - Copia `C:\Users\compu\nuevo-proyecto` → `C:\Users\compu\nuevo-proyecto.backup`
4. Descomprime el ZIP encima de tu carpeta existente (sobrescribe los archivos)
5. **NO sobrescribas** estos archivos si los tienes con valores reales:
   - `.env` (tiene tu DATABASE_URL y secretos reales)
   - `certificados/` (tus .cer y .key del SAT)
   - `uploads/` (archivos subidos)
6. Ejecuta:
   ```powershell
   cd C:\Users\compu\nuevo-proyecto
   npm install
   npx prisma generate
   npx next build
   ```
7. Si el build dice "✓ Compiled successfully" → listo.

## Archivos modificados

- `lib/cfdi-parser.ts` (agregada función `validateCFDI`)
- `lib/graphify-utils.ts` (import path corregido)
- `lib/sat-firma.ts` (manejo correcto de llave privada)
- `app/api/procesar-xmls/route.ts` (auth y tipos corregidos)
- `src/components/examples/GraphifyInfoExample.tsx` (import path corregido)
- `sync-nomina.ts` (filtro y guard para receptorRfc null)
- `middleware.ts` → `proxy.ts` (renombrado + función renombrada)
- `tsconfig.json` (excluye scripts standalone)
- `.env.example` (nuevo, documentación de variables de entorno)
EOF

# Build the ZIP
cd /tmp
zip -r -q "$OUT" "nuevo-proyecto-staging"
# Rename the top-level folder inside the zip from "nuevo-proyecto-staging" to "nuevo-proyecto"
# (we'll re-zip with the correct name)
rm -f "$OUT"
mv "$STAGING" "/tmp/nuevo-proyecto"
cd /tmp
zip -r -q "$OUT" "nuevo-proyecto"
mv "/tmp/nuevo-proyecto" "$STAGING"

# Show result
ls -lh "$OUT"
echo ""
echo "=== Contenido del ZIP ==="
unzip -l "$OUT" | tail -20
echo ""
echo "=== Estadísticas ==="
echo "Archivos en el ZIP: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
echo "Tamaño: $(du -h "$OUT" | cut -f1)"
