import { test, expect } from './fixtures';

test('has title', async ({ persistentPage: page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'in-browser-ai-coding-agent',
  );
});

test('displays model availability status', async ({ persistentPage: page }) => {
  await page.goto('/');

  const statusEl = page.getByTestId('status-result');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });
  await expect(statusEl).toHaveAttribute(
    'data-status',
    /^(available|downloading|downloadable|unavailable)$/,
  );
});
