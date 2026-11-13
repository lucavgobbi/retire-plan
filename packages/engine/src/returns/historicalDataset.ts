import usReturnsJson from "../../data/historical/us-returns-1872-2020.json";
import type { HistoricalReturnObservation } from "./historical";

interface DatasetArtifact {
  source: {
    name: string;
    release: string;
    file: string;
    url: string;
    sha256: string;
    country: string;
    fields: Record<string, string>;
    units: string;
    license: string;
    extractedAt: string;
    coverage: string;
  };
  observations: { year: number; equity: number; bond: number; cash: number }[];
}

const artifact = usReturnsJson as DatasetArtifact;

/** Provenance metadata for the bundled historical return dataset (CC BY-NC-SA 4.0 — see data/historical/SOURCES.md). */
export const HISTORICAL_DATASET = {
  name: artifact.source.name,
  release: artifact.source.release,
  file: artifact.source.file,
  url: artifact.source.url,
  sha256: artifact.source.sha256,
  country: artifact.source.country,
  units: artifact.source.units,
  license: artifact.source.license,
  extractedAt: artifact.source.extractedAt,
  coverageStart: artifact.observations[0]!.year,
  coverageEnd: artifact.observations[artifact.observations.length - 1]!.year,
} as const;

/** The bundled USA 1872–2020 annual nominal total-return observations (fractions). */
export const HISTORICAL_OBSERVATIONS: HistoricalReturnObservation[] = artifact.observations.map(
  (observation) => ({ year: observation.year, equity: observation.equity, bond: observation.bond, cash: observation.cash }),
);
