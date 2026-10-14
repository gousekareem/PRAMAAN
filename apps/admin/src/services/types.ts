export type Role = 'ADMIN' | 'SUPERVISOR' | 'REVIEWER' | 'OFFICER';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  officerId: string | null;
  isDemo: boolean;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type FreshnessLabel = 'RECENTLY_RECEIVED' | 'DELAYED_SYNC' | 'OFFLINE_LAST_KNOWN' | 'STALE';

export interface Observation {
  officerId: string;
  officerName: string;
  isDemo: boolean;
  eventId: string;
  eventType: string;
  latitude: number;
  longitude: number;
  horizontalAccuracyM: number | null;
  recordedDeviceTime: string;
  trustedTimeEstimate: string | null;
  serverReceivedAt: string;
  spatialResult: string;
  mockIndicator: boolean | null;
  dutySessionId: string | null;
  verificationStatus: string;
  freshness: { label: FreshnessLabel; ageMs: number; syncDelayMs: number };
}

export interface Summary {
  activeDutySessions: number;
  devicesSeen30m: number;
  activeDevices: number;
  pendingDevices: number;
  evidenceAwaitingUpload: number;
  missedCheckins24h: number;
  openFlags: number;
  evidenceRequiringReview: number;
  spatialExceptions: number;
  lastBatchReceivedAt: string | null;
  systemHealth: { api: string; database: string };
  generatedAt: string;
}

export interface Flag {
  id: string;
  flagType: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'ASSIGNED' | 'RESOLVED' | 'DISMISSED';
  title: string;
  description: string;
  officerId: string | null;
  officerName: string | null;
  deviceId: string | null;
  dutySessionId: string | null;
  eventId: string | null;
  evidenceId: string | null;
  inputs: Record<string, unknown>;
  assignedTo: string | null;
  assignedToName: string | null;
  resolutionNote: string | null;
  createdAt: string;
  isDemo: boolean | null;
}

export interface EvidenceListItem {
  evidenceId: string;
  status: 'AWAITING_UPLOAD' | 'VERIFIED' | 'QUARANTINED';
  officerId: string;
  officerName: string;
  dutySessionId: string | null;
  imageSha256: string;
  capturedAtDevice: string;
  serverReceivedAt: string;
  verifiedAt: string | null;
  screenRiskScore: number | null;
  isDemo: boolean;
}

export interface CustodyRecord {
  auditId: string;
  sequence: number;
  occurredAt: string;
  actorRole: string | null;
  action: string;
  recordHash: string;
  previousHash: string;
  details: Record<string, unknown>;
}

export interface EvidenceDetail {
  evidenceId: string;
  eventId: string;
  status: EvidenceListItem['status'];
  officer: { displayName: string; employeeRef: string; isDemo: boolean };
  officerId: string;
  deviceId: string;
  dutySessionId: string | null;
  imageSha256: string;
  computedImageSha256: string | null;
  manifestSha256: string;
  manifest: {
    capture: {
      deviceWallTime: string;
      trustedTimeEstimate: string | null;
      trustedTimeUncertaintyMs: number | null;
      cameraId: string | null;
      captureApi: string;
    };
    image: { width: number; height: number; byteLength: number; mimeType: string };
    location: {
      availability: string;
      latitude: number | null;
      longitude: number | null;
      horizontalAccuracyM: number | null;
      provider: string | null;
      mockIndicator: boolean | null;
    };
    devicePosture: {
      rootIndicators: string[];
      debuggableBuild: boolean | null;
      keyHardwareBacked: boolean | null;
      emulatorIndicators: string[];
    };
    motion: { stepsSinceBoot: number | null; motionState: string | null };
    cellular: { availability: string };
  };
  verificationDetail: Record<string, unknown> | null;
  screenRecaptureRisk: { score?: number; method?: string; error?: string } | null;
  uploadAttempts: number;
  times: {
    deviceWallTime: string;
    trustedTimeEstimate: string | null;
    serverReceivedAt: string;
    serverProcessedAt: string;
    uploadReceivedAt: string | null;
    verifiedAt: string | null;
  };
  ledger: {
    sequence: number;
    eventHash: string;
    previousEventHash: string;
    neighbours: {
      eventId: string;
      sequence: number;
      eventType: string;
      eventHash: string;
      previousEventHash: string;
      deviceWallTime: string;
    }[];
  };
  canViewImage: boolean;
  custody: CustodyRecord[];
}
