/**
 * ============================================================================
 * MAPEO DE REGIÓN FISCAL + CATÁLOGO SAT — DIOT 2025/2026
 * ----------------------------------------------------------------------------
 * Basado en:
 *  - Instructivo SAT "armado del archivo de carga masiva DIOT REV-2"
 *  - Ejemplo oficial "Ejemplo Carga 2025 en adelante..xlsx"
 *  - satcfdi v4.6.0 (validación de catálogos)
 *
 * Regiones fiscales (DIOT 2025):
 *  - Frontera Norte (RFN): IVA 8%
 *  - Frontera Sur  (RFS): IVA 8% (nuevo 2025 — Chiapas)
 *  - Resto del país: IVA 16%
 *
 * TipoTercero (satcfdi):
 *   "04" = PROVEEDOR_NACIONAL
 *   "05" = PROVEEDOR_EXTRANJERO
 *   "15" = PROVEEDOR_GLOBAL (XAXX010101000)
 *
 * TipoOperacion (SAT 2025+):
 *   Nacional:  02 Enajenación de bienes | 03 Serv. Profesionales | 06 Uso/goce | 85 Otros
 *   Extranjero: 02 Enajenación | 03 Serv. Prof. | 07 Importación | 85 Otros
 *   Global: 87 Operaciones globales
 * ============================================================================
 */

// ============================================================================
// CÓDIGOS POSTALES — REGIÓN FRONTERA NORTE
// ============================================================================
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

// ============================================================================
// CÓDIGOS POSTALES — REGIÓN FRONTERA SUR (Chiapas, nuevo 2025)
// ============================================================================
const CP_FRONTERA_SUR: Array<[number, number]> = [
  [30700, 30799], [30800, 30899], [30810, 30819], [30820, 30829],
  [30830, 30839], [30840, 30849], [30850, 30859],
];

export type RegionFiscal = 'frontera_norte' | 'frontera_sur' | 'resto';

export function determinarRegionFiscal(cp: string | null | undefined): RegionFiscal {
  if (!cp) return 'resto';
  const cpNum = parseInt(String(cp));
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

// ============================================================================
// CATÁLOGO DE PAÍSES (extracto del instructivo SAT DIOT)
// ============================================================================
export const CATALOGO_PAISES_SAT: Record<string, string> = {
  'MEX': 'México',
  'USA': 'Estados Unidos de América',
  'CAN': 'Canadá',
  'ESP': 'España',
  'CHN': 'China',
  'JPN': 'Japón',
  'GBR': 'Reino Unido',
  'DEU': 'Alemania',
  'FRA': 'Francia',
  'ITA': 'Italia',
  'BRA': 'Brasil',
  'COL': 'Colombia',
  'ARG': 'Argentina',
  'CHL': 'Chile',
  'PER': 'Perú',
  'VEN': 'Venezuela',
  'CUB': 'Cuba',
  'DOM': 'República Dominicana',
  'GTM': 'Guatemala',
  'HND': 'Honduras',
  'SLV': 'El Salvador',
  'NIC': 'Nicaragua',
  'CRI': 'Costa Rica',
  'PAN': 'Panamá',
  'ECU': 'Ecuador',
  'URY': 'Uruguay',
  'PRY': 'Paraguay',
  'BOL': 'Bolivia',
  'IND': 'India',
  'KOR': 'Corea del Sur',
  'AUS': 'Australia',
  'ZAF': 'Sudáfrica',
  'RUS': 'Rusia',
  'NLD': 'Países Bajos',
  'BEL': 'Bélgica',
  'CHE': 'Suiza',
  'SWE': 'Suecia',
  'NOR': 'Noruega',
  'FIN': 'Finlandia',
  'DNK': 'Dinamarca',
  'POL': 'Polonia',
  'PRT': 'Portugal',
  'GRC': 'Grecia',
  'TUR': 'Turquía',
  'ISR': 'Israel',
  'SAU': 'Arabia Saudita',
  'ARE': 'Emiratos Árabes Unidos',
  'SGP': 'Singapur',
  'HKG': 'Hong Kong',
  'TWN': 'Taiwán',
  'THA': 'Tailandia',
  'VNM': 'Vietnam',
  'IDN': 'Indonesia',
  'MYS': 'Malasia',
  'PHL': 'Filipinas',
  'ZZZ': 'Otro',
};

export function buscarCodigoPais(nombrePais: string): string {
  if (!nombrePais) return '';
  const upper = nombrePais.toUpperCase().trim();
  for (const [codigo, nombre] of Object.entries(CATALOGO_PAISES_SAT)) {
    if (nombre.toUpperCase() === upper) return codigo;
    if (nombre.toUpperCase().includes(upper) || upper.includes(nombre.toUpperCase())) return codigo;
  }
  return 'ZZZ';
}

// ============================================================================
// TIPO DE TERCERO (satcfdi v4.6.0)
// ============================================================================
export function determinarTipoTercero(rfc: string): { tipoTercero: string; esGlobal: boolean; esExtranjero: boolean; esNacional: boolean } {
  const rfcUpper = (rfc || '').toUpperCase().trim();
  if (rfcUpper === 'XAXX010101000') {
    return { tipoTercero: '15', esGlobal: true, esExtranjero: false, esNacional: false };
  }
  if (rfcUpper === 'XEXX010101000' || rfcUpper.startsWith('XEX')) {
    return { tipoTercero: '05', esGlobal: false, esExtranjero: true, esNacional: false };
  }
  return { tipoTercero: '04', esGlobal: false, esExtranjero: false, esNacional: true };
}

// ============================================================================
// TIPO DE OPERACIÓN (SAT 2025+)
// ============================================================================
export function determinarTipoOperacionDIOT(
  tipoComprobante: string,
  conceptoTexto: string,
  esExtranjero: boolean = false,
): string {
  const upper = (conceptoTexto || '').toUpperCase();

  // Importación (solo extranjeros)
  if (esExtranjero && (upper.includes('IMPORTACION') || upper.includes('IMPORTACIÓN'))) return '07';

  // Uso o goce temporal de bienes (arrendamiento)
  if (upper.includes('RENTA') || upper.includes('ARRENDAMIENTO') || upper.includes('ALQUILER')) return '06';

  // Enajenación de bienes (venta de mercancía)
  if (
    upper.includes('COMPRA') || upper.includes('VENTA') || upper.includes('MERCANCIA') ||
    upper.includes('MERCANCÍA') || upper.includes('BIENES') || upper.includes('PRODUCTO') ||
    upper.includes('MATERIAL') || upper.includes('EQUIPO')
  ) return '02';

  // Prestación de servicios profesionales
  if (
    upper.includes('SERVICIO') || upper.includes('HONORARIO') || upper.includes('MANTENIMIENTO') ||
    upper.includes('INSTALACION') || upper.includes('INSTALACIÓN') || upper.includes('REPARACION') ||
    upper.includes('REPARACIÓN') || upper.includes('CONSULTORIA') || upper.includes('CONSULTORÍA') ||
    upper.includes('PROFESIONAL') || upper.includes('ASESORIA') || upper.includes('ASESORÍA')
  ) return '03';

  // Otros
  return '85';
}

// ============================================================================
// CLASIFICACIÓN IVA — DESGLOSE DIOT 2025
// ============================================================================
export interface ClasificacionIVA {
  // Valor de actos o actividades (campos 8-17)
  baseFronteraNorte: number;       // campo 8 — base IVA 8% FN
  devolucionesFronteraNorte: number; // campo 9
  baseFronteraSur: number;          // campo 10
  devolucionesFronteraSur: number;  // campo 11
  base16: number;                    // campo 12 — base IVA 16%
  devoluciones16: number;            // campo 13
  baseImportacionTangible16: number; // campo 14
  devolucionesImportacionTangible16: number; // campo 15
  baseImportacionIntangible16: number; // campo 16
  devolucionesImportacionIntangible16: number; // campo 17
  // IVA acreditable (campos 18-27)
  ivaAcredFNExclusivo: number;       // campo 18
  ivaAcredFNProporcion: number;      // campo 19
  ivaAcredFSExclusivo: number;       // campo 20
  ivaAcredFSProporcion: number;      // campo 21
  ivaAcred16Exclusivo: number;       // campo 22
  ivaAcred16Proporcion: number;      // campo 23
  ivaAcredImpTan16Excl: number;      // campo 24
  ivaAcredImpTan16Prop: number;      // campo 25
  ivaAcredImpInt16Excl: number;      // campo 26
  ivaAcredImpInt16Prop: number;      // campo 27
  // IVA no acreditable (campos 28-47)
  ivaNoAcredFNProporcion: number;    // campo 28
  ivaNoAcredFNNoRequisito: number;   // campo 29
  ivaNoAcredFNExenta: number;        // campo 30
  ivaNoAcredFNNoObjeto: number;      // campo 31
  ivaNoAcredFSProporcion: number;    // campo 32
  ivaNoAcredFSNoRequisito: number;   // campo 33
  ivaNoAcredFSExenta: number;        // campo 34
  ivaNoAcredFSNoObjeto: number;      // campo 35
  ivaNoAcred16Proporcion: number;    // campo 36
  ivaNoAcred16NoRequisito: number;   // campo 37
  ivaNoAcred16Exenta: number;        // campo 38
  ivaNoAcred16NoObjeto: number;      // campo 39
  ivaNoAcredImpTan16Prop: number;    // campo 40
  ivaNoAcredImpTan16NoReq: number;   // campo 41
  ivaNoAcredImpTan16Exenta: number;  // campo 42
  ivaNoAcredImpTan16NoObj: number;   // campo 43
  ivaNoAcredImpInt16Prop: number;    // campo 44
  ivaNoAcredImpInt16NoReq: number;   // campo 45
  ivaNoAcredImpInt16Exenta: number;  // campo 46
  ivaNoAcredImpInt16NoObj: number;   // campo 47
  // Datos adicionales (campos 48-54)
  ivaRetenidoPagado: number;         // campo 48
  exentoImportacion: number;         // campo 49
  exentoNacional: number;            // campo 50
  tasa0: number;                     // campo 51
  noObjetoNacional: number;          // campo 52
  noObjetoSinEstablecimiento: number; // campo 53
  manifiesto: string;                // campo 54 — "01" Sí | "02" No
}

export function clasificarIVADiot(
  subtotal: number,
  iva: number,
  region: RegionFiscal,
  ivaRetenido: number = 0,
  exento: boolean = false,
  tasaCero: boolean = false,
): ClasificacionIVA {
  const base: ClasificacionIVA = {
    baseFronteraNorte: 0, devolucionesFronteraNorte: 0,
    baseFronteraSur: 0, devolucionesFronteraSur: 0,
    base16: 0, devoluciones16: 0,
    baseImportacionTangible16: 0, devolucionesImportacionTangible16: 0,
    baseImportacionIntangible16: 0, devolucionesImportacionIntangible16: 0,
    ivaAcredFNExclusivo: 0, ivaAcredFNProporcion: 0,
    ivaAcredFSExclusivo: 0, ivaAcredFSProporcion: 0,
    ivaAcred16Exclusivo: 0, ivaAcred16Proporcion: 0,
    ivaAcredImpTan16Excl: 0, ivaAcredImpTan16Prop: 0,
    ivaAcredImpInt16Excl: 0, ivaAcredImpInt16Prop: 0,
    ivaNoAcredFNProporcion: 0, ivaNoAcredFNNoRequisito: 0, ivaNoAcredFNExenta: 0, ivaNoAcredFNNoObjeto: 0,
    ivaNoAcredFSProporcion: 0, ivaNoAcredFSNoRequisito: 0, ivaNoAcredFSExenta: 0, ivaNoAcredFSNoObjeto: 0,
    ivaNoAcred16Proporcion: 0, ivaNoAcred16NoRequisito: 0, ivaNoAcred16Exenta: 0, ivaNoAcred16NoObjeto: 0,
    ivaNoAcredImpTan16Prop: 0, ivaNoAcredImpTan16NoReq: 0, ivaNoAcredImpTan16Exenta: 0, ivaNoAcredImpTan16NoObj: 0,
    ivaNoAcredImpInt16Prop: 0, ivaNoAcredImpInt16NoReq: 0, ivaNoAcredImpInt16Exenta: 0, ivaNoAcredImpInt16NoObj: 0,
    ivaRetenidoPagado: Math.abs(ivaRetenido),
    exentoImportacion: 0,
    exentoNacional: exento ? Math.abs(subtotal) : 0,
    tasa0: tasaCero ? Math.abs(subtotal) : 0,
    noObjetoNacional: 0,
    noObjetoSinEstablecimiento: 0,
    manifiesto: '01', // Sí se dieron efectos fiscales
  };

  if (exento || tasaCero) return base;

  if (region === 'frontera_norte') {
    base.baseFronteraNorte = Math.abs(subtotal);
    base.ivaAcredFNExclusivo = Math.abs(iva);
  } else if (region === 'frontera_sur') {
    base.baseFronteraSur = Math.abs(subtotal);
    base.ivaAcredFSExclusivo = Math.abs(iva);
  } else {
    base.base16 = Math.abs(subtotal);
    base.ivaAcred16Exclusivo = Math.abs(iva);
  }

  return base;
}

/**
 * Ajusta un monto a entero según regla del Artículo 20 CFF:
 *   - De .01 a .50 → unidad inmediata anterior
 *   - De .51 a .99 → unidad inmediata superior
 *
 * Ej: 1450.50 → 1450
 *     1450.51 → 1451
 */
export function ajustarEnteroCFF(monto: number): number {
  const abs = Math.abs(monto);
  const enteros = Math.floor(abs);
  const centavos = abs - enteros;
  let resultado: number;
  if (centavos <= 0.50) {
    resultado = enteros;
  } else {
    resultado = enteros + 1;
  }
  return monto < 0 ? -resultado : resultado;
}
