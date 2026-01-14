import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildUserContent } from '../src/utils/attachments';
import { AttachmentRecord } from '../src/types';

const createTempFile = async (content: string) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pro-chat-'));
  const filePath = path.join(dir, 'image.png');
  await fs.promises.writeFile(filePath, content);
  return { dir, filePath };
};

describe('buildUserContent', () => {
  it('returns string when no images or vision disabled', async () => {
    const attachments: AttachmentRecord[] = [
      {
        id: '1',
        threadId: 't1',
        messageId: null,
        filename: 'notes.txt',
        path: 'notes.txt',
        mimeType: 'text/plain',
        size: 5,
        kind: 'file',
        createdAt: new Date(),
      },
    ];

    const content = await buildUserContent('hello', attachments, false, '/tmp');
    expect(typeof content).toBe('string');
    expect(content).toContain('hello');
    expect(content).toContain('Attached file');
  });

  it('builds multi-part content with images when supported', async () => {
    const { dir, filePath } = await createTempFile('fake');
    const attachments: AttachmentRecord[] = [
      {
        id: '1',
        threadId: 't1',
        messageId: null,
        filename: 'image.png',
        path: filePath,
        mimeType: 'image/png',
        size: 4,
        kind: 'image',
        createdAt: new Date(),
      },
    ];
    const content = await buildUserContent('hello', attachments, true, dir);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string }>;
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('image_url');
  });
});
