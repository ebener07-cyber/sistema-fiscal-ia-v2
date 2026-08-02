---
Task ID: 1
Agent: Main Agent (Super Z)
Task: Corregir CFDIs mezclados entre empresas + rediseñar Bancos/SAT/Clientes/Proveedores/Empleados + arreglar cuenta Inversión + Dashboard

Work Log:
- Diagnóstico completo de BD Neon: detecté que ELECTRONICMA tenía 58 emisores distintos en sus "emitidas" (solo 1 correcto: ALO980508ID6)
- Creado script `/scripts/limpiar-cfdi-mezclados.ts` que reasigna facturas por RFC del emisor/receptor
- Ejecutada limpieza: 40 facturas reasignadas de ELECTRONICMA → RIDEN (todas tenían receptor MARR721006SJ3)
- Resumen final post-limpieza:
  * ELECTRONICMA: 190 facturas emitidas (189 tipo I + 1 NC tipo E)
  * RIDEN: 103 emitidas + 562 recibidas + 2 NC recibidas
- Modificada API `/api/facturas/route.ts` con DEFENSA DOBLE:
  * Si no viene empresaId → devuelve vacío
  * Si direccion=emitida → filtra donde emisorRfc = empresa.rfc
  * Si direccion=recibida → filtra donde receptorRfc = empresa.rfc
- Rediseñado BancosView con pestañas mensuales estilo Nómina:
  * Botón "Todo {año}" + 12 botones de mes (Ene, Feb, Mar...) con contador de movimientos
  * KPIs (Ingresos, Egresos, Flujo neto, Movimientos) adaptables a mes/año
  * Cuentas con iconos según tipo (operaciones=💳, ahorro=🏦, inversión=📈)
  * Resumen anual carga en paralelo
- Modificada API `/api/bancos/route.ts` para soportar `all=true` (sin paginar)
- Rediseñado SatView con pestañas mensuales mejoradas (mismo estilo que BancosView/NominaView):
  * Contador de CFDIs por mes (data.resumenMensual)
  * Tooltip con detalle por mes
- Rediseñado ProveedoresView como agenda profesional:
  * Buscador por nombre/RFC/email + filtro por servicio
  * Tabla tipo agenda con avatares de iniciales
  * KPIs: total proveedores, órdenes, saldo pendiente
- Rediseñado EmpleadosView como agenda interactiva:
  * Vista Cards (default) + Vista Tabla (toggle)
  * Filtro por estado: Todos / Activos / Inactivos
  * Buscador por nombre/RFC/puesto/departamento
  * Cards con avatar, badge activo/inactivo, salario destacado
  * KPIs: total, nómina mensual, nómina anual, promedio salario
- Mejorado DashboardView para casos sin datos:
  * Manejo seguro de stats null/undefined
  * Banner informativo si la empresa no tiene CFDIs en el periodo
  * Botón directo al módulo SAT para cargar CFDIs
  * Gráficos muestran EmptyState en lugar de gráfica vacía
- Mejorado parser PDF (`/api/upload-estado-cuenta/route.ts`):
  * Creada función `parsePDFTextoMultiCuenta` que detecta secciones de cuenta
  * Headers detectados: "ENLACE NEGOCIOS AVANZADA" (operaciones), "INVERSION ENLACE NEGOCIOS" (inversión)
  * Cuando detecta múltiples secciones, busca/crea cuenta de inversión y asigna movimientos automáticamente
  * Cada movimiento se marca con flag `esInversion` para enrutarlo a la cuenta correcta
- Arreglado bug en upload-cfdi: variable `forzar` ahora se declara a nivel superior (afectaba también a ZIPs)
- Build de Next.js exitoso: ✓ Compiled successfully in 12.9s, 28 static pages generadas

Stage Summary:
- BD Neon: 40 CFDIs reasignados correctamente entre ELECTRONICMA y RIDEN
- API facturas: defensa doble por empresaId + RFC
- BancosView: pestañas mensuales estilo Nómina con contador por mes
- SatView: pestañas mensuales con contador de CFDIs por mes
- ClientesView: ya tenía agenda profesional (sin cambios)
- ProveedoresView: rediseñado como agenda con búsqueda y filtro por servicio
- EmpleadosView: rediseñado como agenda interactiva con cards/tabla + filtro activos/inactivos
- DashboardView: manejo robusto de datos vacíos + banner informativo
- Parser PDF: detecta 2 cuentas en mismo PDF (operaciones + inversión)
- Build exitoso, listo para deploy en Vercel

---
Task ID: 2
Agent: Main Agent (Super Z)
Task: Corregir SAT emitidas sin datos + agregar cuenta Santander + soporte PDF Santander

Work Log:
- Diagnosticado el problema: ELECTRONICMA tenía 190 emitidas en BD pero solo 96 con RFC matching (ALO980508ID6)
- Las 94 restantes eran facturas de proveedores (CFE, BANORTE, IMSS, HOME DEPOT, etc.) mal clasificadas como 'emitidas'
- Script `convertir-mal-clasificadas.ts` las convirtió a `direccion='recibida'` (94 convertidas)
- Quitado el filtro RFC restrictivo de la API GET /api/facturas (mantener solo filtro empresaId)
- Estado final BD: ELECTRONICMA tiene 96 emitidas propias + 94+1 NC recibidas correctamente
- Analizado PDF Santander (`52582519_Santander-Enero.pdf`):
  * Formato fecha: DD-ENE-2026 (compatible con parser Banorte existente)
  * Estructura: línea de fecha + descripción + línea con monto y saldo
  * Headers: "CUENTA SANTANDER PYME" (operaciones), "INVERSION CRECIENTE" (inversión)
  * Número cuenta: 65-50908535-6 (formato DD-NNNNNNNN-D)
- Probado parser actual con PDF Santander: detecta 30 movimientos con signos correctos
- Agregada cuenta Santander a BD de ELECTRONICMA (SANTANDER 65-50908535-6, tipo operaciones)
- Subidos 30 movimientos del PDF Santander-Enero a la BD (saldo final: $-45,712.01)
- Mejorado parser con keywords Santander: ABONO (depósito), CGO/CARGO CAPITAL/CARGO POR/CGO INTERESES (retiro)
- Agregada auto-detección de banco desde PDF en upload-estado-cuenta:
  * Detecta SANTANDER si el texto contiene "SANTANDER"
  * Detecta BANORTE si el texto contiene "BANORTE" o "BANCO MERCANTIL DEL NORTE"
  * Extrae número de cuenta automáticamente (formato DD-NNNNNNNN-D para Santander)
  * Si la cuenta no existe, la crea automáticamente
  * Si la cuenta existe pero es diferente a la seleccionada, redirige los movimientos a la correcta
- Build exitoso, ZIP generado (3.23 MB, 196 archivos)

Stage Summary:
- BD: 94 facturas corregidas (emitidas → recibidas) para ELECTRONICMA
- API facturas: filtro solo por empresaId (sin filtro RFC restrictivo)
- Cuenta Santander: creada en BD con 30 movimientos de enero 2026
- Parser PDF: detecta automáticamente Santander y Banorte
- Auto-detección: busca/crea cuenta correcta al subir PDF
- ZIP listo para deploy
