import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/proyectos/conciliacion?empresaId=xxx
 *
 * Para cada proyecto:
 *   - Lee las descripciones (concepto) de las facturas
 *   - Detecta automáticamente direcciones/nombres del proyecto
 *   - Agrupa facturas por cliente y por proyecto
 *   - Cruza con movimientos bancarios (estados de cuenta) para ver si ya se pagaron
 *
 * Heurística de detección de proyecto desde el concepto:
 *   - Códigos: PROY-001, OB-2024-01, PRJ-001
 *   - Palabras clave: obra, construcción, instalación, proyecto
 *   - Nombres de lugares: Av. Reforma, Calle X, Colonia Y
 *   - Nombres del cliente mencionados en el concepto
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Patrones para detectar direcciones en conceptos
const PATRON_DIRECCION = /\b(?:av\.?|avenida|calle|calz\.?|calzada|col\.?|colonia|fracc\.?|fraccionamiento|priv\.?|privada|p\.?|prolongaci[oó]n|retorno|callej[oó]n|manzana|lote|edificio|depto|departamento|interior|n[oó]mero|no\.?)\s*\.?\s*[\wáéíóúñ#.()-]+/gi;

// Patrones para detectar nombres de proyecto en el concepto
const KEYWORDS_PROYECTO = [
  'obra', 'proyecto', 'construccion', 'construcción', 'edificio',
  'casa', 'local', 'oficina', 'remodelacion', 'remodelación',
  'instalacion', 'instalación', 'pavimentacion', 'pavimentación',
  'ampliacion', 'ampliación', 'demolicion', 'demolición',
  'mantenimiento', 'servicio', 'renta', 'arrendamiento',
];

interface FacturaConProyecto {
  facturaId: string;
  folio: string;
  fecha: Date;
  total: number;
  direccion: string; // emitida/recibida
  concepto: string;
  clienteNombre?: string;
  clienteRfc?: string;
  proyectoDetectado: string | null;
  direccionDetectada: string | null;
  pagada: boolean;
  movimientosMatch: any[];
}

function detectarProyectoDeConcepto(concepto: string): string | null {
  if (!concepto) return null;
  const lower = concepto.toLowerCase();

  // 1. Buscar códigos de proyecto (PROY-001, OB-2024-01, etc.)
  const matchCodigo = concepto.match(/\b(PROY|OB|PRJ|PRO|OBRA)[-_\s]?(\d{2,4}[-_]?\d{0,2})\b/i);
  if (matchCodigo) return matchCodigo[0].toUpperCase().replace(/\s+/g, '-');

  // 2. Buscar direcciones
  const matchesDir = concepto.match(PATRON_DIRECCION);
  if (matchesDir && matchesDir.length > 0) {
    return matchesDir[0].trim();
  }

  // 3. Buscar keywords + siguiente palabra
  for (const kw of KEYWORDS_PROYECTO) {
    const idx = lower.indexOf(kw);
    if (idx >= 0) {
      // Tomar 50 caracteres después del keyword como nombre del proyecto
      const despues = concepto.substring(idx, idx + 60).trim();
      // Cortar en el primer separador importante
      const corte = despues.search(/[;,.\n|]/);
      return corte > 0 ? despues.substring(0, corte).trim() : despues;
    }
  }

  return null;
}

function detectarDireccionDeConcepto(concepto: string): string | null {
  if (!concepto) return null;
  const matches = concepto.match(PATRON_DIRECCION);
  return matches && matches.length > 0 ? matches.join(', ') : null;
}

/**
 * Verifica si una factura fue pagada buscando movimientos bancarios que coincidan.
 * Heurística:
 *   - Busca movimientos dentro de 60 días después de la fecha de factura
 *   - Coincidencia por monto (±1%)
 *   - Coincidencia por nombre del cliente/proveedor en el concepto del movimiento
 */
async function cruzarConBancos(
  factura: any,
  empresaId: string,
  tipoBusqueda: 'ingreso' | 'egreso'
): Promise<{ pagada: boolean; movimientosMatch: any[] }> {
  if (!factura.total || factura.total <= 0) return { pagada: false, movimientosMatch: [] };

  // Fecha límite: 90 días después de la factura
  const fechaInicio = new Date(factura.fecha);
  const fechaFin = new Date(fechaInicio);
  fechaFin.setDate(fechaFin.getDate() + 90);

  // Tipo de movimiento esperado:
  //   - Si factura emitida (ingreso): buscar depósitos (monto > 0)
  //   - Si factura recibida (egreso): buscar retiros (monto < 0)
  const montoBuscado = tipoBusqueda === 'ingreso' ? factura.total : -factura.total;
  const margen = Math.abs(montoBuscado) * 0.01; // ±1%

  // Obtener movimientos bancarios de la empresa en ese rango
  const movimientos = await db.movimientoBanco.findMany({
    where: {
      cuenta: { empresaId },
      fecha: { gte: fechaInicio, lte: fechaFin },
    },
    include: { cuenta: { select: { banco: true, cuenta: true } } },
    orderBy: { fecha: 'asc' },
  });

  const matches: any[] = [];

  for (const mov of movimientos) {
    let montoCoincide = false;
    let razonMatch = '';

    // 1. Coincidencia por monto (±1%)
    if (Math.abs(mov.monto - montoBuscado) <= margen) {
      montoCoincide = true;
      razonMatch = 'Monto exacto (±1%)';
    }
    // 2. Coincidencia por monto absoluto sin importar signo
    else if (Math.abs(Math.abs(mov.monto) - Math.abs(montoBuscado)) <= margen) {
      montoCoincide = true;
      razonMatch = 'Monto sin signo';
    }

    if (montoCoincide) {
      // Verificar si el concepto del movimiento menciona al cliente/proveedor
      const conceptoMov = (mov.concepto || '').toLowerCase();
      const nombreBuscar = (tipoBusqueda === 'ingreso'
        ? factura.receptorNombre
        : factura.emisorNombre || '').toLowerCase();

      const nombreCoincide = nombreBuscar && conceptoMov.includes(nombreBuscar.substring(0, 10));
      if (nombreCoincide) razonMatch += ' + nombre del cliente';

      matches.push({
        movimientoId: mov.id,
        fecha: mov.fecha,
        monto: mov.monto,
        concepto: mov.concepto,
        banco: mov.cuenta?.banco,
        cuenta: mov.cuenta?.cuenta,
        razonMatch,
      });
    }
  }

  return {
    pagada: matches.length > 0,
    movimientosMatch: matches,
  };
}

/**
 * POST /api/proyectos/conciliacion?empresaId=xxx
 *
 * ESCANEA TODAS las facturas sin proyecto, detecta el proyecto desde el concepto,
 * crea el proyecto automáticamente si no existe, y asocia la factura con ese proyecto.
 *
 * Después de ejecutar esto, el módulo de Proyectos se llena automáticamente
 * con los proyectos detectados de los conceptos de las facturas.
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');

    if (!empresaId) {
      return NextResponse.json({ error: 'Falta empresaId' }, { status: 400 });
    }

    const empresa = await db.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    // Obtener todas las facturas sin proyecto asignado
    const facturasSinProyecto = await db.factura.findMany({
      where: {
        empresaId,
        proyectoId: null,
        estado: { not: 'cancelada' },
        tipoComprobante: { in: ['I', 'E'] },
      },
    });

    // Crear mapa de proyectos existentes por nombre (case-insensitive)
    const proyectosExistentes = await db.proyecto.findMany({ where: { empresaId } });
    const proyectoMap = new Map<string, string>(); // nombre_lower → id

    for (const p of proyectosExistentes) {
      proyectoMap.set(p.nombre.toLowerCase(), p.id);
      if (p.codigo) proyectoMap.set(p.codigo.toLowerCase(), p.id);
    }

    let proyectosCreados = 0;
    let facturasAsignadas = 0;
    let facturasSinDeteccion = 0;
    const proyectosResumen: any[] = [];
    const asignaciones: any = {}; // proyectoNombre → { count, total, cliente }

    for (const f of facturasSinProyecto) {
      const concepto = f.concepto || '';
      const proyectoDetectado = detectarProyectoDeConcepto(concepto);

      if (!proyectoDetectado) {
        facturasSinDeteccion++;
        continue;
      }

      // Buscar si ya existe el proyecto
      let proyectoId = proyectoMap.get(proyectoDetectado.toLowerCase());

      // Si no existe, crearlo
      if (!proyectoId) {
        const nuevoProyecto = await db.proyecto.create({
          data: {
            nombre: proyectoDetectado,
            codigo: null,
            descripcion: `Proyecto detectado automáticamente del concepto: "${concepto.slice(0, 100)}..."`,
            estado: 'activo',
            empresaId,
            // Asociar cliente si la factura es emitida
            clienteId: f.clienteId || null,
          },
        });
        proyectoId = nuevoProyecto.id;
        proyectoMap.set(proyectoDetectado.toLowerCase(), proyectoId);
        proyectosCreados++;
        proyectosResumen.push({
          nombre: proyectoDetectado,
          facturasCount: 0,
          totalEmitido: 0,
          totalRecibido: 0,
        });
      }

      // Asignar la factura al proyecto
      await db.factura.update({
        where: { id: f.id },
        data: { proyectoId },
      });
      facturasAsignadas++;

      // Actualizar resumen
      if (!asignaciones[proyectoDetectado]) {
        asignaciones[proyectoDetectado] = {
          count: 0,
          totalEmitido: 0,
          totalRecibido: 0,
          cliente: f.receptorNombre || f.emisorNombre,
        };
      }
      asignaciones[proyectoDetectado].count++;
      if (f.direccion === 'emitida') {
        asignaciones[proyectoDetectado].totalEmitido += f.total;
      } else {
        asignaciones[proyectoDetectado].totalRecibido += f.total;
      }
    }

    // Construir respuesta con proyectos y conciliación con bancos
    const proyectosFinales = Object.entries(asignaciones).map(([nombre, stats]: [string, any]) => ({
      nombre,
      ...stats,
    })).sort((a, b) => (b.totalEmitido + b.totalRecibido) - (a.totalEmitido + a.totalRecibido));

    return NextResponse.json({
      success: true,
      totalFacturasEscaneadas: facturasSinProyecto.length,
      proyectosCreados,
      facturasAsignadas,
      facturasSinDeteccion,
      proyectos: proyectosFinales,
      message: `✅ ${proyectosCreados} proyecto(s) creado(s) automáticamente, ${facturasAsignadas} factura(s) asignada(s), ${facturasSinDeteccion} sin proyecto detectable.`,
    });
  } catch (e: any) {
    console.error('Error en POST /api/proyectos/conciliacion:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId') || undefined;

    if (!empresaId) {
      return NextResponse.json({ error: 'Falta empresaId' }, { status: 400 });
    }

    // Obtener todas las facturas de la empresa
    const facturas = await db.factura.findMany({
      where: {
        empresaId,
        estado: { not: 'cancelada' },
        tipoComprobante: { in: ['I', 'E'] }, // Ingreso y Nota de crédito
      },
      include: {
        cliente: { select: { id: true, nombre: true, rfc: true } },
        proveedor: { select: { id: true, nombre: true, rfc: true } },
        proyecto: { select: { id: true, nombre: true, codigo: true } },
      },
      orderBy: { fecha: 'desc' },
    });

    // Procesar cada factura
    const facturasProcesadas: FacturaConProyecto[] = [];

    for (const f of facturas) {
      const concepto = f.concepto || '';

      // Detectar proyecto desde el concepto (si no tiene proyectoId asignado)
      let proyectoDetectado = f.proyecto?.nombre || null;
      if (!proyectoDetectado) {
        proyectoDetectado = detectarProyectoDeConcepto(concepto);
      }

      // Detectar dirección desde el concepto
      const direccionDetectada = detectarDireccionDeConcepto(concepto);

      // Cruzar con bancos
      const tipoBusqueda = f.direccion === 'emitida' ? 'ingreso' : 'egreso';
      const { pagada, movimientosMatch } = await cruzarConBancos(f, empresaId, tipoBusqueda);

      facturasProcesadas.push({
        facturaId: f.id,
        folio: f.serie ? `${f.serie}-${f.folio}` : f.folio,
        fecha: f.fecha,
        total: f.total,
        direccion: f.direccion,
        concepto: concepto.slice(0, 300),
        clienteNombre: f.direccion === 'emitida' ? f.receptorNombre : f.emisorNombre,
        clienteRfc: f.direccion === 'emitida' ? f.receptorRfc : f.emisorRfc,
        proyectoDetectado,
        direccionDetectada,
        pagada,
        movimientosMatch: movimientosMatch.slice(0, 3), // Top 3 matches
      });
    }

    // Agrupar por proyecto detectado
    const porProyecto: Record<string, FacturaConProyecto[]> = {};
    for (const fp of facturasProcesadas) {
      const key = fp.proyectoDetectado || 'Sin proyecto detectado';
      if (!porProyecto[key]) porProyecto[key] = [];
      porProyecto[key].push(fp);
    }

    // Agrupar por cliente
    const porCliente: Record<string, { count: number; total: number; pagadas: number; pendientes: number }> = {};
    for (const fp of facturasProcesadas) {
      const key = fp.clienteNombre || 'Sin cliente';
      if (!porCliente[key]) {
        porCliente[key] = { count: 0, total: 0, pagadas: 0, pendientes: 0 };
      }
      porCliente[key].count++;
      porCliente[key].total += fp.direccion === 'emitida' ? fp.total : -fp.total;
      if (fp.pagada) porCliente[key].pagadas++;
      else porCliente[key].pendientes++;
    }

    // Resumen general de conciliación
    const totalFacturas = facturasProcesadas.length;
    const totalPagadas = facturasProcesadas.filter(f => f.pagada).length;
    const totalPendientes = totalFacturas - totalPagadas;
    const montoTotalEmitido = facturasProcesadas
      .filter(f => f.direccion === 'emitida')
      .reduce((s, f) => s + f.total, 0);
    const montoTotalCobrado = facturasProcesadas
      .filter(f => f.direccion === 'emitida' && f.pagada)
      .reduce((s, f) => s + f.total, 0);
    const montoTotalRecibido = facturasProcesadas
      .filter(f => f.direccion === 'recibida')
      .reduce((s, f) => s + f.total, 0);
    const montoTotalPagado = facturasProcesadas
      .filter(f => f.direccion === 'recibida' && f.pagada)
      .reduce((s, f) => s + f.total, 0);

    return NextResponse.json({
      totalFacturas,
      totalPagadas,
      totalPendientes,
      porcentajeCobranza: totalFacturas > 0 ? Math.round((totalPagadas / totalFacturas) * 100) : 0,
      montoTotalEmitido,
      montoTotalCobrado,
      montoTotalRecibido,
      montoTotalPagado,
      porcentajeMontoCobrado: montoTotalEmitido > 0 ? Math.round((montoTotalCobrado / montoTotalEmitido) * 100) : 0,
      proyectosDetectados: Object.keys(porProyecto).length,
      porProyecto: Object.entries(porProyecto).map(([nombre, facturas]) => ({
        nombre,
        countFacturas: facturas.length,
        totalEmitido: facturas.filter(f => f.direccion === 'emitida').reduce((s, f) => s + f.total, 0),
        totalRecibido: facturas.filter(f => f.direccion === 'recibida').reduce((s, f) => s + f.total, 0),
        pagadas: facturas.filter(f => f.pagada).length,
        pendientes: facturas.filter(f => !f.pagada).length,
        facturas: facturas.slice(0, 20),
      })),
      porCliente: Object.entries(porCliente)
        .map(([nombre, stats]) => ({ nombre, ...stats }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
        .slice(0, 20),
      detalleFacturas: facturasProcesadas.slice(0, 100),
    });
  } catch (e: any) {
    console.error('Error en /api/proyectos/conciliacion:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
