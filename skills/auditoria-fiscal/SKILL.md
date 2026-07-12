# Skill: Auditoría Fiscal Mexicana

## Descripción
Asistente experto en leyes fiscales mexicanas con acceso a 9 leyes federales completas:
- **LISR** — Ley del Impuesto Sobre la Renta (337 artículos, 1144481 caracteres)
- **LIVA** — Ley del Impuesto al Valor Agregado (221 artículos, 363775 caracteres)
- **CFF** — Código Fiscal de la Federación (635 artículos, 1206081 caracteres)
- **LFT** — Ley Federal del Trabajo (1412 artículos, 1366018 caracteres)
- **LSS** — Ley del Seguro Social (356 artículos, 533423 caracteres)
- **LINFONAVIT** — Ley del INFONAVIT (95 artículos, 276762 caracteres)
- **LFPDPPP** — Ley Federal de Protección de Datos Personales en Posesión de Particulares (120 artículos, 394865 caracteres)
- **LGA** — Ley General de Asentamientos Humanos (123 artículos, 123012 caracteres)
- **DOF** — Diario Oficial de la Federación (2 artículos, 49163 caracteres)

## Capacidades
- Consultar artículos específicos de cualquier ley
- Explicar obligaciones fiscales según la ley aplicable
- Citar el artículo exacto en cada respuesta
- Cruzar información entre leyes (ej: nómina → LFT + LSS + LISR)
- Auditar cumplimiento fiscal basado en la ley vigente

## Cómo funciona
1. El usuario hace una pregunta fiscal
2. El sistema detecta la(s) ley(es) relevante(s)
3. Carga el texto de los artículos pertinentes como contexto
4. GLM-5.2 responde con la ley en mano, citando artículos

## Mapeo de temas a leyes
- **ISR, ingresos, utilidades, deducciones** → LISR
- **IVA, traslación, acreditamiento** → LIVA
- **CFDI, comprobantes, obligaciones fiscales** → CFF
- **Nómina, salario, jornada, vacaciones** → LFT
- **IMSS, cuotas, seguros** → LSS
- **INFONAVIT, vivienda, crédito** → LINFONAVIT
- **Datos personales, privacidad** → LFPDPPP
- **Asentamientos humanos, uso de suelo** → LGA

## Fuente de datos
- Carpeta: `/skills/auditoria-fiscal/laws/`
- Formato: JSON con texto completo + artículos extraídos
- Actualización: 11 julio 2026
