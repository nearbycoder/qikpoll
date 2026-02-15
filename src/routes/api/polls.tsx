import { createFileRoute } from '@tanstack/react-router'
import {
  PollError,
  createPoll,
  getPollForViewer,
  listPublicPolls,
} from '@/lib/server/polls'
import type { CreatePollInput } from '@/lib/poll-types'

export const Route = createFileRoute('/api/polls')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const pollId = url.searchParams.get('id')

          if (!pollId) {
            const limit = Number(url.searchParams.get('limit') ?? '24')
            const polls = await listPublicPolls(limit)
            return Response.json({ ok: true, polls })
          }

          const poll = await getPollForViewer(request, pollId)
          return Response.json({ ok: true, poll })
        } catch (error) {
          return toErrorResponse(error)
        }
      },
      POST: async ({ request }) => {
        try {
          let body: Partial<CreatePollInput>
          try {
            body = (await request.json()) as Partial<CreatePollInput>
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

          const result = await createPoll(request, {
            title: body.title ?? '',
            options: body.options ?? [],
            visibility: body.visibility,
          })

          return Response.json({
            ok: true,
            poll: result.poll,
            pollPath: result.pollPath,
          })
        } catch (error) {
          return toErrorResponse(error)
        }
      },
    },
  },
})

function toErrorResponse(error: unknown) {
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
      message: 'Something went wrong',
    },
    { status: 500 },
  )
}
