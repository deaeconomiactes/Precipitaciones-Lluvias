#!/usr/bin/env python3
"""Descarga y normaliza los departamentos de Corrientes desde GeoRef Argentina."""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_ROOT / "data" / "geo" / "corrientes-departamentos.geojson"
SOURCE_URL = "https://apis.datos.gob.ar/georef/api/v2.0/departamentos.geojson"

DEPARTMENTS = [
    "Capital",
    "Bella Vista",
    "Beron de Astrada",
    "Concepcion",
    "Curuzu Cuatia",
    "Empedrado",
    "Esquina",
    "General Alvear",
    "General Paz",
    "Goya",
    "Itati",
    "Ituzaingo",
    "Lavalle",
    "Mburucuya",
    "Mercedes",
    "Monte Caseros",
    "Paso de los Libres",
    "Saladas",
    "San Cosme",
    "San Luis del Palmar",
    "San Martin",
    "San Miguel",
    "San Roque",
    "Santo Tome",
    "Sauce",
]


def normalized_key(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.strip().lower())
    without_accents = "".join(
        character for character in decomposed if unicodedata.category(character) != "Mn"
    )
    return " ".join(without_accents.replace(".", " ").split())


DEPARTMENT_BY_KEY = {normalized_key(name): name for name in DEPARTMENTS}


def main() -> None:
    request = Request(SOURCE_URL, headers={"User-Agent": "Precipitaciones-Lluvias/1.0"})
    with urlopen(request, timeout=120) as response:
        payload = json.load(response)

    features = []
    for feature in payload.get("features", []):
        properties = feature.get("properties", {})
        province = properties.get("provincia", {})
        if str(province.get("id")) != "18":
            continue

        official_name = properties.get("nombre", "")
        department = DEPARTMENT_BY_KEY.get(normalized_key(official_name))
        geometry = feature.get("geometry")
        if not department:
            raise ValueError(f"Departamento GeoRef no reconocido: {official_name!r}")
        if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"Geometria no poligonal para {official_name!r}")

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "department": department,
                    "officialName": official_name,
                    "georefId": properties.get("id"),
                    "province": "Corrientes",
                    "source": properties.get("fuente", "IGN"),
                },
                "geometry": geometry,
            }
        )

    order = {department: index for index, department in enumerate(DEPARTMENTS)}
    features.sort(key=lambda feature: order[feature["properties"]["department"]])
    found = [feature["properties"]["department"] for feature in features]
    if found != DEPARTMENTS:
        missing = sorted(set(DEPARTMENTS) - set(found))
        unexpected = sorted(set(found) - set(DEPARTMENTS))
        raise ValueError(f"GeoJSON incompleto. Faltantes={missing}; inesperados={unexpected}")

    output = {
        "type": "FeatureCollection",
        "name": "Departamentos de la provincia de Corrientes",
        "source": SOURCE_URL,
        "sourceDescription": "API GeoRef Argentina; geometria basada en IGN; WGS84 (EPSG:4326)",
        "features": features,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Creado {OUTPUT_PATH} con {len(features)} departamentos.")


if __name__ == "__main__":
    main()
