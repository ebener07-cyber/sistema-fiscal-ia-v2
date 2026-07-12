#!/usr/bin/env python3
"""Add relation fields to Empresa model for the new financial models."""

target = "/home/z/my-project/nuevo-proyecto/prisma/schema.prisma"
with open(target, "rb") as f:
    text = f.read().decode("utf-8")

old = "  clientes     Cliente[]\r\n  facturas     Factura[]\r\n  empleados    Empleado[]\r\n  usuarios     Usuario[]\r\n}"
new = """  clientes     Cliente[]
  facturas     Factura[]
  empleados    Empleado[]
  usuarios     Usuario[]
  // Módulo Reestructura Financiera
  activos              Activo[]
  pasivos              Pasivo[]
  fondosEmergencia     FondoEmergencia[]
  movimientosFinancieros MovimientoFinanciero[]
  deudas               Deuda[]
  inversiones          Inversion[]
  seguros              Seguro[]
  metasFinancieras     MetaFinanciera[]
  kpisFinancieros      KPIFinanciero[]
}"""

if old in text:
    text = text.replace(old, new, 1)
    with open(target, "wb") as f:
        f.write(text.encode("utf-8"))
    print("OK: Empresa relations added")
else:
    print("FAIL: pattern not found")
