import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { launchVSCode, waitForWorkbench } from '../helpers/launch';
import {
  getPixelAgentsFrame,
  listOfficeTitles,
  openPixelAgentsPanel,
  readVisibleToolbarButtonLabels,
  selectOfficeByTitle,
} from '../helpers/webview';

test('startup adopts OpenCode root sessions as separate offices and keeps child sessions inside the parent office', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title, {
    openCodeSessionList: [
      {
        id: 'root-session-alpha',
        title: 'OpenCode Alpha',
        directory: '/repo/alpha',
        updated: 200,
      },
      {
        id: 'child-session-alpha',
        title: 'OpenCode Alpha Child',
        directory: '/repo/alpha/packages/child',
        updated: 250,
        parentId: 'root-session-alpha',
      },
      {
        id: 'root-session-beta',
        title: 'OpenCode Beta',
        directory: '/repo/beta',
        updated: 300,
      },
    ],
    openCodeRuntimeSessionIds: ['root-session-alpha', 'root-session-beta'],
  });
  const { window, openCodeMockLogFile } = session;
  const runVideo = window.video();

  test.setTimeout(120_000);

  try {
    await waitForWorkbench(window);
    await openPixelAgentsPanel(window);

    const frame = await getPixelAgentsFrame(window);

    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(openCodeMockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        {
          message: `Expected mock opencode to launch a long-lived runtime process at ${openCodeMockLogFile}`,
          timeout: 15_000,
          intervals: [500, 1000],
        },
      )
      .toContain('mock-runtime');

    await expect
      .poll(async () => listOfficeTitles(frame), {
        message: 'Expected OpenCode root offices to appear in the office picker on startup',
        timeout: 20_000,
        intervals: [500, 1000, 3000],
      })
      .toEqual(expect.arrayContaining(['Claude', 'OpenCode Alpha', 'OpenCode Beta']));

    const officeTitles = await listOfficeTitles(frame);
    expect(officeTitles).not.toContain('OpenCode Alpha Child');

    expect(await readVisibleToolbarButtonLabels(frame)).toEqual(
      expect.arrayContaining(['Claude', '+ Agent', 'Layout', 'Settings']),
    );

    await selectOfficeByTitle(frame, 'OpenCode Alpha');

    await expect(frame.locator('canvas')).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(async () => readVisibleToolbarButtonLabels(frame), {
        message:
          'Expected OpenCode Alpha to finish hydrating into a rendered office view after the loading shell',
        timeout: 20_000,
        intervals: [250, 500, 1000],
      })
      .toEqual(expect.arrayContaining(['OpenCode Alpha', '+ Agent', 'Layout', 'Settings']));

    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(openCodeMockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        {
          message: `Expected mock opencode invocations at ${openCodeMockLogFile}`,
          timeout: 15_000,
          intervals: [500, 1000],
        },
      )
      .toContain('session list --format json');
  } finally {
    const screenshotPath = path.join(
      __dirname,
      '../../test-results/e2e',
      `opencode-offices-final-${Date.now()}.png`,
    );
    try {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await window.screenshot({ path: screenshotPath });
      await testInfo.attach('final-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } catch {
      // screenshot failure is non-fatal
    }

    await session.cleanup();

    if (runVideo) {
      try {
        const videoPath = testInfo.outputPath('run-video.webm');
        await runVideo.saveAs(videoPath);
        await testInfo.attach('run-video', {
          path: videoPath,
          contentType: 'video/webm',
        });
      } catch {
        // video attachment failure is non-fatal
      }
    }
  }
});
