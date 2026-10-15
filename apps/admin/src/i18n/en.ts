/**
 * English UI strings for the railway-police operations modules. Every new screen reads its
 * labels from here through `t()`, so a Telugu (or other) dictionary can be added without
 * touching page logic. Keys are stable identifiers; values are display text.
 */
export const en = {
  'app.name': 'PRAMAAN',
  'app.tagline': 'Railway police duty & proof-of-presence · academic prototype',
  'app.demoData': 'DEMO DATA',

  'nav.group.overview': 'Overview',
  'nav.group.operations': 'Duty operations',
  'nav.group.records': 'Records & review',
  'nav.group.admin': 'Administration',
  'nav.overview': 'Overview',
  'nav.myDuties': 'My duties',
  'nav.dutyAssignments': 'Duty assignments',
  'nav.trainBeats': 'Train beats',
  'nav.stationWatches': 'Station watches',
  'nav.vipEscorts': 'VIP escorts',
  'nav.trackIncidents': 'Track incidents',
  'nav.roster': 'Duty roster',
  'nav.checkins': 'Check-ins & presence',
  'nav.map': 'Observation map',
  'nav.sessions': 'Individual duty sessions',
  'nav.personnel': 'Personnel',
  'nav.evidence': 'Evidence verification',
  'nav.exceptions': 'Exceptions',
  'nav.corrections': 'Corrections',
  'nav.reports': 'Reports',
  'nav.audit': 'Audit history',
  'nav.devices': 'Devices',
  'nav.accounts': 'Login accounts',
  'nav.policy': 'Duty policy & roles',
  'nav.system': 'System status',
  'nav.account': 'Account & sessions',
  'nav.signOut': 'Sign out',
  'nav.menu': 'Menu',
  'nav.notifications': 'Notifications',

  'category.TRAIN_BEAT': 'Train beat',
  'category.STATION_WATCH': 'Station watch',
  'category.VIP_ESCORT': 'VIP escort',
  'category.TRACK_INCIDENT': 'Track incident',

  'status.DRAFT': 'Draft',
  'status.ASSIGNED': 'Assigned',
  'status.ACCEPTED': 'Accepted',
  'status.IN_PROGRESS': 'In progress',
  'status.COMPLETED': 'Completed',
  'status.EXCEPTION_REPORTED': 'Exception reported',
  'status.CANCELLED': 'Cancelled',

  'class.HG': 'HG — Home Guard',
  'class.PC_AR': 'PC — Armed Reserve',
  'class.PC_GENERAL': 'PC — General',
  'class.PC': 'PC — Police Constable',
  'class.HC': 'HC — Head Constable',
  'class.ASI': 'ASI — Assistant Sub-Inspector',
  'class.SI': 'SI — Sub-Inspector',
  'class.CI': 'CI — Circle Inspector',
  'class.DSP': 'DSP — Deputy Superintendent of Police',
  'class.OTHER': 'Other',

  'transition.ASSIGNED': 'Publish to personnel',
  'transition.IN_PROGRESS': 'Mark in progress',
  'transition.COMPLETED': 'Complete duty',
  'transition.EXCEPTION_REPORTED': 'Report exception',
  'transition.CANCELLED': 'Cancel duty',

  'duty.listTitle': 'Duty assignments',
  'duty.listSubtitle':
    'Assignments for the four duty categories within your configured scope. An assignment is a plan — it is never proof that anyone physically attended.',
  'duty.new': 'New duty',
  'duty.reference': 'Reference',
  'duty.category': 'Category',
  'duty.title': 'Title',
  'duty.unit': 'Unit',
  'duty.time': 'Planned time',
  'duty.status': 'Status',
  'duty.personnel': 'Personnel',
  'duty.exceptions': 'Open exceptions',
  'duty.restricted': 'Restricted details',
  'duty.restrictedHint':
    'Sensitive details of this duty are visible only to assigned personnel and users granted “duty.view_restricted”.',
  'duty.empty': 'No duty assignments match these filters.',
  'duty.attendanceDisclaimer':
    'Device-reported start times and check-ins show that an enrolled device responded. They are not, on their own, proof of physical attendance.',

  'roster.title': 'Duty roster',
  'roster.subtitle':
    'Daily, weekly and monthly view of published and draft duties, recorded unavailability and conflicts within your scope.',

  'checkins.title': 'Check-ins & presence',
  'checkins.subtitle':
    'Each check-in is linked to the person and duty. Device clock times and server receipt times are shown separately; location provenance and accuracy are shown as reported.',

  'personnel.title': 'Personnel',
  'personnel.subtitle':
    'Synthetic personnel directory. Rank and personnel classification are separate: Home Guards are a separate category, and AR/General is a constable subtype.',

  'reports.title': 'Reports',
  'reports.subtitle': 'Exports are generated from stored records within your scope. Every export is audited with its SHA-256.',

  'exceptions.title': 'Exceptions',
  'exceptions.subtitle':
    'Missed or late check-ins, delayed reporting, overdue duties, synchronisation failures, evidence-verification failures and assignment conflicts. Exceptions prompt review; they are never classified as misconduct automatically.',

  'corrections.title': 'Audited corrections',
  'corrections.subtitle':
    'Historical attendance, check-in and evidence records are never overwritten. A correction records the original value, the proposed value, the reason, the requester and the approval decision.',

  'account.title': 'Account & sessions',
  'policy.title': 'Duty policy & roles',
  'policy.subtitle':
    'Prototype defaults only — every rule below is configurable and must be validated by the department before any operational use.',
  'system.title': 'System status',
  'my.title': 'My duties',

  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.reason': 'Reason',
  'common.loading': 'Loading…',
  'common.filters': 'Filters',
  'common.all': 'All',
  'common.from': 'From',
  'common.to': 'To',
  'common.search': 'Search',
  'common.download': 'Download',
} as const;

export type MessageKey = keyof typeof en;
