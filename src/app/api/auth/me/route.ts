import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }

    const usuario = await db.usuario.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, nombre: true, rol: true, empresaId: true, empresa: { select: { id: true, nombre: true, rfc: true } } },
    });

    if (!usuario) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 401 });
    }

    return NextResponse.json({ usuario });
  } catch {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
