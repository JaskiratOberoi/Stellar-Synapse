import type { LisParameter, LisTest, TestOrder } from '../../../shared/types'

/**
 * Mock LIS catalog approximating the Noble schema (tbl_med_test_master /
 * tbl_med_parameter_master). Codes/names line up with the driver analytes so
 * the auto-mapper has realistic targets to resolve. Swap this out for live SQL
 * reads via SqlLisRepository in a later phase.
 */

export const MOCK_TESTS: LisTest[] = [
  { id: 1001, testCode: 'TSH', testName: 'TSH (Thyroid Stimulating Hormone)', department: 'Immunoassay', hasParameters: false },
  { id: 1002, testCode: 'FT3', testName: 'Free T3 (Free Triiodothyronine)', department: 'Immunoassay', hasParameters: false },
  { id: 1003, testCode: 'FT4', testName: 'Free T4 (Free Thyroxine)', department: 'Immunoassay', hasParameters: false },
  { id: 1004, testCode: 'T3', testName: 'Total T3', department: 'Immunoassay', hasParameters: false },
  { id: 1005, testCode: 'T4', testName: 'Total T4', department: 'Immunoassay', hasParameters: false },
  { id: 1006, testCode: 'PRL', testName: 'Prolactin', department: 'Immunoassay', hasParameters: false },
  { id: 1007, testCode: 'CEA', testName: 'CEA (Carcinoembryonic Antigen)', department: 'Tumor Markers', hasParameters: false },
  { id: 1008, testCode: 'AFP', testName: 'AFP (Alpha Fetoprotein)', department: 'Tumor Markers', hasParameters: false },
  { id: 1009, testCode: 'FERR', testName: 'Ferritin', department: 'Immunoassay', hasParameters: false },
  { id: 1010, testCode: 'VITD', testName: 'Vitamin D (25-OH)', department: 'Immunoassay', hasParameters: false },
  { id: 1020, testCode: 'TROPI', testName: 'Troponin I', department: 'Cardiac', hasParameters: false },
  { id: 1021, testCode: 'NTBNP', testName: 'NT-proBNP', department: 'Cardiac', hasParameters: false },
  { id: 1022, testCode: 'CKMB', testName: 'CK-MB', department: 'Cardiac', hasParameters: false },
  { id: 1023, testCode: 'DDIMR', testName: 'D-Dimer', department: 'Coagulation', hasParameters: false },
  { id: 1024, testCode: 'PCT', testName: 'Procalcitonin', department: 'Immunoassay', hasParameters: false },
  { id: 1025, testCode: 'CRP', testName: 'C-Reactive Protein', department: 'Biochemistry', hasParameters: false },
  { id: 1026, testCode: 'HBA1C', testName: 'HbA1c (Glycated Hemoglobin)', department: 'Biochemistry', hasParameters: false },
  { id: 1027, testCode: 'BHCG', testName: 'Beta hCG', department: 'Immunoassay', hasParameters: false },
  { id: 2000, testCode: 'CBC', testName: 'Complete Blood Count (CBC)', department: 'Hematology', hasParameters: true },
  { id: 3000, testCode: 'RFT', testName: 'Renal Function Test', department: 'Biochemistry', hasParameters: true },
  { id: 3001, testCode: 'LYTES', testName: 'Serum Electrolytes', department: 'Biochemistry', hasParameters: true }
]

export const MOCK_PARAMETERS: LisParameter[] = [
  // CBC panel parameters (test 2000)
  { id: 5001, testId: 2000, code: 'WBC', name: 'Total WBC Count', unit: '10^3/uL' },
  { id: 5002, testId: 2000, code: 'RBC', name: 'RBC Count', unit: '10^6/uL' },
  { id: 5003, testId: 2000, code: 'HGB', name: 'Hemoglobin', unit: 'g/dL' },
  { id: 5004, testId: 2000, code: 'HCT', name: 'Hematocrit (PCV)', unit: '%' },
  { id: 5005, testId: 2000, code: 'MCV', name: 'MCV', unit: 'fL' },
  { id: 5006, testId: 2000, code: 'MCH', name: 'MCH', unit: 'pg' },
  { id: 5007, testId: 2000, code: 'MCHC', name: 'MCHC', unit: 'g/dL' },
  { id: 5008, testId: 2000, code: 'PLT', name: 'Platelet Count', unit: '10^3/uL' },
  { id: 5009, testId: 2000, code: 'NEU', name: 'Neutrophils', unit: '%' },
  { id: 5010, testId: 2000, code: 'LYM', name: 'Lymphocytes', unit: '%' },
  { id: 5011, testId: 2000, code: 'MON', name: 'Monocytes', unit: '%' },
  { id: 5012, testId: 2000, code: 'EOS', name: 'Eosinophils', unit: '%' },
  // RFT panel (test 3000)
  { id: 6001, testId: 3000, code: 'UREA', name: 'Blood Urea', unit: 'mg/dL' },
  { id: 6002, testId: 3000, code: 'CREA', name: 'Serum Creatinine', unit: 'mg/dL' },
  // Electrolytes panel (test 3001)
  { id: 6101, testId: 3001, code: 'NA', name: 'Sodium', unit: 'mmol/L' },
  { id: 6102, testId: 3001, code: 'K', name: 'Potassium', unit: 'mmol/L' },
  { id: 6103, testId: 3001, code: 'CL', name: 'Chloride', unit: 'mmol/L' },
  { id: 6201, testId: 3000, code: 'GLU', name: 'Glucose (Fasting)', unit: 'mg/dL' }
]

/** A few mock pending orders keyed by barcode (mirrors tbl_med_mcc_patient_samples). */
export const MOCK_ORDERS: TestOrder[] = [
  { vailid: 'S100001', patientId: 4501, testCodes: ['TSH', 'FT4'], testNames: ['TSH', 'Free T4'], sampleStatus: 1 },
  { vailid: 'S100002', patientId: 4502, testCodes: ['CBC'], testNames: ['Complete Blood Count'], sampleStatus: 1 },
  { vailid: 'S100003', patientId: 4503, testCodes: ['TROPI', 'CKMB'], testNames: ['Troponin I', 'CK-MB'], sampleStatus: 1 }
]
