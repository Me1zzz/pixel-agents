import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN } from '../src/constants.ts';
import { defaultZoom } from '../src/office/toolUtils.ts';

test('defaultZoom falls back safely when window is unavailable', () => {
  const expected = Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR));
  assert.equal(defaultZoom(), expected);
});
