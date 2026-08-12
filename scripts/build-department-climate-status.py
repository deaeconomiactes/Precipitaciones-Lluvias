#!/usr/bin/env python3
"""Genera indicadores climáticos departamentales para el mapa estático."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
MONTHS_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8-sig") as source:
        return json.load(source)


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def rounded(value: float | None) -> float | None:
    return round(value, 2) if value is not None and math.isfinite(value) else None


def consolidate_daily(records: list[dict[str, Any]]) -> dict[str, dict[date, float]]:
    grouped: dict[tuple[str, date], list[float]] = defaultdict(list)
    for record in records:
        department = str(record.get("department") or "").strip()
        rainfall = finite_number(record.get("rainfallMm"))
        try:
            record_date = date.fromisoformat(str(record.get("date")))
        except ValueError:
            continue
        if department and rainfall is not None:
            grouped[(department, record_date)].append(rainfall)

    result: dict[str, dict[date, float]] = defaultdict(dict)
    for (department, record_date), values in grouped.items():
        # La base normalizada suele tener una fila por departamento-fecha. Si hubiera
        # duplicados, se replica el criterio operativo del dashboard: promedio válido.
        result[department][record_date] = sum(values) / len(values)
    return result


def build_combined_monthly(
    monthly_rows: list[dict[str, Any]], operational_daily: dict[str, dict[date, float]]
) -> dict[tuple[str, int], list[float | None]]:
    combined: dict[tuple[str, int], list[float | None]] = {}
    for row in monthly_rows:
        department = str(row.get("department") or "").strip()
        year = row.get("year")
        if not department or not isinstance(year, int):
            continue
        months = list(row.get("months") or [])[:12]
        months.extend([None] * (12 - len(months)))
        combined[(department, year)] = [finite_number(value) for value in months]

    derived: dict[tuple[str, int, int], float] = defaultdict(float)
    for department, observations in operational_daily.items():
        for record_date, rainfall in observations.items():
            derived[(department, record_date.year, record_date.month - 1)] += rainfall

    for (department, year, month), rainfall in derived.items():
        months = combined.setdefault((department, year), [None] * 12)
        if months[month] is None:
            months[month] = rainfall
    return combined


def latest_monthly_status(
    department: str, combined: dict[tuple[str, int], list[float | None]]
) -> dict[str, Any]:
    candidates: list[tuple[int, int, float]] = []
    for (row_department, year), months in combined.items():
        if row_department != department:
            continue
        candidates.extend(
            (year, month, value)
            for month, value in enumerate(months)
            if value is not None
        )
    if not candidates:
        return {
            "monthlyReference": None,
            "monthlyObservedMm": None,
            "monthlyHistoricalAvgMm": None,
            "monthlyDifferenceMm": None,
            "monthlyDifferencePct": None,
            "monthlyCategory": "Sin referencia",
        }

    year, month, observed = max(candidates, key=lambda item: (item[0], item[1]))
    historical_values = [
        months[month]
        for (row_department, _), months in combined.items()
        if row_department == department and months[month] is not None
    ]
    historical_average = sum(historical_values) / len(historical_values) if historical_values else None
    difference = observed - historical_average if historical_average is not None else None
    difference_pct = (
        difference / historical_average * 100
        if difference is not None and historical_average > 0
        else None
    )
    return {
        "monthlyReference": f"{MONTHS_ES[month]} {year}",
        "monthlyObservedMm": rounded(observed),
        "monthlyHistoricalAvgMm": rounded(historical_average),
        "monthlyDifferenceMm": rounded(difference),
        "monthlyDifferencePct": rounded(difference_pct),
        "monthlyCategory": classify_monthly(difference_pct),
    }


def classify_monthly(difference_pct: float | None) -> str:
    if difference_pct is None or not math.isfinite(difference_pct):
        return "Sin referencia"
    if difference_pct <= -30:
        return "Muy por debajo"
    if difference_pct <= -10:
        return "Por debajo"
    if difference_pct < 10:
        return "En torno al promedio"
    if difference_pct < 30:
        return "Por encima"
    return "Muy por encima"


def window_status(
    observations: dict[date, float], reference_date: date, days: int
) -> tuple[float | None, str]:
    # Ventana inclusiva y acumulativa: [referencia - (dias - 1), referencia].
    # Solo suma observaciones existentes; los dias faltantes no se imputan como 0 mm.
    start = reference_date - timedelta(days=days - 1)
    values = [
        rainfall
        for record_date, rainfall in observations.items()
        if start <= record_date <= reference_date
    ]
    return (rounded(sum(values)) if values else None, f"{len(values)}/{days}")


def generate() -> list[dict[str, Any]]:
    metadata = load_json(DATA_DIR / "metadata.json")
    departments = list(metadata.get("departments") or [])
    combined_daily_path = DATA_DIR / "rainfall-daily-combined.json"
    fallback_path = DATA_DIR / "rainfall-daily.json"
    if combined_daily_path.exists():
        daily_path = combined_daily_path
        source_daily = "rainfall-daily-combined"
    else:
        daily_path = fallback_path
        source_daily = "rainfall-daily"

    daily = consolidate_daily(load_json(daily_path))
    operational_daily = consolidate_daily(load_json(fallback_path))
    all_dates = [record_date for observations in daily.values() for record_date in observations]
    reference_date = max(all_dates) if all_dates else None
    monthly = build_combined_monthly(load_json(DATA_DIR / "rainfall.json"), operational_daily)
    updated_at = datetime.now().replace(microsecond=0).isoformat()

    output = []
    for department in departments:
        observations = daily.get(department, {})
        row: dict[str, Any] = {
            "department": department,
            "referenceDateDaily": reference_date.isoformat() if reference_date else None,
            "rainLastDateMm": rounded(observations.get(reference_date)) if reference_date else None,
        }
        for days in (7, 15, 30):
            total, coverage = window_status(observations, reference_date, days) if reference_date else (None, f"0/{days}")
            row[f"rain{days}dMm"] = total
            row[f"coverage{days}d"] = coverage
        row.update(latest_monthly_status(department, monthly))
        row.update(
            {
                "sourceDaily": source_daily,
                "sourceMonthly": "base mensual combinada",
                "updatedAt": updated_at,
            }
        )
        output.append(row)
    return output


def validate(rows: list[dict[str, Any]]) -> None:
    expected = set(load_json(DATA_DIR / "metadata.json").get("departments") or [])
    found = {row["department"] for row in rows}
    if len(rows) != 25 or found != expected:
        raise ValueError(
            f"Se esperaban 25 departamentos. Faltantes={sorted(expected-found)}; "
            f"inesperados={sorted(found-expected)}"
        )
    for row in rows:
        for days in (7, 15, 30):
            covered, expected_days = map(int, row[f"coverage{days}d"].split("/"))
            if expected_days != days or not 0 <= covered <= days:
                raise ValueError(f"Cobertura invalida en {row['department']}: {days} dias")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida sin sobrescribir la salida")
    args = parser.parse_args()
    rows = generate()
    validate(rows)
    output_path = DATA_DIR / "department-climate-status.json"
    comparable = lambda values: [
        {key: value for key, value in row.items() if key != "updatedAt"} for row in values
    ]
    if args.check:
        if load_json(output_path) != rows:
            # updatedAt cambia en cada ejecución; se compara el contenido analítico.
            existing = load_json(output_path)
            if comparable(existing) != comparable(rows):
                raise ValueError("department-climate-status.json no coincide con las fuentes actuales")
        print("Indicadores departamentales validados correctamente.")
        return
    if output_path.exists():
        existing = load_json(output_path)
        if comparable(existing) == comparable(rows):
            print("department-climate-status.json ya coincide con las fuentes actuales.")
            return
    output_path.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Creado {output_path} con {len(rows)} departamentos.")


if __name__ == "__main__":
    main()
