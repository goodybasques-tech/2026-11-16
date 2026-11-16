#!/usr/bin/env python3
"""Natural Earth countries -> compact line-segment JSON for the 3D map.
Projection: plate carree, x = lon*S, z = -lat*S (scene units). Writes engine3d/vendor/geo/world_lines.json
Each country: {n: name, a3: ISO_A3, inc: income group 1-5, s: [x1,z1,x2,z2,...]} (rounded to 3 dp)."""
import json, sys
S = 0.1
src, out = sys.argv[1], sys.argv[2]
g = json.load(open(src))
res = []
for f in g["features"]:
    p = f["properties"]; geom = f["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    segs = []
    for poly in polys:
        for ring in poly:
            for (a, b) in zip(ring, ring[1:]):
                segs += [round(a[0]*S, 3), round(-a[1]*S, 3), round(b[0]*S, 3), round(-b[1]*S, 3)]
    inc = int(str(p.get("INCOME_GRP", "9"))[0]) if p.get("INCOME_GRP") else 9
    a3 = p.get("ADM0_A3") or p.get("ISO_A3")
    res.append({"n": p.get("NAME"), "a3": a3, "inc": inc, "lon": p.get("LABEL_X"), "s": segs})
json.dump(res, open(out, "w"), separators=(",", ":"))
print(len(res), "countries;", sum(len(r["s"]) for r in res)//4, "segments;",
      "income 3-5:", sum(1 for r in res if r["inc"] in (3,4,5)), "income 4-5:", sum(1 for r in res if r["inc"] in (4,5)))
