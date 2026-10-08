import { CreditLedgerService } from './credit-ledger.service'
import { SupabaseService } from '../../core/database/supabase.service'

describe('CreditLedgerService', () => {
  let service: CreditLedgerService

  const mockSupabaseService = {
    admin: {
      from: jest.fn(),
    },
  } as unknown as SupabaseService

  beforeEach(() => {
    service = new CreditLedgerService(mockSupabaseService)
  })

  describe('deriveLevelBand', () => {
    it('should derive 100s for level 1 codes', () => {
      expect(service.deriveLevelBand('ENG101')).toBe('100s')
      expect(service.deriveLevelBand('PHY-102')).toBe('100s')
      expect(service.deriveLevelBand('MDC 105')).toBe('100s')
    })

    it('should derive 200s for level 2 codes', () => {
      expect(service.deriveLevelBand('CS201')).toBe('200s')
      expect(service.deriveLevelBand('MATH204')).toBe('200s')
    })

    it('should derive 300s, 400s, and 500s accurately', () => {
      expect(service.deriveLevelBand('BOT301')).toBe('300s')
      expect(service.deriveLevelBand('CHE401')).toBe('400s')
      expect(service.deriveLevelBand('INT501')).toBe('500s')
    })

    it('should return Other when no digits are present', () => {
      expect(service.deriveLevelBand('INTERNSHIP')).toBe('Other')
      expect(service.deriveLevelBand('')).toBe('Other')
    })
  })

  describe('normalizeCategory', () => {
    it('should map standard categories directly', () => {
      expect(service.normalizeCategory('AEC')).toBe('AEC')
      expect(service.normalizeCategory('SEC')).toBe('SEC')
      expect(service.normalizeCategory('VAC')).toBe('VAC')
      expect(service.normalizeCategory('MDC')).toBe('MDC')
      expect(service.normalizeCategory('MOC')).toBe('MOC')
      expect(service.normalizeCategory('MOOC')).toBe('MOOC')
    })

    it('should keep DSC, DSE, and DSS as separate and distinct categories', () => {
      expect(service.normalizeCategory('DSC')).toBe('DSC')
      expect(service.normalizeCategory('DSE')).toBe('DSE')
      expect(service.normalizeCategory('DSS')).toBe('DSS')
    })

    it('should resolve categories from course code if raw category is missing or general', () => {
      expect(service.normalizeCategory('', 'ENG101DSC')).toBe('DSC')
      expect(service.normalizeCategory('General', 'CHE201DSE')).toBe('DSE')
      expect(service.normalizeCategory('', 'SW-MOOC-101')).toBe('MOOC')
      expect(service.normalizeCategory('', 'HIS-MDC-01')).toBe('MDC')
    })

    it('should identify Internship', () => {
      expect(service.normalizeCategory('INT')).toBe('INT')
      expect(service.normalizeCategory('INTERNSHIP')).toBe('INT')
      expect(service.normalizeCategory('', '', 'Summer Internship Program')).toBe('INT')
    })

    it('should identify Research Project and Field Work', () => {
      expect(service.normalizeCategory('RPH')).toBe('RPH')
      expect(service.normalizeCategory('', '', 'Honours Research Project')).toBe('RPH')
      expect(service.normalizeCategory('FWD')).toBe('FWD')
      expect(service.normalizeCategory('DMP')).toBe('DMP')
      expect(service.normalizeCategory('CIP')).toBe('CIP')
    })
  })
})
