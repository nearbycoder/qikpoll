import { createFileRoute } from '@tanstack/react-router'
import { PollError, submitVote } from '@/lib/server/polls'
import type { VoteInput } from '@/lib/poll-types'

export const Route = createFileRoute('/api/polls/vote')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          let body: Partial<VoteInput>
          try {
            body = (await request.json()) as Partial<VoteInput>
          } catch {
            return Response.json(
              {
                ok: false,
                code: 'INVALID_JSON',
                message: 'Request body must be valid JSON',
              },
              { status: 400 },
            )
          }

          const poll = await submitVote(request, {
            pollId: body.pollId ?? '',
            optionId: body.optionId ?? '',
          })

          return Response.json({ ok: true, poll })
        } catch (error) {
          if (error instanceof PollError) {
            return Response.json(
              {
                ok: false,
                code: error.code,
                message: error.message,
              },
              { status: error.status },
            )
          }

          console.error(error)
          return Response.json(
            {
              ok: false,
              code: 'UNEXPECTED_ERROR',
              message: 'Could not process vote',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
