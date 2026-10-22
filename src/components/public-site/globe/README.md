# Globe geometry

`land-points.json` contains latitude/longitude pairs sampled uniformly over land
from Natural Earth's 1:110m land polygons. It is loaded only when the illustration
enters the viewport. The canvas uses an orthographic projection and elevated
great-circle connections; no map service or WebGL dependency is required.

Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
License: public domain, https://www.naturalearthdata.com/about/terms-of-use/

Generated with 36,000 Fibonacci-sphere samples: latitude = asin(1 - 2(i + .5)/36000),
longitude = (i * 137.50776405) modulo 360 - 180. Jitter coordinates by up to 0.38 degrees using Python random seed 20261022 to avoid visible bands. Keep samples inside land polygons
and outside their holes, rounding latitude/longitude to two decimals.

## Country highlights

`country-points.json` clips the same land dots to Natural Earth's 1:110m country
polygons for the US, Brazil, Colombia, Chile, Argentina, Mexico and Spain. It uses actual
borders (including polygon holes and disconnected territories), not a radius
around a city. Both point datasets are lazy-loaded when the globe becomes visible.

Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson
License: public domain, under the Natural Earth terms above.

To regenerate after downloading that GeoJSON:

```sh
python3 src/components/public-site/globe/generate-country-points.py /path/to/ne_110m_admin_0_countries.geojson
```

The globe eases its longitude and latitude toward each selected market, crossfades
country masks over 1.4 seconds, and keeps a gentle orbit with traveling arc lights
while playing. Selecting a market holds that example after its camera transition.
Reduced-motion mode immediately renders the selected market without animation;
offscreen and background-tab animations stop.

Country flag SVGs in `public/marketing/flags` come from
https://github.com/lipis/flag-icons (4:3 set). The MIT license is included alongside
the assets. Local SVGs keep flags consistent across platforms without relying on
emoji font support.
