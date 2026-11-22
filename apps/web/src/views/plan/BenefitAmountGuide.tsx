import { useMemo, useState } from "react";
import { NumberTextInput } from "../../components/NumberTextInput";
import { fmtMoneyDetail } from "../projection/fmt";
import { estimateCppMonthlyAtStart, estimateOasMonthlyAtStart, monthlyToAnnual } from "./benefitAmounts";

type BenefitKind = "cpp" | "oas";

export function BenefitAmountGuide({
  kind,
  startAge,
  onUseAnnualAmount,
}: {
  kind: BenefitKind;
  startAge: string;
  onUseAnnualAmount: (annualAmount: number) => void;
}) {
  const [cppBaseMonthly, setCppBaseMonthly] = useState("");
  const [cppPersonalMonthly, setCppPersonalMonthly] = useState("");
  const [oasBaseMonthly, setOasBaseMonthly] = useState("");
  const [oasResidenceYears, setOasResidenceYears] = useState("");
  const [oasPersonalMonthly, setOasPersonalMonthly] = useState("");
  const age = Number(startAge);
  const validStartAge = /^\d+$/.test(startAge.trim()) && Number.isInteger(age) && age >= 1;

  const cppMonthly = useMemo(() => {
    if (cppBaseMonthly.trim() === "") return null;
    return estimateCppMonthlyAtStart(Number(cppBaseMonthly), age);
  }, [age, cppBaseMonthly]);
  const cppAnnual = cppMonthly === null ? null : monthlyToAnnual(cppMonthly);
  const cppPersonalAnnual = cppPersonalMonthly.trim() === "" ? null : monthlyToAnnual(Number(cppPersonalMonthly));
  const cppBaseAgeSupported = validStartAge && age >= 60 && age <= 70;
  const cppBenefitAgeValid = validStartAge && age >= 60;

  const oasMonthly = useMemo(() => {
    if (oasBaseMonthly.trim() === "" || oasResidenceYears.trim() === "") return null;
    return estimateOasMonthlyAtStart(Number(oasBaseMonthly), Number(oasResidenceYears), age);
  }, [age, oasBaseMonthly, oasResidenceYears]);
  const oasAnnual = oasMonthly === null ? null : monthlyToAnnual(oasMonthly);
  const oasPersonalAnnual = oasPersonalMonthly.trim() === "" ? null : monthlyToAnnual(Number(oasPersonalMonthly));
  const oasBaseAgeSupported = validStartAge && age >= 65 && age <= 70;
  const oasBenefitAgeValid = validStartAge && age >= 65;

  return (
    <details className="benefit-amount-guide">
      <summary>{kind === "cpp" ? "Help estimate your CPP amount" : "Help estimate your OAS amount"}</summary>
      <div className="benefit-amount-guide-content">
        {kind === "cpp" ? (
          <>
            <p>
              For a personal amount, use{" "}
              <a
                href="https://www.canada.ca/en/employment-social-development/services/my-account/cpp.html"
                target="_blank"
                rel="noreferrer"
              >
                My Service Canada Account
              </a>{" "}
              or the{" "}
              <a
                href="https://www.canada.ca/en/services/benefits/publicpensions/cpp/retirement-income-calculator.html"
                target="_blank"
                rel="noreferrer"
              >
                Canadian Retirement Income Calculator
              </a>
              . CPP amounts depend on your contribution record; salary or a general maximum is not a personal estimate.
            </p>
            <p className="benefit-guide-note">
              Check what future work and contributions your personal estimate assumes. If you expect to stop or reduce
              work before CPP starts, use an estimate that reflects that expectation. This guide applies only the
              selected age factor and monthly-to-annual conversion; it does not calculate future CPP contributions.
            </p>
            <h4>Use an already-adjusted amount</h4>
            <p>
              Enter a current gross payment or personal CPP estimate for the Start age above. This path only converts
              monthly to annual; it does not apply another claim-age factor. It accepts CPP ages 60 and older, including
              current payments after age 70.
            </p>
            <label className="benefit-guide-field">
              <span>Current or personal CPP monthly amount for this Start age ($)</span>
              <NumberTextInput
                aria-label="Current or personal CPP monthly amount for this Start age ($)"
                min="0"
                value={cppPersonalMonthly}
                onChange={setCppPersonalMonthly}
              />
            </label>
            {cppPersonalAnnual !== null && (
              <p className="benefit-guide-preview" role="status">
                Conversion only: {fmtMoneyDetail(Number(cppPersonalMonthly))} per month × 12 ={" "}
                {fmtMoneyDetail(cppPersonalAnnual)} per year.
              </p>
            )}
            <div className="benefit-guide-actions">
              <button
                type="button"
                disabled={!cppBenefitAgeValid || cppPersonalAnnual === null}
                onClick={() => {
                  if (cppPersonalAnnual !== null && cppBenefitAgeValid) onUseAnnualAmount(cppPersonalAnnual);
                }}
              >
                Use adjusted CPP amount × 12
              </button>
            </div>
            {!cppBenefitAgeValid && (
              <p className="benefit-guide-note">
                Enter a whole-number CPP Start age of at least 60 to use an adjusted CPP amount.
              </p>
            )}

            <h4>Estimate from an age-65 amount</h4>
            <p>
              Use this only when the plan Start age above is also the age you intend to begin CPP. Enter a personal
              age-65 monthly estimate; this preview applies the CPP factor for that age: −0.6% per month before 65 (up
              to −36% at 60), or +0.7% per month after 65 (up to +42% at 70). The resulting annual amount is used at the
              plan Start age; the plan does not apply another claim-age adjustment.
            </p>
            <label className="benefit-guide-field">
              <span>Personal CPP monthly estimate at age 65 ($)</span>
              <NumberTextInput
                aria-label="Personal CPP monthly estimate at age 65 ($)"
                min="0"
                value={cppBaseMonthly}
                onChange={setCppBaseMonthly}
              />
            </label>
            {cppAnnual !== null && cppMonthly !== null && (
              <p className="benefit-guide-preview" role="status">
                Preview: {fmtMoneyDetail(cppMonthly)} per month, or {fmtMoneyDetail(cppAnnual)} per year.
              </p>
            )}
            <div className="benefit-guide-actions">
              <button
                type="button"
                disabled={!cppBaseAgeSupported || cppAnnual === null}
                onClick={() => {
                  if (cppAnnual !== null && cppBaseAgeSupported) onUseAnnualAmount(cppAnnual);
                }}
              >
                Use age-65 CPP estimate × 12
              </button>
            </div>
            {!cppBaseAgeSupported && (
              <p className="benefit-guide-note">
                The age-65 estimate method needs a whole-number Start age from 60 to 70. For another valid plan age, use
                the already-adjusted amount method above.
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              For a personal amount, use the{" "}
              <a href="https://estimateursv-oasestimator.service.canada.ca/en" target="_blank" rel="noreferrer">
                official OAS Benefits Estimator
              </a>{" "}
              or a current Service Canada statement.
            </p>
            <h4>Use an already-adjusted amount</h4>
            <p>
              Enter a current gross OAS payment or personal estimate for the Start age above, including any residence or
              age adjustment already reflected in it. This path only converts monthly to annual; it does not apply
              another adjustment. It accepts OAS ages 65 and older, including current payments after age 70.
            </p>
            <label className="benefit-guide-field">
              <span>Current or personal OAS monthly amount for this Start age ($)</span>
              <NumberTextInput
                aria-label="Current or personal OAS monthly amount for this Start age ($)"
                min="0"
                value={oasPersonalMonthly}
                onChange={setOasPersonalMonthly}
              />
            </label>
            {oasPersonalAnnual !== null && (
              <p className="benefit-guide-preview" role="status">
                Conversion only: {fmtMoneyDetail(Number(oasPersonalMonthly))} per month × 12 ={" "}
                {fmtMoneyDetail(oasPersonalAnnual)} per year.
              </p>
            )}
            <div className="benefit-guide-actions">
              <button
                type="button"
                disabled={!oasBenefitAgeValid || oasPersonalAnnual === null}
                onClick={() => {
                  if (oasPersonalAnnual !== null && oasBenefitAgeValid) onUseAnnualAmount(oasPersonalAnnual);
                }}
              >
                Use adjusted OAS amount × 12
              </button>
            </div>
            {!oasBenefitAgeValid && (
              <p className="benefit-guide-note">
                Enter a whole-number OAS Start age of at least 65 to use an adjusted OAS amount.
              </p>
            )}

            <h4>Rough estimate from the age-65 amount</h4>
            <p>
              Use this only when the plan Start age above is also the age you intend to begin OAS. This preview uses the
              current full monthly OAS amount for ages 65–74 from the{" "}
              <a
                href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/benefit-amount.html"
                target="_blank"
                rel="noreferrer"
              >
                official OAS amount page
              </a>
              , then applies eligible residence years after age 18 ÷ 40 and, for a Start age of 65–70, the 0.6% monthly
              deferral increase (up to 36% at 70). The rate changes quarterly, so it is not hardcoded. This estimates an
              amount, not eligibility; the personal-estimate method above is better for individual cases.
            </p>
            <label className="benefit-guide-field">
              <span>Full OAS monthly amount at ages 65–74, before residence adjustment ($)</span>
              <NumberTextInput
                aria-label="Full OAS monthly amount at ages 65 to 74 before residence adjustment ($)"
                min="0"
                value={oasBaseMonthly}
                onChange={setOasBaseMonthly}
              />
            </label>
            <label className="benefit-guide-field">
              <span>Eligible years lived in Canada after age 18 (maximum 40)</span>
              <NumberTextInput
                aria-label="Eligible years lived in Canada after age 18"
                min="0"
                max="40"
                step="1"
                value={oasResidenceYears}
                onChange={setOasResidenceYears}
              />
            </label>
            {oasAnnual !== null && oasMonthly !== null && (
              <p className="benefit-guide-preview" role="status">
                Rough preview: {fmtMoneyDetail(oasMonthly)} per month, or {fmtMoneyDetail(oasAnnual)} per year.
              </p>
            )}
            <div className="benefit-guide-actions">
              <button
                type="button"
                disabled={!oasBaseAgeSupported || oasAnnual === null}
                onClick={() => {
                  if (oasAnnual !== null && oasBaseAgeSupported) onUseAnnualAmount(oasAnnual);
                }}
              >
                Use rough OAS preview × 12
              </button>
            </div>
            {!oasBaseAgeSupported && (
              <p className="benefit-guide-note">
                The age-65 estimate method needs a whole-number Start age from 65 to 70. For another valid plan age, use
                the already-adjusted amount method above.
              </p>
            )}
            <p className="benefit-guide-note">
              The rough preview is not an eligibility decision. Generally, OAS requires at least 10 years of residence
              if you live in Canada when you apply, or 20 years if you live outside Canada; international agreements can
              affect eligibility. Check the{" "}
              <a
                href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/eligibility.html"
                target="_blank"
                rel="noreferrer"
              >
                official OAS eligibility rules
              </a>
              . OAS recovery is modeled separately from this gross amount.
            </p>
            <p className="benefit-guide-note">
              If you delay OAS, you cannot receive GIS during the delay, and GIS does not increase because you delayed
              OAS. This model may still show GIS from age 65 when GIS and OAS are enabled, even if OAS income starts
              later; the cost of deferring OAS is not fully modeled. See{" "}
              <a
                href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/when-start.html"
                target="_blank"
                rel="noreferrer"
              >
                official OAS start guidance
              </a>
              .
            </p>
            <p className="benefit-guide-note">
              The projection starts the entered amount at Start age and applies the configured annual raise / indexing
              from there. If you enter a current payment at 75 or older, it will not add another age adjustment. If you
              model OAS before age 75, the projection does not add the separate 10% increase at 75. See the{" "}
              <a
                href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/benefit-amount.html"
                target="_blank"
                rel="noreferrer"
              >
                official OAS amount details
              </a>
              .
            </p>
          </>
        )}
        <p className="benefit-guide-note">
          The plan treats Annual amount as the amount at Start age, then applies Annual raise / indexing from that age.
          Using a button fills Annual amount only; normal income-field validation still applies.
        </p>
        <p className="benefit-guide-note">
          Amounts are gross, before tax. Official Canada.ca pages checked November 15, 2026; benefit amounts can change.
        </p>
      </div>
    </details>
  );
}
