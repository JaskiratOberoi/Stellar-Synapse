import type { DriverAnalyte } from './IInstrumentDriver'

/**
 * Reusable analyte panels shared across instrument models. Codes are the
 * instrument-side analyte codes; the mapping engine resolves them to LIS
 * test/parameter targets. Sim ranges drive the simulator's synthetic values.
 */

const a = (
  code: string,
  name: string,
  unit: string,
  min: number,
  max: number,
  decimals = 2,
  ref?: string
): DriverAnalyte => ({ code, name, unit, sim: { min, max, decimals, ref: ref ?? `${min} to ${max}` } })

export const THYROID: DriverAnalyte[] = [
  a('TSH', 'Thyroid Stimulating Hormone', 'uIU/mL', 0.27, 4.2),
  a('FT3', 'Free Triiodothyronine', 'pg/mL', 2.0, 4.4),
  a('FT4', 'Free Thyroxine', 'ng/dL', 0.93, 1.7),
  a('T3', 'Total Triiodothyronine', 'ng/mL', 0.8, 2.0),
  a('T4', 'Total Thyroxine', 'ug/dL', 5.1, 14.1, 1),
  a('TG', 'Thyroglobulin', 'ng/mL', 1.4, 78, 1),
  a('ATG', 'Anti-Thyroglobulin Ab', 'IU/mL', 0, 115, 1),
  a('ATPO', 'Anti-TPO Antibody', 'IU/mL', 0, 34, 1)
]

export const FERTILITY: DriverAnalyte[] = [
  a('LH', 'Luteinizing Hormone', 'mIU/mL', 1.7, 8.6),
  a('FSH', 'Follicle Stimulating Hormone', 'mIU/mL', 1.5, 12.4),
  a('PRL', 'Prolactin', 'ng/mL', 4.0, 15.2, 1),
  a('E2', 'Estradiol', 'pg/mL', 11, 44, 0),
  a('PROG', 'Progesterone', 'ng/mL', 0.1, 0.84),
  a('TESTO', 'Testosterone', 'ng/mL', 2.8, 8.0),
  a('BHCG', 'Beta hCG', 'mIU/mL', 0, 5),
  a('AMH', 'Anti-Mullerian Hormone', 'ng/mL', 1.0, 10),
  a('SHBG', 'Sex Hormone Binding Globulin', 'nmol/L', 18, 54, 0)
]

export const TUMOR: DriverAnalyte[] = [
  a('CEA', 'Carcinoembryonic Antigen', 'ng/mL', 0, 5),
  a('AFP', 'Alpha Fetoprotein', 'IU/mL', 0, 7),
  a('CA125', 'Cancer Antigen 125', 'U/mL', 0, 35, 0),
  a('CA153', 'Cancer Antigen 15-3', 'U/mL', 0, 25, 0),
  a('CA199', 'Cancer Antigen 19-9', 'U/mL', 0, 27, 0),
  a('CA724', 'Cancer Antigen 72-4', 'U/mL', 0, 6.9),
  a('PSA', 'Total PSA', 'ng/mL', 0, 4),
  a('FPSA', 'Free PSA', 'ng/mL', 0, 0.93),
  a('CYFRA', 'CYFRA 21-1', 'ng/mL', 0, 3.3),
  a('NSE', 'Neuron Specific Enolase', 'ng/mL', 0, 16.3, 1),
  a('SCC', 'Squamous Cell Carcinoma Ag', 'ng/mL', 0, 1.5),
  a('HE4', 'Human Epididymis Protein 4', 'pmol/L', 0, 140, 0)
]

export const CARDIAC: DriverAnalyte[] = [
  a('CTNI', 'Cardiac Troponin I', 'ng/mL', 0, 0.04, 3),
  a('CTNT', 'Cardiac Troponin T', 'ng/mL', 0, 0.014, 3),
  a('CKMB', 'Creatine Kinase-MB', 'ng/mL', 0, 5),
  a('MYO', 'Myoglobin', 'ng/mL', 0, 110, 0),
  a('NTBNP', 'NT-proBNP', 'pg/mL', 0, 125, 0),
  a('BNP', 'B-type Natriuretic Peptide', 'pg/mL', 0, 100, 0),
  a('DDIMER', 'D-Dimer', 'mg/L FEU', 0, 0.5)
]

export const INFECTIOUS: DriverAnalyte[] = [
  a('HBSAG', 'Hepatitis B Surface Antigen', 'COI', 0, 1),
  a('ANTIHBS', 'Anti-HBs', 'mIU/mL', 0, 10, 1),
  a('HBEAG', 'Hepatitis B e Antigen', 'COI', 0, 1),
  a('HCV', 'Anti-HCV', 'COI', 0, 1),
  a('HIV', 'HIV Ag/Ab Combo', 'COI', 0, 1),
  a('TP', 'Treponema Pallidum (Syphilis)', 'COI', 0, 1),
  a('TOXO', 'Toxoplasma IgG', 'IU/mL', 0, 4),
  a('RUBELLA', 'Rubella IgG', 'IU/mL', 0, 10, 1),
  a('CMV', 'Cytomegalovirus IgG', 'AU/mL', 0, 6, 1)
]

export const BONE: DriverAnalyte[] = [
  a('VITD', '25-OH Vitamin D', 'ng/mL', 30, 100, 1),
  a('PTH', 'Parathyroid Hormone', 'pg/mL', 15, 65, 1),
  a('OSTEOC', 'Osteocalcin', 'ng/mL', 11, 43, 1),
  a('BCTX', 'Beta-CrossLaps (b-CTx)', 'ng/mL', 0.1, 0.7)
]

export const ANEMIA: DriverAnalyte[] = [
  a('FERR', 'Ferritin', 'ng/mL', 30, 400, 1),
  a('VITB12', 'Vitamin B12', 'pg/mL', 187, 883, 0),
  a('FOLATE', 'Folate', 'ng/mL', 3.1, 20.5, 1),
  a('EPO', 'Erythropoietin', 'mIU/mL', 4.3, 29, 1)
]

export const DIABETES: DriverAnalyte[] = [
  a('INS', 'Insulin', 'uIU/mL', 2.6, 24.9, 1),
  a('CPEP', 'C-Peptide', 'ng/mL', 1.1, 4.4),
  a('HBA1C', 'Hemoglobin A1c', '%', 4.0, 5.6, 1)
]

/**
 * Agappe Mispa Maestro HPLC reports a single glycated-hemoglobin result over
 * ASTM (assay name fixed "HbA1c"). The instrument code must match what
 * `parseAstm` extracts from the R record test-id "1^HbA1c^^S".
 */
export const HBA1C_MAESTRO: DriverAnalyte[] = [
  a('HbA1c', 'Hemoglobin A1c', '%', 4.0, 6.0, 1),
  // Estimated Average Glucose — auto-derived from HbA1c (28.7*A1c − 46.7). Listed
  // so it is mappable to the LIS eAG test; the value is computed, not measured.
  a('eAG', 'Estimated Average Glucose', 'mg/dL', 90, 180, 1)
]

/** Landwind / Labnovation LD-560 HPLC HbA1c variant panel (Simple protocol). */
export const HBA1C_HPLC: DriverAnalyte[] = [
  a('HbA1a', 'HbA1a', '%', 0, 2, 1),
  a('HbA1b', 'HbA1b', '%', 0, 2, 1),
  a('HbF', 'HbF', '%', 0, 2, 1),
  a('L-A1c', 'L-A1c', '%', 0, 2, 1),
  a('S-A1c', 'HbA1c (S-A1c)', '%', 4.0, 6.0, 1),
  a('HbA0', 'HbA0', '%', 90, 98, 1),
  a('eAG', 'Estimated Average Glucose', 'mmol/L', 4.0, 7.0, 1),
  a('HbA1c', 'HbA1c', '%', 4.0, 6.0, 1)
]

export const INFLAMMATION: DriverAnalyte[] = [
  a('CRP', 'C-Reactive Protein', 'mg/L', 0, 5, 1),
  a('PCT', 'Procalcitonin', 'ng/mL', 0, 0.5),
  a('SAA', 'Serum Amyloid A', 'mg/L', 0, 10, 1),
  a('IL6', 'Interleukin-6', 'pg/mL', 0, 7, 1)
]

export const AUTOIMMUNE: DriverAnalyte[] = [
  a('ACCP', 'Anti-CCP', 'U/mL', 0, 17, 1)
]

export const CHEMISTRY: DriverAnalyte[] = [
  a('GLU', 'Glucose', 'mg/dL', 70, 100, 0),
  a('UREA', 'Urea', 'mg/dL', 15, 40, 0),
  a('CREA', 'Creatinine', 'mg/dL', 0.7, 1.3),
  a('UA', 'Uric Acid', 'mg/dL', 3.5, 7.2, 1),
  a('TBIL', 'Total Bilirubin', 'mg/dL', 0.3, 1.2),
  a('DBIL', 'Direct Bilirubin', 'mg/dL', 0, 0.3),
  a('ALT', 'Alanine Aminotransferase', 'U/L', 7, 56, 0),
  a('AST', 'Aspartate Aminotransferase', 'U/L', 5, 40, 0),
  a('ALP', 'Alkaline Phosphatase', 'U/L', 44, 147, 0),
  a('GGT', 'Gamma GT', 'U/L', 8, 61, 0),
  a('TP', 'Total Protein', 'g/dL', 6.4, 8.3, 1),
  a('ALB', 'Albumin', 'g/dL', 3.5, 5.2, 1),
  a('CHOL', 'Total Cholesterol', 'mg/dL', 125, 200, 0),
  a('TRIG', 'Triglycerides', 'mg/dL', 50, 150, 0),
  a('HDL', 'HDL Cholesterol', 'mg/dL', 40, 60, 0),
  a('LDL', 'LDL Cholesterol', 'mg/dL', 50, 130, 0),
  a('CALC', 'Calcium', 'mg/dL', 8.6, 10.2, 1),
  a('PHOS', 'Phosphorus', 'mg/dL', 2.5, 4.5, 1),
  a('AMY', 'Amylase', 'U/L', 28, 100, 0),
  a('LDH', 'Lactate Dehydrogenase', 'U/L', 140, 280, 0),
  a('CK', 'Creatine Kinase', 'U/L', 30, 200, 0)
]

export const ELECTROLYTES: DriverAnalyte[] = [
  a('NA', 'Sodium', 'mmol/L', 135, 145, 0),
  a('K', 'Potassium', 'mmol/L', 3.5, 5.1, 1),
  a('CL', 'Chloride', 'mmol/L', 98, 107, 0),
  a('ICA', 'Ionized Calcium', 'mmol/L', 1.12, 1.32),
  a('PH', 'pH', '', 7.35, 7.45)
]

export const CBC: DriverAnalyte[] = [
  a('WBC', 'White Blood Cell Count', '10^3/uL', 4.0, 11.0, 1),
  a('RBC', 'Red Blood Cell Count', '10^6/uL', 4.5, 5.9),
  a('HGB', 'Hemoglobin', 'g/dL', 13.0, 17.0, 1),
  a('HCT', 'Hematocrit', '%', 40, 50, 1),
  a('MCV', 'Mean Corpuscular Volume', 'fL', 80, 100, 1),
  a('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 27, 33, 1),
  a('MCHC', 'Mean Corpuscular Hgb Conc', 'g/dL', 32, 36, 1),
  a('RDW', 'Red Cell Distribution Width', '%', 11.5, 14.5, 1),
  a('PLT', 'Platelet Count', '10^3/uL', 150, 400, 0),
  a('MPV', 'Mean Platelet Volume', 'fL', 7.5, 11.5, 1),
  a('NEU', 'Neutrophils', '%', 40, 70, 1),
  a('LYM', 'Lymphocytes', '%', 20, 40, 1),
  a('MON', 'Monocytes', '%', 2, 8, 1),
  a('EOS', 'Eosinophils', '%', 1, 4, 1),
  a('BAS', 'Basophils', '%', 0, 1, 1)
]

/**
 * EDAN H60 / H60 Vet 5-part-diff CBC menu — instrument codes exactly as the H60
 * transmits them in OBX-4 (NEU#, NEU%, RDW_CV, …). Units mirror the analyzer
 * (counts in 10^9/L, HGB/MCHC in g/L). Seeds the mapping screen + simulator.
 */
export const EDAN_H60: DriverAnalyte[] = [
  a('WBC', 'White Blood Cell Count', '10^9/L', 3.5, 9.5, 2),
  a('NEU#', 'Neutrophils (abs)', '10^9/L', 1.8, 6.3, 2),
  a('NEU%', 'Neutrophils', '%', 40, 75, 1),
  a('LYM#', 'Lymphocytes (abs)', '10^9/L', 1.1, 3.2, 2),
  a('LYM%', 'Lymphocytes', '%', 20, 50, 1),
  a('MON#', 'Monocytes (abs)', '10^9/L', 0.1, 0.6, 2),
  a('MON%', 'Monocytes', '%', 3, 10, 1),
  a('EOS#', 'Eosinophils (abs)', '10^9/L', 0.02, 0.52, 2),
  a('EOS%', 'Eosinophils', '%', 0.5, 5, 1),
  a('BAS#', 'Basophils (abs)', '10^9/L', 0, 0.06, 2),
  a('BAS%', 'Basophils', '%', 0, 1, 1),
  a('RBC', 'Red Blood Cell Count', '10^12/L', 4.3, 5.8, 2),
  a('HGB', 'Hemoglobin', 'g/L', 130, 175, 0),
  a('HCT', 'Hematocrit', '%', 40, 50, 1),
  a('MCV', 'Mean Corpuscular Volume', 'fL', 82, 100, 1),
  a('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 27, 34, 1),
  a('MCHC', 'Mean Corpuscular Hgb Conc', 'g/L', 316, 354, 0),
  a('RDW_CV', 'RDW (CV)', '%', 11.5, 14.5, 1),
  a('RDW_SD', 'RDW (SD)', 'fL', 35, 56, 1),
  a('PLT', 'Platelet Count', '10^9/L', 125, 350, 0),
  a('MPV', 'Mean Platelet Volume', 'fL', 6.5, 12, 1),
  a('PDW', 'Platelet Distribution Width', 'fL', 9, 17, 1),
  a('PCT', 'Plateletcrit', '%', 0.108, 0.282, 3),
  a('P_LCR', 'Platelet Large Cell Ratio', '%', 13, 43, 1),
  a('P_LCC', 'Platelet Large Cell Count', '10^9/L', 30, 90, 0),
  a('NLR', 'Neutrophil/Lymphocyte Ratio', '', 0.78, 3.53, 2),
  a('PLR', 'Platelet/Lymphocyte Ratio', '', 50, 180, 0),
  a('NRBC#', 'Nucleated RBC (abs)', '10^9/L', 0, 0.01, 2),
  a('NRBC%', 'Nucleated RBC', '%', 0, 0.2, 1),
  a('ALY#', 'Atypical Lymphocytes (abs)', '10^9/L', 0, 0.1, 2),
  a('ALY%', 'Atypical Lymphocytes', '%', 0, 2, 1),
  a('LIC#', 'Large Immature Cells (abs)', '10^9/L', 0, 0.1, 2),
  a('LIC%', 'Large Immature Cells', '%', 0, 2.5, 1)
]

/**
 * HORIBA Yumizen H550 / H550E CBC + 5-part-DIFF menu — instrument codes EXACTLY
 * as the analyzer transmits them in the ASTM Universal Test ID (field 9.3,
 * component 4), e.g. "^^^MON%^5905-5" -> code "MON%". Note Horiba uses hyphens
 * (RDW-SD, RDW-CV, P-LCC, P-LCR) where the EDAN H60 uses underscores; the codes
 * must match the wire format verbatim or the mapping engine won't resolve them.
 * Units follow the analyzer's default "Conventional" unit system (counts as
 * 10^3/uL — sent on the wire as "1E03/mm3"; RBC as 10^6/uL; HGB/MCHC g/dL).
 * Seeds the mapping screen + simulator; the live unit is read from the frame.
 */
export const HORIBA_YUMIZEN: DriverAnalyte[] = [
  a('WBC', 'White Blood Cell Count', '10^3/uL', 4.0, 11.0, 2),
  a('RBC', 'Red Blood Cell Count', '10^6/uL', 4.5, 5.9, 2),
  a('HGB', 'Hemoglobin', 'g/dL', 13.0, 17.0, 1),
  a('HCT', 'Hematocrit', '%', 40, 50, 1),
  a('MCV', 'Mean Corpuscular Volume', 'fL', 80, 100, 1),
  a('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 27, 33, 1),
  a('MCHC', 'Mean Corpuscular Hgb Conc', 'g/dL', 32, 36, 1),
  a('RDW-SD', 'RDW (SD)', 'fL', 37, 54, 1),
  a('RDW-CV', 'RDW (CV)', '%', 11.5, 14.5, 1),
  a('MIC', 'Microcytic RBC (% vs RBC)', '%', 0, 5, 1),
  a('MAC', 'Macrocytic RBC (% vs RBC)', '%', 0, 5, 1),
  a('PLT', 'Platelet Count', '10^3/uL', 150, 400, 0),
  a('PCT', 'Plateletcrit', '%', 0.15, 0.40, 2),
  a('PDW', 'Platelet Distribution Width', '%', 10, 18, 1),
  a('MPV', 'Mean Platelet Volume', 'fL', 7.5, 11.5, 1),
  a('P-LCC', 'Platelet Large Cell Count', '10^3/uL', 30, 90, 0),
  a('P-LCR', 'Platelet Large Cell Ratio', '%', 18, 50, 1),
  a('LYM#', 'Lymphocytes (abs)', '10^3/uL', 1.0, 3.7, 2),
  a('LYM%', 'Lymphocytes', '%', 20, 40, 1),
  a('MON#', 'Monocytes (abs)', '10^3/uL', 0.1, 0.9, 2),
  a('MON%', 'Monocytes', '%', 2, 8, 1),
  a('NEU#', 'Neutrophils (abs)', '10^3/uL', 2.0, 7.0, 2),
  a('NEU%', 'Neutrophils', '%', 40, 70, 1),
  a('EOS#', 'Eosinophils (abs)', '10^3/uL', 0.02, 0.5, 2),
  a('EOS%', 'Eosinophils', '%', 1, 6, 1),
  a('BAS#', 'Basophils (abs)', '10^3/uL', 0, 0.1, 2),
  a('BAS%', 'Basophils', '%', 0, 1, 1),
  a('IMG#', 'Immature Granulocytes (abs)', '10^3/uL', 0, 0.06, 2),
  a('IMG%', 'Immature Granulocytes', '%', 0, 0.7, 1),
  a('IMM#', 'Immature Monocytic Cells (abs)', '10^3/uL', 0, 0.06, 2),
  a('IMM%', 'Immature Monocytic Cells', '%', 0, 0.7, 1),
  a('IML#', 'Immature Lymphocytic Cells (abs)', '10^3/uL', 0, 0.06, 2),
  a('IML%', 'Immature Lymphocytic Cells', '%', 0, 0.7, 1),
  a('ALY#', 'Atypical Lymphocytes (abs)', '10^3/uL', 0, 0.1, 2),
  a('ALY%', 'Atypical Lymphocytes', '%', 0, 2, 1),
  a('LIC#', 'Large Immature Cells (abs)', '10^3/uL', 0, 0.1, 2),
  a('LIC%', 'Large Immature Cells', '%', 0, 3, 1)
]

/** ESR add-on reported by the Yumizen H550E only (ASTM code "ESR", mm/h). */
export const HORIBA_ESR: DriverAnalyte[] = [a('ESR', 'Erythrocyte Sedimentation Rate', 'mm/h', 0, 20, 0)]

/**
 * Agappe Mispa HX 58 CBC + 5-part-DIFF menu (Dymind OEM) — instrument codes are
 * the analyzer's parameter abbreviations exactly as the HX 58 user manual lists
 * them (NEUT#/LYMPH#/MONO#/EO#/BASO#, RDW-CV/RDW-SD, note the trailing "T"/"O"
 * that differs from the EDAN/Horiba mnemonics). Units follow the analyzer's SI
 * default per the manual body (counts 10^9/L, RBC 10^12/L, HGB/MCHC g/L, MPV/PDW
 * fL); the live unit is read from the ASTM R record. Seeds mapping + simulator.
 */
export const HX58_CBC: DriverAnalyte[] = [
  a('WBC', 'White Blood Cell Count', '10^9/L', 4.0, 10.0, 2),
  a('NEUT#', 'Neutrophils (abs)', '10^9/L', 2.0, 7.0, 2),
  a('NEUT%', 'Neutrophils', '%', 50, 70, 1),
  a('LYMPH#', 'Lymphocytes (abs)', '10^9/L', 0.8, 4.0, 2),
  a('LYMPH%', 'Lymphocytes', '%', 20, 40, 1),
  a('MONO#', 'Monocytes (abs)', '10^9/L', 0.12, 1.2, 2),
  a('MONO%', 'Monocytes', '%', 3, 12, 1),
  a('EO#', 'Eosinophils (abs)', '10^9/L', 0.02, 0.5, 2),
  a('EO%', 'Eosinophils', '%', 0.5, 5, 1),
  a('BASO#', 'Basophils (abs)', '10^9/L', 0, 0.1, 2),
  a('BASO%', 'Basophils', '%', 0, 1, 1),
  a('RBC', 'Red Blood Cell Count', '10^12/L', 4.0, 5.5, 2),
  a('HGB', 'Hemoglobin', 'g/L', 130, 175, 0),
  a('HCT', 'Hematocrit', '%', 40, 50, 1),
  a('MCV', 'Mean Corpuscular Volume', 'fL', 82, 100, 1),
  a('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 27, 34, 1),
  a('MCHC', 'Mean Corpuscular Hgb Conc', 'g/L', 316, 354, 0),
  a('RDW-CV', 'RDW (CV)', '%', 11.5, 14.5, 1),
  a('RDW-SD', 'RDW (SD)', 'fL', 35, 56, 1),
  a('PLT', 'Platelet Count', '10^9/L', 150, 400, 0),
  a('MPV', 'Mean Platelet Volume', 'fL', 7.5, 11.5, 1),
  a('PDW', 'Platelet Distribution Width', 'fL', 15, 17, 1),
  a('PCT', 'Plateletcrit', '%', 0.108, 0.282, 3)
]

/**
 * Boule Swelab Lumi / Medonic M51 CBC + 5-part-DIFF menu — instrument codes are
 * the short mnemonic Boule sends in OBX-3 component 2 (e.g. `6690-2^WBC^LN` ->
 * "WBC"), with the leading "*" research marker stripped (ALY#, LIC#). Units use
 * the analyzer's wire notation ("10*9/L" = 10^9/L; HGB/MCHC in g/L). Seeds the
 * mapping screen + simulator; the live unit is read from OBX-6 of each frame.
 */
export const BOULE_CBC: DriverAnalyte[] = [
  a('WBC', 'White Blood Cell Count', '10*9/L', 4.0, 10.0, 2),
  a('NEU%', 'Neutrophils', '%', 50, 70, 1),
  a('LYM%', 'Lymphocytes', '%', 20, 40, 1),
  a('MON%', 'Monocytes', '%', 3, 12, 1),
  a('EOS%', 'Eosinophils', '%', 0.5, 5, 1),
  a('BAS%', 'Basophils', '%', 0, 1, 1),
  a('NEU#', 'Neutrophils (abs)', '10*9/L', 2.0, 7.0, 2),
  a('LYM#', 'Lymphocytes (abs)', '10*9/L', 0.8, 4.0, 2),
  a('MON#', 'Monocytes (abs)', '10*9/L', 0.12, 1.2, 2),
  a('EOS#', 'Eosinophils (abs)', '10*9/L', 0.02, 0.5, 2),
  a('BAS#', 'Basophils (abs)', '10*9/L', 0, 0.1, 2),
  a('ALY#', 'Atypical Lymphocytes (abs)', '10*9/L', 0, 0.2, 2),
  a('ALY%', 'Atypical Lymphocytes', '%', 0, 2, 1),
  a('LIC#', 'Large Immature Cells (abs)', '10*9/L', 0, 0.2, 2),
  a('LIC%', 'Large Immature Cells', '%', 0, 2.5, 1),
  a('RBC', 'Red Blood Cell Count', '10*12/L', 4.0, 5.5, 2),
  a('HGB', 'Hemoglobin', 'g/L', 120, 160, 0),
  a('HCT', 'Hematocrit', '%', 40, 54, 1),
  a('MCV', 'Mean Corpuscular Volume', 'fL', 80, 100, 1),
  a('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 27, 34, 1),
  a('MCHC', 'Mean Corpuscular Hgb Conc', 'g/L', 320, 360, 0),
  a('RDW-CV', 'RDW (CV)', '%', 11, 16, 1),
  a('RDW-SD', 'RDW (SD)', 'fL', 35, 56, 1),
  a('PLT', 'Platelet Count', '10*9/L', 100, 300, 0),
  a('MPV', 'Mean Platelet Volume', 'fL', 6.5, 12, 1),
  a('PDW', 'Platelet Distribution Width', '', 15, 17, 1),
  a('PCT', 'Plateletcrit', '%', 0.108, 0.282, 3),
  a('P-LCR', 'Platelet Large Cell Ratio', '%', 13, 43, 1),
  a('P-LCC', 'Platelet Large Cell Count', '10*9/L', 30, 90, 0)
]

export const URINALYSIS: DriverAnalyte[] = [
  a('UGLU', 'Urine Glucose', 'mg/dL', 0, 15, 0),
  a('UPRO', 'Urine Protein', 'mg/dL', 0, 10, 0),
  a('UKET', 'Urine Ketones', 'mg/dL', 0, 5, 0),
  a('UBIL', 'Urine Bilirubin', 'umol/L', 0, 3, 0),
  a('URO', 'Urobilinogen', 'mg/dL', 0.2, 1.0),
  a('UBLD', 'Urine Blood (RBC)', 'cells/uL', 0, 5, 0),
  a('UNIT', 'Nitrite', 'COI', 0, 1),
  a('ULEU', 'Leukocyte Esterase', 'cells/uL', 0, 10, 0),
  a('USG', 'Specific Gravity', '', 1.005, 1.03, 3),
  a('UPH', 'Urine pH', '', 5.0, 7.0, 1)
]

export const COAGULATION: DriverAnalyte[] = [
  a('PT', 'Prothrombin Time', 'sec', 11, 13.5, 1),
  a('APTT', 'Activated Partial Thromboplastin Time', 'sec', 25, 35, 1),
  a('INR', 'International Normalized Ratio', '', 0.8, 1.2),
  a('FIB', 'Fibrinogen', 'mg/dL', 200, 400, 0),
  a('TT', 'Thrombin Time', 'sec', 14, 21, 1),
  a('DDIMER', 'D-Dimer', 'mg/L FEU', 0, 0.5)
]

/** Merge panels, de-duplicating by analyte code (first occurrence wins). */
export function combine(...groups: DriverAnalyte[][]): DriverAnalyte[] {
  const map = new Map<string, DriverAnalyte>()
  for (const group of groups) {
    for (const an of group) if (!map.has(an.code)) map.set(an.code, an)
  }
  return [...map.values()]
}

/** Full immunoassay (CLIA) menu shared by Maglumi / MAGICL / Access / DxI. */
export const IMMUNOASSAY_FULL = combine(
  THYROID,
  FERTILITY,
  TUMOR,
  CARDIAC,
  INFECTIOUS,
  BONE,
  ANEMIA,
  DIABETES,
  AUTOIMMUNE
)

/** Point-of-care immunofluorescence (Getein FIA) menu. */
export const FIA_PANEL = combine(CARDIAC, INFLAMMATION, DIABETES, THYROID.slice(0, 1))

/** Integrated chemistry + immunoassay (Biolumi / DxC 500i). */
export const INTEGRATED = combine(CHEMISTRY, ELECTROLYTES, IMMUNOASSAY_FULL)
