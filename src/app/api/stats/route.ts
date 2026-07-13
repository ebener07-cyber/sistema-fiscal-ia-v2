import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const ahora = new Date();
    const inicioHoy = new Date(ahora);
    inicioHoy.setHours(0, 0, 0, 0);
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

    // Filtro por empresa (todas las consultas lo aplican si llega ?empresaId=)
    const url = new URL(req.url);
    const empresaId = url.searchParams.get('empresaId') || undefined;
    const filtroEmpresa = empresaId ? { empresaId } : {};
    const filtroEmpresaFactura = empresaId ? { empresaId, direccion: 'emitida' as const } : { direccion: 'emitida' as const };
    const filtroEmpresaFacturaRec = empresaId ? { empresaId, direccion: 'recibida' as const } : { direccion: 'recibida' as const };

    // Facturas del mes
    const [emitidasMes, recibidasMes] = await Promise.all([
      db.factura.findMany({ where: { ...filtroEmpresaFactura, fecha: { gte: inicioMes } } }),
      db.factura.findMany({ where: { ...filtroEmpresaFacturaRec, fecha: { gte: inicioMes } } }),
    ]);

    const totalEmitido = emitidasMes.reduce((s, f) => s + f.total, 0);
    const ivaEmitido = emitidasMes.reduce((s, f) => s + f.totalImpuestos, 0);
    const totalRecibido = recibidasMes.reduce((s, f) => s + f.total, 0);
    const ivaRecibido = recibidasMes.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaPorPagar = ivaEmitido - ivaRecibido;
    const utilidadBruta = totalEmitido - totalRecibido;

    const [clientes, proveedores, empleados, productos, tareasPend, notas, recordatorios, conversacionesHoy] = await Promise.all([
      db.cliente.count({ where: filtroEmpresa }),
      db.proveedor.count({ where: filtroEmpresa }),
      db.empleado.count({ where: { ...filtroEmpresa, status: 'activo' } }),
      db.producto.count({ where: filtroEmpresa }),
      db.tarea.count({ where: { estado: 'pendiente' } }),
      db.nota.count({ where: { archivada: false } }),
      db.recordatorio.count({ where: { estado: 'pendiente', fechaHora: { gte: ahora } } }),
      db.conversacion.count({ where: { createdAt: { gte: inicioHoy } } }),
    ]);

    const topClientesMap = new Map<string, { nombre: string; rfc: string; total: number; count: number }>();
    for (const f of emitidasMes) {
      if (!f.receptorRfc) continue;
      const existing = topClientesMap.get(f.receptorRfc);
      if (existing) {
        existing.total += f.total;
        existing.count += 1;
      } else {
        topClientesMap.set(f.receptorRfc, {
          nombre: f.receptorNombre || 'Sin nombre',
          rfc: f.receptorRfc,
          total: f.total,
          count: 1,
        });
      }
    }
    const topClientes = Array.from(topClientesMap.values()).sort((a, b) => b.total - a.total).slice(0, 3);

    const stockBajo = await db.producto.count({ where: { ...filtroEmpresa, existencia: { lte: 0 } } });

    return NextResponse.json({
      fiscal: {
        totalEmitido, ivaEmitido, totalRecibido, ivaRecibido, ivaPorPagar, utilidadBruta,
        countEmitidas: emitidasMes.length, countRecibidas: recibidasMes.length,
      },
      catalogos: { clientes, proveedores, empleados, productos, stockBajo },
      abbax: { tareasPend, notas, recordatorios, conversacionesHoy },
      topClientes,
      fecha: ahora.toISOString(),
    });
  } catch (error: any) {
    // Si la BD no está configurada o hay error, devolver estructura vacía
    // en vez de colgarse para que el dashboard muestre ceros
    console.error('Error en /api/stats:', error.message);
    return NextResponse.json({
      fiscal: {
        totalEmitido: 0, ivaEmitido: 0, totalRecibido: 0, ivaRecibido: 0,
        ivaPorPagar: 0, utilidadBruta: 0, countEmitidas: 0, countRecibidas: 0,
      },
      catalogos: { clientes: 0, proveedores: 0, empleados: 0, productos: 0, stockBajo: 0 },
      abbax: { tareasPend: 0, notas: 0, recordatorios: 0, conversacionesHoy: 0 },
      topClientes: [],
      fecha: new Date().toISOString(),
      error: 'BD no disponible — ejecuta prisma db push y seed en producción',
    });
  }
}
