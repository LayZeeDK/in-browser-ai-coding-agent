import { test, expect } from './fixtures';

test('responds to a prompt', async ({ persistentPage: page }) => {
  test.setTimeout(600_000);

  await page.goto('http://localhost:4200/');

  const statusEl = page.getByTestId('status-result');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });

  const status = await statusEl.getAttribute('data-status');

  // If model is downloadable, trigger download via button click (user gesture)
  if (status === 'downloadable') {
    await page.getByTestId('download-button').click();
  }

  // Wait for model to be available (handles downloading and downloadable states)
  if (status !== 'available') {
    await expect(statusEl).toHaveAttribute('data-status', 'available', {
      timeout: 300_000,
    });
  }

  // Submit button should now be enabled
  const submitBtn = page.getByTestId('prompt-submit');
  await expect(submitBtn).toBeEnabled();

  await page.getByTestId('prompt-input').fill('Hi!');
  await submitBtn.click();

  // Wait for either a response or an error to appear
  const errorEl = page.getByTestId('prompt-error');
  const responseEl = page.getByTestId('prompt-response');
  await expect(responseEl.or(errorEl)).toBeVisible({ timeout: 120_000 });

  // Assert it was a response, not an error
  await expect(errorEl).not.toBeVisible();
  await expect(responseEl).not.toBeEmpty();

  const responseText = await responseEl.textContent();
  console.log(`[e2e] Prompt: "Hi!" -> Response: "${responseText?.trim()}"`);
});
