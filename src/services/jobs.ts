// Writing the lead into Firestore once the phone number is verified. One batch, three kinds of
// document, because that is what the rest of the product reads:
//
//   jobs/{VI-48291}                                the job itself
//   users/{phone}                                  the customer's account, one per phone number
//   businesses/{uid}/incoming_jobs/{VI-48291}      a copy for each business that was picked,
//   businesses/{uid}/accepted_jobs/{VI-48291}      or straight into accepted when they AI-auto-accept
//
// Three fields the web form writes are deliberately absent, because this flow never asks for
// them: jobDescription, timeline, and the photo urls. Everything else matches the existing
// documents exactly, so both sources of leads read the same way downstream.
import type { SuburbPlace } from './places'
import { getDb } from './firebase'

const TRADE_META: Record<string, { category: string; title: string }> = {
  fencing: { category: 'Fencing', title: 'Fence Installation' },
  tiling: { category: 'Tiling', title: 'Tiling Job' },
  decking: { category: 'Decking', title: 'Decking Installation' },
  'retaining-wall': { category: 'Retaining Wall', title: 'Retaining Wall Installation' },
}

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
  /**
   * The businesses the customer ticked. `autoAcceptsAi` is a session hint from matching;
   * `submitJob` re-reads `isAiAutoAcceptEnabled` on each business doc as the source of truth.
   */
  businesses: { id: string; autoAcceptsAi: boolean }[]
  /** The conversation this quote came out of, so the job can be traced back to it. */
  sessionId: string
  /** Where the PDF of that conversation lives. Null when it could not be produced. */
  aiChatPdfUrl: string | null
  /** Backend/chip trade slug (`fencing`, `tiling`, `decking`, `retaining-wall`). */
  trade?: string | null
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

type FirestoreGetDoc = (ref: { path: string }) => Promise<{
  exists: () => boolean
  data?: () => Record<string, unknown> | undefined
}>

type FirestoreDoc = (db: unknown, ...path: string[]) => { path: string; id: string }

/**
 * Whether this business opted into AI Direct Quote auto-accept.
 * Live `businesses/{id}.isAiAutoAcceptEnabled` wins; session hint is only a fallback when the
 * business doc is missing or unreadable (rules / network), so a stale quote payload cannot
 * silently skip `accepted_jobs` for an opted-in tradie.
 */
export async function resolveAiAutoAccept(params: {
  db: unknown
  doc: FirestoreDoc
  getDoc: FirestoreGetDoc
  businessId: string
  sessionHint: boolean
}): Promise<boolean> {
  const { db, doc, getDoc, businessId, sessionHint } = params
  try {
    const snap = await getDoc(doc(db, 'businesses', businessId))
    if (snap.exists()) {
      const data = typeof snap.data === 'function' ? snap.data() : undefined
      const live = data?.isAiAutoAcceptEnabled === true
      console.log('[resolveAiAutoAccept]', {
        businessId,
        source: 'live Firestore',
        isAiAutoAcceptEnabled: data?.isAiAutoAcceptEnabled,
        sessionHint,
        resolved: live,
      })
      return live
    }
    console.log('[resolveAiAutoAccept]', {
      businessId,
      source: 'session hint (business doc missing)',
      sessionHint,
      resolved: sessionHint,
    })
  } catch (error) {
    console.warn(
      `[submitJob] Could not read isAiAutoAcceptEnabled for ${businessId}; using session hint.`,
      error,
    )
    console.log('[resolveAiAutoAccept]', {
      businessId,
      source: 'session hint (Firestore read failed)',
      sessionHint,
      resolved: sessionHint,
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
    })
  }
  return sessionHint
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
  // Fall back to fencing when the session never locked a known trade (no chip, backend still
  // detecting) — posting with a blank/unknown jobType would break the partner site's filters.
  const trade = lead.trade && TRADE_META[lead.trade] ? lead.trade : 'fencing'
  const { category, title } = TRADE_META[trade]

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

  // Authoritative inbox routing: partner site Messages/Home only list `accepted_jobs`.
  const routed = await Promise.all(
    lead.businesses.map(async (business) => ({
      id: business.id,
      autoAcceptsAi: await resolveAiAutoAccept({
        db,
        doc: doc as unknown as FirestoreDoc,
        getDoc: getDoc as unknown as FirestoreGetDoc,
        businessId: business.id,
        sessionHint: business.autoAcceptsAi === true,
      }),
    })),
  )
  const anyAiAutoAccepted = routed.some((business) => business.autoAcceptsAi)
  console.log('[submitJob] routing resolved', {
    customerUid: lead.uid,
    sessionHints: lead.businesses.map((b) => ({ id: b.id, autoAcceptsAi: b.autoAcceptsAi })),
    routed,
    anyAiAutoAccepted,
  })

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
    // At least one opted-in AI auto-accept means the customer already has a connected tradie.
    status: anyAiAutoAccepted ? 'accepted' : 'open',
    jobId,
    jobType: trade,
    category,
    title,
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
  // out of this copy. `isAiAutoAcceptEnabled` decides the collection: opted-in → accepted_jobs
  // (partner Messages/Home light up); otherwise → incoming_jobs (manual Accept still required).
  for (const business of routed) {
    const inbox = business.autoAcceptsAi ? 'accepted_jobs' : 'incoming_jobs'
    const path = `businesses/${business.id}/${inbox}/${jobId}`
    const payload = {
      ...job,
      businessId: business.id,
      // Per-business status — do not inherit job-level `accepted` onto waiting inbox copies.
      ...(business.autoAcceptsAi
        ? { status: 'accepted', autoAccepted: true, acceptedAt: now }
        : { status: 'open' }),
    }
    // Trace what the partner Messages query would see. `uid` here is the CUSTOMER's phone-auth
    // Firebase UID (lead.uid), not the business Auth UID. Path + `businessId` are the business.
    // A partner query of where('uid', '==', businessAuthUid) will never match this field.
    console.log('[submitJob] inbox write', {
      path,
      inbox,
      autoAcceptsAi: business.autoAcceptsAi,
      businessId: payload.businessId,
      customerUid: payload.uid,
      userId: payload.userId,
      jobId: payload.jobId,
      status: payload.status,
      autoAccepted: 'autoAccepted' in payload ? payload.autoAccepted : undefined,
      matchedBusinessIds: payload.matchedBusinessIds,
      source: payload.source,
    })
    batch.set(doc(db, 'businesses', business.id, inbox, jobId), payload)
  }

  await batch.commit()
  console.log('[submitJob] batch committed', {
    jobId,
    customerUid: lead.uid,
    anyAiAutoAccepted,
    routed: routed.map((b) => ({ businessId: b.id, autoAcceptsAi: b.autoAcceptsAi })),
  })
  return jobId
}
