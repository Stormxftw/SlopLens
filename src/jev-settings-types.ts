export interface JevSettings {
  configured: boolean;
  source: 'encrypted-file' | 'environment' | 'env-file' | 'none';
  canStore: boolean;
  hasSavedKey: boolean;
  storagePath: string;
  problem: string | null;
}
