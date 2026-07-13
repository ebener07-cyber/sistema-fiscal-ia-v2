import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { hashPassword } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verifica que el request venga de un admin */
async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await db.usuario.findUnique({ where: { id: payload.sub } });
  if (!user || user.rol !== 'admin') return null;
  return user;
}

/** GET /api/usuarios — Lista todos los usuarios (solo admin) */
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const usuarios = await db.usuario.findMany({
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        empresaId: true,
        createdAt: true,
        empresa: { select: { nombre: true, rfc: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ usuarios });
  } catch (e: any) {
    console.error('Error en /api/usuarios GET:', e);
    return NextResponse.json({ usuarios: [] });
  }
}

/** POST /api/usuarios — Alta de usuario (solo admin) */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { email, nombre, password, rol, empresaId } = await req.json();

    if (!email || !nombre || !password) {
      return NextResponse.json(
        { error: 'Email, nombre y password son obligatorios' },
        { status: 400 }
      );
    }

    const existente = await db.usuario.findUnique({
      where: { email: String(email).toLowerCase().trim() },
    });
    if (existente) {
      return NextResponse.json(
        { error: 'Ya existe un usuario con ese email' },
        { status: 409 }
      );
    }

    const usuario = await db.usuario.create({
      data: {
        email: String(email).toLowerCase().trim(),
        nombre: String(nombre).slice(0, 100),
        password: hashPassword(password),
        rol: rol || 'usuario',
        empresaId: empresaId || null,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        empresaId: true,
        createdAt: true,
      },
    });

    return NextResponse.json(usuario, { status: 201 });
  } catch (e: any) {
    console.error('Error en /api/usuarios POST:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
