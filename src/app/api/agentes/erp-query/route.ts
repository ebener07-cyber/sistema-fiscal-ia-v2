import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';

/**
 * ERP-QUERY AGENT — Subagente especialista en consultas a la BD
 *
 * Este agente NO usa LLM para generar SQL (peligroso).
 * En su lugar, usa LLM para clasificar QUÉ consulta hacer, y luego
 * ejecuta funciones Prisma predefinidas.
 *
 * Consultas soportadas:
 * 1. listar_facturas(empresaId, direccion?, mes?, anio?)
 * 2. obtener_saldos_bancarios(empresaId)
 * 3. obtener_kpis(empresaId)
 * 4. listar_clientes(empresaId, busqueda?)
 * 5. listar_proveedores(empresaId, busqueda?)
 * 6. obtener_nomina(empresaId, mes?, anio?)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TipoConsulta =
  | 'listar_facturas'
  | 'obtener_saldos_bancarios'
  | 'obtener_kpis'
  | 'listar_clientes'
  | 'listar_proveedores'
  | 'obtener_nomina'
  | 'desconocido';

interface ResultadoClasificacion {
  consulta: TipoConsulta;
  parametros: any;
  razon: string;
}

async function clasificarConsultaERP(pregunta: string, empresaId?: string): Promise<ResultadoClasificacion> {
  const { getZAI } = await import('@/lib/zai');
  const zai = await getZAI();

  const prompt = `Eres un clasificador de consultas para el ERP de un sistema fiscal mexicano.
Tu tarea es identificar QUÉ consulta de BD quiere hacer el usuario y extraer los parámetros.

Consultas disponibles:
1. **listar_facturas**: Ver facturas emitidas/recibidas. Params: direccion ("emitida"|"recibida"), mes (1-12), anio (YYYY)
2. **obtener_saldos_bancarios**: Ver saldos de cuentas bancarias. Sin params.
3. **obtener_kpis**: Ver KPIs del dashboard (ingresos, egresos, utilidad). Sin params.
4. **listar_clientes**: Listar/buscar clientes. Params: busqueda (texto)
5. **listar_proveedores**: Listar/buscar proveedores. Params: busqueda (texto)
6. **obtener_nomina**: Ver nómina. Params: mes (1-12), anio (YYYY)

EJEMPLOS:
- "¿Cuántas facturas emití en enero 2026?" → {"consulta":"listar_facturas","parametros":{"direccion":"emitida","mes":1,"anio":2026}}
- "¿Cuál es mi saldo bancario?" → {"consulta":"obtener_saldos_bancarios","parametros":{}}
- "Muéstrame mis KPIs" → {"consulta":"obtener_kpis","parametros":{}}
- "Busca el cliente ACME" → {"consulta":"listar_clientes","parametros":{"busqueda":"ACME"}}
- "¿Qué nómina pagué en febrero?" → {"consulta":"obtener_nomina","parametros":{"mes":2}}

Si la fecha no se menciona, usa el mes/año actual.
Si no coincide con ninguna, devuelve: {"consulta":"desconocido","parametros":{}}

Responde SOLO con JSON válido:
{"consulta":"...","parametros":{...},"razon":"..."}

Mensaje: "${pregunta.replace(/"/g, '\\"')}"`;

  try {
    const respuesta = await zai.chat.completions.create({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 200,
    });
    const texto = respuesta.choices[0].message.content || '';
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { consulta: 'desconocido', parametros: {}, razon: 'No se pudo parsear' };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      consulta: parsed.consulta || 'desconocido',
      parametros: parsed.parametros || {},
      razon: parsed.razon || '',
    };
  } catch (e: any) {
    console.error('Error clasificando ERP:', e.message);
    return { consulta: 'desconocido', parametros: {}, razon: e.message };
  }
}

async function ejecutarConsulta(consulta: TipoConsulta, params: any, empresaId?: string) {
  if (!empresaId) throw new Error('empresaId requerido para consultas ERP');

  const ahora = new Date();
  const mesDefault = params.mes || (ahora.getMonth() + 1);
  const anioDefault = params.anio || ahora.getFullYear();

  switch (consulta) {
    case 'listar_facturas': {
      const where: any = { empresaId };
      if (params.direccion) where.direccion = params.direccion;
      if (params.mes && params.anio) {
        where.fecha = {
          gte: new Date(params.anio, params.mes - 1, 1),
          lte: new Date(params.anio, params.mes, 0, 23, 59, 59),
        };
      }
      const facturas = await db.factura.findMany({
        where,
        orderBy: { fecha: 'desc' },
        take: 50,
        select: {
          folio: true, serie: true, fecha: true, total: true,
          emisorNombre: true, receptorNombre: true, direccion: true,
          tipoComprobante: true, estado: true,
        },
      });
      const total = facturas.reduce((s, f) => s + f.total, 0);
      return { facturas, count: facturas.length, total };
    }

    case 'obtener_saldos_bancarios': {
      const cuentas = await db.cuentaBancaria.findMany({
        where: { empresaId },
        include: { _count: { select: { movimientos: true } } },
      });
      const saldoTotal = cuentas.reduce((s, c) => s + c.saldo, 0);
      return { cuentas, saldoTotal };
    }

    case 'obtener_kpis': {
      const inicioMes = new Date(anioDefault, mesDefault - 1, 1);
      const finMes = new Date(anioDefault, mesDefault, 0, 23, 59, 59);
      const [emitidas, recibidas] = await Promise.all([
        db.factura.findMany({
          where: { empresaId, direccion: 'emitida', fecha: { gte: inicioMes, lte: finMes } },
          select: { total: true, totalImpuestos: true },
        }),
        db.factura.findMany({
          where: { empresaId, direccion: 'recibida', fecha: { gte: inicioMes, lte: finMes } },
          select: { total: true, totalImpuestos: true },
        }),
      ]);
      return {
        periodo: { mes: mesDefault, anio: anioDefault },
        emitidas: {
          count: emitidas.length,
          total: emitidas.reduce((s, f) => s + f.total, 0),
          iva: emitidas.reduce((s, f) => s + f.totalImpuestos, 0),
        },
        recibidas: {
          count: recibidas.length,
          total: recibidas.reduce((s, f) => s + f.total, 0),
          iva: recibidas.reduce((s, f) => s + f.totalImpuestos, 0),
        },
        utilidadBruta: emitidas.reduce((s, f) => s + f.total, 0) - recibidas.reduce((s, f) => s + f.total, 0),
      };
    }

    case 'listar_clientes': {
      const where: any = { empresaId };
      if (params.busqueda) {
        where.OR = [
          { nombre: { contains: params.busqueda, mode: 'insensitive' } },
          { rfc: { contains: params.busqueda, mode: 'insensitive' } },
        ];
      }
      const clientes = await db.cliente.findMany({
        where,
        take: 20,
        include: { _count: { select: { facturas: true } } },
        orderBy: { nombre: 'asc' },
      });
      return { clientes, count: clientes.length };
    }

    case 'listar_proveedores': {
      const where: any = { empresaId };
      if (params.busqueda) {
        where.OR = [
          { nombre: { contains: params.busqueda, mode: 'insensitive' } },
          { rfc: { contains: params.busqueda, mode: 'insensitive' } },
        ];
      }
      const proveedores = await db.proveedor.findMany({
        where,
        take: 20,
        include: { _count: { select: { facturas: true } } },
        orderBy: { nombre: 'asc' },
      });
      return { proveedores, count: proveedores.length };
    }

    case 'obtener_nomina': {
      const inicioMes = new Date(anioDefault, mesDefault - 1, 1);
      const finMes = new Date(anioDefault, mesDefault, 0, 23, 59, 59);
      const recibos = await db.reciboNomina.findMany({
        where: { empresaId, fecha: { gte: inicioMes, lte: finMes } },
        include: { empleado: { select: { nombre: true, rfc: true, puesto: true } } },
        orderBy: { fecha: 'desc' },
      });
      return {
        periodo: { mes: mesDefault, anio: anioDefault },
        recibos,
        count: recibos.length,
        totalPercepciones: recibos.reduce((s, r) => s + r.totalPercepciones, 0),
        totalNeto: recibos.reduce((s, r) => s + r.neto, 0),
      };
    }

    default:
      return { error: 'Consulta no reconocida. Consultas disponibles: listar_facturas, obtener_saldos_bancarios, obtener_kpis, listar_clientes, listar_proveedores, obtener_nomina' };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pregunta, empresaId, usuarioId } = body as {
      pregunta: string;
      empresaId?: string;
      usuarioId?: string;
    };

    if (!pregunta) return NextResponse.json({ error: 'pregunta requerida' }, { status: 400 });

    const inicio = Date.now();
    const clasificacion = await clasificarConsultaERP(pregunta, empresaId);
    let resultado: any = null;
    let error: string | undefined;

    if (clasificacion.consulta !== 'desconocido') {
      try {
        resultado = await ejecutarConsulta(clasificacion.consulta, clasificacion.parametros, empresaId);
      } catch (e: any) {
        error = e.message;
      }
    } else {
      error = 'No se pudo determinar la consulta. Sé más específico.';
    }

    const duracionMs = Date.now() - inicio;
    const auditTrailId = await registrarAuditTrail({
      agente: 'erp-query',
      herramienta: clasificacion.consulta,
      input: { pregunta, parametros: clasificacion.parametros, empresaId },
      output: resultado,
      error,
      empresaId,
      usuarioId,
      duracionMs,
    });

    return NextResponse.json({
      consulta: clasificacion.consulta,
      parametros: clasificacion.parametros,
      razon: clasificacion.razon,
      resultado,
      error,
      auditTrailId,
      duracionMs,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
