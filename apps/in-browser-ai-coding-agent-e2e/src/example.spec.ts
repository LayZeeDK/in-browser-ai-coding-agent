import { test as base, expect } from '@playwright/test';
import { test as aiTest, expect as aiExpect } from './fixtures';

base('has title', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'in-browser-ai-coding-agent',
  );
});

base('displays model availability status', async ({ page }) => {
  await page.goto('/');

  const statusEl = page.getByTestId('status-result');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });
  await expect(statusEl).toHaveAttribute(
    'data-status',
    /^(available|downloadable|unavailable)$/,
  );
});

aiTest('responds to a prompt', async ({ persistentPage: page }) => {
  await page.goto('http://localhost:4200/');

  const statusEl = page.getByTestId('status-result');
  await aiExpect(statusEl).toBeVisible({ timeout: 10_000 });

  // If model is downloadable, trigger download via button click (user gesture)
  const status = await statusEl.getAttribute('data-status');

  if (status === 'downloadable') {
    await page.getByTestId('download-button').click();
    await aiExpect(statusEl).toHaveAttribute('data-status', 'available', {
      timeout: 300_000,
    });
  }

  // Submit a prompt
  await page.getByTestId('prompt-input').fill('Hi!');
  await page.getByTestId('prompt-submit').click();

  // Assert response appears and no error
  const responseEl = page.getByTestId('prompt-response');
  await aiExpect(responseEl).toBeVisible({ timeout: 60_000 });
  await aiExpect(responseEl).not.toBeEmpty();
  await aiExpect(page.getByTestId('prompt-error')).not.toBeVisible();
});
