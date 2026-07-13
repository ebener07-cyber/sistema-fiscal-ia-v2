import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/empresas/[id] — Detalle de una empresa */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const empresa = await db.empresa.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            clientes: true,
            proveedores: true,
            facturas: true,
            empleados: true,
            usuarios: true,
            cuentas: true,
            productos: true,
          },
        },
      },
    });

    if (!empresa) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json(empresa);
  } catch (e: any) {
    console.error('Error en /api/empresas/[id] GET:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/empresas/[id] — Eliminar empresa y todos sus datos relacionados */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verificar que existe
    const empresa = await db.empresa.findUnique({ where: { id } });
    if (!empresa) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404 }
      );
    }

    // Eliminar en cascada: primero los hijos, luego la empresa
    // Prisma onDelete: SetNull o Cascade ya configurado en schema, pero
    // para evitar errores de integridad, eliminamos explícitamente los relacionados
    // Eliminación en cascada manual — primero los hijos con FK a empresa,
    // luego los hijos de esos hijos, finalmente la empresa
    await db.$transaction([
      // Recibos de nómina cuelgan de Empleado
      db.reciboNomina.deleteMany({
        where: { empleado: { empresaId: id } },
      }),
      // Órdenes de compra cuelgan de Proveedor
      db.ordenCompra.deleteMany({
        where: { proveedor: { empresaId: id } },
      }),
      // Movimientos bancarios cuelgan de CuentaBancaria
      db.movimientoBanco.deleteMany({
        where: { cuenta: { empresaId: id } },
      }),
      // Facturas, Empleados, Clientes, Proveedores, Productos, Cuentas — directa empresaId
      db.factura.deleteMany({ where: { empresaId: id } }),
      db.empleado.deleteMany({ where: { empresaId: id } }),
      db.cliente.deleteMany({ where: { empresaId: id } }),
      db.proveedor.deleteMany({ where: { empresaId: id } }),
      db.producto.deleteMany({ where: { empresaId: id } }),
      db.cuentaBancaria.deleteMany({ where: { empresaId: id } }),
      // Usuarios asignados a esa empresa (NO eliminamos el admin global)
      db.usuario.deleteMany({ where: { empresaId: id } }),
      // Finalmente la empresa
      db.empresa.delete({ where: { id } }),
    ]);

    return NextResponse.json({
      ok: true,
      message: `Empresa "${empresa.nombre}" eliminada correctamente`,
    });
  } catch (e: any) {
    console.error('Error en /api/empresas/[id] DELETE:', e);
    return NextResponse.json(
      { error: e.message || 'Error al eliminar empresa' },
      { status: 500 }
    );
  }
}

/** PATCH /api/empresas/[id] — Actualizar empresa */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const empresa = await db.empresa.update({
      where: { id },
      data: {
        nombre: body.nombre,
        regimenFiscal: body.regimenFiscal,
        email: body.email,
        telefono: body.telefono,
        direccion: body.direccion,
        status: body.status,
      },
    });

    return NextResponse.json(empresa);
  } catch (e: any) {
    console.error('Error en /api/empresas/[id] PATCH:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
