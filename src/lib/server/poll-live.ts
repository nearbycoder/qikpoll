import type { Peer } from "crossws";
import type {
  PollRecord,
  PublicListUpdatePayload,
  VoteUpdatePayload,
} from "../poll-types";
import { getRedisClient } from "./redis";

const LIVE_CHANNEL_PREFIX = "poll:events:";
const PUBLIC_LIST_CHANNEL = "poll:list:events";

const peersByPollId = new Map<string, Set<Peer>>();
const publicListPeers = new Set<Peer>();
let subscriptionStartPromise: Promise<void> | null = null;

function getChannelName(pollId: string) {
  return `${LIVE_CHANNEL_PREFIX}${pollId}`;
}

function toVoteUpdateEvent(poll: PollRecord): VoteUpdatePayload {
  return {
    type: "vote_update",
    pollId: poll.id,
    totalVotes: poll.totalVotes,
    updatedAt: new Date().toISOString(),
    options: poll.options.map((option) => ({
      id: option.id,
      votes: option.votes,
      percent:
        poll.totalVotes === 0 ? 0 : Math.round((option.votes / poll.totalVotes) * 100),
    })),
  };
}

function broadcastToPeers(pollId: string, payload: VoteUpdatePayload) {
  const peers = peersByPollId.get(pollId);
  if (!peers || peers.size === 0) {
    return;
  }

  const serialized = JSON.stringify(payload);

  for (const peer of peers) {
    try {
      peer.send(serialized);
    } catch {
      peers.delete(peer);
    }
  }

  if (peers.size === 0) {
    peersByPollId.delete(pollId);
  }
}

function broadcastToPublicListPeers(payload: PublicListUpdatePayload) {
  if (publicListPeers.size === 0) {
    return;
  }

  const serialized = JSON.stringify(payload);

  for (const peer of publicListPeers) {
    try {
      peer.send(serialized);
    } catch {
      publicListPeers.delete(peer);
    }
  }
}

async function ensureSubscriptionStarted() {
  if (subscriptionStartPromise) {
    return subscriptionStartPromise;
  }

  subscriptionStartPromise = (async () => {
    const redis = await getRedisClient();
    const subscriber = redis.duplicate();

    subscriber.on("error", (error) => {
      console.error("Live update Redis subscriber error", error);
    });

    await subscriber.connect();
    await subscriber.pSubscribe(`${LIVE_CHANNEL_PREFIX}*`, (message, channel) => {
      const pollId = channel.slice(LIVE_CHANNEL_PREFIX.length);
      if (!pollId) {
        return;
      }

      try {
        const payload = JSON.parse(message) as VoteUpdatePayload;
        broadcastToPeers(pollId, payload);
      } catch (error) {
        console.error("Failed to parse live vote update payload", error);
      }
    });

    await subscriber.subscribe(PUBLIC_LIST_CHANNEL, (message) => {
      try {
        const payload = JSON.parse(message) as PublicListUpdatePayload;
        if (payload.type !== "public_list_update") {
          return;
        }

        broadcastToPublicListPeers(payload);
      } catch (error) {
        console.error("Failed to parse public list update payload", error);
      }
    });
  })().catch((error) => {
    subscriptionStartPromise = null;
    throw error;
  });

  return subscriptionStartPromise;
}

export async function attachLivePeer(pollId: string, peer: Peer) {
  await ensureSubscriptionStarted();

  const peers = peersByPollId.get(pollId);
  if (peers) {
    peers.add(peer);
    return;
  }

  peersByPollId.set(pollId, new Set([peer]));
}

export function detachLivePeer(pollId: string, peer: Peer) {
  const peers = peersByPollId.get(pollId);
  if (!peers) {
    return;
  }

  peers.delete(peer);

  if (peers.size === 0) {
    peersByPollId.delete(pollId);
  }
}

export async function attachPublicListPeer(peer: Peer) {
  await ensureSubscriptionStarted();
  publicListPeers.add(peer);
}

export function detachPublicListPeer(peer: Peer) {
  publicListPeers.delete(peer);
}

export async function publishVoteUpdate(poll: PollRecord) {
  const payload = toVoteUpdateEvent(poll);
  const redis = await getRedisClient();

  await redis.publish(getChannelName(poll.id), JSON.stringify(payload));
}

export async function publishPublicListUpdate(
  pollId: string,
  reason: PublicListUpdatePayload["reason"],
) {
  const payload: PublicListUpdatePayload = {
    type: "public_list_update",
    pollId,
    reason,
    updatedAt: new Date().toISOString(),
  };
  const redis = await getRedisClient();

  await redis.publish(PUBLIC_LIST_CHANNEL, JSON.stringify(payload));
}
