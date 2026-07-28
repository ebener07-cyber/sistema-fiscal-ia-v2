import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

// Rutas públicas (no requieren auth)
const publicRoutes = ['/login', '/api/auth/login', '/api/auth/logout'];

// Rutas de API que requieren auth
const protectedApiRoutes = ['/api/stats', '/api/facturas', '/api/clientes', '/api/proveedores',
  '/api/empleados', '/api/nomina', '/api/compras', '/api/inventario', '/api/bancos',
  '/api/polizas', '/api/crm', '/api/empresas', '/api/imss', '/api/infonavit',
  '/api/diot', '/api/balance', '/api/inegi', '/api/export', '/api/assistant',
  '/api/speak', '/api/tareas', '/api/notas', '/api/recordatorios',
  '/api/conversaciones', '/api/buscar', '/api/auditoria-fiscal',
  '/api/upload-cfdi', '/api/upload-imss', '/api/upload-infonavit',
  '/api/upload-estado-cuenta', '/api/upload-constancia-fiscal'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Permitir rutas públicas
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Permitir archivos estáticos y _next
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.match(/\.(svg|png|jpg|ico|css|js)$/)) {
    return NextResponse.next();
  }

  // Verificar token
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    // Si es API, devolver 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    // Si es página, redirigir a login
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const payload = verifyToken(token);
  if (!payload) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Token expirado' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('expired', 'true');
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login).*)',
  ],
};
