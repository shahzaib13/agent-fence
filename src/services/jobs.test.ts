import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitJob, type JobLead } from './jobs'
import type { SuburbPlace } from './places'

const set = vi.fn()
const commit = vi.fn(async () => {})
/** Which document paths Firestore already holds — drives both the user and job-id checks. */
const exists = vi.fn((_path: string) => false)

vi.mock('./firebase', () => ({ getDb: async () => ({ db: true }) }))
vi.mock('geofire-common', () => ({ geohashForLocation: () => 'r1prqs0tmr' }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/'), id: path[path.length - 1] }),
  GeoPoint: class {
    latitude: number
    longitude: number
    constructor(latitude: number, longitude: number) {
      this.latitude = latitude
      this.longitude = longitude
    }
  },
  getDoc: async (ref: { path: string }) => ({ exists: () => exists(ref.path) }),
  serverTimestamp: () => 'SERVER_TS',
  writeBatch: () => ({ set, commit }),
}))

const place: SuburbPlace = {
  suburb: 'Pakenham',
  state: 'VIC',
  stateFullName: 'Victoria',
  postcode: '3810',
  country: 'AU',
  countryName: 'Australia',
  displayLabel: 'Pakenham, VIC 3810',
  formattedAddress: 'Pakenham VIC 3810',
  latitude: -38.0776708,
  longitude: 145.4818724,
  placeId: 'ChIJxUv0xoYb1moRsOCMIXVWBAU',
  placeTypes: ['locality', 'political'],
  name: 'Pakenham',
}

const lead: JobLead = {
  fullName: 'Ayesha Khan',
  email: 'ayesha@example.com',
  phoneE164: '+923029447610',
  uid: 'ZbGw9Pj0oENFJtoQHKUUQdiWECj1',
  place,
  businesses: [
    { id: 'biz-1', autoAcceptsAi: false },
    { id: 'biz-2', autoAcceptsAi: true },
  ],
  sessionId: 'sess-1',
  aiChatPdfUrl: 'https://storage/ai-conversation.pdf',
}

/** The document written into that collection — path and data. */
function written(collectionName: string) {
  const call = set.mock.calls.find(([ref]) => String(ref.path).startsWith(collectionName))
  if (!call) throw new Error(`nothing was written to ${collectionName}`)
  return { path: String(call[0].path), data: call[1] as Record<string, unknown> }
}

const locationDataOf = (collectionName: string) => written(collectionName).data.locationData as Record<string, unknown>

describe('submitJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exists.mockReturnValue(false)
  })

  it('writes the job and the customer in one batch', async () => {
    await submitJob(lead)

    // job + user + one copy per picked business
    expect(set).toHaveBeenCalledTimes(4)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('keys the customer by phone number, not by uid — as every existing record does', async () => {
    await submitJob(lead)
    const user = written('users')

    expect(user.path).toBe('users/923029447610')
    // The uid is a field on that document, not its id
    expect(user.data).toMatchObject({ type: 'user', uid: lead.uid, phone: '923029447610', phoneNormalized: '923029447610' })
  })

  it('stores the phone without its leading +, the way the web form does', async () => {
    await submitJob(lead)

    expect(written('jobs').data).toMatchObject({ phone: '923029447610', userId: '923029447610' })
  })

  it('builds a job document the existing app can read', async () => {
    await submitJob(lead)
    const job = written('jobs').data

    expect(job).toMatchObject({
      type: 'job',
      status: 'open',
      jobType: 'fencing',
      category: 'Fencing',
      title: 'Fence Installation',
      source: 'ai_agent',
      uid: lead.uid,
      fullName: 'Ayesha Khan',
      email: 'ayesha@example.com',
      location: 'Pakenham, VIC 3810',
      matchedBusinessIds: ['biz-1', 'biz-2'],
      photoCount: 0,
      createdAt: 'SERVER_TS',
      updatedAt: 'SERVER_TS',
    })
  })

  it('gives the job the geo types the businesses\' nearby search needs', async () => {
    await submitJob(lead)
    const locationData = locationDataOf('jobs')

    expect(locationData).toMatchObject({ geohash: 'r1prqs0tmr', suburb: 'Pakenham', country: 'AU', postcode: '3810' })
    expect(locationData.geopoint).toMatchObject({ latitude: place.latitude, longitude: place.longitude })
  })

  it('leaves geo types off the customer record, which never carried them', async () => {
    await submitJob(lead)
    const locationData = locationDataOf('users')

    expect(locationData.geopoint).toBeUndefined()
    expect(locationData.geohash).toBeUndefined()
    expect(locationData).toMatchObject({ suburb: 'Pakenham', stateFullName: 'Victoria' })
  })

  it('drops a copy into each picked business, accepted only where the AI toggle is on', async () => {
    await submitJob(lead)

    const waiting = written('businesses/biz-1')
    expect(waiting.path).toMatch(/^businesses\/biz-1\/incoming_jobs\/VI-\d{5}$/)
    expect(waiting.data).toMatchObject({ businessId: 'biz-1', status: 'open' })
    expect(waiting.data).not.toHaveProperty('autoAccepted')

    const accepted = written('businesses/biz-2')
    expect(accepted.path).toMatch(/^businesses\/biz-2\/accepted_jobs\/VI-\d{5}$/)
    expect(accepted.data).toMatchObject({ businessId: 'biz-2', status: 'accepted', autoAccepted: true })
  })

  it('gives the business the whole job, not a pointer to it', async () => {
    await submitJob(lead)
    const copy = written('businesses/biz-1').data

    expect(copy).toMatchObject({
      type: 'job',
      jobType: 'fencing',
      title: 'Fence Installation',
      fullName: 'Ayesha Khan',
      phone: '923029447610',
      location: 'Pakenham, VIC 3810',
      matchedBusinessIds: ['biz-1', 'biz-2'],
    })
    expect((copy.locationData as Record<string, unknown>).geohash).toBe('r1prqs0tmr')
  })

  it('never writes the three fields this flow does not ask for', async () => {
    await submitJob(lead)

    for (const [, data] of set.mock.calls) {
      expect(data).not.toHaveProperty('jobDescription')
      expect(data).not.toHaveProperty('timeline')
      expect(data).not.toHaveProperty('photoUrls')
      expect(data).not.toHaveProperty('photoNames')
    }
  })

  it('names the job document after the job id itself', async () => {
    const jobId = await submitJob(lead)

    expect(jobId).toMatch(/^VI-\d{5}$/)
    expect(written('jobs').path).toBe(`jobs/${jobId}`)
    expect(written('jobs').data.jobId).toBe(jobId)
  })

  it('picks another number rather than overwriting a job that already has that id', async () => {
    let firstJobCheck = true
    exists.mockImplementation((path) => {
      if (!path.startsWith('jobs')) return false
      const taken = firstJobCheck
      firstJobCheck = false
      return taken
    })

    const jobId = await submitJob(lead)

    expect(jobId).toMatch(/^VI-\d{5}$/)
    // The taken id was checked, rejected, and never written to
    expect(exists.mock.calls.filter(([path]) => path.startsWith('jobs'))).toHaveLength(2)
    expect(written('jobs').path).toBe(`jobs/${jobId}`)
  })

  it('gives up instead of replacing somebody when every id it tries is taken', async () => {
    exists.mockImplementation((path) => path.startsWith('jobs'))

    await expect(submitJob(lead)).rejects.toThrow(/job number/i)
    expect(set).not.toHaveBeenCalled()
  })

  it('keeps one account per phone number, however many jobs they post', async () => {
    exists.mockImplementation((path) => path === 'users/923029447610')
    await submitJob(lead)

    // No users/{phone}_{jobId} mirror: the job lives in jobs/, and only there
    expect(written('users').path).toBe('users/923029447610')
    expect(set.mock.calls.filter(([ref]) => String(ref.path).startsWith('users'))).toHaveLength(1)
  })

  it('holds nothing job-shaped on the account, so the two can never drift', async () => {
    await submitJob(lead)
    const user = written('users').data

    for (const jobField of ['jobId', 'matchedBusinessIds', 'isAdditionalJob', 'photoCount', 'status']) {
      expect(user).not.toHaveProperty(jobField)
    }
    expect(user).toMatchObject({ type: 'user', uid: lead.uid, fullName: 'Ayesha Khan', source: 'ai_agent' })
  })

  it('creates a first-time account with a createdAt, and never resets it later', async () => {
    await submitJob(lead)
    expect(written('users').data).toMatchObject({ isVerified: true, createdAt: 'SERVER_TS' })

    vi.clearAllMocks()
    exists.mockImplementation((path) => path === 'users/923029447610')
    await submitJob(lead)
    expect(written('users').data).not.toHaveProperty('createdAt')
  })
})
