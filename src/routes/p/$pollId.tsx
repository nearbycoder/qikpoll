import { createFileRoute } from '@tanstack/react-router'
import { Clock3, Copy, RefreshCcw, ShieldCheck, Vote } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { PollView, VoteUpdatePayload } from '@/lib/poll-types'

export const Route = createFileRoute('/p/$pollId')({
  component: PollPage,
})

function PollPage() {
  const { pollId } = Route.useParams()
  const [poll, setPoll] = useState<PollView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmittingVote, setIsSubmittingVote] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    void loadPoll(pollId)
  }, [pollId])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let isClosed = false

    const connect = () => {
      if (isClosed) {
        return
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socketUrl = `${protocol}//${window.location.host}/api/live?pollId=${encodeURIComponent(pollId)}`
      socket = new WebSocket(socketUrl)

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as VoteUpdatePayload
          if (payload.type !== 'vote_update' || payload.pollId !== pollId) {
            return
          }

          setPoll((current) => {
            if (!current) {
              return current
            }

            const byOptionId = new Map(
              payload.options.map((option) => [option.id, option]),
            )

            return {
              ...current,
              totalVotes: payload.totalVotes,
              options: current.options.map((option) => {
                const updated = byOptionId.get(option.id)
                if (!updated) {
                  return option
                }

                return {
                  ...option,
                  votes: updated.votes,
                  percent: updated.percent,
                }
              }),
            }
          })
        } catch {
          // Ignore invalid payloads
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

      socket?.close()
    }
  }, [pollId])

  const expiresInLabel = useMemo(() => {
    if (!poll) {
      return ''
    }

    const diffMs = new Date(poll.expiresAt).getTime() - Date.now()
    const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)))

    if (diffHours >= 48) {
      return `${Math.floor(diffHours / 24)} days left`
    }

    if (diffHours > 0) {
      return `${diffHours} hours left`
    }

    const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)))
    return `${diffMinutes} minutes left`
  }, [poll])

  async function loadPoll(targetPollId: string) {
    setIsLoading(true)
    setErrorMessage('')

    try {
      const response = await fetch(`/api/polls?id=${encodeURIComponent(targetPollId)}`)
      const payload = (await response.json()) as
        | { ok: true; poll: PollView }
        | { ok: false; message: string }

      if (!response.ok || !payload.ok) {
        setErrorMessage(payload.ok ? 'Could not load poll' : payload.message)
        setPoll(null)
        return
      }

      setPoll(payload.poll)
    } catch {
      setErrorMessage('Could not load this poll right now.')
      setPoll(null)
    } finally {
      setIsLoading(false)
    }
  }

  async function submitVote(optionId: string) {
    setFeedback('')
    setErrorMessage('')
    setIsSubmittingVote(true)

    try {
      const response = await fetch('/api/polls/vote', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          pollId,
          optionId,
        }),
      })

      const payload = (await response.json()) as
        | { ok: true; poll: PollView }
        | { ok: false; message: string }

      if (!response.ok || !payload.ok) {
        setErrorMessage(payload.ok ? 'Could not submit vote' : payload.message)
        return
      }

      setPoll(payload.poll)
      setFeedback('Vote counted. Results updated live.')
    } catch {
      setErrorMessage('Vote failed. Please try again.')
    } finally {
      setIsSubmittingVote(false)
    }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setFeedback('Share link copied to clipboard.')
    } catch {
      setFeedback('Copy failed. You can copy the URL from the browser bar.')
    }
  }

  if (isLoading) {
    return (
      <main className="poll-shell narrow">
        <section className="poll-card">
          <p>Loading poll...</p>
        </section>
      </main>
    )
  }

  if (!poll) {
    return (
      <main className="poll-shell narrow">
        <section className="poll-card">
          <h1>Poll unavailable</h1>
          <p>{errorMessage || 'This poll is missing or expired.'}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="poll-shell narrow">
      <section className="poll-card">
        <header className="poll-header">
          <p className="eyebrow">Anonymous poll</p>
          <h1>{poll.title}</h1>
          <div className="meta-row">
            <span>
              <Vote size={14} /> {poll.totalVotes} votes
            </span>
            <span>
              <Clock3 size={14} /> {expiresInLabel}
            </span>
            <span>
              <ShieldCheck size={14} /> Anti-spam enabled
            </span>
          </div>
        </header>

        <div className="vote-list">
          {poll.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="vote-option"
              disabled={poll.hasVoted || isSubmittingVote}
              onClick={() => submitVote(option.id)}
            >
              <div className="vote-option-top">
                <span>{option.text}</span>
                <span>
                  {option.votes} ({option.percent}%)
                </span>
              </div>
              <div className="vote-bar">
                <div style={{ width: `${option.percent}%` }} />
              </div>
            </button>
          ))}
        </div>

        <div className="poll-actions">
          <button type="button" className="secondary" onClick={() => loadPoll(pollId)}>
            <RefreshCcw size={16} /> Refresh
          </button>
          <button type="button" className="secondary" onClick={copyShareLink}>
            <Copy size={16} /> Copy share link
          </button>
        </div>

        {poll.hasVoted ? (
          <p className="status-text">You already voted on this poll from this device/network.</p>
        ) : (
          <p className="status-text">Choose one option to cast your vote.</p>
        )}

        {feedback ? <p className="ok-text">{feedback}</p> : null}
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      </section>
    </main>
  )
}
