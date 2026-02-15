export interface PollOptionRecord {
  id: string
  text: string
  votes: number
}

export interface PollRecord {
  id: string
  title: string
  visibility: PollVisibility
  options: Array<PollOptionRecord>
  totalVotes: number
  createdAt: string
  expiresAt: string
}

export type PollVisibility = 'public' | 'private'

export interface PollViewOption {
  id: string
  text: string
  votes: number
  percent: number
}

export interface PollView {
  id: string
  title: string
  visibility: PollVisibility
  options: Array<PollViewOption>
  totalVotes: number
  createdAt: string
  expiresAt: string
  hasVoted: boolean
}

export interface PollSummary {
  id: string
  title: string
  totalVotes: number
  optionCount: number
  createdAt: string
  expiresAt: string
  pollPath: string
}

export interface CreatePollInput {
  title: string
  options: Array<string>
  visibility?: PollVisibility
}

export interface VoteInput {
  pollId: string
  optionId: string
}

export interface VoteUpdatePayload {
  type: 'vote_update'
  pollId: string
  totalVotes: number
  options: Array<{
    id: string
    votes: number
    percent: number
  }>
  updatedAt: string
}

export interface PublicListUpdatePayload {
  type: 'public_list_update'
  pollId: string
  reason: 'poll_created' | 'poll_updated'
  updatedAt: string
}
