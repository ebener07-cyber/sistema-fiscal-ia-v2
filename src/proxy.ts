import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Proxy (antes middleware) — protege rutas que requieren autenticación.
 * Next.js 16 requiere "proxy" en vez de "middleware".
 */

const publicRoutes = ['/login', '/api/auth/login', '/api/auth/logout'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Permitir rutas públicas
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Verificar token
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    if (!pathname.startsWith('/_next')) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Verificar expiración
  try {
    const decoded = atob(token);
    const payload = JSON.parse(decoded);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Token expirado' }, { status: 401 });
      }
      if (!pathname.startsWith('/_next')) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
      }
    }
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }
    if (!pathname.startsWith('/_next')) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|robots.txt|logo.svg|globals.css).*)',
  ],
};
