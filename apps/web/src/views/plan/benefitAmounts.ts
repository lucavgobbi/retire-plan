/** Official claim-age multipliers used for a preview from a personalized age-65 estimate. */
export function cppClaimAgeFactor(startAge: number): number | null {
  if (!Number.isInteger(startAge) || startAge < 60 || startAge > 70) return null;
  if (startAge < 65) return 1 - (65 - startAge) * 12 * 0.006;
  return 1 + (startAge - 65) * 12 * 0.007;
}

export function estimateCppMonthlyAtStart(monthlyAt65: number, startAge: number): number | null {
  const factor = cppClaimAgeFactor(startAge);
  if (!Number.isFinite(monthlyAt65) || monthlyAt65 < 0 || factor === null) return null;
  return roundCent(monthlyAt65 * factor);
}

/** OAS age-65-to-74 full monthly base, residence fraction, and deferral adjustment to age 70. */
export function estimateOasMonthlyAtStart(fullMonthlyBase: number, residenceYears: number, startAge: number): number | null {
  if (!Number.isFinite(fullMonthlyBase) || fullMonthlyBase < 0) return null;
  if (!Number.isInteger(residenceYears) || residenceYears < 0 || residenceYears > 40) return null;
  if (!Number.isInteger(startAge) || startAge < 65 || startAge > 70) return null;
  const residenceFraction = residenceYears / 40;
  const deferralFactor = 1 + (startAge - 65) * 12 * 0.006;
  return roundCent(fullMonthlyBase * residenceFraction * deferralFactor);
}

export function monthlyToAnnual(monthlyAmount: number): number | null {
  if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) return null;
  return roundCent(monthlyAmount * 12);
}

function roundCent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
