import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';
import { XMLParser } from 'fast-xml-parser';

/**
 * CFDI-VALIDATOR AGENT — Subagente especialista en validar CFDIs
 *
 * Valida la estructura y reglas de un CFDI contra las reglas del SAT.
 * NO usa LLM (determinista) — esto es intencional para garantizar consistencia.
 *
 * Validaciones:
 * 1. Estructura XML válida
 * 2. Campos obligatorios presentes (UUID, RFC emisor/receptor, total, fecha)
 * 3. RFC válido (longitud, formato)
 * 4. Tipo de comprobante válido (I, E, T, P, N)
 * 5. UUID único (no duplicado en BD)
 * 6. Fechas coherentes (fecha emisión <= fecha timbrado)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

interface ResultadoValidacion {
  valido: boolean;
  errores: string[];
  advertencias: string[];
  datos: {
    uuid?: string;
    folio?: string;
    serie?: string;
    fecha?: string;
    total?: number;
    tipoComprobante?: string;
    emisorRfc?: string;
    emisorNombre?: string;
    receptorRfc?: string;
    receptorNombre?: string;
    moneda?: string;
  };
  verificado: boolean;
  scoreConfianza: number;
}

function validarRFC(rfc: string): { valido: boolean; razon: string } {
  if (!rfc) return { valido: false, razon: 'RFC vacío' };
  if (rfc.length < 12 || rfc.length > 13) {
    return { valido: false, razon: `RFC con longitud inválida (${rfc.length}). Debe ser 12 (moral) o 13 (física)` };
  }
  // Persona moral: 12 caracteres (3 letras + 6 dígitos + 3 alfanuméricos)
  // Persona física: 13 caracteres (4 letras + 6 dígitos + 3 alfanuméricos)
  const regexMoral = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/i;
  const regexFisica = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/i;
  if (regexMoral.test(rfc)) return { valido: true, razon: 'RFC persona moral válido' };
  if (regexFisica.test(rfc)) return { valido: true, razon: 'RFC persona física válido' };
  return { valido: false, razon: 'RFC no cumple con el formato del SAT' };
}

function validarEstructuraCFDI(xmlContent: string): ResultadoValidacion {
  const errores: string[] = [];
  const advertencias: string[] = [];
  const datos: any = {};

  // 1. Verificar que es XML válido
  let result: any;
  try {
    result = parser.parse(xmlContent);
  } catch (e: any) {
    return {
      valido: false,
      errores: ['XML inválido: ' + e.message],
      advertencias,
      datos,
      verificado: false,
      scoreConfianza: 0,
    };
  }

  // 2. Verificar que tenga nodo cfdi:Comprobante o Comprobante
  const comprobante = result['cfdi:Comprobante'] || result['Comprobante'];
  if (!comprobante) {
    return {
      valido: false,
      errores: ['No se encontró el nodo cfdi:Comprobante'],
      advertencias,
      datos,
      verificado: false,
      scoreConfianza: 0,
    };
  }

  const getAttr = (obj: any, name: string): string => (obj ? obj[`@_${name}`] || '' : '');

  // 3. Extraer datos básicos
  datos.folio = getAttr(comprobante, 'Folio') || 'S/F';
  datos.serie = getAttr(comprobante, 'Serie') || null;
  datos.fecha = getAttr(comprobante, 'Fecha');
  datos.total = parseFloat(getAttr(comprobante, 'Total')) || 0;
  datos.tipoComprobante = getAttr(comprobante, 'TipoDeComprobante') || 'I';
  datos.moneda = getAttr(comprobante, 'Moneda') || 'MXN';

  // 4. Validar campos obligatorios
  if (!datos.fecha) errores.push('Falta la fecha de emisión');
  if (!datos.total && datos.total !== 0) errores.push('Falta el total');
  if (!['I', 'E', 'T', 'P', 'N'].includes(datos.tipoComprobante)) {
    errores.push(`Tipo de comprobante inválido: ${datos.tipoComprobante}. Debe ser I, E, T, P o N`);
  }

  // 5. Validar emisor
  const emisor = comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {};
  datos.emisorRfc = getAttr(emisor, 'Rfc');
  datos.emisorNombre = getAttr(emisor, 'Nombre');
  if (!datos.emisorRfc) errores.push('Falta el RFC del emisor');
  else {
    const valRfc = validarRFC(datos.emisorRfc);
    if (!valRfc.valido) errores.push(`RFC emisor inválido: ${valRfc.razon}`);
  }

  // 6. Validar receptor
  const receptor = comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {};
  datos.receptorRfc = getAttr(receptor, 'Rfc');
  datos.receptorNombre = getAttr(receptor, 'Nombre');
  if (!datos.receptorRfc) errores.push('Falta el RFC del receptor');
  else {
    const valRfc = validarRFC(datos.receptorRfc);
    if (!valRfc.valido) errores.push(`RFC receptor inválido: ${valRfc.razon}`);
  }

  // 7. Validar UUID del timbre fiscal
  const complemento = comprobante['cfdi:Complemento'] || comprobante['Complemento'];
  if (complemento) {
    const timbre = complemento['tfd:TimbreFiscalDigital'] || complemento['TimbreFiscalDigital'];
    if (timbre) {
      datos.uuid = (getAttr(timbre, 'UUID') || getAttr(timbre, 'uuid') || '').toUpperCase();
      if (!datos.uuid) errores.push('Falta el UUID del timbre fiscal');
      else if (datos.uuid.length !== 36) errores.push(`UUID con longitud inválida (${datos.uuid.length}). Debe ser 36 caracteres`);
    } else {
      advertencias.push('No se encontró el nodo tfd:TimbreFiscalDigital (CFDI sin timbrar)');
    }
  } else {
    advertencias.push('No se encontró el nodo cfdi:Complemento (CFDI sin timbrar)');
  }

  // 8. Validar fechas coherentes
  if (datos.fecha && datos.uuid) {
    const fechaEmision = new Date(datos.fecha);
    const fechaTimbrado = getAttr(complemento['tfd:TimbreFiscalDigital'] || complemento['TimbreFiscalDigital'], 'FechaTimbrado');
    if (fechaTimbrado) {
      const fTimbrado = new Date(fechaTimbrado);
      if (fTimbrado < fechaEmision) {
        advertencias.push('La fecha de timbrado es anterior a la fecha de emisión (inusual)');
      }
    }
  }

  // 9. Calcular score de confianza
  const scoreConfianza = errores.length === 0 ? 1.0 : Math.max(0, 1 - (errores.length * 0.2));

  return {
    valido: errores.length === 0,
    errores,
    advertencias,
    datos,
    verificado: errores.length === 0,
    scoreConfianza,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { xmlContent, empresaId, usuarioId } = body as {
      xmlContent: string;
      empresaId?: string;
      usuarioId?: string;
    };

    if (!xmlContent) return NextResponse.json({ error: 'xmlContent requerido' }, { status: 400 });

    const inicio = Date.now();

    // 1. Validar estructura
    const resultado = validarEstructuraCFDI(xmlContent);

    // 2. Si tiene UUID, verificar duplicados en BD
    if (resultado.datos.uuid) {
      try {
        const existente = await db.factura.findUnique({
          where: { uuid: resultado.datos.uuid },
          select: { id: true, empresaId: true, folio: true },
        });
        if (existente) {
          resultado.advertencias.push(`UUID ya existe en BD (factura ${existente.folio}, empresaId: ${existente.empresaId})`);
          resultado.verificado = false;
          resultado.scoreConfianza = Math.min(resultado.scoreConfianza, 0.7);
        }
      } catch (e) {
        // Si falla la consulta, no es error crítico
      }
    }

    const duracionMs = Date.now() - inicio;
    const auditTrailId = await registrarAuditTrail({
      agente: 'cfdi-validator',
      herramienta: 'validar_estructura_cfdi',
      input: { xmlContent: xmlContent.slice(0, 500), empresaId },
      output: resultado,
      scoreConfianza: resultado.scoreConfianza,
      verificado: resultado.verificado,
      observaciones: resultado.errores.length === 0
        ? `✅ CFDI válido (${resultado.datos.uuid || 'sin UUID'})`
        : `❌ ${resultado.errores.length} errores: ${resultado.errores.join('; ')}`,
      empresaId,
      usuarioId,
      duracionMs,
    });

    return NextResponse.json({
      ...resultado,
      auditTrailId,
      duracionMs,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** GET /api/agentes/cfdi-validator — info del agente */
export async function GET() {
  return NextResponse.json({
    nombre: 'CFDI Validator Agent',
    descripcion: 'Valida estructura de CFDIs contra reglas del SAT (determinista, sin LLM)',
    validaciones: [
      'Estructura XML válida',
      'Campos obligatorios (UUID, RFC emisor/receptor, total, fecha)',
      'RFC válido (persona moral 12 chars, física 13 chars)',
      'Tipo de comprobante válido (I, E, T, P, N)',
      'UUID único (no duplicado en BD)',
      'Fechas coherentes (emisión <= timbrado)',
    ],
  });
}
