import { CampusAttendanceService } from './campus-attendance.service';

describe('CampusAttendanceService - Geofence and Haversine Tests', () => {
  let service: CampusAttendanceService;

  beforeEach(() => {
    // Mock SupabaseService and AuditLoggerService
    const mockSupabase = { admin: {} } as any;
    const mockAudit = { log: jest.fn() } as any;
    service = new CampusAttendanceService(mockSupabase, mockAudit);
  });

  it('correctly computes 0 meters distance for identical coordinates', () => {
    const distance = service.calculateHaversineDistance(11.7582, 75.4944, 11.7582, 75.4944);
    expect(distance).toBeCloseTo(0, 1);
  });

  it('correctly computes distance between Janaki Ammal Campus and Thalassery Railway Station (~3.5km)', () => {
    // Janaki Ammal Campus: 11.7582, 75.4944
    // Thalassery Railway Station: 11.7483, 75.4903
    const distance = service.calculateHaversineDistance(11.7582, 75.4944, 11.7483, 75.4903);
    // Should be approximately 1170 meters (1.17 km)
    expect(distance).toBeGreaterThan(1000);
    expect(distance).toBeLessThan(1400);
  });

  it('correctly validates a coordinate within a 400m geofence radius', () => {
    // Center: 11.758200, 75.494400
    // Nearby (approx 50m north): 11.758650, 75.494400
    const distance = service.calculateHaversineDistance(11.7582, 75.4944, 11.75865, 75.4944);
    expect(distance).toBeLessThan(400);
  });

  it('correctly detects a coordinate outside a 400m geofence radius', () => {
    // Center: 11.758200, 75.494400
    // Far (approx 600m): 11.763500, 75.494400
    const distance = service.calculateHaversineDistance(11.7582, 75.4944, 11.7635, 75.4944);
    expect(distance).toBeGreaterThan(400);
  });
});
