import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, hashPassword } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await db.usuario.findUnique({ where: { id: payload.sub } });
  if (!user || user.rol !== 'admin') return null;
  return user;
}

/** PATCH /api/usuarios/[id] — Actualizar usuario */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    const data: any = {};
    if (body.nombre) data.nombre = String(body.nombre).slice(0, 100);
    if (body.rol) data.rol = body.rol;
    if (body.empresaId !== undefined) data.empresaId = body.empresaId || null;
    if (body.password) data.password = hashPassword(body.password);

    const usuario = await db.usuario.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        empresaId: true,
      },
    });

    return NextResponse.json(usuario);
  } catch (e: any) {
    console.error('Error en /api/usuarios/[id] PATCH:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/usuarios/[id] — Eliminar usuario */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { id } = await params;

    // No permitir auto-eliminación
    if (id === admin.id) {
      return NextResponse.json(
        { error: 'No puedes eliminar tu propia cuenta' },
        { status: 400 }
      );
    }

    await db.usuario.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('Error en /api/usuarios/[id] DELETE:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
