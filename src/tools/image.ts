import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { ApprovalRequest, ToolDefinition } from '../types.js';

export interface ImageProviderConfig { provider: 'openai' | 'gemini' | 'openrouter'; apiKey: string; model?: string }
export interface ImageToolContext {
  workspace: string;
  approve: (request: ApprovalRequest) => Promise<boolean>;
  imageProvider?: ImageProviderConfig;
  signal?: AbortSignal;
}
export const imageToolDefinitions: ToolDefinition[] = [{
  name: 'image_generate',
  description: 'Generate or edit an image using a configured image provider. This can incur charges and requires explicit approval. Returns the saved file path.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Description of the image to create or edit.' },
      source_image: { type: 'string', description: 'Optional local image path in workspace to edit or reference for image-to-image generation.' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
}];

export const IMAGE_MODELS = {
  openai: { default: 'gpt-image-2.5-flare', choices: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08'] },
  gemini: { default: 'gemini-3.1-flash-image', choices: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'] },
  openrouter: { default: 'google/gemini-3.1-flash-image', choices: ['google/gemini-3.1-flash-image', 'google/gemini-3.1-flash-lite-image', 'google/gemini-3-pro-image', 'openai/gpt-5-image'] },
} as const;
const maxImage = 20 * 1024 * 1024;
const maxResponse = 30 * 1024 * 1024;

async function readLimited(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Image provider returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxResponse) { await reader.cancel(); throw new Error('Image provider response exceeds the size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Image provider returned invalid JSON.'); }
}
function decode(data: unknown, mime?: unknown): { bytes: Buffer; extension: string } {
  if (typeof data !== 'string' || data.length === 0 || data.length > Math.ceil(maxImage / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Image provider returned invalid image data.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > maxImage) throw new Error('Generated image exceeds the size limit.');
  let extension = '';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) extension = 'png';
  else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) extension = 'jpg';
  else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
  const expected: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  if (!extension || (mime !== undefined && mime !== expected[extension])) throw new Error('Image provider returned an unsupported or mismatched image type.');
  if (extension === 'png' && (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0 || bytes.readUInt32BE(16) > 16384 || bytes.readUInt32BE(20) > 16384)) throw new Error('Image provider returned an invalid PNG header.');
  if (extension === 'jpg' && (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)) throw new Error('Image provider returned an invalid JPEG.');
  if (extension === 'webp' && (bytes.readUInt32LE(4) + 8 !== bytes.length)) throw new Error('Image provider returned an invalid WebP.');
  return { bytes, extension };
}
async function save(workspace: string, bytes: Buffer, extension: string, signal?: AbortSignal): Promise<string> {
  const root = await realpath(workspace);
  const dir = join(root, 'generated-images');
  try { await mkdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The images directory must be a real directory inside the workspace.');
  const resolved = await realpath(dir);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('The images directory is outside the workspace.');
  const id = randomUUID(); const temp = join(resolved, `.${id}.tmp`); const output = join(resolved, `image-${id}.${extension}`);
  try {
    signal?.throwIfAborted();
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600, signal });
    signal?.throwIfAborted();
    const current = await lstat(dir);
    if (!current.isDirectory() || current.isSymbolicLink() || await realpath(dir) !== resolved || (current.ino && info.ino && current.ino !== info.ino)) throw new Error('Image output directory changed during save.');
    await rename(temp, output);
  }
  finally { await rm(temp, { force: true }); }
  return output;
}
export async function handleImageTool(name: string, args: Record<string, unknown>, context: ImageToolContext): Promise<string> {
  if (name !== 'image_generate') throw new Error(`Unknown image tool: ${name}`);
  const prompt = args.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) throw new Error('Image prompt must contain 1–32000 characters.');
  const sourceImage = typeof args.source_image === 'string' && args.source_image.trim() ? args.source_image.trim() : undefined;
  const config = context.imageProvider;
  if (!config || !['openai', 'gemini', 'openrouter'].includes(config.provider) || !config.apiKey?.trim()) throw new Error('No compatible image provider configured. Choose a configured OpenAI, Gemini, or OpenRouter provider with an API key. Anthropic does not generate images.');
  const model = config.model ?? IMAGE_MODELS[config.provider].default;
  if (!(IMAGE_MODELS[config.provider].choices as readonly string[]).includes(model)) throw new Error('Unsupported image model. Select a supported image-generation model in the image provider settings.');
  if (context.signal?.aborted) throw new Error('Image generation cancelled.');

  let sourceImageBytes: Buffer | undefined;
  let sourceImageMime: string | undefined;

  if (sourceImage) {
    try {
      const root = await realpath(context.workspace);
      const target = isAbsolute(sourceImage) ? sourceImage : join(root, sourceImage);
      const realTarget = await realpath(target);
      const rel = relative(root, realTarget);
      if (!rel.startsWith('..') && !isAbsolute(rel)) {
        const stat = await lstat(realTarget);
        if (stat.isFile() && stat.size > 0 && stat.size <= maxImage) {
          const buf = await readFile(realTarget);
          let mime = '';
          if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
          else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mime = 'image/jpeg';
          else if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
          else if (sourceImage.toLowerCase().endsWith('.png')) mime = 'image/png';
          else if (sourceImage.toLowerCase().endsWith('.jpg') || sourceImage.toLowerCase().endsWith('.jpeg')) mime = 'image/jpeg';
          else if (sourceImage.toLowerCase().endsWith('.webp')) mime = 'image/webp';

          if (mime) {
            sourceImageBytes = buf;
            sourceImageMime = mime;
          }
        }
      }
    } catch {
      // Proceed without source image if not found or unreadable
    }
  }

  const approvalDesc = sourceImageBytes
    ? `Edit image based on ${sourceImage} using ${config.provider} (${model}). This may incur API charges and will save a file in the workspace.`
    : `Generate one image using ${config.provider} (${model}). This may incur API charges and will save a file in the workspace.`;
  const approvalArgs = sourceImage ? { prompt, source_image: sourceImage } : { prompt };

  const accepted = await context.approve({ tool: name, description: approvalDesc, arguments: approvalArgs });
  if (!accepted) throw new Error('Image generation was not approved.');
  if (context.signal?.aborted) throw new Error('Image generation cancelled.');
  const openai = config.provider === 'openai';
  const router = config.provider === 'openrouter';
  const url = openai ? 'https://api.openai.com/v1/images/generations' : router ? 'https://openrouter.ai/api/v1/chat/completions' : `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (openai || router) headers.Authorization = `Bearer ${config.apiKey}`; else headers['x-goog-api-key'] = config.apiKey;

  let body: Record<string, unknown>;
  if (openai) {
    const finalPrompt = sourceImageBytes
      ? `[Reference source image: ${sourceImage}]: ${prompt}`
      : prompt;
    body = { model, prompt: finalPrompt, n: 1, output_format: 'png' };
  } else if (router) {
    let routerContent: unknown = prompt;
    if (sourceImageBytes && sourceImageMime) {
      routerContent = [
        {
          type: 'image_url',
          image_url: {
            url: `data:${sourceImageMime};base64,${sourceImageBytes.toString('base64')}`,
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ];
    }
    body = { model, messages: [{ role: 'user', content: routerContent }], modalities: ['image', 'text'] };
  } else {
    // Gemini
    const parts: Array<Record<string, unknown>> = [];
    if (sourceImageBytes && sourceImageMime) {
      parts.push({
        inlineData: {
          mimeType: sourceImageMime,
          data: sourceImageBytes.toString('base64'),
        },
      });
    }
    parts.push({ text: prompt });
    body = { contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
  }

  let response: Response;
  const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
  try { response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' }); }
  catch { throw new Error(context.signal?.aborted ? 'Image generation cancelled.' : 'Image provider request failed. Check connectivity and provider configuration.'); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw Object.assign(new Error('Image provider authentication failed (HTTP 401). Check the configured API key.'), { code: 'authentication' });
    throw new Error(`Image provider request failed (HTTP ${response.status}). Check provider access, model availability, and billing.`);
  }
  const json = await readLimited(response) as any;
  const part = openai || router ? undefined : json?.candidates?.flatMap((candidate: any) => candidate?.content?.parts ?? []).find((item: any) => item?.inlineData?.data || item?.inline_data?.data);
  const dataUrl = router ? json?.choices?.[0]?.message?.images?.[0]?.image_url?.url : undefined;
  const match = typeof dataUrl === 'string' && dataUrl.length <= maxResponse ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (router && !match) throw new Error('OpenRouter returned no supported inline image. Remote image URLs are not fetched.');
  const image = openai ? decode(json?.data?.[0]?.b64_json) : router ? decode(match![2], match![1]) : decode(part?.inlineData?.data ?? part?.inline_data?.data, part?.inlineData?.mimeType ?? part?.inline_data?.mime_type);
  if (context.signal?.aborted) throw new Error('Image generation cancelled.');
  const output = await save(context.workspace, image.bytes, image.extension, context.signal);
  return `Generated image saved: ${output}`;
}
