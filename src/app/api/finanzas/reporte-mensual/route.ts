import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/finanzas/reporte-mensual?mes=6&anio=2026&empresaId=xxx&formato=excel|json
 *
 * Genera el REPORTE FINANCIERO MENSUAL formal con:
 * 1. Estado de Resultados (ingresos, costos, gastos, utilidad)
 * 2. Flujo de Efectivo (conciliado con bancos)
 * 3. Anexo de IVA (trasladado, acreditable, por pagar/a favor)
 *
 * Datos reales de la BD:
 * - Ingresos: Facturas emitidas (subtotal sin IVA)
 * - Costos: Facturas recibidas (subtotal sin IVA)
 * - Gastos: Facturas recibidas categorizadas (Nómina, Servicios, etc.)
 * - IVA: Diferencia entre IVA trasladado (emitidas) y acreditable (recibidas)
 * - Bancos: Movimientos bancarios del mes
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const formato = searchParams.get('formato') || 'json';
    const empresaId = searchParams.get('empresaId') || undefined;

    if (!empresaId) {
      return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });
    }

    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const empresa = await db.empresa.findUnique({
      where: { id: empresaId },
      select: { nombre: true, rfc: true },
    });

    // ===== FACTURAS DEL MES =====
    const [emitidas, recibidas] = await Promise.all([
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'emitida',
          fecha: { gte: inicioMes, lte: finMes },
          estado: 'timbrada',
        },
        select: {
          subtotal: true, descuento: true, totalImpuestos: true,
          impuestoRetenido: true, total: true, tipoComprobante: true,
          receptorNombre: true, concepto: true,
        },
      }),
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'recibida',
          fecha: { gte: inicioMes, lte: finMes },
          estado: 'timbrada',
        },
        select: {
          subtotal: true, descuento: true, totalImpuestos: true,
          impuestoRetenido: true, total: true, tipoComprobante: true,
          emisorNombre: true, concepto: true,
        },
      }),
    ]);

    // Separar facturas (I) de notas de crédito (E)
    const emitidasFacturas = emitidas.filter(f => f.tipoComprobante === 'I');
    const emitidasNC = emitidas.filter(f => f.tipoComprobante === 'E');
    const recibidasFacturas = recibidas.filter(f => f.tipoComprobante === 'I');
    const recibidasNC = recibidas.filter(f => f.tipoComprobante === 'E');

    // ===== ESTADO DE RESULTADOS =====
    const ingresosFacturas = emitidasFacturas.reduce((s, f) => s + (f.subtotal - f.descuento), 0);
    const ingresosNC = emitidasNC.reduce((s, f) => s + (f.subtotal - f.descuento), 0); // NC resta
    const ingresosNetos = ingresosFacturas - ingresosNC;

    const costosFacturas = recibidasFacturas.reduce((s, f) => s + (f.subtotal - f.descuento), 0);
    const costosNC = recibidasNC.reduce((s, f) => s + (f.subtotal - f.descuento), 0); // NC resta
    const costosNetos = costosFacturas - costosNC;

    // Utilidad bruta
    const utilidadBruta = ingresosNetos - costosNetos;

    // Gastos de operación (separar por categoría usando concepto)
    const keywordsGastoAdmin = ['renta', 'arrendamiento', 'servicio', 'luz', 'agua', 'telefono', 'teléfono', 'internet'];
    const keywordsGastoVenta = ['publicidad', 'marketing', 'comision'];
    let gastosAdmin = 0;
    let gastosVenta = 0;
    let otrosGastos = 0;

    for (const f of recibidasFacturas) {
      const texto = `${f.emisorNombre || ''} ${f.concepto || ''}`.toLowerCase();
      const monto = f.subtotal - f.descuento;
      if (keywordsGastoAdmin.some(k => texto.includes(k))) {
        gastosAdmin += monto;
      } else if (keywordsGastoVenta.some(k => texto.includes(k))) {
        gastosVenta += monto;
      } else {
        otrosGastos += monto;
      }
    }

    const gastosOperacion = gastosAdmin + gastosVenta + otrosGastos;
    const utilidadOperativa = utilidadBruta - gastosOperacion;

    // ===== NÓMINA =====
    const nominaMes = await db.reciboNomina.aggregate({
      where: { empresaId, fecha: { gte: inicioMes, lte: finMes } },
      _sum: { totalPercepciones: true, totalDeducciones: true, neto: true, isr: true, imss: true },
      _count: true,
    });

    const totalNomina = nominaMes._sum.totalPercepciones || 0;
    const utilidadAntesImpuestos = utilidadOperativa - totalNomina;
    const isrProvisionado = utilidadAntesImpuestos > 0 ? utilidadAntesImpuestos * 0.30 : 0;
    const utilidadNeta = utilidadAntesImpuestos - isrProvisionado;

    // ===== ANEXO DE IVA =====
    const ivaTrasladado = emitidasFacturas.reduce((s, f) => s + f.totalImpuestos, 0) - emitidasNC.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaAcreditable = recibidasFacturas.reduce((s, f) => s + f.totalImpuestos, 0) - recibidasNC.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaRetenidoEmitidas = emitidas.reduce((s, f) => s + f.impuestoRetenido, 0);
    const ivaRetenidoRecibidas = recibidas.reduce((s, f) => s + f.impuestoRetenido, 0);
    const ivaPorPagar = ivaTrasladado - ivaAcreditable - ivaRetenidoRecibidas;

    // ===== FLUJO DE EFECTIVO (BANCOS) =====
    const movimientosBanco = await db.movimientoBanco.findMany({
      where: {
        cuenta: { empresaId },
        fecha: { gte: inicioMes, lte: finMes },
      },
      select: { monto: true, categoria: true, concepto: true },
    });

    const ingresosBanco = movimientosBanco.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
    const egresosBanco = movimientosBanco.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
    const flujoNetoBanco = ingresosBanco - egresosBanco;

    // Saldo inicial (saldo al último día del mes anterior)
    const finMesAnterior = new Date(anio, mes - 1, 0, 23, 59, 59);
    const cuentas = await db.cuentaBancaria.findMany({
      where: { empresaId },
      include: {
        movimientos: {
          where: { fecha: { lte: finMesAnterior } },
          select: { monto: true },
        },
      },
    });
    const saldoInicial = cuentas.reduce((s, c) => s + c.movimientos.reduce((s2, m) => s2 + m.monto, 0), 0);
    const saldoFinal = saldoInicial + flujoNetoBanco;

    // Por categoría de banco
    const porCategoria: Record<string, number> = {};
    for (const m of movimientosBanco) {
      const cat = m.categoria || 'Sin clasificar';
      if (!porCategoria[cat]) porCategoria[cat] = 0;
      porCategoria[cat] += Math.abs(m.monto);
    }

    const reporte = {
      empresa: { nombre: empresa?.nombre, rfc: empresa?.rfc },
      periodo: { mes, anio, mesNombre: meses[mes - 1] },
      estadoResultados: {
        ingresos: {
          facturado: ingresosFacturas,
          notasCredito: -ingresosNC,
          totalNeto: ingresosNetos,
        },
        costos: {
          facturado: costosFacturas,
          notasCredito: -costosNC,
          totalNeto: costosNetos,
        },
        utilidadBruta,
        gastosOperacion: {
          administrativos: gastosAdmin,
          venta: gastosVenta,
          otros: otrosGastos,
          total: gastosOperacion,
        },
        utilidadOperativa,
        nomina: {
          totalPercepciones: totalNomina,
          count: nominaMes._count,
        },
        utilidadAntesImpuestos,
        isrProvisionado: isrProvisionado * -1, // negativo porque es gasto
        utilidadNeta,
        margenUtilidad: ingresosNetos > 0 ? (utilidadNeta / ingresosNetos) * 100 : 0,
      },
      anexoIVA: {
        ivaTrasladado,
        ivaAcreditable,
        ivaRetenidoRecibidas,
        ivaPorPagar: ivaPorPagar >= 0 ? ivaPorPagar : 0,
        ivaAFavor: ivaPorPagar < 0 ? Math.abs(ivaPorPagar) : 0,
        concepto: ivaPorPagar >= 0 ? 'IVA por pagar al SAT' : 'IVA a favor del contribuyente',
      },
      flujoEfectivo: {
        saldoInicial,
        ingresosBanco,
        egresosBanco,
        flujoNeto: flujoNetoBanco,
        saldoFinal,
        movimientosCount: movimientosBanco.length,
        porCategoria: Object.entries(porCategoria).map(([cat, monto]) => ({ categoria: cat, monto })).sort((a, b) => b.monto - a.monto),
      },
      resumen: {
        facturasEmitidas: emitidasFacturas.length,
        facturasRecibidas: recibidasFacturas.length,
        notasCreditoEmitidas: emitidasNC.length,
        notasCreditoRecibidas: recibidasNC.length,
        recibosNomina: nominaMes._count,
        movimientosBanco: movimientosBanco.length,
      },
    };

    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      // ===== HOJA 1: ESTADO DE RESULTADOS =====
      const ws1 = wb.addWorksheet('Estado de Resultados', { views: [{ showGridLines: false }] });
      ws1.columns = [{ width: 45 }, { width: 18 }, { width: 18 }];

      ws1.mergeCells('A1:C1');
      ws1.getCell('A1').value = `ESTADO DE RESULTADOS — ${meses[mes - 1]} ${anio}`;
      ws1.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };

      ws1.mergeCells('A2:C2');
      ws1.getCell('A2').value = `${empresa?.nombre} | RFC: ${empresa?.rfc}`;
      ws1.getCell('A2').font = { bold: true };

      let r = 4;
      const addRow = (concepto: string, monto: number, esTotal = false, esSubtotal = false) => {
        ws1.getCell(`A${r}`).value = concepto;
        ws1.getCell(`C${r}`).value = monto;
        ws1.getCell(`C${r}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
        if (esTotal || esSubtotal) {
          ws1.getRow(r).font = { bold: true };
          if (esTotal) ws1.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
        }
        r++;
      };

      addRow('INGRESOS', 0, true);
      addRow('  Facturado (ventas brutas)', ingresosFacturas);
      addRow('  Notas de crédito emitidas', -ingresosNC);
      addRow('  Total ingresos netos', ingresosNetos, true);
      r++;
      addRow('COSTOS', 0, true);
      addRow('  Compras (facturas recibidas)', costosFacturas);
      addRow('  Notas de crédito recibidas', -costosNC);
      addRow('  Total costos netos', costosNetos, true);
      r++;
      addRow('UTILIDAD BRUTA', utilidadBruta, true);
      r++;
      addRow('GASTOS DE OPERACIÓN', 0, true);
      addRow('  Gastos administrativos', gastosAdmin);
      addRow('  Gastos de venta', gastosVenta);
      addRow('  Otros gastos', otrosGastos);
      addRow('  Total gastos operación', gastosOperacion, true);
      r++;
      addRow('UTILIDAD OPERATIVA', utilidadOperativa, true);
      r++;
      addRow('GASTOS DE NÓMINA', totalNomina);
      r++;
      addRow('UTILIDAD ANTES DE IMPUESTOS', utilidadAntesImpuestos, true);
      r++;
      addRow('ISR PROVISIONADO (30%)', -isrProvisionado);
      r++;
      addRow('UTILIDAD NETA', utilidadNeta, true);
      r++;
      addRow(`Margen de utilidad: ${reporte.estadoResultados.margenUtilidad.toFixed(1)}%`, 0);

      // ===== HOJA 2: ANEXO DE IVA =====
      const ws2 = wb.addWorksheet('Anexo de IVA', { views: [{ showGridLines: false }] });
      ws2.columns = [{ width: 45 }, { width: 18 }];

      ws2.mergeCells('A1:B1');
      ws2.getCell('A1').value = `ANEXO DE IVA — ${meses[mes - 1]} ${anio}`;
      ws2.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };

      let r2 = 3;
      const addIvaRow = (concepto: string, monto: number, esTotal = false) => {
        ws2.getCell(`A${r2}`).value = concepto;
        ws2.getCell(`B${r2}`).value = monto;
        ws2.getCell(`B${r2}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
        if (esTotal) {
          ws2.getRow(r2).font = { bold: true };
          ws2.getRow(r2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
        }
        r2++;
      };

      addIvaRow('IVA TRASLADADO (emitidas)', ivaTrasladado);
      addIvaRow('IVA ACREDITABLE (recibidas)', -ivaAcreditable);
      addIvaRow('IVA RETENIDO (recibidas)', -ivaRetenidoRecibidas);
      r2++;
      addIvaRow(ivaPorPagar >= 0 ? 'IVA POR PAGAR AL SAT' : 'IVA A FAVOR DEL CONTRIBUYENTE', ivaPorPagar, true);
      r2++;
      addIvaRow(`Concepto: ${reporte.anexoIVA.concepto}`, 0);

      // ===== HOJA 3: FLUJO DE EFECTIVO =====
      const ws3 = wb.addWorksheet('Flujo de Efectivo', { views: [{ showGridLines: false }] });
      ws3.columns = [{ width: 45 }, { width: 18 }];

      ws3.mergeCells('A1:B1');
      ws3.getCell('A1').value = `FLUJO DE EFECTIVO — ${meses[mes - 1]} ${anio}`;
      ws3.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };

      let r3 = 3;
      const addFlujoRow = (concepto: string, monto: number, esTotal = false) => {
        ws3.getCell(`A${r3}`).value = concepto;
        ws3.getCell(`B${r3}`).value = monto;
        ws3.getCell(`B${r3}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
        if (esTotal) {
          ws3.getRow(r3).font = { bold: true };
          ws3.getRow(r3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
        }
        r3++;
      };

      addFlujoRow('SALDO INICIAL DEL MES', saldoInicial, true);
      r3++;
      addFlujoRow('INGRESOS BANCARIOS', ingresosBanco);
      addFlujoRow('EGRESOS BANCARIOS', -egresosBanco);
      addFlujoRow('FLUJO NETO DEL MES', flujoNetoBanco, true);
      r3++;
      addFlujoRow('SALDO FINAL DEL MES', saldoFinal, true);
      r3++;
      r3++;
      addFlujoRow('GASTOS POR CATEGORÍA', 0, true);
      reporte.flujoEfectivo.porCategoria.forEach(c => {
        addFlujoRow(`  ${c.categoria}`, c.monto);
      });

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="ReporteFinanciero_${anio}${String(mes).padStart(2, '0')}_${empresa?.rfc}.xlsx"`,
        },
      });
    }

    return NextResponse.json(reporte);
  } catch (e: any) {
    console.error('Error en /api/finanzas/reporte-mensual:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
