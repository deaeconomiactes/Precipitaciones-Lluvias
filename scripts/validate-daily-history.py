#!/usr/bin/env python3
"""Valida las bases diaria histórica y combinada generadas."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"


def load(name: str) -> list[dict[str, Any]]:
    value = json.loads((DATA_DIR / name).read_text(encoding="utf-8-sig"))
    if not isinstance(value, list):
        raise AssertionError(f"{name} no contiene un array JSON")
    return value


def key(record: dict[str, Any]) -> tuple[str, str]:
    return str(record.get("department")), str(record.get("date"))


def validate_records(name: str, records: list[dict[str, Any]]) -> None:
    keys = [key(record) for record in records]
    if len(keys) != len(set(keys)):
        raise AssertionError(f"{name}: existen claves department+date duplicadas")
    for record in records:
        record_date = record.get("date")
        department = record.get("department")
        rainfall = record.get("rainfallMm")
        if not isinstance(record_date, str) or date.fromisoformat(record_date).isoformat() != record_date:
            raise AssertionError(f"{name}: fecha invalida {record_date!r}")
        if not isinstance(department, str) or not department.strip():
            raise AssertionError(f"{name}: departamento invalido {department!r}")
        if isinstance(rainfall, bool) or not isinstance(rainfall, (int, float)) or not math.isfinite(rainfall) or rainfall < 0:
            raise AssertionError(f"{name}: lluvia invalida {rainfall!r}")


def window_signature(records: list[dict[str, Any]], end: date, days: int) -> dict[str, tuple[float, int]]:
    start = end - timedelta(days=days - 1)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        record_date = date.fromisoformat(record["date"])
        if start <= record_date <= end:
            grouped[record["department"]].append(record)
    return {
        department: (round(sum(record["rainfallMm"] for record in rows), 6), len({record["date"] for record in rows}))
        for department, rows in grouped.items()
    }


def main() -> int:
    historical = load("rainfall-daily-history.json")
    operational = load("rainfall-daily.json")
    combined = load("rainfall-daily-combined.json")
    validate_records("rainfall-daily-history.json", historical)
    validate_records("rainfall-daily.json", operational)
    validate_records("rainfall-daily-combined.json", combined)

    historical_years = {int(record["date"][:4]) for record in historical}
    if historical_years != set(range(2015, 2026)):
        raise AssertionError(f"Años historicos inesperados: {sorted(historical_years)}")
    if any(record.get("source") != "registro_lluvias_excel" for record in historical):
        raise AssertionError("La base historica contiene una fuente inesperada")

    historical_by_key = {key(record): record for record in historical}
    operational_by_key = {key(record): record for record in operational}
    combined_by_key = {key(record): record for record in combined}
    expected_keys = set(historical_by_key) | set(operational_by_key)
    if set(combined_by_key) != expected_keys:
        raise AssertionError("La base combinada no coincide con la union de claves esperada")
    for record_key, operational_record in operational_by_key.items():
        combined_record = combined_by_key[record_key]
        if combined_record["rainfallMm"] != operational_record["rainfallMm"]:
            raise AssertionError(f"No se respeto la prioridad operativa en {record_key}")
        for coordinate in ("lat", "lng"):
            if coordinate in operational_record and combined_record.get(coordinate) != operational_record[coordinate]:
                raise AssertionError(f"No se conservo {coordinate} operativo en {record_key}")

    latest_operational_date = max(date.fromisoformat(record["date"]) for record in operational)
    for days in (1, 7, 15, 30):
        operational_signature = window_signature(operational, latest_operational_date, days)
        combined_signature = window_signature(combined, latest_operational_date, days)
        if operational_signature != combined_signature:
            raise AssertionError(f"La ventana reciente de {days} dias cambio al combinar las bases")

    overlap_count = len(set(historical_by_key) & set(operational_by_key))
    zero_count = sum(record["rainfallMm"] == 0 for record in historical)
    print(f"Historico: {len(historical)} registros, {zero_count} ceros, años 2015-2025.")
    print(f"Operativo: {len(operational)} registros; ultima fecha {latest_operational_date.isoformat()}.")
    print(f"Combinado: {len(combined)} registros; {overlap_count} solapamientos con prioridad operativa.")
    print("Ventanas recientes de 1, 7, 15 y 30 dias: sin cambios respecto de la base operativa.")
    print("Validacion diaria completada sin errores.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
