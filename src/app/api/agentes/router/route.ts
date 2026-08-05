import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';

/**
 * ORCHESTRATOR AGENT — Router inteligente para Abbax
 *
 * En lugar de enviar 23 herramientas al LLM en un solo prompt (que confunde),
 * este router analiza la intención del usuario y la enruta al subagente especialista:
 *
 * 1. rag-fiscal     → Preguntas sobre leyes (LISR, LIVA, CFF, etc.)
 * 2. cfdi-validator → Validar facturas/CFDIs
 * 3. erp-query      → Consultas a la BD (facturas, saldos, KPIs)
 * 4. assistant      → Tareas, notas, recordatorios (asistente personal)
 *
 * El router usa GLM-4.6 con un prompt corto + few-shot examples para clasificar.
 * Solo el subagente seleccionado recibe sus tools específicas → menos tokens, mejor precisión.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IntencionSubagente = 'rag-fiscal' | 'cfdi-validator' | 'erp-query' | 'assistant';

interface ResultadoRouting {
  subagente: IntencionSubagente;
  razon: string;
  confianza: number;
}

/**
 * Clasifica la intención del usuario usando un prompt corto con few-shot examples.
 * No necesita tools, solo clasificación.
 */
async function clasificarIntencion(pregunta: string): Promise<ResultadoRouting> {
  const { getZAI } = await import('@/lib/zai');
  const zai = await getZAI();

  const promptClasificador = `Eres un clasificador de intenciones para el asistente fiscal Abbax.
Tu ÚNICA tarea es clasificar el mensaje del usuario en UNA de estas 4 categorías:

- **rag-fiscal**: Preguntas sobre leyes fiscales, artículos, regulaciones, ISR, IVA, CFF, IMSS, INFONAVIT, LFT, deducciones, tarifas, obligaciones, multas, sanciones.
- **cfdi-validator**: Peticiones de validar, revisar, auditar, verificar facturas XML/CFDI, timbre fiscal, UUID, estructura.
- **erp-query**: Consultas sobre datos del sistema: facturas cargadas, saldos bancarios, KPIs, clientes, proveedores, empleados, nómina, proyectos.
- **assistant**: Tareas personales, notas, recordatorios, listas, calculadora, conversión de moneda, frases motivacionales, fecha/hora.

EJEMPLOS:
- "¿Cuál es la tasa de IVA en México?" → rag-fiscal
- "¿Qué dice el artículo 27 de la LISR?" → rag-fiscal
- "Valida este CFDI" → cfdi-validator
- "¿Cuántas facturas emití en enero?" → erp-query
- "¿Cuál es mi saldo bancario?" → erp-query
- "Crea una tarea para pagar impuestos" → assistant
- "Recuérdame llamar al contador mañana" → assistant
- "Convierte 1000 dólares a pesos" → assistant

Responde SOLO con un JSON válido, sin texto adicional:
{"subagente": "<una de las 4 categorías>", "razon": "<breve explicación>", "confianza": <0.0 a 1.0>}

Mensaje del usuario: "${pregunta.replace(/"/g, '\\"')}"`;

  try {
    const respuesta = await zai.chat.completions.create({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: promptClasificador }],
      temperature: 0,
      max_tokens: 200,
    });

    const texto = respuesta.choices[0].message.content || '';
    // Extraer JSON del texto (puede tener markdown fences)
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { subagente: 'assistant', razon: 'No se pudo clasificar, default assistant', confianza: 0.3 };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const subagente = ['rag-fiscal', 'cfdi-validator', 'erp-query', 'assistant'].includes(parsed.subagente)
      ? parsed.subagente
      : 'assistant';

    return {
      subagente: subagente as IntencionSubagente,
      razon: parsed.razon || 'Sin razón',
      confianza: typeof parsed.confianza === 'number' ? parsed.confianza : 0.5,
    };
  } catch (e: any) {
    console.error('Error en clasificador:', e.message);
    // Fallback heurístico por keywords
    const lower = pregunta.toLowerCase();
    if (/\b(ley|art[ií]culo|isr|iva|cff|imss|infonavit|lft|deducci[oó]n|tarifa|multa|sanci[oó]n|obligaci[oó]n)\b/.test(lower)) {
      return { subagente: 'rag-fiscal', razon: 'Fallback heurístico: keywords fiscales', confianza: 0.6 };
    }
    if (/\b(cfdi|factura|xml|uuid|timbre|validar)\b/.test(lower)) {
      return { subagente: 'cfdi-validator', razon: 'Fallback heurístico: keywords CFDI', confianza: 0.6 };
    }
    if (/\b(saldo|facturas|kpi|cliente|proveedor|empleado|n[oó]mina|proyecto|banco|flujo)\b/.test(lower)) {
      return { subagente: 'erp-query', razon: 'Fallback heurístico: keywords ERP', confianza: 0.6 };
    }
    return { subagente: 'assistant', razon: 'Fallback por defecto', confianza: 0.4 };
  }
}

/**
 * POST /api/agentes/router
 *
 * Body: { pregunta: string, empresaId?: string, usuarioId?: string }
 * Response: { subagente, razon, confianza, auditTrailId, endpointSugerido }
 *
 * NO ejecuta el subagente, solo lo clasifica.
 * El frontend decide a qué endpoint llamar después.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pregunta, empresaId, usuarioId } = body as {
      pregunta: string;
      empresaId?: string;
      usuarioId?: string;
    };

    if (!pregunta || typeof pregunta !== 'string') {
      return NextResponse.json({ error: 'pregunta requerida' }, { status: 400 });
    }

    const inicio = Date.now();
    const resultado = await clasificarIntencion(pregunta);
    const duracionMs = Date.now() - inicio;

    // Registrar en audit trail
    const auditTrailId = await registrarAuditTrail({
      agente: 'orchestrator',
      herramienta: 'clasificar_intencion',
      input: { pregunta },
      output: resultado,
      scoreConfianza: resultado.confianza,
      verificado: resultado.confianza >= 0.7,
      observaciones: resultado.razon,
      empresaId,
      usuarioId,
      duracionMs,
    });

    return NextResponse.json({
      ...resultado,
      auditTrailId,
      // Endpoint sugerido para el frontend
      endpointSugerido: {
        'rag-fiscal': '/api/auditoria-fiscal',
        'cfdi-validator': '/api/agentes/cfdi-validator',
        'erp-query': '/api/agentes/erp-query',
        'assistant': '/api/assistant',
      }[resultado.subagente],
    });
  } catch (e: any) {
    console.error('Error en router:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** GET /api/agentes/router — info del orchestrator */
export async function GET() {
  return NextResponse.json({
    nombre: 'Orchestrator Agent (Abbax Router)',
    descripcion: 'Clasifica la intención del usuario y enruta al subagente especialista',
    subagentes: [
      {
        id: 'rag-fiscal',
        nombre: 'Agente RAG Fiscal',
        descripcion: 'Busca y cita artículos de las 9 leyes fiscales (LISR, LIVA, CFF, LFT, LSS, LINFONAVIT, LFPDPPP, LGA, DOF)',
        endpoint: '/api/auditoria-fiscal',
        herramientas: ['buscar_articulo_ley', 'verificar_cita'],
      },
      {
        id: 'cfdi-validator',
        nombre: 'Agente Validador de CFDI',
        descripcion: 'Valida estructura de XML/CFDI contra reglas del SAT',
        endpoint: '/api/agentes/cfdi-validator',
        herramientas: ['validar_estructura_cfdi', 'verificar_uuid_sat'],
      },
      {
        id: 'erp-query',
        nombre: 'Agente ERP Query',
        descripcion: 'Consultas a la BD: facturas, saldos, KPIs, clientes, proveedores, empleados',
        endpoint: '/api/agentes/erp-query',
        herramientas: ['listar_facturas', 'obtener_saldos', 'calcular_kpis'],
      },
      {
        id: 'assistant',
        nombre: 'Agente Asistente Personal',
        descripcion: 'Tareas, notas, recordatorios, calculadora, conversión de moneda',
        endpoint: '/api/assistant',
        herramientas: ['crear_tarea', 'crear_nota', 'crear_recordatorio', 'calcular'],
      },
    ],
  });
}
