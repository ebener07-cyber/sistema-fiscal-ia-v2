/**
 * Validador de RFC mexicano (persona física y moral)
 * Basado en las reglas del SAT.
 *
 * Persona Física: 4 letras + 6 dígitos (fecha) + 3 alfanuméricos (homoclave)
 *   Ejemplo: GOMP850415AB1
 *
 * Persona Moral: 3 letras + 6 dígitos (fecha) + 3 alfanuméricos (homoclave)
 *   Ejemplo: ABC123456XX1
 *
 * RFC genéricos válidos:
 *   - XAXX010101000 (público en general)
 *   - XEXX010101000 (extranjero)
 */

const RFC_GENERICOS = new Set([
  'XAXX010101000',
  'XEXX010101000',
]);

// Persona física: AAAA + AAMMDD + XXX
const PERSONA_FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
// Persona moral: AAA + AAMMDD + XXX
const PERSONA_MORAL = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;

// Tabla de valores para el cálculo de la homoclave (oficial del SAT)
const VALORES_HOMOCLAVE = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';
const TABLA_PONDERACION = [11, 9, 7, 6, 5, 4, 3, 2];

export interface ResultadoRFC {
  valido: boolean;
  tipo: 'fisica' | 'moral' | 'generico' | 'invalido';
  mensaje: string;
  formateado: string;
}

function extraerFechaRFC(rfc: string): { fecha: Date | null; mensaje: string } {
  // Persona física (13 chars): 4 letras + 6 dígitos (fecha AA MM DD) + 3 homoclave
  //   Ejemplo: GOMP850415AB1 → letras=GOMP, fecha=850415 (1985-04-15), homo=AB1
  // Persona moral (12 chars): 3 letras + 6 dígitos (fecha AA MM DD) + 3 homoclave
  //   Ejemplo: ELE210615XXX → letras=ELE, fecha=210615 (2021-06-15), homo=XXX
  const offset = rfc.length === 13 ? 4 : 3;
  const anioStr = rfc.substring(offset, offset + 2);
  const mesStr = rfc.substring(offset + 2, offset + 4);
  const diaStr = rfc.substring(offset + 4, offset + 6);

  // Verificar que sean dígitos (puede venir basura si el RFC es inválido)
  if (!/^\d{2}$/.test(anioStr) || !/^\d{2}$/.test(mesStr) || !/^\d{2}$/.test(diaStr)) {
    return { fecha: null, mensaje: `Caracteres no numéricos en la fecha del RFC (${anioStr}${mesStr}${diaStr})` };
  }

  const anio = parseInt(anioStr);
  const mes = parseInt(mesStr);
  const dia = parseInt(diaStr);

  // Convertir año de 2 dígitos a 4
  const anioCompleto = anio < 30 ? 2000 + anio : 1900 + anio;

  if (mes < 1 || mes > 12) {
    return { fecha: null, mensaje: `Mes inválido (${mes})` };
  }
  if (dia < 1 || dia > 31) {
    return { fecha: null, mensaje: `Día inválido (${dia})` };
  }
  // Verificar días por mes
  const diasPorMes = [0, 31, anioCompleto % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (dia > diasPorMes[mes]) {
    return { fecha: null, mensaje: `Día ${dia} no existe en mes ${mes}` };
  }

  return { fecha: new Date(anioCompleto, mes - 1, dia), mensaje: '' };
}

/**
 * Valida un RFC mexicano completo.
 */
export function validarRFC(rfc: string): ResultadoRFC {
  if (!rfc) {
    return {
      valido: false,
      tipo: 'invalido',
      mensaje: 'RFC vacío',
      formateado: '',
    };
  }

  const limpio = rfc.trim().toUpperCase().replace(/\s/g, '').replace(/-/g, '');

  // Verificar longitud
  if (limpio.length !== 12 && limpio.length !== 13) {
    return {
      valido: false,
      tipo: 'invalido',
      mensaje: 'El RFC debe tener 12 (persona moral) o 13 caracteres (persona física)',
      formateado: limpio,
    };
  }

  // RFC genéricos
  if (RFC_GENERICOS.has(limpio)) {
    return {
      valido: true,
      tipo: 'generico',
      mensaje: 'RFC genérico (público en general o extranjero)',
      formateado: limpio,
    };
  }

  // Verificar formato
  const esFisica = PERSONA_FISICA.test(limpio);
  const esMoral = PERSONA_MORAL.test(limpio);

  if (!esFisica && !esMoral) {
    return {
      valido: false,
      tipo: 'invalido',
      mensaje: 'Formato inválido. Verifica que las primeras 3-4 letras sean correctas y los 6 dígitos del medio sean una fecha válida.',
      formateado: limpio,
    };
  }

  // Validar fecha
  const { fecha, mensaje } = extraerFechaRFC(limpio);
  if (!fecha) {
    return {
      valido: false,
      tipo: 'invalido',
      mensaje: `Fecha inválida en RFC: ${mensaje}`,
      formateado: limpio,
    };
  }

  // Validar que no sea fecha futura
  if (fecha > new Date()) {
    return {
      valido: false,
      tipo: 'invalido',
      mensaje: 'La fecha del RFC no puede ser futura',
      formateado: limpio,
    };
  }

  return {
    valido: true,
    tipo: esFisica ? 'fisica' : 'moral',
    mensaje: `RFC válido (${esFisica ? 'persona física' : 'persona moral'})`,
    formateado: limpio,
  };
}

/**
 * Valida una CURP mexicana (18 caracteres).
 * Similar al RFC pero con 4 datos adicionales.
 */
export function validarCURP(curp: string): { valido: boolean; mensaje: string; formateado: string } {
  if (!curp) return { valido: false, mensaje: 'CURP vacía', formateado: '' };

  const limpio = curp.trim().toUpperCase().replace(/\s/g, '');

  if (limpio.length !== 18) {
    return { valido: false, mensaje: 'La CURP debe tener 18 caracteres', formateado: limpio };
  }

  // Formato: AAAA + AAMMDD + H + SS + XXX
  // H = H (hombre) o M (mujer)
  // SS = 2 letras entidad federativa
  const patron = /^[A-ZÑ&]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]{2}$/;

  if (!patron.test(limpio)) {
    return { valido: false, mensaje: 'Formato de CURP inválido', formateado: limpio };
  }

  // Entidades federativas válidas (abreviaturas del RENAPO)
  const entidades = [
    'AS', 'BC', 'BS', 'CC', 'CL', 'CM', 'CS', 'CH', 'DF', 'DG', 'GT',
    'GR', 'HG', 'JC', 'MC', 'MN', 'MS', 'NT', 'NL', 'OC', 'PL', 'QT',
    'QR', 'SP', 'SL', 'SR', 'TC', 'TS', 'TL', 'VZ', 'YN', 'ZS', 'NE',
  ];

  const entidad = limpio.substring(11, 13);
  if (!entidades.includes(entidad)) {
    return { valido: false, mensaje: `Entidad federativa inválida: ${entidad}`, formateado: limpio };
  }

  return { valido: true, mensaje: 'CURP válida', formateado: limpio };
}

/**
 * Formatea un RFC para mostrar (agrega guion si tiene homoclave).
 * Ejemplo: GOMP850415AB1 → GOMP-850415-AB1
 */
export function formatearRFC(rfc: string): string {
  const limpio = rfc.trim().toUpperCase().replace(/[-\s]/g, '');
  if (limpio.length === 13) {
    return `${limpio.substring(0, 4)}-${limpio.substring(4, 10)}-${limpio.substring(10)}`;
  }
  if (limpio.length === 12) {
    return `${limpio.substring(0, 3)}-${limpio.substring(3, 9)}-${limpio.substring(9)}`;
  }
  return limpio;
}
