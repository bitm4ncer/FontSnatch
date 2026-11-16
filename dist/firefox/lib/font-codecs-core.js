//#region packages/web-font-codecs-core/src/index.ts
var FontCodecError = class extends Error {
	code;
	nativeStatus;
	constructor(code, message, options) {
		super(message, options);
		this.name = "FontCodecError";
		this.code = code;
		this.nativeStatus = options?.nativeStatus;
	}
};
function integerOption(value, name, min, max) {
	if (!Number.isInteger(value) || value < min || value > max) throw new FontCodecError("INVALID_OPTION", `${name} must be an integer from ${min} to ${max}`);
	return value;
}
function detectFormat(data) {
	if (!(data instanceof Uint8Array) || data.byteLength < 4) throw new FontCodecError("INVALID_INPUT", "Expected font bytes with a four-byte signature");
	const magic = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
	if (magic === 2001684038) return "woff1";
	if (magic === 2001684018) return "woff2";
	if (magic === 65536 || magic === 1330926671 || magic === 1953658213) return "sfnt";
	if (magic === 1953784678) throw new FontCodecError("UNSUPPORTED_FORMAT", "Font collections (TTC/OTC) are not supported; extract a single face first");
	throw new FontCodecError("UNSUPPORTED_FORMAT", "Unrecognized font signature");
}
/** Structural validation protects the historical Mozilla encoder before it reads table records. */
function validateFont(data, expected, maximum) {
	if (!(data instanceof Uint8Array)) throw new FontCodecError("INVALID_INPUT", "Expected Uint8Array font bytes");
	if (data.byteLength > maximum) throw new FontCodecError("LIMIT_EXCEEDED", `Input exceeds ${maximum} bytes`);
	const format = detectFormat(data);
	if (format !== expected) throw new FontCodecError("UNSUPPORTED_FORMAT", `Expected ${expected}, received ${format}`);
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const invalid = (message) => {
		throw new FontCodecError("INVALID_INPUT", message);
	};
	if (format !== "sfnt") {
		const header = format === "woff1" ? 44 : 48;
		if (data.length < header) invalid("Truncated WOFF header");
		if (view.getUint32(8) !== data.length) invalid("WOFF declared length does not match input");
		if (view.getUint16(14) !== 0 || view.getUint16(12) === 0) invalid("Invalid WOFF header");
		const flavor = view.getUint32(4);
		if (flavor === 1953784678) throw new FontCodecError("UNSUPPORTED_FORMAT", "WOFF collections are not supported");
		if (![
			65536,
			1330926671,
			1953658213
		].includes(flavor)) invalid("Unsupported WOFF SFNT flavor");
		return;
	}
	if (data.length < 12) invalid("Truncated SFNT header");
	const count = view.getUint16(4), end = 12 + count * 16;
	if (count === 0 || end > data.length) invalid("Invalid SFNT table directory");
	let previous = -1;
	const ranges = [];
	for (let pos = 12; pos < end; pos += 16) {
		const tag = view.getUint32(pos), offset = view.getUint32(pos + 8), length = view.getUint32(pos + 12);
		if (tag <= previous) invalid("SFNT table directory must be sorted with unique tags");
		previous = tag;
		if (offset < end || offset > data.length || length > data.length - offset) invalid("SFNT table extends outside input");
		if ((tag === 1751474532 || tag === 1651008868) && length < 54) invalid("Truncated head table");
		if (length) ranges.push([offset, offset + length]);
	}
	ranges.sort((a, b) => a[0] - b[0]);
	for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) invalid("Overlapping SFNT tables");
}
async function createRuntime(source, options = {}) {
	const maxInputBytes = integerOption(options.maxInputBytes ?? 536870912, "maxInputBytes", 1, 536870912);
	const maxOutputBytes = integerOption(options.maxOutputBytes ?? 536870912, "maxOutputBytes", 1, 536870912);
	let native;
	try {
		let bytes = await source;
		if (typeof bytes === "string" || bytes instanceof URL) bytes = await fetch(bytes);
		if (bytes instanceof Response) {
			if (!bytes.ok) throw new Error(`WASM request failed: HTTP ${bytes.status}`);
			if (!bytes.body) throw new Error("WASM response has no body");
			bytes = bytes.body;
		}
		if (bytes instanceof ReadableStream) bytes = await WebAssembly.compileStreaming(new Response(bytes, { headers: { "content-type": "application/wasm" } }));
		const imports = {
			wasi_snapshot_preview1: {
				proc_exit: (code) => {
					throw new Error(`WASM exited (${code})`);
				},
				fd_write: () => 0,
				fd_close: () => 0,
				fd_seek: () => 0,
				environ_sizes_get: () => 0,
				environ_get: () => 0
			},
			env: { emscripten_notify_memory_growth: () => {} }
		};
		const module = bytes instanceof WebAssembly.Module ? bytes : await WebAssembly.compile(bytes);
		native = (await WebAssembly.instantiate(module, imports)).exports;
		native._initialize();
	} catch (cause) {
		throw new FontCodecError("WASM_INIT", "Could not initialize the font codec", { cause });
	}
	const dispose = () => {
		native = void 0;
	};
	return {
		maxInputBytes,
		maxOutputBytes,
		dispose,
		[Symbol.dispose]: dispose,
		run(input, operation, a = 0, b = 0, metadata = /* @__PURE__ */ new Uint8Array(), privateData = /* @__PURE__ */ new Uint8Array(), engine = 0, iterations = 15) {
			if (!native) throw new FontCodecError("DISPOSED", "Codec has been disposed");
			if (input.length + metadata.length + privateData.length > maxInputBytes) throw new FontCodecError("LIMIT_EXCEEDED", "Combined input and auxiliary data exceed input limit");
			const n = native, allocations = [];
			try {
				const put = (data) => {
					if (!data.length) return 0;
					const ptr = n.malloc(data.length + 4);
					if (!ptr) throw new FontCodecError("LIMIT_EXCEEDED", "WASM memory allocation failed");
					allocations.push(ptr);
					const heap = new Uint8Array(n.memory.buffer);
					heap.set(data, ptr);
					heap.fill(0, ptr + data.length, ptr + data.length + 4);
					return ptr;
				};
				const pointer = n.codec_run(put(input), input.length, operation, maxOutputBytes, a, b, put(metadata), metadata.length, put(privateData), privateData.length, engine, iterations);
				const status = n.codec_status(), length = n.codec_size();
				if (status & 255) throw new FontCodecError((status & 255) === 128 || (status & 255) === 1 ? "LIMIT_EXCEEDED" : "CODEC_FAILURE", `Native codec rejected input (status ${status & 255})`, { nativeStatus: status });
				if (length > maxOutputBytes) throw new FontCodecError("LIMIT_EXCEEDED", "Output exceeds configured limit");
				return {
					data: new Uint8Array(n.memory.buffer, pointer, length).slice(),
					warningFlags: status & -256
				};
			} catch (cause) {
				if (cause instanceof FontCodecError) throw cause;
				native = void 0;
				throw new FontCodecError("CODEC_FAILURE", "WASM codec failed; create a new instance", { cause });
			} finally {
				if (native === n) {
					n.codec_release();
					for (const ptr of allocations) n.free(ptr);
				}
			}
		}
	};
}
//#endregion
export { FontCodecError, createRuntime, detectFormat, integerOption, validateFont };

//# sourceMappingURL=index.js.map