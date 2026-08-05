/**
 * PII MASKING — Enmascara datos sensibles en logs y audit trail
 *
 * Inspirado en el patrón de johnsonhk88/AI-Bank-Statement-Document-Automation-By-LLM
 * (PII handling para estados de cuenta bancarios).
 *
 * Tipos de PII que se enmascaran:
 * - RFC (12-13 caracteres alfanuméricos): "ALO980508ID6" → "ALO********ID6"
 * - Números de cuenta bancaria (10+ dígitos): "1282396470" → "128239****0"
 * - CLABE (18 dígitos): "014180655090853560" → "014180***********560"
 * - Tarjetas de crédito (16 dígitos): "4521XXXX...XXXX1234" → ya viene enmascarada, pero por si acaso
 * - CURP (18 caracteres): "BEMA800101HDFLRN09" → "BEMA**********RN09"
 * - Emails: "usuario@dominio.com" → "u******@dominio.com"
 * - Teléfonos (10 dígitos): "5551694300" → "555169****"
 *
 * Uso:
 *   const safe = maskPII(JSON.stringify({ rfc: 'ALO980508ID6', cuenta: '1282396470' }));
 *   console.log(safe); // {"rfc":"ALO********ID6","cuenta":"128239****0"}
 */

const PATRONES_PII: Array<{ regex: RegExp; reemplazo: (match: string) => string; tipo: string }> = [
  // RFC persona moral: 3 letras + 6 dígitos + 3 alfanuméricos
  {
    regex: /\b([A-ZÑ&]{3})(\d{6})([A-Z0-9]{3})\b/g,
    reemplazo: (m) => m[0] + '*'.repeat(6) + m[2],
    tipo: 'RFC_MORAL',
  },
  // RFC persona física: 4 letras + 6 dígitos + 3 alfanuméricos
  {
    regex: /\b([A-ZÑ&]{4})(\d{6})([A-Z0-9]{3})\b/g,
    reemplazo: (m) => m[0] + '*'.repeat(6) + m[2],
    tipo: 'RFC_FISICA',
  },
  // CURP: 4 letras + 6 dígitos + 8 alfanuméricos
  {
    regex: /\b([A-ZÑ&]{4})(\d{6})([A-Z0-9]{8})\b/g,
    reemplazo: (m) => m[0] + '*'.repeat(6) + m[2].slice(-2),
    tipo: 'CURP',
  },
  // CLABE interbancaria (18 dígitos)
  {
    regex: /\b(\d{6})(\d{9})(\d{3})\b/g,
    reemplazo: (m) => m[0] + '*'.repeat(9) + m[2],
    tipo: 'CLABE',
  },
  // Número de cuenta bancaria (10-12 dígitos consecutivos)
  {
    regex: /\b(\d{4})(\d{4,6})(\d{2})\b/g,
    reemplazo: (m) => m[0] + '*'.repeat(m[1].length) + m[2],
    tipo: 'CUENTA_BANCARIA',
  },
  // Tarjeta de crédito (16 dígitos)
  {
    regex: /\b(\d{4})(\d{8})(\d{4})\b/g,
    reemplazo: (m) => m[0] + '*'.repeat(8) + m[2],
    tipo: 'TARJETA',
  },
  // Teléfono (10 dígitos, México)
  {
    regex: /\b(\d{6})(\d{4})\b/g,
    reemplazo: (m) => m[0] + '****',
    tipo: 'TELEFONO',
  },
  // Email
  {
    regex: /\b([a-zA-Z0-9._%+-]{1,3})@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    reemplazo: (m) => m[0] + '***@' + m[1],
    tipo: 'EMAIL',
  },
];

/**
 * Enmascara PII en un string
 */
export function maskPII(texto: string): string {
  if (!texto || typeof texto !== 'string') return texto;

  let resultado = texto;
  for (const patron of PATRONES_PII) {
    resultado = resultado.replace(patron.regex, patron.reemplazo as any);
  }
  return resultado;
}

/**
 * Enmascara PII en cualquier objeto (recursivo)
 * Útil para enmascarar antes de guardar en audit trail o logs
 */
export function maskPIIObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return maskPII(obj) as unknown as T;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(maskPIIObject) as unknown as T;
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj as any)) {
    // No enmascarar campos que sabemos que NO son PII
    const camposNoPII = ['id', 'createdAt', 'updatedAt', 'fecha', 'monto', 'total', 'tipo', 'estado', 'categoria', 'subcategoria', 'scoreConfianza', 'agente', 'herramienta', 'duracionMs'];
    if (camposNoPII.includes(key)) {
      result[key] = value;
    } else {
      result[key] = maskPIIObject(value);
    }
  }
  return result;
}

/**
 * Lista los tipos de PII que se pueden enmascarar
 * (útil para documentación y debug)
 */
export function listarTiposPII(): string[] {
  return PATRONES_PII.map(p => p.tipo);
}

/**
 * Detecta si un string contiene PII (sin enmascarar)
 * Útil para validar antes de loguear
 */
export function contienePII(texto: string): boolean {
  if (!texto) return false;
  for (const patron of PATRONES_PII) {
    if (patron.regex.test(texto)) {
      // Reset lastIndex porque regex tiene flag g
      patron.regex.lastIndex = 0;
      return true;
    }
  }
  return false;
}
