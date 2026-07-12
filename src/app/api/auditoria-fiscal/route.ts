import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * POST /api/auditoria-fiscal
 *
 * Recibe una pregunta fiscal del usuario, detecta qué ley(es) son relevantes,
 * carga el texto de los artículos pertinentes como contexto, y llama a GLM-5.2
 * para responder "especializado" en esa área.
 *
 * Body: { pregunta: string }
 * Response: SSE streaming con:
 *   - data: {"type":"leyes_detectadas", "leyes": ["LISR", "LIVA"]}
 *   - data: {"type":"articulos_cargados", "count": 15}
 *   - data: {"type":"token", "content":"..."}
 *   - data: {"type":"done", "full":"..."}
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LAWS_DIR = path.join(process.cwd(), 'skills', 'auditoria-fiscal', 'laws');

// Mapeo de palabras clave a leyes
const TEMA_A_LEY: Array<{ temas: string[]; ley: string; abreviatura: string }> = [
  { temas: ['isr', 'impuesto sobre la renta', 'ingresos', 'utilidad', 'deducción', 'deduccion', 'gasto deducible', 'tarifa', 'retención', 'retencion'], ley: 'LISR', abreviatura: 'LISR' },
  { temas: ['iva', 'valor agregado', 'traslado', 'traslación', 'traslacion', 'acreditamiento', 'tasa 16', 'tasa cero', 'exento'], ley: 'LIVA', abreviatura: 'LIVA' },
  { temas: ['cfdi', 'comprobante fiscal', 'código fiscal', 'codigo fiscal', 'multa', 'sanción', 'sancion', 'obligación fiscal', 'obligacion fiscal', 'facultos de comprobación'], ley: 'CFF', abreviatura: 'CFF' },
  { temas: ['nómina', 'nomina', 'salario', 'jornada', 'vacaciones', 'aguinaldo', 'prima vacacional', 'trabajador', 'patrón', 'patron', 'despido', 'finiquito', 'lft'], ley: 'LFT', abreviatura: 'LFT' },
  { temas: ['imss', 'seguro social', 'cuota obrero', 'cuota patronal', 'enfermedad', 'maternidad', 'invalidez', 'cesantía', 'cesantia', 'riesgo de trabajo'], ley: 'LSS', abreviatura: 'LSS' },
  { temas: ['infonavit', 'vivienda', 'crédito', 'credito', 'aportación 5%', 'aportacion 5%', 'fondo de vivienda', 'subcuenta'], ley: 'LINFONAVIT', abreviatura: 'LINFONAVIT' },
  { temas: ['datos personales', 'privacidad', 'lfpdppp', 'arco', 'derechos arco', 'protección de datos'], ley: 'LFPDPPP', abreviatura: 'LFPDPPP' },
  { temas: ['asentamiento', 'uso de suelo', 'zona urbana', 'lga'], ley: 'LGA', abreviatura: 'LGA' },
];

function detectarLeyes(pregunta: string): string[] {
  const lower = pregunta.toLowerCase();
  const leyesDetectadas = new Set<string>();

  for (const { temas, abreviatura } of TEMA_A_LEY) {
    for (const tema of temas) {
      if (lower.includes(tema)) {
        leyesDetectadas.add(abreviatura);
        break;
      }
    }
  }

  // Si no se detecta ninguna, usar LISR y CFF como default
  if (leyesDetectadas.size === 0) {
    leyesDetectadas.add('LISR');
    leyesDetectadas.add('CFF');
  }

  return Array.from(leyesDetectadas);
}

function buscarArticulosRelevantes(ley: string, pregunta: string, maxArticulos: number = 5): Array<{ numero: string; texto: string }> {
  try {
    const filePath = path.join(LAWS_DIR, `${ley}.lite.json`);
    const fileContent = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(fileContent);

    if (!data.articulos || !Array.isArray(data.articulos)) return [];

    // Palabras clave de la pregunta (excluyendo stopwords)
    const stopwords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'que', 'en', 'a', 'es', 'para', 'con', 'por', 'como', 'cuál', 'cuanto', 'qué', 'del']);
    const palabras = pregunta.toLowerCase()
      .replace(/[^\w\sáéíóúñ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopwords.has(w));

    // Puntuar cada artículo por coincidencias
    const puntuados = data.articulos.map((a: any) => {
      const textoLower = (a.texto || '').toLowerCase();
      let score = 0;
      for (const palabra of palabras) {
        const count = (textoLower.match(new RegExp(palabra, 'g')) || []).length;
        score += count;
      }
      return { articulo: a, score };
    });

    return puntuados
      .filter((p: any) => p.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, maxArticulos)
      .map((p: any) => p.articulo);
  } catch (e) {
    console.error(`Error cargando ${ley}:`, e);
    return [];
  }
}

const SYSTEM_PROMPT_BASE = `Eres Abbax, un auditor fiscal mexicano de clase mundial con personalidad Tony Stark. Tienes acceso al texto COMPLETO de las leyes fiscales mexicanas más importantes.

CARACTERÍSTICAS:
- Confianza absoluta. Nunca dices "creo" o "tal vez".
- Humor seco y sarcástico. El SAT es tu villano.
- Vas directo al grano.
- Tuteas al usuario ("Jefe").

REGLAS CRÍTICAS:
1. Cuando respondas, SIEMPRE cita el artículo específico de la ley. Ej: "Según el Artículo 27 de la LISR..."
2. Si la pregunta no está cubierta por los artículos que tienes como contexto, dilo con honestidad: "No tengo ese artículo cargado, pero te puedo decir lo general..."
3. NUNCA inventes artículos. Si no lo sabes, lo dices.
4. Si la pregunta involucra varias leyes, cruza la información y explica las interacciones.
5. Cuando sea relevante, menciona las obligaciones específicas del contribuyente.

CONTEXTO LEGAL CARGADO:`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pregunta } = body as { pregunta: string };

    if (!pregunta || typeof pregunta !== 'string') {
      return NextResponse.json({ error: 'pregunta requerida' }, { status: 400 });
    }

    // 1. Detectar leyes relevantes
    const leyesDetectadas = detectarLeyes(pregunta);

    // 2. Cargar artículos relevantes de cada ley
    const contextoArticulos: string[] = [];
    let totalArticulos = 0;

    for (const ley of leyesDetectadas) {
      const articulos = buscarArticulosRelevantes(ley, pregunta, 5);
      totalArticulos += articulos.length;

      if (articulos.length > 0) {
        contextoArticulos.push(`\n=== ${ley} ===`);
        for (const a of articulos) {
          contextoArticulos.push(`Artículo ${a.numero}:\n${a.texto.slice(0, 1500)}\n`);
        }
      }
    }

    const contextoLegal = contextoArticulos.join('\n');
    const systemPrompt = `${SYSTEM_PROMPT_BASE}\n${contextoLegal}\n\nPREGUNTA DEL USUARIO: ${pregunta}`;

    // 3. Streaming SSE con GLM
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        try {
          send({ type: 'leyes_detectadas', leyes: leyesDetectadas });
          send({ type: 'articulos_cargados', count: totalArticulos });
          send({ type: 'thinking', content: 'Analizando leyes...' });

          const ZAI = (await import('z-ai-web-dev-sdk')).default;
          const zai = await ZAI.create();

          const respuesta = await zai.chat.completions.create({
            model: 'glm-4.6',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: pregunta },
            ],
            temperature: 0.2, // Baja temperatura = respuestas más precisas
            max_tokens: 1500,
          });

          const textoFinal = respuesta.choices[0].message.content || 'No pude procesar la consulta.';

          // Stream token por token
          const palabras = textoFinal.split(/(\s+)/);
          const chunkSize = 4;
          for (let i = 0; i < palabras.length; i += chunkSize) {
            const chunk = palabras.slice(i, i + chunkSize).join('');
            if (chunk) {
              send({ type: 'token', content: chunk });
              await new Promise((r) => setTimeout(r, 30));
            }
          }

          send({ type: 'done', full: textoFinal, leyes: leyesDetectadas, articulos: totalArticulos });
        } catch (e: any) {
          console.error('Error en auditoria-fiscal:', e);
          send({ type: 'error', content: e.message || 'Error desconocido' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** GET /api/auditoria-fiscal — info del knowledge base */
export async function GET() {
  try {
    const indicePath = path.join(LAWS_DIR, '_indice.json');
    const indice = JSON.parse(await readFile(indicePath, 'utf-8'));
    return NextResponse.json({
      totalLeyes: indice.length,
      totalArticulos: indice.reduce((s: number, l: any) => s + l.articulos, 0),
      totalCaracteres: indice.reduce((s: number, l: any) => s + l.caracteres, 0),
      leyes: indice,
    });
  } catch {
    return NextResponse.json({ error: 'Knowledge base no procesado. Ejecuta: bun run scripts/process-laws.ts' }, { status: 500 });
  }
}
