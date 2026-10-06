import React, { useState } from 'react';
import { Alert } from 'react-native';
import { Download } from 'lucide-react-native';
import { Button } from './ui';
import { tokens } from '../theme/tokens';
import { saveDocument } from '../lib/download';

/**
 * "Download" for anything an administrator verifies (owner, 1 Oct 2026).
 * Photos go straight to the gallery (a "Quick Bites" album); anything else
 * asks for a folder once.
 */
export const DownloadButton: React.FC<{
  source?: string | null;
  name: string;
  label?: string;
  full?: boolean;
  /** For a file that needs the admin's sign-in, such as a statement PDF. */
  headers?: Record<string, string>;
}> = ({ source, name, label = 'Download', full, headers }) => {
  const [busy, setBusy] = useState(false);
  if (!source) return null;
  return (
    <Button
      label={label}
      variant="secondary"
      size="sm"
      full={full}
      loading={busy}
      icon={<Download size={14} color={tokens.colors.text.primary} />}
      onPress={async () => {
        setBusy(true);
        try {
          const saved = await saveDocument(source, name, headers);
          Alert.alert('Saved', saved);
        } catch (err: any) {
          Alert.alert('Not saved', err?.message || 'The file could not be saved.');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
};
