import { createFileRoute } from "@tanstack/react-router";
import type { CreatePollInput, VoteInput } from "@/lib/poll-types";
import {
	createPoll,
	getPollForViewer,
	listPublicPolls,
	PollError,
	submitVote,
} from "@/lib/server/polls";

type JsonRpcId = number | string | null;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

const SERVER_NAME = "qikpoll-mcp";
const SERVER_VERSION = "0.3.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
	{
		name: "create_poll",
		description: "Create a new poll.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				options: {
					type: "array",
					items: { type: "string" },
					minItems: 2,
					maxItems: 8,
				},
				visibility: {
					type: "string",
					enum: ["public", "private"],
					default: "public",
				},
			},
			required: ["title", "options"],
			additionalProperties: false,
		},
	},
	{
		name: "list_public_polls",
		description: "List recent public polls.",
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "number",
					minimum: 1,
					maximum: 100,
					default: 24,
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "get_poll",
		description: "Fetch poll details and current results by poll id.",
		inputSchema: {
			type: "object",
			properties: {
				pollId: { type: "string" },
			},
			required: ["pollId"],
			additionalProperties: false,
		},
	},
	{
		name: "vote_poll",
		description: "Submit a vote to a poll.",
		inputSchema: {
			type: "object",
			properties: {
				pollId: { type: "string" },
				optionId: { type: "string" },
			},
			required: ["pollId", "optionId"],
			additionalProperties: false,
		},
	},
] as const;

export const Route = createFileRoute("/api/mcp")({
	server: {
		handlers: {
			GET: async () => {
				return Response.json({
					ok: true,
					name: SERVER_NAME,
					version: SERVER_VERSION,
					endpoint: "/api/mcp",
				});
			},
			POST: async ({ request }) => {
				let message: JsonRpcRequest;
				try {
					message = (await request.json()) as JsonRpcRequest;
				} catch {
					return toJsonRpcErrorResponse(null, -32700, "Parse error");
				}

				const response = await handleMcpMessage(request, message);
				if (!response) {
					return new Response(null, { status: 204 });
				}

				return Response.json(response);
			},
		},
	},
});

async function handleMcpMessage(request: Request, message: JsonRpcRequest) {
	if (message?.jsonrpc !== "2.0" || typeof message?.method !== "string") {
		if (message?.id === undefined) {
			return null;
		}

		return toJsonRpcError(message.id, -32600, "Invalid Request");
	}

	const id = message.id ?? null;
	if (message.method === "notifications/initialized") {
		return null;
	}

	if (message.method === "ping") {
		return toJsonRpcResult(id, {});
	}

	if (message.method === "initialize") {
		const params = asRecord(message.params);
		const protocolVersion =
			typeof params.protocolVersion === "string"
				? params.protocolVersion
				: DEFAULT_PROTOCOL_VERSION;

		return toJsonRpcResult(id, {
			protocolVersion,
			capabilities: {
				tools: {
					listChanged: false,
				},
			},
			serverInfo: {
				name: SERVER_NAME,
				version: SERVER_VERSION,
			},
			instructions:
				"QikPoll end-user MCP tools. Create polls, vote, fetch poll results, and list public polls.",
		});
	}

	if (message.method === "tools/list") {
		return toJsonRpcResult(id, { tools: TOOLS });
	}

	if (message.method === "tools/call") {
		const params = asRecord(message.params);
		const result = await runToolCall(request, params);
		return toJsonRpcResult(id, result);
	}

	return toJsonRpcError(id, -32601, `Method not found: ${message.method}`);
}

function toJsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
	return {
		jsonrpc: "2.0",
		id,
		result,
	};
}

function toJsonRpcError(
	id: JsonRpcId,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcResponse {
	return {
		jsonrpc: "2.0",
		id,
		error: {
			code,
			message,
			data,
		},
	};
}

function toJsonRpcErrorResponse(
	id: JsonRpcId,
	code: number,
	message: string,
	data?: unknown,
) {
	return Response.json(toJsonRpcError(id, code, message, data));
}

function asRecord(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}

	return value as Record<string, unknown>;
}

function requireString(params: Record<string, unknown>, key: string) {
	const value = params[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PollError(
			400,
			"INVALID_ARGUMENT",
			`${key} must be a non-empty string`,
		);
	}

	return value;
}

function requireStringArray(params: Record<string, unknown>, key: string) {
	const value = params[key];
	if (!Array.isArray(value)) {
		throw new PollError(400, "INVALID_ARGUMENT", `${key} must be an array`);
	}

	const items = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);

	if (items.length < 2) {
		throw new PollError(
			400,
			"INVALID_ARGUMENT",
			`${key} must include at least 2 options`,
		);
	}

	return items;
}

function toToolResult(payload: unknown) {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(payload, null, 2),
			},
		],
		structuredContent: payload,
	};
}

function toToolError(error: unknown) {
	if (error instanceof PollError) {
		return {
			content: [
				{
					type: "text",
					text: `${error.code}: ${error.message}`,
				},
			],
			isError: true,
			structuredContent: {
				code: error.code,
				message: error.message,
				status: error.status,
			},
		};
	}

	console.error(error);

	return {
		content: [
			{
				type: "text",
				text: "UNEXPECTED_ERROR: Request failed",
			},
		],
		isError: true,
	};
}

async function runToolCall(request: Request, params: Record<string, unknown>) {
	try {
		const name = requireString(params, "name");
		const args = asRecord(params.arguments);

		switch (name) {
			case "create_poll": {
				const input: CreatePollInput = {
					title: requireString(args, "title"),
					options: requireStringArray(args, "options"),
					visibility: args.visibility === "private" ? "private" : "public",
				};
				const result = await createPoll(request, input);
				return toToolResult({
					ok: true,
					poll: result.poll,
					pollPath: result.pollPath,
				});
			}
			case "list_public_polls": {
				const limit = typeof args.limit === "number" ? args.limit : 24;
				const polls = await listPublicPolls(limit);
				return toToolResult({
					ok: true,
					polls,
				});
			}
			case "get_poll": {
				const poll = await getPollForViewer(
					request,
					requireString(args, "pollId"),
				);
				return toToolResult({
					ok: true,
					poll,
				});
			}
			case "vote_poll": {
				const input: VoteInput = {
					pollId: requireString(args, "pollId"),
					optionId: requireString(args, "optionId"),
				};
				const poll = await submitVote(request, input);
				return toToolResult({
					ok: true,
					poll,
				});
			}
			default:
				return {
					content: [
						{
							type: "text",
							text: `Unknown tool: ${name}`,
						},
					],
					isError: true,
				};
		}
	} catch (error) {
		return toToolError(error);
	}
}
