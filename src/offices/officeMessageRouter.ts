import { DEFAULT_CLAUDE_OFFICE_ID } from '../constants.js';
import type { OfficeDescriptor } from './officeTypes.js';

interface MessageTarget {
  postMessage(message: unknown): void;
}

type OfficeScopedPayload = Record<string, unknown> & {
  type: string;
};

export function postOfficesLoaded(
  webview: MessageTarget | undefined,
  offices: OfficeDescriptor[],
): void {
  webview?.postMessage({
    type: 'officesLoaded',
    offices,
  });
}

export function postOfficeScoped(
  webview: MessageTarget | undefined,
  officeId: string,
  payload: OfficeScopedPayload,
): void {
  if (!webview) {
    return;
  }

  if (officeId === DEFAULT_CLAUDE_OFFICE_ID) {
    webview.postMessage(payload);
    return;
  }

  webview.postMessage({
    ...payload,
    officeId,
  });
}

export function postOfficeLayoutLoaded(
  webview: MessageTarget | undefined,
  officeId: string,
  layout: Record<string, unknown> | null,
): void {
  postOfficeScoped(webview, officeId, {
    type: 'layoutLoaded',
    layout,
  });
}

export function postOfficeExistingAgents(
  webview: MessageTarget | undefined,
  officeId: string,
  agents: number[] = [],
): void {
  postOfficeScoped(webview, officeId, {
    type: 'existingAgents',
    agents,
    agentMeta: {},
    folderNames: {},
    externalAgents: {},
  });
}
