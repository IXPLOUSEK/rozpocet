#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test/visual.py — porovná dva PNG snímky a vypíše JEDEN řádek JSON.

PROČ samostatný skript a ne kus Nodu: harness nesmí mít ani jednu npm
závislost, zato Pillow na tomhle stroji nainstalované je. Porovnání proto
běží celé uvnitř Pillow (ImageChops, point, histogram, getbbox) — nikde
není smyčka přes jednotlivé pixely v Pythonu. Bez toho by 30 snímků,
z nichž některé mají 1440×20000 px, trvalo minuty místo vteřin.

Volá se z test/suites/visual.mjs přes spawnSync, ale je i samostatně
spustitelný:

    python3 test/visual.py baseline.png novy.png rozdil.png [tolerance]

Výstup na stdout (vždy jeden řádek, vždy validní JSON):

    {"changed":0.0031,"pixels":912,"total":294000,"w":600,"h":490,
     "baseline_size":[600,490],"actual_size":[600,490],"note":"..."}

Návratový kód: 0 = porovnáno (i když se snímky liší), 2 = chyba, a pak
je na stdout {"error":"..."}. Volající tak nikdy nemusí parsovat text.
"""

import json
import sys

DEFAULT_TOL = 12          # o kolik smí kanál uhnout, aby to nebyl rozdíl (0–255)
MAGENTA = (255, 0, 200)   # barva, kterou se do rozdílového PNG kreslí změny

HELP = """visual.py — porovnání dvou PNG snímků (baseline vs. nový).

Použití:
  python3 test/visual.py <baseline.png> <novy.png> <rozdil.png> [tolerance]

Argumenty:
  baseline.png   referenční snímek (test/baseline/<jmeno>.png)
  novy.png       čerstvě pořízený snímek (test/.out/<jmeno>.png)
  rozdil.png     kam se uloží vizuální rozdíl (změny magentou přes
                 ztlumenou baseline); adresář už musí existovat
  tolerance      volitelně 0–254, kolik smí kanál uhnout, než se pixel
                 počítá jako změněný; výchozí {tol}

Výstup:
  jeden řádek JSON na stdout, návratový kód 0.
  Při chybě {{"error":"..."}} a návratový kód 2.

  changed        podíl změněných pixelů, 0.0 až 1.0
  pixels/total   změněné pixely / všechny pixely
  w,h            rozměr porovnávané plochy
  baseline_size  rozměr baseline [w,h]
  actual_size    rozměr nového snímku [w,h]
  note           poznámka česky (rozdílné rozměry, obálka změn, tolerance)

Rozdílné rozměry NEJSOU chyba: hlásí se jako 100% rozdíl (changed = 1.0),
protože takové snímky se nedají poctivě porovnat pixel po pixelu.
""".format(tol=DEFAULT_TOL)

try:
    from PIL import Image, ImageChops, ImageFilter
    _PIL_ERR = None
except Exception as _exc:          # noqa: BLE001 — chceme opravdu jakoukoli chybu
    Image = ImageChops = ImageFilter = None
    _PIL_ERR = str(_exc)


def die(msg):
    """Chyba ven jako JSON, ať volající nemusí luštit traceback."""
    text = " ".join(str(msg).split())[:800]
    sys.stdout.write(json.dumps({"error": text}, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.exit(2)


def emit(payload):
    """Jeden řádek, žádné odsazení — suita čte poslední řádek stdout."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def diff_mask(a_rgb, b_rgb, tol):
    """Maska změn ('L', 255 = změněno) pro dva stejně velké RGB obrázky.

    Rozhoduje NEJHORŠÍ kanál, ne průměrný jas: čistá změna modré má
    v převodu na šeď váhu jen 0,11, takže by ji prahování po convert('L')
    schovalo. Proto se kanály nejdřív složí přes ImageChops.lighter
    (maximum) a teprve výsledek se prahuje jedním lookup tablem.
    """
    delta = ImageChops.difference(a_rgb, b_rgb)
    bands = delta.split()
    if len(bands) <= 1:
        worst = delta.convert("L")
    else:
        worst = bands[0]
        for band in bands[1:]:
            worst = ImageChops.lighter(worst, band)
        worst = worst.convert("L")
    # 256 položek: 0..tol => beze změny, tol+1..255 => změna
    lut = [0] * (tol + 1) + [255] * (255 - tol)
    return worst.point(lut)


def write_diff(base_rgb, mask, path):
    """Změny magentou přes ztlumenou baseline, ať je vidět KDE se to liší.

    Maska se před vykreslením roztáhne MaxFilterem: rozdíl o jeden pixel
    by na snímku vysokém 20 000 px člověk jinak nikdy nenašel.
    """
    dimmed = Image.eval(base_rgb, lambda v: v // 3 + 24)
    try:
        shown = mask.filter(ImageFilter.MaxFilter(3))
    except Exception:      # noqa: BLE001 — MaxFilter neumí úplně malé obrázky
        shown = mask
    layer = Image.new("RGB", dimmed.size, MAGENTA)
    Image.composite(layer, dimmed, shown).save(path, "PNG", optimize=False)


def main(argv):
    if not argv or any(a in ("-h", "--help", "help") for a in argv):
        sys.stdout.write(HELP)
        return 0

    if len(argv) < 3:
        die("cekam 3 cesty: baseline.png novy.png rozdil.png [tolerance]")

    baseline_path, actual_path, diff_path = argv[0], argv[1], argv[2]

    tol = DEFAULT_TOL
    if len(argv) >= 4 and str(argv[3]).strip() != "":
        try:
            tol = int(round(float(argv[3])))
        except (TypeError, ValueError):
            die("tolerance musi byt cislo 0-254, dostal jsem: %r" % (argv[3],))
    tol = max(0, min(254, tol))

    if _PIL_ERR is not None:
        die("chybi Pillow (PIL): %s" % _PIL_ERR)

    try:
        baseline = Image.open(baseline_path)
        baseline.load()
    except Exception as exc:                       # noqa: BLE001
        die("baseline se nedá otevřít (%s): %s" % (baseline_path, exc))
    try:
        actual = Image.open(actual_path)
        actual.load()
    except Exception as exc:                       # noqa: BLE001
        die("nový snímek se nedá otevřít (%s): %s" % (actual_path, exc))

    bw, bh = baseline.size
    aw, ah = actual.size
    # Alfa zahazujeme schválně: snímky z prohlížeče jsou neprůhledné a
    # porovnávat čtvrtý kanál by jen přidalo šum z antialiasingu.
    base_rgb = baseline.convert("RGB")
    act_rgb = actual.convert("RGB")

    note_bits = ["tolerance %d/255" % tol]

    if (bw, bh) != (aw, ah):
        # Různě velké snímky se nedají porovnat pixel po pixelu. Hlásíme
        # 100% rozdíl — a přesto se pokusíme uložit rozdílové PNG, aby
        # člověk viděl, co se vlastně posunulo.
        union_w, union_h = max(bw, aw), max(bh, ah)
        total = union_w * union_h
        note_bits.insert(0, "rozdílné rozměry: baseline %d×%d, nový %d×%d" % (bw, bh, aw, ah))
        try:
            base_pad = Image.new("RGB", (union_w, union_h), (0, 0, 0))
            base_pad.paste(base_rgb, (0, 0))
            act_pad = Image.new("RGB", (union_w, union_h), (0, 0, 0))
            act_pad.paste(act_rgb, (0, 0))
            mask = diff_mask(base_pad, act_pad, tol)
            write_diff(base_pad, mask, diff_path)
        except Exception as exc:                   # noqa: BLE001
            note_bits.append("rozdílové PNG se nepodařilo uložit: %s" % exc)
        emit({
            "changed": 1.0,
            "pixels": total,
            "total": total,
            "w": union_w,
            "h": union_h,
            "baseline_size": [bw, bh],
            "actual_size": [aw, ah],
            "note": " · ".join(note_bits),
        })
        return 0

    total = bw * bh
    if total == 0:
        note_bits.insert(0, "prázdný snímek 0×0")
        emit({
            "changed": 0.0, "pixels": 0, "total": 0, "w": bw, "h": bh,
            "baseline_size": [bw, bh], "actual_size": [aw, ah],
            "note": " · ".join(note_bits),
        })
        return 0

    try:
        mask = diff_mask(base_rgb, act_rgb, tol)
        # histogram() i getbbox() počítá C — proto tu není žádná smyčka
        changed_px = mask.histogram()[255]
        bbox = mask.getbbox()
    except Exception as exc:                       # noqa: BLE001
        die("porovnání selhalo: %s" % exc)

    if changed_px:
        note_bits.append("obálka změn %s" % (list(bbox) if bbox else "?"))
        try:
            write_diff(base_rgb, mask, diff_path)
        except Exception as exc:                   # noqa: BLE001
            note_bits.append("rozdílové PNG se nepodařilo uložit: %s" % exc)
    else:
        note_bits.append("snímky jsou shodné")

    emit({
        "changed": changed_px / float(total),
        "pixels": int(changed_px),
        "total": int(total),
        "w": bw,
        "h": bh,
        "baseline_size": [bw, bh],
        "actual_size": [aw, ah],
        "note": " · ".join(note_bits),
    })
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except KeyboardInterrupt:
        die("přerušeno")
    except Exception as _top:                      # noqa: BLE001
        # Nikdy nesmí odejít traceback bez JSONu — suita by ho nepřečetla.
        die("neočekávaná chyba: %s" % _top)
