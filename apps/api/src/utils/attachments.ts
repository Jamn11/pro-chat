import fs from 'fs';
import path from 'path';
import { AttachmentRecord } from '../types';

type ImagePart = { type: 'image_url'; image_url: { url: string } };
type TextPart = { type: 'text'; text: string };

const MAX_TEXT_BYTES = 200_000;
const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-typescript',
  'application/x-javascript',
  'application/x-sh',
  'application/x-yaml',
  'application/yaml',
  'application/x-toml',
  'application/toml',
  'text/markdown',
]);
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.yml',
  '.yaml',
  '.toml',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.swift',
  '.kt',
  '.sh',
  '.sql',
  '.log',
]);

function attachmentNote(attachment: AttachmentRecord): string {
  return `[Attached ${attachment.kind}: ${attachment.filename}]`;
}

const isTextAttachment = (attachment: AttachmentRecord): boolean => {
  if (attachment.kind === 'image') return false;
  if (attachment.mimeType.startsWith('text/')) return true;
  if (TEXT_MIME_TYPES.has(attachment.mimeType)) return true;
  const ext = path.extname(attachment.filename).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
};

export async function buildUserContent(
  text: string,
  attachments: AttachmentRecord[],
  supportsVision: boolean,
  storageRoot: string,
): Promise<string | Array<TextPart | ImagePart>> {
  const textAttachments = attachments.filter((a) => a.kind !== 'image');
  const textBlocks = await Promise.all(
    textAttachments.map(async (attachment) => {
      if (!isTextAttachment(attachment)) {
        return attachmentNote(attachment);
      }
      try {
        const filePath = path.isAbsolute(attachment.path)
          ? attachment.path
          : path.join(storageRoot, attachment.path);
        const buffer = await fs.promises.readFile(filePath);
        const sliced = buffer.length > MAX_TEXT_BYTES ? buffer.slice(0, MAX_TEXT_BYTES) : buffer;
        const content = sliced.toString('utf-8').trimEnd();
        const truncatedNote = buffer.length > MAX_TEXT_BYTES ? '\n\n[Truncated]' : '';
        return `---\n[Attachment: ${attachment.filename}]\n${content}${truncatedNote}\n---`;
      } catch (error) {
        return attachmentNote(attachment);
      }
    }),
  );
  const baseText = [text, ...textBlocks].filter(Boolean).join('\n\n');

  const imageAttachments = supportsVision
    ? attachments.filter((a) => a.kind === 'image')
    : [];

  if (imageAttachments.length === 0) {
    return baseText;
  }

  const parts: Array<TextPart | ImagePart> = [{ type: 'text', text: baseText }];

  for (const attachment of imageAttachments) {
    const filePath = path.isAbsolute(attachment.path)
      ? attachment.path
      : path.join(storageRoot, attachment.path);
    const buffer = await fs.promises.readFile(filePath);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${attachment.mimeType};base64,${base64}`;
    parts.push({ type: 'image_url', image_url: { url: dataUrl } });
  }

  return parts;
}
