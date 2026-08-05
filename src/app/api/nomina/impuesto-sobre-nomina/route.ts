import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/nomina/impuesto-sobre-nomina?mesInicio=1&mesFin=6&anio=2026&empresaId=xxx&formato=excel|json
 *
 * Genera el CONCENTRADO DE TRABAJADORES para la declaración del
 * IMPUESTO SOBRE NÓMINA (ISN) — aplica para CDMX (tasa 3%) o EDOMEX (tasa 3%).
 *
 * Calcula para cada trabajador:
 * - Sueldo semanal promedio
 * - Días laborados en el periodo
 * - Total de sueldos y salarios pagados
 * - Cuotas patronales al IMSS (estimadas)
 * - Retenciones de ISR (estimadas)
 * - Cuotas patronales Infonavit (estimadas)
 *
 * Base gravable ISN = Sueldos + Cuotas patronales (IMSS + Infonavit)
 * Tasa CDMX = 3% (puede variar según municipio/actividad)
 * Tasa EDOMEX = 3%
 *
 * El ISN se paga mensualmente al gobierno estatal, dentro de los primeros
 * 10 días del mes siguiente al periodo declarado.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tasa de impuesto sobre nómina por estado (2026)
const TASAS_ISN: Record<string, number> = {
  'CDMX': 0.03,
  'Ciudad de México': 0.03,
  'EDOMEX': 0.03,
  'Estado de México': 0.03,
  'Jalisco': 0.02,
  'Nuevo León': 0.03,
  'Puebla': 0.03,
  // Agregar más según sea necesario
};

// Calcular cuotas patronales IMSS estimadas (≈ 20% del salario)
function calcularCuotasPatronalesIMSS(salarioMensual: number): number {
  // Aproximación: 20% del salario bruto
  // (Enfermedades y maternidad 7.59%, Invalidez y vida 1.75%, Guarderías 1%, Retiro 2%, Cesantía 3.15%, INFONAVIT 5%)
  return salarioMensual * 0.20;
}

// Calcular ISR retenido estimado (tabla mensual 2026 simplificada)
function calcularISRRetenido(salarioMensual: number): number {
  // Tabla mensual ISR 2026 (aproximada)
  // Hasta $746.04 → 1.92%
  // $746.05 - $6,324.53 → 6.40% sobre excedente + $14.32
  // $6,324.54 - $11,141.95 → 10.88% sobre excedente + $371.83
  // $11,141.96 - $16,179.65 → 16% sobre excedente + $893.63
  // $16,179.66 - $32,121.96 → 17.92% sobre excedente + $1,718.95
  // Más de $32,121.96 → 21.36% sobre excedente + $4,580.92
  if (salarioMensual <= 746.04) return salarioMensual * 0.0192;
  if (salarioMensual <= 6324.53) return (salarioMensual - 746.04) * 0.064 + 14.32;
  if (salarioMensual <= 11141.95) return (salarioMensual - 6324.53) * 0.1088 + 371.83;
  if (salarioMensual <= 16179.65) return (salarioMensual - 11141.95) * 0.16 + 893.63;
  if (salarioMensual <= 32121.96) return (salarioMensual - 16179.65) * 0.1792 + 1718.95;
  return (salarioMensual - 32121.96) * 0.2136 + 4580.92;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mesInicio = parseInt(searchParams.get('mesInicio') ?? '1');
    const mesFin = parseInt(searchParams.get('mesFin') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const formato = searchParams.get('formato') || 'json';
    const empresaId = searchParams.get('empresaId') || undefined;
    const estado = searchParams.get('estado') || 'CDMX'; // Estado para la tasa ISN

    if (!empresaId) {
      return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });
    }

    // Obtener empresa
    const empresa = await db.empresa.findUnique({
      where: { id: empresaId },
      select: { nombre: true, rfc: true, direccion: true },
    });

    // Calcular periodo (en meses)
    const mesesPeriodo = mesFin - mesInicio + 1;
    const diasPeriodo = mesesPeriodo * 26; // Aproximadamente 26 días laborables por mes
    const inicioPeriodo = new Date(anio, mesInicio - 1, 1);
    const finPeriodo = new Date(anio, mesFin, 0, 23, 59, 59);

    // Obtener empleados activos
    const empleados = await db.empleado.findMany({
      where: { empresaId, status: 'activo' },
      select: {
        id: true,
        nombre: true,
        rfc: true,
        curp: true,
        nss: true,
        puesto: true,
        departamento: true,
        salarioMensual: true,
      },
      orderBy: { nombre: 'asc' },
    });

    // Obtener recibos de nómina del periodo
    const recibos = await db.reciboNomina.findMany({
      where: {
        empresaId,
        fecha: { gte: inicioPeriodo, lte: finPeriodo },
      },
      include: { empleado: { select: { id: true, nombre: true, rfc: true, salarioMensual: true } } },
    });

    // ===== CONSTRUIR LISTADO DE TRABAJADORES =====
    const trabajadores = empleados.map(emp => {
      const salarioMensual = emp.salarioMensual || 0;
      const sueldoSemanal = salarioMensual / 4.33;
      const totalSueldosPeriodo = salarioMensual * mesesPeriodo;

      // Buscar recibos de este empleado
      const recibosEmpleado = recibos.filter(r => r.empleadoId === emp.id);
      const totalPercepcionesReal = recibosEmpleado.reduce((s, r) => s + r.totalPercepciones, 0);
      const totalDeduccionesReal = recibosEmpleado.reduce((s, r) => s + r.totalDeducciones, 0);
      const isrReal = recibosEmpleado.reduce((s, r) => s + r.isr, 0);
      const imssReal = recibosEmpleado.reduce((s, r) => s + r.imss, 0);
      const netoReal = recibosEmpleado.reduce((s, r) => s + r.neto, 0);

      // Si hay recibos, usar montos reales; si no, estimar
      const totalSueldos = recibosEmpleado.length > 0 ? totalPercepcionesReal : totalSueldosPeriodo;
      const cuotasPatronalesIMSS = calcularCuotasPatronalesIMSS(totalSueldos);
      const isrRetenido = recibosEmpleado.length > 0 ? isrReal : calcularISRRetenido(salarioMensual) * mesesPeriodo;
      const cuotasPatronalesInfonavit = totalSueldos * 0.05; // 5% Infonavit patronal

      return {
        id: emp.id,
        nombre: emp.nombre,
        rfc: emp.rfc,
        curp: emp.curp,
        nss: emp.nss,
        puesto: emp.puesto || 'Sin puesto',
        departamento: emp.departamento || 'Sin departamento',
        sueldoSemanalPromedio: Math.round(sueldoSemanal * 100) / 100,
        diasLaborados: diasPeriodo,
        totalSueldosSalarios: Math.round(totalSueldos * 100) / 100,
        cuotasPatronalesIMSS: Math.round(cuotasPatronalesIMSS * 100) / 100,
        isrRetenido: Math.round(isrRetenido * 100) / 100,
        cuotasPatronalesInfonavit: Math.round(cuotasPatronalesInfonavit * 100) / 100,
        recibosCount: recibosEmpleado.length,
      };
    });

    // ===== TOTALES =====
    const totalSueldosSalarios = trabajadores.reduce((s, t) => s + t.totalSueldosSalarios, 0);
    const totalDiasLaborados = diasPeriodo * trabajadores.length;
    const totalCuotasPatronalesIMSS = trabajadores.reduce((s, t) => s + t.cuotasPatronalesIMSS, 0);
    const totalISRRetenido = trabajadores.reduce((s, t) => s + t.isrRetenido, 0);
    const totalCuotasPatronalesInfonavit = trabajadores.reduce((s, t) => s + t.cuotasPatronalesInfonavit, 0);
    const totalRetenciones = totalISRRetenido + totalCuotasPatronalesIMSS + totalCuotasPatronalesInfonavit;

    // Base gravable ISN = Sueldos + Cuotas patronales (IMSS + Infonavit)
    const baseGravable = totalSueldosSalarios + totalCuotasPatronalesIMSS + totalCuotasPatronalesInfonavit;
    const tasaISN = TASAS_ISN[estado] ?? 0.03;
    const impuestoSobreNomina = baseGravable * tasaISN;

    const resultado = {
      empresa: {
        nombre: empresa?.nombre || 'EMPRESA',
        rfc: empresa?.rfc || '',
        direccion: empresa?.direccion || estado,
      },
      periodo: {
        mesInicio,
        mesFin,
        anio,
        mesesPeriodo,
        diasPeriodo,
        fechaLimitePago: new Date(anio, mesFin, 10).toISOString().slice(0, 10),
      },
      estado,
      tasaISN,
      trabajadores,
      totales: {
        totalTrabajadores: trabajadores.length,
        totalSueldosSalarios: Math.round(totalSueldosSalarios * 100) / 100,
        totalDiasLaborados,
        promedioDiarioPago: Math.round((totalSueldosSalarios / diasPeriodo) * 100) / 100,
        totalCuotasPatronalesIMSS: Math.round(totalCuotasPatronalesIMSS * 100) / 100,
        totalISRRetenido: Math.round(totalISRRetenido * 100) / 100,
        totalCuotasPatronalesInfonavit: Math.round(totalCuotasPatronalesInfonavit * 100) / 100,
        totalRetenciones: Math.round(totalRetenciones * 100) / 100,
        baseGravable: Math.round(baseGravable * 100) / 100,
        impuestoSobreNomina: Math.round(impuestoSobreNomina * 100) / 100,
      },
      notas: [
        'Base gravable ISN = Total sueldos + Cuotas patronales (IMSS + Infonavit)',
        `Tasa ISN ${estado}: ${(tasaISN * 100).toFixed(2)}% aplicada sobre la base gravable`,
        `Impuesto sobre nómina a pagar: $${impuestoSobreNomina.toFixed(2)}`,
        `Periodo: ${mesInicio}/${anio} a ${mesFin}/${anio}`,
        `Fecha límite de presentación: 10 de ${new Date(anio, mesFin, 1).toLocaleDateString('es-MX', { month: 'long' })} ${anio}`,
        'El ISR retenido se paga al SAT (vía declaración mensual).',
        'Las cuotas patronales IMSS se pagan al IMSS (vía SUA).',
        'El Infonavit patronal (5%) se paga al Infonavit.',
      ],
    };

    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      const ws = wb.addWorksheet('Concentrado Trabajadores', { views: [{ showGridLines: false }] });
      ws.columns = [
        { width: 8 }, { width: 32 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 12 },
      ];

      // Título
      ws.mergeCells('A1:I1');
      ws.getCell('A1').value = `CONCENTRADO DE TRABAJADORES - ${mesInicio}/${anio} A ${mesFin}/${anio}`;
      ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };
      ws.getCell('A1').alignment = { horizontal: 'center' };

      ws.mergeCells('A2:I2');
      ws.getCell('A2').value = `${empresa?.nombre || ''} | RFC: ${empresa?.rfc || ''}`;
      ws.getCell('A2').font = { bold: true };
      ws.getCell('A2').alignment = { horizontal: 'center' };

      let row = 4;

      // Encabezados
      const headers = ['#', 'NOMBRE COMPLETO', 'RFC', 'PUESTO', 'SUELDO SEMANAL', 'DIAS LABORADOS', 'TOTAL SUELDOS', 'CUOTAS IMSS', 'ISR RETENIDO'];
      headers.forEach((h, i) => {
        ws.getCell(`${String.fromCharCode(65 + i)}${row}`).value = h;
        ws.getCell(`${String.fromCharCode(65 + i)}${row}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getCell(`${String.fromCharCode(65 + i)}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        ws.getCell(`${String.fromCharCode(65 + i)}${row}`).alignment = { horizontal: 'center' };
      });
      row++;

      // Datos de trabajadores
      trabajadores.forEach((t, i) => {
        ws.getCell(`A${row}`).value = i + 1;
        ws.getCell(`B${row}`).value = t.nombre;
        ws.getCell(`C${row}`).value = t.rfc;
        ws.getCell(`D${row}`).value = t.puesto;
        ws.getCell(`E${row}`).value = t.sueldoSemanalPromedio;
        ws.getCell(`F${row}`).value = t.diasLaborados;
        ws.getCell(`G${row}`).value = t.totalSueldosSalarios;
        ws.getCell(`H${row}`).value = t.cuotasPatronalesIMSS;
        ws.getCell(`I${row}`).value = t.isrRetenido;
        ws.getCell(`E${row}`).numFmt = '"$"#,##0.00';
        ws.getCell(`G${row}`).numFmt = '"$"#,##0.00';
        ws.getCell(`H${row}`).numFmt = '"$"#,##0.00';
        ws.getCell(`I${row}`).numFmt = '"$"#,##0.00';
        row++;
      });

      // Totales
      ws.getCell(`A${row}`).value = '';
      ws.getCell(`B${row}`).value = 'TOTAL';
      ws.getCell(`F${row}`).value = totalDiasLaborados;
      ws.getCell(`G${row}`).value = totalSueldosSalarios;
      ws.getCell(`H${row}`).value = totalCuotasPatronalesIMSS;
      ws.getCell(`I${row}`).value = totalISRRetenido;
      ws.getRow(row).font = { bold: true };
      ws.getRow(row).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      ws.getCell(`G${row}`).numFmt = '"$"#,##0.00';
      ws.getCell(`H${row}`).numFmt = '"$"#,##0.00';
      ws.getCell(`I${row}`).numFmt = '"$"#,##0.00';
      row += 2;

      // Resumen fiscal
      ws.mergeCells(`A${row}:I${row}`);
      ws.getCell(`A${row}`).value = '💰 DETALLES FISCALES (Para declaración del Impuesto sobre Nómina)';
      ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      row++;

      const detalles = [
        ['Total sueldos y salarios pagados', totalSueldosSalarios],
        ['Total días laborados (promedio)', totalDiasLaborados],
        ['Promedio diario de pago', totalSueldosSalarios / diasPeriodo],
        ['Total cuotas patronales al IMSS (estimado)', totalCuotasPatronalesIMSS],
        ['Total retenciones de ISR (estimado)', totalISRRetenido],
        ['Total cuotas patronales Infonavit (5%)', totalCuotasPatronalesInfonavit],
        ['TOTAL DE RETENCIONES', totalRetenciones],
        ['', 0],
        ['BASE GRAVABLE ISN (Sueldos + Cuotas patronales)', baseGravable],
        [`Tasa ISN ${estado}`, tasaISN * 100 + '%'],
        ['IMPUESTO SOBRE NÓMINA A PAGAR', impuestoSobreNomina],
      ];
      detalles.forEach(([label, val]) => {
        ws.getCell(`B${row}`).value = label;
        ws.getCell(`G${row}`).value = val;
        if (typeof val === 'number' && val !== 0) {
          ws.getCell(`G${row}`).numFmt = '"$"#,##0.00';
        }
        if (label.includes('TOTAL') || label.includes('BASE GRAVABLE') || label.includes('IMPUESTO')) {
          ws.getRow(row).font = { bold: true };
          ws.getRow(row).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
        }
        row++;
      });

      // Notas
      row++;
      ws.mergeCells(`A${row}:I${row}`);
      ws.getCell(`A${row}`).value = '📝 NOTAS IMPORTANTES';
      ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      row++;
      resultado.notas.forEach(nota => {
        ws.mergeCells(`A${row}:I${row}`);
        ws.getCell(`A${row}`).value = '• ' + nota;
        ws.getCell(`A${row}`).alignment = { horizontal: 'left' };
        row++;
      });

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="ISN_${anio}_${String(mesInicio).padStart(2, '0')}-${String(mesFin).padStart(2, '0')}_${empresa?.rfc}.xlsx"`,
        },
      });
    }

    return NextResponse.json(resultado);
  } catch (e: any) {
    console.error('Error en /api/nomina/impuesto-sobre-nomina:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
