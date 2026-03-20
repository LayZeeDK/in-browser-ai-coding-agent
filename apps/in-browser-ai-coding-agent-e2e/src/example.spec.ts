import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'in-browser-ai-coding-agent',
  );
});

test('displays model availability status', async ({ page }) => {
  await page.goto('/');

  const statusEl = page.getByTestId('status-result');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });
  await expect(statusEl).toHaveAttribute(
    'data-status',
    /^(available|downloadable|unavailable)$/,
  );
});

test('responds to a prompt', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('prompt-input').fill('Hi!');
  await page.getByTestId('prompt-submit').click();

  const responseEl = page.getByTestId('prompt-response');
  await expect(responseEl).toBeVisible({ timeout: 60_000 });
  await expect(responseEl).not.toBeEmpty();
});
