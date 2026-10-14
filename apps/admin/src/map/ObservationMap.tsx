import { CircleMarker, Circle, GeoJSON, MapContainer, Popup, TileLayer } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import { config } from '../services/config';
import type { Observation } from '../services/types';
import { freshnessColor, freshnessText } from '../components/ui/Badges';
import { formatTime, relativeAge } from '../components/ui/Misc';

export const DEFAULT_CENTER: [number, number] = [16.3008, 80.4505];

export function ObservationMap({
  observations,
  zones,
  onSelect,
}: {
  observations: Observation[];
  zones: FeatureCollection | null;
  onSelect: (o: Observation) => void;
}) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={16}
      scrollWheelZoom
      className="h-[min(70vh,640px)] w-full rounded-lg border border-paper-200"
      aria-label="Map of last known officer observations"
    >
      <TileLayer url={config.tileUrl} attribution={config.tileAttribution} maxZoom={19} />
      {zones && (
        <GeoJSON
          key={zones.features.length}
          data={zones}
          style={() => ({
            color: '#16304a',
            weight: 1.5,
            fillColor: '#2c5a85',
            fillOpacity: 0.08,
            dashArray: '4 3',
          })}
          onEachFeature={(f, layer) =>
            layer.bindTooltip(`${(f.properties as { name: string }).name}`, { sticky: true })
          }
        />
      )}
      {observations.map((o) => (
        <div key={o.eventId}>
          {o.horizontalAccuracyM !== null && (
            <Circle
              center={[o.latitude, o.longitude]}
              radius={o.horizontalAccuracyM}
              pathOptions={{
                color: freshnessColor[o.freshness.label],
                weight: 1,
                fillOpacity: 0.07,
              }}
            />
          )}
          <CircleMarker
            center={[o.latitude, o.longitude]}
            radius={8}
            pathOptions={{
              color: '#fff',
              weight: 2,
              fillColor: freshnessColor[o.freshness.label],
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onSelect(o) }}
          >
            <Popup>
              <div className="text-xs">
                <p className="font-semibold">
                  {o.officerName}
                  {o.isDemo ? ' (DEMO)' : ''}
                </p>
                <p>
                  {freshnessText[o.freshness.label]} — recorded {relativeAge(o.freshness.ageMs)}
                </p>
                <p>Device time: {formatTime(o.recordedDeviceTime)}</p>
                <p>Server receipt: {formatTime(o.serverReceivedAt)}</p>
                <p>
                  Accuracy:{' '}
                  {o.horizontalAccuracyM === null
                    ? 'Location accuracy unavailable'
                    : `±${Math.round(o.horizontalAccuracyM)} m`}
                </p>
              </div>
            </Popup>
          </CircleMarker>
        </div>
      ))}
    </MapContainer>
  );
}
