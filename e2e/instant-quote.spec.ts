import { expect, test, type Locator, type Page } from '@playwright/test'

// The checkbox itself is visually hidden behind its styled tick box, so a click lands on the
// label — which is what a real pointer does too, since the whole card is the label.
function pick(dialog: Locator, businessName: string) {
  return dialog.locator('label').filter({ hasText: businessName })
}

// Verification runs on Firebase phone auth, which means a real reCAPTCHA and a real SMS —
// neither belongs in a test run. The dev server hands out modules by path, so the whole OTP
// service is swapped for one that answers locally: same exports, same contract, no network.
// Anything the flow itself gets wrong still fails here; only Google's half is faked.
async function stubOtpService(page: Page) {
  await page.route('**/src/services/otp.ts*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        export const RECAPTCHA_CONTAINER_ID = 'recaptcha-container'
        export const OTP_LENGTH = 6
        export function releaseVerifier() {}
        export async function sendOtp(phoneE164) {
          return { verificationId: 'e2e-verification', phoneE164 }
        }
        export async function verifyOtp(session, code) {
          if (!/^\\d{6}$/.test(code)) throw new Error('That code looks incomplete. Enter all six digits.')
          return 'e2e-uid'
        }
      `,
    }),
  )

  // Verifying also writes the lead into Firestore, and a real database is no more welcome in a
  // test run than a real SMS. The document itself is covered by jobs.test.ts.
  await page.route('**/src/services/jobs.ts*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export async function submitJob() { return 'VI-12345' }`,
    }),
  )

  // The transcript PDF and the hop to the partner site both reach outside the app; neither
  // belongs in a test run, and both are covered by unit tests.
  await page.route('**/src/services/transcript.ts*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: `export async function uploadTranscript() { return null }` }),
  )
  await page.route('**/src/services/handoff.ts*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: `export async function partnerSiteUrl() { return '/' }` }),
  )
}

// Three matches on the first turn, so every test here starts one click away from the
// comparison page rather than replaying the whole conversation.
async function goToResults(page: Page) {
  await stubOtpService(page)
  await page.route('**/fencing-chat-api', async (route) => {
    await route.fulfill({
      json: {
        sessionId: 'e2e-instant-quote',
        type: 'result',
        message: 'Here is what I found nearby.',
        options: [],
        results: [
          { businessName: 'A Plus Fencing', suburb: 'Berwick', ratePerMeter: 152, estimatedTotal: 3040, notes: '1800mm' },
          { businessName: 'Berwick Fence Co', suburb: 'Berwick', ratePerMeter: 168, estimatedTotal: 3360, notes: '1800mm' },
          { businessName: 'Southeast Fencing', suburb: 'Berwick', ratePerMeter: 184, estimatedTotal: 3680, notes: '1800mm' },
        ],
        avgRatePerMeter: 168,
      },
    })
  })

  await page.goto('/')
  await page.getByLabel(/describe your construction project/i).fill('A Colorbond fence in Berwick, about 20 metres')
  await page.getByRole('button', { name: /start analysis/i }).click()
  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible({ timeout: 15000 })
}

test('picks businesses, hands over details, and verifies the phone number', async ({ page }) => {
  await goToResults(page)

  // On the results page the names are still hidden
  await expect(page.getByText('A Plus Fencing')).toHaveCSS('filter', /blur/)

  await page.getByRole('button', { name: /instant quote/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // ...and inside the dialog they are not
  await expect(dialog.getByText('A Plus Fencing')).not.toHaveCSS('filter', /blur\((?!0)/)

  await expect(dialog.getByRole('button', { name: /^continue$/i })).toBeDisabled()
  await pick(dialog, 'A Plus Fencing').click()
  await pick(dialog, 'Southeast Fencing').click()
  await expect(dialog.getByRole('checkbox', { name: /a plus fencing/i })).toBeChecked()
  await dialog.getByRole('button', { name: /continue \(2\)/i }).click()

  await expect(dialog.getByRole('heading', { name: /where should they reach you/i })).toBeVisible()

  // A local number is rewritten to E.164 as soon as the field is left
  await dialog.getByLabel(/phone number/i).fill('0302 944 7610')
  await dialog.getByLabel(/full name/i).click()
  await expect(dialog.getByLabel(/phone number/i)).toHaveValue('+923029447610')

  // Submitting an incomplete form stays put and says what to fix
  await dialog.getByRole('button', { name: /continue/i }).click()
  await expect(dialog.getByText('Enter your full name.')).toBeVisible()

  await dialog.getByLabel(/full name/i).fill('Ayesha Khan')
  await dialog.getByLabel(/email/i).fill('ayesha@example.com')
  await dialog.getByRole('button', { name: /continue/i }).click()

  await expect(dialog.getByRole('heading', { name: /verify your number/i })).toBeVisible()
  await expect(dialog.getByText('+923029447610')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /resend code in \d+s/i })).toBeDisabled()

  // One digit per box, focus following along
  const digits = dialog.getByRole('textbox', { name: /^digit/i })
  await expect(digits).toHaveCount(6)
  await digits.first().click()
  await page.keyboard.type('123456')
  await expect(digits.nth(5)).toHaveValue('6')

  await dialog.getByRole('button', { name: /^verify$/i }).click()
  await expect(dialog.getByRole('heading', { name: /you're all set/i })).toBeVisible({ timeout: 10000 })
  await expect(dialog.getByText('A Plus Fencing')).toBeVisible()
  await expect(dialog.getByText('Southeast Fencing')).toBeVisible()

  await dialog.getByRole('button', { name: /stay here/i }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible()
})

test('cancel and the cross leave the results page exactly where it was', async ({ page }) => {
  await goToResults(page)
  await page.getByRole('button', { name: /instant quote/i }).click()

  const dialog = page.getByRole('dialog')
  await pick(dialog, 'A Plus Fencing').click()
  await dialog.getByRole('button', { name: /cancel/i }).click()

  await expect(dialog).toBeHidden()
  // No navigation, no reload — the comparison is still on screen behind it
  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible()
  await expect(page.getByText('$152/m rate')).toBeVisible()

  // Reopening starts clean, and the cross steps back one screen at a time
  await page.getByRole('button', { name: /instant quote/i }).click()
  await expect(dialog.getByRole('button', { name: /^continue$/i })).toBeDisabled()

  await pick(dialog, 'A Plus Fencing').click()
  await dialog.getByRole('button', { name: /continue/i }).click()
  await expect(dialog.getByRole('heading', { name: /where should they reach you/i })).toBeVisible()

  await dialog.getByRole('button', { name: /go back a step/i }).click()
  await expect(dialog.getByRole('heading', { name: /choose who to contact/i })).toBeVisible()

  await dialog.getByRole('button', { name: /close instant quote/i }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: /your local quote comparison/i })).toBeVisible()

  // Escape exits the same way, and the dialog can still be reopened afterwards
  await page.getByRole('button', { name: /instant quote/i }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: /instant quote/i }).click()
  await expect(dialog).toBeVisible()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the dialog fills the screen and nothing overflows sideways', async ({ page }) => {
    await goToResults(page)
    await page.getByRole('button', { name: /instant quote/i }).click()

    const dialog = page.getByRole('dialog')
    const box = await dialog.boundingBox()
    expect(box?.width).toBeCloseTo(390, 0)

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflows).toBe(false)

    // The footer actions stay reachable without hunting for them
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    await pick(dialog, 'A Plus Fencing').click()
    await expect(dialog.getByRole('button', { name: /continue \(1\)/i })).toBeVisible()
  })
})
