import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';

/**
 * MCP SERVER LIGERO — Model Context Protocol (implementación simplificada)
 *
 * Expone tools estandarizadas que pueden ser llamadas por cualquier agente IA.
 * Esto separa la lógica de negocio del LLM, haciendo los agentes más estables
 * y testeables unitariamente.
 *
 * Endpoints:
 *   GET  /api/mcp          → Lista de tools disponibles (manifest)
 *   POST /api/mcp          → Ejecuta una tool: { tool: string, args: object }
 *
 * Tools disponibles:
 *   1. buscar_articulo_cff(frase_clave, ley?)       → Busca artículos en leyes JSON
 *   2. validar_estructura_cfdi(xml_string)           → Valida XML de CFDI
 *   3. consultar_saldo_bancario(empresaId)           → Saldos de cuentas
 *   4. calcular_isr_persona_moral(utilidad)          → ISR 30% persona moral
 *   5. calcular_iva(ventas, compras)                 → IVA por pagar/a favor
 *   6. verificar_rfc(rfc)                            → Valida formato RFC
 *   7. listar_facturas_empresa(empresaId, direccion?) → Facturas de una empresa
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LAWS_DIR = path.join(process.cwd(), 'skills', 'auditoria-fiscal', 'laws');

// ===== MANIFEST DE TOOLS =====
const TOOLS_MANIFEST = [
  {
    name: 'buscar_articulo_cff',
    description: 'Busca artículos en las leyes fiscales mexicanas (LISR, LIVA, CFF, LFT, LSS, LINFONAVIT, LFPDPPP, LGA). Devuelve hasta 5 artículos más relevantes.',
    parameters: {
      type: 'object',
      properties: {
        frase_clave: { type: 'string', description: 'Texto o palabras clave a buscar' },
        ley: { type: 'string', enum: ['LISR', 'LIVA', 'CFF', 'LFT', 'LSS', 'LINFONAVIT', 'LFPDPPP', 'LGA'], description: 'Ley específica (opcional). Si se omite, busca en todas.' },
      },
      required: ['frase_clave'],
    },
  },
  {
    name: 'validar_estructura_cfdi',
    description: 'Valida la estructura XML de un CFDI contra reglas del SAT. Verifica UUID, RFC emisor/receptor, campos obligatorios.',
    parameters: {
      type: 'object',
      properties: {
        xml_string: { type: 'string', description: 'Contenido XML del CFDI' },
      },
      required: ['xml_string'],
    },
  },
  {
    name: 'consultar_saldo_bancario',
    description: 'Consulta los saldos de todas las cuentas bancarias de una empresa.',
    parameters: {
      type: 'object',
      properties: {
        empresaId: { type: 'string', description: 'ID de la empresa' },
      },
      required: ['empresaId'],
    },
  },
  {
    name: 'calcular_isr_persona_moral',
    description: 'Calcula el ISR para persona moral (tasa fija 30% sobre utilidad fiscal). Según LISR Art. 9.',
    parameters: {
      type: 'object',
      properties: {
        utilidad: { type: 'number', description: 'Utilidad fiscal (ingresos - deducciones)' },
      },
      required: ['utilidad'],
    },
  },
  {
    name: 'calcular_iva',
    description: 'Calcula IVA por pagar o a favor. IVA trasladado (16% ventas) - IVA acreditable (16% compras). Según LIVA Art. 1.',
    parameters: {
      type: 'object',
      properties: {
        ventas: { type: 'number', description: 'Base gravable de ventas' },
        compras: { type: 'number', description: 'Base gravable de compras' },
      },
      required: ['ventas', 'compras'],
    },
  },
  {
    name: 'verificar_rfc',
    description: 'Verifica si un RFC tiene formato válido (persona moral 12 chars, física 13 chars).',
    parameters: {
      type: 'object',
      properties: {
        rfc: { type: 'string', description: 'RFC a validar' },
      },
      required: ['rfc'],
    },
  },
  {
    name: 'listar_facturas_empresa',
    description: 'Lista las facturas de una empresa (emitidas o recibidas). Máximo 50 resultados.',
    parameters: {
      type: 'object',
      properties: {
        empresaId: { type: 'string' },
        direccion: { type: 'string', enum: ['emitida', 'recibida'], description: 'Filtrar por dirección' },
        limite: { type: 'number', description: 'Máximo resultados (default 50)' },
      },
      required: ['empresaId'],
    },
  },
  {
    name: 'categorizar_movimiento',
    description: 'Clasifica un movimiento bancario en una categoría contable (Nómina, Proveedores, Comisiones, Transferencias, Renta, Servicios, Impuestos, Inversión, Préstamos, Otros). Primero intenta clasificación determinista por keywords; si falla, usa LLM.',
    parameters: {
      type: 'object',
      properties: {
        concepto: { type: 'string', description: 'Concepto del movimiento bancario' },
        monto: { type: 'number', description: 'Monto del movimiento' },
      },
      required: ['concepto'],
    },
  },
  {
    name: 'categorizar_movimientos_empresa',
    description: 'Clasifica en lote todos los movimientos bancarios sin categoría de una empresa. Devuelve estadísticas de clasificación.',
    parameters: {
      type: 'object',
      properties: {
        empresaId: { type: 'string' },
        limite: { type: 'number', description: 'Máximo movimientos a procesar (default 100)' },
        forzarReclasificar: { type: 'boolean', description: 'Si true, reclasifica incluso los que ya tienen categoría' },
      },
      required: ['empresaId'],
    },
  },
  {
    name: 'conciliar_movimientos_facturas',
    description: 'Concilia movimientos bancarios con facturas (emitidas/recibidas) por monto ±2% y fecha ±3 días. Marca movimientos como conciliados o pendientes de revisión.',
    parameters: {
      type: 'object',
      properties: {
        empresaId: { type: 'string' },
        limite: { type: 'number', description: 'Máximo movimientos a procesar (default 100)' },
        forzarReconciliar: { type: 'boolean', description: 'Si true, re-concilia incluso los ya conciliados' },
      },
      required: ['empresaId'],
    },
  },
  {
    name: 'enmascarar_pii',
    description: 'Enmascara datos sensibles (RFC, números de cuenta, CLABE, emails, teléfonos) en un texto. Útil para logs seguros.',
    parameters: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Texto a enmascarar' },
      },
      required: ['texto'],
    },
  },
];

// ===== IMPLEMENTACIONES DE TOOLS =====

async function toolBuscarArticuloCFF(args: { frase_clave: string; ley?: string }) {
  const leyesABuscar = args.ley ? [args.ley] : ['LISR', 'LIVA', 'CFF', 'LFT', 'LSS', 'LINFONAVIT', 'LFPDPPP', 'LGA'];
  const resultados: any[] = [];

  for (const ley of leyesABuscar) {
    try {
      const filePath = path.join(LAWS_DIR, `${ley}.lite.json`);
      const fileContent = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(fileContent);
      if (!data.articulos) continue;

      const palabras = args.frase_clave.toLowerCase()
        .replace(/[^\w\sáéíóúñ]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length > 3);

      const stopwords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'que', 'en', 'a', 'es', 'para', 'con', 'por']);
      const palabrasFiltradas = palabras.filter((w: string) => !stopwords.has(w));

      const puntuados = data.articulos.map((a: any) => {
        const textoLower = (a.texto || '').toLowerCase();
        let score = 0;
        for (const palabra of palabrasFiltradas) {
          const count = (textoLower.match(new RegExp(palabra, 'g')) || []).length;
          score += count;
        }
        return { articulo: a, score, ley };
      });

      const top = puntuados
        .filter((p: any) => p.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 3);

      resultados.push(...top);
    } catch (e) {
      // Ley no encontrada, continuar
    }
  }

  return {
    encontrados: resultados.length,
    articulos: resultados
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r: any) => ({
        ley: r.ley,
        numero: r.articulo.numero,
        texto: r.articulo.texto?.slice(0, 800),
        score: r.score,
      })),
  };
}

async function toolValidarEstructuraCFDI(args: { xml_string: string }) {
  // Reutiliza la lógica del cfdi-validator agent
  try {
    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true,
    });
    const result = parser.parse(args.xml_string);
    const comprobante = result['cfdi:Comprobante'] || result['Comprobante'];
    if (!comprobante) return { valido: false, error: 'No se encontró cfdi:Comprobante' };

    const getAttr = (obj: any, name: string) => obj ? obj[`@_${name}`] || '' : '';
    const complemento = comprobante['cfdi:Complemento'] || comprobante['Complemento'] || {};
    const timbre = complemento['tfd:TimbreFiscalDigital'] || complemento['TimbreFiscalDigital'] || {};

    return {
      valido: true,
      uuid: getAttr(timbre, 'UUID') || getAttr(timbre, 'uuid'),
      folio: getAttr(comprobante, 'Folio'),
      serie: getAttr(comprobante, 'Serie'),
      fecha: getAttr(comprobante, 'Fecha'),
      total: parseFloat(getAttr(comprobante, 'Total')) || 0,
      tipoComprobante: getAttr(comprobante, 'TipoDeComprobante'),
      emisorRfc: getAttr(comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {}, 'Rfc'),
      receptorRfc: getAttr(comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {}, 'Rfc'),
    };
  } catch (e: any) {
    return { valido: false, error: e.message };
  }
}

async function toolConsultarSaldoBancario(args: { empresaId: string }) {
  const cuentas = await db.cuentaBancaria.findMany({
    where: { empresaId: args.empresaId },
    include: { _count: { select: { movimientos: true } } },
  });
  return {
    cuentas: cuentas.map(c => ({
      banco: c.banco,
      cuenta: c.cuenta,
      tipo: c.tipo,
      saldo: c.saldo,
      movimientos: c._count.movimientos,
    })),
    saldoTotal: cuentas.reduce((s, c) => s + c.saldo, 0),
  };
}

function toolCalcularISRPersonaMoral(args: { utilidad: number }) {
  const isr = args.utilidad > 0 ? args.utilidad * 0.30 : 0;
  return {
    base: args.utilidad,
    tasa: '30%',
    isr: isr,
    utilidadDespuesISR: args.utilidad - isr,
    articulo: 'LISR Art. 9 — Personas morales 2026',
  };
}

function toolCalcularIVA(args: { ventas: number; compras: number }) {
  const ivaTrasladado = args.ventas * 0.16;
  const ivaAcreditable = args.compras * 0.16;
  const ivaPorPagar = ivaTrasladado - ivaAcreditable;
  return {
    ivaTrasladado,
    ivaAcreditable,
    ivaPorPagar,
    concepto: ivaPorPagar >= 0 ? 'IVA por pagar' : 'IVA a favor',
    articulo: 'LIVA Art. 1 — Tasa 16%',
  };
}

function toolVerificarRFC(args: { rfc: string }) {
  const rfc = args.rfc.toUpperCase().trim();
  if (rfc.length === 12) {
    const regex = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
    return { valido: regex.test(rfc), tipo: 'Persona Moral', rfc, razon: regex.test(rfc) ? 'OK' : 'Formato inválido' };
  }
  if (rfc.length === 13) {
    const regex = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
    return { valido: regex.test(rfc), tipo: 'Persona Física', rfc, razon: regex.test(rfc) ? 'OK' : 'Formato inválido' };
  }
  return { valido: false, tipo: 'Desconocido', rfc, razon: `Longitud inválida (${rfc.length}). Debe ser 12 o 13.` };
}

async function toolListarFacturasEmpresa(args: { empresaId: string; direccion?: string; limite?: number }) {
  const where: any = { empresaId: args.empresaId };
  if (args.direccion) where.direccion = args.direccion;
  const facturas = await db.factura.findMany({
    where,
    orderBy: { fecha: 'desc' },
    take: args.limite || 50,
    select: { folio: true, serie: true, fecha: true, total: true, emisorNombre: true, receptorNombre: true, direccion: true, tipoComprobante: true },
  });
  return { count: facturas.length, total: facturas.reduce((s, f) => s + f.total, 0), facturas };
}

async function toolCategorizarMovimiento(args: { concepto: string; monto?: number }) {
  const { clasificarMovimiento } = await import('@/lib/agentes/categorizador');
  return await clasificarMovimiento(args.concepto, args.monto || 0);
}

async function toolCategorizarMovimientosEmpresa(args: { empresaId: string; limite?: number; forzarReclasificar?: boolean }) {
  const { clasificarMovimientosEmpresa } = await import('@/lib/agentes/categorizador');
  return await clasificarMovimientosEmpresa(args.empresaId, {
    limite: args.limite,
    forzarReclasificar: args.forzarReclasificar,
  });
}

async function toolConciliarMovimientosFacturas(args: { empresaId: string; limite?: number; forzarReconciliar?: boolean }) {
  const { conciliarMovimientosConFacturas } = await import('@/lib/agentes/conciliador-banco');
  return await conciliarMovimientosConFacturas(args.empresaId, {
    limite: args.limite,
    forzarReconciliar: args.forzarReconciliar,
  });
}

function toolEnmascararPII(args: { texto: string }) {
  const { maskPII, contienePII, listarTiposPII } = require('@/lib/pii-mask');
  return {
    textoOriginal: args.texto.slice(0, 100) + (args.texto.length > 100 ? '...' : ''),
    textoEnmascarado: maskPII(args.texto),
    conteniaPII: contienePII(args.texto),
    tiposPII: listarTiposPII(),
  };
}

// ===== ROUTER PRINCIPAL MCP =====

async function ejecutarTool(name: string, args: any, empresaId?: string, usuarioId?: string): Promise<any> {
  const inicio = Date.now();
  let output: any = null;
  let error: string | undefined;

  try {
    switch (name) {
      case 'buscar_articulo_cff':
        output = await toolBuscarArticuloCFF(args);
        break;
      case 'validar_estructura_cfdi':
        output = await toolValidarEstructuraCFDI(args);
        break;
      case 'consultar_saldo_bancario':
        output = await toolConsultarSaldoBancario(args);
        break;
      case 'calcular_isr_persona_moral':
        output = toolCalcularISRPersonaMoral(args);
        break;
      case 'calcular_iva':
        output = toolCalcularIVA(args);
        break;
      case 'verificar_rfc':
        output = toolVerificarRFC(args);
        break;
      case 'listar_facturas_empresa':
        output = await toolListarFacturasEmpresa(args);
        break;
      case 'categorizar_movimiento':
        output = await toolCategorizarMovimiento(args);
        break;
      case 'categorizar_movimientos_empresa':
        output = await toolCategorizarMovimientosEmpresa(args);
        break;
      case 'conciliar_movimientos_facturas':
        output = await toolConciliarMovimientosFacturas(args);
        break;
      case 'enmascarar_pii':
        output = toolEnmascararPII(args);
        break;
      default:
        throw new Error(`Tool '${name}' no encontrada. Tools disponibles: ${TOOLS_MANIFEST.map(t => t.name).join(', ')}`);
    }
  } catch (e: any) {
    error = e.message;
  }

  const duracionMs = Date.now() - inicio;
  await registrarAuditTrail({
    agente: 'mcp-server',
    herramienta: name,
    input: args,
    output,
    error,
    empresaId: args.empresaId || empresaId,
    usuarioId,
    duracionMs,
  });

  if (error) throw new Error(error);
  return output;
}

/** GET /api/mcp — Manifest de tools disponibles */
export async function GET() {
  return NextResponse.json({
    nombre: 'MCP Server Ligero — Sistema Fiscal IA',
    version: '1.0.0',
    descripcion: 'Servidor de tools estandarizadas para agentes IA (Model Context Protocol simplificado)',
    tools: TOOLS_MANIFEST,
  });
}

/** POST /api/mcp — Ejecuta una tool */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tool, args, empresaId, usuarioId } = body as {
      tool: string;
      args: any;
      empresaId?: string;
      usuarioId?: string;
    };

    if (!tool) return NextResponse.json({ error: 'tool requerida' }, { status: 400 });
    const argsObj = (!args || typeof args !== 'object') ? {} : args;

    const resultado = await ejecutarTool(tool, argsObj, empresaId, usuarioId);
    return NextResponse.json({ success: true, tool, resultado });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
