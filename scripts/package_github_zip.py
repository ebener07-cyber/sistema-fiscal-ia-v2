#!/usr/bin/env python3
"""
Genera el ZIP final del Sistema Fiscal IA + Abbax listo para subir a GitHub.

Incluye:
- Todo /src (código Next.js 16)
- /prisma (schema)
- /public (assets estáticos)
- /scripts (seed, process-laws)
- /skills/auditoria-fiscal/laws (RAG - 9 leyes fiscales)
- Config: package.json, tsconfig.json, next.config.ts, vercel.json, etc.

Excluye:
- node_modules, .next, .git, .vercel
- /nuevo-proyecto (carpeta legacy)
- /skills/* (excepto auditoria-fiscal/laws)
- Archivos locales (.env, logs, db/custom.db)
"""

import os
import zipfile
import fnmatch
from pathlib import Path

PROJECT_ROOT = Path("/home/z/my-project")
OUTPUT_ZIP = Path("/home/z/my-project/download/sistema-fiscal-ia-github.zip")

# Patrones a excluir SIEMPRE
EXCLUDE_DIRS = {
    "node_modules", ".next", ".git", ".vercel", ".turbo",
    "nuevo-proyecto", "upload", "db", "mini-services",
    "examples", "obsidian-sync", "obsidian-vault",
    "graphify", "prompts", "docs",
    "download", ".zscripts", "agent-ctx",
    "skills-referencia",  # ← NO subir los repos de referencia al GitHub
    "Caddyfile",  # local dev only
}

EXCLUDE_FILES = {
    ".env", ".env.local", ".env.production",
    "dev.log", "dev.out.log", "server.log",
    "custom.db", "custom.db-journal",
    ".z-ai-config",
    "sistema-fiscal-ia-github.zip",  # evita auto-inclusión si se re-ejecuta
    "nuevo-proyecto-corregido.zip",
    "tsconfig.tsbuildinfo",
    "AGENTS.md", "CLAUDE.md", "build-output.txt",
}

EXCLUDE_PATTERNS = [
    "*.log", "*.db", "*.db-journal", "*.zip",
    ".DS_Store", "Thumbs.db",
    "build-output.txt",
    "*.png", "*.jpg", "*.jpeg", "*.gif",  # screenshots locales
]

# Skills: solo incluir /skills/auditoria-fiscal/laws/*
# (los .md y SKILL.md no se incluyen para mantener limpio el repo)
def should_include_skill_path(rel_path: str) -> bool:
    """Devuelve True si el archivo bajo skills/ debe incluirse."""
    # Solo auditoria-fiscal/laws/
    return rel_path.startswith("skills/auditoria-fiscal/laws/")


def should_skip(path: Path, rel_path: str) -> bool:
    """Decide si un archivo/directorio debe saltarse."""
    parts = path.parts

    # Excluir dirs de nivel superior
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True

    # Excluir archivos específicos
    if path.name in EXCLUDE_FILES:
        return True

    # Excluir por patrón
    for pat in EXCLUDE_PATTERNS:
        if fnmatch.fnmatch(path.name, pat):
            return True

    # Skills: SOLO incluir auditoria-fiscal/laws/
    if "skills" in parts:
        if not should_include_skill_path(rel_path):
            return True

    return False


def main():
    if OUTPUT_ZIP.exists():
        OUTPUT_ZIP.unlink()

    print(f"📦 Empaquetando proyecto desde: {PROJECT_ROOT}")
    print(f"📄 Archivo de salida: {OUTPUT_ZIP}")
    print()

    file_count = 0
    total_size = 0

    with zipfile.ZipFile(OUTPUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(PROJECT_ROOT):
            root_path = Path(root)

            # Filtrar dirs in-place para no descender a ellos
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for fname in files:
                fpath = root_path / fname
                rel_path = str(fpath.relative_to(PROJECT_ROOT))

                if should_skip(fpath, rel_path):
                    continue

                # Arc name = rel_path (preserva estructura)
                arcname = rel_path

                try:
                    file_size = fpath.stat().st_size
                    zf.write(fpath, arcname)
                    file_count += 1
                    total_size += file_size

                    # Mostrar progreso cada 100 archivos
                    if file_count % 100 == 0:
                        print(f"  ... {file_count} archivos empaquetados")

                except (PermissionError, OSError) as e:
                    print(f"  ⚠️  Saltando {rel_path}: {e}")

    zip_size = OUTPUT_ZIP.stat().st_size
    print()
    print(f"✅ ZIP generado correctamente")
    print(f"   📁 Archivos empaquetados: {file_count}")
    print(f"   💾 Tamaño original total: {total_size / 1024 / 1024:.2f} MB")
    print(f"   📦 Tamaño del ZIP: {zip_size / 1024 / 1024:.2f} MB")
    print(f"   📍 Ubicación: {OUTPUT_ZIP}")


if __name__ == "__main__":
    main()
