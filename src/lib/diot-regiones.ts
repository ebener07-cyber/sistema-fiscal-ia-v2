/**
 * MAPEO DE REGIÓN FISCAL — SAT 2025/2026
 *
 * Determina si un código postal (LugarExpedicion del CFDI) está en:
 * - Frontera Norte (RFN): IVA 8%
 * - Frontera Sur (RFS): IVA 8% (a partir de 2025)
 * - Resto del país: IVA 16%
 */

const CP_FRONTERA_NORTE: Array<[number, number]> = [
  [21000, 22999], [83000, 83999], [84000, 84999], [85000, 85999],
  [83490, 83499], [32800, 32899], [32900, 32999], [32780, 32789],
  [32880, 32889], [32810, 32819], [32850, 32859], [32840, 32849],
  [32300, 32399], [26900, 26999], [26920, 26929], [26940, 26949],
  [26000, 26099], [26950, 26959], [26960, 26969], [26970, 26979],
  [26930, 26939], [65000, 65999], [65750, 65759], [65730, 65739],
  [65700, 65709], [65710, 65719], [65790, 65799], [65740, 65749],
  [65780, 65789], [65720, 65729], [65770, 65779], [65760, 65769],
  [65745, 65749], [65755, 65759], [88000, 88999], [87900, 87999],
  [87770, 87779], [87780, 87789], [87750, 87759], [87730, 87739],
  [88700, 88799], [88900, 88909], [89000, 89099], [87300, 87399],
];

const CP_FRONTERA_SUR: Array<[number, number]> = [
  [30700, 30799], [30800, 30899], [30810, 30819], [30820, 30829],
  [30830, 30839], [30840, 30849], [30850, 30859],
];

export type RegionFiscal = 'frontera_norte' | 'frontera_sur' | 'resto';

export function determinarRegionFiscal(cp: string): RegionFiscal {
  const cpNum = parseInt(cp);
  if (isNaN(cpNum)) return 'resto';
  for (const [min, max] of CP_FRONTERA_NORTE) {
    if (cpNum >= min && cpNum <= max) return 'frontera_norte';
  }
  for (const [min, max] of CP_FRONTERA_SUR) {
    if (cpNum >= min && cpNum <= max) return 'frontera_sur';
  }
  return 'resto';
}

export function tasaIVAPorRegion(region: RegionFiscal): number {
  if (region === 'frontera_norte' || region === 'frontera_sur') return 8.0;
  return 16.0;
}

/**
 * Valores confirmados desde el código fuente de satcfdi v4.6.0:
 *
 * TipoTercero:
 *   PROVEEDOR_NACIONAL   = "04"
 *   PROVEEDOR_EXTRANJERO = "05"
 *   PROVEEDOR_GLOBAL     = "15"
 *
 * TipoOperacion:
 *   PRESTACION_DE_SERVICIOS_PROFESIONALES = "03"
 *   ARRENDAMIENTO_DE_INMUEBLES            = "06"
 *   OTROS                                  = "85"
 */
export function determinarTipoTercero(rfc: string): { tipoTercero: string; esGlobal: boolean; esExtranjero: boolean } {
  const rfcUpper = rfc.toUpperCase().trim();
  if (rfcUpper === 'XAXX010101000') return { tipoTercero: '15', esGlobal: true, esExtranjero: false };
  if (rfcUpper === 'XEXX010101000' || rfcUpper.startsWith('XEX')) return { tipoTercero: '05', esGlobal: false, esExtranjero: true };
  return { tipoTercero: '04', esGlobal: false, esExtranjero: false };
}

export function determinarTipoOperacionDIOT(tipoComprobante: string, conceptoTexto: string): string {
  const upper = conceptoTexto.toUpperCase();
  if (upper.includes('RENTA') || upper.includes('ARRENDAMIENTO') || upper.includes('ALQUILER')) return '06';
  if (upper.includes('SERVICIO') || upper.includes('HONORARIO') || upper.includes('MANTENIMIENTO') ||
      upper.includes('INSTALACION') || upper.includes('INSTALACIÓN') || upper.includes('REPARACION') ||
      upper.includes('REPARACIÓN') || upper.includes('CONSULTORIA') || upper.includes('CONSULTORÍA')) return '03';
  return '85';
}

export function clasificarIVADiot(
  subtotal: number, iva: number, region: RegionFiscal, exento: boolean = false
): { base16: number; iva16Acreditable: number; base8: number; iva8Acreditable: number; base0: number; baseExento: number } {
  if (exento) return { base16: 0, iva16Acreditable: 0, base8: 0, iva8Acreditable: 0, base0: 0, baseExento: subtotal };
  if (region === 'frontera_norte' || region === 'frontera_sur') {
    return { base16: 0, iva16Acreditable: 0, base8: subtotal, iva8Acreditable: iva, base0: 0, baseExento: 0 };
  }
  return { base16: subtotal, iva16Acreditable: iva, base8: 0, iva8Acreditable: 0, base0: 0, baseExento: 0 };
}
