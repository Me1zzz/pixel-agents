import { createHash } from 'node:crypto';

export function buildOpenCodeOfficeId(rootSessionId: string): string {
  return `opencode:root:${rootSessionId}`;
}

export function buildOfficeStorageId(providerId: string, rootSessionId: string): string {
  const digest = createHash('sha256')
    .update(`${providerId}:${rootSessionId}`)
    .digest('hex')
    .slice(0, 16);

  return `${providerId}-root-${digest}`;
}

export function canPersistOpenCodeOffice(session: { rootSessionId?: string }): boolean {
  return typeof session.rootSessionId === 'string' && session.rootSessionId.length > 0;
}
