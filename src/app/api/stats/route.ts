import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const ahora = new Date();
  const inicioHoy = new Date(ahora);
  inicioHoy.setHours(0, 0, 0, 0);
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  // Facturas del mes
  const [emitidasMes, recibidasMes] = await Promise.all([
    db.factura.findMany({ where: { direccion: 'emitida', fecha: { gte: inicioMes } } }),
    db.factura.findMany({ where: { direccion: 'recibida', fecha: { gte: inicioMes } } }),
  ]);

  const totalEmitido = emitidasMes.reduce((s, f) => s + f.total, 0);
  const ivaEmitido = emitidasMes.reduce((s, f) => s + f.totalImpuestos, 0);
  const totalRecibido = recibidasMes.reduce((s, f) => s + f.total, 0);
  const ivaRecibido = recibidasMes.reduce((s, f) => s + f.totalImpuestos, 0);
  const ivaPorPagar = ivaEmitido - ivaRecibido;
  const utilidadBruta = totalEmitido - totalRecibido;

  // Conteos
  const [clientes, proveedores, empleados, productos, tareasPend, notas, recordatorios, conversacionesHoy] = await Promise.all([
    db.cliente.count(),
    db.proveedor.count(),
    db.empleado.count({ where: { status: 'activo' } }),
    db.producto.count(),
    db.tarea.count({ where: { estado: 'pendiente' } }),
    db.nota.count({ where: { archivada: false } }),
    db.recordatorio.count({ where: { estado: 'pendiente', fechaHora: { gte: ahora } } }),
    db.conversacion.count({ where: { createdAt: { gte: inicioHoy } } }),
  ]);

  // Top 3 clientes
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

  // Stock bajo
  const stockBajo = await db.producto.count({ where: { existencia: { lte: 0 } } });

  return NextResponse.json({
    fiscal: {
      totalEmitido,
      ivaEmitido,
      totalRecibido,
      ivaRecibido,
      ivaPorPagar,
      utilidadBruta,
      countEmitidas: emitidasMes.length,
      countRecibidas: recibidasMes.length,
    },
    catalogos: {
      clientes,
      proveedores,
      empleados,
      productos,
      stockBajo,
    },
    abbax: {
      tareasPend,
      notas,
      recordatorios,
      conversacionesHoy,
    },
    topClientes,
    fecha: ahora.toISOString(),
  });
}
