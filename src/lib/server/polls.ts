import { createHash, randomBytes } from 'node:crypto'
import {
  getCookie,
  getRequestIP,
  setCookie,
} from '@tanstack/react-start/server'
import { publishPublicListUpdate, publishVoteUpdate } from './poll-live'
import { getRedisClient } from './redis'
import type {
  CreatePollInput,
  PollRecord,
  PollSummary,
  PollVisibility,
  PollView,
  VoteInput,
} from '../poll-types'

const VISITOR_COOKIE_NAME = 'qikpoll_vid'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const DEFAULT_POLL_TTL_SECONDS = 60 * 60 * 24 * 7
const CREATE_POLL_RATE_LIMIT_WINDOW_SECONDS = 60
const CREATE_POLL_RATE_LIMIT_MAX = 8
const VOTE_ATTEMPT_WINDOW_SECONDS = 60
const VOTE_ATTEMPT_MAX = 20
const DEFAULT_PUBLIC_LIST_LIMIT = 24
const PUBLIC_LIST_MAX_LIMIT = 100

const VOTE_SCRIPT = `
local pollData = redis.call('GET', KEYS[1])
if not pollData then
  return cjson.encode({ status = 'error', code = 'POLL_NOT_FOUND' })
end

local attempts = redis.call('INCR', KEYS[4])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[4], tonumber(ARGV[2]))
end
if attempts > tonumber(ARGV[3]) then
  return cjson.encode({ status = 'error', code = 'RATE_LIMITED' })
end

if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then
  return cjson.encode({ status = 'error', code = 'ALREADY_VOTED' })
end

local poll = cjson.decode(pollData)
local found = false
for i=1,#poll.options do
  if poll.options[i].id == ARGV[1] then
    poll.options[i].votes = (poll.options[i].votes or 0) + 1
    found = true
    break
  end
end

if not found then
  return cjson.encode({ status = 'error', code = 'OPTION_NOT_FOUND' })
end

poll.totalVotes = (poll.totalVotes or 0) + 1

redis.call('SET', KEYS[1], cjson.encode(poll), 'EX', tonumber(ARGV[4]))
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[4]), 'NX')
redis.call('SET', KEYS[3], ARGV[1], 'EX', tonumber(ARGV[4]), 'NX')

return cjson.encode({ status = 'ok', poll = poll })
`

export class PollError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function getFingerprintSalt() {
  return process.env.POLL_FINGERPRINT_SALT ?? 'qikpoll-dev-fingerprint-salt'
}

function getPollTtlSeconds() {
  const configured = Number(process.env.POLL_TTL_SECONDS)
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_POLL_TTL_SECONDS
  }
  return Math.floor(configured)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function generateId(byteLength = 8) {
  return randomBytes(byteLength).toString('base64url')
}

function keyPoll(pollId: string) {
  return `poll:${pollId}`
}

function keyPublicPollIndex() {
  return 'poll:index:public'
}

function keyVoteByFingerprint(pollId: string, fingerprint: string) {
  return `poll:vote:fp:${pollId}:${fingerprint}`
}

function keyVoteByIp(pollId: string, ipHash: string) {
  return `poll:vote:ip:${pollId}:${ipHash}`
}

function keyCreateRate(ipHash: string) {
  return `poll:rate:create:${ipHash}`
}

function keyVoteRate(pollId: string, ipHash: string) {
  return `poll:rate:vote:${pollId}:${ipHash}`
}

function parseClientIp(request: Request) {
  const requestIp = getRequestIP({ xForwardedFor: true })
  if (requestIp) {
    return requestIp
  }

  const xForwardedFor = request.headers.get('x-forwarded-for')
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(',')[0]
    if (firstIp) {
      return firstIp.trim()
    }
  }

  const fromCloudflare = request.headers.get('cf-connecting-ip')
  if (fromCloudflare) {
    return fromCloudflare.trim()
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  return '0.0.0.0'
}

function sanitizeTitle(rawTitle: unknown) {
  if (typeof rawTitle !== 'string') {
    throw new PollError(400, 'INVALID_TITLE', 'Poll title must be text')
  }

  const title = rawTitle.trim()

  if (title.length < 4 || title.length > 180) {
    throw new PollError(
      400,
      'INVALID_TITLE',
      'Poll title must be between 4 and 180 characters',
    )
  }

  return title
}

function sanitizeOptions(rawOptions: unknown) {
  if (!Array.isArray(rawOptions)) {
    throw new PollError(400, 'INVALID_OPTIONS', 'Poll options must be an array')
  }

  const normalized = rawOptions
    .filter((option) => typeof option === 'string')
    .map((option) => option.trim())
    .filter((option) => option.length > 0)

  const unique = Array.from(new Set(normalized.map((option) => option.toLowerCase())))

  if (unique.length < 2 || unique.length > 8) {
    throw new PollError(
      400,
      'INVALID_OPTIONS',
      'Poll must contain between 2 and 8 unique options',
    )
  }

  const optionsByLower = new Map<string, string>()
  for (const option of normalized) {
    const lowered = option.toLowerCase()
    if (!optionsByLower.has(lowered)) {
      if (option.length > 120) {
        throw new PollError(
          400,
          'INVALID_OPTIONS',
          'Each option must be at most 120 characters',
        )
      }

      optionsByLower.set(lowered, option)
    }
  }

  return Array.from(optionsByLower.values())
}

function sanitizeVisibility(rawVisibility: unknown): PollVisibility {
  if (rawVisibility === 'private') {
    return 'private'
  }

  return 'public'
}

function asPollRecord(raw: string | null): PollRecord | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PollRecord>
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.title !== 'string' ||
      !Array.isArray(parsed.options) ||
      typeof parsed.totalVotes !== 'number' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null
    }

    return {
      ...parsed,
      visibility: parsed.visibility === 'private' ? 'private' : 'public',
    } as PollRecord
  } catch {
    return null
  }
}

function ensureVisitorId() {
  const fromCookie = getCookie(VISITOR_COOKIE_NAME)
  if (fromCookie) {
    return fromCookie
  }

  const generated = generateId(12)
  setCookie(VISITOR_COOKIE_NAME, generated, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  })

  return generated
}

function toPublicPoll(poll: PollRecord, hasVoted: boolean): PollView {
  return {
    id: poll.id,
    title: poll.title,
    visibility: poll.visibility,
    totalVotes: poll.totalVotes,
    createdAt: poll.createdAt,
    expiresAt: poll.expiresAt,
    hasVoted,
    options: poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      votes: option.votes,
      percent:
        poll.totalVotes === 0 ? 0 : Math.round((option.votes / poll.totalVotes) * 100),
    })),
  }
}

function toPollSummary(poll: PollRecord): PollSummary {
  return {
    id: poll.id,
    title: poll.title,
    totalVotes: poll.totalVotes,
    optionCount: poll.options.length,
    createdAt: poll.createdAt,
    expiresAt: poll.expiresAt,
    pollPath: `/p/${poll.id}`,
  }
}

async function getActor(request: Request) {
  const visitorId = ensureVisitorId()
  const ip = parseClientIp(request)
  const userAgent = request.headers.get('user-agent') ?? 'unknown'
  const language = request.headers.get('accept-language') ?? 'unknown'
  const clientHints = request.headers.get('sec-ch-ua') ?? 'unknown'
  const salt = getFingerprintSalt()

  const ipHash = hash(`${ip}|${salt}`).slice(0, 24)
  const fingerprintHash = hash(
    [ipHash, userAgent, language, clientHints, visitorId, salt].join('|'),
  ).slice(0, 40)

  return {
    ipHash,
    fingerprintHash,
  }
}

async function enforceCreatePollRateLimit(ipHash: string) {
  const redis = await getRedisClient()
  const key = keyCreateRate(ipHash)
  const attempts = await redis.incr(key)

  if (attempts === 1) {
    await redis.expire(key, CREATE_POLL_RATE_LIMIT_WINDOW_SECONDS)
  }

  if (attempts > CREATE_POLL_RATE_LIMIT_MAX) {
    throw new PollError(
      429,
      'RATE_LIMITED',
      'Too many polls created from this network. Please wait a minute and try again.',
    )
  }
}

async function findAvailablePollId() {
  const redis = await getRedisClient()

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = generateId(8)
    const exists = await redis.exists(keyPoll(candidate))
    if (!exists) {
      return candidate
    }
  }

  throw new PollError(500, 'ID_GENERATION_FAILED', 'Could not generate a poll id')
}

function getRemainingSeconds(expiresAtIso: string) {
  const expiresAtMs = new Date(expiresAtIso).getTime()
  const nowMs = Date.now()
  return Math.floor((expiresAtMs - nowMs) / 1000)
}

async function getPollOrThrow(pollId: string) {
  if (!pollId || pollId.length > 80) {
    throw new PollError(400, 'INVALID_POLL_ID', 'Invalid poll id')
  }

  const redis = await getRedisClient()
  const rawPoll = await redis.get(keyPoll(pollId))
  const poll = asPollRecord(rawPoll)

  if (!poll) {
    throw new PollError(404, 'POLL_NOT_FOUND', 'Poll not found or expired')
  }

  return poll
}

export async function createPoll(request: Request, input: CreatePollInput) {
  const title = sanitizeTitle(input.title)
  const options = sanitizeOptions(input.options)
  const visibility = sanitizeVisibility(input.visibility)
  const actor = await getActor(request)

  await enforceCreatePollRateLimit(actor.ipHash)

  const pollId = await findAvailablePollId()
  const now = new Date()
  const ttlSeconds = getPollTtlSeconds()
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

  const poll: PollRecord = {
    id: pollId,
    title,
    visibility,
    totalVotes: 0,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    options: options.map((option, index) => ({
      id: `o${index + 1}`,
      text: option,
      votes: 0,
    })),
  }

  const redis = await getRedisClient()
  const writeResults = await redis
    .multi()
    .set(keyPoll(pollId), JSON.stringify(poll), {
      EX: ttlSeconds,
    })
    .exec()

  if (!writeResults) {
    throw new PollError(500, 'POLL_SAVE_FAILED', 'Could not save poll')
  }

  if (visibility === 'public') {
    await redis.sendCommand([
      'ZADD',
      keyPublicPollIndex(),
      String(Date.parse(poll.createdAt)),
      poll.id,
    ])

    try {
      await publishPublicListUpdate(poll.id, 'poll_created')
    } catch (error) {
      console.error('Failed to publish public list create update', error)
    }
  }

  return {
    poll: toPublicPoll(poll, false),
    pollPath: `/p/${poll.id}`,
  }
}

export async function listPublicPolls(limit = DEFAULT_PUBLIC_LIST_LIMIT) {
  const parsedLimit = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_PUBLIC_LIST_LIMIT
  const normalizedLimit = Math.max(1, Math.min(PUBLIC_LIST_MAX_LIMIT, parsedLimit))
  const redis = await getRedisClient()

  const publicPollIds = (await redis.sendCommand([
    'ZRANGE',
    keyPublicPollIndex(),
    '0',
    String(normalizedLimit - 1),
    'REV',
  ])) as Array<string>

  if (publicPollIds.length === 0) {
    return []
  }

  const rawPolls = await Promise.all(publicPollIds.map((pollId) => redis.get(keyPoll(pollId))))
  const stalePollIds: Array<string> = []
  const summaries: Array<PollSummary> = []

  for (const [index, rawPoll] of rawPolls.entries()) {
    const pollId = publicPollIds[index]
    if (!pollId) {
      continue
    }

    const poll = asPollRecord(rawPoll)
    if (!poll || poll.visibility === 'private') {
      stalePollIds.push(pollId)
      continue
    }

    summaries.push(toPollSummary(poll))
  }

  if (stalePollIds.length > 0) {
    await redis.sendCommand(['ZREM', keyPublicPollIndex(), ...stalePollIds])
  }

  return summaries
}

export async function getPollForViewer(request: Request, pollId: string) {
  const actor = await getActor(request)
  const poll = await getPollOrThrow(pollId)
  const redis = await getRedisClient()

  const [hasFingerprintVote, hasIpVote] = await redis
    .multi()
    .exists(keyVoteByFingerprint(pollId, actor.fingerprintHash))
    .exists(keyVoteByIp(pollId, actor.ipHash))
    .exec()

  const hasVoted = (hasFingerprintVote ?? 0) > 0 || (hasIpVote ?? 0) > 0

  return toPublicPoll(poll, hasVoted)
}

export async function submitVote(request: Request, input: VoteInput) {
  const pollId = input.pollId?.trim()
  const optionId = input.optionId?.trim()

  if (!pollId || !optionId) {
    throw new PollError(
      400,
      'INVALID_VOTE',
      'Vote request must include a poll id and option id',
    )
  }

  const actor = await getActor(request)
  const poll = await getPollOrThrow(pollId)
  const ttlSeconds = getRemainingSeconds(poll.expiresAt)

  if (ttlSeconds <= 0) {
    throw new PollError(404, 'POLL_NOT_FOUND', 'Poll not found or expired')
  }

  const redis = await getRedisClient()
  const response = await redis.eval(VOTE_SCRIPT, {
    keys: [
      keyPoll(pollId),
      keyVoteByFingerprint(pollId, actor.fingerprintHash),
      keyVoteByIp(pollId, actor.ipHash),
      keyVoteRate(pollId, actor.ipHash),
    ],
    arguments: [
      optionId,
      String(VOTE_ATTEMPT_WINDOW_SECONDS),
      String(VOTE_ATTEMPT_MAX),
      String(ttlSeconds),
    ],
  })

  if (typeof response !== 'string') {
    throw new PollError(500, 'VOTE_FAILED', 'Could not save vote')
  }

  const parsed = JSON.parse(response) as
    | { status: 'error'; code: string }
    | { status: 'ok'; poll: PollRecord }

  if (parsed.status === 'error') {
    if (parsed.code === 'ALREADY_VOTED') {
      throw new PollError(409, 'ALREADY_VOTED', 'This device has already voted')
    }

    if (parsed.code === 'OPTION_NOT_FOUND') {
      throw new PollError(400, 'OPTION_NOT_FOUND', 'Selected option does not exist')
    }

    if (parsed.code === 'RATE_LIMITED') {
      throw new PollError(
        429,
        'RATE_LIMITED',
        'Too many vote attempts. Please slow down and try again.',
      )
    }

    throw new PollError(404, 'POLL_NOT_FOUND', 'Poll not found or expired')
  }

  try {
    await publishVoteUpdate(parsed.poll)
  } catch (error) {
    console.error('Failed to publish vote update', error)
  }

  if (parsed.poll.visibility === 'public') {
    try {
      await publishPublicListUpdate(parsed.poll.id, 'poll_updated')
    } catch (error) {
      console.error('Failed to publish public list vote update', error)
    }
  }

  return toPublicPoll(parsed.poll, true)
}
