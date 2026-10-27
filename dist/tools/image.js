import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
export const imageToolDefinitions = [{
        name: 'image_generate',
        description: 'Generate a real image using a configured image provider. This can incur charges and requires explicit approval. Returns the saved file path.',
        parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Description of the image to create.' } }, required: ['prompt'], additionalProperties: false },
    }];
export const IMAGE_MODELS = {
    openai: { default: 'gpt-image-2.5-flare', choices: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08'] },
    gemini: { default: 'gemini-3.1-flash-image', choices: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'] },
    openrouter: { default: 'google/gemini-3.1-flash-image', choices: ['google/gemini-3.1-flash-image', 'google/gemini-3.1-flash-lite-image', 'google/gemini-3-pro-image', 'openai/gpt-5-image'] },
};
const maxImage = 20 * 1024 * 1024;
const maxResponse = 30 * 1024 * 1024;
async function readLimited(response) {
    if (!response.body)
        throw new Error('Image provider returned an empty response.');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > maxResponse) {
                await reader.cancel();
                throw new Error('Image provider response exceeds the size limit.');
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new Error('Image provider returned invalid JSON.');
    }
}
function decode(data, mime) {
    if (typeof data !== 'string' || data.length === 0 || data.length > Math.ceil(maxImage / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
        throw new Error('Image provider returned invalid image data.');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > maxImage)
        throw new Error('Generated image exceeds the size limit.');
    let extension = '';
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        extension = 'png';
    else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        extension = 'jpg';
    else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
        extension = 'webp';
    const expected = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
    if (!extension || (mime !== undefined && mime !== expected[extension]))
        throw new Error('Image provider returned an unsupported or mismatched image type.');
    if (extension === 'png' && (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0 || bytes.readUInt32BE(16) > 16384 || bytes.readUInt32BE(20) > 16384))
        throw new Error('Image provider returned an invalid PNG header.');
    if (extension === 'jpg' && (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9))
        throw new Error('Image provider returned an invalid JPEG.');
    if (extension === 'webp' && (bytes.readUInt32LE(4) + 8 !== bytes.length))
        throw new Error('Image provider returned an invalid WebP.');
    return { bytes, extension };
}
async function save(workspace, bytes, extension, signal) {
    const root = await realpath(workspace);
    const dir = join(root, 'generated-images');
    try {
        await mkdir(dir);
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
    }
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('The images directory must be a real directory inside the workspace.');
    const resolved = await realpath(dir);
    const rel = relative(root, resolved);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
        throw new Error('The images directory is outside the workspace.');
    const id = randomUUID();
    const temp = join(resolved, `.${id}.tmp`);
    const output = join(resolved, `image-${id}.${extension}`);
    try {
        signal?.throwIfAborted();
        await writeFile(temp, bytes, { flag: 'wx', mode: 0o600, signal });
        signal?.throwIfAborted();
        const current = await lstat(dir);
        if (!current.isDirectory() || current.isSymbolicLink() || await realpath(dir) !== resolved || (current.ino && info.ino && current.ino !== info.ino))
            throw new Error('Image output directory changed during save.');
        await rename(temp, output);
    }
    finally {
        await rm(temp, { force: true });
    }
    return output;
}
export async function handleImageTool(name, args, context) {
    if (name !== 'image_generate')
        throw new Error(`Unknown image tool: ${name}`);
    const prompt = args.prompt;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000)
        throw new Error('Image prompt must contain 1–32000 characters.');
    const config = context.imageProvider;
    if (!config || !['openai', 'gemini', 'openrouter'].includes(config.provider) || !config.apiKey?.trim())
        throw new Error('No compatible image provider configured. Choose a configured OpenAI, Gemini, or OpenRouter provider with an API key. Anthropic does not generate images.');
    const model = config.model ?? IMAGE_MODELS[config.provider].default;
    if (!IMAGE_MODELS[config.provider].choices.includes(model))
        throw new Error('Unsupported image model. Select a supported image-generation model in the image provider settings.');
    if (context.signal?.aborted)
        throw new Error('Image generation cancelled.');
    const accepted = await context.approve({ tool: name, description: `Generate one image using ${config.provider} (${model}). This may incur API charges and will save a file in the workspace.`, arguments: { prompt } });
    if (!accepted)
        throw new Error('Image generation was not approved.');
    if (context.signal?.aborted)
        throw new Error('Image generation cancelled.');
    const openai = config.provider === 'openai';
    const router = config.provider === 'openrouter';
    const url = openai ? 'https://api.openai.com/v1/images/generations' : router ? 'https://openrouter.ai/api/v1/chat/completions' : `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
    const headers = { 'Content-Type': 'application/json' };
    if (openai || router)
        headers.Authorization = `Bearer ${config.apiKey}`;
    else
        headers['x-goog-api-key'] = config.apiKey;
    const body = openai ? { model, prompt, n: 1, output_format: 'png' } : router ? { model, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'] } : { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
    let response;
    const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
    try {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
    }
    catch {
        throw new Error(context.signal?.aborted ? 'Image generation cancelled.' : 'Image provider request failed. Check connectivity and provider configuration.');
    }
    if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401)
            throw Object.assign(new Error('Image provider authentication failed (HTTP 401). Check the configured API key.'), { code: 'authentication' });
        throw new Error(`Image provider request failed (HTTP ${response.status}). Check provider access, model availability, and billing.`);
    }
    const json = await readLimited(response);
    const part = openai || router ? undefined : json?.candidates?.flatMap((candidate) => candidate?.content?.parts ?? []).find((item) => item?.inlineData?.data || item?.inline_data?.data);
    const dataUrl = router ? json?.choices?.[0]?.message?.images?.[0]?.image_url?.url : undefined;
    const match = typeof dataUrl === 'string' && dataUrl.length <= maxResponse ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
    if (router && !match)
        throw new Error('OpenRouter returned no supported inline image. Remote image URLs are not fetched.');
    const image = openai ? decode(json?.data?.[0]?.b64_json) : router ? decode(match[2], match[1]) : decode(part?.inlineData?.data ?? part?.inline_data?.data, part?.inlineData?.mimeType ?? part?.inline_data?.mime_type);
    if (context.signal?.aborted)
        throw new Error('Image generation cancelled.');
    const output = await save(context.workspace, image.bytes, image.extension, context.signal);
    return `Generated image saved: ${output}`;
}
//# sourceMappingURL=image.js.map