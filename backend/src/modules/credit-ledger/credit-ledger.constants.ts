/**
 * KU-FYIMP Regulation 2024 Credit Rules & Advisory Thresholds
 * Versioned Advisory Matrix (F52)
 */

export const ADVISORY_MATRIX_VERSION = 'KU-FYIMP-2024-V1-ADVISORY';

export const ADVISORY_CREDIT_DISCLAIMER =
  'This registered-credit ledger tracks registered and allocated credits for academic planning. ' +
  'It does NOT constitute official graduation certification or final degree eligibility. ' +
  'Official degree awards are subject to University examination results and regulatory validation.';

export const UNRESOLVED_REQUIREMENT_NOTE =
  'Category credit distributions vary by selected pathway (e.g. Major vs Minor balance, ' +
  'Honours with Coursework vs Honours with Research). Regulatory minimums sum differently across pathways; ' +
  'observed credits are reported for planning without definitive degree certification.';

/**
 * Canonical 14 FYIMP Categories
 */
export const CANONICAL_CATEGORIES = [
  'DSC', 'DSE', 'MDC', 'VAC', 'SEC', 'AEC', 'MOC',
  'MOOC', 'INT', 'RPH', 'FWD', 'DSS', 'DMP', 'CIP',
] as const;

export type CanonicalCategory = typeof CANONICAL_CATEGORIES[number];

/**
 * Advisory Category Benchmark Requirements (KU-FYIMP 2024)
 */
export const CATEGORY_REQUIREMENTS = {
  DSC: { name: 'Discipline Specific Core (DSC)', min3Year: 60, min4Year: 80 },
  DSE: { name: 'Discipline Specific Elective (DSE)', min3Year: 24, min4Year: 32 },
  MDC: { name: 'Multidisciplinary Course (MDC)', min3Year: 9, min4Year: 9 },
  VAC: { name: 'Value Addition Course (VAC)', min3Year: 6, min4Year: 6 },
  SEC: { name: 'Skill Enhancement Course (SEC)', min3Year: 9, min4Year: 9 },
  AEC: { name: 'Ability Enhancement Course (AEC)', min3Year: 9, min4Year: 9 },
  MOC: { name: 'Minor Open Elective (MOC)', min3Year: 8, min4Year: 12 },
  MOOC: { name: 'Massive Open Online Course (MOOC)', min3Year: 2, min4Year: 4 },
  INT: { name: 'Internship (INT)', min3Year: 4, min4Year: 4 },
  RPH: { name: 'Research Project / Honours (RPH)', min3Year: 0, min4Year: 12 },
  FWD: { name: 'Field Work / Dissertation (FWD)', min3Year: 0, min4Year: 4 },
  DSS: { name: 'Discipline Specific Skill (DSS)', min3Year: 6, min4Year: 6 },
  DMP: { name: 'Department Major Project (DMP)', min3Year: 0, min4Year: 8 },
  CIP: { name: 'Community Interaction (CIP)', min3Year: 2, min4Year: 2 },
} as const;

/**
 * Academic Level Bands & Approved Benchmark Hours/Credits
 */
export const LEVEL_BAND_REQUIREMENTS = {
  '100s': { name: '100-Level Introductory', min: 24, firstDigit: '1' },
  '200s': { name: '200-Level Intermediate', min: 32, firstDigit: '2' },
  '300s': { name: '300-Level Advanced', min: 38, firstDigit: '3' },
  '400s': { name: '400-Level Honours / Advanced', min: 44, firstDigit: '4' },
  '500s': { name: '500-Level Integrated PG', min: 40, firstDigit: '5' },
} as const;

export type LevelBandKey = '100s' | '200s' | '300s' | '400s' | '500s' | 'Unknown';

/**
 * Advisory Degree Exit Benchmarks (Not certification thresholds)
 */
export const ADVISORY_DEGREE_EXIT_TARGETS = {
  THREE_YEAR_UG: {
    title: '3-Year UG Exit Benchmark',
    targetCredits: 133,
    requiredBands: ['100s', '200s', '300s'] as const,
  },
  FOUR_YEAR_HONOURS: {
    title: '4-Year Honours Exit Benchmark',
    targetCredits: 177,
    requiredBands: ['100s', '200s', '300s', '400s'] as const,
  },
  FIVE_YEAR_INTEGRATED_PG: {
    title: '5-Year Integrated PG Exit Benchmark',
    targetCredits: 217,
    requiredBands: ['100s', '200s', '300s', '400s', '500s'] as const,
  },
} as const;

// Backward-compatible alias for existing callers
export const DEGREE_EXIT_THRESHOLDS = {
  THREE_YEAR_UG: {
    title: ADVISORY_DEGREE_EXIT_TARGETS.THREE_YEAR_UG.title,
    creditsRequired: ADVISORY_DEGREE_EXIT_TARGETS.THREE_YEAR_UG.targetCredits,
    requiredBands: ADVISORY_DEGREE_EXIT_TARGETS.THREE_YEAR_UG.requiredBands,
  },
  FOUR_YEAR_HONOURS: {
    title: ADVISORY_DEGREE_EXIT_TARGETS.FOUR_YEAR_HONOURS.title,
    creditsRequired: ADVISORY_DEGREE_EXIT_TARGETS.FOUR_YEAR_HONOURS.targetCredits,
    requiredBands: ADVISORY_DEGREE_EXIT_TARGETS.FOUR_YEAR_HONOURS.requiredBands,
  },
  FIVE_YEAR_INTEGRATED_PG: {
    title: ADVISORY_DEGREE_EXIT_TARGETS.FIVE_YEAR_INTEGRATED_PG.title,
    creditsRequired: ADVISORY_DEGREE_EXIT_TARGETS.FIVE_YEAR_INTEGRATED_PG.targetCredits,
    requiredBands: ADVISORY_DEGREE_EXIT_TARGETS.FIVE_YEAR_INTEGRATED_PG.requiredBands,
  },
} as const;

/**
 * Department / Discipline Administrative Aliases
 */
export const DEPARTMENT_ALIASES: Record<string, string> = {
  IT: 'CSE',
  CSE: 'IT',
  MATH: 'MAT',
  MATHEMATICS: 'MAT',
  ENG: 'ENG',
  ENGLISH: 'ENG',
  PHYSICS: 'PHY',
  CHEMISTRY: 'CHE',
  BOTANY: 'BOT',
  ZOOLOGY: 'ZOO',
};

/**
 * Parsed KU Course Code Representation (F51)
 */
export interface ParsedKuCourseCode {
  originalCode: string;
  isValid: boolean;
  semester?: number;
  category?: string;
  discipline?: string;
  serialNumber?: string;
  derivedLevelBand: LevelBandKey;
}

/**
 * Robust course code parser decomposing Kannur University FYIMP course codes
 * Format: KU + [Semester (2 digits)] + [Category (3-4 chars)] + [Discipline (2-4 chars)] + [Serial (3-4 digits)]
 * Example: KU03DSCCSE201 -> Sem: 3, Cat: DSC, Discipline: CSE, Serial: 201 -> Level: 200s
 */
export function parseKuCourseCode(rawCode: string, explicitLevel?: string | null): ParsedKuCourseCode {
  if (!rawCode || typeof rawCode !== 'string') {
    return {
      originalCode: rawCode || '',
      isValid: false,
      derivedLevelBand: 'Unknown',
    };
  }

  const code = rawCode.trim().toUpperCase();

  // If explicit level band was passed from courses table catalog
  if (explicitLevel && ['100s', '200s', '300s', '400s', '500s'].includes(explicitLevel)) {
    return {
      originalCode: code,
      isValid: true,
      derivedLevelBand: explicitLevel as LevelBandKey,
    };
  }

  // Regex matching KU standard course format
  // Group 1: Semester (1 or 2 digits, optional leading 0)
  // Group 2: Canonical Category (e.g. MOOC, DSC, DSE, MDC, AEC, VAC, SEC, etc.)
  // Group 3: Discipline / Department (e.g. CSE, MAT, PHY, ENG, MAL, etc.)
  // Group 4: Serial / Course number (e.g. 101, 201, 301, 401, 501)
  const kuRegex = /^KU0?([1-9]|10)(MOOC|DSC|DSE|MDC|VAC|SEC|AEC|MOC|INT|RPH|FWD|DSS|DMP|CIP|[A-Z]{3,4})([A-Z]{2,4})(\d{3,4})$/
  const match = code.match(kuRegex)

  if (match) {
    const sem = parseInt(match[1], 10);
    const cat = match[2];
    const disc = match[3];
    const serial = match[4];

    // Determine level band based on the serial leading digit (e.g. 101 -> 100s, 201 -> 200s)
    let derivedLevelBand: LevelBandKey = 'Unknown';
    const serialFirstDigit = serial.charAt(0);
    if (serialFirstDigit === '1') derivedLevelBand = '100s';
    else if (serialFirstDigit === '2') derivedLevelBand = '200s';
    else if (serialFirstDigit === '3') derivedLevelBand = '300s';
    else if (serialFirstDigit === '4') derivedLevelBand = '400s';
    else if (serialFirstDigit === '5') derivedLevelBand = '500s';

    return {
      originalCode: code,
      isValid: true,
      semester: sem,
      category: cat,
      discipline: disc,
      serialNumber: serial,
      derivedLevelBand,
    };
  }

  // Fallback pattern for shorthand like KU03MAT201 (missing category) or MAT101
  const shorthandMatch = code.match(/^KU0?([1-9]|10)([A-Z]{2,4})(\d{3,4})$/);
  if (shorthandMatch) {
    const sem = parseInt(shorthandMatch[1], 10);
    const disc = shorthandMatch[2];
    const serial = shorthandMatch[3];
    let derivedLevelBand: LevelBandKey = 'Unknown';
    const sDigit = serial.charAt(0);
    if (sDigit === '1') derivedLevelBand = '100s';
    else if (sDigit === '2') derivedLevelBand = '200s';
    else if (sDigit === '3') derivedLevelBand = '300s';
    else if (sDigit === '4') derivedLevelBand = '400s';
    else if (sDigit === '5') derivedLevelBand = '500s';

    return {
      originalCode: code,
      isValid: true,
      semester: sem,
      discipline: disc,
      serialNumber: serial,
      derivedLevelBand,
    };
  }

  // Fallback for trailing 3-digit serial (e.g. CS101, ENG201)
  const trailingDigitsMatch = code.match(/(\d{3,4})$/);
  if (trailingDigitsMatch) {
    const serial = trailingDigitsMatch[1];
    const sDigit = serial.charAt(0);
    let derivedLevelBand: LevelBandKey = 'Unknown';
    if (sDigit === '1') derivedLevelBand = '100s';
    else if (sDigit === '2') derivedLevelBand = '200s';
    else if (sDigit === '3') derivedLevelBand = '300s';
    else if (sDigit === '4') derivedLevelBand = '400s';
    else if (sDigit === '5') derivedLevelBand = '500s';

    return {
      originalCode: code,
      isValid: true,
      serialNumber: serial,
      derivedLevelBand,
    };
  }

  return {
    originalCode: code,
    isValid: false,
    derivedLevelBand: 'Unknown',
  };
}
