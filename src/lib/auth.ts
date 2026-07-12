/**
 * Funciones de utilidad para manejo de contraseñas
 * Nota: En producción usar bcrypt. Para desarrollo simplificado.
 */

// En producción, usar: import bcrypt from 'bcrypt';
// Para demo rápido, usaremos una función simple

export function hashPassword(password: string): string {
  // TODO: Implementar bcrypt en producción
  // Por ahora, retornamos el password hasheado con btoa (base64)
  // EN PRODUCCIÓN USAR: return bcrypt.hashSync(password, 10);
  return Buffer.from(password).toString('base64');
}

export function verifyPassword(password: string, hash: string): boolean {
  // TODO: Implementar bcrypt verification en producción
  // return bcrypt.compareSync(password, hash);
  return hash === Buffer.from(password).toString('base64');
}

/**
 * Crea un JWT simplificado para desarrollo
 * EN PRODUCCIÓN usar jsonwebtoken o jose
 */
export function createToken(userId: string, email: string): string {
  const payload = {
    sub: userId,
    email: email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 días
  };

  // En producción: return jwt.sign(payload, process.env.JWT_SECRET);
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function verifyToken(token: string): { sub: string; email: string } | null {
  try {
    // En producción: return jwt.verify(token, process.env.JWT_SECRET);
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Token expirado
    }

    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
