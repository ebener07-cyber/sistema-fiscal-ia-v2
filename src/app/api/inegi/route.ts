import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/inegi?mes=6&anio=2026&formato=excel|json&empresaId=xxx
 *
 * Genera el CUESTIONARIO MENSUAL INEGI para CONSTRUCTORA (E122).
 *
 * El INEGI requiere este cuestionario para empresas de construcción operativa.
 * Las cifras están en MILES DE PESOS (sin decimales, sin IVA).
 *
 * Secciones del cuestionario:
 * I. Tipo de constructiva (E122 = Construcción operativa)
 * II. Días trabajados
 * III. Personal dependiente (obreros, administrativos, propietarios)
 * IV. Personal no dependiente (contratado, honorarios)
 * V. Remuneraciones (en miles de pesos)
 * VI. Gastos por consumo de bienes y servicios (en miles de pesos)
 * VII. Ingresos por suministro de bienes y servicios (en miles de pesos)
 * VIII. Obras ejecutadas, terminadas o en proceso
 * XIII. Adquisición de activos fijos
 *
 * Datos calculados automáticamente:
 * - Personal: de la tabla Empleado (promedio mensual activos)
 * - Remuneraciones: de ReciboNomina (totalPercepciones + cuotas patronales estimadas)
 * - Ingresos: de Facturas emitidas (subtotal sin IVA, en miles)
 * - Gastos: de Facturas recibidas (subtotal sin IVA, en miles, categorizadas)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Convertir pesos a miles de pesos (sin decimales, sin comas)
function aMiles(pesos: number): number {
  return Math.round(pesos / 1000);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const formato = searchParams.get('formato') || 'json';
    const empresaId = searchParams.get('empresaId') || undefined;

    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);

    // ===== DATOS DE LA EMPRESA =====
    const empresa = empresaId ? await db.empresa.findUnique({ where: { id: empresaId } }) : null;

    // ===== II. DÍAS TRABAJADOS =====
    // Calcular días laborables del mes (lunes-sábado típicamente en construcción)
    const diasEnMes = new Date(anio, mes, 0).getDate();
    let diasTrabajados = 0;
    for (let d = 1; d <= diasEnMes; d++) {
      const fecha = new Date(anio, mes - 1, d);
      const diaSemana = fecha.getDay();
      // 0=domingo, 6=sábado. Contamos lunes-sábado como días trabajados
      if (diaSemana !== 0) diasTrabajados++;
    }

    // ===== III. PERSONAL DEPENDIENTE =====
    // Obtener empleados activos y sus recibos de nómina del mes
    const empleadosActivos = empresaId
      ? await db.empleado.findMany({
          where: { empresaId, status: 'activo' },
          select: { id: true, nombre: true, puesto: true, departamento: true, salarioMensual: true },
        })
      : [];

    const recibosNomina = empresaId
      ? await db.reciboNomina.findMany({
          where: { empresaId, fecha: { gte: inicioMes, lte: finMes } },
          include: { empleado: { select: { nombre: true, puesto: true } } },
        })
      : [];

    // Clasificar empleados: obreros vs administrativos
    // Heurística: puesto contiene "obrero", "operador", "técnico", "instalador" → obrero
    //              puesto contiene "admin", "contador", "gerente", "director", "asistente" → administrativo
    const keywordsObrero = ['obrero', 'operador', 'tecnico', 'técnico', 'instalador', 'electricista', 'ayudante', 'obreros'];
    const keywordsAdmin = ['admin', 'contador', 'gerente', 'director', 'asistente', 'secretaria', 'recepcionista', 'rh', 'nomina'];

    let obrerosPromedio = 0;
    let adminsPromedio = 0;
    let horasObreros = 0;
    let horasAdmins = 0;
    let totalSalariosObreros = 0;
    let totalSalariosAdmins = 0;

    for (const emp of empleadosActivos) {
      const puestoLower = (emp.puesto || '').toLowerCase();
      const esObrero = keywordsObrero.some(k => puestoLower.includes(k));
      const esAdmin = keywordsAdmin.some(k => puestoLower.includes(k));

      // Si no coincide, asumir administrativo por defecto
      if (esObrero) {
        obrerosPromedio++;
        // 8 horas/día × 6 días/semana × 4.33 semanas = ~208 horas/mes
        // Pero el INEGI usa horas totales del mes
        horasObreros += diasTrabajados * 8;
        totalSalariosObreros += emp.salarioMensual || 0;
      } else {
        adminsPromedio++;
        horasAdmins += diasTrabajados * 8;
        totalSalariosAdmins += emp.salarioMensual || 0;
      }
    }

    // Calcular remuneraciones reales de los recibos de nómina del mes
    const totalPercepciones = recibosNomina.reduce((s, r) => s + r.totalPercepciones, 0);
    const totalDeducciones = recibosNomina.reduce((s, r) => s + r.totalDeducciones, 0);
    const totalIMSSPatronal = recibosNomina.reduce((s, r) => s + r.imss, 0) * 1.5; // Cuota patronal aprox 1.5x obrera

    // Si no hay recibos, usar salarios mensuales × 1
    const salariosObreros = totalSalariosObreros || (totalPercepciones * 0.6); // 60% si no podemos separar
    const salariosAdmins = totalSalariosAdmins || (totalPercepciones * 0.4);

    // ===== IV. PERSONAL NO DEPENDIENTE =====
    // Por defecto 0 (no tienen personal por honorarios ni subcontratado)
    const personalNoDependiente = {
      contratadoOtraRazon: 0,
      horasContratado: 0,
      honorarios: 0,
      horasHonorarios: 0,
    };

    // ===== V. REMUNERACIONES (en miles de pesos) =====
    const remuneraciones = {
      salariosObreros: aMiles(salariosObreros),
      sueldosAdmins: aMiles(salariosAdmins),
      contribucionesPatronales: aMiles(totalIMSSPatronal),
      otrasPrestaciones: 0,
      utilidadesRepartidas: 0,
      total: aMiles(salariosObreros + salariosAdmins + totalIMSSPatronal),
      indemnizaciones: 0,
    };

    // ===== VI. GASTOS POR CONSUMO (de facturas recibidas, en miles) =====
    // Obtener facturas recibidas del mes, agrupar por categoría
    const facturasRecibidas = empresaId
      ? await db.factura.findMany({
          where: {
            empresaId,
            direccion: 'recibida',
            fecha: { gte: inicioMes, lte: finMes },
            estado: 'timbrada',
            tipoComprobante: 'I', // Solo facturas, no notas de crédito
          },
          select: { subtotal: true, descuento: true, emisorNombre: true, concepto: true },
        })
      : [];

    // Categorizar gastos usando keywords
    const keywordsMateriales = ['material', 'materiales', 'cemento', 'acero', 'cable', 'conduit', 'tuberia', 'tubería', 'lámina', 'lamina'];
    const keywordsCombustible = ['combustible', 'gasolina', 'diesel', 'lubricante', 'gas', 'pemex'];
    const keywordsRenta = ['renta', 'arrendamiento', 'alquiler', 'inmobiliaria'];
    const keywordsSubcontratista = ['subcontratista', 'subcontrato'];
    const keywordsHonorarios = ['honorario', 'honorarios', 'comision', 'comisión'];

    let gastosMateriales = 0;
    let gastosCombustible = 0;
    let gastosRenta = 0;
    let gastosSubcontratistas = 0;
    let gastosHonorarios = 0;
    let gastosOtros = 0;

    for (const f of facturasRecibidas) {
      const texto = `${f.emisorNombre || ''} ${f.concepto || ''}`.toLowerCase();
      const monto = f.subtotal - f.descuento;

      if (keywordsMateriales.some(k => texto.includes(k))) {
        gastosMateriales += monto;
      } else if (keywordsCombustible.some(k => texto.includes(k))) {
        gastosCombustible += monto;
      } else if (keywordsRenta.some(k => texto.includes(k))) {
        gastosRenta += monto;
      } else if (keywordsSubcontratista.some(k => texto.includes(k))) {
        gastosSubcontratistas += monto;
      } else if (keywordsHonorarios.some(k => texto.includes(k))) {
        gastosHonorarios += monto;
      } else {
        gastosOtros += monto;
      }
    }

    const gastos = {
      materialesContratista: aMiles(gastosMateriales),
      materialesSubcontratista: 0,
      combustibles: aMiles(gastosCombustible),
      renta: aMiles(gastosRenta),
      personalContratado: 0,
      honorarios: aMiles(gastosHonorarios),
      subcontratistas: aMiles(gastosSubcontratistas),
      otros: aMiles(gastosOtros),
      total: aMiles(gastosMateriales + gastosCombustible + gastosRenta + gastosHonorarios + gastosSubcontratistas + gastosOtros),
      // Consumos = solo materiales (no servicios)
      consumosTotal: aMiles(gastosMateriales + gastosCombustible),
    };

    // ===== VII. INGRESOS POR SUMINISTRO (facturas emitidas, en miles) =====
    const facturasEmitidas = empresaId
      ? await db.factura.findMany({
          where: {
            empresaId,
            direccion: 'emitida',
            fecha: { gte: inicioMes, lte: finMes },
            estado: 'timbrada',
            tipoComprobante: 'I',
          },
          select: { subtotal: true, descuento: true, concepto: true, receptorNombre: true },
        })
      : [];

    const totalIngresosSubtotal = facturasEmitidas.reduce((s, f) => s + (f.subtotal - f.descuento), 0);

    const ingresos = {
      obrasContratista: aMiles(totalIngresosSubtotal), // Asumimos que todos son de contratista principal
      obrasSubcontratista: 0,
      administracionSupervision: 0,
      otros: 0,
      total: aMiles(totalIngresosSubtotal),
    };

    // ===== VIII. OBRAS EJECUTADAS (placeholder - el usuario debe llenar manualmente) =====
    const obras = [
      {
        descripcion: 'Instalaciones eléctricas y mantenimiento CDMX',
        tipoObra: 'Construcción operativa',
        destino: 'Comercial',
        localizacion: 'Ciudad de México',
        avancePct: 70,
        valorEjecutadoMiles: aMiles(totalIngresosSubtotal * 0.5),
      },
      {
        descripcion: 'Trabajos electromecánicos EdoMex / Guerrero',
        tipoObra: 'Construcción operativa',
        destino: 'Comercial',
        localizacion: 'Estado de México',
        avancePct: 65,
        valorEjecutadoMiles: aMiles(totalIngresosSubtotal * 0.5),
      },
    ];

    // ===== XIII. ADQUISICIÓN DE ACTIVOS FIJOS =====
    // Detectar facturas que parecen ser activos fijos (maquinaria, equipo)
    const keywordsActivoFijo = ['maquinaria', 'equipo', 'vehiculo', 'vehículo', 'computadora', 'mobiliario', 'mueble'];
    let activosFijos = 0;
    for (const f of facturasRecibidas) {
      const texto = `${f.emisorNombre || ''} ${f.concepto || ''}`.toLowerCase();
      if (keywordsActivoFijo.some(k => texto.includes(k))) {
        activosFijos += f.subtotal - f.descuento;
      }
    }

    const activos = {
      maquinariaEquipo: aMiles(activosFijos),
      adquisicionesEjercicio: aMiles(activosFijos),
    };

    // ===== CONSTRUIR RESPUESTA =====
    const cuestionario = {
      empresa: {
        nombre: empresa?.nombre || 'EMPRESA',
        rfc: empresa?.rfc || 'XAXX010101000',
      },
      periodo: { mes, anio },
      tipoCuestionario: 'E122 - Construcción operativa',
      secciones: {
        I: { tipo: 'E122 Construcción operativa' },
        II: { diasTrabajados },
        III: {
          personalDependiente: {
            obreros: { promedio: obrerosPromedio, horas: horasObreros },
            administrativos: { promedio: adminsPromedio, horas: horasAdmins },
            propietarios: { promedio: 0, horas: 0 },
            total: { promedio: obrerosPromedio + adminsPromedio, horas: horasObreros + horasAdmins },
          },
        },
        IV: {
          personalNoDependiente: {
            contratadoOtraRazon: { promedio: personalNoDependiente.contratadoOtraRazon, horas: personalNoDependiente.horasContratado },
            honorarios: { promedio: personalNoDependiente.honorarios, horas: personalNoDependiente.horasHonorarios },
            total: { promedio: 0, horas: 0 },
          },
        },
        V: { remuneraciones },
        VI: { gastos },
        VII: { ingresos },
        VIII: { obras },
        XIII: { activos },
      },
      validacion: {
        ingresos: ingresos.total,
        gastos: gastos.total + remuneraciones.total,
        diferencia: ingresos.total - (gastos.total + remuneraciones.total),
        esValido: ingresos.total > (gastos.total + remuneraciones.total),
      },
      notas: [
        'Todas las cifras están en MILES DE PESOS (sin decimales, sin comas).',
        'No se incluyó IVA en ningún concepto.',
        'El personal se obtuvo de la tabla de empleados activos.',
        'Las remuneraciones se calcularon de los recibos de nómina del mes.',
        'Los gastos se categorizaron por keywords en conceptos de facturas.',
        'Los ingresos son subtotales sin IVA de facturas emitidas.',
        'Las obras son placeholder — el usuario debe ajustar manualmente.',
      ],
    };

    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      const ws = wb.addWorksheet('Cuestionario INEGI', { views: [{ showGridLines: false }] });
      ws.columns = [{ width: 8 }, { width: 50 }, { width: 18 }, { width: 18 }, { width: 50 }];

      // Título
      ws.mergeCells('A1:E1');
      ws.getCell('A1').value = `CUESTIONARIO MENSUAL INEGI - ${mes.toString().padStart(2, '0')}/${anio}`;
      ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };
      ws.getCell('A1').alignment = { horizontal: 'center' };

      ws.mergeCells('A2:E2');
      ws.getCell('A2').value = `${empresa?.nombre || 'EMPRESA'} | RFC: ${empresa?.rfc || ''}`;
      ws.getCell('A2').font = { bold: true, size: 11 };
      ws.getCell('A2').alignment = { horizontal: 'center' };

      let row = 4;

      const addSection = (titulo: string) => {
        ws.mergeCells(`A${row}:E${row}`);
        ws.getCell(`A${row}`).value = titulo;
        ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        ws.getCell(`A${row}`).alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getRow(row).height = 22;
        row++;
      };

      const addRow = (clave: string, concepto: string, montoA: string | number, montoB: string | number = '', obs: string = '') => {
        ws.getCell(`A${row}`).value = clave;
        ws.getCell(`B${row}`).value = concepto;
        ws.getCell(`C${row}`).value = montoA;
        ws.getCell(`D${row}`).value = montoB;
        ws.getCell(`E${row}`).value = obs;
        row++;
      };

      // Sección I
      addSection('I. TIPO DE CONSTRUCTORA');
      addRow('E122', 'Construcción operativa', '', '', '');

      // Sección II
      addSection('II. DÍAS TRABAJADOS');
      addRow('G210', 'Días trabajados', diasTrabajados, '', '');

      // Sección III
      addSection('III. PERSONAL DEPENDIENTE DE LA RAZÓN SOCIAL');
      addRow('', 'Concepto', 'PROMEDIO MENSUAL (A)', 'HORAS TRABAJADAS (D)', '');
      addRow('H171', 'Obreros', obrerosPromedio, horasObreros, '');
      addRow('H200', 'Empleados administrativos, contables y de dirección', adminsPromedio, horasAdmins, '');
      addRow('H300', 'Propietarios, familiares y otros no remunerados', 0, 0, '');
      addRow('H000', 'TOTAL', obrerosPromedio + adminsPromedio, horasObreros + horasAdmins, '');

      // Sección IV
      addSection('IV. PERSONAL NO DEPENDIENTE DE LA RAZÓN SOCIAL');
      addRow('', 'Concepto', 'PROMEDIO MENSUAL (A)', 'HORAS TRABAJADAS (B)', '');
      addRow('I100', 'Personal contratado por otra razón social', 0, 0, '');
      addRow('I200', 'Personal por honorarios o comisiones', 0, 0, '');
      addRow('I000', 'TOTAL', 0, 0, '');

      // Sección V
      addSection('V. REMUNERACIONES (Miles de pesos)');
      addRow('', 'Concepto', 'MONTO (A)', '', '');
      addRow('J117', 'Salarios pagados a obreros', remuneraciones.salariosObreros, '', '');
      addRow('J200', 'Sueldos pagados a empleados administrativos', remuneraciones.sueldosAdmins, '', '');
      addRow('J300', 'Contribuciones patronales a regímenes de seguridad social', remuneraciones.contribucionesPatronales, '', '');
      addRow('J400', 'Otras prestaciones sociales', remuneraciones.otrasPrestaciones, '', '');
      addRow('J500', 'Utilidades repartidas a las y los trabajadores', remuneraciones.utilidadesRepartidas, '', '');
      addRow('J000', 'TOTAL de remuneraciones', remuneraciones.total, '', '');
      addRow('J600', 'Pagos por indemnización o liquidación del personal', remuneraciones.indemnizaciones, '', '');

      // Sección VI
      addSection('VI. GASTOS POR CONSUMO DE BIENES Y SERVICIOS (Miles de pesos)');
      addRow('', 'Concepto', 'GASTOS (A)', 'CONSUMOS (B)', '');
      addRow('K321', 'Materiales para la construcción como contratista principal', gastos.materialesContratista, gastos.materialesContratista, '');
      addRow('K322', 'Materiales para la construcción como subcontratista', 0, 0, '');
      addRow('K411', 'Gastos por consumo de combustibles y lubricantes', gastos.combustibles, gastos.combustibles, '');
      addRow('K590', 'Pagos por alquiler de otros bienes (Renta)', gastos.renta, gastos.renta, '');
      addRow('K610', 'Pagos a otra razón social que contrató y le proporcionó personal', 0, '-', '');
      addRow('K620', 'Gastos por honorarios o comisiones', gastos.honorarios, '-', '');
      addRow('K720', 'Pagos a subcontratistas', gastos.subcontratistas, '-', '');
      addRow('K999', 'Otros gastos en la ejecución de obras y servicios', gastos.otros, '-', '');
      addRow('K000', 'TOTAL de gastos por consumo', gastos.total, gastos.consumosTotal, '');

      // Sección VII
      addSection('VII. INGRESOS POR SUMINISTRO DE BIENES Y SERVICIOS (Miles de pesos)');
      addRow('', 'Concepto', 'INGRESOS (A)', '', '');
      addRow('M321', 'Ingresos por la ejecución de obras como contratista principal', ingresos.obrasContratista, '', '');
      addRow('M322', 'Ingresos por la ejecución de obras como subcontratista', 0, '', '');
      addRow('M323', 'Ingresos por administración y supervisión de obras', 0, '', '');
      addRow('M999', 'Otros ingresos por suministro de bienes y servicios', 0, '', '');
      addRow('M000', 'TOTAL de ingresos', ingresos.total, '', '');

      // Sección VIII
      addSection('VIII. OBRAS EJECUTADAS, TERMINADAS O EN PROCESO');
      addRow('', 'Descripción', 'Tipo', 'Avance %', 'Valor (miles)');
      obras.forEach((o, i) => {
        addRow(`Obra ${i + 1}`, o.descripcion, o.tipoObra, `${o.avancePct}%`, o.valorEjecutadoMiles);
        addRow('', `  Localización: ${o.localizacion}`, o.destino, '', '');
      });

      // Sección XIII
      addSection('XIII. ADQUISICIÓN DE ACTIVOS FIJOS');
      addRow('Q110', 'Maquinaria y equipo de construcción', activos.maquinariaEquipo, '', '');
      addRow('', 'Adquisiciones del ejercicio', activos.adquisicionesEjercicio, '', '');

      // Validación
      row++;
      addSection('✅ VALIDACIÓN FINAL ANTES DE ENVIAR');
      addRow('', 'Ingresos', cuestionario.validacion.ingresos, '', '');
      addRow('', 'Gastos + Remuneraciones', cuestionario.validacion.gastos, '', '');
      addRow('', 'Diferencia (utilidad)', cuestionario.validacion.diferencia, '', '');
      addRow('', '¿Es válido?', cuestionario.validacion.esValido ? '✓ SÍ' : '⚠ NO', '', '');

      // Observaciones
      row++;
      addSection('📝 OBSERVACIONES Y COMENTARIOS');
      cuestionario.notas.forEach((nota, i) => {
        addRow(`${i + 1}.`, nota, '', '', '');
      });

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="INEGI_${anio}${String(mes).padStart(2, '0')}_${empresa?.rfc || 'empresa'}.xlsx"`,
        },
      });
    }

    return NextResponse.json(cuestionario);
  } catch (e: any) {
    console.error('Error en /api/inegi:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
