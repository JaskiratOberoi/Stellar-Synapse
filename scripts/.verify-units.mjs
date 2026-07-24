// src/main/core/engine/units.ts
function norm(unit) {
  return (unit ?? "").replace(/\s+/g, "").toLowerCase();
}
var FT3_PATTERN = /\bFT3\b|free\s*t3/i;
var FT3_PMOL_L_TO_PG_ML = 0.651;
function convertForLis(result, rule2) {
  if (result.analyteCode === "eAG" && result.unit === "mmol/L") {
    const n = parseFloat(result.value);
    if (!isNaN(n)) {
      return { value: (n * 18.0182).toFixed(1), unit: "mg/dL" };
    }
  }
  const srcUnit = norm(result.unit);
  const tgtUnit = norm(rule2.unit);
  if (srcUnit === "g/l" && tgtUnit === "g/dl") {
    const n = parseFloat(result.value);
    if (!Number.isNaN(n)) return { value: (n / 10).toFixed(1), unit: "g/dL" };
  }
  if (srcUnit === "pmol/l" && tgtUnit === "pg/ml" && isFreeT3(result, rule2)) {
    const n = parseFloat(result.value);
    if (!Number.isNaN(n)) {
      return { value: (n * FT3_PMOL_L_TO_PG_ML).toFixed(2), unit: "pg/mL" };
    }
  }
  if (srcUnit === "ng/dl" && tgtUnit === "ng/l") {
    const n = parseFloat(result.value);
    if (!Number.isNaN(n)) return { value: (n * 10).toFixed(2), unit: "ng/L" };
  }
  return { value: result.value, unit: result.unit ?? rule2.unit };
}
function isFreeT3(result, rule2) {
  return [result.analyteCode, result.analyteName, rule2.instrumentName, rule2.lisTestName].some(
    (s) => !!s && FT3_PATTERN.test(s)
  );
}

// scripts/verify-units.ts
function res(over) {
  return {
    sampleId: "S1",
    analyteCode: "X",
    analyteName: "X",
    value: "1",
    unit: void 0,
    ...over
  };
}
function rule(over) {
  return {
    id: "r1",
    driverId: "magicl-6000i",
    instrumentCode: "0",
    status: "manual",
    confidence: 1,
    updatedAt: "",
    ...over
  };
}
var CASES = [
  // --- FT3: pmol/L -> pg/mL, molar-mass dependent, MAGICL keys it as "21" ----
  {
    name: "FT3 pmol/L -> pg/mL (by mapping name)",
    result: res({ analyteCode: "21", analyteName: "FT3", value: "5.00", unit: "pmol/L" }),
    rule: rule({ instrumentName: "FT3", lisTestName: "Free T4 (FT4)", unit: "pg/mL" }),
    // 5.00 * 0.651 = 3.255; JS toFixed(2) yields 3.25 (3.255 is not exactly
    // representable in binary). A 0.005 pg/mL difference sits far below the
    // assay's resolution, so the rounding direction is not worth engineering
    // around — but pin it so a future change to the factor is caught.
    expectValue: "3.25",
    expectUnit: "pg/mL"
  },
  {
    name: "FT3 identified via lisTestName when code is a bare id",
    result: res({ analyteCode: "21", analyteName: "21", value: "4.00", unit: "pmol/L" }),
    rule: rule({ instrumentName: "21", lisTestName: "Free T3 (FT3)", unit: "pg/mL" }),
    expectValue: "2.60",
    expectUnit: "pg/mL"
  },
  {
    name: "NO double-convert: analyzer already sends pg/mL",
    result: res({ analyteCode: "21", analyteName: "FT3", value: "3.26", unit: "pg/mL" }),
    rule: rule({ instrumentName: "FT3", unit: "pg/mL" }),
    expectValue: "3.26",
    expectUnit: "pg/mL"
  },
  {
    name: "NO convert: pmol/L analyte that is not FT3 (wrong molar mass)",
    result: res({ analyteCode: "94", analyteName: "SHBG", value: "20.0", unit: "pmol/L" }),
    rule: rule({ instrumentName: "SHBG", lisTestName: "Sex Hormone Binding Globulin", unit: "pg/mL" }),
    expectValue: "20.0",
    expectUnit: "pmol/L"
  },
  {
    name: "NO convert: FT4 must not match the FT3 rule",
    result: res({ analyteCode: "22", analyteName: "FT4", value: "15.0", unit: "pmol/L" }),
    rule: rule({ instrumentName: "FT4", lisTestName: "Free T4 (FT4)", unit: "pg/mL" }),
    expectValue: "15.0",
    expectUnit: "pmol/L"
  },
  // --- FT4: ng/dL -> ng/L, purely dimensional -------------------------------
  {
    name: "FT4 ng/dL -> ng/L",
    result: res({ analyteCode: "22", analyteName: "FT4", value: "1.03", unit: "ng/dL" }),
    rule: rule({ instrumentName: "FT4", lisTestName: "Free T4 (FT4)", unit: "ng/L" }),
    expectValue: "10.30",
    expectUnit: "ng/L"
  },
  {
    name: "NO double-convert: analyzer already sends ng/L",
    result: res({ analyteCode: "22", analyteName: "FT4", value: "10.30", unit: "ng/L" }),
    rule: rule({ instrumentName: "FT4", unit: "ng/L" }),
    expectValue: "10.30",
    expectUnit: "ng/L"
  },
  {
    name: "NO convert: ng/dL target is also ng/dL (Testosterone)",
    result: res({ analyteCode: "34", analyteName: "Testosterone", value: "283.0", unit: "ng/dL" }),
    rule: rule({ instrumentName: "Testosterone", unit: "ng/dL" }),
    expectValue: "283.0",
    expectUnit: "ng/dL"
  },
  // --- pre-existing rules must still hold ------------------------------------
  {
    name: "eAG mmol/L -> mg/dL",
    result: res({ analyteCode: "eAG", value: "7.0", unit: "mmol/L" }),
    rule: rule({ unit: "mg/dL" }),
    expectValue: "126.1",
    expectUnit: "mg/dL"
  },
  {
    name: "HGB g/L -> g/dL",
    result: res({ analyteCode: "HGB", analyteName: "Hemoglobin", value: "144", unit: "g/L" }),
    rule: rule({ instrumentName: "HGB", unit: "g/dL" }),
    expectValue: "14.4",
    expectUnit: "g/dL"
  },
  {
    name: "passthrough when units already agree",
    result: res({ analyteCode: "18", analyteName: "TSH", value: "1.297", unit: "uIU/mL" }),
    rule: rule({ instrumentName: "TSH", unit: "uIU/mL" }),
    expectValue: "1.297",
    expectUnit: "uIU/mL"
  }
];
var failed = 0;
for (const c of CASES) {
  const got = convertForLis(c.result, c.rule);
  const ok = got.value === c.expectValue && (c.expectUnit === void 0 || got.unit === c.expectUnit);
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(52)} got=${got.value} ${got.unit ?? "-"}` + (ok ? "" : `  EXPECTED ${c.expectValue} ${c.expectUnit ?? "-"}`)
  );
}
console.log("");
if (failed > 0) {
  console.log(`${failed} FAILURE(S)`);
  process.exit(1);
}
console.log("ALL PASS");
