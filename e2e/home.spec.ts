import { expect, test } from '@playwright/test'

const checklistAfterHeight = {
  suburb: 'Berwick',
  fenceType: 'Colorbond',
  lengthMeters: 20,
  heightMm: 1800,
  removeOldFence: false,
  siteAccess: 'easy',
}

test('describes a fencing job, answers in the thread, confirms the brief, then sees matched businesses', async ({
  page,
}) => {
  let call = 0

  await page.route('**/fencing-chat-api', async (route) => {
    call += 1
    // The final ranking turn is the slow one in reality — give it long enough here that the
    // thinking screen is actually observable rather than a flash.
    await new Promise((resolve) => setTimeout(resolve, call === 3 ? 1500 : 300))
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
          checklist: { ...checklistAfterHeight, heightMm: null },
          checklistComplete: false,
        },
      })
      return
    }
    if (call === 2) {
      await route.fulfill({
        json: {
          sessionId: 'e2e-session',
          type: 'confirmation',
          message: "That's everything I need — does this look right?",
          options: [
            { label: "Yes, that's all correct", value: 'yes' },
            { label: "No, something's wrong", value: 'no' },
          ],
          results: [],
          avgRatePerMeter: null,
          checklist: checklistAfterHeight,
          checklistComplete: false,
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
          { businessName: 'A Plus Fencing', suburb: 'Berwick', ratePerMeter: 152, estimatedTotal: 3040, notes: 'standard height 1800mm' },
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

  // straight into the thread: the typed description is already there, with the reply loading under it
  await expect(page.getByText('A Colorbond fence in Berwick, about 20 metres')).toBeVisible()
  await expect(page.getByRole('status', { name: /waiting for a reply/i })).toBeVisible()

  await expect(page.getByText(/what height fence are you after/i)).toBeVisible({ timeout: 8000 })

  // one click sends — no separate Continue step
  await page.getByRole('button', { name: '1800mm' }).click()

  // the row collapses to the chosen answer, labelled with the field it filled in
  await expect(page.getByRole('button', { name: '1500mm' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Height: 1800mm/ })).toBeVisible({ timeout: 8000 })

  await expect(page.getByText(/does this look right/i)).toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: /yes, that's all correct/i }).click()

  // the thinking screen only runs once, after the brief is confirmed
  await expect(page.getByRole('heading', { name: /analysing your project/i })).toBeVisible()

  // both intents finish on the comparison page — names blurred, no lead time, no proceed button
  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('$152/m rate')).toBeVisible()
  await expect(page.getByText('A Plus Fencing')).toHaveCSS('filter', /blur/)
  await expect(page.getByText(/lead time/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /proceed/i })).toHaveCount(0)
})

test('other project types open the chat and hit the webhook', async ({ page }) => {
  await page.route('**/fencing-chat-api', async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'x',
        type: 'message',
        message: 'What suburb is this in?',
        options: [],
        results: [],
        avgRatePerMeter: null,
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('A 6x4m timber deck')
  await page.getByRole('button', { name: /^deck$/i }).click()
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /deck quotes are in development/i })).toHaveCount(0)
  await expect(page.getByText('A 6x4m timber deck')).toBeVisible()
  await expect(page.getByText(/what suburb is this in/i)).toBeVisible()
})
