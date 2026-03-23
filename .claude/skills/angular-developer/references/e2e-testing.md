# End-to-End (E2E) Testing

E2E tests simulate real user interactions in a full browser to verify that your application works correctly from the user's perspective.

## Choosing a Framework

Angular CLI supports multiple E2E frameworks. When you run `ng e2e` for the first time, the CLI prompts you to install one.

- **Playwright** (recommended): The Angular CLI default since v17. Fast, reliable, cross-browser.
- **Cypress**: Popular alternative with an interactive test runner and time-travel debugging.

## Setting Up Playwright

```bash
ng e2e
# CLI prompts: "Would you like to add Playwright?" → Yes
```

This installs `@playwright/test` and creates a default configuration. You can also install manually:

```bash
npm init playwright@latest
```

### Configuration

Playwright uses `playwright.config.ts` at the project root:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  baseURL: 'http://localhost:4200',
  webServer: {
    command: 'ng serve',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

### Writing Tests

```ts
// e2e/app.spec.ts
import { test, expect } from '@playwright/test';

test.describe('App', () => {
  test('should display the title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Welcome');
  });

  test('should navigate to about page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/about"]');
    await expect(page).toHaveURL('/about');
    await expect(page.locator('h1')).toContainText('About');
  });
});
```

### Running Tests

```bash
# Run all tests headlessly
npx playwright test

# Run with browser visible
npx playwright test --headed

# Run a specific test file
npx playwright test e2e/app.spec.ts

# Open interactive UI mode
npx playwright test --ui
```

## Setting Up Cypress

```bash
ng add @cypress/schematic
```

### Configuration

Cypress uses `cypress.config.ts` at the project root:

```ts
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
  },
});
```

### Writing Tests

```ts
// cypress/e2e/app.cy.ts
describe('App', () => {
  it('should display the title', () => {
    cy.visit('/');
    cy.get('h1').should('contain.text', 'Welcome');
  });

  it('should navigate to about page', () => {
    cy.visit('/');
    cy.get('a[href="/about"]').click();
    cy.url().should('include', '/about');
    cy.get('h1').should('contain.text', 'About');
  });
});
```

### Running Tests

```bash
# Open interactive Cypress runner
npx cypress open

# Run headlessly (for CI)
npx cypress run
```

## Best Practices

- **Use test IDs for selectors**: Prefer `data-testid` attributes over CSS classes or element structure to make tests resilient to UI changes.
  ```html
  <button data-testid="submit-btn">Submit</button>
  ```
  ```ts
  // Playwright
  await page.getByTestId('submit-btn').click();
  // Cypress
  cy.get('[data-testid="submit-btn"]').click();
  ```
- **Avoid arbitrary waits**: Never use hard-coded timeouts (`cy.wait(1000)` or `page.waitForTimeout(1000)`). Wait for specific elements, network responses, or application state instead.
- **Keep tests independent**: Each test should set up its own state and not depend on the order of execution.
- **Test user-visible behavior**: Focus on what users see and interact with, not implementation details.
- **Use Page Object Model**: For larger test suites, encapsulate page interactions in reusable classes to reduce duplication.
