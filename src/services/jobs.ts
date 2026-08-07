// Writing the lead into Firestore once the phone number is verified. One batch, three kinds of
// document, because that is what the rest of the product reads:
//
//   jobs/{VI-48291}                                the job itself
//   users/{phone}                                  the customer's account, one per phone number
//   businesses/{uid}/incoming_jobs/{VI-48291}      a copy for each business that was picked,
//   businesses/{uid}/accepted_jobs/{VI-48291}      or straight into accepted when they auto-accept
//
// Three fields the web form writes are deliberately absent, because this flow never asks for
// them: jobDescription, timeline, and the photo urls. Everything else matches the existing
// documents exactly, so both sources of leads read the same way downstream.
import type { SuburbPlace } from './places'
import { getDb } from './firebase'

const TRADE = 'fencing'
const CATEGORY = 'Fencing'
const TITLE = 'Fence Installation'
/** How a lead from this flow is told apart from one typed into the web form. */
const SOURCE = 'ai_agent'
const ID_ATTEMPTS = 5

export interface JobLead {
  fullName: string
  email: string
  /** E.164 with the leading +, as the details form produces it. */
  phoneE164: string
  /** Firebase uid from the phone-auth sign-in. */
  uid: string
  /**
   * Null only when the suburb never came from the picker (no Places key configured). The lead
   * is still worth saving without it — name, number and matched businesses are what somebody
   * calls back on — so the record simply goes in without `locationData`, and the map-based
   * job search is the one thing that won't find it.
   */
  place: SuburbPlace | null
  /** The businesses the customer ticked, and whether each one takes AI leads automatically. */
  businesses: { id: string; autoAcceptsAi: boolean }[]
  /** The conversation this quote came out of, so the job can be traced back to it. */
  sessionId: string
  /** Where the PDF of that conversation lives. Null when it could not be produced. */
  aiChatPdfUrl: string | null
}

/** Stored, and used as the user document's id, without the leading + — as every record does. */
const phoneDigits = (phoneE164: string) => phoneE164.replace(/\D/g, '')

/** "VI-59003": the first two letters of the state, then five digits. */
function buildJobId(state: string) {
  const prefix = (state || 'AU').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'AU'
  return `${prefix}-${Math.floor(10000 + Math.random() * 90000)}`
}

/** locationData as the user document stores it — flat, no geo types. */
function locationData(place: SuburbPlace) {
  return {
    country: place.country,
    countryName: place.countryName,
    displayLabel: place.displayLabel,
    formattedAddress: place.formattedAddress,
    latitude: place.latitude,
    longitude: place.longitude,
    name: place.name,
    placeId: place.placeId,
    placeTypes: place.placeTypes,
    postcode: place.postcode,
    state: place.state,
    stateFullName: place.stateFullName,
    suburb: place.suburb,
  }
}

/**
 * Writes the job, the customer, and a copy for every business that was picked. Returns the
 * generated jobId.
 */
export async function submitJob(lead: JobLead): Promise<string> {
  const [{ doc, GeoPoint, getDoc, serverTimestamp, writeBatch }, { geohashForLocation }, db] = await Promise.all([
    import('firebase/firestore'),
    import('geofire-common'),
    getDb(),
  ])

  const { place } = lead
  const phone = phoneDigits(lead.phoneE164)
  const matchedBusinessIds = lead.businesses.map((business) => business.id)

  // The job id is also the document's id, so an id that is already taken would overwrite
  // somebody else's job rather than fail — five digits collide long before they run out.
  // Checked here instead of hoped over: a silently replaced lead is unrecoverable.
  let jobRef = null
  for (let attempt = 0; attempt < ID_ATTEMPTS && !jobRef; attempt += 1) {
    const candidate = doc(db, 'jobs', buildJobId(place?.state ?? ''))
    if (!(await getDoc(candidate)).exists()) jobRef = candidate
  }
  // ponytail: 5 tries is plenty against 90,000 ids per state. If this ever throws, the format
  // itself has run out and needs another digit — retrying harder will not help.
  if (!jobRef) throw new Error("Couldn't allocate a job number. Try again in a moment.")
  const jobId = jobRef.id

  const now = serverTimestamp()
  // Spread in, so no key appears at all when there is no place to describe.
  const location = place ? { location: place.displayLabel, locationData: locationData(place) } : {}
  const geoLocation = place
    ? {
        location: place.displayLabel,
        // The job's copy carries the geo types as well — that is what the businesses'
        // nearby-jobs search reads, and it cannot run off plain lat/lng fields.
        locationData: {
          ...locationData(place),
          geopoint: new GeoPoint(place.latitude, place.longitude),
          geohash: geohashForLocation([place.latitude, place.longitude]),
        },
      }
    : {}

  const job = {
    type: 'job',
    status: 'open',
    jobId,
    jobType: TRADE,
    category: CATEGORY,
    title: TITLE,
    uid: lead.uid,
    userId: phone,
    fullName: lead.fullName,
    email: lead.email,
    phone,
    ...geoLocation,
    matchedBusinessIds,
    source: SOURCE,
    // The conversation behind this job. The other site renders the link however it likes —
    // producing the artefact is this side's job, deciding where it appears is not.
    sessionId: lead.sessionId,
    ...(lead.aiChatPdfUrl ? { aiChatPdfUrl: lead.aiChatPdfUrl } : {}),
    photoCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  const batch = writeBatch(db)
  batch.set(jobRef, job)

  // One account per phone number, merged rather than replaced — never a second document per
  // job. The job's own record is the only place a job lives; mirroring it under the customer
  // produced two sources of truth that drifted, so nothing job-shaped goes in here: no jobId,
  // no matchedBusinessIds, no isAdditionalJob. "How many jobs has this customer posted?" is a
  // query against `jobs` on uid, which cannot fall out of step with the jobs themselves.
  const userRef = doc(db, 'users', phone)
  const isNewAccount = !(await getDoc(userRef)).exists()
  batch.set(
    userRef,
    {
      type: 'user',
      uid: lead.uid,
      fullName: lead.fullName,
      email: lead.email,
      phone,
      phoneNormalized: phone,
      ...location,
      source: SOURCE,
      // The number got them here, so by definition it is verified.
      isVerified: true,
      updatedAt: now,
      // Only on the way in: a returning customer keeps the date they first signed up.
      ...(isNewAccount ? { createdAt: now } : {}),
    },
    { merge: true },
  )

  // Each picked business gets the whole job, not a pointer — their app renders the feed straight
  // out of this copy. Where it lands is the only difference: a business that takes AI leads
  // automatically has already accepted it, the rest have it waiting.
  for (const business of lead.businesses) {
    const inbox = business.autoAcceptsAi ? 'accepted_jobs' : 'incoming_jobs'
    batch.set(doc(db, 'businesses', business.id, inbox, jobId), {
      ...job,
      businessId: business.id,
      ...(business.autoAcceptsAi ? { status: 'accepted', autoAccepted: true } : {}),
    })
  }

  await batch.commit()
  return jobId
}
