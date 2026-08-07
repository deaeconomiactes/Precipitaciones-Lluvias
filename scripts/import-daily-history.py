#!/usr/bin/env python3
"""Importa los Excel diarios históricos y los combina con la base operativa.

La unidad final es departamento-fecha. Los registros operativos prevalecen sobre
los históricos. Los libros fuente nunca se modifican.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import tempfile
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from statistics import fmean
from typing import Any, Iterable

import openpyxl
import xlrd


SOURCE_REPOSITORY = "https://github.com/cesarkali-40/Registro-de-lluvias"
RAW_BASE_URL = "https://raw.githubusercontent.com/cesarkali-40/Registro-de-lluvias/main"
SOURCE_FILES = [f"{year}.{'xls' if year <= 2020 else 'xlsx'}" for year in range(2015, 2026)]
MONTH_TOKENS = {
    "ene": 1, "enero": 1,
    "feb": 2, "febrero": 2,
    "mar": 3, "marzo": 3,
    "abr": 4, "abril": 4,
    "may": 5, "mayo": 5,
    "jun": 6, "junio": 6,
    "jul": 7, "julio": 7,
    "ago": 8, "agosto": 8,
    "sep": 9, "sept": 9, "septiembre": 9,
    "oct": 10, "octubre": 10,
    "nov": 11, "noviembre": 11,
    "dic": 12, "diciembre": 12,
}
DEPARTMENT_MAP = {
    "bella vista": "Bella Vista",
    "b astrada": "Beron de Astrada",
    "beron de astrada": "Beron de Astrada",
    "capital": "Capital",
    "capital corrientes": "Capital",
    "concepcion": "Concepcion",
    "c cuatia": "Curuzu Cuatia",
    "curuzu cuatia": "Curuzu Cuatia",
    "empedrado": "Empedrado",
    "esquina": "Esquina",
    "gral alvear": "General Alvear",
    "general alvear": "General Alvear",
    "gral paz": "General Paz",
    "general paz": "General Paz",
    "goya": "Goya",
    "itati": "Itati",
    "ituzaingo": "Ituzaingo",
    "lavalle": "Lavalle",
    "mburucuya": "Mburucuya",
    "mercedes": "Mercedes",
    # Mocoreta es una localidad del departamento Monte Caseros. Los Excel
    # contienen ambas columnas y la base mensual validada promedia las dos.
    "mocoreta": "Monte Caseros",
    "mte caseros": "Monte Caseros",
    "monte caseros": "Monte Caseros",
    "p d l libres": "Paso de los Libres",
    "p de los libres": "Paso de los Libres",
    "paso de los libres": "Paso de los Libres",
    "saladas": "Saladas",
    "san cosme": "San Cosme",
    "s l d palmar": "San Luis del Palmar",
    "san luis del palmar": "San Luis del Palmar",
    # La Cruz es una localidad del departamento San Martin y aparece como
    # columna adicional en algunos meses desde 2023.
    "la cruz": "San Martin",
    "san martin": "San Martin",
    "san miguel": "San Miguel",
    "san roque": "San Roque",
    "santo tome": "Santo Tome",
    "sauce": "Sauce",
}


@dataclass
class FileDiagnostics:
    file: str
    year: int
    sheets: int = 0
    valid_raw: int = 0
    valid_final: int = 0
    zero_records: int = 0
    historical_duplicates: int = 0
    discarded_date: int = 0
    discarded_department: int = 0
    discarded_rainfall: int = 0
    departments: set[str] = field(default_factory=set)
    dates: list[str] = field(default_factory=list)
    header_rows: set[int] = field(default_factory=set)
    sheet_names: list[str] = field(default_factory=list)

    @property
    def discarded_total(self) -> int:
        return self.discarded_date + self.discarded_department + self.discarded_rainfall


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFD", str(value).strip().lower())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def normalize_department(value: Any) -> str | None:
    return DEPARTMENT_MAP.get(normalize_text(value))


def month_from_sheet_name(sheet_name: str, sheet_index: int) -> int:
    tokens = normalize_text(sheet_name).split()
    for token in tokens:
        token_without_year = re.sub(r"\d+$", "", token)
        if token_without_year in MONTH_TOKENS:
            return MONTH_TOKENS[token_without_year]
    if 1 <= sheet_index <= 12:
        return sheet_index
    raise ValueError(f"No se pudo determinar el mes de la hoja {sheet_name!r}")


def workbook_rows(path: Path) -> Iterable[tuple[str, list[list[Any]]]]:
    if path.suffix.lower() == ".xls":
        book = xlrd.open_workbook(path, on_demand=True)
        try:
            for sheet in book.sheets():
                yield sheet.name, [sheet.row_values(index) for index in range(sheet.nrows)]
        finally:
            book.release_resources()
        return

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for sheet in book.worksheets:
            yield sheet.title, [list(row) for row in sheet.iter_rows(values_only=True)]
    finally:
        book.close()


def find_header_row(rows: list[list[Any]]) -> int | None:
    for index, row in enumerate(rows[:15]):
        if sum(normalize_text(value) == "dia" for value in row) >= 2:
            return index
    return None


def parse_day(value: Any, year: int, month: int) -> date | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric) or not numeric.is_integer():
        return None
    try:
        return date(year, month, int(numeric))
    except ValueError:
        return None


def parse_rainfall(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if "," in text and "." in text:
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", ".")
        try:
            numeric = float(text)
        except ValueError:
            return None
    else:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
    if not math.isfinite(numeric) or numeric < 0 or numeric > 1000:
        return None
    return round(numeric, 2)


def parse_sheet(
    rows: list[list[Any]],
    *,
    year: int,
    month: int,
    origin_file: str,
    diagnostics: FileDiagnostics,
) -> list[dict[str, Any]]:
    header_index = find_header_row(rows)
    if header_index is None:
        raise ValueError(f"{origin_file}: no se encontro una fila con dos encabezados DIA")
    diagnostics.header_rows.add(header_index + 1)
    headers = rows[header_index]
    column_specs: list[tuple[int, int, str | None]] = []
    current_day_column: int | None = None
    for column_index, header in enumerate(headers):
        if normalize_text(header) == "dia":
            current_day_column = column_index
            continue
        if current_day_column is None or normalize_text(header) == "":
            continue
        column_specs.append((column_index, current_day_column, normalize_department(header)))

    records: list[dict[str, Any]] = []
    for row in rows[header_index + 1:]:
        for rainfall_column, day_column, department in column_specs:
            day_value = row[day_column] if day_column < len(row) else None
            if day_value is None or normalize_text(day_value) in {"", "total"}:
                continue
            record_date = parse_day(day_value, year, month)
            if record_date is None:
                diagnostics.discarded_date += 1
                continue
            if department is None:
                diagnostics.discarded_department += 1
                continue
            rainfall_value = row[rainfall_column] if rainfall_column < len(row) else None
            rainfall = parse_rainfall(rainfall_value)
            if rainfall is None:
                diagnostics.discarded_rainfall += 1
                continue
            iso_date = record_date.isoformat()
            diagnostics.valid_raw += 1
            diagnostics.zero_records += int(rainfall == 0)
            diagnostics.departments.add(department)
            diagnostics.dates.append(iso_date)
            records.append({
                "date": iso_date,
                "department": department,
                "rainfallMm": rainfall,
                "source": "registro_lluvias_excel",
                "originFile": origin_file,
            })
    return records


def consolidate_records(records: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        groups[(record["department"], record["date"])].append(record)
    consolidated: list[dict[str, Any]] = []
    duplicates = 0
    for (_, _), group in groups.items():
        duplicates += len(group) - 1
        first = group[0]
        rainfall = round(fmean(float(record["rainfallMm"]) for record in group), 2)
        output = {
            "date": first["date"],
            "department": first["department"],
            "rainfallMm": rainfall,
            "source": first.get("source", "registro_lluvias_excel"),
        }
        origin_files = sorted({record.get("originFile") for record in group if record.get("originFile")})
        if origin_files:
            output["originFile"] = origin_files[0] if len(origin_files) == 1 else ",".join(origin_files)
        for coordinate in ("lat", "lng"):
            values = [record.get(coordinate) for record in group if isinstance(record.get(coordinate), (int, float))]
            if values:
                output[coordinate] = round(fmean(values), 6)
        consolidated.append(output)
    consolidated.sort(key=lambda record: (record["date"], record["department"]))
    return consolidated, duplicates


def download_source_files(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for file_name in SOURCE_FILES:
        url = f"{RAW_BASE_URL}/{file_name}"
        target = destination / file_name
        print(f"Descargando {url}")
        request = urllib.request.Request(url, headers={"User-Agent": "rainfall-history-importer/1.0"})
        with urllib.request.urlopen(request, timeout=90) as response:
            target.write_bytes(response.read())


def load_historical(source_dir: Path) -> tuple[list[dict[str, Any]], list[FileDiagnostics]]:
    all_records: list[dict[str, Any]] = []
    diagnostics_by_file: list[FileDiagnostics] = []
    for file_name in SOURCE_FILES:
        path = source_dir / file_name
        if not path.exists():
            raise FileNotFoundError(f"Falta el archivo fuente requerido: {path}")
        year = int(path.stem)
        diagnostics = FileDiagnostics(file=file_name, year=year)
        file_records: list[dict[str, Any]] = []
        for sheet_index, (sheet_name, rows) in enumerate(workbook_rows(path), start=1):
            diagnostics.sheets += 1
            diagnostics.sheet_names.append(sheet_name)
            month = month_from_sheet_name(sheet_name, sheet_index)
            file_records.extend(parse_sheet(
                rows,
                year=year,
                month=month,
                origin_file=file_name,
                diagnostics=diagnostics,
            ))
        consolidated, duplicates = consolidate_records(file_records)
        diagnostics.historical_duplicates = duplicates
        diagnostics.valid_final = len(consolidated)
        all_records.extend(consolidated)
        diagnostics_by_file.append(diagnostics)
    historical, cross_file_duplicates = consolidate_records(all_records)
    if cross_file_duplicates:
        raise ValueError(f"Se detectaron {cross_file_duplicates} duplicados historicos entre archivos anuales")
    return historical, diagnostics_by_file


def valid_iso_date(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None
    return parsed.isoformat() if parsed.isoformat() == value else None


def load_operational(path: Path) -> tuple[list[dict[str, Any]], Counter[str]]:
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(raw, list):
        raise ValueError(f"{path} debe contener un array JSON")
    diagnostics: Counter[str] = Counter()
    valid: list[dict[str, Any]] = []
    for record in raw:
        if not isinstance(record, dict):
            diagnostics["invalid_record"] += 1
            continue
        record_date = valid_iso_date(record.get("date"))
        department = normalize_department(record.get("department"))
        rainfall = parse_rainfall(record.get("rainfallMm"))
        if record_date is None:
            diagnostics["invalid_date"] += 1
            continue
        if department is None:
            diagnostics["invalid_department"] += 1
            continue
        if rainfall is None:
            diagnostics["invalid_rainfall"] += 1
            continue
        output = {
            "date": record_date,
            "department": department,
            "rainfallMm": rainfall,
            "source": record.get("source") or "rainfall_daily_operational",
        }
        for coordinate in ("lat", "lng"):
            value = record.get(coordinate)
            if isinstance(value, (int, float)) and math.isfinite(float(value)):
                output[coordinate] = round(float(value), 6)
        valid.append(output)
        diagnostics["zero_records"] += int(rainfall == 0)
    consolidated, duplicates = consolidate_records(valid)
    diagnostics["valid_raw"] = len(valid)
    diagnostics["valid_final"] = len(consolidated)
    diagnostics["duplicates"] = duplicates
    return consolidated, diagnostics


def combine_records(
    historical: list[dict[str, Any]],
    operational: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    by_key = {(record["department"], record["date"]): record for record in historical}
    overlaps = 0
    for record in operational:
        key = (record["department"], record["date"])
        overlaps += int(key in by_key)
        by_key[key] = record
    combined = sorted(by_key.values(), key=lambda record: (record["date"], record["department"]))
    return combined, overlaps


def write_json(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n"
    path.write_text(content, encoding="utf-8", newline="\n")


def print_diagnostics(
    historical: list[dict[str, Any]],
    operational: list[dict[str, Any]],
    combined: list[dict[str, Any]],
    files: list[FileDiagnostics],
    operational_diagnostics: Counter[str],
    overlaps: int,
) -> None:
    for item in files:
        date_min = min(item.dates) if item.dates else "sin fecha"
        date_max = max(item.dates) if item.dates else "sin fecha"
        print(
            f"{item.file}: {item.valid_final} registros validos finales "
            f"({item.valid_raw} observaciones fuente), {item.discarded_total} descartados "
            f"[fecha={item.discarded_date}, departamento={item.discarded_department}, "
            f"lluvia={item.discarded_rainfall}], {item.historical_duplicates} duplicados resueltos, "
            f"{item.zero_records} registros de 0 mm, {len(item.departments)} departamentos, "
            f"rango {date_min} a {date_max}, {item.sheets} hojas, encabezados en fila(s) "
            f"{','.join(map(str, sorted(item.header_rows)))}."
        )
    print(f"Total historico diario: {len(historical)} registros.")
    print(
        f"Total operativo diario: {len(operational)} registros "
        f"({operational_diagnostics['duplicates']} duplicados internos resueltos, "
        f"{operational_diagnostics['zero_records']} registros de 0 mm)."
    )
    print(f"Solapamientos historico-operativo resueltos a favor de la base operativa: {overlaps}.")
    print(f"Total combinado diario: {len(combined)} registros.")
    if combined:
        print(f"Rango combinado: {combined[0]['date']} a {combined[-1]['date']}.")
        print(f"Departamentos combinados: {len({record['department'] for record in combined})}.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Raiz del dashboard (por defecto, el padre de scripts/).",
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="Directorio local con 2015.xls a 2025.xlsx; si se omite, se descargan desde GitHub.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Valida y muestra diagnosticos sin escribir JSON.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = args.project_root.resolve()
    operational_path = project_root / "data" / "rainfall-daily.json"
    if not operational_path.exists():
        raise FileNotFoundError(f"No existe la base operativa: {operational_path}")

    if args.source_dir:
        source_dir = args.source_dir.resolve()
        historical, file_diagnostics = load_historical(source_dir)
    else:
        with tempfile.TemporaryDirectory(prefix="rainfall-history-") as temporary:
            source_dir = Path(temporary)
            download_source_files(source_dir)
            historical, file_diagnostics = load_historical(source_dir)

    operational, operational_diagnostics = load_operational(operational_path)
    combined, overlaps = combine_records(historical, operational)
    print_diagnostics(
        historical,
        operational,
        combined,
        file_diagnostics,
        operational_diagnostics,
        overlaps,
    )

    if args.dry_run:
        print("Modo dry-run: no se escribieron archivos.")
        return 0

    history_path = project_root / "data" / "rainfall-daily-history.json"
    combined_path = project_root / "data" / "rainfall-daily-combined.json"
    write_json(history_path, historical)
    write_json(combined_path, combined)
    print(f"Generado {history_path}.")
    print(f"Generado {combined_path}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
