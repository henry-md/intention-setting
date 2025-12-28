/**
 * Type definition used by Groups.tsx and GroupEdit.tsx.
 * Defines the structure for group objects stored in Firestore.
 */
export interface Group {
  id: string;
  name: string;
  // Items can be URLs (strings) or other group IDs (strings starting with 'group:')
  items: string[];
  createdAt: string;
}
