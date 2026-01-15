import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { OpenRouterToolCall, OpenRouterToolDefinition } from './openrouter';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_PYTHON_EXECUTABLE = 'python3';

export const PYTHON_TOOL_NAME = 'python';

export const pythonToolDefinition: OpenRouterToolDefinition = {
  type: 'function',
  function: {
    name: PYTHON_TOOL_NAME,
    description:
      'Execute Python code in an isolated, temporary workspace and return stdout/stderr.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The Python source code to execute.',
        },
      },
      required: ['code'],
    },
  },
};

export type PythonExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
};

type PythonToolOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
  pythonExecutable?: string;
};

export class PythonTool {
  private timeoutMs: number;
  private maxOutputBytes: number;
  private pythonExecutable: string;

  constructor(options: PythonToolOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.pythonExecutable = options.pythonExecutable ?? DEFAULT_PYTHON_EXECUTABLE;
  }

  async execute(code: string): Promise<PythonExecutionResult> {
    const trimmed = code.trim();
    if (!trimmed) {
      return {
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        truncated: false,
        error: 'No code provided.',
      };
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pro-chat-python-'));
    const scriptPath = path.join(tempDir, 'main.py');

    try {
      await writeFile(scriptPath, trimmed, 'utf-8');
      const { stdout, stderr } = await execFileAsync(
        this.pythonExecutable,
        ['-I', '-S', '-B', scriptPath],
        {
          cwd: tempDir,
          timeout: this.timeoutMs,
          maxBuffer: this.maxOutputBytes,
          env: {
            PATH: process.env.PATH ?? '',
            PYTHONIOENCODING: 'utf-8',
            PYTHONNOUSERSITE: '1',
            PYTHONDONTWRITEBYTECODE: '1',
          },
        },
      );

      return {
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: 0,
        timedOut: false,
        truncated: false,
      };
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | null;
        killed?: boolean;
      };
      const isTimeout = Boolean(execError.killed);
      const isTruncated = execError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
        exitCode: typeof execError.code === 'number' ? execError.code : null,
        timedOut: isTimeout,
        truncated: isTruncated,
        error: execError.message,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async runToolCall(toolCall: OpenRouterToolCall): Promise<string> {
    const argumentsPayload = toolCall.function.arguments ?? '';
    let code = '';
    try {
      const parsed = JSON.parse(argumentsPayload);
      code = typeof parsed?.code === 'string' ? parsed.code : '';
    } catch (error) {
      return JSON.stringify({
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        truncated: false,
        error: 'Invalid tool arguments. Expected JSON with a code string.',
      } satisfies PythonExecutionResult);
    }

    const result = await this.execute(code);
    return JSON.stringify(result);
  }
}
