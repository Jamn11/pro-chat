import fs from 'fs';
import path from 'path';
import { AttachmentRecord } from '../types';

type ImagePart = { type: 'image_url'; image_url: { url: string } };
type TextPart = { type: 'text'; text: string };

function attachmentNote(attachment: AttachmentRecord): string {
  return `[Attached ${attachment.kind}: ${attachment.filename}]`;
}

export async function buildUserContent(
  text: string,
  attachments: AttachmentRecord[],
  supportsVision: boolean,
  storageRoot: string,
): Promise<string | Array<TextPart | ImagePart>> {
  const notes = attachments.filter((a) => a.kind !== 'image').map(attachmentNote);
  const baseText = [text, ...notes].filter(Boolean).join('\n');

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
