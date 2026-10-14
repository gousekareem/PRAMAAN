import { useMemo, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { api, qs } from '../services/api';
import type { FreshnessLabel, Observation } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { ObservationMap } from '../map/ObservationMap';
import { Card, KV, PageHeader, TimeText, relativeAge } from '../components/ui/Misc';
import { ErrorState, LoadingState, EmptyState } from '../components/ui/States';
import {
  DemoBadge,
  FreshnessBadge,
  StatusBadge,
  freshnessColor,
  freshnessText,
} from '../components/ui/Badges';

export function MapPage() {
  const [hours, setHours] = useState(24);
  const [zoneId, setZoneId] = useState('');
  const [status, setStatus] = useState<'' | FreshnessLabel>('');
  const [spatial, setSpatial] = useState('');
  const [selected, setSelected] = useState<Observation | null>(null);
  const zones = useApi(() => api<FeatureCollection>('/api/v1/zones'), []);
  const obs = useApi(
    () =>
      api<{ items: Observation[]; generatedAt: string }>(
        `/api/v1/dashboard/observations${qs({ sinceHours: hours, zoneId })}`,
      ),
    [hours, zoneId],
  );
  useRefreshOnChange(obs.reload);
  const items = useMemo(
    () =>
      (obs.data?.items ?? []).filter(
        (o) =>
          (!status || o.freshness.label === status) && (!spatial || o.spatialResult === spatial),
      ),
    [obs.data, status, spatial],
  );
  const zoneOptions = (zones.data?.features ?? []).map(
    (f) => f.properties as { id: string; name: string },
  );

  return (
    <>
      <PageHeader
        title="Map"
        subtitle="Last known observation per officer. Markers show when the location was recorded and received — they are not real-time tracking. Circles show reported GPS accuracy."
      />
      <div
        className="mb-3 flex flex-wrap items-end gap-3 text-sm"
        role="group"
        aria-label="Map filters"
      >
        <label className="flex flex-col">
          Time window
          <select
            className="input mt-1"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value={1}>Last hour</option>
            <option value={8}>Last 8 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
        </label>
        <label className="flex flex-col">
          Zone
          <select className="input mt-1" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">All zones</option>
            {zoneOptions.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Observation status
          <select
            className="input mt-1"
            value={status}
            onChange={(e) => setStatus(e.target.value as FreshnessLabel | '')}
          >
            <option value="">Any</option>
            {(Object.keys(freshnessText) as FreshnessLabel[]).map((k) => (
              <option key={k} value={k}>
                {freshnessText[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Spatial check
          <select
            className="input mt-1"
            value={spatial}
            onChange={(e) => setSpatial(e.target.value)}
          >
            <option value="">Any</option>
            <option value="INSIDE_ASSIGNED_ZONE">Inside assigned zone</option>
            <option value="OUTSIDE_WITHIN_ACCURACY">Boundary (within accuracy)</option>
            <option value="OUTSIDE_ASSIGNED_ZONE">Outside assigned zone</option>
            <option value="NO_ASSIGNED_ZONE">No assigned zone</option>
          </select>
        </label>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs" aria-label="Legend">
          {(Object.keys(freshnessText) as FreshnessLabel[]).map((k) => (
            <li key={k} className="flex items-center gap-1">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: freshnessColor[k] }}
                aria-hidden
              />
              {freshnessText[k]}
            </li>
          ))}
        </ul>
      </div>
      {obs.error ? <ErrorState error={obs.error} onRetry={obs.reload} /> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div>
          {obs.loading && !obs.data ? (
            <LoadingState />
          ) : (
            <ObservationMap observations={items} zones={zones.data} onSelect={setSelected} />
          )}
          {obs.data && items.length === 0 && (
            <div className="mt-3">
              <EmptyState
                title="No observations in this window"
                hint="Offline devices appear after they synchronise."
              />
            </div>
          )}
        </div>
        <Card title="Observation details">
          {!selected ? (
            <p className="text-sm text-ink-700">Select a marker to inspect the observation.</p>
          ) : (
            <dl>
              <KV stacked k="Officer">
                {selected.officerName} <DemoBadge show={selected.isDemo} />
              </KV>
              <KV stacked k="Status">
                <FreshnessBadge label={selected.freshness.label} />
              </KV>
              <KV stacked k="Recorded">
                {relativeAge(selected.freshness.ageMs)}
              </KV>
              <KV stacked k="Device time">
                <TimeText iso={selected.recordedDeviceTime} source="device" />
              </KV>
              <KV stacked k="Trusted estimate">
                <TimeText iso={selected.trustedTimeEstimate} source="trusted-estimate" />
              </KV>
              <KV stacked k="Server receipt">
                <TimeText iso={selected.serverReceivedAt} source="server" />
              </KV>
              <KV stacked k="Coordinates">
                <span className="font-mono text-xs">
                  {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
                </span>
              </KV>
              <KV stacked k="Accuracy">
                {selected.horizontalAccuracyM === null
                  ? 'Location accuracy unavailable'
                  : `±${selected.horizontalAccuracyM.toFixed(1)} m`}
              </KV>
              <KV stacked k="Spatial check">
                <StatusBadge value={selected.spatialResult} />
              </KV>
              <KV stacked k="Mock indicator (client)">
                {selected.mockIndicator === null
                  ? 'Not reported'
                  : selected.mockIndicator
                    ? 'Reported as mock — review'
                    : 'Not mock (client-reported)'}
              </KV>
              <KV stacked k="Event">
                {selected.eventType}
              </KV>
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}
