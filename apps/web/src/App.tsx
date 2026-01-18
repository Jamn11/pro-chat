import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  cancelActiveStream,
  checkActiveStream,
  createThread,
  deleteThread,
  fetchCredits,
  fetchMemory,
  fetchMessages,
  fetchModels,
  fetchSettings,
  fetchThreads,
  fetchUsageStats,
  resumeStream,
  setAuthTokenGetter,
  streamChat,
  triggerMemoryExtraction,
  updateMemory,
  updateSettings,
  uploadFiles,
} from './api';
import { AuthGuard, UserMenu } from './components/AuthGuard';
import type { ActiveStreamInfo, Attachment, CreditsInfo, ModelInfo, Settings, ThreadSummary, UIMessage, UsageStats } from './types';
import './App.css';

type Theme = 'light' | 'dark';
type ViewMode = 'chat' | 'settings';
type SettingsTab = 'personalization' | 'instructions' | 'usage' | 'credits';
type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';
type ThinkingSelection = ThinkingLevel | null;

type ThinkingProfile =
  | { mode: 'none' }
  | { mode: 'toggle' }
  | { mode: 'effort' }
  | { mode: 'budget' };

type ThinkingOption = {
  value: ThinkingSelection;
  label: string;
};

type SlashCommand = {
  raw: string;
  command: string;
  args: string;
};

const CLAUDE_THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  low: 8192,
  medium: 16384,
  high: 32768,
  xhigh: 65536,
};

const MODEL_THINKING_PROFILES: Record<string, ThinkingProfile> = {
  'openai/gpt-5.2': { mode: 'effort' },
  'x-ai/grok-4.1-fast': { mode: 'effort' },
  'anthropic/claude-opus-4.5': { mode: 'budget' },
  'anthropic/claude-sonnet-4.5': { mode: 'budget' },
  'google/gemini-3-pro-preview': { mode: 'none' },
};

const formatBudgetLabel = (tokens: number) => `${Math.round(tokens / 1024)}k`;

const getThinkingOptions = (model: ModelInfo | null): ThinkingOption[] => {
  if (!model) {
    return [{ value: null, label: 'Thinking: Off' }];
  }
  const profile =
    MODEL_THINKING_PROFILES[model.id] ??
    (model.supportsThinkingLevels ? { mode: 'effort' } : { mode: 'none' });
  if (profile.mode === 'none') {
    return [{ value: null, label: 'Thinking: Off' }];
  }
  if (profile.mode === 'toggle') {
    return [
      { value: null, label: 'Thinking: Off' },
      { value: 'low', label: 'Thinking: On' },
    ];
  }
  if (profile.mode === 'budget') {
    return [
      { value: null, label: 'Thinking: Off' },
      {
        value: 'low',
        label: `Thinking: Low (${formatBudgetLabel(CLAUDE_THINKING_BUDGETS.low)})`,
      },
      {
        value: 'medium',
        label: `Thinking: Medium (${formatBudgetLabel(CLAUDE_THINKING_BUDGETS.medium)})`,
      },
      {
        value: 'high',
        label: `Thinking: High (${formatBudgetLabel(CLAUDE_THINKING_BUDGETS.high)})`,
      },
      {
        value: 'xhigh',
        label: `Thinking: Extra High (${formatBudgetLabel(CLAUDE_THINKING_BUDGETS.xhigh)})`,
      },
    ];
  }
  return [
    { value: null, label: 'Thinking: Off' },
    { value: 'low', label: 'Thinking: Low' },
    { value: 'medium', label: 'Thinking: Medium' },
    { value: 'high', label: 'Thinking: High' },
    { value: 'xhigh', label: 'Thinking: Extra High' },
  ];
};

const normalizeModelText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const formatCost = (value: number | null | undefined) => {
  const amount = value ?? 0;
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: amount < 0.01 ? 6 : 2,
    maximumFractionDigits: amount < 0.01 ? 6 : 2,
  });
  return formatter.format(amount);
};

const formatDuration = (ms?: number | null) => {
  if (!ms) return null;
  const seconds = ms / 1000;
  return `${seconds.toFixed(2)}s`;
};

type PreBlockProps = {
  children?: React.ReactNode;
  node?: unknown;
};

function PreBlock({ children, ...props }: PreBlockProps) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    // Extract text content from the pre element
    const text = preRef.current?.textContent?.replace(/\n$/, '') || '';
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper">
      <button className="code-copy-button" onClick={handleCopy} aria-label="Copy code">
        {copied ? '✓' : '⧉'}
      </button>
      <pre ref={preRef} {...props}>{children}</pre>
    </div>
  );
}

export default function App() {
  const { getToken, isLoaded: isAuthLoaded } = useAuth();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingSelection>('medium');
  const [composer, setComposer] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [isExtractingMemory, setIsExtractingMemory] = useState(false);
  const [activeView, setActiveView] = useState<ViewMode>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('personalization');
  const [settings, setSettings] = useState<Settings>({
    systemPrompt: null,
    defaultModelId: null,
    defaultThinkingLevel: null,
    enabledModelIds: [],
    enabledTools: ['web_search', 'code_interpreter', 'memory'],
    hideCostPerMessage: false,
    notifications: true,
    fontFamily: 'Space Mono',
    fontSize: 'medium',
  });
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [pendingSettings, setPendingSettings] = useState<Settings | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return 'dark';
    return (storage.getItem('pro-chat-theme') as Theme) || 'dark';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [streamDuration, setStreamDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openTraceMessageId, setOpenTraceMessageId] = useState<string | null>(null);
  const [openSourcesMessageId, setOpenSourcesMessageId] = useState<string | null>(null);
  const [streamingTraceMessageId, setStreamingTraceMessageId] = useState<string | null>(null);
  const [pendingStream, setPendingStream] = useState<ActiveStreamInfo | null>(null);
  const [isResuming, setIsResuming] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const isAutoScrollingRef = useRef(false);
  const streamTimerRef = useRef<number | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const dragCounterRef = useRef(0);
  const activeThreadIdRef = useRef<string | null>(null);
  const skipNextFetchRef = useRef<string | null>(null);
  const streamingTraceRef = useRef<string>('');
  const lastReasoningLengthRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) || null;
  const selectedModel = models.find((model) => model.id === selectedModelId) || null;
  const thinkingOptions = useMemo(() => getThinkingOptions(selectedModel), [selectedModel]);
  const slashCommand = useMemo<SlashCommand | null>(() => {
    const trimmed = composer.trimStart();
    if (!trimmed.startsWith('/')) return null;
    if (composer.includes('\n')) return null;
    const raw = trimmed.slice(1);
    const [command = '', ...rest] = raw.split(/\s+/);
    return { raw, command: command.toLowerCase(), args: rest.join(' ') };
  }, [composer]);
  const isThinkingCommand =
    slashCommand?.command === 'thinking' || slashCommand?.command === 'think';
  const modelQuery = slashCommand && !isThinkingCommand ? slashCommand.raw : null;
  const modelSuggestions = useMemo(() => {
    if (!modelQuery) return [];
    const query = normalizeModelText(modelQuery.trim());
    const ranked = models
      .map((model) => {
        const labelKey = normalizeModelText(model.label);
        const idKey = normalizeModelText(model.id);
        if (!query) return { model, score: 0 };
        if (labelKey.startsWith(query) || idKey.startsWith(query)) {
          return { model, score: 0 };
        }
        if (labelKey.includes(query) || idKey.includes(query)) {
          return { model, score: 1 };
        }
        return { model, score: 2 };
      })
      .filter((entry) => query === '' || entry.score < 2)
      .sort((a, b) => a.score - b.score || a.model.label.localeCompare(b.model.label));
    return ranked.map((entry) => entry.model).slice(0, 6);
  }, [models, modelQuery]);
  const thinkingSuggestions = useMemo(() => {
    if (!slashCommand || !isThinkingCommand) return [];
    const query = normalizeModelText(slashCommand.args.trim());
    return thinkingOptions.filter((option) => {
      if (!query) return true;
      const labelKey = normalizeModelText(option.label);
      const valueKey = normalizeModelText(option.value ?? 'off');
      return labelKey.includes(query) || valueKey.includes(query);
    });
  }, [slashCommand, isThinkingCommand, thinkingOptions]);
  const slashCommandActive = slashCommand !== null;

  // Effective settings: use pending if available, otherwise saved
  const effectiveSettings = pendingSettings ?? settings;
  const settingsDirty = pendingSettings !== null;

  // Apply font settings via CSS variables
  useEffect(() => {
    const fontSizeMap: Record<string, string> = {
      small: '0.875rem',
      medium: '1rem',
      large: '1.125rem',
    };
    document.documentElement.style.setProperty(
      '--chat-font-family',
      effectiveSettings.fontFamily === 'system-ui'
        ? 'system-ui, -apple-system, sans-serif'
        : `"${effectiveSettings.fontFamily}", monospace`
    );
    document.documentElement.style.setProperty(
      '--chat-text-size',
      fontSizeMap[effectiveSettings.fontSize] || '1rem'
    );
  }, [effectiveSettings.fontFamily, effectiveSettings.fontSize]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (
      typeof window !== 'undefined' &&
      window.localStorage &&
      typeof window.localStorage.setItem === 'function'
    ) {
      window.localStorage.setItem('pro-chat-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // Set up auth token getter for API calls
  useEffect(() => {
    setAuthTokenGetter(getToken);
  }, [getToken]);

  // Load initial data once auth is ready
  useEffect(() => {
    if (!isAuthLoaded) return;

    async function load() {
      const [modelList, threadList, fetchedSettings, memory, usage, creditsInfo] = await Promise.all([
        fetchModels(),
        fetchThreads(),
        fetchSettings(),
        fetchMemory().catch(() => ({ content: '' })),
        fetchUsageStats().catch(() => null),
        fetchCredits().catch(() => ({ credits: 10.0 })),
      ]);
      setModels(modelList);
      setThreads(threadList);

      // Initialize settings with defaults for any missing fields
      const normalizedSettings: Settings = {
        systemPrompt: fetchedSettings.systemPrompt ?? null,
        defaultModelId: fetchedSettings.defaultModelId ?? null,
        defaultThinkingLevel: fetchedSettings.defaultThinkingLevel ?? null,
        enabledModelIds: fetchedSettings.enabledModelIds ?? modelList.map(m => m.id),
        enabledTools: fetchedSettings.enabledTools ?? ['web_search', 'code_interpreter', 'memory'],
        hideCostPerMessage: fetchedSettings.hideCostPerMessage ?? false,
        notifications: fetchedSettings.notifications ?? true,
        fontFamily: fetchedSettings.fontFamily ?? 'Space Mono',
        fontSize: fetchedSettings.fontSize ?? 'medium',
      };
      setSettings(normalizedSettings);
      setSystemPrompt(normalizedSettings.systemPrompt ?? '');
      setMemoryContent(memory.content ?? '');
      if (usage) setUsageStats(usage);
      setCredits(creditsInfo);

      // Use default model from settings if available, otherwise first model
      if (modelList.length > 0) {
        const defaultId = normalizedSettings.defaultModelId;
        if (defaultId && modelList.some(m => m.id === defaultId)) {
          setSelectedModelId(defaultId);
        } else {
          setSelectedModelId(modelList[0].id);
        }
      }

      // Use default thinking level from settings if available
      if (normalizedSettings.defaultThinkingLevel) {
        setThinkingLevel(normalizedSettings.defaultThinkingLevel as ThinkingLevel);
      }

      if (threadList.length > 0) {
        setActiveThreadId(threadList[0].id);
      }
    }
    load().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load');
    });
  }, [isAuthLoaded]);

  useEffect(() => {
    setAttachments([]);
    setPendingStream(null);
    shouldAutoScrollRef.current = true; // Reset auto-scroll when switching threads
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    if (skipNextFetchRef.current && skipNextFetchRef.current === activeThreadId) {
      skipNextFetchRef.current = null;
      return;
    }
    if (skipNextFetchRef.current && skipNextFetchRef.current !== activeThreadId) {
      skipNextFetchRef.current = null;
    }
    fetchMessages(activeThreadId)
      .then((data) => setMessages(data))
      .catch((error) =>
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load messages'),
      );

    // Check for pending/resumable stream
    checkActiveStream(activeThreadId)
      .then((result) => {
        if (result.hasActiveStream && result.stream) {
          setPendingStream(result.stream);
        }
      })
      .catch((error) => {
        console.error('Failed to check for active stream:', error);
      });
  }, [activeThreadId]);

  // Track user scroll position to determine if we should auto-scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Ignore scroll events triggered by our own auto-scroll
      if (isAutoScrollingRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "at bottom" if within 150px of bottom
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
      shouldAutoScrollRef.current = isAtBottom;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [activeThreadId]); // Re-attach when thread changes

  // Auto-scroll to bottom only when user hasn't scrolled up
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

    // Only auto-scroll if user is at/near bottom
    if (shouldAutoScrollRef.current && isAtBottom) {
      isAutoScrollingRef.current = true;
      container.scrollTop = scrollHeight - clientHeight;
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    }
  }, [messages]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [composer]);

  useEffect(() => {
    if (!thinkingOptions.some((option) => option.value === thinkingLevel)) {
      setThinkingLevel(thinkingOptions[0]?.value ?? null);
    }
  }, [thinkingOptions, thinkingLevel]);


  const chatTotalCost = useMemo(() => activeThread?.totalCost ?? 0, [activeThread]);

  const handleNewThread = useCallback(() => {
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    setMessages([]);
    setAttachments([]);
    setComposer('');
    setActiveView('chat');

    // Reset to default model from settings
    const defaultModelId = settings.defaultModelId;
    if (defaultModelId && models.some(m => m.id === defaultModelId)) {
      setSelectedModelId(defaultModelId);
    } else if (models.length > 0) {
      setSelectedModelId(models[0].id);
    }

    // Reset to default thinking level from settings
    if (settings.defaultThinkingLevel) {
      setThinkingLevel(settings.defaultThinkingLevel as ThinkingLevel);
    } else {
      setThinkingLevel('medium');
    }
  }, [settings.defaultModelId, settings.defaultThinkingLevel, models]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'o' && event.metaKey && event.shiftKey) {
        event.preventDefault();
        handleNewThread();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleNewThread]);

  const handleDeleteThread = async (threadId: string) => {
    await deleteThread(threadId);
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId));
    if (activeThreadId === threadId) {
      const nextThread = threads.find((thread) => thread.id !== threadId) || null;
      activeThreadIdRef.current = nextThread?.id ?? null;
      setActiveThreadId(nextThread?.id ?? null);
      setMessages([]);
    }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsUploading(true);
    try {
      let threadId = activeThreadIdRef.current;
      if (!threadId) {
        const newThread = await createThread(null);
        setThreads((prev) => [newThread, ...prev]);
        activeThreadIdRef.current = newThread.id;
        setActiveThreadId(newThread.id);
        setActiveView('chat');
        threadId = newThread.id;
      }
      const uploaded = await uploadFiles(threadId, fileList);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setComposer('');
    if (composerRef.current) {
      composerRef.current.focus();
      composerRef.current.style.height = 'auto';
    }
  };

  const handleSelectThinking = (value: ThinkingSelection) => {
    setThinkingLevel(value);
    setComposer('');
    if (composerRef.current) {
      composerRef.current.focus();
      composerRef.current.style.height = 'auto';
    }
  };

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragCounterRef.current = 0;
      setIsDragActive(false);
      if (event.dataTransfer?.files?.length) {
        void handleUpload(event.dataTransfer.files);
      }
    },
    [handleUpload],
  );

  const handleSend = async () => {
    if (isStreaming || isUploading) {
      if (isUploading) {
        setErrorMessage('Please wait for file uploads to finish before sending.');
      }
      return;
    }
    let content = composer.trim();
    if (!content && attachments.length > 0) {
      content = 'Please review the attached file(s).';
    }
    if (!content) return;

    // Re-enable auto-scroll when user sends a message
    shouldAutoScrollRef.current = true;

    let threadId = activeThreadIdRef.current;
    if (!threadId) {
      const newThread = await createThread(null);
      setThreads((prev) => [newThread, ...prev]);
      activeThreadIdRef.current = newThread.id;
      skipNextFetchRef.current = newThread.id;
      setActiveThreadId(newThread.id);
      setActiveView('chat');
      threadId = newThread.id;
      // Refresh threads after delay to pick up LLM-generated title
      setTimeout(() => {
        fetchThreads()
          .then((threadList) => setThreads(threadList))
          .catch(() => {});
      }, 2000);
    }

    const tempUserId = `temp-user-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;

    const userMessage: UIMessage = {
      id: tempUserId,
      role: 'user',
      content,
      modelId: selectedModelId,
      thinkingLevel: thinkingLevel ?? null,
      createdAt: new Date().toISOString(),
      attachments,
    };

    const assistantMessage: UIMessage = {
      id: tempAssistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setComposer('');
    setAttachments([]);
    setIsStreaming(true);
    setStreamDuration(0);
    // Reset streaming trace refs for new stream
    streamingTraceRef.current = '';
    lastReasoningLengthRef.current = 0;
    if (composerRef.current) {
      composerRef.current.style.height = 'auto';
    }

    const start = Date.now();
    streamTimerRef.current = window.setInterval(() => {
      setStreamDuration(Date.now() - start);
    }, 100);

    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const now = new Date();
      await streamChat(
        {
          threadId,
          content,
          modelId: selectedModelId,
          thinkingLevel: thinkingLevel ?? null,
          signal: abortController.signal,
          attachmentIds: attachments.map((a) => a.id),
          clientContext: {
            iso: now.toISOString(),
            local: now.toLocaleString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            offsetMinutes: now.getTimezoneOffset(),
          },
        },
        {
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempAssistantId
                  ? { ...msg, content: `${msg.content}${delta}`, status: 'streaming' }
                  : msg,
              ),
            );
          },
          onReasoning: (data) => {
            // Use ref to accumulate reasoning and dedupe against React double-invocation
            const newLength = streamingTraceRef.current.length + data.delta.length;
            // Only append if this is actually new content (dedupe)
            if (newLength > lastReasoningLengthRef.current) {
              streamingTraceRef.current += data.delta;
              lastReasoningLengthRef.current = newLength;

              // Sync ref content to state
              const content = streamingTraceRef.current;
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== tempAssistantId) return msg;
                  const trace = msg.trace ?? [];
                  // Update existing reasoning event or create new one
                  if (trace.length > 0 && trace[trace.length - 1].type === 'reasoning') {
                    const last = trace[trace.length - 1];
                    return {
                      ...msg,
                      trace: [
                        ...trace.slice(0, -1),
                        { ...last, content },
                      ],
                    };
                  }
                  return {
                    ...msg,
                    trace: [
                      ...trace,
                      {
                        id: `trace-reasoning-${tempAssistantId}`,
                        type: 'reasoning' as const,
                        content,
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  };
                }),
              );
            }
          },
          onTool: (data) => {
            // Add tool event to trace
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== tempAssistantId) return msg;
                const trace = msg.trace ?? [];
                return {
                  ...msg,
                  trace: [
                    ...trace,
                    {
                      id: `trace-tool-${Date.now()}`,
                      type: 'tool' as const,
                      content: `Tool: ${data.name}`,
                      createdAt: new Date().toISOString(),
                    },
                  ],
                };
              }),
            );
          },
          onDone: (data) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id === tempUserId) {
                  return { ...data.userMessage, attachments: msg.attachments };
                }
                if (msg.id === tempAssistantId) {
                  return { ...data.assistantMessage, status: 'done' };
                }
                return msg;
              }),
            );
            setThreads((prev) =>
              prev.map((thread) => {
                if (thread.id !== threadId) return thread;
                return {
                  ...thread,
                  totalCost: data.totalCost,
                  updatedAt: new Date().toISOString(),
                };
              }),
            );
            // Clear streaming trace state
            setStreamingTraceMessageId(null);
            // Refresh memory in case the AI used memory tools
            fetchMemory()
              .then((memory) => setMemoryContent(memory.content ?? ''))
              .catch(() => {});
            // Refresh credits and usage stats after message cost is deducted
            fetchCredits()
              .then((creditsInfo) => setCredits(creditsInfo))
              .catch(() => {});
            fetchUsageStats()
              .then((stats) => setUsageStats(stats))
              .catch(() => {});
            // Show notification if enabled and page not focused
            if (document.hidden) {
              const preview = data.assistantMessage.content?.slice(0, 100) || 'Response ready';
              showNotification('Pro Chat', preview);
            }
          },
          onError: (message) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempAssistantId
                  ? { ...msg, content: message, status: 'error' }
                  : msg,
              ),
            );
            setStreamingTraceMessageId(null);
          },
        },
      );
    } catch (error) {
      // Don't show error if user aborted the request
      if (error instanceof Error && error.name === 'AbortError') {
        // Silently handle abort - user clicked Stop
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Streaming failed');
      }
    } finally {
      if (streamTimerRef.current) {
        window.clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleResume = async () => {
    if (!pendingStream || isResuming || isStreaming) return;

    setIsResuming(true);
    setIsStreaming(true);
    setStreamDuration(0);
    streamingTraceRef.current = '';
    lastReasoningLengthRef.current = 0;

    const start = Date.now();
    streamTimerRef.current = window.setInterval(() => {
      setStreamDuration(Date.now() - start);
    }, 100);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await resumeStream(
        pendingStream.id,
        {
          onCatchup: (data) => {
            // Apply catchup data - update messages with real IDs and partial content
            setMessages((prev) => {
              const hasAssistantMsg = data.assistantMessageId
                ? prev.some((m) => m.id === data.assistantMessageId)
                : false;

              if (hasAssistantMsg) {
                // Update existing assistant message with partial content
                return prev.map((m) => {
                  if (m.id === data.assistantMessageId) {
                    return {
                      ...m,
                      content: data.partialContent,
                      trace: data.partialTrace ?? m.trace,
                      status: 'streaming' as const,
                    };
                  }
                  return m;
                });
              } else if (data.assistantMessageId) {
                // Add streaming assistant message
                return [
                  ...prev,
                  {
                    id: data.assistantMessageId,
                    role: 'assistant' as const,
                    content: data.partialContent,
                    trace: data.partialTrace,
                    createdAt: new Date().toISOString(),
                    status: 'streaming' as const,
                  },
                ];
              }
              return prev;
            });

            // Update streaming trace ref with existing content
            if (data.partialTrace) {
              const reasoning = data.partialTrace.find((t) => t.type === 'reasoning');
              if (reasoning) {
                streamingTraceRef.current = reasoning.content;
                lastReasoningLengthRef.current = reasoning.content.length;
              }
            }
          },
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.status === 'streaming' && msg.role === 'assistant') {
                  return { ...msg, content: `${msg.content}${delta}` };
                }
                return msg;
              }),
            );
          },
          onReasoning: (data) => {
            const newLength = streamingTraceRef.current.length + data.delta.length;
            if (newLength > lastReasoningLengthRef.current) {
              streamingTraceRef.current += data.delta;
              lastReasoningLengthRef.current = newLength;

              const content = streamingTraceRef.current;
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.status !== 'streaming' || msg.role !== 'assistant') return msg;
                  const trace = msg.trace ?? [];
                  if (trace.length > 0 && trace[trace.length - 1].type === 'reasoning') {
                    const last = trace[trace.length - 1];
                    return {
                      ...msg,
                      trace: [...trace.slice(0, -1), { ...last, content }],
                    };
                  }
                  return {
                    ...msg,
                    trace: [
                      ...trace,
                      {
                        id: `trace-reasoning-resume-${Date.now()}`,
                        type: 'reasoning' as const,
                        content,
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  };
                }),
              );
            }
          },
          onTool: (data) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.status !== 'streaming' || msg.role !== 'assistant') return msg;
                const trace = msg.trace ?? [];
                return {
                  ...msg,
                  trace: [
                    ...trace,
                    {
                      id: `trace-tool-${Date.now()}`,
                      type: 'tool' as const,
                      content: `Tool: ${data.name}`,
                      createdAt: new Date().toISOString(),
                    },
                  ],
                };
              }),
            );
          },
          onDone: (data) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.status === 'streaming' && msg.role === 'assistant') {
                  return { ...data.assistantMessage, status: 'done' };
                }
                if (msg.id === data.userMessage.id) {
                  return data.userMessage;
                }
                return msg;
              }),
            );
            setThreads((prev) =>
              prev.map((thread) => {
                if (thread.id !== activeThreadId) return thread;
                return {
                  ...thread,
                  totalCost: data.totalCost,
                  updatedAt: new Date().toISOString(),
                };
              }),
            );
            setStreamingTraceMessageId(null);
            fetchMemory()
              .then((memory) => setMemoryContent(memory.content ?? ''))
              .catch(() => {});
            // Refresh credits and usage stats after message cost is deducted
            fetchCredits()
              .then((creditsInfo) => setCredits(creditsInfo))
              .catch(() => {});
            fetchUsageStats()
              .then((stats) => setUsageStats(stats))
              .catch(() => {});
          },
          onError: (message) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.status === 'streaming' && msg.role === 'assistant') {
                  return { ...msg, content: message, status: 'error' };
                }
                return msg;
              }),
            );
            setStreamingTraceMessageId(null);
          },
        },
        abortController.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setErrorMessage(error instanceof Error ? error.message : 'Resume failed');
      }
    } finally {
      if (streamTimerRef.current) {
        window.clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      abortControllerRef.current = null;
      setIsStreaming(false);
      setIsResuming(false);
      setPendingStream(null);
    }
  };

  const handleDiscardPendingStream = async () => {
    if (!pendingStream) return;
    await cancelActiveStream(pendingStream.id);
    setPendingStream(null);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      event.preventDefault();
      const dataTransfer = new DataTransfer();
      imageFiles.forEach((file) => dataTransfer.items.add(file));
      void handleUpload(dataTransfer.files);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (slashCommandActive) {
        if (isThinkingCommand && thinkingSuggestions.length > 0) {
          handleSelectThinking(thinkingSuggestions[0].value ?? null);
          return;
        }
        if (!isThinkingCommand && modelSuggestions.length > 0) {
          handleSelectModel(modelSuggestions[0].id);
          return;
        }
      }
      handleSend();
    }
  };

  const handleSettingsSave = async () => {
    if (!pendingSettings) return;
    setIsSavingSettings(true);
    try {
      const updated = await updateSettings(pendingSettings);
      setSettings(updated);
      setPendingSettings(null);
      if (updated.systemPrompt !== undefined) {
        setSystemPrompt(updated.systemPrompt ?? '');
      }
      setErrorMessage('Settings saved successfully');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSettingsChange = (changes: Partial<Settings>) => {
    setPendingSettings(prev => ({
      ...(prev ?? settings),
      ...changes,
    }));
  };

  const handleSettingsDiscard = () => {
    setPendingSettings(null);
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      setErrorMessage('Browser does not support notifications');
      return false;
    }
    if (Notification.permission === 'granted') {
      return true;
    }
    if (Notification.permission === 'denied') {
      setErrorMessage('Notification permission denied. Please enable in browser settings.');
      return false;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      return true;
    }
    setErrorMessage('Notification permission denied');
    return false;
  };

  const showNotification = (title: string, body: string) => {
    if (effectiveSettings.notifications && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  };

  const handleMemorySave = async () => {
    try {
      const updated = await updateMemory(memoryContent);
      setMemoryContent(updated.content ?? '');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save memory');
    }
  };

  const handleMemoryExtraction = async () => {
    setIsExtractingMemory(true);
    try {
      const result = await triggerMemoryExtraction();
      // Refresh memory content after extraction
      const updated = await fetchMemory().catch(() => ({ content: '' }));
      setMemoryContent(updated.content ?? '');
      if (result.memoriesAdded > 0) {
        setErrorMessage(`Added ${result.memoriesAdded} new memories from ${result.processed} chats`);
      } else if (result.processed === 0) {
        setErrorMessage('No new chats to analyze for memories');
      } else {
        setErrorMessage(`Analyzed ${result.processed} chats, no new memories found`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Memory extraction failed');
    } finally {
      setIsExtractingMemory(false);
    }
  };

  return (
    <AuthGuard>
      <div
        className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${
          isDragActive ? 'drag-active' : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragActive && (
          <div className="drop-overlay" aria-hidden="true">
            Drop files to attach
          </div>
        )}
        <aside
          className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
          aria-hidden={sidebarCollapsed}
        >
          <div className="sidebar-top">
            <div className="brand">{sidebarCollapsed ? 'pc' : 'pro-chat'}</div>
            <div className="sidebar-actions">
              <UserMenu />
              <button
                className="icon-button"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? '>' : '<'}
              </button>
            </div>
          </div>
        <button className="button primary" onClick={handleNewThread}>
          {sidebarCollapsed ? '+' : 'New Chat'}
        </button>
        <div className="thread-list">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={
                thread.id === activeThreadId ? 'thread-item active' : 'thread-item'
              }
            >
              <button
                className="thread-button"
                onClick={() => {
                  activeThreadIdRef.current = thread.id;
                  setActiveThreadId(thread.id);
                  setActiveView('chat');
                }}
              >
                <span className="thread-title">{thread.title ?? 'Untitled chat'}</span>
                {!settings.hideCostPerMessage && (
                  <span className="thread-cost">{formatCost(thread.totalCost)}</span>
                )}
              </button>
              <button
                className="thread-delete"
                onClick={() => handleDeleteThread(thread.id)}
                aria-label="Delete chat"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="button ghost" onClick={() => setActiveView('settings')}>
            {sidebarCollapsed ? 'Set' : 'Settings'}
          </button>
        </div>
      </aside>

      <main className="chat">
        {activeView === 'chat' ? (
          <>
            <header className="chat-header">
              <div className="chat-heading">
                {sidebarCollapsed && (
                  <button
                    className="icon-button sidebar-toggle"
                    onClick={() => setSidebarCollapsed(false)}
                    aria-label="Show sidebar"
                  >
                    ☰
                  </button>
                )}
                <div>
                  <div className="chat-title">{activeThread?.title ?? 'New chat'}</div>
                  <div className="chat-subtitle">
                    Per-message model selection · Streaming enabled
                  </div>
                </div>
              </div>
              <div className="chat-meta">
                {credits && (
                  <span className={`credits-chip ${credits.credits < 1 ? 'low' : ''}`}>
                    {credits.credits.toFixed(2)} credits
                  </span>
                )}
                <span className="cost-chip">Chat total {formatCost(chatTotalCost)}</span>
                {isStreaming && (
                  <span className="timer-chip">⏱ {(streamDuration / 1000).toFixed(1)}s</span>
                )}
              </div>
            </header>

            <section className="messages" ref={messagesContainerRef}>
              {pendingStream && !isResuming && (
                <div className="resume-banner">
                  <div className="resume-banner-content">
                    <span className="resume-banner-icon">⚡</span>
                    <div className="resume-banner-text">
                      <strong>Response interrupted</strong>
                      <span>
                        {pendingStream.partialContent.length > 0
                          ? `${pendingStream.partialContent.length} characters generated`
                          : 'Generation in progress'}
                      </span>
                    </div>
                  </div>
                  <div className="resume-banner-actions">
                    <button className="button primary" onClick={handleResume}>
                      Resume
                    </button>
                    <button className="button ghost" onClick={handleDiscardPendingStream}>
                      Discard
                    </button>
                  </div>
                </div>
              )}
              {messages.length === 0 && !pendingStream && (
                <div className="empty-state">
                  <p>Start a conversation. Pick a model, attach files, and send a message.</p>
                </div>
              )}
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`message ${message.role} ${message.status ?? ''}`}
                >
                  <div className="message-role">
                    {message.role === 'user' ? 'You' : 'Assistant'}
                  </div>
                  <div className="message-content">
                    {message.role === 'assistant' ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{ pre: PreBlock }}
                      >
                        {message.content || (message.status === 'streaming' ? 'Thinking…' : '')}
                      </ReactMarkdown>
                    ) : (
                      <span>
                        {message.content || (message.status === 'streaming' ? 'Thinking…' : '')}
                      </span>
                    )}
                  </div>
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="attachments">
                      {message.attachments.map((attachment) =>
                        attachment.kind === 'image' ? (
                          <img
                            key={attachment.id}
                            src={attachment.url}
                            alt={attachment.filename}
                            className="attachment-image"
                          />
                        ) : (
                          <a
                            key={attachment.id}
                            href={attachment.url}
                            className="attachment-file"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {attachment.filename}
                          </a>
                        ),
                      )}
                    </div>
                  )}
                  <div className="message-meta">
                    {message.cost != null && message.role === 'assistant' && !settings.hideCostPerMessage && (
                      <span>{formatCost(message.cost)}</span>
                    )}
                    {message.role === 'assistant' && formatDuration(message.durationMs) && (
                      <span>⏱ {formatDuration(message.durationMs)}</span>
                    )}
                    {message.modelId && <span>{message.modelId}</span>}
                    {message.role === 'assistant' &&
                      (message.trace && message.trace.length > 0 || message.status === 'streaming') && (
                      <button
                        className={`trace-toggle ${message.status === 'streaming' && message.trace?.length ? 'streaming' : ''}`}
                        onClick={() => {
                          if (message.status === 'streaming') {
                            setStreamingTraceMessageId(
                              streamingTraceMessageId === message.id ? null : message.id,
                            );
                          } else {
                            setOpenTraceMessageId(
                              openTraceMessageId === message.id ? null : message.id,
                            );
                          }
                        }}
                      >
                        {message.status === 'streaming' && message.trace?.length
                          ? `Thinking… (${message.trace.length})`
                          : message.trace?.length
                            ? `Trace (${message.trace.length})`
                            : 'Thinking…'}
                      </button>
                    )}
                    {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                      <button
                        className="trace-toggle"
                        onClick={() =>
                          setOpenSourcesMessageId(
                            openSourcesMessageId === message.id ? null : message.id,
                          )
                        }
                      >
                        Sources ({message.sources.length})
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </section>

            <section className="composer">
              {attachments.length > 0 && (
                <div className="composer-attachments">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="attachment-pill">
                      {attachment.filename}
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                onPaste={handlePaste}
                placeholder="Type your message..."
                rows={1}
              />
              {slashCommandActive &&
                ((isThinkingCommand && thinkingSuggestions.length > 0) ||
                  (!isThinkingCommand && modelSuggestions.length > 0)) && (
                  <div className="composer-suggestions">
                    <div className="composer-suggestion-hint">
                      {isThinkingCommand ? 'Set thinking level' : 'Select a model'}
                    </div>
                    {isThinkingCommand
                      ? thinkingSuggestions.map((option, index) => (
                          <button
                            key={option.value ?? 'off'}
                            type="button"
                            className={`composer-suggestion ${index === 0 ? 'active' : ''}`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleSelectThinking(option.value ?? null);
                            }}
                          >
                            <span className="composer-suggestion-label">
                              {option.label.replace('Thinking: ', '')}
                            </span>
                          </button>
                        ))
                      : modelSuggestions.map((model, index) => (
                          <button
                            key={model.id}
                            type="button"
                            className={`composer-suggestion ${index === 0 ? 'active' : ''}`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleSelectModel(model.id);
                            }}
                          >
                            <span className="composer-suggestion-label">{model.label}</span>
                            <span className="composer-suggestion-id">{model.id}</span>
                          </button>
                        ))}
                  </div>
                )}
              <div className="composer-toolbar">
                <label className="icon-button attach-button" aria-label="Attach files">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M7 7.5v9.25a5 5 0 0 0 10 0V6.75a3.25 3.25 0 0 0-6.5 0v9.5a1.5 1.5 0 0 0 3 0V8.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <input
                    type="file"
                    multiple
                    onChange={(event) => handleUpload(event.target.files)}
                  />
                </label>
                <select
                  aria-label="Model selector"
                  value={selectedModelId}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Thinking selector"
                  value={thinkingLevel ?? ''}
                  onChange={(event) =>
                    setThinkingLevel(
                      (event.target.value || null) as 'low' | 'medium' | 'high' | 'xhigh' | null,
                    )
                  }
                >
                  {thinkingOptions.map((option) => (
                    <option key={option.label} value={option.value ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {isStreaming ? (
                  <button className="button stop" onClick={handleStop}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="button primary"
                    onClick={handleSend}
                    disabled={isUploading}
                  >
                    {isUploading ? 'Uploading…' : 'Send'}
                  </button>
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="settings-view">
            <div className="settings-header">
              <div>
                <h2>Settings</h2>
                <p>Customize your experience, models, and preferences.</p>
              </div>
              <div className="settings-header-actions">
                {settingsDirty && (
                  <>
                    <button
                      className="button ghost"
                      onClick={handleSettingsDiscard}
                      disabled={isSavingSettings}
                    >
                      Discard
                    </button>
                    <button
                      className="button primary"
                      onClick={handleSettingsSave}
                      disabled={isSavingSettings}
                    >
                      {isSavingSettings ? 'Saving...' : 'Save Changes'}
                    </button>
                  </>
                )}
                <button className="button ghost" onClick={() => setActiveView('chat')}>
                  Back to Chat
                </button>
              </div>
            </div>
            {settingsDirty && (
              <div className="settings-dirty-banner">
                You have unsaved changes
              </div>
            )}

            <div className="settings-tabs">
              <button
                className={`settings-tab ${settingsTab === 'personalization' ? 'active' : ''}`}
                onClick={() => setSettingsTab('personalization')}
              >
                Personalization
              </button>
              <button
                className={`settings-tab ${settingsTab === 'instructions' ? 'active' : ''}`}
                onClick={() => setSettingsTab('instructions')}
              >
                Model Instructions
              </button>
              <button
                className={`settings-tab ${settingsTab === 'usage' ? 'active' : ''}`}
                onClick={() => setSettingsTab('usage')}
              >
                Usage
              </button>
              <button
                className={`settings-tab ${settingsTab === 'credits' ? 'active' : ''}`}
                onClick={() => setSettingsTab('credits')}
              >
                Credits
              </button>
            </div>

            <div className="settings-content">
              {settingsTab === 'personalization' && (
                <>
                  {/* Theme */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Theme</h3>
                        <p>Toggle light or dark mode.</p>
                      </div>
                      <button
                        className="button primary"
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      >
                        {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
                      </button>
                    </div>
                  </div>

                  {/* Font Settings */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Font</h3>
                        <p>Customize the chat font family and size.</p>
                      </div>
                    </div>
                    <div className="settings-grid">
                      <div className="settings-field">
                        <label>Font Family</label>
                        <select
                          className="settings-select"
                          value={effectiveSettings.fontFamily}
                          onChange={(e) => handleSettingsChange({ fontFamily: e.target.value })}
                        >
                          <option value="Space Mono">Space Mono</option>
                          <option value="Inter">Inter</option>
                          <option value="SF Pro">SF Pro</option>
                          <option value="Fira Code">Fira Code</option>
                          <option value="JetBrains Mono">JetBrains Mono</option>
                          <option value="system-ui">System Default</option>
                        </select>
                      </div>
                      <div className="settings-field">
                        <label>Font Size</label>
                        <select
                          className="settings-select"
                          value={effectiveSettings.fontSize}
                          onChange={(e) => handleSettingsChange({ fontSize: e.target.value })}
                        >
                          <option value="small">Small</option>
                          <option value="medium">Medium</option>
                          <option value="large">Large</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Hide Cost Per Message */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Hide Cost Per Message</h3>
                        <p>Hide individual message costs in the chat view.</p>
                      </div>
                      <button
                        className={`toggle-button ${effectiveSettings.hideCostPerMessage ? 'active' : ''}`}
                        onClick={() => handleSettingsChange({ hideCostPerMessage: !effectiveSettings.hideCostPerMessage })}
                      >
                        {effectiveSettings.hideCostPerMessage ? 'On' : 'Off'}
                      </button>
                    </div>
                  </div>

                  {/* Notifications */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Notifications</h3>
                        <p>Enable browser notifications for completed responses.</p>
                      </div>
                      <button
                        className={`toggle-button ${effectiveSettings.notifications ? 'active' : ''}`}
                        onClick={async () => {
                          const newVal = !effectiveSettings.notifications;
                          if (newVal) {
                            const granted = await requestNotificationPermission();
                            if (!granted) return;
                          }
                          handleSettingsChange({ notifications: newVal });
                        }}
                      >
                        {effectiveSettings.notifications ? 'On' : 'Off'}
                      </button>
                    </div>
                  </div>

                  {/* Default Model */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Default Model</h3>
                        <p>Model to use when starting a new chat.</p>
                      </div>
                    </div>
                    <select
                      className="settings-select"
                      value={effectiveSettings.defaultModelId ?? ''}
                      onChange={(e) => handleSettingsChange({ defaultModelId: e.target.value || null })}
                    >
                      <option value="">Use first available</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Default Thinking Level */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Default Thinking Level</h3>
                        <p>Thinking level to use when starting a new chat.</p>
                      </div>
                    </div>
                    <select
                      className="settings-select"
                      value={effectiveSettings.defaultThinkingLevel ?? ''}
                      onChange={(e) => handleSettingsChange({ defaultThinkingLevel: e.target.value || null })}
                    >
                      <option value="">Off</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  {/* Model Selector */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Available Models</h3>
                        <p>Choose which models to show in the selector.</p>
                      </div>
                      <button
                        className="button ghost"
                        onClick={() => {
                          const allIds = models.map(m => m.id);
                          handleSettingsChange({ enabledModelIds: allIds });
                        }}
                      >
                        Enable All
                      </button>
                    </div>
                    <div className="settings-model-list">
                      {models.map((model) => {
                        const isEnabled = effectiveSettings.enabledModelIds.length === 0 || effectiveSettings.enabledModelIds.includes(model.id);
                        return (
                          <label key={model.id} className="settings-checkbox">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) => {
                                let newIds: string[];
                                if (effectiveSettings.enabledModelIds.length === 0) {
                                  newIds = models.filter(m => m.id !== model.id).map(m => m.id);
                                } else if (e.target.checked) {
                                  newIds = [...effectiveSettings.enabledModelIds, model.id];
                                } else {
                                  newIds = effectiveSettings.enabledModelIds.filter(id => id !== model.id);
                                }
                                handleSettingsChange({ enabledModelIds: newIds });
                              }}
                            />
                            <span className="checkbox-label">{model.label}</span>
                            <span className="checkbox-id">{model.id}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tool Permissions */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Tool Permissions</h3>
                        <p>Choose which tools the AI can use.</p>
                      </div>
                    </div>
                    <div className="settings-tool-list">
                      {[
                        { id: 'web_search', label: 'Web Search', description: 'Search the web for information' },
                        { id: 'code_interpreter', label: 'Code Interpreter', description: 'Execute code and analyze data' },
                        { id: 'memory', label: 'Memory', description: 'Remember facts across conversations' },
                      ].map((tool) => {
                        const isEnabled = effectiveSettings.enabledTools.includes(tool.id);
                        return (
                          <label key={tool.id} className="settings-checkbox tool">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) => {
                                const newTools = e.target.checked
                                  ? [...effectiveSettings.enabledTools, tool.id]
                                  : effectiveSettings.enabledTools.filter(t => t !== tool.id);
                                handleSettingsChange({ enabledTools: newTools });
                              }}
                            />
                            <div className="checkbox-content">
                              <span className="checkbox-label">{tool.label}</span>
                              <span className="checkbox-description">{tool.description}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'instructions' && (
                <>
                  {/* System Prompt */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>System Prompt</h3>
                        <p>Custom instructions that apply to every message.</p>
                      </div>
                    </div>
                    <textarea
                      value={pendingSettings?.systemPrompt ?? systemPrompt}
                      onChange={(event) => handleSettingsChange({ systemPrompt: event.target.value })}
                      rows={8}
                      placeholder="Enter custom instructions for the AI..."
                    />
                  </div>

                  {/* Memory */}
                  <div className="settings-card">
                    <div className="settings-row">
                      <div>
                        <h3>Memory</h3>
                        <p>Facts and preferences the AI remembers across conversations.</p>
                      </div>
                      <button
                        className="button primary"
                        onClick={handleMemoryExtraction}
                        disabled={isExtractingMemory}
                      >
                        {isExtractingMemory ? 'Extracting...' : 'Update Memory'}
                      </button>
                    </div>
                    <textarea
                      value={memoryContent}
                      onChange={(event) => setMemoryContent(event.target.value)}
                      rows={10}
                      placeholder="Memory is empty. Chat with the AI or click 'Update Memory' to extract memories from your conversations."
                    />
                    <div className="settings-actions">
                      <button className="button primary" onClick={handleMemorySave}>
                        Save Memory
                      </button>
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'usage' && (
                <>
                  {/* Usage Overview */}
                  <div className="settings-card usage-overview">
                    <h3>Usage Overview</h3>
                    {usageStats ? (
                      <div className="usage-stats-grid">
                        <div className="usage-stat">
                          <span className="usage-stat-value">{formatCost(usageStats.totalCost)}</span>
                          <span className="usage-stat-label">Total Cost</span>
                        </div>
                        <div className="usage-stat">
                          <span className="usage-stat-value">{usageStats.totalMessages.toLocaleString()}</span>
                          <span className="usage-stat-label">Total Messages</span>
                        </div>
                        <div className="usage-stat">
                          <span className="usage-stat-value">{usageStats.totalThreads.toLocaleString()}</span>
                          <span className="usage-stat-label">Total Chats</span>
                        </div>
                      </div>
                    ) : (
                      <div className="usage-stats-grid">
                        <div className="usage-stat">
                          <span className="usage-stat-value">{formatCost(threads.reduce((sum, t) => sum + (t.totalCost || 0), 0))}</span>
                          <span className="usage-stat-label">Total Cost</span>
                        </div>
                        <div className="usage-stat">
                          <span className="usage-stat-value">{threads.length}</span>
                          <span className="usage-stat-label">Total Chats</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Daily Activity Chart */}
                  {usageStats && usageStats.dailyStats.length > 0 && (
                    <div className="settings-card">
                      <h3>Daily Activity</h3>
                      <div className="usage-chart">
                        <div className="usage-chart-legend">
                          <span className="usage-legend-item messages">
                            <span className="usage-legend-dot"></span>
                            Messages
                          </span>
                          <span className="usage-legend-item cost">
                            <span className="usage-legend-dot"></span>
                            Cost
                          </span>
                        </div>
                        <svg
                          className="usage-chart-svg"
                          viewBox="0 0 600 220"
                          preserveAspectRatio="xMidYMid meet"
                        >
                          {(() => {
                            const data = usageStats.dailyStats.slice(-14); // Last 14 days
                            const maxMessages = Math.max(...data.map(d => d.messages), 1);
                            const maxCost = Math.max(...data.map(d => d.cost), 0.01);
                            const chartWidth = 540;
                            const chartHeight = 160;
                            const offsetX = 40;
                            const offsetY = 10;

                            // Calculate points for lines
                            const messagePoints = data.map((day, i) => {
                              const x = offsetX + (i / Math.max(data.length - 1, 1)) * chartWidth;
                              const y = offsetY + chartHeight - (day.messages / maxMessages) * chartHeight;
                              return { x, y, ...day };
                            });

                            const costPoints = data.map((day, i) => {
                              const x = offsetX + (i / Math.max(data.length - 1, 1)) * chartWidth;
                              const y = offsetY + chartHeight - (day.cost / maxCost) * chartHeight;
                              return { x, y, ...day };
                            });

                            const messagePath = messagePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                            const costPath = costPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

                            return (
                              <>
                                {/* Grid lines */}
                                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                                  <line
                                    key={ratio}
                                    x1={offsetX}
                                    y1={offsetY + chartHeight * (1 - ratio)}
                                    x2={offsetX + chartWidth}
                                    y2={offsetY + chartHeight * (1 - ratio)}
                                    stroke="var(--border)"
                                    strokeWidth="1"
                                    strokeDasharray={ratio === 0 ? '' : '4,4'}
                                    opacity={0.4}
                                  />
                                ))}

                                {/* Messages line */}
                                <path
                                  d={messagePath}
                                  fill="none"
                                  stroke="var(--accent)"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />

                                {/* Cost line */}
                                <path
                                  d={costPath}
                                  fill="none"
                                  stroke="var(--warning, #f59e0b)"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />

                                {/* Message points */}
                                {messagePoints.map((p) => (
                                  <circle
                                    key={`msg-${p.date}`}
                                    cx={p.x}
                                    cy={p.y}
                                    r="5"
                                    fill="var(--accent)"
                                    stroke="var(--panel)"
                                    strokeWidth="2"
                                  />
                                ))}

                                {/* Cost points */}
                                {costPoints.map((p) => (
                                  <circle
                                    key={`cost-${p.date}`}
                                    cx={p.x}
                                    cy={p.y}
                                    r="5"
                                    fill="var(--warning, #f59e0b)"
                                    stroke="var(--panel)"
                                    strokeWidth="2"
                                  />
                                ))}

                                {/* X-axis labels */}
                                {data.map((day, i) => {
                                  const x = offsetX + (i / Math.max(data.length - 1, 1)) * chartWidth;
                                  const dateLabel = new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                                  return (
                                    <text
                                      key={day.date}
                                      x={x}
                                      y={offsetY + chartHeight + 20}
                                      textAnchor="middle"
                                      fill="var(--muted)"
                                      fontSize="10"
                                    >
                                      {dateLabel}
                                    </text>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </svg>
                        <div className="usage-chart-summary">
                          {usageStats.dailyStats.slice(-7).map((day) => (
                            <div key={day.date} className="usage-chart-day">
                              <span className="usage-chart-day-date">
                                {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                              </span>
                              <span className="usage-chart-day-messages">{day.messages} msgs</span>
                              <span className="usage-chart-day-cost">{formatCost(day.cost)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Cost by Model */}
                  <div className="settings-card">
                    <h3>Cost by Model</h3>
                    {usageStats && Object.keys(usageStats.costByModel).length > 0 ? (
                      <div className="usage-model-list">
                        {Object.entries(usageStats.costByModel)
                          .sort(([, a], [, b]) => b - a)
                          .map(([modelId, cost]) => (
                            <div key={modelId} className="usage-model-row">
                              <span className="usage-model-name">{modelId}</span>
                              <span className="usage-model-cost">{formatCost(cost)}</span>
                              <span className="usage-model-messages">
                                {usageStats.messagesByModel[modelId] || 0} messages
                              </span>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="usage-empty">No usage data available yet. Start chatting to see your usage breakdown.</p>
                    )}
                  </div>

                  {/* Recent Activity */}
                  <div className="settings-card">
                    <h3>Recent Chats</h3>
                    <div className="usage-recent-list">
                      {threads.slice(0, 10).map((thread) => (
                        <div key={thread.id} className="usage-recent-row">
                          <span className="usage-recent-title">{thread.title || 'Untitled chat'}</span>
                          <span className="usage-recent-cost">{formatCost(thread.totalCost)}</span>
                          <span className="usage-recent-date">
                            {new Date(thread.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                      {threads.length === 0 && (
                        <p className="usage-empty">No chats yet.</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'credits' && (
                <>
                  {/* Credits Balance */}
                  <div className="settings-card credits-balance-card">
                    <div className="credits-balance">
                      <div className="credits-amount">
                        <span className="credits-value">
                          {credits ? credits.credits.toFixed(2) : '—'}
                        </span>
                        <span className="credits-label">credits remaining</span>
                      </div>
                      <div className="credits-info">
                        <p>1 credit = $1.00 USD</p>
                        <p>Credits are deducted based on API usage costs.</p>
                      </div>
                    </div>
                    {credits && credits.credits < 1 && (
                      <div className="credits-warning">
                        Your credit balance is low. You may run out of credits soon.
                      </div>
                    )}
                  </div>

                  {/* How Credits Work */}
                  <div className="settings-card">
                    <h3>How Credits Work</h3>
                    <div className="credits-explanation">
                      <div className="credits-explanation-item">
                        <span className="credits-explanation-icon">💬</span>
                        <div>
                          <strong>LLM Usage</strong>
                          <p>Credits are deducted based on the tokens used in your conversations. Different models have different costs per token.</p>
                        </div>
                      </div>
                      <div className="credits-explanation-item">
                        <span className="credits-explanation-icon">🔍</span>
                        <div>
                          <strong>Web Search</strong>
                          <p>Each web search costs $0.005 (0.5 cents) per request.</p>
                        </div>
                      </div>
                      <div className="credits-explanation-item">
                        <span className="credits-explanation-icon">🎁</span>
                        <div>
                          <strong>Starter Credits</strong>
                          <p>All new accounts receive 10 free credits to get started.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Usage Summary */}
                  {usageStats && (
                    <div className="settings-card">
                      <h3>Credits Used</h3>
                      <div className="credits-used-summary">
                        <div className="credits-used-stat">
                          <span className="credits-used-value">{formatCost(usageStats.totalCost)}</span>
                          <span className="credits-used-label">Total Spent</span>
                        </div>
                        <div className="credits-used-stat">
                          <span className="credits-used-value">{usageStats.totalMessages.toLocaleString()}</span>
                          <span className="credits-used-label">Messages</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}
      </main>

      {(openTraceMessageId || streamingTraceMessageId) && (
        <>
          <div
            className="trace-backdrop"
            onClick={() => {
              setOpenTraceMessageId(null);
              setStreamingTraceMessageId(null);
            }}
            aria-hidden="true"
          />
          <aside className="trace-panel">
            <div className="trace-panel-header">
              <div>
                <div className="trace-panel-title">
                  {streamingTraceMessageId ? 'Thinking…' : 'Trace'}
                </div>
                <div className="trace-panel-subtitle">
                  {messages.find((m) => m.id === (openTraceMessageId || streamingTraceMessageId))?.trace?.length ?? 0} events
                  {streamingTraceMessageId && ' · streaming'}
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  setOpenTraceMessageId(null);
                  setStreamingTraceMessageId(null);
                }}
                aria-label="Close trace panel"
              >
                ×
              </button>
            </div>
            <div className="trace-panel-body">
              {messages
                .find((m) => m.id === (openTraceMessageId || streamingTraceMessageId))
                ?.trace?.map((event) => (
                  <div key={event.id} className={`trace-block ${event.type}`}>
                    <div className="trace-block-header">
                      <span className="trace-block-type">
                        {event.type === 'reasoning' ? 'Thinking' : 'Tool Call'}
                      </span>
                    </div>
                    <pre className="trace-block-content">{event.content}</pre>
                  </div>
                )) ?? <div className="trace-empty">No trace events</div>}
            </div>
          </aside>
        </>
      )}

      {openSourcesMessageId && (
        <>
          <div
            className="trace-backdrop"
            onClick={() => setOpenSourcesMessageId(null)}
            aria-hidden="true"
          />
          <aside className="sources-panel">
            <div className="trace-panel-header">
              <div>
                <div className="trace-panel-title">Sources</div>
                <div className="trace-panel-subtitle">
                  {messages.find((m) => m.id === openSourcesMessageId)?.sources?.length ?? 0} sources
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => setOpenSourcesMessageId(null)}
                aria-label="Close sources panel"
              >
                ×
              </button>
            </div>
            <div className="sources-panel-body">
              {messages
                .find((m) => m.id === openSourcesMessageId)
                ?.sources?.map((source) => (
                  <a
                    key={source.id}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="source-item"
                  >
                    <div className="source-title">{source.title}</div>
                    {source.snippet && <div className="source-snippet">{source.snippet}</div>}
                    <div className="source-url">{source.url}</div>
                  </a>
                )) ?? <div className="trace-empty">No sources</div>}
            </div>
          </aside>
        </>
      )}

        {errorMessage && (
          <div className="toast" onClick={() => setErrorMessage(null)}>
            {errorMessage}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
