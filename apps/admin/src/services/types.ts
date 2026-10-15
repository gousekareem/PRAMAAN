/** Role codes come from the server's configurable `roles` table (HG, PC, HC, ASI, SI, CI, DSP, ADMIN, …). */
export type Role = string;

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  roleLabel?: string;
  officerId: string | null;
  isDemo: boolean;
  /** Permission codes granted by the server (UI hints only — every request is re-authorised server-side). */
  permissions?: string[];
  scopeLevel?: string;
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
  dutyAssignmentId?: string | null;
  dutyReference?: string | null;
  dutyCategory?: string | null;
  noteCount?: number;
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

// ---- PRAMAAN 2.0 railway-police operations ------------------------------------------------
export type DutyCategory = 'TRAIN_BEAT' | 'STATION_WATCH' | 'VIP_ESCORT' | 'TRACK_INCIDENT';
export type DutyStatus =
  | 'DRAFT'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'EXCEPTION_REPORTED'
  | 'CANCELLED';

export interface DutyPersonnelSummary {
  personnelId: string;
  officerId: string;
  name: string;
  personnelClass: string;
  roleInDuty: 'LEAD' | 'MEMBER';
  status: string;
}

export interface DutyListItem {
  id: string;
  referenceCode: string;
  category: DutyCategory;
  categoryLabel: string;
  isRestricted: boolean;
  detailsVisible: boolean;
  title: string;
  unitId: string;
  unitName: string;
  plannedStart: string;
  plannedEnd: string;
  status: DutyStatus;
  reportingLocation: string | null;
  trainRef: string | null;
  stationName: string | null;
  escortLabel: string | null;
  incidentRef: string | null;
  supervisorName: string | null;
  isDemo: boolean;
  personnel: DutyPersonnelSummary[];
  openExceptions: number;
  openConflicts: number;
  checkinsAcknowledged: number;
  checkinsMissed: number;
}

export interface DutyPersonnelRow {
  personnelId: string;
  officerId: string;
  name: string;
  personnelRef: string;
  personnelClass: string;
  roleInDuty: 'LEAD' | 'MEMBER';
  status: 'ASSIGNED' | 'ACCEPTED' | 'REMOVED' | 'REPLACED';
  assignedAt: string;
  acceptedAt: string | null;
  removedAt: string | null;
  removalReason: string | null;
  conflictOverrideReason: string | null;
  isActive: boolean;
  dutySessionId: string | null;
  sessionStatus: string | null;
  deviceReportedStart: string | null;
  serverReceivedStart: string | null;
  deviceReportedEnd: string | null;
  checkinsAcknowledged: number;
  checkinsLate: number;
  checkinsMissed: number;
  lastDeviceSyncAt: string | null;
}

export interface DutyDetail extends DutyListItem {
  notes: string | null;
  acceptRequired: boolean;
  supervisorOfficerId: string | null;
  stationUnitId: string | null;
  completionNote: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
  createdByName: string;
  version: number;
  checkinPolicy: {
    minIntervalMin: number;
    maxIntervalMin: number;
    responseWindowSec: number;
    reportingWindowMin: number;
    graceMin: number;
  };
  personnelHistory: DutyPersonnelRow[];
  instructions: {
    id: string;
    version: number;
    body: string | null;
    bodySha256: string;
    publishedAt: string;
    publishedByName: string;
    acknowledgements: { officerId: string; name: string; acknowledgedAt: string }[];
  }[];
  handovers: {
    id: string;
    handoverAt: string;
    outgoingOfficerId: string;
    outgoingName: string;
    incomingOfficerId: string;
    incomingName: string;
    outstandingTasks: string | null;
    outgoingAckAt: string | null;
    incomingAckAt: string | null;
    recordedByName: string;
    recordedAt: string;
  }[];
  changes: {
    id: string;
    changeType: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason: string | null;
    occurredAt: string;
    actorName: string;
  }[];
  exceptions: { id: string; flagType: string; severity: string; status: string; title: string; createdAt: string; officerName: string | null }[];
  evidence: { evidenceId: string; status: string; officerId: string; officerName: string; createdAt: string; uploadAttempts: number }[];
  warnings: string[];
  myAssignment: { personnelId: string; status: string } | null;
  actions: {
    allowedTransitions: DutyStatus[];
    canEdit: boolean;
    canAssign: boolean;
    canPublishInstructions: boolean;
    canRecordHandover: boolean;
    canAccept: boolean;
    canOverrideConflicts: boolean;
  };
}

export interface Conflict {
  type: 'ASSIGNMENT' | 'LEGACY_SESSION' | 'UNAVAILABLE';
  id: string;
  reference: string;
  start: string;
  end: string;
  detail: string;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  unitType: 'SUBDIVISION' | 'CIRCLE' | 'STATION' | 'OTHER';
  parentId: string | null;
  isActive: boolean;
  isDemo: boolean;
}

export interface PersonnelItem {
  id: string;
  personnelRef: string;
  displayName: string;
  personnelCategory: 'POLICE' | 'HOME_GUARD';
  rank: string | null;
  constableCategory: 'AR' | 'GENERAL' | null;
  gender: string;
  unitId: string | null;
  unitName: string | null;
  isActive: boolean;
  isDemo: boolean;
  personnelClass: string;
  accountRole?: string | null;
  openDuties?: number;
  lastSyncAt?: string | null;
}

export interface CategoryPolicy {
  code: DutyCategory;
  label: string;
  description: string;
  isRestricted: boolean;
  minPersonnel: number;
  requiresSupervisor: boolean;
  acceptRequired: boolean;
  eligibilityMode: 'BLOCK' | 'WARN';
  checkinMinIntervalMin: number;
  checkinMaxIntervalMin: number;
  responseWindowSec: number;
  reportingWindowMin: number;
  graceMin: number;
  maxDurationHours: number;
  policyVersion: number;
  validationNote: string;
  eligible: string[];
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  relatedType: string | null;
  relatedId: string | null;
  deliveryStatus: 'QUEUED' | 'DELIVERED' | 'READ';
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}
