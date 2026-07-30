import { expect, test } from '@playwright/test'

test('describes a fencing job, gets a follow-up question, then sees matched businesses', async ({ page }) => {
  let call = 0

  await page.route('**/webhook/fencing-chat-api', async (route) => {
    call += 1
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (call === 1) {
      await route.fulfill({
        json: {
          sessionId: 'e2e-session',
          type: 'question',
          message: 'Nice one! What height fence are you after?',
          options: [
            { label: '1500mm', value: '1500' },
            { label: '1800mm', value: '1800' },
          ],
          results: [],
          avgRatePerMeter: null,
        },
      })
      return
    }
    await route.fulfill({
      json: {
        sessionId: 'e2e-session',
        type: 'result',
        message: 'Got everything — here is what I found nearby.',
        options: [],
        results: [
          { businessName: 'A Plus Fencing', ratePerMeter: 152, estimatedTotal: 3040, notes: 'standard height 1800mm' },
        ],
        avgRatePerMeter: 152,
      },
    })
  })

  await page.goto('/')

  await expect(page.getByRole('heading', { name: /describe your construction project/i })).toBeVisible()

  await page.getByLabel(/describe your construction project/i).fill('A Colorbond fence in Berwick, about 20 metres')
  await page.getByRole('button', { name: /^fence$/i }).click()
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /analysing your project/i })).toBeVisible()
  await expect(page.getByText(/what height fence are you after/i)).toBeVisible({ timeout: 8000 })

  await page.getByRole('button', { name: '1800mm' }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()

  await expect(page.getByText('A Plus Fencing')).toBeVisible()
  await expect(page.getByRole('button', { name: /view quote/i }).first()).toBeVisible()
})

test('an unrelated description shows the out-of-scope screen without hitting the webhook', async ({ page }) => {
  let webhookCalled = false
  await page.route('**/webhook/fencing-chat-api', async (route) => {
    webhookCalled = true
    await route.fulfill({ json: { sessionId: 'x', type: 'message', message: 'unexpected', options: [], results: [], avgRatePerMeter: null } })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I need a medical report')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /out of scope/i })).toBeVisible()
  expect(webhookCalled).toBe(false)
})

test('other project types show the coming-soon screen without hitting the webhook', async ({ page }) => {
  let webhookCalled = false
  await page.route('**/webhook/fencing-chat-api', async (route) => {
    webhookCalled = true
    await route.fulfill({ json: { sessionId: 'x', type: 'message', message: 'unexpected', options: [], results: [], avgRatePerMeter: null } })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('A 6x4m timber deck')
  await page.getByRole('button', { name: /^deck$/i }).click()
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /deck quotes are in development/i })).toBeVisible()
  expect(webhookCalled).toBe(false)
})
