class PollMcpError extends Error {
	code: string;
	status?: number;
	details?: unknown;

	constructor(
		code: string,
		message: string,
		status?: number,
		details?: unknown,
	) {
		super(message);
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

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
const SERVER_VERSION = "0.2.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const API_BASE_URL = normalizeApiBaseUrl(process.env.POLL_API_BASE_URL);

let hasInitialized = false;
let buffer = Buffer.alloc(0);
const cookieJar = new Map<string, string>();

const tools = [
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

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk as Buffer]);
	processIncomingMessages();
});

process.stdin.on("end", () => {
	process.exit(0);
});

function processIncomingMessages() {
	while (true) {
		const headerEndIndex = buffer.indexOf("\r\n\r\n");
		if (headerEndIndex < 0) {
			return;
		}

		const rawHeader = buffer.subarray(0, headerEndIndex).toString("utf8");
		const contentLengthMatch = rawHeader.match(/content-length:\s*(\d+)/i);
		if (!contentLengthMatch) {
			buffer = buffer.subarray(headerEndIndex + 4);
			continue;
		}

		const contentLength = Number(contentLengthMatch[1]);
		const bodyStart = headerEndIndex + 4;
		const bodyEnd = bodyStart + contentLength;
		if (buffer.length < bodyEnd) {
			return;
		}

		const rawBody = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
		buffer = buffer.subarray(bodyEnd);

		let message: JsonRpcRequest;
		try {
			message = JSON.parse(rawBody) as JsonRpcRequest;
		} catch {
			continue;
		}

		void handleMessage(message);
	}
}

function sendMessage(message: JsonRpcResponse | Record<string, unknown>) {
	const payload = JSON.stringify(message);
	const framed = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\nContent-Type: application/json\r\n\r\n${payload}`;
	process.stdout.write(framed);
}

function sendResult(id: JsonRpcId, result: unknown) {
	sendMessage({
		jsonrpc: "2.0",
		id,
		result,
	} satisfies JsonRpcResponse);
}

function sendError(
	id: JsonRpcId,
	code: number,
	message: string,
	data?: unknown,
) {
	sendMessage({
		jsonrpc: "2.0",
		id,
		error: {
			code,
			message,
			data,
		},
	} satisfies JsonRpcResponse);
}

function asRecord(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function normalizeApiBaseUrl(rawBaseUrl: string | undefined) {
	const baseUrl = (rawBaseUrl ?? "http://localhost:3000").trim();
	const normalized = baseUrl.replace(/\/+$/, "");

	if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
		throw new Error(
			`POLL_API_BASE_URL must start with http:// or https://. Received: ${baseUrl}`,
		);
	}

	return normalized;
}

function requireString(params: Record<string, unknown>, key: string) {
	const value = params[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PollMcpError(
			"INVALID_ARGUMENT",
			`${key} must be a non-empty string`,
		);
	}

	return value;
}

function requireStringArray(params: Record<string, unknown>, key: string) {
	const value = params[key];
	if (!Array.isArray(value)) {
		throw new PollMcpError("INVALID_ARGUMENT", `${key} must be an array`);
	}

	const items = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);

	if (items.length < 2) {
		throw new PollMcpError(
			"INVALID_ARGUMENT",
			`${key} must include at least 2 options`,
		);
	}

	return items;
}

function readSetCookies(headers: Headers) {
	const headerWithSetCookie = headers as Headers & {
		getSetCookie?: () => Array<string>;
	};
	if (typeof headerWithSetCookie.getSetCookie === "function") {
		return headerWithSetCookie.getSetCookie();
	}

	const setCookie = headers.get("set-cookie");
	return setCookie ? [setCookie] : [];
}

function absorbCookies(headers: Headers) {
	for (const cookieValue of readSetCookies(headers)) {
		const pair = cookieValue.split(";")[0];
		if (!pair) {
			continue;
		}

		const delimiterIndex = pair.indexOf("=");
		if (delimiterIndex < 0) {
			continue;
		}

		const name = pair.slice(0, delimiterIndex).trim();
		const value = pair.slice(delimiterIndex + 1).trim();
		if (!name) {
			continue;
		}

		cookieJar.set(name, value);
	}
}

function getCookieHeaderValue() {
	if (cookieJar.size === 0) {
		return "";
	}

	return Array.from(cookieJar.entries())
		.map(([name, value]) => `${name}=${value}`)
		.join("; ");
}

async function callPollApi(path: string, init?: RequestInit) {
	const headers = new Headers(init?.headers);
	headers.set("accept", "application/json");

	const cookieHeader = getCookieHeaderValue();
	if (cookieHeader.length > 0) {
		headers.set("cookie", cookieHeader);
	}

	if (init?.body && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}

	let response: Response;
	try {
		response = await fetch(`${API_BASE_URL}${path}`, {
			...init,
			headers,
		});
	} catch (error) {
		throw new PollMcpError(
			"POLL_API_UNREACHABLE",
			`Could not connect to poll API at ${API_BASE_URL}`,
			undefined,
			error,
		);
	}

	absorbCookies(response.headers);

	let payload: unknown = {};
	const rawBody = await response.text();
	if (rawBody.trim().length > 0) {
		try {
			payload = JSON.parse(rawBody) as unknown;
		} catch {
			payload = { message: rawBody };
		}
	}

	const body = asRecord(payload);
	if (!response.ok || body.ok === false) {
		throw new PollMcpError(
			typeof body.code === "string" ? body.code : "POLL_API_ERROR",
			typeof body.message === "string"
				? body.message
				: `API request failed with status ${response.status}`,
			response.status,
			body,
		);
	}

	return payload;
}

function formatToolResult(payload: unknown) {
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

async function handleToolsCall(params: Record<string, unknown>) {
	const toolName = requireString(params, "name");
	const args = asRecord(params.arguments);

	try {
		switch (toolName) {
			case "create_poll": {
				const result = await callPollApi("/api/polls", {
					method: "POST",
					body: JSON.stringify({
						title: requireString(args, "title"),
						options: requireStringArray(args, "options"),
						visibility: args.visibility === "private" ? "private" : "public",
					}),
				});
				return formatToolResult(result);
			}
			case "list_public_polls": {
				const limit = typeof args.limit === "number" ? args.limit : 24;
				const result = await callPollApi(
					`/api/polls?limit=${encodeURIComponent(String(limit))}`,
					{
						method: "GET",
					},
				);
				return formatToolResult(result);
			}
			case "get_poll": {
				const pollId = requireString(args, "pollId");
				const result = await callPollApi(
					`/api/polls?id=${encodeURIComponent(pollId)}`,
					{
						method: "GET",
					},
				);
				return formatToolResult(result);
			}
			case "vote_poll": {
				const result = await callPollApi("/api/polls/vote", {
					method: "POST",
					body: JSON.stringify({
						pollId: requireString(args, "pollId"),
						optionId: requireString(args, "optionId"),
					}),
				});
				return formatToolResult(result);
			}
			default:
				return {
					content: [
						{
							type: "text",
							text: `Unknown tool: ${toolName}`,
						},
					],
					isError: true,
				};
		}
	} catch (error) {
		if (error instanceof PollMcpError) {
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
					details: error.details,
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
}

async function handleMessage(message: JsonRpcRequest) {
	if (message?.jsonrpc !== "2.0" || typeof message?.method !== "string") {
		if (message?.id !== undefined) {
			sendError(message.id, -32600, "Invalid Request");
		}
		return;
	}

	const id = message.id ?? null;

	if (message.method === "notifications/initialized") {
		return;
	}

	if (message.method === "ping") {
		sendResult(id, {});
		return;
	}

	if (message.method === "initialize") {
		const params = asRecord(message.params);
		const protocolVersion =
			typeof params.protocolVersion === "string"
				? params.protocolVersion
				: DEFAULT_PROTOCOL_VERSION;

		hasInitialized = true;
		sendResult(id, {
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
				"Provides QikPoll tools backed by the HTTP API. Set POLL_API_BASE_URL to target your deployment.",
		});
		return;
	}

	if (
		!hasInitialized &&
		(message.method === "tools/list" || message.method === "tools/call")
	) {
		sendError(id, -32002, "Server not initialized");
		return;
	}

	if (message.method === "tools/list") {
		sendResult(id, { tools });
		return;
	}

	if (message.method === "tools/call") {
		const params = asRecord(message.params);
		const result = await handleToolsCall(params);
		sendResult(id, result);
		return;
	}

	sendError(id, -32601, `Method not found: ${message.method}`);
}
