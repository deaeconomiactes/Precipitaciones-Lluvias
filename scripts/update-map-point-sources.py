#!/usr/bin/env python3
"""Actualiza el respaldo puntual del mapa desde las APIs públicas documentadas.

El navegador vuelve a consultar las fuentes públicas cuando puede. Este archivo
mantiene una instantánea versionada para que el mapa conserve puntos si una API
externa está lenta o temporalmente fuera de servicio.
"""

from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import math
import os
import re
import subprocess
import unicodedata
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_PATH = DATA_DIR / "map-point-sources.json"
CONFIG_PATH = DATA_DIR / "external-api-config.json"
GEOJSON_PATH = DATA_DIR / "geo" / "corrientes-departamentos.geojson"

CORRIENTES_BBOX = {
    "latitudeMin": -30.8,
    "latitudeMax": -27.0,
    "longitudeMin": -59.9,
    "longitudeMax": -55.5,
}
INA_STATIONS_URL = (
    "https://alerta.ina.gob.ar/pub/datos/"
    "estaciones&distrito=Corrientes&format=json"
)
INA_STATIONS_WFS_URL = (
    "https://alerta.ina.gob.ar/geoserver/public2/ows?"
    "service=WFS&version=2.0.0&request=GetFeature&"
    "typeNames=public2%3Aestaciones_view&outputFormat=application%2Fjson&"
    "CQL_FILTER=distrito%3D%27Corrientes%27"
)
INA_HEIGHTS_WFS_URL = (
    "https://alerta.ina.gob.ar/geoserver/public2/ows?"
    "service=WFS&version=2.0.0&request=GetFeature&"
    "typeNames=public2%3Aultimas_alturas_con_timeseries&"
    "outputFormat=application%2Fjson&srsName=EPSG%3A4326&"
    "bbox=-59.9%2C-30.8%2C-55.5%2C-27.0%2CEPSG%3A4326"
)
NASA_POWER_BASE_URL = "https://power.larc.nasa.gov/api/temporal/daily/regional"
GEOGLOWS_BASE_URL = "https://geoglows.ecmwf.int/api/v2"
USER_AGENT = "Precipitaciones-Lluvias-map-source-updater/1.0"


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso_z(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def fetch_json(url: str, *, timeout: int = 120, method: str = "GET", body: Any = None) -> Any:
    data = None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8-sig"))
    except urllib.error.HTTPError:
        # Los web apps de Google pueden encadenar varias redirecciones hacia
        # script.googleusercontent.com que urllib no conserva correctamente.
        # curl está disponible tanto en macOS como en ubuntu-latest y maneja
        # esa redirección sin publicar credenciales ni alterar el contrato.
        command = [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--retry",
            "3",
            "--retry-all-errors",
            "--retry-delay",
            "2",
            "--max-time",
            str(timeout),
            "--header",
            f"User-Agent: {USER_AGENT}",
            "--header",
            "Accept: application/json",
        ]
        if method != "GET":
            command.extend(["--request", method])
        if data is not None:
            command.extend(["--header", "Content-Type: application/json", "--data-binary", data.decode("utf-8")])
        command.append(url)
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout + 5)
        return json.loads(completed.stdout.lstrip("\ufeff"))


def fetch_primary_map_sources(timeout: int = 210) -> dict[str, Any]:
    """Ejecuta los adaptadores Node compartidos con el servidor local.

    De este modo la instantánea diaria y las rutas en vivo usan exactamente los
    mismos filtros, sentinelas, fechas y contratos para SNIH, Salto Grande y los
    catálogos satelitales.
    """

    completed = subprocess.run(
        ["node", "scripts/fetch-primary-map-sources.mjs"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return json.loads(completed.stdout)


def finite_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    return " ".join(
        "".join(char for char in text if unicodedata.category(char) != "Mn")
        .casefold()
        .replace("_", " ")
        .replace("-", " ")
        .split()
    )


def ring_contains(ring: list[list[float]], longitude: float, latitude: float) -> bool:
    inside = False
    previous = len(ring) - 1
    for index, coordinate in enumerate(ring):
        x_i, y_i = coordinate[:2]
        x_j, y_j = ring[previous][:2]
        crosses = (y_i > latitude) != (y_j > latitude)
        if crosses and longitude < (x_j - x_i) * (latitude - y_i) / (y_j - y_i) + x_i:
            inside = not inside
        previous = index
    return inside


def polygon_contains(polygon: list[list[list[float]]], longitude: float, latitude: float) -> bool:
    return ring_contains(polygon[0], longitude, latitude) and not any(
        ring_contains(hole, longitude, latitude) for hole in polygon[1:]
    )


def geometry_contains(geometry: dict[str, Any], longitude: float, latitude: float) -> bool:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        return polygon_contains(coordinates, longitude, latitude)
    if geometry.get("type") == "MultiPolygon":
        return any(polygon_contains(polygon, longitude, latitude) for polygon in coordinates)
    return False


def inside_corrientes(features: list[dict[str, Any]], longitude: float, latitude: float) -> bool:
    return any(geometry_contains(feature.get("geometry") or {}, longitude, latitude) for feature in features)


def valid_corrientes_coordinate(latitude: float | None, longitude: float | None) -> bool:
    return (
        latitude is not None
        and longitude is not None
        and -32 <= latitude <= -25
        and -61 <= longitude <= -54
    )


def latest_rain_points(payload: Any, department_by_key: dict[str, str]) -> list[dict[str, Any]]:
    records = payload if isinstance(payload, list) else payload.get("records") or payload.get("data") or []
    by_location: dict[str, dict[str, Any]] = {}
    for row in records:
        status = normalize_text(row.get("status") or row.get("estado"))
        action = normalize_text(row.get("action") or row.get("accion"))
        if status in {"deleted", "eliminado"} or action in {"delete", "eliminar"}:
            continue
        date = str(row.get("date") or row.get("fecha") or "")[:10]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        latitude = finite_number(row.get("lat") or row.get("latitude") or row.get("latitud"))
        longitude = finite_number(
            row.get("lng") or row.get("lon") or row.get("longitude") or row.get("longitud")
        )
        rainfall_raw = next(
            (row.get(field) for field in ("rainfallMm", "rain", "lluvia", "precipitacion") if row.get(field) is not None),
            None,
        )
        rainfall = finite_number(rainfall_raw)
        department_raw = str(row.get("department") or row.get("departamento") or "").strip()
        department = department_by_key.get(normalize_text(department_raw), department_raw)
        municipality = str(
            row.get("municipality")
            or row.get("localidad")
            or row.get("municipio")
            or department
        ).strip()
        if (
            not department
            or rainfall is None
            or rainfall < 0
            or rainfall > 1000
            or not valid_corrientes_coordinate(latitude, longitude)
        ):
            continue
        point = {
            "date": date,
            "department": department,
            "municipality": municipality,
            "rainfallMm": rainfall,
            "lat": latitude,
            "lng": longitude,
            "updatedAt": str(row.get("updatedAt") or row.get("updated_at") or ""),
        }
        key = "|".join(
            [department, municipality, f"{latitude:.4f}", f"{longitude:.4f}"]
        )
        current = by_location.get(key)
        if current is None or (point["date"], point["updatedAt"]) > (
            current["date"],
            current["updatedAt"],
        ):
            by_location[key] = point
    return sorted(
        by_location.values(),
        key=lambda row: (normalize_text(row["department"]), normalize_text(row["municipality"])),
    )


def parse_timeseries(value: Any) -> list[list[Any]]:
    if not value:
        return []
    try:
        rows = json.loads(value) if isinstance(value, str) else value
    except json.JSONDecodeError:
        return []
    parsed = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, list) or len(row) < 2:
            continue
        number = finite_number(row[1])
        if number is not None:
            parsed.append([str(row[0]), number])
    return parsed[-14:]


def normalize_height_feature(feature: dict[str, Any]) -> dict[str, Any] | None:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if len(coordinates) < 2:
        return None
    properties = feature.get("properties") or {}
    return {
        "name": properties.get("nombre"),
        "lat": finite_number(coordinates[1]),
        "lng": finite_number(coordinates[0]),
        "date": properties.get("fecha"),
        "valueM": finite_number(properties.get("valor")),
        "previousValueM": finite_number(properties.get("valor_precedente")),
        "trend": properties.get("tendencia"),
        "status": properties.get("estado"),
        "condition": properties.get("condicion"),
        "seriesId": properties.get("series_id"),
        "river": properties.get("rio"),
        "alertLevelM": finite_number(properties.get("nivel_de_alerta")),
        "evacuationLevelM": finite_number(properties.get("nivel_de_evacuacion")),
        "lowWaterLevelM": finite_number(properties.get("nivel_de_aguas_bajas")),
        "timeseries": parse_timeseries(properties.get("timeseries")),
    }


def nearest_height(station: dict[str, Any], heights: list[dict[str, Any]]) -> dict[str, Any] | None:
    station_name = normalize_text(station.get("nombre"))
    by_name = [height for height in heights if normalize_text(height.get("name")) == station_name]
    if by_name:
        return min(
            by_name,
            key=lambda height: (height["lat"] - station["lat"]) ** 2
            + (height["lng"] - station["lon"]) ** 2,
        )
    candidates = [
        height
        for height in heights
        if abs(height["lat"] - station["lat"]) <= 0.004
        and abs(height["lng"] - station["lon"]) <= 0.004
    ]
    return min(
        candidates,
        key=lambda height: (height["lat"] - station["lat"]) ** 2
        + (height["lng"] - station["lon"]) ** 2,
        default=None,
    )


def normalize_ina_stations(payload: Any, height_payload: Any) -> list[dict[str, Any]]:
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("INA no devolvió un inventario de estaciones")
    height_features = [
        normalized
        for feature in (height_payload.get("features") or [])
        if (normalized := normalize_height_feature(feature)) is not None
    ]
    result = []
    for row in rows:
        latitude = finite_number(row.get("lat"))
        longitude = finite_number(row.get("lon"))
        site_code = row.get("sitecode")
        if site_code is None or not valid_corrientes_coordinate(latitude, longitude):
            continue
        station = {
            "siteCode": int(site_code),
            "name": str(row.get("nombre") or f"Estación {site_code}"),
            "type": str(row.get("tipo_nombre") or row.get("tipo") or "Sin tipo"),
            "typeCode": str(row.get("tipo") or ""),
            "network": str(row.get("nombre_red") or "Sin red"),
            "owner": str(row.get("propietario") or ""),
            "river": str(row.get("rio") or ""),
            "lat": latitude,
            "lng": longitude,
            "automatic": bool(row.get("automatica")),
            "alertLevelM": finite_number(row.get("nivel_de_alerta")),
            "evacuationLevelM": finite_number(row.get("nivel_de_evacuacion")),
            "lowWaterLevelM": finite_number(row.get("nivel_de_aguas_bajas")),
        }
        if station["typeCode"] == "H":
            latest_height = nearest_height(row, height_features)
            if latest_height is not None:
                station["latestHeight"] = latest_height
        result.append(station)
    site_codes = [station["siteCode"] for station in result]
    if len(site_codes) != len(set(site_codes)):
        raise ValueError("INA devolvió siteCode duplicados")
    return sorted(result, key=lambda row: (row["typeCode"], normalize_text(row["name"]), row["siteCode"]))


def select_ina_height_observations(
    stations: list[dict[str, Any]],
    height_payload: Any,
    province_features: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Conserva solo alturas numéricas pertinentes para Corrientes.

    La unión combina lecturas cuya coordenada cae dentro de la provincia con
    lecturas de estaciones hidrológicas del inventario distrital. Esto mantiene
    estaciones sobre ríos limítrofes sin incorporar puntos vacíos del inventario.
    """

    selected: dict[str, dict[str, Any]] = {}

    def add(height: dict[str, Any] | None) -> None:
        if (
            not height
            or height.get("valueM") is None
            or not height.get("date")
            or not valid_corrientes_coordinate(height.get("lat"), height.get("lng"))
        ):
            return
        series_id = height.get("seriesId")
        key = (
            f"series:{series_id}"
            if series_id is not None
            else "|".join(
                (
                    normalize_text(height.get("name")),
                    f"{height['lat']:.5f}",
                    f"{height['lng']:.5f}",
                )
            )
        )
        selected[key] = height

    for feature in height_payload.get("features") or []:
        height = normalize_height_feature(feature)
        if (
            height
            and height.get("valueM") is not None
            and valid_corrientes_coordinate(height.get("lat"), height.get("lng"))
            and inside_corrientes(province_features, height["lng"], height["lat"])
        ):
            add(height)

    for station in stations:
        if station.get("typeCode") == "H":
            add(station.get("latestHeight"))

    return sorted(
        selected.values(),
        key=lambda height: (normalize_text(height.get("name")), height.get("seriesId") or 0),
    )


def resolve_geoglows_node(station: dict[str, Any]) -> dict[str, Any]:
    query = urllib.parse.urlencode({"lat": station["lat"], "lon": station["lng"]})
    payload = fetch_json(f"{GEOGLOWS_BASE_URL}/getriverid?{query}", timeout=40)
    river_id = payload.get("river_id")
    if river_id is None:
        raise ValueError(f"GEOGLOWS no devolvió river_id para {station['siteCode']}")
    return {
        "siteCode": station["siteCode"],
        "stationName": station["name"],
        "lat": station["lat"],
        "lng": station["lng"],
        "riverId": int(river_id),
    }


def geoglows_nodes(stations: list[dict[str, Any]], existing: Any) -> list[dict[str, Any]]:
    previous_nodes = {
        int(node["siteCode"]): node
        for node in ((existing or {}).get("geoglows") or {}).get("nodes", [])
        if node.get("siteCode") is not None and node.get("riverId") is not None
    }
    result: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for station in stations:
        if station["typeCode"] != "H":
            continue
        previous = previous_nodes.get(station["siteCode"])
        if (
            previous
            and abs(float(previous.get("lat", 999)) - station["lat"]) < 0.0001
            and abs(float(previous.get("lng", 999)) - station["lng"]) < 0.0001
        ):
            result.append(
                {
                    "siteCode": station["siteCode"],
                    "stationName": station["name"],
                    "lat": station["lat"],
                    "lng": station["lng"],
                    "riverId": int(previous["riverId"]),
                }
            )
        else:
            missing.append(station)
    if missing:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            result.extend(executor.map(resolve_geoglows_node, missing))
    return sorted(result, key=lambda node: node["siteCode"])


def nasa_power_points(province_features: list[dict[str, Any]], now: dt.datetime) -> dict[str, Any]:
    start = (now.date() - dt.timedelta(days=22)).strftime("%Y%m%d")
    end = now.date().strftime("%Y%m%d")
    params = {
        "latitude-min": CORRIENTES_BBOX["latitudeMin"],
        "latitude-max": CORRIENTES_BBOX["latitudeMax"],
        "longitude-min": CORRIENTES_BBOX["longitudeMin"],
        "longitude-max": CORRIENTES_BBOX["longitudeMax"],
        "parameters": "PRECTOTCORR",
        "community": "AG",
        "start": start,
        "end": end,
        "format": "JSON",
        "time-standard": "UTC",
    }
    request_url = f"{NASA_POWER_BASE_URL}?{urllib.parse.urlencode(params)}"
    payload = fetch_json(request_url, timeout=150)
    fill_value = finite_number((payload.get("header") or {}).get("fill_value"))
    valid_dates: set[str] = set()
    for feature in payload.get("features") or []:
        values = (((feature.get("properties") or {}).get("parameter") or {}).get("PRECTOTCORR") or {})
        for date, raw_value in values.items():
            value = finite_number(raw_value)
            if value is not None and value != fill_value:
                valid_dates.add(date)
    if not valid_dates:
        raise ValueError("NASA POWER no devolvió fechas con precipitación válida")
    latest_date = max(valid_dates)
    points = []
    for feature in payload.get("features") or []:
        coordinates = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coordinates) < 2:
            continue
        longitude = finite_number(coordinates[0])
        latitude = finite_number(coordinates[1])
        elevation = finite_number(coordinates[2]) if len(coordinates) > 2 else None
        values = (((feature.get("properties") or {}).get("parameter") or {}).get("PRECTOTCORR") or {})
        value = finite_number(values.get(latest_date))
        if (
            longitude is None
            or latitude is None
            or value is None
            or value == fill_value
            or not inside_corrientes(province_features, longitude, latitude)
        ):
            continue
        points.append(
            {
                "id": f"POWER_{latitude:.3f}_{longitude:.3f}",
                "date": f"{latest_date[:4]}-{latest_date[4:6]}-{latest_date[6:8]}",
                "lat": latitude,
                "lng": longitude,
                "elevationM": elevation,
                "precipitationMm": value,
            }
        )
    return {
        "date": f"{latest_date[:4]}-{latest_date[4:6]}-{latest_date[6:8]}",
        "parameter": "PRECTOTCORR",
        "parameterLabel": "Precipitación corregida",
        "unit": "mm/día",
        "timeStandard": (payload.get("header") or {}).get("time_standard") or "UTC",
        "apiVersion": ((payload.get("header") or {}).get("api") or {}).get("version"),
        "dataSources": (payload.get("header") or {}).get("sources") or [],
        "gridResolution": {"latitudeDegrees": 0.5, "longitudeDegrees": 0.625},
        "requestUrl": request_url,
        "points": sorted(points, key=lambda point: (point["lat"], point["lng"])),
    }


def main() -> None:
    config = read_json(CONFIG_PATH)
    province = read_json(GEOJSON_PATH)
    metadata = read_json(DATA_DIR / "metadata.json")
    department_by_key = {
        normalize_text(department): department
        for department in (metadata.get("departments") or [])
    }
    province_features = province.get("features") or []
    existing = read_json(OUTPUT_PATH) if OUTPUT_PATH.exists() else {}
    now = utc_now()

    public_rain_url = (config.get("rainObservations") or {}).get("url")
    rain_fetch_url = os.environ.get("DAILY_RAIN_JSON_URL") or public_rain_url
    if not rain_fetch_url:
        raise ValueError("No está configurado el endpoint JSON de lluvias")

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        rain_future = executor.submit(fetch_json, rain_fetch_url, timeout=150)
        ina_future = executor.submit(fetch_json, INA_STATIONS_URL)
        ina_wfs_future = executor.submit(fetch_json, INA_STATIONS_WFS_URL)
        heights_future = executor.submit(fetch_json, INA_HEIGHTS_WFS_URL)
        nasa_future = executor.submit(nasa_power_points, province_features, now)
        primary_future = executor.submit(fetch_primary_map_sources)
        rain_payload = rain_future.result()
        ina_payload = ina_future.result()
        ina_wfs_payload = ina_wfs_future.result()
        heights_payload = heights_future.result()
        nasa = nasa_future.result()
        primary = primary_future.result()

    rain_points = latest_rain_points(rain_payload, department_by_key)
    stations = normalize_ina_stations(ina_payload, heights_payload)
    height_observations = select_ina_height_observations(stations, heights_payload, province_features)
    nodes = geoglows_nodes(stations, existing)
    hydrological_count = sum(station["typeCode"] == "H" for station in stations)
    meteorological_count = sum(station["typeCode"] == "M" for station in stations)
    height_count = sum(bool(station.get("latestHeight")) for station in stations)
    wfs_count = len(ina_wfs_payload.get("features") or [])
    primary_river = primary.get("riverHeights") or {}
    primary_sources = primary_river.get("sources") or {}
    primary_ina_count = len(((primary_sources.get("ina") or {}).get("observations") or []))
    if primary_ina_count != len(height_observations):
        raise ValueError(
            "La reconciliación INA difiere entre el adaptador en vivo y la instantánea: "
            f"{primary_ina_count} vs {len(height_observations)}"
        )
    snih = primary_sources.get("snih") or {}
    salto = primary_sources.get("salto") or {}

    output = {
        "schemaVersion": 3,
        "generatedAt": iso_z(now),
        "rainObservations": {
            "endpoint": public_rain_url,
            "pointCount": len(rain_points),
            "latestDate": max((point["date"] for point in rain_points), default=None),
            "points": rain_points,
        },
        "ina": {
            "stationEndpoint": INA_STATIONS_URL,
            "stationWfsEndpoint": INA_STATIONS_WFS_URL,
            "heightWfsEndpoint": INA_HEIGHTS_WFS_URL,
            "stationCount": len(stations),
            "hydrologicalCount": hydrological_count,
            "meteorologicalCount": meteorological_count,
            "latestHeightCount": height_count,
            "heightObservationCount": len(height_observations),
            "stationWfsCount": wfs_count,
            "heightObservations": height_observations,
            "stations": stations,
        },
        "snih": {
            "pointCount": len(snih.get("observations") or []),
            "observations": snih.get("observations") or [],
            "metadata": snih.get("metadata") or {},
            "status": (primary_river.get("sourceStatus") or {}).get("snih") or {},
        },
        "salto": {
            "pointCount": len(salto.get("observations") or []),
            "observations": salto.get("observations") or [],
            "metadata": salto.get("metadata") or {},
            "status": (primary_river.get("sourceStatus") or {}).get("salto") or {},
        },
        "satelliteFlood": primary.get("satelliteFlood") or {},
        "nasaPower": {
            "endpoint": NASA_POWER_BASE_URL,
            "pointCount": len(nasa["points"]),
            **nasa,
        },
        "geoglows": {
            "baseUrl": GEOGLOWS_BASE_URL,
            "nodeCount": len(nodes),
            "uniqueRiverIdCount": len({node["riverId"] for node in nodes}),
            "nodes": nodes,
        },
        "quality": {
            "canonicalInaInventory": "pub/datos/estaciones",
            "inaInventoryDifference": len(stations) - wfs_count,
            "primaryHeightCount": primary_river.get("totalCount") or 0,
            "primaryHeightSourceCounts": {
                source_id: len((source.get("observations") or []))
                for source_id, source in primary_sources.items()
            },
            "noCrossSourceAveraging": True,
            "note": (
                "La API de estaciones es canónica: incluye todos los siteCode de Corrientes. "
                "La vista hidrométrica usa la unión de lecturas WFS dentro de la provincia y "
                "lecturas vinculadas al inventario distrital para conservar estaciones limítrofes. "
                "SNIH, INA y Salto Grande se conservan como observaciones independientes; no se "
                "promedian alturas entre escalas o ceros hidrométricos diferentes."
            ),
        },
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Actualizado map-point-sources.json: "
        f"lluvia={len(rain_points)}, INA={len(stations)} "
        f"(alturas visibles={len(height_observations)}, vinculadas={height_count}), NASA={len(nasa['points'])}, "
        f"GEOGLOWS={len(nodes)}, SNIH={len(snih.get('observations') or [])}, "
        f"Salto Grande={len(salto.get('observations') or [])}, "
        f"satélite={(primary.get('satelliteFlood') or {}).get('availableCount', 0)} capas."
    )


if __name__ == "__main__":
    main()
