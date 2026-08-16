# Sistema Fiscal IA — Actualización v6 (Agosto 2026)

Este ZIP contiene **7 archivos** modificados que se deben colocar respetando la estructura de carpetas en el repositorio de GitHub.

## Archivos incluidos

### 1\. Conciliación Maestra v6 (corrige 8 problemas críticos)

|Archivo|Acción|Ruta destino|
|-|-|-|
|`conciliador-v6.ts`|✨ NUEVO|`src/lib/agentes/conciliador-v6.ts`|
|`route.ts`|♻️ REESCRITO|`src/app/api/reportes/conciliacion-maestra/route.ts`|
|`conciliador-inteligente.ts`|🔧 CORREGIDO|`src/lib/agentes/conciliador-inteligente.ts`|

**Correcciones:**

* \#1 Eficiencia 78→75% → Pipeline reordenado + subset-sum
* \#2 32 alertas sin justificar → justificarDiferencia() automática
* \#3 Doble conteo múltiple → subsetSum() con marcaje `usada`
* \#4 ESINAR sin conciliar → conciliarIngresosEsinar() FIFO
* \#5 Movs grandes → detectarMontoConocido() ($15,850 colegiatura)
* \#6 Inversión contamina → Hoja "Cuenta Inversión" separada
* \#7 Duplicados → detectarDuplicados() con key estricta
* \#8 Intereses mal clasificados → mapearMovimiento() con signo

### 2\. Empresa Contexto (nombre+RFC visible en todos los módulos)

|Archivo|Acción|Ruta destino|
|-|-|-|
|`empresa-context-bar.tsx`|✨ NUEVO|`src/components/empresa-context-bar.tsx`|
|`sistema-completo.tsx`|🔧 MODIFICADO|`src/components/sistema-completo.tsx`|

**Mejoras:**

* Topbar con badge gradient violeta-azul mostrando empresa activa + RFC
* Barra de contexto bajo header en TODOS los módulos
* Mensajes claros cuando no hay CFDIs (aviso ámbar + selector empresa)

### 3\. DIOT SAT 2025 Oficial (formato carga masiva)

|Archivo|Acción|Ruta destino|
|-|-|-|
|`route.ts`|♻️ REESCRITO|`src/app/api/diot/route.ts`|
|`diot-regiones.ts`|🔧 AMPLIADO|`src/lib/diot-regiones.ts`|

**Implementación:**

* 54 campos oficiales en orden correcto (carga masiva SAT 2025+)
* Excel con 4 hojas: Plantilla oficial, Archivo TXT, Resumen, Catálogo Países
* Catálogo de 56 países del instructivo SAT
* Ajuste Art. 20 CFF (.01-.50 baja, .51-.99 sube)
* Tipos de operación: 02/03/06/07/85/87 según tipo de tercero

## Instalación

### Opción 1: Descomprimir directamente en el repo

```bash
# Clona o navega a tu repo
cd tu-repo-github

# Descomprime el ZIP respetando estructura
unzip sistema-fiscal-ia-v6-github.zip

# Verifica que los archivos están en su lugar
ls src/lib/agentes/conciliador-v6.ts
ls src/components/empresa-context-bar.tsx

# Commit y push
git add .
git commit -m "feat: v6 — Conciliación Maestra + Empresa Contexto + DIOT SAT 2025 oficial"
git push origin main
```

### Opción 2: Copia manual archivo por archivo

```bash
# Crear directorios si no existen
mkdir -p src/lib/agentes
mkdir -p src/app/api/reportes/conciliacion-maestra
mkdir -p src/components
mkdir -p src/app/api/diot

# Copiar archivos
cp conciliador-v6.ts src/lib/agentes/
cp conciliador-inteligente.ts src/lib/agentes/
cp route.ts src/app/api/reportes/conciliacion-maestra/
cp empresa-context-bar.tsx src/components/
cp sistema-completo.tsx src/components/
cp diot/route.ts src/app/api/diot/
cp diot-regiones.ts src/lib/

# Commit y push
git add .
git commit -m "feat: v6 — Conciliación Maestra + Empresa Contexto + DIOT SAT 2025 oficial"
git push origin main
```

## Notas importantes

* ✅ **No requiere migración de BD** — los cambios son solo lógicos
* ✅ **No requiere `npm install`** — no se agregaron dependencias nuevas
* ✅ **Build verificado** — compila exitosamente en \~16s
* ✅ **Endpoints siguen igual**:

  * `GET /api/reportes/conciliacion-maestra?empresaId=X\&anio=2026`
  * `GET /api/diot?mes=7\&anio=2026\&formato=txt|excel|json\&empresaId=X`

## Verificación post-deploy

Después de subir a GitHub y hacer deploy:

1. **Conciliación v6**: Visita el módulo Reportes → Conciliación Maestra, descarga el Excel y verifica:

   * 11 hojas (Dashboard, Operativa, Inversión, ESINAR, Agrupados, CFDIs, etc.)
   * Eficiencia debería subir de 75% → 90%+
   * Hoja "Cuenta Inversión" separada del dashboard operativo
2. **Empresa Contexto**: Navega por diferentes módulos y verifica:

   * Badge con nombre+RFC en topbar
   * Barra de contexto debajo del header en cada módulo
   * Si no hay CFDIs, aviso ámbar con botón para cambiar empresa
3. **DIOT SAT 2025**: Visita módulo DIOT, descarga Excel y verifica:

   * 54 columnas con headers oficiales del SAT
   * Hoja "Archivo TXT" con columna lista para copiar
   * Hoja "Catálogo Países" con 56 países
   * TXT generado con pipes `|` y sin decimales

## Soporte

Si encuentras algún problema después del deploy, revisa:

* Logs del servidor: `vercel logs` o consola local
* Permisos de empresa activa (selector en topbar)
* Que los CFDIs estén asignados a la empresa correcta

