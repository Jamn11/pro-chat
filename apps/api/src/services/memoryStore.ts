import fs from 'fs';
import path from 'path';

export class MemoryStore {
  private memoryPath: string;

  constructor(memoryPath: string) {
    this.memoryPath = memoryPath;
  }

  get path(): string {
    return this.memoryPath;
  }

  async ensureExists(): Promise<void> {
    const dir = path.dirname(this.memoryPath);
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      await fs.promises.access(this.memoryPath);
    } catch (error) {
      await fs.promises.writeFile(this.memoryPath, '', 'utf-8');
    }
  }

  async read(): Promise<string | null> {
    try {
      const content = await fs.promises.readFile(this.memoryPath, 'utf-8');
      const trimmed = content.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.ensureExists();
        return null;
      }
      throw error;
    }
  }

  async write(content: string): Promise<void> {
    await this.ensureExists();
    await fs.promises.writeFile(this.memoryPath, content, 'utf-8');
  }

  async append(content: string): Promise<void> {
    await this.ensureExists();
    const existing = await this.read();
    const newContent = existing ? `${existing}\n${content}` : content;
    await fs.promises.writeFile(this.memoryPath, newContent, 'utf-8');
  }

  async clear(): Promise<void> {
    await this.ensureExists();
    await fs.promises.writeFile(this.memoryPath, '', 'utf-8');
  }
}
