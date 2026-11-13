# SOURCES — `us-returns-1872-2020.json` (JST Macrohistory, USA annual total returns)

Every value in `us-returns-1872-2020.json` was extracted programmatically from the
official dataset download — not taken from memory. `extract-usa-returns.py` in this
directory reproduces the artifact byte-for-byte (apart from the `extractedAt`
timestamp) from a byte-identical download.

## Artifact

| Field | Value |
| --- | --- |
| File | `JSTdatasetR6.xlsx`, release **R.6 (2022)**, Jordà-Schularick-Taylor Macrohistory Database |
| URL | https://www.macrohistory.net/app/download/9834512569/JSTdatasetR6.xlsx |
| Download SHA-256 | `c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d` |
| Country filter | `USA` (nominal, local currency = USD; no FX modeling) |
| Fields used | `eq_tr` → `equity`; `bond_tr` → `bond`; `bill_rate` → `cash` |
| Units | Nominal annual total returns as **fractions** — no conversion applied |
| Coverage committed | **1872–2020**, 149 annual rows, zero internal gaps (the 2 lead years where `eq_tr` is absent are excluded so every committed row has all three classes) |
| Extracted | 2026-11-13T02:21:06Z |

## License — CC BY-NC-SA 4.0 (noncommercial, ShareAlike)

This artifact is a partial copy of the JST dataset and is shared under the identical
license: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.
Use is restricted to noncommercial purposes; any redistribution of this file or of a
derivative of it must carry the same license, the citations below, and the
consultation date.

**Scope note**: this license applies to the data artifact (`us-returns-1872-2020.json`)
only. It does not relicense any other code or file in this repository.

## Required citations (verbatim from the data page, fetched 2026-11-12)

Any use of this data must cite:

> Òscar Jordà, Moritz Schularick, and Alan M. Taylor. 2017. "Macrofinancial History
> and the New Business Cycle Facts." in *NBER Macroeconomics Annual 2016*, volume 31,
> edited by Martin Eichenbaum and Jonathan A. Parker. Chicago: University of Chicago
> Press.

Because this artifact contains **rates-of-return data**, it must additionally cite:

> Òscar Jordà, Katharina Knoll, Dmitry Kuvshinov, Moritz Schularick, and Alan M.
> Taylor. 2019. "The Rate of Return on Everything, 1870–2015." *Quarterly Journal of
> Economics*, 134(3), 1225-1298.

The database was consulted on **2026-11-12/13** (release R.6); statistics are subject
to revision.

## Modeling limitations (must surface in the UI)

- **Non-Canadian proxy**: United States market history in **nominal USD** —
  explicitly not Canadian data. No currency conversion, no Canadian market
  sequences.
- **Series end at 2020**: no observations after 2020; windows cannot reach the
  present.
- **Nominal**: returns are nominal USD; the plan's inflation assumptions apply
  separately.
- Government bond total return targets a ~10-year maturity; `bill_rate` is the
  short-term government bill rate (rolling cash proxy).
