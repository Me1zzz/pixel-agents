import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  LAYOUT_FILE_DIR,
  LAYOUT_FILE_NAME,
  OFFICE_META_FILE_NAME,
  OFFICE_STORAGE_DIR_NAME,
} from '../constants.js';

const OFFICE_SEATS_FILE_NAME = 'seats.json';

function getOfficeStorageRootPath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, OFFICE_STORAGE_DIR_NAME);
}

export function getOfficeDirectoryPath(storageId: string): string {
  return path.join(getOfficeStorageRootPath(), storageId);
}

export function getOfficeLayoutFilePath(storageId: string): string {
  return path.join(getOfficeDirectoryPath(storageId), LAYOUT_FILE_NAME);
}

export function getOfficeMetaFilePath(storageId: string): string {
  return path.join(getOfficeDirectoryPath(storageId), OFFICE_META_FILE_NAME);
}

export function writeOfficeJson<T extends object>(
  storageId: string,
  fileName: string,
  value: T,
): void {
  const filePath = path.join(getOfficeDirectoryPath(storageId), fileName);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function readOfficeJson<T extends object = Record<string, unknown>>(
  storageId: string,
  fileName: string,
): T | null {
  const filePath = path.join(getOfficeDirectoryPath(storageId), fileName);

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error('[Pixel Agents] Failed to read office file:', err);
    return null;
  }
}

export function writeOfficeLayoutToFile(storageId: string, layout: Record<string, unknown>): void {
  writeOfficeJson(storageId, LAYOUT_FILE_NAME, layout);
}

export function readOfficeLayoutFromFile(storageId: string): Record<string, unknown> | null {
  return readOfficeJson(storageId, LAYOUT_FILE_NAME);
}

export function writeOfficeSeatsToFile(storageId: string, seats: Record<string, unknown>): void {
  writeOfficeJson(storageId, OFFICE_SEATS_FILE_NAME, seats);
}

export function readOfficeSeatsFromFile(storageId: string): Record<string, unknown> {
  return readOfficeJson<Record<string, unknown>>(storageId, OFFICE_SEATS_FILE_NAME) ?? {};
}
