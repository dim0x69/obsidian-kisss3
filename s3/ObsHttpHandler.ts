import { requestUrl, RequestUrlParam } from "obsidian";
import {
	HttpRequest,
	HttpResponse,
	HttpHandlerOptions,
} from "@smithy/types";
import type { RequestHandler, RequestHandlerOutput } from "@smithy/types";
import type { HttpHandler } from "@smithy/protocol-http";

/**
 * Custom HTTP handler that uses Obsidian's requestUrl API to bypass CORS restrictions.
 * This handler implements the AWS SDK v3 RequestHandler interface.
 */
export class ObsHttpHandler implements HttpHandler<{}> {
	private readonly defaultRequestTimeout = 30000; // 30 seconds

	constructor(private options: { requestTimeout?: number } = {}) {}

	/**
	 * Update HTTP client configuration (required by HttpHandler interface)
	 * @internal
	 */
	updateHttpClientConfig(key: never, value: never): void {
		// No-op for our implementation since we don't have configurable HTTP client options
	}

	/**
	 * Get HTTP client configuration (required by HttpHandler interface)
	 * @internal
	 */
	httpHandlerConfigs(): {} {
		return this.options;
	}

	async handle(
		request: HttpRequest,
		handlerOptions?: HttpHandlerOptions
	): Promise<RequestHandlerOutput<HttpResponse>> {
		// Build the URL from the request object
		const url = this.buildUrl(request);

		// Prepare headers
		const headers: Record<string, string> = {};
		if (request.headers) {
			for (const [key, value] of Object.entries(request.headers)) {
				headers[key] = value;
			}
		}

		// Prepare body
		let body: string | ArrayBuffer | undefined;
		if (request.body) {
			if (typeof request.body === "string") {
				body = request.body;
			} else if (request.body instanceof ArrayBuffer) {
				body = request.body;
			} else if (request.body instanceof Uint8Array) {
				body = request.body.buffer.slice(
					request.body.byteOffset,
					request.body.byteOffset + request.body.byteLength
				);
			} else {
				// Convert other types to string
				body = String(request.body);
			}
		}

		// Build request parameters for Obsidian's requestUrl
		const requestParams: RequestUrlParam = {
			url,
			method: request.method || "GET",
			headers,
			body,
			// Don't throw on HTTP errors, let AWS SDK handle status codes
			throw: false,
		};

		try {
			// Make the request using Obsidian's requestUrl API
			const response = await requestUrl(requestParams);

			// Convert Obsidian's response to AWS SDK expected format
			const httpResponse: HttpResponse = {
				statusCode: response.status,
				headers: response.headers,
				// For AWS SDK, the body should be a readable stream or similar
				// We'll use the arrayBuffer and create a simple stream-like object
				body: this.createBodyStream(response.arrayBuffer),
			};

			return {
				response: httpResponse,
			};
		} catch (error) {
			// If requestUrl fails, we need to throw an appropriate error
			// that the AWS SDK can understand
			throw new Error(
				`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Builds the full URL from the HttpRequest object
	 */
	private buildUrl(request: HttpRequest): string {
		const protocol = request.protocol || "https:";
		const hostname = request.hostname;
		const port = request.port ? `:${request.port}` : "";
		const path = request.path || "/";
		
		let url = `${protocol}//${hostname}${port}${path}`;

		// Add query parameters if they exist
		if (request.query) {
			const queryParams = new URLSearchParams();
			for (const [key, value] of Object.entries(request.query)) {
				if (Array.isArray(value)) {
					value.forEach(v => queryParams.append(key, v));
				} else if (value !== null) {
					queryParams.append(key, value);
				}
			}
			const queryString = queryParams.toString();
			if (queryString) {
				url += `?${queryString}`;
			}
		}

		return url;
	}

	/**
	 * Creates a stream-like body object that AWS SDK expects
	 * This handles the response body transformation
	 */
	private createBodyStream(arrayBuffer: ArrayBuffer): any {
		// AWS SDK expects the response body to have a transformToByteArray method
		// and potentially other stream-like methods
		return {
			// The main method AWS SDK uses to get the body content
			transformToByteArray: async (): Promise<Uint8Array> => {
				return new Uint8Array(arrayBuffer);
			},
			
			// Additional methods that might be expected
			transformToString: async (encoding: string = "utf-8"): Promise<string> => {
				const decoder = new TextDecoder(encoding);
				return decoder.decode(arrayBuffer);
			},

			// Stream-like properties
			pipe: () => {
				throw new Error("Streaming not supported in this implementation");
			},
			
			// Make it look like it has the expected interface
			[Symbol.toStringTag]: "ObsidianRequestBody",
		};
	}

	/**
	 * Optional destroy method for cleanup
	 */
	destroy(): void {
		// No cleanup needed for this implementation
	}
}