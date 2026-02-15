import { createFileRoute } from '@tanstack/react-router'
import type { Peer } from 'crossws'
import {
  attachLivePeer,
  attachPublicListPeer,
  detachLivePeer,
  detachPublicListPeer,
} from '@/lib/server/poll-live'

type LivePeerContext =
  | { mode: 'poll'; pollId: string }
  | { mode: 'public' }

function isValidPollId(pollId: string) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(pollId)
}

function getPeerContext(peer: Peer): LivePeerContext | null {
  const mode = peer.context.mode
  if (mode === 'public') {
    return { mode: 'public' }
  }

  const pollId = String(peer.context.pollId ?? '')
  if (!pollId) {
    return null
  }

  return { mode: 'poll', pollId }
}

export const Route = createFileRoute('/api/live')({
  server: {
    handlers: {
      GET: async () => {
        return Object.assign(
          new Response('WebSocket upgrade is required.', { status: 426 }),
          {
            crossws: {
              upgrade(request: Request) {
                const url = new URL(request.url)
                const pollId = url.searchParams.get('pollId')?.trim() ?? ''
                const stream = url.searchParams.get('stream')?.trim() ?? ''

                if (stream === 'public') {
                  return {
                    context: {
                      mode: 'public',
                    } satisfies LivePeerContext,
                  }
                }

                if (!isValidPollId(pollId)) {
                  throw new Response('Missing or invalid pollId query parameter', {
                    status: 400,
                  })
                }

                return {
                  context: {
                    mode: 'poll',
                    pollId,
                  } satisfies LivePeerContext,
                }
              },
              async open(peer: Peer) {
                const context = getPeerContext(peer)

                try {
                  if (!context) {
                    peer.close(1008, 'Missing live stream context')
                    return
                  }

                  if (context.mode === 'public') {
                    await attachPublicListPeer(peer)
                    return
                  }

                  await attachLivePeer(context.pollId, peer)
                } catch (error) {
                  console.error('Could not register websocket peer', error)
                  peer.close(1011, 'Subscription error')
                }
              },
              close(peer: Peer) {
                const context = getPeerContext(peer)
                if (!context) {
                  return
                }

                if (context.mode === 'public') {
                  detachPublicListPeer(peer)
                  return
                }

                detachLivePeer(context.pollId, peer)
              },
            },
          },
        )
      },
    },
  },
})
