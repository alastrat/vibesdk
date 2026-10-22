"""Clip the shared land dots to Natural Earth country boundaries.

Usage: python3 generate-country-points.py /path/to/ne_110m_admin_0_countries.geojson
See README.md for the source and license. No network calls or extra dependencies.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
CODES = {'USA': 'us', 'BRA': 'br', 'COL': 'co', 'CHL': 'cl', 'ARG': 'ar', 'MEX': 'mx', 'ESP': 'es'}


def inside(longitude, latitude, ring):
    result = False
    ax, ay = ring[-1]
    for bx, by in ring:
        if (ay > latitude) != (by > latitude) and longitude < (bx - ax) * (latitude - ay) / (by - ay) + ax:
            result = not result
        ax, ay = bx, by
    return result


def generate(source):
    land = json.loads((ROOT / 'land-points.json').read_text())
    countries = {}
    for feature in source['features']:
        code = CODES.get(feature['properties']['ADM0_A3'])
        if code is None:
            continue
        geometry = feature['geometry']
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        countries[code] = [
            [lat, lon] for lat, lon in land
            if any(inside(lon, lat, rings[0]) and not any(inside(lon, lat, hole) for hole in rings[1:]) for rings in polygons)
        ]
    assert set(countries) == set(CODES.values())
    (ROOT / 'country-points.json').write_text(json.dumps(countries, separators=(',', ':')) + '\n')
    print({code: len(points) for code, points in countries.items()})


if __name__ == '__main__':
    generate(json.loads(Path(sys.argv[1]).read_text()))
