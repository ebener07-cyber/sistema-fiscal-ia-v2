import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Proxy (antes middleware) — protege rutas que requieren autenticación.
 * Next.js 16 requiere "proxy" en vez de "middleware".
 *
 * El token es un base64 de un JSON con { sub, email, exp }.
 * Verificamos expiración sin importar librerías (Edge Runtime compatible).
 */

const publicRoutes = ['/login', '/api/auth/login', '/api/auth/logout'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Permitir rutas públicas
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Permitir archivos estáticos
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.match(/\.(svg|png|jpg|ico|css|js)$/)) {
    return NextResponse.next();
  }

  // Verificar token
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Verificar expiración del token (base64 → JSON)
  try {
    const decoded = atob(token);
    const payload = JSON.parse(decoded);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Token expirado' }, { status: 401 });
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('expired', 'true');
      return NextResponse.redirect(loginUrl);
    }
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login).*)',
  ],
};
