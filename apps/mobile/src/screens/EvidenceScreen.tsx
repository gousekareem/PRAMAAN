import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useServices } from '../app/ServicesContext';
import { Card, Row, styles } from '../components/ui';

export function EvidenceScreen() {
  const s = useServices();
  const [rows, setRows] = useState<Record<string, string | number | null>[]>([]);
  useEffect(() => {
    void s.db
      .execute(
        'SELECT evidence_id, image_sha256, upload_state, upload_attempts, last_error, local_file_deleted, created_at FROM evidence_manifests ORDER BY created_at DESC LIMIT 50',
      )
      .then((r) => setRows(r.rows));
  }, [s]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {rows.length === 0 ? (
        <Text style={styles.p}>No evidence captured on this device.</Text>
      ) : (
        rows.map((r) => (
          <Card key={String(r.evidence_id)}>
            <Row k="Evidence" v={String(r.evidence_id).slice(0, 8)} mono />
            <Row k="SHA-256" v={String(r.image_sha256)} mono />
            <Row k="Upload state" v={String(r.upload_state)} />
            <Row k="Attempts" v={r.upload_attempts} />
            {r.last_error ? <Row k="Last error" v={String(r.last_error)} /> : null}
            <Row
              k="Local file"
              v={
                Number(r.local_file_deleted)
                  ? 'Removed after verified upload + retention'
                  : 'Encrypted on device'
              }
            />
          </Card>
        ))
      )}
    </ScrollView>
  );
}
