#!/usr/bin/env python3
"""Reproducible extractor: JST Macrohistory R.6 XLSX -> USA annual total returns JSON.

Standard library only (zipfile + ElementTree). Produces the exact artifact
committed as `us-returns-1872-2020.json`; re-running it against a byte-identical
download (SHA-256 below) must reproduce that file byte-for-byte apart from the
`extractedAt` timestamp.

Usage: python3 extract-usa-returns.py <JSTdatasetR6.xlsx> [output.json]

Source: https://www.macrohistory.net/app/download/9834512569/JSTdatasetR6.xlsx
Release: R.6 (2022), Jordà-Schularick-Taylor Macrohistory Database
Download SHA-256: c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d
License: CC BY-NC-SA 4.0 (noncommercial, ShareAlike) — see SOURCES.md in this directory.
"""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timezone

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
COUNTRY = "USA"
WANTED = {"year": "year", "country": "country", "eq_tr": "equity", "bond_tr": "bond", "bill_rate": "cash"}


def col_index(cell_ref: str) -> int:
    """'A' -> 0, 'B' -> 1, ... 'BA' -> 52 (sparse rows skip empty cells)."""
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    index = 0
    for ch in letters:
        index = index * 26 + (ord(ch) - 64)
    return index - 1


def cell_value(cell, shared):
    v = cell.find(NS + "v")
    if v is None:
        return None
    if cell.get("t") == "s":
        return shared[int(v.text)]
    return float(v.text)


def main() -> None:
    xlsx_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "us-returns-1872-2020.json"
    with zipfile.ZipFile(xlsx_path) as z:
        shared = [
            "".join(t.text or "" for t in si.iter(NS + "t"))
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si")
        ]
        rows = ET.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(NS + "sheetData/" + NS + "row")

    header = {}
    observations = []
    for row in rows:
        cells = {}
        for cell in row.findall(NS + "c"):
            cells[col_index(cell.get("r"))] = cell_value(cell, shared)
        if not header:
            for index, name in cells.items():
                if name in WANTED:
                    header[name] = index
            missing = set(WANTED) - set(header)
            if missing:
                raise SystemExit(f"expected columns not found: {sorted(missing)}")
            continue
        if cells.get(header["country"]) != COUNTRY:
            continue
        year = cells.get(header["year"])
        equity = cells.get(header["eq_tr"])
        bond = cells.get(header["bond_tr"])
        cash = cells.get(header["bill_rate"])
        if None in (year, equity, bond, cash):
            continue  # lead-in years with absent return columns drop out of the interlocked window
        observations.append({"year": int(year), "equity": equity, "bond": bond, "cash": cash})

    if not observations:
        raise SystemExit("no USA observations extracted")
    artifact = {
        "source": {
            "name": "Jordà-Schularick-Taylor Macrohistory Database",
            "release": "R.6 (2022)",
            "file": "JSTdatasetR6.xlsx",
            "url": "https://www.macrohistory.net/app/download/9834512569/JSTdatasetR6.xlsx",
            "sha256": "c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d",
            "country": COUNTRY,
            "fields": {"equity": "eq_tr", "bond": "bond_tr", "cash": "bill_rate"},
            "units": "nominal total returns, fractions (no conversion applied)",
            "license": "CC BY-NC-SA 4.0",
            "extractedAt": f"{date.today().isoformat()} (extracted {datetime_now()})",
            "coverage": f"{observations[0]['year']}-{observations[-1]['year']}",
        },
        "observations": observations,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)
        f.write("\n")
    years = [o["year"] for o in observations]
    gaps = [y for y in range(years[0], years[-1] + 1) if y not in set(years)]
    if gaps:
        raise SystemExit(f"internal gaps {gaps}: artifact must stay gap-free")
    print(f"wrote {out_path}: {len(observations)} rows {years[0]}-{years[-1]}, no gaps")


def datetime_now() -> str:
    from datetime import datetime

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    main()
