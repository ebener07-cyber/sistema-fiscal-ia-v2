/**
 * CATEGORIZADOR DE MOVIMIENTOS NO CONCILIABLES
 *
 * Identifica movimientos bancarios que legítimamente NO requieren
 * una factura CFDI asociada. Estos movimientos se marcan con
 * un estado especial para que no aparezcan como "sin conciliar".
 *
 * Categorías de movimientos sin factura:
 * 1. Transferencias entre cuentas propias
 * 2. Comisiones bancarias
 * 3. Pagos de crédito (capital + intereses)
 * 4. Intereses bancarios
 * 5. IVA sobre comisiones
 * 6. Disposición de crédito
 * 7. Seguros
 * 8. Depósitos/retiros en efectivo
 */

export type CategoriaNoConciliable =
  | 'transferencia_propia'
  | 'comision_bancaria'
  | 'iva_comision'
  | 'pago_credito_capital'
  | 'pago_credito_intereses'
  | 'interes_bancario'
  | 'disposicion_credito'
  | 'seguro'
  | 'deposito_efectivo'
  | 'retiro_efectivo'
  | 'no_requiere_factura'
  | null;

interface ResultadoNoConciliable {
  categoria: CategoriaNoConciliable;
  razon: string;
  requiereFactura: boolean;
}

// Keywords para detectar movimientos que NO requieren factura
const REGLAS_NO_CONCILIABLES: Array<{
  keywords: string[];
  categoria: CategoriaNoConciliable;
  razon: string;
}> = [
  // Transferencias entre cuentas propias
  {
    keywords: ['TRASPASO', 'TRANSFERENCIA ENTRE CUENTAS PROPIAS', 'TRANSFERENCIA PROPIAS', 'ENTRE CUENTAS PROPIAS', 'TRANSPASO'],
    categoria: 'transferencia_propia',
    razon: 'Transferencia entre cuentas propias de la empresa',
  },
  // Comisiones bancarias
  {
    keywords: ['COMISION', 'COMISIÓN', 'ADMINISTRACION RENTA MEMBRESIA', 'RENTA MEMBRESIA', 'COM. DISPERSION', 'COM. ADMIN', 'CARGO POR PAGO CONCENTRACION'],
    categoria: 'comision_bancaria',
    razon: 'Comisión bancaria por servicios',
  },
  // IVA sobre comisiones
  {
    keywords: ['I V A POR COMISION', 'IVA COM', 'IVA 00054', 'IVA POR COMISION'],
    categoria: 'iva_comision',
    razon: 'IVA sobre comisión bancaria',
  },
  // Pago de capital de crédito
  {
    keywords: ['CARGO CAPITAL', 'PAGO DE CAPITAL', 'PAGO CAPITAL', 'CAPITAL DE CREDITO', 'CRE_', 'PAGO DE CREDITO'],
    categoria: 'pago_credito_capital',
    razon: 'Pago de capital de crédito bancario',
  },
  // Pago de intereses de crédito
  {
    keywords: ['CARGO POR INTERESES', 'INTERESES DE CREDITO', 'CGO INTERESES', 'INTERESES MORATORIOS', 'PAGO INTERES HIPOTECARIO'],
    categoria: 'pago_credito_intereses',
    razon: 'Pago de intereses de crédito bancario',
  },
  // Intereses bancarios (a favor del contribuyente)
  {
    keywords: ['INTERESES EXENTO', 'INTERES EXENTO', 'RENDIMIENTO'],
    categoria: 'interes_bancario',
    razon: 'Intereses bancarios ganados (exentos)',
  },
  // Disposición de crédito
  {
    keywords: ['DISPOSICION', 'DISPOSICION CREDITO', 'RETIRO DE CREDITO'],
    categoria: 'disposicion_credito',
    razon: 'Disposición de línea de crédito',
  },
  // Seguros
  {
    keywords: ['PRIMA SEGURO', 'SEGURO PYME', 'SEGURO AUTOCOMPARA', 'COM. SEGURO'],
    categoria: 'seguro',
    razon: 'Pago de prima de seguro',
  },
  // ===== GASTOS PERSONALES (no deducibles) =====
  {
    keywords: ['PENSION ALIMENTICIA', 'PENSIÓN ALIMENTICIA', 'TARJETA DE CREDITO FER', 'TARJETA TANIA', 'PAGO DE TARJETAS DE CREDITO'],
    categoria: 'no_requiere_factura',
    razon: 'Gasto personal (no deducible fiscalmente)',
  },
  // Pagos a IMSS
  {
    keywords: ['PAGO DE LDC-IMSS', 'LDC-IMSS', 'PAGO IMSS', 'IMSS'],
    categoria: 'no_requiere_factura',
    razon: 'Pago al IMSS (no requiere CFDI, usa línea de captura)',
  },
  // Impuestos federales
  {
    keywords: ['CGO IMPTO FED', 'IMPTO FED', 'IMPUESTO FEDERAL'],
    categoria: 'no_requiere_factura',
    razon: 'Pago de impuesto federal (usa línea de captura)',
  },
  // Retiros en efectivo
  {
    keywords: ['RETIRO DEP. ELECTRONICO', 'RETIRO DEPOSITO ELECTRONICO'],
    categoria: 'retiro_efectivo',
    razon: 'Retiro en efectivo',
  },
  // Pagos referenciados
  {
    keywords: ['PAGO REFERENCIADO', 'REFERENCIADO'],
    categoria: 'no_requiere_factura',
    razon: 'Pago referenciado (línea de captura)',
  },
];

/**
 * Determina si un movimiento bancario NO requiere factura CFDI
 */
export function categorizarNoConciliable(concepto: string, monto: number): ResultadoNoConciliable {
  const conceptoUpper = concepto.toUpperCase();

  for (const regla of REGLAS_NO_CONCILIABLES) {
    for (const keyword of regla.keywords) {
      if (conceptoUpper.includes(keyword)) {
        return {
          categoria: regla.categoria,
          razon: regla.razon,
          requiereFactura: false,
        };
      }
    }
  }

  return {
    categoria: null,
    razon: '',
    requiereFactura: true,
  };
}

/**
 * Lista de categorías no conciliables para mostrar en la UI
 */
export function listarCategoriasNoConciliables(): Array<{ categoria: CategoriaNoConciliable; razon: string }> {
  return REGLAS_NO_CONCILIABLES.map(r => ({ categoria: r.categoria, razon: r.razon }));
}
