import { expect, test } from '@playwright/test'
import { stubClientTrades } from './client-trades'

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

  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
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
          checklistAnswered: [
            { key: 'suburb', title: 'Suburb', value: 'Berwick' },
            { key: 'fenceType', title: 'Fence type', value: 'Colorbond' },
            { key: 'lengthMeters', title: 'Length', value: '20m' },
            { key: 'heightMm', title: 'Height', value: '1800mm' },
          ],
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
        unit: 'm',
      },
    })
  })

  await stubClientTrades(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /describe your construction project/i })).toBeVisible()

  await page.getByLabel(/describe your construction project/i).fill('A Colorbond fence in Berwick, about 20 metres')
  await page.getByRole('button', { name: /^fencing$/i }).click()
  await page.getByRole('button', { name: /start analysis/i }).click()

  // straight into the thread: the typed description is already there, with the reply loading under it
  await expect(page.getByText('A Colorbond fence in Berwick, about 20 metres')).toBeVisible()
  await expect(page.getByRole('status', { name: /waiting for a reply/i })).toBeVisible()

  await expect(page.getByText(/what height fence are you after/i)).toBeVisible({ timeout: 8000 })

  // one click sends — no separate Continue step
  await page.getByRole('button', { name: '1800mm' }).click()

  // the row collapses to the chosen answer, labelled with the field it filled in
  await expect(page.getByRole('button', { name: '1500mm' })).toHaveCount(0)
  await expect(page.getByText('Height: 1800mm')).toBeVisible({ timeout: 8000 })

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

test('the picker shows the published trades from the endpoint', async ({ page }) => {
  await stubClientTrades(page)
  await page.goto('/')

  await expect(page.getByRole('button', { name: /^fencing$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^tiling$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^kitchen fitting$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^retaining wall$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^decking$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^home renovation$/i })).toBeVisible()
})

test('typing a retaining wall quote opens chat without a picker', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-retaining',
        type: 'question',
        trade: 'retaining_wall',
        message: "Who's buying the materials?",
        options: [
          { label: 'They supply the materials', value: 'supply_and_install' },
          { label: "I'm buying the materials", value: 'labour_only' },
        ],
        results: [],
        avgRatePerMeter: null,
        unit: 'm',
        checklistDisplay: {
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
          wallType: { title: 'Wall type', value: 'Concrete sleepers' },
        },
        checklistPending: [
          { key: 'supply', title: 'Who supplies' },
          { key: 'lengthMeters', title: 'Length' },
          { key: 'heightKey', title: 'Height' },
        ],
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I need a retaining wall')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByText(/who's buying the materials/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'They supply the materials' })).toBeVisible()
})

test('other project types open the chat and hit the webhook', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
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
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /deck quotes are in development/i })).toHaveCount(0)
  await expect(page.getByText('A 6x4m timber deck')).toBeVisible()
  await expect(page.getByText(/what suburb is this in/i)).toBeVisible()
})

test('an ambiguous quote gets a fencing/tiling question and tapping tiling continues', async ({ page }) => {
  await stubClientTrades(page)
  let call = 0
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    call += 1
    if (call === 1) {
      await route.fulfill({
        json: {
          sessionId: 'e2e-trade',
          type: 'question',
          trade: null,
          message: 'Are you looking for Fencing or Tiling services?',
          options: [
            { label: 'Fencing', value: 'fencing' },
            { label: 'Tiling', value: 'tiling' },
          ],
          results: [],
          avgRatePerMeter: null,
          checklist: { _ui: { page: 0 } },
        },
      })
      return
    }
    await route.fulfill({
      json: {
        sessionId: 'e2e-trade',
        type: 'question',
        trade: 'tiling',
        message: 'What are you having tiled?',
        options: [
          { label: 'Bathroom', value: 'bathroom' },
          { label: 'Floor only', value: 'floor_only' },
        ],
        results: [],
        avgRatePerMeter: null,
        checklist: { _ui: { page: 0 } },
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('hi, I need a quote')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByText(/fencing or tiling/i)).toBeVisible()
  await page.getByRole('button', { name: 'Tiling' }).click()
  await expect(page.getByText(/what are you having tiled/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bathroom' })).toBeVisible()
})

test('a tiling result prints per square metre, not per metre', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-tiling',
        type: 'result',
        trade: 'tiling',
        message: 'Here is what I found nearby.',
        options: [],
        results: [
          {
            businessName: 'Paky Tiles',
            suburb: 'Berwick, VIC 3806',
            ratePerMeter: 72,
            estimatedTotal: 1440,
            notes: 'incl. GST · You supply the tiles',
          },
        ],
        avgRatePerMeter: 72,
        unit: 'm2',
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I need my bathroom tiled')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('$72/m² rate')).toBeVisible()
  await expect(page.getByText('$72/m rate')).toHaveCount(0)
})

test('a kitchen result is a whole-job price, not per metre', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-kitchen',
        type: 'result',
        trade: 'kitchen',
        message: 'Here is what I found nearby.',
        options: [],
        results: [
          {
            businessName: 'Berwick Kitchens',
            suburb: 'Berwick, VIC 3806',
            ratePerMeter: 15470,
            estimatedTotal: 15470,
            notes: '2-pack, 3.2m run, Caesarstone',
          },
        ],
        avgRatePerMeter: 15470,
        unit: 'item',
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('New kitchen in Berwick')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('$15,470').first()).toBeVisible()
  await expect(page.getByText('2-pack, 3.2m run, Caesarstone')).toBeVisible()
  await expect(page.getByText('$15,470/m rate')).toHaveCount(0)
  await expect(page.getByText('$15470/m rate')).toHaveCount(0)
})

test('a bathroom renovation opens the renovator chat, not tiling', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-reno',
        type: 'question',
        trade: 'home_renovation',
        message: 'Which room is this?',
        options: [
          { label: 'Bathroom', value: 'bathroom' },
          { label: 'Kitchen', value: 'kitchen' },
        ],
        results: [],
        avgRatePerMeter: null,
        unit: 'item',
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I want to renovate my bathroom in Berwick')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByText(/which room is this/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bathroom' })).toBeVisible()
  await expect(page.getByText(/what are you having tiled/i)).toHaveCount(0)
})

test('a home renovation result is a whole-job price with every badge', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-reno-result',
        type: 'result',
        trade: 'home_renovation',
        message: 'Here is what I found nearby.',
        options: [],
        results: [],
        avgRatePerMeter: 18400,
        unit: 'item',
        comparison: {
          potentialSavings: null,
          marketAverage: 18400,
          totalQuotesScreened: 1,
          userExistingPrice: null,
          quotes: [
            {
              businessName: 'Berwick Renovations',
              ratePerMeter: 18400,
              projectTotalMin: 18400,
              projectTotalMax: 18400,
              notes: '',
              badges: [
                'Services Berwick',
                'Floor tiling measured on site, not in this price',
                'Carpentry charged by the hour on site, not in this price',
              ],
              tag: 'BEST_VALUE',
              savingsFromAverage: null,
              unit: 'item',
            },
          ],
        },
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I want to renovate my bathroom in Berwick')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('$18,400').first()).toBeVisible()
  await expect(page.getByText('Floor tiling measured on site, not in this price')).toBeVisible()
  await expect(page.getByText('Carpentry charged by the hour on site, not in this price')).toBeVisible()
  await expect(page.getByText('$18,400/m rate')).toHaveCount(0)
  await expect(page.getByText('$18400/m rate')).toHaveCount(0)
  await expect(page.getByText('$18,400/m² rate')).toHaveCount(0)
})

test('a retaining wall result prints per linear metre, not per square metre', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-retaining-result',
        type: 'result',
        trade: 'retaining_wall',
        message: 'Here is what I found nearby.',
        options: [],
        results: [
          {
            businessName: 'Berwick Retaining Wall',
            suburb: 'Berwick, VIC 3806',
            ratePerMeter: 520,
            estimatedTotal: 11200,
            notes: 'incl. GST · In your suburb · Materials supplied · Old wall removed · Drainage included',
          },
        ],
        avgRatePerMeter: 520,
        unit: 'm',
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I need a retaining wall')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('$520/m rate')).toBeVisible()
  await expect(page.getByText('$520/m² rate')).toHaveCount(0)
})

test('typing a merbau deck opens chat without a picker', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-decking',
        type: 'question',
        trade: 'decking',
        message: 'How high off the ground will the deck sit?',
        options: [
          { label: 'Close to the ground', value: 'low' },
          { label: 'Up high — needs stairs', value: 'high' },
        ],
        results: [],
        avgRatePerMeter: null,
        unit: 'm2',
        checklistDisplay: {
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
        },
        checklistPending: [
          { key: 'deckHeight', title: 'Height' },
          { key: 'material', title: 'Decking' },
          { key: 'areaSqm', title: 'Size' },
        ],
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I need a merbau deck')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByText(/how high off the ground will the deck sit/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Up high — needs stairs' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fencing' })).toHaveCount(0)
})

test('a decking result prints per square metre and keeps the server total', async ({ page }) => {
  await stubClientTrades(page)
  await page.route(/\/api\/v1\/client\/(chat|fencing-chat)/, async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-decking-result',
        type: 'result',
        trade: 'decking',
        message: 'Here is what I found nearby.',
        options: [],
        results: [
          {
            businessName: 'Berwick Decks',
            suburb: 'Berwick, VIC 3806',
            ratePerMeter: 625,
            estimatedTotal: 19815,
            notes: 'incl. GST · 0.7 km away · 4.7★ (220) · Old deck removed · 12m of balustrade included · Stairs included · Includes $450 design',
          },
        ],
        avgRatePerMeter: 625,
        unit: 'm2',
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I need a merbau deck')
  await page.getByRole('button', { name: /start analysis/i }).click()

  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('$625/m² rate')).toBeVisible()
  await expect(page.getByText('$625/m rate')).toHaveCount(0)
  await expect(page.getByText('$19,815').first()).toBeVisible()
  await expect(page.getByText('$18,750')).toHaveCount(0)
})
