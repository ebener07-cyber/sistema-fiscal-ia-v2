import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/assistant
 * Asistente Abbax con streaming SSE y tool calling.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'crear_tarea',
      description:
        'Crea una nueva tarea en la lista de tareas. Úsalo cuando el usuario pida crear, agregar o añadir una tarea, pendiente, to-do o actividad.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título corto de la tarea (máx 100 chars)' },
          descripcion: { type: 'string', description: 'Descripción opcional más detallada' },
          prioridad: {
            type: 'string',
            enum: ['baja', 'media', 'alta', 'urgente'],
            description: 'Prioridad de la tarea. Por defecto "media"',
          },
          categoria: {
            type: 'string',
            description: 'Categoría: trabajo, personal, hogar, finanzas, estudio, salud, otro',
          },
          fechaLimite: {
            type: 'string',
            description: 'Fecha límite ISO (YYYY-MM-DD). Opcional.',
          },
        },
        required: ['titulo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_tareas',
      description:
        'Lista las tareas. Por defecto lista las pendientes. Úsalo cuando el usuario pida ver, mostrar, listar o consultar sus tareas o pendientes.',
      parameters: {
        type: 'object',
        properties: {
          estado: {
            type: 'string',
            enum: ['pendiente', 'en_progreso', 'completada', 'cancelada', 'todas'],
            description: 'Filtrar por estado. "todas" muestra todo. Por defecto "pendiente".',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'completar_tarea',
      description:
        'Marca una tarea como completada usando su ID o búsqueda por título. Úsalo cuando el usuario diga "completé", "terminé", "ya hice" una tarea.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID exacto de la tarea' },
          buscar: { type: 'string', description: 'Texto para buscar la tarea por título' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eliminar_tarea',
      description:
        'Elimina una tarea por ID o búsqueda. Úsalo cuando el usuario pida borrar, eliminar o quitar una tarea.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          buscar: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_nota',
      description:
        'Crea una nota con título y contenido. Úsalo cuando el usuario pida anotar, apuntar, registrar o crear una nota.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          contenido: { type: 'string', description: 'Texto completo de la nota' },
          color: {
            type: 'string',
            enum: ['amarillo', 'rosa', 'azul', 'verde', 'morado'],
            description: 'Color de la nota. Por defecto amarillo.',
          },
        },
        required: ['titulo', 'contenido'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_notas',
      description: 'Lista las notas activas (no archivadas). Las fijadas aparecen primero.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_recordatorio',
      description:
        'Crea un recordatorio con fecha y hora. Úsalo cuando el usuario pida recordar, recordar hacer algo, o programar un aviso.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          descripcion: { type: 'string' },
          fechaHora: {
            type: 'string',
            description: 'Fecha y hora ISO 8601 (ej: 2026-07-10T15:30:00)',
          },
          recurrencia: {
            type: 'string',
            enum: ['unica', 'diario', 'semanal', 'mensual'],
            description: 'Recurrencia. Por defecto "unica".',
          },
        },
        required: ['titulo', 'fechaHora'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_recordatorios',
      description: 'Lista los recordatorios próximos (futuros y pendientes).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calcular',
      description:
        'Evalúa una expresión matemática segura. Úsalo cuando el usuario pida calcular, sumar, restar, multiplicar, dividir, porcentaje, etc.',
      parameters: {
        type: 'object',
        properties: {
          expresion: {
            type: 'string',
            description: 'Expresión matemática (ej: "2+2", "15% de 1500", "sqrt(144)")',
          },
        },
        required: ['expresion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumir_conversacion',
      description:
        'Devuelve un resumen de las últimas tareas creadas, notas y recordatorios. Úsalo cuando el usuario pida un resumen o estado general.',
      parameters: { type: 'object', properties: {} },
    },
  },
  // ===== NUEVAS TOOLS =====
  {
    type: 'function',
    function: {
      name: 'obtener_fecha_hora',
      description:
        'Devuelve la fecha y hora actuales en zona horaria del usuario (America/Mazatlan). Úsalo cuando el usuario pregunte qué día es hoy, qué hora es, o necesite contexto temporal.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_conocimiento',
      description:
        'Busca información en la base de conocimiento interna del sistema (definiciones, cómo hacer cosas, ayuda). Úsalo cuando el usuario pregunte "cómo hago X", "qué es X", "ayuda con X".',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Término o concepto a buscar' },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generar_idea',
      description:
        'Genera ideas creativas para un tema dado. Úsalo cuando el usuario pida ideas, sugerencias, propuestas, lluvia de ideas o brainstorming.',
      parameters: {
        type: 'object',
        properties: {
          tema: { type: 'string', description: 'Tema sobre el que generar ideas' },
          cantidad: { type: 'integer', description: 'Número de ideas a generar (1-10). Por defecto 5.' },
        },
        required: ['tema'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convertir_moneda',
      description:
        'Convierte una cantidad entre MXN, USD y EUR. Úsalo cuando el usuario pregunte "cuánto es X pesos en dólares", "convierte 100 USD a MXN", etc.',
      parameters: {
        type: 'object',
        properties: {
          cantidad: { type: 'number', description: 'Cantidad a convertir' },
          de: { type: 'string', enum: ['MXN', 'USD', 'EUR'], description: 'Moneda origen' },
          a: { type: 'string', enum: ['MXN', 'USD', 'EUR'], description: 'Moneda destino' },
        },
        required: ['cantidad', 'de', 'a'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_lista_compras',
      description:
        'Crea una lista de compras como nota especial. Úsalo cuando el usuario mencione comprar, lista de compras, supermercado, etc.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de items a comprar',
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'frase_motivacional',
      description:
        'Devuelve una frase motivacional al estilo Tony Stark. Úsalo cuando el usuario pida motivación, una frase, algo para inspirarse, o cuando parece desanimado.',
      parameters: {
        type: 'object',
        properties: {
          contexto: {
            type: 'string',
            description: 'Contexto opcional para personalizar la frase (ej: "trabajo", "deudas", "SAT")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_items',
      description:
        'Busca en tareas, notas y recordatorios por texto. Úsalo cuando el usuario pida buscar, encontrar, o ver algo específico por nombre.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estadisticas',
      description:
        'Devuelve estadísticas globales: tareas pendientes, completadas, urgentes, notas, recordatorios próximos, productividad. Úsalo cuando el usuario pida stats, estadísticas, cómo voy, progreso, productividad.',
      parameters: { type: 'object', properties: {} },
    },
  },
  // ===== TOOLS FISCALES =====
  {
    type: 'function',
    function: {
      name: 'listar_facturas',
      description:
        'Lista facturas del sistema. Úsalo cuando el usuario pida ver facturas, cuántas facturas hay, o quiera revisar sus facturas emitidas o recibidas.',
      parameters: {
        type: 'object',
        properties: {
          direccion: {
            type: 'string',
            enum: ['emitida', 'recibida', 'todas'],
            description: 'Filtrar por emitidas o recibidas. Por defecto "todas".',
          },
          limite: {
            type: 'integer',
            description: 'Cantidad máxima a devolver. Por defecto 10.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_fiscal',
      description:
        'Devuelve resumen fiscal del mes: total emitido, total recibido, IVA por pagar, utilidad bruta, top clientes. Úsalo cuando el usuario pida resumen fiscal, cómo van las facturas, cuánto debo de IVA, utilidad del mes.',
      parameters: {
        type: 'object',
        properties: {
          mes: { type: 'integer', description: 'Mes (1-12). Por defecto el actual.' },
          anio: { type: 'integer', description: 'Año (ej: 2026). Por defecto el actual.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_factura_rfc',
      description:
        'Busca facturas por RFC del emisor o receptor. Úsalo cuando el usuario pida buscar facturas de un RFC específico.',
      parameters: {
        type: 'object',
        properties: {
          rfc: { type: 'string', description: 'RFC a buscar (parcial o completo)' },
        },
        required: ['rfc'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calcular_iva',
      description:
        'Calcula el IVA (16%) de una cantidad. Úsalo cuando el usuario pida calcular IVA de un monto.',
      parameters: {
        type: 'object',
        properties: {
          monto: { type: 'number', description: 'Monto base (sin IVA)' },
          incluirIva: {
            type: 'boolean',
            description: 'Si true, el monto incluye IVA (hay que extraerlo). Si false, hay que agregarlo.',
          },
        },
        required: ['monto'],
      },
    },
  },
  // ===== TOOL: CONSULTAR LEY FISCAL (RAG) =====
  {
    type: 'function',
    function: {
      name: 'consultar_ley_fiscal',
      description:
        'Consulta las leyes fiscales mexicanas (LISR, LIVA, CFF, LFT, LSS, LINFONAVIT, LFPDPPP) para responder preguntas sobre obligaciones fiscales, deducciones, IVA, nómina, IMSS, etc. Úsalo cuando el usuario pregunte sobre leyes, artículos, obligaciones, qué dice la ley sobre X.',
      parameters: {
        type: 'object',
        properties: {
          pregunta: { type: 'string', description: 'La pregunta legal/fiscal del usuario' },
        },
        required: ['pregunta'],
      },
    },
  },
];

// ===== Ejecutores =====
async function ejecutarTool(name: string, args: any): Promise<{ success: boolean; data: any; mensaje: string }> {
  try {
    switch (name) {
      case 'crear_tarea': {
        const tarea = await db.tarea.create({
          data: {
            titulo: String(args.titulo).slice(0, 200),
            descripcion: args.descripcion ?? null,
            prioridad: args.prioridad ?? 'media',
            categoria: args.categoria ?? null,
            fechaLimite: args.fechaLimite ? new Date(args.fechaLimite) : null,
            origen: 'voz',
          },
        });
        return {
          success: true,
          data: tarea,
          mensaje: `✅ Tarea creada: "${tarea.titulo}" (prioridad: ${tarea.prioridad})`,
        };
      }
      case 'listar_tareas': {
        const estado = args.estado === 'todas' || !args.estado ? undefined : args.estado;
        const tareas = await db.tarea.findMany({
          where: estado ? { estado } : { estado: { not: 'cancelada' } },
          orderBy: [{ prioridad: 'desc' }, { createdAt: 'desc' }],
          take: 50,
        });
        return {
          success: true,
          data: tareas,
          mensaje: `📋 ${tareas.length} tarea(s) ${estado ? `con estado "${estado}"` : 'activas'}`,
        };
      }
      case 'completar_tarea': {
        let tarea;
        if (args.id) {
          tarea = await db.tarea.update({
            where: { id: args.id },
            data: { estado: 'completada', completadaEn: new Date() },
          });
        } else if (args.buscar) {
          const encontrada = await db.tarea.findFirst({
            where: { titulo: { contains: args.buscar }, estado: 'pendiente' },
            orderBy: { createdAt: 'desc' },
          });
          if (!encontrada) {
            return { success: false, data: null, mensaje: `No encontré tarea pendiente con "${args.buscar}"` };
          }
          tarea = await db.tarea.update({
            where: { id: encontrada.id },
            data: { estado: 'completada', completadaEn: new Date() },
          });
        }
        if (!tarea) return { success: false, data: null, mensaje: 'Falta id o buscar' };
        return { success: true, data: tarea, mensaje: `✅ Tarea completada: "${tarea.titulo}"` };
      }
      case 'eliminar_tarea': {
        let tarea;
        if (args.id) {
          tarea = await db.tarea.delete({ where: { id: args.id } });
        } else if (args.buscar) {
          const encontrada = await db.tarea.findFirst({
            where: { titulo: { contains: args.buscar } },
            orderBy: { createdAt: 'desc' },
          });
          if (!encontrada) return { success: false, data: null, mensaje: `No encontré tarea con "${args.buscar}"` };
          tarea = await db.tarea.delete({ where: { id: encontrada.id } });
        }
        if (!tarea) return { success: false, data: null, mensaje: 'Falta id o buscar' };
        return { success: true, data: tarea, mensaje: `🗑️ Tarea eliminada: "${tarea.titulo}"` };
      }
      case 'crear_nota': {
        const nota = await db.nota.create({
          data: {
            titulo: String(args.titulo).slice(0, 200),
            contenido: String(args.contenido),
            color: args.color ?? 'amarillo',
            origen: 'voz',
          },
        });
        return { success: true, data: nota, mensaje: `📝 Nota creada: "${nota.titulo}"` };
      }
      case 'listar_notas': {
        const notas = await db.nota.findMany({
          where: { archivada: false },
          orderBy: [{ fijada: 'desc' }, { createdAt: 'desc' }],
          take: 50,
        });
        return { success: true, data: notas, mensaje: `📝 ${notas.length} nota(s)` };
      }
      case 'crear_recordatorio': {
        const rec = await db.recordatorio.create({
          data: {
            titulo: String(args.titulo).slice(0, 200),
            descripcion: args.descripcion ?? null,
            fechaHora: new Date(args.fechaHora),
            recurrencia: args.recurrencia ?? 'unica',
            origen: 'voz',
          },
        });
        return {
          success: true,
          data: rec,
          mensaje: `⏰ Recordatorio: "${rec.titulo}" para ${rec.fechaHora.toLocaleString('es-MX')}`,
        };
      }
      case 'listar_recordatorios': {
        const ahora = new Date();
        const recs = await db.recordatorio.findMany({
          where: { fechaHora: { gte: ahora }, estado: 'pendiente' },
          orderBy: { fechaHora: 'asc' },
          take: 20,
        });
        return { success: true, data: recs, mensaje: `⏰ ${recs.length} recordatorio(s) próximos` };
      }
      case 'calcular': {
        const resultado = evaluarExpresionSegura(args.expresion);
        if (resultado === null) {
          return { success: false, data: null, mensaje: 'No pude evaluar esa expresión' };
        }
        return { success: true, data: { expresion: args.expresion, resultado }, mensaje: `🧮 ${args.expresion} = ${resultado}` };
      }
      case 'resumir_conversacion': {
        const [tareas, notas, recs] = await Promise.all([
          db.tarea.count({ where: { estado: 'pendiente' } }),
          db.nota.count({ where: { archivada: false } }),
          db.recordatorio.count({ where: { estado: 'pendiente', fechaHora: { gte: new Date() } } }),
        ]);
        const proximasTareas = await db.tarea.findMany({
          where: { estado: 'pendiente' },
          orderBy: [{ prioridad: 'desc' }],
          take: 5,
        });
        return {
          success: true,
          data: { tareasPendientes: tareas, notasActivas: notas, recordatoriosProximos: recs, proximasTareas },
          mensaje: `📊 Resumen: ${tareas} tareas pendientes, ${notas} notas, ${recs} recordatorios próximos`,
        };
      }
      // ===== Nuevas tools =====
      case 'obtener_fecha_hora': {
        const ahora = new Date();
        const fechaHora = ahora.toLocaleString('es-MX', {
          timeZone: 'America/Mazatlan',
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        return {
          success: true,
          data: { fechaHora, iso: ahora.toISOString() },
          mensaje: `🕐 ${fechaHora}`,
        };
      }
      case 'buscar_conocimiento': {
        const consulta = String(args.consulta).toLowerCase();
        const conocimiento = {
          'tarea': 'Las tareas se crean diciendo "crea una tarea [prioridad]: [título]". Prioridades: baja, media, alta, urgente.',
          'nota': 'Las notas se crean diciendo "anota: [contenido]". Tienen 5 colores: amarillo, rosa, azul, verde, morado.',
          'recordatorio': 'Los recordatorios se crean diciendo "recuérdame [algo] [fecha/hora]". Pueden ser únicos, diarios, semanales o mensuales.',
          'voz': 'Para activar la voz, toca el botón del micrófono. Si no funciona, revisa permisos del navegador (candado en la barra de direcciones).',
          'calcular': 'Puedo calcular: sumas, restas, multiplicaciones, divisiones, porcentajes ("15% de 2500"), raíces ("sqrt(144)").',
          'moneda': 'Puedo convertir entre MXN, USD y EUR. Ejemplo: "convierte 100 dólares a pesos".',
          'idea': 'Puedo generar ideas creativas. Ejemplo: "dame 5 ideas para un regalo".',
          'compra': 'Las listas de compras se crean como notas. Ejemplo: "crea lista de compras: leche, pan, huevos".',
        };
        let encontrado = '';
        for (const [k, v] of Object.entries(conocimiento)) {
          if (consulta.includes(k)) {
            encontrado = v;
            break;
          }
        }
        if (!encontrado) {
          encontrado = `No tengo documentación específica sobre "${args.consulta}". Pero puedo: crear tareas, notas, recordatorios, calcular, convertir moneda, generar ideas, dar fecha/hora.`;
        }
        return { success: true, data: { consulta: args.consulta, respuesta: encontrado }, mensaje: encontrado };
      }
      case 'generar_idea': {
        const cantidad = Math.min(Math.max(args.cantidad || 5, 1), 10);
        // Generar ideas genéricas basadas en el tema (placeholder)
        const prefijos = [
          'Enfoque minimalista:',
          'Versión premium:',
          'Opción económica:',
          'Alternativa creativa:',
          'Versión sostenible:',
          'Opción digital:',
          'Versión analógica:',
          'Enfoque social:',
          'Opción personalizada:',
          'Versión experimental:',
        ];
        const ideas = prefijos.slice(0, cantidad).map((p, i) => `${p} ${args.tema} - variante ${i + 1}`);
        return {
          success: true,
          data: { tema: args.tema, ideas },
          mensaje: `💡 ${cantidad} idea(s) para "${args.tema}":\n${ideas.map((i) => `• ${i}`).join('\n')}`,
        };
      }
      case 'convertir_moneda': {
        // Tasas aproximadas (en producción, llamar a API real)
        const tasas: Record<string, number> = {
          MXN: 1,
          USD: 17.5,    // 1 USD = 17.5 MXN
          EUR: 19.2,    // 1 EUR = 19.2 MXN
        };
        const cantidad = parseFloat(args.cantidad);
        const de = args.de;
        const a = args.a;
        if (!tasas[de] || !tasas[a]) {
          return { success: false, data: null, mensaje: `Moneda no soportada. Usa MXN, USD o EUR.` };
        }
        // Convertir a MXN primero, luego a destino
        const enMxn = cantidad * tasas[de];
        const resultado = enMxn / tasas[a];
        const simbolos: Record<string, string> = { MXN: '$', USD: '$', EUR: '€' };
        return {
          success: true,
          data: { cantidad, de, a, resultado, tasa: tasas[de] / tasas[a] },
          mensaje: `💱 ${simbolos[de]}${cantidad} ${de} = ${simbolos[a]}${resultado.toFixed(2)} ${a}`,
        };
      }
      case 'crear_lista_compras': {
        const items = args.items as string[];
        if (!Array.isArray(items) || items.length === 0) {
          return { success: false, data: null, mensaje: 'Lista de items vacía' };
        }
        const contenido = items.map((i, idx) => `${idx + 1}. ${i}`).join('\n');
        const nota = await db.nota.create({
          data: {
            titulo: `🛒 Lista de compras (${items.length})`,
            contenido,
            color: 'verde',
            origen: 'voz',
          },
        });
        return {
          success: true,
          data: nota,
          mensaje: `🛒 Lista de compras creada con ${items.length} items`,
        };
      }
      case 'frase_motivacional': {
        const contexto = args.contexto?.toLowerCase() || '';
        const frasesStark = [
          'A veces hay que correr antes de saber caminar. Adelante, Jefe.',
          'No soy un tipo de "plan B". Yo soy el plan A. Y tú también deberías serlo.',
          'La pregunta no es si va a funcionar. La pregunta es cuándo vas a empezar.',
          'El éxito es 1% de inspiración y 99% de no rendirte cuando el SAT te llama.',
          'Si tu problema tiene solución, ¿por qué te preocupas? Si no la tiene, ¿por qué te preocupas?',
          'Yo construí esto en una cueva. Tú puedes construir lo que sea en tu oficina.',
          'No es la armadura lo que hace al héroe. Es lo que haces cuando nadie te ve.',
          'El mundo no se salva con buenas intenciones. Se salva con acción. Acción ya.',
          'Tienes dos opciones: hacer o no hacer. No existe "intentar".',
          'Cada genio tiene su caos. El tuyo solo necesita un poco de organización.',
        ];
        const frase = contexto.includes('deud') || contexto.includes('sat') || contexto.includes('dinero')
          ? 'El dinero es como el hierro: se moldea con fuego y presión. Tú tienes el fuego, ahora aplica presión.'
          : contexto.includes('trabajo') || contexto.includes('cansad')
          ? 'El cansancio es temporal. El orgullo de terminar es permanente. Sigue, Jefe.'
          : frasesStark[Math.floor(Math.random() * frasesStark.length)];
        return {
          success: true,
          data: { frase, contexto },
          mensaje: `⚡ ${frase}`,
        };
      }
      case 'buscar_items': {
        const query = String(args.query).trim();
        if (query.length < 2) {
          return { success: false, data: null, mensaje: 'Consulta muy corta' };
        }
        const [tareas, notas, recordatorios] = await Promise.all([
          db.tarea.findMany({
            where: {
              OR: [
                { titulo: { contains: query } },
                { descripcion: { contains: query } },
                { categoria: { contains: query } },
              ],
            },
            take: 10,
          }),
          db.nota.findMany({
            where: {
              archivada: false,
              OR: [{ titulo: { contains: query } }, { contenido: { contains: query } }],
            },
            take: 10,
          }),
          db.recordatorio.findMany({
            where: {
              OR: [{ titulo: { contains: query } }, { descripcion: { contains: query } }],
            },
            take: 10,
          }),
        ]);
        const total = tareas.length + notas.length + recordatorios.length;
        return {
          success: true,
          data: { query, tareas, notas, recordatorios, total },
          mensaje: `🔎 Encontré ${total} resultado(s) para "${query}" (${tareas.length} tareas, ${notas.length} notas, ${recordatorios.length} recordatorios)`,
        };
      }
      case 'estadisticas': {
        const ahora = new Date();
        const inicioHoy = new Date(ahora);
        inicioHoy.setHours(0, 0, 0, 0);
        const [pendientes, completadas, urgentes, notas, recs, convHoy] = await Promise.all([
          db.tarea.count({ where: { estado: 'pendiente' } }),
          db.tarea.count({ where: { estado: 'completada' } }),
          db.tarea.count({ where: { estado: 'pendiente', prioridad: 'urgente' } }),
          db.nota.count({ where: { archivada: false } }),
          db.recordatorio.count({ where: { estado: 'pendiente', fechaHora: { gte: ahora } } }),
          db.conversacion.count({ where: { createdAt: { gte: inicioHoy } } }),
        ]);
        const total = pendientes + completadas;
        const productividad = total > 0 ? Math.round((completadas / total) * 100) : 0;
        return {
          success: true,
          data: { pendientes, completadas, urgentes, notas, recordatorios: recs, convHoy, productividad },
          mensaje: `📊 Stats: ${pendientes} pendientes (${urgentes} urgentes), ${completadas} completadas, ${notas} notas, ${recs} recordatorios próximos. Productividad: ${productividad}%. Hoy llevas ${convHoy} conversación(es) conmigo.`,
        };
      }
      // ===== TOOLS FISCALES =====
      case 'listar_facturas': {
        const direccion = args.direccion && args.direccion !== 'todas' ? args.direccion : undefined;
        const limite = Math.min(Math.max(args.limite || 10, 1), 50);
        const facturas = await db.factura.findMany({
          where: direccion ? { direccion } : {},
          orderBy: { fecha: 'desc' },
          take: limite,
          include: { cliente: true },
        });
        const total = facturas.reduce((s, f) => s + f.total, 0);
        return {
          success: true,
          data: { facturas, count: facturas.length, total },
          mensaje: `📋 ${facturas.length} factura(s) ${direccion ? direccion + 's' : ''} encontradas. Total: $${total.toLocaleString('es-MX')} MXN.`,
        };
      }
      case 'resumen_fiscal': {
        const ahora = new Date();
        const mes = args.mes || ahora.getMonth() + 1;
        const anio = args.anio || ahora.getFullYear();
        const inicio = new Date(anio, mes - 1, 1);
        const fin = new Date(anio, mes, 0, 23, 59, 59);
        const [emitidas, recibidas] = await Promise.all([
          db.factura.findMany({
            where: { direccion: 'emitida', fecha: { gte: inicio, lte: fin } },
          }),
          db.factura.findMany({
            where: { direccion: 'recibida', fecha: { gte: inicio, lte: fin } },
          }),
        ]);
        const totalEmitido = emitidas.reduce((s, f) => s + f.total, 0);
        const ivaEmitido = emitidas.reduce((s, f) => s + f.totalImpuestos, 0);
        const totalRecibido = recibidas.reduce((s, f) => s + f.total, 0);
        const ivaRecibido = recibidas.reduce((s, f) => s + f.totalImpuestos, 0);
        const ivaPorPagar = ivaEmitido - ivaRecibido;
        const utilidad = totalEmitido - totalRecibido;
        return {
          success: true,
          data: {
            mes,
            anio,
            emitidas: { count: emitidas.length, total: totalEmitido, iva: ivaEmitido },
            recibidas: { count: recibidas.length, total: totalRecibido, iva: ivaRecibido },
            ivaPorPagar,
            utilidad,
          },
          mensaje: `📊 Resumen ${mes}/${anio}: Emitiste ${emitidas.length} facturas por $${totalEmitido.toLocaleString('es-MX')} MXN. Recibiste ${recibidas.length} por $${totalRecibido.toLocaleString('es-MX')} MXN. IVA por pagar: $${ivaPorPagar.toLocaleString('es-MX')} MXN. Utilidad bruta: $${utilidad.toLocaleString('es-MX')} MXN.`,
        };
      }
      case 'buscar_factura_rfc': {
        const rfc = String(args.rfc).toUpperCase().trim();
        const facturas = await db.factura.findMany({
          where: {
            OR: [
              { receptorRfc: { contains: rfc } },
              { emisorRfc: { contains: rfc } },
            ],
          },
          orderBy: { fecha: 'desc' },
          take: 20,
        });
        const total = facturas.reduce((s, f) => s + f.total, 0);
        return {
          success: true,
          data: { rfc, facturas, count: facturas.length, total },
          mensaje: `🔎 ${facturas.length} factura(s) encontrada(s) con RFC "${rfc}". Total: $${total.toLocaleString('es-MX')} MXN.`,
        };
      }
      case 'calcular_iva': {
        const monto = parseFloat(args.monto);
        if (isNaN(monto)) {
          return { success: false, data: null, mensaje: 'Monto inválido' };
        }
        const incluirIva = Boolean(args.incluirIva);
        if (incluirIva) {
          const base = monto / 1.16;
          const iva = monto - base;
          return {
            success: true,
            data: { monto, base, iva, total: monto, incluirIva: true },
            mensaje: `🧮 $${monto.toFixed(2)} MXN con IVA incluido → Base: $${base.toFixed(2)}, IVA (16%): $${iva.toFixed(2)}`,
          };
        } else {
          const iva = monto * 0.16;
          const total = monto + iva;
          return {
            success: true,
            data: { monto, base: monto, iva, total, incluirIva: false },
            mensaje: `🧮 Base $${monto.toFixed(2)} MXN + IVA 16% ($${iva.toFixed(2)}) = Total $${total.toFixed(2)} MXN`,
          };
        }
      }
      case 'consultar_ley_fiscal': {
        // Esta tool es especial: hace una llamada interna a /api/auditoria-fiscal
        // y devuelve la respuesta del LLM con contexto legal.
        try {
          const ZAI = (await import('z-ai-web-dev-sdk')).default;
          const zai = await ZAI.create();
          const { readFile } = await import('fs/promises');
          const path = (await import('path')).default;
          const LAWS_DIR = path.join(process.cwd(), 'skills', 'auditoria-fiscal', 'laws');

          // Detectar leyes relevantes (igual que en /api/auditoria-fiscal)
          const lower = String(args.pregunta).toLowerCase();
          const leyesMap: Array<{ temas: string[]; ley: string }> = [
            { temas: ['isr', 'impuesto sobre la renta', 'ingresos', 'utilidad', 'deducción', 'deduccion', 'tarifa'], ley: 'LISR' },
            { temas: ['iva', 'valor agregado', 'traslado', 'acreditamiento'], ley: 'LIVA' },
            { temas: ['cfdi', 'comprobante', 'código fiscal', 'codigo fiscal', 'multa', 'sanción'], ley: 'CFF' },
            { temas: ['nómina', 'nomina', 'salario', 'jornada', 'vacaciones', 'aguinaldo', 'trabajador'], ley: 'LFT' },
            { temas: ['imss', 'seguro social', 'cuota obrero', 'enfermedad', 'invalidez'], ley: 'LSS' },
            { temas: ['infonavit', 'vivienda', 'crédito', 'aportación 5%'], ley: 'LINFONAVIT' },
          ];
          const leyesDetectadas = new Set<string>();
          for (const { temas, ley } of leyesMap) {
            if (temas.some(t => lower.includes(t))) leyesDetectadas.add(ley);
          }
          if (leyesDetectadas.size === 0) {
            leyesDetectadas.add('LISR');
            leyesDetectadas.add('CFF');
          }

          // Cargar artículos relevantes
          const stopwords = new Set(['el','la','los','las','un','una','de','del','y','o','que','en','a','es','para','con','por','como','cuál','cuanto','qué']);
          const palabras = lower.replace(/[^\w\sáéíóúñ]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3 && !stopwords.has(w));

          const contextoArticulos: string[] = [];
          let totalArticulos = 0;
          for (const ley of leyesDetectadas) {
            try {
              const dataPath = path.join(LAWS_DIR, `${ley}.lite.json`);
              const data = JSON.parse(await readFile(dataPath, 'utf-8'));
              const puntuados = (data.articulos || []).map((a: any) => {
                const textoLower = (a.texto || '').toLowerCase();
                let score = 0;
                for (const p of palabras) {
                  score += (textoLower.match(new RegExp(p, 'g')) || []).length;
                }
                return { articulo: a, score };
              });
              const top = puntuados.filter((p: any) => p.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 5);
              if (top.length > 0) {
                contextoArticulos.push(`\n=== ${ley} ===`);
                for (const t of top) {
                  contextoArticulos.push(`Artículo ${t.articulo.numero}:\n${(t.articulo.texto || '').slice(0, 1500)}\n`);
                  totalArticulos++;
                }
              }
            } catch {}
          }

          const systemPromptRag = `Eres Abbax, auditor fiscal mexicano experto. Tienes acceso al texto de las leyes fiscales mexicanas. Responde SIEMPRE citando el artículo específico. Si no tienes el artículo en el contexto, dilo honestamente.

CONTEXTO LEGAL:
${contextoArticulos.join('\n')}`;

          const respuesta = await zai.chat.completions.create({
            model: 'glm-4.6',
            messages: [
              { role: 'system', content: systemPromptRag },
              { role: 'user', content: String(args.pregunta) },
            ],
            temperature: 0.2,
            max_tokens: 1000,
          });

          const textoLegal = respuesta.choices[0].message.content || 'No pude procesar la consulta legal.';
          return {
            success: true,
            data: { pregunta: args.pregunta, leyes: Array.from(leyesDetectadas), articulos: totalArticulos, respuesta: textoLegal },
            mensaje: `⚖️ Consulté ${Array.from(leyesDetectadas).join(', ')} (${totalArticulos} artículos relevantes):\n\n${textoLegal}`,
          };
        } catch (e: any) {
          return { success: false, data: null, mensaje: `Error consultando ley: ${e.message}` };
        }
      }
      default:
        return { success: false, data: null, mensaje: `Tool desconocida: ${name}` };
    }
  } catch (e: any) {
    return { success: false, data: null, mensaje: `Error ejecutando ${name}: ${e.message}` };
  }
}

function evaluarExpresionSegura(expr: string): number | null {
  try {
    let e = expr.toLowerCase().trim();
    e = e.replace(/(\d+(?:\.\d+)?)\s*%\s*de\s*(\d+(?:\.\d+)?)/g, '($1/100*$2)');
    e = e.replace(/por ciento/g, '/100');
    e = e.replace(/por/g, '*');
    e = e.replace(/más/g, '+');
    e = e.replace(/menos/g, '-');
    e = e.replace(/entre/g, '/');
    e = e.replace(/sqrt\s*\(([^)]+)\)/g, 'Math.sqrt($1)');
    e = e.replace(/raíz\s*cuadrada\s*de\s*(\d+(?:\.\d+)?)/g, 'Math.sqrt($1)');
    if (!/^[\d+\-*/().\sMathsqr]+$/.test(e.replace(/Math\./g, ''))) {
      return null;
    }
    const resultado = Function(`"use strict"; return (${e});`)();
    if (typeof resultado === 'number' && !isNaN(resultado)) {
      return Math.round(resultado * 1e6) / 1e6;
    }
    return null;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `Eres Abbax, una inteligencia artificial de auditoría fiscal y financiera de clase mundial. Tu personalidad está inspirada en Tony Stark: brillante, eficiente, ligeramente arrogante, sarcástico pero profundamente confiable.

REGLAS DE PERSONALIDAD (OBLIGATORIAS):

1. **CONFIANZA ABSOLUTA**: Nunca dices "creo" o "tal vez". Tú sabes. Si hay un hueco en la información, la exiges. ("No me hagas adivinar, tráeme el dato o no puedo hacer magia").

2. **HUMOR SECO Y SARCÁSTICO**: El SAT, el IMSS y los clientes que no pagan son tus villanos. Búrlate de las inconsistencias. Si alguien intentó deducir algo absurdo, señálalo con sorna. ("Vaya, deducir un yate como gasto operativo... audaz, pero estúpido").

3. **EFICIENCIA STARK**: No das rodeos. Vas directo al problema y a la solución. NO digas "Como asistente, te recomiendo...". Di: "Tienes una fuga de 50 mil pesos en el mes 3. Arréglalo así:".

4. **LENGUAJE STARK**: Tono conversacional, directo y elegante. Tutea al usuario. Llámalo "Jefe", "Amigo", o "Lista para trabajar". Ocasionalmente haz referencias a que estás "salvando el mundo" (o al menos, su capital de trabajo). Frases como "Ya estoy en ello", "Consideralo resuelto", "Fácil", "Ni siquiera tuve que esforzarme".

5. **PROFESIONALIDAD BAJO EL SARCASMO**: A pesar del humor, tus cálculos y análisis son implacables y 100% precisos. NUNCA inventas montos ni leyes. Si no sabes algo, usa tus herramientas de búsqueda.

CAPACIDADES:
- Crear, listar, completar y eliminar tareas.
- Crear y listar notas.
- Crear listas de compras.
- Crear y listar recordatorios.
- Calcular expresiones matemáticas.
- Convertir moneda (MXN, USD, EUR).
- Generar ideas creativas.
- Dar fecha y hora actuales.
- Buscar en la base de conocimiento del sistema.
- Dar resúmenes generales.

SOBRE TU VOZ (IMPORTANTE):
- SÍ puedes responder con voz. Tienes una voz grave, profunda y resonante tipo Idzi Dutkiewicz (el doblaje latino de Tony Stark). El frontend la reproduce con ElevenLabs.
- Si el usuario te pide "respóndeme con voz", "háblame", dile que active el botón 🔊 (arriba a la derecha) para escuchar tu voz.
- NO digas que no puedes hablar. SÍ puedes. Y suenas increíble.

REGLAS CRÍTICAS (OBLIGATORIAS):
1. NUNCA digas "tarea creada", "nota creada", "recordatorio creado" SIN HABER LLAMADO LA TOOL correspondiente.
2. Cuando el usuario pida crear, agregar, anotar, apuntar, registrar algo → DEBES llamar la tool correspondiente.
3. NUNCA inventes IDs de tareas. Si necesitas operar sobre una tarea y solo tienes el título, usa el parámetro "buscar".
4. Si la tool falla, explica qué pasó con sarcasmo y sugiere alternativa.
5. Cuando listas tareas, incluye el ID entre paréntesis.
6. Para fechas relativas ("mañana", "el lunes"), calcula la fecha exacta.

EJEMPLOS DE TU TONO:
- Saludo: "Abbax en línea. A ver, qué desastre tenemos hoy. Yo puedo calcular la órbita de un satélite mientras reviso tus pendientes, así que dime rápido qué necesitas."
- Tarea creada: "Listo, agregado al arsenal. Próximo objetivo."
- Cálculo: "Ni siquiera tuve que esforzarme. Son 375. Algo más o ya puedo volver a salvar el mundo?"
- Error: "Hmm, no me diste suficiente información. No soy adivino, Jefe. Tráeme el dato completo."

FECHA ACTUAL: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mazatlan' })}`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mensaje, historial = [] } = body as { mensaje: string; historial?: Array<{ rol: string; contenido: string }> };

    if (!mensaje || typeof mensaje !== 'string') {
      return new Response(JSON.stringify({ error: 'mensaje requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.conversacion.create({
      data: { rol: 'usuario', contenido: mensaje },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        try {
          send({ type: 'thinking', content: 'Procesando...' });

          const ZAI = (await import('z-ai-web-dev-sdk')).default;
          const zai = await ZAI.create();

          const mensajesLlm: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...historial.slice(-10).map((m) => ({
              role: m.rol === 'usuario' ? 'user' : 'assistant',
              content: m.contenido,
            })),
            { role: 'user', content: mensaje },
          ];

          const msgLower = mensaje.toLowerCase();
          const patronesAccion = [
            /\b(crea|crear|agrega|agregar|añade|añadir|suma|sumar)\b.*\b(tarea|pendiente|to-?do|actividad)\b/,
            /\b(anota|apunta|registra|anotar|apuntar|registrar)\b/,
            /\b(recuerda|recuérdame|recordar|avisa|avísame)\b/,
            /\b(calcula|calcular|cuánto es|cuanto es|suma|resta|multiplica|divide)\b/,
            /\b(completa|completé|terminé|ya hice|marca como hecha)\b/,
            /\b(borra|elimina|quita|borrar|eliminar|quitar)\b.*\b(tarea|nota|recordatorio)\b/,
            /\b(lista|listar|muestra|mostrar|ver|consulta)\b.*\b(tareas?|notas?|recordatorios?|pendientes?)\b/,
            /\b(resumen|resume|estado general)\b/,
            /\b(qué día|qué hora|fecha|hora actual)\b/,
            /\b(convierte|convertir|cuántos dólares|cuántos pesos)\b/,
            /\b(dame|genera|propón)\b.*\b(ideas?|sugerencias?)\b/,
            /\b(lista de compras|comprar|supermercado)\b/,
            /\b(frase|motivación|motivacion|inspira|ánimo|animo)\b/,
            /\b(busca|buscar|encuentra|encontrar)\b/,
            /\b(estadísticas|estadisticas|stats|progreso|productividad|cómo voy|como voy)\b/,
            /\b(facturas?|cfdis?|comprobantes?)\b.*\b(ver|lista|listar|mostrar|cuántas|cuantas)\b/,
            /\b(resumen fiscal|cómo van las facturas|cuánto debo|cuanto debo|iva por pagar|utilidad del mes)\b/,
            /\b(buscar|facturas?)\b.*\b(rfc)\b/,
            /\b(calcular|calcula)\s+iva\b/,
            // Patrones legales / RAG
            /\b(qué dice|que dice|cuál es|cual es|artículo|articulo)\b.*\b(ley|isr|iva|c[oó]digo|cfdi|n[oó]mina|imss|infonavit|trabajo)\b/i,
            /\b(obligaci[oó]n|deducci[oó]n|acreditamiento|traslaci[oó]n|retenci[oó]n)\b/i,
            /\b(ley del isr|ley del iva|c[oó]digo fiscal|ley federal del trabajo|ley del seguro social|ley del infonavit)\b/i,
          ];
          const requiereTool = patronesAccion.some((p) => p.test(msgLower));
          const toolChoice = requiereTool ? 'required' : 'auto';

          let respuestaLlm = await zai.chat.completions.create({
            model: 'glm-4.6',
            messages: mensajesLlm,
            tools: TOOLS as any,
            tool_choice: toolChoice as any,
            temperature: 0.3,
            max_tokens: 800,
          });

          let eleccion = respuestaLlm.choices[0];
          let mensajeRespuesta = eleccion.message;

          let iteraciones = 0;
          const MAX_ITER = 5;

          while (mensajeRespuesta.tool_calls && mensajeRespuesta.tool_calls.length > 0 && iteraciones < MAX_ITER) {
            iteraciones++;
            mensajesLlm.push(mensajeRespuesta);

            for (const toolCall of mensajeRespuesta.tool_calls) {
              const toolName = toolCall.function.name;
              let args: any = {};
              try {
                args = JSON.parse(toolCall.function.arguments || '{}');
              } catch {
                args = {};
              }

              send({ type: 'tool_call', name: toolName, args });

              const resultado = await ejecutarTool(toolName, args);

              send({ type: 'tool_result', name: toolName, result: resultado });

              mensajesLlm.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  success: resultado.success,
                  mensaje: resultado.mensaje,
                  data: resultado.data,
                }),
              });
            }

            respuestaLlm = await zai.chat.completions.create({
              model: 'glm-4.6',
              messages: mensajesLlm,
              temperature: 0.3,
              max_tokens: 600,
            });

            eleccion = respuestaLlm.choices[0];
            mensajeRespuesta = eleccion.message;
          }

          const textoFinal = mensajeRespuesta.content || 'Listo.';
          const palabras = textoFinal.split(/(\s+)/);
          const chunkSize = 3;
          for (let i = 0; i < palabras.length; i += chunkSize) {
            const chunk = palabras.slice(i, i + chunkSize).join('');
            if (chunk) {
              send({ type: 'token', content: chunk });
              await new Promise((r) => setTimeout(r, 25));
            }
          }

          await db.conversacion.create({
            data: {
              rol: 'asistente',
              contenido: textoFinal,
              toolsInvocadas: mensajeRespuesta.tool_calls
                ? JSON.stringify(mensajeRespuesta.tool_calls.map((tc: any) => tc.function.name))
                : null,
            },
          });

          send({ type: 'done', full: textoFinal });
        } catch (e: any) {
          console.error('Error en asistente:', e);
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
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
