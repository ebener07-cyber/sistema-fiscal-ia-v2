#!/usr/bin/env python3
"""Add Finanzas module link to Sidebar.tsx"""
import re

target = "/home/z/my-project/nuevo-proyecto/components/Sidebar.tsx"
with open(target, "rb") as f:
    text = f.read().decode("utf-8")

# 1. Add TrendingUp import
old_import = "  BarChart3,\n} from \"lucide-react\";"
new_import = "  BarChart3,\n  TrendingUp,\n} from \"lucide-react\";"

# CRLF version
old_import_crlf = old_import.replace("\n", "\r\n")
new_import_crlf = new_import.replace("\n", "\r\n")

if old_import_crlf in text:
    text = text.replace(old_import_crlf, new_import_crlf, 1)
    print("OK: import added")
else:
    print("WARN: import pattern not found, trying without CRLF")
    if old_import in text:
        text = text.replace(old_import, new_import, 1)
        print("OK: import added (LF)")
    else:
        print("FAIL: import pattern not found")

# 2. Add Finanzas link before Reportes
old_link = '<Link\r\n  href="/reportes"\r\n  className="block text-gray-400 hover:text-purple-400 py-2"\r\n>\r\n  Reportes\r\n</Link>'

new_link = '''<Link
  href="/finanzas"
  className="flex items-center gap-3 text-purple-300 hover:text-purple-400 font-semibold"
>
  <TrendingUp size={18} />
  Reestructura Financiera
</Link>

<Link
  href="/reportes"
  className="block text-gray-400 hover:text-purple-400 py-2"
>
  Reportes
</Link>'''

if old_link in text:
    text = text.replace(old_link, new_link, 1)
    print("OK: finanzas link added")
else:
    print("FAIL: reportes link pattern not found")
    # Try to find Reportes link variant
    if 'href="/reportes"' in text:
        print("  → /reportes href exists, but exact pattern not matched")

with open(target, "wb") as f:
    f.write(text.encode("utf-8"))

print("Done.")
