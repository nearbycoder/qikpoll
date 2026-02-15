import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Clock3,
  Eye,
  EyeOff,
  Plus,
  Rocket,
  Shield,
  Vote,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  PollSummary,
  PollVisibility,
  PublicListUpdatePayload,
} from '@/lib/poll-types'

export const Route = createFileRoute('/')({
  component: HomePage,
})

interface PollOptionInput {
  id: string
  text: string
}

function HomePage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<PollVisibility>('public')
  const [options, setOptions] = useState<Array<PollOptionInput>>([
    { id: crypto.randomUUID(), text: '' },
    { id: crypto.randomUUID(), text: '' },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [publicPolls, setPublicPolls] = useState<Array<PollSummary>>([])
  const [isLoadingPublicPolls, setIsLoadingPublicPolls] = useState(true)
  const [publicPollsError, setPublicPollsError] = useState('')

  const canAddOption = options.length < 8
  const canRemoveOption = options.length > 2

  const cleanedOptions = useMemo(
    () => options.map((option) => option.text.trim()).filter((text) => text.length > 0),
    [options],
  )

  useEffect(() => {
    void loadPublicPolls()
  }, [])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let isClosed = false

    const scheduleRefresh = () => {
      if (refreshTimer) {
        return
      }

      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        void loadPublicPolls({ background: true })
      }, 300)
    }

    const connect = () => {
      if (isClosed) {
        return
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socketUrl = `${protocol}//${window.location.host}/api/live?stream=public`
      socket = new WebSocket(socketUrl)

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as PublicListUpdatePayload
          if (payload.type !== 'public_list_update') {
            return
          }

          scheduleRefresh()
        } catch {
          // Ignore invalid payloads.
        }
      }

      socket.onclose = () => {
        if (isClosed) {
          return
        }

        reconnectTimer = setTimeout(connect, 2000)
      }
    }

    connect()

    return () => {
      isClosed = true

      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }

      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }

      socket?.close()
    }
  }, [])

  async function loadPublicPolls(options?: { background?: boolean }) {
    const isBackgroundRefresh = options?.background ?? false

    if (!isBackgroundRefresh) {
      setIsLoadingPublicPolls(true)
      setPublicPollsError('')
    }

    try {
      const response = await fetch('/api/polls?limit=30')
      const payload = (await response.json()) as
        | { ok: true; polls: Array<PollSummary> }
        | { ok: false; message: string }

      if (!response.ok || !payload.ok) {
        if (!isBackgroundRefresh) {
          setPublicPollsError(payload.ok ? 'Could not load public polls.' : payload.message)
        }

        return
      }

      setPublicPolls(payload.polls)
      setPublicPollsError('')
    } catch {
      if (!isBackgroundRefresh) {
        setPublicPollsError('Could not load public polls.')
      }
    } finally {
      if (!isBackgroundRefresh) {
        setIsLoadingPublicPolls(false)
      }
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/polls', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title,
          options: cleanedOptions,
          visibility,
        }),
      })

      const payload = (await response.json()) as
        | {
            ok: true
            pollPath: string
          }
        | {
            ok: false
            message: string
          }

      if (!response.ok || !payload.ok) {
        setErrorMessage(payload.ok ? 'Could not create poll' : payload.message)
        return
      }

      if (visibility === 'public') {
        void loadPublicPolls()
      }

      await navigate({ to: payload.pollPath })
    } catch {
      setErrorMessage('Could not create poll right now. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function addOption() {
    if (!canAddOption) {
      return
    }

    setOptions((current) => [...current, { id: crypto.randomUUID(), text: '' }])
  }

  function removeOption(optionId: string) {
    if (!canRemoveOption) {
      return
    }

    setOptions((current) => current.filter((option) => option.id !== optionId))
  }

  function updateOption(optionId: string, text: string) {
    setOptions((current) =>
      current.map((option) =>
        option.id === optionId ? { ...option, text } : option,
      ),
    )
  }

  return (
    <main className="poll-shell">
      <section className="hero-wrap">
        <div className="hero-card">
          <p className="eyebrow">No signup. Anonymous. Fast.</p>
          <h1>Launch a vote in under 20 seconds.</h1>
          <p>
            QikPoll is built for fast anonymous voting with dependable
            one-person voting and shareable links.
          </p>
          <div className="hero-pills">
            <span>
              <Shield size={16} /> IP + device checks
            </span>
            <span>
              <Vote size={16} /> One vote per poll
            </span>
            <span>
              <Rocket size={16} /> Instant share links
            </span>
          </div>
        </div>
      </section>

      <section className="compose-wrap">
        <form className="poll-form" onSubmit={onSubmit}>
          <div className="field-group">
            <label htmlFor="poll-title">Poll question</label>
            <input
              id="poll-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What should we ship first?"
              maxLength={180}
              required
            />
          </div>

          <div className="visibility-row">
            <span className="visibility-label">Listing</span>
            <div className="visibility-toggle" role="radiogroup" aria-label="Poll visibility">
              <button
                type="button"
                role="radio"
                aria-checked={visibility === 'public'}
                className={`visibility-option ${visibility === 'public' ? 'is-active' : ''}`}
                onClick={() => setVisibility('public')}
              >
                <Eye size={14} /> Public
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={visibility === 'private'}
                className={`visibility-option ${visibility === 'private' ? 'is-active' : ''}`}
                onClick={() => setVisibility('private')}
              >
                <EyeOff size={14} /> Private
              </button>
            </div>
          </div>

          <div className="option-grid">
            {options.map((option, index) => (
              <div className="option-row" key={option.id}>
                <label htmlFor={`option-${option.id}`}>Option {index + 1}</label>
                <div className="option-input-row">
                  <input
                    id={`option-${option.id}`}
                    value={option.text}
                    onChange={(event) => updateOption(option.id, event.target.value)}
                    placeholder={`Choice ${index + 1}`}
                    maxLength={120}
                    required={index < 2}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => removeOption(option.id)}
                    disabled={!canRemoveOption}
                    aria-label={`Remove option ${index + 1}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={addOption}
              disabled={!canAddOption}
            >
              <Plus size={16} /> Add option
            </button>
            <button type="submit" className="primary" disabled={isSubmitting}>
              {isSubmitting ? 'Creating poll...' : 'Create poll'}
            </button>
          </div>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        </form>

        <aside className="security-panel">
          <h2>Why people use QikPoll</h2>
          <ul>
            <li>Anonymous by default, with no account required.</li>
            <li>Fast poll creation and instant share links.</li>
            <li>Reliable vote protection that keeps results fair.</li>
            <li>Private polls are unlisted and only accessible by direct link.</li>
          </ul>
        </aside>
      </section>

      <section className="public-polls-panel">
        <div className="public-polls-header">
          <h2>Recent public polls</h2>
          <button
            type="button"
            className="secondary"
            onClick={() => void loadPublicPolls()}
            disabled={isLoadingPublicPolls}
          >
            Refresh list
          </button>
        </div>

        {publicPollsError ? <p className="error-text">{publicPollsError}</p> : null}

        {isLoadingPublicPolls ? (
          <p className="status-text">Loading public polls...</p>
        ) : publicPolls.length === 0 ? (
          <p className="status-text">No public polls yet. Create one and it will appear here.</p>
        ) : (
          <div className="public-poll-list">
            {publicPolls.map((poll) => (
              <Link key={poll.id} to="/p/$pollId" params={{ pollId: poll.id }} className="public-poll-item">
                <div>
                  <p className="public-poll-title">{poll.title}</p>
                  <p className="public-poll-meta">
                    <Vote size={14} /> {poll.totalVotes} votes · {poll.optionCount} options
                  </p>
                </div>
                <p className="public-poll-age">
                  <Clock3 size={14} /> {formatPollAge(poll.createdAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function formatPollAge(createdAtIso: string) {
  const diffMs = Date.now() - new Date(createdAtIso).getTime()
  const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)))

  if (diffMinutes < 1) {
    return 'just now'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h ago`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}
