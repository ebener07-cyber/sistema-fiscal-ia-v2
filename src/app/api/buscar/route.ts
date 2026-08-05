import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/buscar?q={query}&empresaId={empresaId}
 *
 * Búsqueda global en clientes, proveedores, facturas y empleados.
 *
 * Mantiene compatibilidad con la búsqueda anterior (tareas/notas/recordatorios)
 * si no se envía empresaId, agregando esas categorías al resultado.
 *
 * Devuelve: { query, total, clientes, proveedores, facturas, empleados, tareas?, notas?, recordatorios? }
 * Cada categoría limitada a 5 resultados.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const empresaId = searchParams.get('empresaId');

  if (!q || q.length < 2) {
    return NextResponse.json({
      query: q || '',
      total: 0,
      clientes: [],
      proveedores: [],
      facturas: [],
      empleados: [],
    });
  }

  // Condición de empresa compartida
  const empresaFilter = empresaId ? { empresaId } : {};

  // Búsquedas en paralelo para minimizar latencia
  // (Las búsquedas de Abbax — tareas/notas/recordatorios — solo se ejecutan si no hay empresaId,
  //  para preservar el comportamiento original del endpoint)
  const queries: Promise<any[]>[] = [
    // Clientes: nombre o RFC
    db.cliente.findMany({
      where: {
        ...empresaFilter,
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { rfc: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, nombre: true, rfc: true, email: true, telefono: true, saldo: true, empresaId: true },
    }),
    // Proveedores: nombre o RFC
    db.proveedor.findMany({
      where: {
        ...empresaFilter,
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { rfc: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { servicio: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, nombre: true, rfc: true, servicio: true, email: true, telefono: true, saldo: true, empresaId: true },
    }),
    // Facturas: folio, uuid, RFC del emisor/receptor, nombre del emisor/receptor
    db.factura.findMany({
      where: {
        ...empresaFilter,
        OR: [
          { folio: { contains: q, mode: 'insensitive' } },
          { uuid: { contains: q, mode: 'insensitive' } },
          { emisorRfc: { contains: q, mode: 'insensitive' } },
          { receptorRfc: { contains: q, mode: 'insensitive' } },
          { emisorNombre: { contains: q, mode: 'insensitive' } },
          { receptorNombre: { contains: q, mode: 'insensitive' } },
          { concepto: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      orderBy: { fecha: 'desc' },
      select: {
        id: true, folio: true, serie: true, fecha: true, total: true,
        direccion: true, tipoComprobante: true, uuid: true,
        emisorRfc: true, emisorNombre: true,
        receptorRfc: true, receptorNombre: true,
        empresaId: true,
      },
    }),
    // Empleados: nombre, RFC, puesto, departamento
    db.empleado.findMany({
      where: {
        ...empresaFilter,
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { rfc: { contains: q, mode: 'insensitive' } },
          { curp: { contains: q, mode: 'insensitive' } },
          { puesto: { contains: q, mode: 'insensitive' } },
          { departamento: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, nombre: true, rfc: true, puesto: true, departamento: true, status: true, salarioMensual: true, empresaId: true },
    }),
  ];

  // Si no hay empresaId, mantener compatibilidad con búsqueda de Abbax (tareas/notas/recordatorios)
  if (!empresaId) {
    queries.push(
      db.tarea.findMany({
        where: { OR: [{ titulo: { contains: q } }, { descripcion: { contains: q } }, { categoria: { contains: q } }] },
        orderBy: [{ prioridad: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }) as Promise<any[]>,
      db.nota.findMany({
        where: { archivada: false, OR: [{ titulo: { contains: q } }, { contenido: { contains: q } }] },
        orderBy: [{ fijada: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }) as Promise<any[]>,
      db.recordatorio.findMany({
        where: { OR: [{ titulo: { contains: q } }, { descripcion: { contains: q } }] },
        orderBy: { fechaHora: 'asc' },
        take: 5,
      }) as Promise<any[]>
    );
  }

  const results = await Promise.all(queries);
  const [clientes, proveedores, facturas, empleados] = results;

  const total = clientes.length + proveedores.length + facturas.length + empleados.length;

  const response: any = {
    query: q,
    total,
    clientes,
    proveedores,
    facturas,
    empleados,
  };

  // Incluir resultados de Abbax si se consultaron
  if (!empresaId) {
    const [tareas, notas, recordatorios] = results.slice(4);
    response.tareas = tareas;
    response.notas = notas;
    response.recordatorios = recordatorios;
    response.total = total + tareas.length + notas.length + recordatorios.length;
  }

  return NextResponse.json(response);
}
