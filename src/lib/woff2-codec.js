import { FontCodecError, FontCodecError as FontCodecError$1, createRuntime, integerOption, validateFont } from "./font-codecs-core.js";
//#region packages/woff2-codec/src/index.ts
const wasmUrl = new URL("woff2.wasm", import.meta.url);
async function createWoff2Codec(options = {}) {
	return createWoff2CodecFromSource(options.wasm ?? wasmUrl, options);
}
async function createWoff2CodecFromSource(source, options = {}) {
	const runtime = await createRuntime(source, options);
	return {
		dispose: runtime.dispose,
		[Symbol.dispose]: runtime[Symbol.dispose],
		encode(input, options = {}) {
			validateFont(input, "sfnt", runtime.maxInputBytes);
			const quality = integerOption(options.quality ?? 11, "quality", 0, 11);
			if (options.allowTransforms !== void 0 && typeof options.allowTransforms !== "boolean") throw new FontCodecError$1("INVALID_OPTION", "allowTransforms must be boolean");
			if (options.metadata !== void 0 && !(options.metadata instanceof Uint8Array)) throw new FontCodecError$1("INVALID_OPTION", "metadata must be Uint8Array");
			return {
				data: runtime.run(input, 1, quality, options.allowTransforms === false ? 0 : 1, options.metadata).data,
				warnings: []
			};
		},
		decode(input) {
			validateFont(input, "woff2", runtime.maxInputBytes);
			return {
				data: runtime.run(input, 2).data,
				warnings: []
			};
		}
	};
}
//#endregion
export { FontCodecError, createWoff2Codec, createWoff2CodecFromSource, wasmUrl };

//# sourceMappingURL=index.js.map