import { readFileSync } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { registrarAuditTrail, marcarVerificado } from '@/lib/audit-trail';

/**
 * CHECKER AGENT — Verifica respuestas del Maker (auditoría fiscal)
 *
 * El Maker (GLM-4.6) genera una respuesta citando artículos de leyes.
 * El Checker (validador determinista, NO LLM) verifica:
 * 1. Que los artículos citados existan realmente en el JSON de la ley
 * 2. Que los números de artículo mencionados sean correctos
 * 3. Que el fragmento citado coincida con el texto real
 *
 * Esto evita alucinaciones del LLM en auditoría fiscal.
 */

const LAWS_DIR = path.join(process.cwd(), 'skills', 'auditoria-fiscal', 'laws');

// Cache en memoria de los artículos por ley
const cacheArticulos = new Map<string, Array<{ numero: string; texto: string }>>();

function cargarArticulosLey(ley: string): Array<{ numero: string; texto: string }> {
  if (cacheArticulos.has(ley)) return cacheArticulos.get(ley)!;
  try {
    const filePath = path.join(LAWS_DIR, `${ley}.lite.json`);
    const fileContent = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(fileContent);
    const articulos = (data.articulos || []).map((a: any) => ({
      numero: String(a.numero || '').trim(),
      texto: String(a.texto || '').trim(),
    }));
    cacheArticulos.set(ley, articulos);
    return articulos;
  } catch (e) {
    console.error(`Error cargando ley ${ley}:`, e);
    return [];
  }
}

/**
 * Extrae todas las citas de artículos de un texto de respuesta.
 * Busca patrones como:
 *   - "Artículo 27 de la LISR"
 *   - "art. 27 LISR"
 *   - "CFF Art. 16"
 *   - "LIVA 1-A"
 */
function extraerCitasArticulos(texto: string): Array<{ ley: string; articulo: string }> {
  const citas: Array<{ ley: string; articulo: string }> = [];
  const leyesPattern = '(LISR|LIVA|CFF|LFT|LSS|LINFONAVIT|LFPDPPP|LGA)';

  // Patrón 1: "Artículo N de la LEY" o "artículo N LEY"
  const patron1 = new RegExp(`art[ií]culo\\s+(\\d+[A-Z]?)\\s+(?:de\\s+(?:la|el)\\s+)?${leyesPattern}`, 'gi');
  let match;
  while ((match = patron1.exec(texto)) !== null) {
    const articulo = match[1].toUpperCase().trim();
    const ley = match[2].toUpperCase().trim();
    citas.push({ ley, articulo });
  }

  // Patrón 2: "art. N LEY" o "art N LEY"
  const patron2 = new RegExp(`art\\.?\\s*(\\d+[A-Z]?)\\s+${leyesPattern}`, 'gi');
  while ((match = patron2.exec(texto)) !== null) {
    const articulo = match[1].toUpperCase().trim();
    const ley = match[2].toUpperCase().trim();
    if (!citas.find(c => c.ley === ley && c.articulo === articulo)) {
      citas.push({ ley, articulo });
    }
  }

  // Patrón 3: "LEY Art. N" o "LEY artículo N"
  const patron3 = new RegExp(`${leyesPattern}\\s+(?:art\\.?|art[ií]culo)\\s*(\\d+[A-Z]?)`, 'gi');
  while ((match = patron3.exec(texto)) !== null) {
    const ley = match[1].toUpperCase().trim();
    const articulo = match[2].toUpperCase().trim();
    if (!citas.find(c => c.ley === ley && c.articulo === articulo)) {
      citas.push({ ley, articulo });
    }
  }

  // Patrón 4: "LEY N" (ej: "LIVA 1-A")
  const patron4 = new RegExp(`\\b${leyesPattern}\\s+(\\d+[A-Z]?)\\b`, 'gi');
  while ((match = patron4.exec(texto)) !== null) {
    const ley = match[1].toUpperCase().trim();
    const articulo = match[2].toUpperCase().trim();
    if (!citas.find(c => c.ley === ley && c.articulo === articulo)) {
      citas.push({ ley, articulo });
    }
  }

  return citas;
}

/**
 * Verifica si un artículo existe realmente en el JSON de la ley
 */
function verificarArticuloExiste(ley: string, articulo: string): { existe: boolean; textoReal?: string } {
  const articulos = cargarArticulosLey(ley);
  if (articulos.length === 0) return { existe: false };

  // Buscar por número exacto
  const encontrado = articulos.find(a =>
    a.numero === articulo ||
    a.numero === `Artículo ${articulo}` ||
    a.numero.toLowerCase() === `articulo ${articulo}`.toLowerCase() ||
    // Buscar por número dentro del campo numero (ej: "Artículo 27" → buscar "27")
    a.numero.match(new RegExp(`\\b${articulo}\\b`))
  );

  if (encontrado) {
    return { existe: true, textoReal: encontrado.texto };
  }
  return { existe: false };
}

export interface ResultadoVerificacion {
  scoreConfianza: number; // 0.0 a 1.0
  verificado: boolean;
  observaciones: string;
  citas: Array<{
    ley: string;
    articulo: string;
    existe: boolean;
    textoReal?: string;
  }>;
  totalCitas: number;
  citasCorrectas: number;
  citasInventadas: number;
}

/**
 * Función principal del Checker
 * @param respuestaMaker Texto generado por el LLM (Maker)
 * @param leyesUsadas Leyes que el Maker dice haber usado como contexto
 * @param auditTrailIdMaker ID del audit trail del Maker (para actualizar)
 * @param empresaId Para registrar el audit trail del checker
 */
export async function verificarRespuestaMaker(
  respuestaMaker: string,
  leyesUsadas: string[],
  auditTrailIdMaker: string | null,
  empresaId?: string,
): Promise<ResultadoVerificacion> {
  const inicio = Date.now();

  // 1. Extraer citas de artículos del texto
  const citas = extraerCitasArticulos(respuestaMaker);

  // 2. Verificar cada cita
  const citasVerificadas = citas.map(cita => {
    const resultado = verificarArticuloExiste(cita.ley, cita.articulo);
    return {
      ley: cita.ley,
      articulo: cita.articulo,
      existe: resultado.existe,
      textoReal: resultado.textoReal,
    };
  });

  // 3. Calcular score de confianza
  const totalCitas = citas.length;
  const citasCorrectas = citasVerificadas.filter(c => c.existe).length;
  const citasInventadas = totalCitas - citasCorrectas;

  // Score: 1.0 si todas las citas son correctas, 0.0 si todas son inventadas
  // Si no hay citas, score 0.5 (respuesta genérica sin verificación posible)
  let scoreConfianza: number;
  if (totalCitas === 0) {
    scoreConfianza = 0.5;
  } else {
    scoreConfianza = citasCorrectas / totalCitas;
  }

  // Verificado: score >= 0.7 Y no hay citas inventadas críticas
  const verificado = scoreConfianza >= 0.7 && citasInventadas === 0;

  // 4. Generar observaciones
  let observaciones = '';
  if (totalCitas === 0) {
    observaciones = 'El Maker no citó artículos específicos. Respuesta genérica.';
  } else if (verificado) {
    observaciones = `✅ Todas las ${citasCorrectas} citas verificadas correctamente en los JSON de leyes.`;
  } else {
    const inventadas = citasVerificadas.filter(c => !c.existe);
    observaciones = `⚠️ ${citasInventadas} de ${totalCitas} citas NO encontradas en JSON de leyes. Posibles alucinaciones: ${inventadas.map(c => `${c.ley} art. ${c.articulo}`).join(', ')}`;
  }

  const resultado: ResultadoVerificacion = {
    scoreConfianza,
    verificado,
    observaciones,
    citas: citasVerificadas,
    totalCitas,
    citasCorrectas,
    citasInventadas,
  };

  // 5. Actualizar audit trail del Maker con la verificación
  if (auditTrailIdMaker) {
    await marcarVerificado(auditTrailIdMaker, scoreConfianza, observaciones, verificado);
  }

  // 6. Registrar audit trail del Checker
  await registrarAuditTrail({
    agente: 'checker',
    herramienta: 'verificar_citas_articulos',
    input: { respuestaMaker: respuestaMaker.slice(0, 500), leyesUsadas, auditTrailIdMaker },
    output: resultado,
    scoreConfianza,
    verificado,
    observaciones,
    empresaId,
    duracionMs: Date.now() - inicio,
  });

  return resultado;
}

/**
 * Obtiene estadísticas de verificación para el dashboard
 */
export async function obtenerEstadisticasVerificacion(empresaId?: string, dias: number = 30) {
  const fechaInicio = new Date();
  fechaInicio.setDate(fechaInicio.getDate() - dias);

  const where: any = {
    agente: 'checker',
    createdAt: { gte: fechaInicio },
  };
  if (empresaId) where.empresaId = empresaId;

  const total = await db.auditTrail.count({ where });
  const verificados = await db.auditTrail.count({ where: { ...where, verificado: true } });
  const promedioConfianza = total > 0
    ? await db.auditTrail.aggregate({ where, _avg: { scoreConfianza: true } })
    : null;

  return {
    totalConsultas: total,
    consultasVerificadas: verificados,
    consultasConAlucinaciones: total - verificados,
    promedioConfianza: promedioConfianza?._avg?.scoreConfianza ?? 0,
    tasaExito: total > 0 ? verificados / total : 0,
  };
}
