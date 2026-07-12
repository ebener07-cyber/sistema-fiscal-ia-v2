#!/usr/bin/env python3
"""Append new Prisma models for the financial restructuring module."""

target = "/home/z/my-project/nuevo-proyecto/prisma/schema.prisma"
with open(target, "rb") as f:
    data = f.read()

# Strip trailing whitespace
text = data.decode("utf-8")
text = text.rstrip() + "\r\n"

# New models
new_models = '''

// ============================================================================
// MÓDULO: REESTRUCTURA FINANCIERA
// Plan integral de diagnóstico, pago de deudas y construcción de patrimonio.
// Basado en el plan de 3 fases: diagnóstico → reducción deuda → crecimiento.
// ============================================================================

model Activo {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  // Tipo de activo: efectivo, cuenta_bancaria, inversion, bien_raiz, vehiculo, otro
  tipo          String
  nombre        String
  descripcion   String?
  // Valor monetario actual en MXN
  valor         Float    @default(0)
  // Si es liquidez inmediata (efectivo, cuenta de ahorro) vs bien (casa, auto)
  esLiquidable  Boolean  @default(false)
  // Fecha del último valor registrado
  fechaValor    DateTime @default(now())
  // Para inversiones: rendimiento anual esperado (%)
  rendimientoAnual Float?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([empresaId])
  @@index([tipo])
}

model Pasivo {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  // Tipo: prestamo_bancario, tarjeta_credito, prestamo_familiar, credito_hipotecario, otro
  tipo          String
  nombre        String
  descripcion   String?
  // Saldo actual pendiente en MXN
  saldo         Float    @default(0)
  // Tasa de interés MENSUAL en porcentaje (ej. 4 = 4% mensual)
  tasaInteresMensual Float @default(0)
  // Pago mínimo mensual
  pagoMensualMinimo Float @default(0)
  // Fecha límite de pago o vencimiento
  fechaVencimiento DateTime?
  // Acreedor: banco, familiar, etc.
  acreedor      String?
  // Estado: activa, en_negociacion, pagada, reestructurada
  estado        String   @default("activa")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([empresaId])
  @@index([tipo])
  @@index([estado])
}

model FondoEmergencia {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  // Meta del fondo (en MXN). Por defecto $200,000 MXN
  meta          Float    @default(200000)
  // Saldo actual acumulado
  saldoActual   Float    @default(0)
  // Cuenta donde se guarda (debe ser separada de operaciones)
  cuentaDestino String?
  // Activo vinculado (opcional)
  activoId      String?
  // Historial de movimientos del fondo
  movimientos   MovimientoFondo[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([empresaId])
}

model MovimientoFondo {
  id            String   @id @default(cuid())
  fondoId       String
  fondo         FondoEmergencia @relation(fields: [fondoId], references: [id])
  // tipo: deposito, retiro
  tipo          String
  monto         Float
  descripcion   String?
  fecha         DateTime @default(now())
  createdAt     DateTime @default(now())

  @@index([fondoId])
  @@index([fecha])
}

model MovimientoFinanciero {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  // categoria: necesidad, deseo, ahorro_inversion
  categoria     String
  // tipo: ingreso, egreso
  tipo          String
  concepto      String
  monto         Float
  facturaId     String?
  fecha         DateTime @default(now())
  descripcion   String?
  createdAt     DateTime @default(now())

  @@index([empresaId])
  @@index([categoria])
  @@index([tipo])
  @@index([fecha])
}

model Deuda {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  pasivoId      String?
  nombre        String
  acreedor      String
  saldoActual   Float    @default(0)
  tasaInteresMensual Float @default(0)
  pagoMensualMinimo Float @default(0)
  // Estrategia: avalancha, bola_nieve, personalizada
  estrategia    String   @default("avalancha")
  prioridad     Int      @default(99)
  // Estado: activa, en_pago, pagada, reestructurada
  estado        String   @default("activa")
  fechaEstimadaPago DateTime?
  notasRenegociacion String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([empresaId])
  @@index([estado])
  @@index([prioridad])
}

model Inversion {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  // tipo: etf, fondo_deuda, bien_raiz, cesion, otro
  tipo          String
  nombre        String
  descripcion   String?
  montoInvertido Float   @default(0)
  valorActual   Float    @default(0)
  rendimientoAnual Float?
  fechaInversion DateTime @default(now())
  plazoMeses    Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([empresaId])
  @@index([tipo])
}

model Seguro {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  // tipo: gastos_medicos, vida, auto, casa, responsabilidad_civil, otro
  tipo          String
  nombre        String
  aseguradora   String?
  sumaAsegurada Float    @default(0)
  primaMensual  Float    @default(0)
  fechaInicio   DateTime?
  fechaFin      DateTime?
  estado        String   @default("vigente")
  descripcion   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([empresaId])
  @@index([tipo])
  @@index([estado])
}

model MetaFinanciera {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  // Fase del plan: 1 (diagnóstico), 2 (pago deudas), 3 (crecimiento)
  fase          Int      @default(1)
  nombre        String
  descripcion   String?
  meta          Float
  progreso      Float    @default(0)
  fechaObjetivo DateTime?
  estado        String   @default("pendiente")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([empresaId])
  @@index([fase])
  @@index([estado])
}

model KPIFinanciero {
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  fecha         DateTime @default(now())
  patrimonioNeto Float    @default(0)
  activoTotal    Float    @default(0)
  pasivoTotal    Float    @default(0)
  tasaAhorro     Float    @default(0)
  ratioEndeudamiento Float @default(0)
  diasCoberturaCaja Int   @default(0)
  progresoFondoEmergencia Float @default(0)
  totalDeudas    Float    @default(0)
  faseActual     Int      @default(1)
  createdAt      DateTime @default(now())

  @@index([empresaId])
  @@index([fecha])
}
'''

# Convert to CRLF to match the rest of the file
new_models_crlf = new_models.replace('\n', '\r\n')

text += new_models_crlf

with open(target, "wb") as f:
    f.write(text.encode("utf-8"))

print("OK: 10 new models appended to schema.prisma")
print(f"Total lines: {len(text.splitlines())}")
