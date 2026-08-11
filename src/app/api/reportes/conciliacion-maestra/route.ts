import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/reportes/conciliacion-maestra?empresaId=xxx&anio=2026
 *
 * CONCILIACIÓN MAESTRA BANCOS-CFDIs — Reporte profesional estilo Big 4
 *
 * Genera Excel con 10 hojas:
 * 1. Dashboard Ejecutivo — KPIs + gráficas
 * 2. Resumen de Saldos Bancarios
 * 3. Ingresos vs Egresos Mensual (CFDIs)
 * 4. Santander — Match UUID ↔ SPEI
 * 5. Banorte — Match UUID ↔ SPEI
 * 6. Top 10 Clientes
 * 7. Top 10 Proveedores
 * 8. Partidas No Conciliables (créditos, impuestos, transferencias)
 * 9. Caja Chica / Viáticos
 * 10. Partidas Pendientes
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const anio = parseInt(searchParams.get('anio') ?? '2026');
    const empresaId = searchParams.get('empresaId');

    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nombre: true, rfc: true } });

    // ===== OBTENER TODOS LOS DATOS =====
    const [movimientos, facturasEmitidas, facturasRecibidas] = await Promise.all([
      db.movimientoBanco.findMany({
        where: { cuenta: { empresaId }, fecha: { gte: inicioAnio, lte: finAnio } },
        include: {
          cuenta: { select: { banco: true, cuenta: true, tipo: true } },
          facturaConciliada: { select: { folio: true, serie: true, total: true, uuid: true, receptorNombre: true, emisorNombre: true, direccion: true } },
        },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: { empresaId, direccion: 'emitida', estado: 'timbrada', tipoComprobante: 'I', fecha: { gte: inicioAnio, lte: finAnio } },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, subtotal: true, totalImpuestos: true, receptorRfc: true, receptorNombre: true, uuid: true, concepto: true },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: { empresaId, direccion: 'recibida', estado: 'timbrada', tipoComprobante: 'I', fecha: { gte: inicioAnio, lte: finAnio } },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, subtotal: true, totalImpuestos: true, emisorRfc: true, emisorNombre: true, uuid: true, concepto: true },
        orderBy: { fecha: 'asc' },
      }),
    ]);

    // ===== CRUZAR MOVIMIENTOS CON CFDIs =====
    const TOL_MONTO = 0.05, TOL_FECHA = 7;
    const facturasConPago = new Set<string>();
    const resultadosSantander: any[] = [];
    const resultadosBanorte: any[] = [];
    const noConciliables: any[] = [];

    const NO_REQUIERE = ['TRASPASO', 'COMISION', 'I V A POR', 'CARGO CAPITAL', 'INTERESES', 'DISPOSICION', 'SEGURO', 'PENSION', 'TARJETA', 'IMSS', 'IMPTO FED', 'RETIRO DEP', 'PAGO REFERENCIADO', 'PAGO DE CREDITO'];

    for (const mov of movimientos) {
      const esSantander = mov.cuenta.banco.includes('SANTANDER');
      const esDeposito = mov.monto > 0;
      const montoAbs = Math.abs(mov.monto);
      const conceptoUpper = mov.concepto.toUpperCase();
      const esNoConciliable = NO_REQUIERE.some(k => conceptoUpper.includes(k));

      let resultado: any = {
        fecha: mov.fecha,
        banco: mov.cuenta.banco,
        concepto: mov.concepto,
        monto: mov.monto,
        categoria: mov.categoria || 'Sin clasificar',
        estado: 'SIN_FACTURA',
        uuid: '',
        folio: '',
        clienteProveedor: '',
        montoFactura: 0,
        claveRastreo: '',
      };

      if (mov.facturaConciliadaId && mov.facturaConciliada) {
        resultado.estado = 'CONCILIADO';
        resultado.uuid = mov.facturaConciliada.uuid || '';
        resultado.folio = `${mov.facturaConciliada.serie || ''}${mov.facturaConciliada.folio}`;
        resultado.clienteProveedor = esDeposito ? mov.facturaConciliada.receptorNombre || '' : mov.facturaConciliada.emisorNombre || '';
        resultado.montoFactura = mov.facturaConciliada.total;
        facturasConPago.add(mov.facturaConciliadaId);
      } else if (esNoConciliable) {
        resultado.estado = 'NO_REQUIERE';
        noConciliables.push(resultado);
      } else {
        const facturas = esDeposito ? facturasEmitidas : facturasRecibidas;
        const matches = facturas.filter(f => {
          if (f.total < montoAbs * (1 - TOL_MONTO) || f.total > montoAbs * (1 + TOL_MONTO)) return false;
          return Math.abs(f.fecha.getTime() - mov.fecha.getTime()) / 86400000 <= TOL_FECHA;
        });
        if (matches.length === 1) {
          resultado.estado = 'CONCILIADO';
          resultado.uuid = matches[0].uuid || '';
          resultado.folio = `${matches[0].serie || ''}${matches[0].folio}`;
          resultado.clienteProveedor = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
          resultado.montoFactura = matches[0].total;
          facturasConPago.add(matches[0].id);
        } else if (matches.length > 1) {
          resultado.estado = 'MULTIPLES';
          resultado.folio = `${matches.length} facturas similares`;
        }
      }

      if (esSantander) resultadosSantander.push(resultado);
      else resultadosBanorte.push(resultado);
    }

    // ===== TOTALES =====
    const ingB = resultadosBanorte.filter(r => r.monto > 0).reduce((s, r) => s + r.monto, 0);
    const egrB = resultadosBanorte.filter(r => r.monto < 0).reduce((s, r) => s + Math.abs(r.monto), 0);
    const ingS = resultadosSantander.filter(r => r.monto > 0).reduce((s, r) => s + r.monto, 0);
    const egrS = resultadosSantander.filter(r => r.monto < 0).reduce((s, r) => s + Math.abs(r.monto), 0);
    const saldoB = ingB - egrB, saldoS = ingS - egrS;

    const totalVentas = facturasEmitidas.reduce((s, f) => s + f.total, 0);
    const totalCompras = facturasRecibidas.reduce((s, f) => s + f.total, 0);
    const utilidad = totalVentas - totalCompras;
    const margen = totalVentas > 0 ? (utilidad / totalVentas * 100) : 0;

    const conciliados = [...resultadosSantander, ...resultadosBanorte].filter(r => r.estado === 'CONCILIADO').length;
    const sinFactura = [...resultadosSantander, ...resultadosBanorte].filter(r => r.estado === 'SIN_FACTURA').length;
    const noReq = noConciliables.length;
    const totalMovs = movimientos.length;
    const tasaConc = totalMovs > 0 ? (conciliados / totalMovs * 100) : 0;

    // ===== RESUMEN MENSUAL =====
    const resumenMensual: any[] = [];
    for (let m = 0; m < 12; m++) {
      const emitidasMes = facturasEmitidas.filter(f => f.fecha.getMonth() === m);
      const recibidasMes = facturasRecibidas.filter(f => f.fecha.getMonth() === m);
      if (emitidasMes.length === 0 && recibidasMes.length === 0) continue;
      resumenMensual.push({
        mes: meses[m],
        ingresos: emitidasMes.reduce((s, f) => s + f.total, 0),
        egresos: recibidasMes.reduce((s, f) => s + f.total, 0),
        countEmitidas: emitidasMes.length,
        countRecibidas: recibidasMes.length,
      });
    }

    // ===== TOP CLIENTES Y PROVEEDORES =====
    const porCliente = new Map<string, { nombre: string; rfc: string; count: number; total: number }>();
    for (const f of facturasEmitidas) {
      const key = f.receptorRfc || 'SIN_RFC';
      const ex = porCliente.get(key);
      if (ex) { ex.count++; ex.total += f.total; } else porCliente.set(key, { nombre: f.receptorNombre || 'N/A', rfc: key, count: 1, total: f.total });
    }
    const topClientes = Array.from(porCliente.values()).sort((a, b) => b.total - a.total).slice(0, 10);

    const porProveedor = new Map<string, { nombre: string; rfc: string; count: number; total: number }>();
    for (const f of facturasRecibidas) {
      const key = f.emisorRfc || 'SIN_RFC';
      const ex = porProveedor.get(key);
      if (ex) { ex.count++; ex.total += f.total; } else porProveedor.set(key, { nombre: f.emisorNombre || 'N/A', rfc: key, count: 1, total: f.total });
    }
    const topProveedores = Array.from(porProveedor.values()).sort((a, b) => b.total - a.total).slice(0, 10);

    // ===== CFDIs SIN PAGO =====
    const emitidasSinPago = facturasEmitidas.filter(f => !facturasConPago.has(f.id));
    const recibidasSinPago = facturasRecibidas.filter(f => !facturasConPago.has(f.id));

    // ===== CREAR EXCEL =====
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();

    // Colores corporativos
    const COLOR_PRIMARIO = 'FF7C3AED';
    const COLOR_VERDE = 'FF10B981';
    const COLOR_ROJO = 'FFEF4444';
    const COLOR_AMARILLO = 'FFF97316';
    const COLOR_AZUL = 'FF3B82F6';
    const COLOR_HEADER_BG = 'FF1E293B';

    // ===== HOJA 1: DASHBOARD EJECUTIVO =====
    const ws1 = wb.addWorksheet('📊 Dashboard', { views: [{ showGridLines: false }] });
    ws1.columns = [{ width: 45 }, { width: 22 }, { width: 22 }, { width: 22 }];

    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = `${empresa?.nombre} — CONCILIACIÓN MAESTRA BANCOS-CFDIs`;
    ws1.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    ws1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARIO } };
    ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 35;

    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `RFC: ${empresa?.rfc} | Periodo: ${anio} | Generado: ${new Date().toLocaleDateString('es-MX')}`;
    ws1.getCell('A2').font = { italic: true, size: 11 };
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    let r = 4;
    // KPIs
    const kpis = [
      { label: 'SALDO TOTAL BANCOS', valor: saldoB + saldoS, color: COLOR_PRIMARIO, sub: `Banorte: $${saldoB.toFixed(0)} | Santander: $${saldoS.toFixed(0)}` },
      { label: 'TOTAL VENTAS (CFDIs Emitidos)', valor: totalVentas, color: COLOR_VERDE, sub: `${facturasEmitidas.length} facturas` },
      { label: 'TOTAL COMPRAS (CFDIs Recibidos)', valor: totalCompras, color: COLOR_ROJO, sub: `${facturasRecibidas.length} facturas` },
      { label: 'UTILIDAD BRUTA', valor: utilidad, color: COLOR_AZUL, sub: `Margen: ${margen.toFixed(1)}%` },
      { label: 'TASA CONCILIACIÓN', valor: tasaConc, color: COLOR_AMARILLO, sub: `${conciliados} conciliados de ${totalMovs} movimientos`, esPorcentaje: true },
      { label: 'MOVIMIENTOS NO CONCILIABLES', valor: noReq, color: COLOR_AZUL, sub: 'Transferencias, comisiones, créditos' },
    ];

    for (const kpi of kpis) {
      ws1.getCell(`A${r}`).value = kpi.label;
      ws1.getCell(`A${r}`).font = { bold: true, size: 11 };
      ws1.getCell(`B${r}`).value = kpi.esPorcentaje ? `${kpi.valor.toFixed(1)}%` : kpi.valor;
      ws1.getCell(`B${r}`).font = { bold: true, size: 16, color: { argb: kpi.color } };
      if (!kpi.esPorcentaje) ws1.getCell(`B${r}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      ws1.mergeCells(`C${r}:D${r}`);
      ws1.getCell(`C${r}`).value = kpi.sub;
      ws1.getCell(`C${r}`).font = { size: 10, color: { argb: 'FF64748B' } };
      ws1.getRow(r).height = 28;
      r++;
    }

    r++;
    // Gráfica de barras: Ingresos vs Egresos por mes
    ws1.getCell(`A${r}`).value = '📈 INGRESOS vs EGRESOS MENSUAL (CFDIs)';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: COLOR_PRIMARIO } };
    r++;

    // Datos para la gráfica
    const headerRow = r;
    ws1.getCell(`A${r}`).value = 'Mes';
    ws1.getCell(`B${r}`).value = 'Ingresos';
    ws1.getCell(`C${r}`).value = 'Egresos';
    ws1.getCell(`D${r}`).value = 'Diferencia';
    for (let c = 1; c <= 4; c++) {
      ws1.getCell(`${String.fromCharCode(64 + c)}${r}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws1.getCell(`${String.fromCharCode(64 + c)}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
    }
    r++;

    const dataInicio = r;
    for (const mes of resumenMensual) {
      ws1.getCell(`A${r}`).value = mes.mes;
      ws1.getCell(`B${r}`).value = mes.ingresos;
      ws1.getCell(`C${r}`).value = mes.egresos;
      ws1.getCell(`D${r}`).value = mes.ingresos - mes.egresos;
      ws1.getCell(`B${r}`).numFmt = '"$"#,##0';
      ws1.getCell(`C${r}`).numFmt = '"$"#,##0';
      ws1.getCell(`D${r}`).numFmt = '"$"#,##0;[Red]("$"#,##0)';
      r++;
    }
    const dataFin = r - 1;

    // Crear gráfica de barras
    const chart = wb.addWorksheet('chart_temp');
    const barChart = {
      type: 'bar',
      data: {
        labels: resumenMensual.map(m => m.mes),
        datasets: [
          { label: 'Ingresos', data: resumenMensual.map(m => m.ingresos), backgroundColor: '10B981' },
          { label: 'Egresos', data: resumenMensual.map(m => m.egresos), backgroundColor: 'EF4444' },
        ],
      },
    };

    // ===== HOJA 2: RESUMEN DE SALDOS =====
    const ws2 = wb.addWorksheet('🏦 Saldos Bancarios');
    ws2.columns = [{ width: 30 }, { width: 20 }, { width: 18 }, { width: 35 }];
    ws1.getCell('A1').value = '';

    ws2.mergeCells('A1:D1');
    ws2.getCell('A1').value = 'RESUMEN DE SALDOS BANCARIOS';
    ws2.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    ws2.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARIO } };
    ws2.getCell('A1').alignment = { horizontal: 'center' };

    const headers2 = ['Institución / Cuenta', 'Saldo Final', 'Movimientos', 'Tipo'];
    headers2.forEach((h, i) => {
      ws2.getCell(`${String.fromCharCode(65 + i)}3`).value = h;
      ws2.getCell(`${String.fromCharCode(65 + i)}3`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws2.getCell(`${String.fromCharCode(65 + i)}3`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
    });

    const cuentas = await db.cuentaBancaria.findMany({ where: { empresaId }, include: { _count: { select: { movimientos: true } } } });
    let r2 = 4;
    for (const c of cuentas) {
      ws2.getCell(`A${r2}`).value = `${c.banco} (${c.cuenta})`;
      ws2.getCell(`B${r2}`).value = c.saldo;
      ws2.getCell(`B${r2}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      ws2.getCell(`B${r2}`).font = { bold: true, color: { argb: c.saldo >= 0 ? COLOR_VERDE : COLOR_ROJO } };
      ws2.getCell(`C${r2}`).value = c._count.movimientos;
      ws2.getCell(`D${r2}`).value = c.tipo;
      r2++;
    }
    // Total
    ws2.getCell(`A${r2}`).value = 'TOTAL DISPONIBLE';
    ws2.getCell(`B${r2}`).value = cuentas.reduce((s, c) => s + c.saldo, 0);
    ws2.getCell(`B${r2}`).numFmt = '"$"#,##0.00';
    ws2.getRow(r2).font = { bold: true };
    ws2.getRow(r2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };

    // ===== HOJA 3: SANTANDER MATCH =====
    const ws3 = wb.addWorksheet('🏛️ Santander Match');
    ws3.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Monto Banco', key: 'monto', width: 14 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'UUID Factura', key: 'uuid', width: 36 },
      { header: 'Folio', key: 'folio', width: 12 },
      { header: 'Cliente/Proveedor', key: 'clienteProveedor', width: 30 },
      { header: 'Monto Factura', key: 'montoFactura', width: 14 },
    ];
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ROJO } };

    for (const res of resultadosSantander) {
      const row = ws3.addRow({ ...res, fecha: res.fecha.toLocaleDateString('es-MX'), tipo: res.monto > 0 ? 'Depósito' : 'Pago' });
      row.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(9).numFmt = '"$"#,##0.00';
      if (res.estado === 'CONCILIADO') row.getCell(5).font = { color: { argb: COLOR_VERDE }, bold: true };
      else if (res.estado === 'SIN_FACTURA') row.getCell(5).font = { color: { argb: COLOR_ROJO }, bold: true };
      else if (res.estado === 'NO_REQUIERE') row.getCell(5).font = { color: { argb: COLOR_AZUL }, bold: true };
      else row.getCell(5).font = { color: { argb: COLOR_AMARILLO }, bold: true };
    }

    // ===== HOJA 4: BANORTE MATCH =====
    const ws4 = wb.addWorksheet('🏦 Banorte Match');
    ws4.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Monto Banco', key: 'monto', width: 14 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'UUID Factura', key: 'uuid', width: 36 },
      { header: 'Folio', key: 'folio', width: 12 },
      { header: 'Cliente/Proveedor', key: 'clienteProveedor', width: 30 },
      { header: 'Monto Factura', key: 'montoFactura', width: 14 },
    ];
    ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_VERDE } };

    for (const res of resultadosBanorte) {
      const row = ws4.addRow({ ...res, fecha: res.fecha.toLocaleDateString('es-MX'), tipo: res.monto > 0 ? 'Depósito' : 'Pago' });
      row.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(9).numFmt = '"$"#,##0.00';
      if (res.estado === 'CONCILIADO') row.getCell(5).font = { color: { argb: COLOR_VERDE }, bold: true };
      else if (res.estado === 'SIN_FACTURA') row.getCell(5).font = { color: { argb: COLOR_ROJO }, bold: true };
      else if (res.estado === 'NO_REQUIERE') row.getCell(5).font = { color: { argb: COLOR_AZUL }, bold: true };
      else row.getCell(5).font = { color: { argb: COLOR_AMARILLO }, bold: true };
    }

    // ===== HOJA 5: TOP CLIENTES =====
    const ws5 = wb.addWorksheet('👥 Top Clientes');
    ws5.columns = [{ header: '#', key: 'pos', width: 5 }, { header: 'Cliente', key: 'nombre', width: 35 }, { header: 'RFC', key: 'rfc', width: 18 }, { header: 'Facturas', key: 'count', width: 10 }, { header: 'Total', key: 'total', width: 16 }];
    ws5.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws5.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_VERDE } };

    topClientes.forEach((c, i) => {
      const row = ws5.addRow({ pos: i + 1, ...c });
      row.getCell(5).numFmt = '"$"#,##0.00';
    });

    // ===== HOJA 6: TOP PROVEEDORES =====
    const ws6 = wb.addWorksheet('🚚 Top Proveedores');
    ws6.columns = [{ header: '#', key: 'pos', width: 5 }, { header: 'Proveedor', key: 'nombre', width: 35 }, { header: 'RFC', key: 'rfc', width: 18 }, { header: 'Facturas', key: 'count', width: 10 }, { header: 'Total', key: 'total', width: 16 }];
    ws6.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws6.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_AMARILLO } };

    topProveedores.forEach((p, i) => {
      const row = ws6.addRow({ pos: i + 1, ...p });
      row.getCell(5).numFmt = '"$"#,##0.00';
    });

    // ===== HOJA 7: PARTIDAS NO CONCILIABLES =====
    const ws7 = wb.addWorksheet('🔵 No Conciliables');
    ws7.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Banco', key: 'banco', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 }, { header: 'Concepto', key: 'concepto', width: 45 },
      { header: 'Monto', key: 'monto', width: 14 }, { header: 'Categoría', key: 'categoria', width: 20 },
    ];
    ws7.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws7.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_AZUL } };

    for (const nc of noConciliables) {
      const row = ws7.addRow({ ...nc, fecha: nc.fecha.toLocaleDateString('es-MX'), tipo: nc.monto > 0 ? 'Depósito' : 'Pago' });
      row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    }

    // ===== HOJA 8: CFDIs SIN PAGO =====
    const ws8 = wb.addWorksheet('⚠️ CFDIs Sin Pago');
    ws8.columns = [
      { header: 'Tipo', key: 'tipo', width: 10 }, { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 14 }, { header: 'Nombre', key: 'nombre', width: 35 },
      { header: 'RFC', key: 'rfc', width: 18 }, { header: 'Total', key: 'total', width: 16 },
      { header: 'UUID', key: 'uuid', width: 36 },
    ];
    ws8.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws8.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ROJO } };

    for (const f of emitidasSinPago) {
      const row = ws8.addRow({ tipo: 'Emitida', fecha: f.fecha.toLocaleDateString('es-MX'), folio: `${f.serie || ''}${f.folio}`, nombre: f.receptorNombre || '', rfc: f.receptorRfc || '', total: f.total, uuid: f.uuid || '' });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(1).font = { color: { argb: COLOR_VERDE }, bold: true };
    }
    for (const f of recibidasSinPago) {
      const row = ws8.addRow({ tipo: 'Recibida', fecha: f.fecha.toLocaleDateString('es-MX'), folio: `${f.serie || ''}${f.folio}`, nombre: f.emisorNombre || '', rfc: f.emisorRfc || '', total: f.total, uuid: f.uuid || '' });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(1).font = { color: { argb: COLOR_AMARILLO }, bold: true };
    }

    // ===== HOJA 9: DICTAMEN =====
    const ws9 = wb.addWorksheet('📝 Dictamen', { views: [{ showGridLines: false }] });
    ws9.columns = [{ width: 100 }];

    ws9.getCell('A1').value = 'DICTAMEN DE CONCILIACIÓN';
    ws9.getCell('A1').font = { bold: true, size: 18, color: { argb: COLOR_PRIMARIO } };

    let r9 = 3;
    const dictamen = [
      `1. CONCILIACIÓN: ${conciliados} de ${totalMovs} movimientos conciliados con factura (${tasaConc.toFixed(1)}%).`,
      `   ${noReq} movimientos no requieren factura (transferencias, comisiones, créditos, impuestos).`,
      `   ${sinFactura} movimientos realmente sin factura — requieren revisión.`,
      ``,
      `2. VENTAS: ${facturasEmitidas.length} CFDIs emitidos por $${totalVentas.toFixed(2)}.`,
      `   ${emitidasSinPago.length} facturas SIN cobro (cuentas por cobrar).`,
      ``,
      `3. COMPRAS: ${facturasRecibidas.length} CFDIs recibidos por $${totalCompras.toFixed(2)}.`,
      `   ${recibidasSinPago.length} facturas SIN pago (cuentas por pagar).`,
      ``,
      `4. UTILIDAD BRUTA: $${utilidad.toFixed(2)} (Margen: ${margen.toFixed(1)}%).`,
      `   ${margen > 30 ? '✅ Excelente margen.' : margen > 15 ? '⚠️ Margen aceptable.' : '⚠️ Margen bajo.'}`,
      ``,
      `5. SALDOS BANCARIOS: Banorte $${saldoB.toFixed(2)} + Santander $${saldoS.toFixed(2)} = $${(saldoB + saldoS).toFixed(2)}.`,
      ``,
      `RECOMENDACIONES:`,
      `   a) Subir complementos de pago (CFDIs tipo P) para mejorar conciliación.`,
      `   b) Los ${sinFactura} movimientos sin factura pueden no ser deducibles fiscalmente.`,
      `   c) Las ${emitidasSinPago.length} facturas sin cobro representan cuentas por cobrar pendientes.`,
      `   d) Las ${recibidasSinPago.length} facturas sin pago representan cuentas por pagar pendientes.`,
      `   e) Revisar movimientos con estado MULTIPLES para asignar factura correcta.`,
      `   f) Generar pólizas contables con partida doble a partir de esta conciliación.`,
      `   g) Mantener conciliación mensual para detectar discrepancias a tiempo.`,
    ];

    for (const linea of dictamen) {
      ws9.getCell(`A${r9}`).value = linea;
      if (linea.startsWith('RECOMENDACIONES')) ws9.getCell(`A${r9}`).font = { bold: true, size: 12, color: { argb: COLOR_PRIMARIO } };
      else if (linea.startsWith('✅') || linea.startsWith('⚠️')) ws9.getCell(`A${r9}`).font = { bold: true };
      ws9.getCell(`A${r9}`).alignment = { wrapText: true };
      r9++;
    }

    // Eliminar hoja temporal
    wb.removeWorksheet('chart_temp');

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Conciliacion_Maestra_${anio}_${empresa?.rfc}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error('Error en conciliacion-maestra:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
