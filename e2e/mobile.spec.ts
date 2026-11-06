import { expect, test } from '@playwright/test';

// Runs after admin.spec.ts has created the administrator (same server, workers: 1).
const EMAIL = 'owner@suskii.test';
const PASSWORD = 'E2e-Strong-Passphrase-42';

test('the admin works on a phone: drawer navigation, no horizontal scrolling', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/overview/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Corporate CMS' }).click();
    await expect(page).toHaveURL(/\/admin\/cms/);
    await expect(page.getByRole('heading', { name: 'Corporate CMS' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('the public site still has no horizontal scrolling on a phone', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-contact-form]')).toBeAttached();
});
