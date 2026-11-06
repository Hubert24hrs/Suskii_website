import { expect, test, type Page } from '@playwright/test';

const EMAIL = 'owner@suskii.test';
const PASSWORD = 'E2e-Strong-Passphrase-42';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/overview/);
}

test('protected admin routes redirect to the sign-in page', async ({ page }) => {
    await page.goto('/admin/overview');
    await expect(page).toHaveURL(/\/admin\/login/);
    const res = await page.request.get('/api/overview');
    expect(res.status()).toBe(401);
});

test('first administrator is created with the one-time setup token', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByRole('link', { name: 'Continue to setup' }).click();
    await page.getByLabel('Setup token').fill(process.env.E2E_BOOTSTRAP_TOKEN!);
    await page.getByLabel('Your name').fill('Owner');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create Super Admin' }).click();
    await expect(page).toHaveURL(/\/admin\/account/);
    await expect(page.getByText('please turn on two-factor authentication')).toBeVisible();
    // Setup cannot be used again.
    const again = await page.request.post('/api/setup', { data: { token: process.env.E2E_BOOTSTRAP_TOKEN, email: 'x@y.test', name: 'X', password: PASSWORD } });
    expect(again.status()).toBe(403);
});

test('wrong password shows a generic error', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
});

test('overview shows honest empty states until a platform is connected', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('No platform data yet')).toBeVisible();
    await expect(page.getByText('DEMO MODE')).toHaveCount(0);
    for (const label of ['Platform Management', 'Transactions', 'Corporate CMS', 'Integrations', 'Audit Logs']) {
        await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: label })).toBeVisible();
    }
});

test('demo mode is labelled everywhere it appears', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/integrations?platform=marketplace&tab=config');
    await page.locator('main select').first().selectOption('demo');
    await page.getByRole('button', { name: 'Save configuration' }).click();
    await page.getByRole('button', { name: 'Use demo mode' }).click();
    await expect(page.locator('.adm-state--demo').first()).toBeVisible();
    await page.goto('/admin/overview');
    await expect(page.locator('.adm-banner--demo')).toContainText('synthetic');
    await page.goto('/admin/orders');
    await expect(page.locator('.adm-banner--demo')).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toContainText('DEMO-');
});

test('publishing in the CMS updates the public page; drafts stay private', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/cms');
    await page.locator('.adm-entry-list button', { hasText: 'Hero' }).click();
    const badge = page.getByLabel('Badge text');
    await badge.fill('Published from the e2e test');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('.adm-step.is-current')).toHaveText('Draft');

    const home = await page.request.get('/');
    expect(await home.text()).not.toContain('Published from the e2e test');

    await page.getByRole('button', { name: 'Approve & publish' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.locator('.adm-step.is-current')).toHaveText('Published');

    await page.goto('/');
    await expect(page.locator('.hero')).toContainText('Published from the e2e test');
    // URLs and SEO are unchanged.
    await expect(page).toHaveTitle(/SUSKII/);
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://suskii-website.vercel.app/');
});

test('the public contact form delivers an inquiry to the admin', async ({ page }) => {
    await page.goto('/#contact');
    const form = page.locator('[data-contact-form]');
    await form.getByLabel('Name').fill('E2E Visitor');
    await form.getByLabel('Email').fill('visitor@example.test');
    await form.getByLabel('Message').fill('Hello from the end-to-end test.');
    await form.getByRole('button', { name: 'Send message' }).click();
    await expect(form.locator('.contact-form__status')).toContainText('Thank you');
    await signIn(page);
    await page.goto('/admin/inquiries');
    await expect(page.getByRole('cell', { name: 'E2E Visitor' })).toBeVisible();
});

test('signing out ends the session', async ({ page }) => {
    await signIn(page);
    await page.locator('.adm-profile').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});
