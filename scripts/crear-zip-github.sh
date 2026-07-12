#!/bin/bash
# Crea un ZIP limpio para subir a GitHub
# Excluye: node_modules, .next, upload, db, .env, logs
# Incluye: TODO el código fuente + skills (leyes lite) + scripts + config

set -e

SRC="/home/z/my-project"
OUT="/home/z/my-project/download/sistema-fiscal-ia-github.zip"
STAGING="/tmp/sistema-fiscal-ia-github"

echo "📁 Preparando archivos para GitHub..."

# Limpiar staging
rm -rf "$STAGING" "$OUT"
mkdir -p "$STAGING"

# Copiar todo excepto lo excluido
rsync -a \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='nuevo-proyecto/' \
  --exclude='upload/' \
  --exclude='db/' \
  --exclude='.env' \
  --exclude='dev.log' \
  --exclude='server.log' \
  --exclude='.zscripts/' \
  --exclude='.z-ai-config/' \
  --exclude='.claude/' \
  --exclude='.git/' \
  --exclude='skills/auditoria-fiscal/laws/*.json' \
  --exclude='!skills/auditoria-fiscal/laws/_indice.json' \
  --exclude='!skills/auditoria-fiscal/laws/*.lite.json' \
  "$SRC/" "$STAGING/"

# Forzar inclusión de los .lite.json e _indice.json (necesarios para Abbax RAG)
# rsync con --exclude patrones negativos no funciona bien, así que los copiamos manualmente
mkdir -p "$STAGING/skills/auditoria-fiscal/laws/"
cp "$SRC/skills/auditoria-fiscal/laws/"*.lite.json "$STAGING/skills/auditoria-fiscal/laws/" 2>/dev/null
cp "$SRC/skills/auditoria-fiscal/laws/_indice.json" "$STAGING/skills/auditoria-fiscal/laws/" 2>/dev/null
cp "$SRC/skills/auditoria-fiscal/SKILL.md" "$STAGING/skills/auditoria-fiscal/" 2>/dev/null

# Crear .env.example
cat > "$STAGING/.env.example" << 'ENVEOF'
# ============================================================================
# SISTEMA FISCAL IA + ABBAX — VARIABLES DE ENTORNO PARA VERCEL
# ============================================================================

# BASE DE DATOS (PostgreSQL en Neon — https://neon.tech)
# IMPORTANTE: El schema.prisma ya está configurado para postgresql
DATABASE_URL="postgresql://usuario:password@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require"

# IA: Z.AI (GLM-4.6 para Abbax)
ZAI_API_KEY=""

# VOZ: ElevenLabs (voz Stark de Abbax — https://elevenlabs.io)
ELEVENLABS_API_KEY=""
ELEVENLABS_VOICE_ID="pNInz6obpgDQGcFmaJgB"
ENVEOF

# Crear ZIP
cd /tmp
zip -r -q "$OUT" "sistema-fiscal-ia-github"

# Mostrar resultado
echo ""
echo "✅ ZIP creado: $OUT"
echo "📊 Tamaño: $(du -h "$OUT" | cut -f1)"
echo ""
echo "📁 Archivos incluidos: $(find "$STAGING" -type f | wc -l)"
echo ""
echo "📂 Estructura principal:"
echo "   prisma/schema.prisma          (PostgreSQL configurado)"
echo "   skills/auditoria-fiscal/laws/ (9 leyes .lite.json)"
echo "   src/app/                      (24 módulos + APIs)"
echo "   src/components/               (Sistema completo + Abbax)"
echo "   scripts/                      (seed + process-laws)"
echo "   vercel.json                   (Config deploy)"
echo "   .env.example                  (Variables entorno)"
echo "   README.md                     (Guía deploy)"
echo ""
echo "🚀 Pasos:"
echo "   1. Descomprime el ZIP"
echo "   2. git init && git add . && git commit -m 'Sistema Fiscal IA'"
echo "   3. Crea repo en GitHub y push"
echo "   4. Importa en Vercel"
echo "   5. Configura variables de entorno"
echo "   6. Deploy!"

# Limpiar staging
rm -rf "$STAGING"
