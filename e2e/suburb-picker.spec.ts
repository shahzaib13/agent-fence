import { expect, test, type Page } from '@playwright/test'

// The picker talks to Google through the Maps JS SDK, so what gets faked here is the SDK
// itself — installed before any app code runs, which also stops the real script being fetched.
// Every request the app makes lands in `window.__placesCalls` for the assertions below.
async function stubGoogleSdk(page: Page) {
  await page.addInitScript(() => {
    const scope = window as unknown as Record<string, unknown>
    const calls: unknown[] = []
    scope.__placesCalls = calls
    scope.__noResults = false

    const prediction = (main: string, id: string) => ({
      place_id: id,
      description: `${main} VIC, Australia`,
      structured_formatting: { main_text: main, secondary_text: 'VIC, Australia' },
    })

    const details = {
      place_id: 'ChIJxUv0xoYb1moRsOCMIXVWBAU',
      name: 'Pakenham',
      types: ['locality', 'political'],
      formatted_address: 'Pakenham VIC 3810, Australia',
      geometry: { location: { lat: () => -38.0776708, lng: () => 145.4818724 } },
      address_components: [
        { long_name: 'Pakenham', short_name: 'Pakenham', types: ['locality', 'political'] },
        { long_name: 'Victoria', short_name: 'VIC', types: ['administrative_area_level_1'] },
        { long_name: '3810', short_name: '3810', types: ['postal_code'] },
      ],
    }

    scope.google = {
      maps: {
        places: {
          AutocompleteService: class {
            getPlacePredictions(request: Record<string, unknown>, callback: (r: unknown[], s: string) => void) {
              calls.push({ kind: 'autocomplete', ...request })
              if (scope.__noResults) callback([], 'ZERO_RESULTS')
              else callback([prediction('Pakenham', 'p1'), prediction('Pakenham Upper', 'p2')], 'OK')
            }
          },
          PlacesService: class {
            getDetails(request: Record<string, unknown>, callback: (r: unknown, s: string) => void) {
              calls.push({ kind: 'details', ...request })
              callback(details, 'OK')
            }
          },
          AutocompleteSessionToken: class {},
          PlacesServiceStatus: { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS' },
        },
      },
    }
  })
}

const placesCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __placesCalls: Record<string, unknown>[] }).__placesCalls)

async function startAtSuburbQuestion(page: Page) {
  await stubGoogleSdk(page)

  const chatBodies: string[] = []
  let call = 0
  await page.route('**/fencing-chat-api', async (route) => {
    call += 1
    chatBodies.push(route.request().postData() ?? '')
    await route.fulfill({
      json: {
        sessionId: 'e2e',
        type: 'question',
        message: call === 1 ? 'Which suburb is the fence going in?' : 'What type of fence are you after?',
        options: call === 1 ? [] : [{ label: 'Colorbond', value: 'Colorbond' }],
        results: [],
        avgRatePerMeter: null,
        expects: call === 1 ? 'suburb' : undefined,
        checklist: { suburb: call === 1 ? null : 'Pakenham, VIC 3810', fenceType: null },
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('I need a fence, about 20 metres')
  await page.getByRole('button', { name: /start analysis/i }).click()
  await expect(page.getByText(/which suburb is the fence going in/i)).toBeVisible({ timeout: 15000 })

  return { chatBodies }
}

test('picks a suburb from Google and sends the whole place with it', async ({ page }) => {
  const { chatBodies } = await startAtSuburbQuestion(page)

  await page.getByRole('combobox').fill('pakenh')
  await expect(page.getByRole('option')).toHaveCount(2)
  // Suggestions carry no postcode — that only exists after the details call
  await expect(page.getByRole('option').first()).toContainText('VIC, Australia')

  await page.getByRole('option').first().click()

  // Twice over: the collapsed answer in the thread, and the brief sidebar
  await expect(page.getByText('Suburb: Pakenham, VIC 3810')).toHaveCount(2)
  await expect(page.getByRole('combobox')).toBeHidden()
  await expect(page.getByText(/what type of fence are you after/i)).toBeVisible()

  // Australia-only, suburbs-only, and one session across both calls
  const calls = await placesCalls(page)
  const autocomplete = calls.find((c) => c.kind === 'autocomplete')
  const lookup = calls.find((c) => c.kind === 'details')
  expect(autocomplete).toMatchObject({ componentRestrictions: { country: 'au' }, types: ['(regions)'] })
  expect(lookup?.sessionToken).toEqual(autocomplete?.sessionToken)

  const answer = JSON.parse(chatBodies[1])
  expect(answer.message).toBe('Pakenham, VIC 3810')
  expect(JSON.parse(answer.place)).toMatchObject({
    postcode: '3810',
    state: 'VIC',
    placeId: 'ChIJxUv0xoYb1moRsOCMIXVWBAU',
  })
})

test('looks a typed suburb up instead of sending it, and offers it back to confirm', async ({ page }) => {
  const { chatBodies } = await startAtSuburbQuestion(page)

  await page.getByLabel(/your reply/i).fill('pakenham')
  await page.keyboard.press('Enter')

  await expect(page.getByText(/which one is yours/i)).toBeVisible()
  // Still one workflow call — the typed text was a lookup, not an answer
  expect(chatBodies).toHaveLength(1)

  await page.getByRole('option').first().click()
  // Twice over: the collapsed answer in the thread, and the brief sidebar
  await expect(page.getByText('Suburb: Pakenham, VIC 3810')).toHaveCount(2)
  expect(chatBodies).toHaveLength(2)
})

test('says nothing matched rather than sending a suburb that does not exist', async ({ page }) => {
  await startAtSuburbQuestion(page)
  await page.evaluate(() => {
    ;(window as unknown as { __noResults: boolean }).__noResults = true
  })

  await page.getByRole('combobox').fill('zzzzzz')
  await expect(page.getByText(/no australian suburb matches that/i)).toBeVisible()
})
