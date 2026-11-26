# Gera data/pedagios.json (praças de pedágio do Brasil, OpenStreetMap barrier=toll_booth) para a aba Custos.
# Uso:  python data/pedagios_gerar.py
# Baixa em blocos de 5°×10° (a consulta nacional estoura o tempo das instâncias públicas do Overpass),
# junta, tira duplicatas e mantém só o que fica no Brasil (malha do IBGE, com folga de ~5 km para pontes).
import json, os, sys, time, urllib.parse, urllib.request, tempfile
INST = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']
pasta = tempfile.mkdtemp(prefix='pedagios_')
for la in range(-34, 6, 5):
    for lo in range(-74, -34, 10):
        q = f'[out:json][timeout:60];nwr["barrier"="toll_booth"]({la},{lo},{la + 5},{lo + 10});out center tags;'
        for u in INST:
            try:
                body = urllib.request.urlopen(urllib.request.Request(u, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'pedagios-gerar'}), timeout=120).read()
                json.loads(body); open(os.path.join(pasta, f't_{la}_{lo}.json'), 'wb').write(body); print(la, lo, 'ok'); break
            except Exception as e: print(la, lo, u, 'falhou:', e); time.sleep(5)
        else: sys.exit('bloco sem resposta em nenhuma instância; rode de novo mais tarde')
sys.argv = [sys.argv[0], pasta, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pedagios.json')]
import glob, datetime
pasta, saida = sys.argv[1], sys.argv[2]
br = json.load(urllib.request.urlopen('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=intermediaria'))
polys = []
for f in br['features']:
    g = f['geometry']
    for poly in ([g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']):
        ring = poly[0]
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        polys.append((min(xs), min(ys), max(xs), max(ys), ring))
def dentro(x, y):
    for x0, y0, x1, y1, r in polys:
        if not (x0 <= x <= x1 and y0 <= y <= y1): continue
        c = False; j = len(r) - 1
        for i in range(len(r)):
            xi, yi = r[i]; xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
            j = i
        if c: return True
    # até ~5 km da borda também vale (praças sobre ponte/baía, como a da Rio–Niterói)
    for x0, y0, x1, y1, r in polys:
        if not (x0 - .05 <= x <= x1 + .05 and y0 - .05 <= y <= y1 + .05): continue
        if any((px - x) ** 2 + (py - y) ** 2 < .0025 for px, py in r): return True
    return False
vistos, out, fora, ways = set(), [], 0, 0
for arq in sorted(glob.glob(os.path.join(pasta, '*.json'))):
    try: d = json.load(open(arq, encoding='utf-8'))
    except Exception: continue
    for e in d.get('elements', []):
        if e['type'] != 'node': ways += 1; continue   # praça mapeada como área: rara, fica de fora
        if e['id'] in vistos: continue
        vistos.add(e['id'])
        if not dentro(e['lon'], e['lat']): fora += 1; continue
        t = e.get('tags', {})
        out.append([e['id'], round(e['lon'], 6), round(e['lat'], 6), t.get('operator', ''), t.get('name', '')])
out.sort()
json.dump({'fonte': '© OpenStreetMap contributors (ODbL) · barrier=toll_booth', 'gerado': datetime.date.today().isoformat(), 'p': out},
          open(saida, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'praças no Brasil ·', fora, 'fora do Brasil ·', ways, 'áreas ignoradas ·', os.path.getsize(saida), 'bytes')
