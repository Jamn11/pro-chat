import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  createThread,
  deleteThread,
  fetchMessages,
  fetchModels,
  fetchSettings,
  fetchThreads,
  streamChat,
  updateSettings,
  uploadFiles,
} from './api';
import type { Attachment, ModelInfo, ThreadSummary, UIMessage } from './types';
import './App.css';

type Theme = 'light' | 'dark';
type ViewMode = 'chat' | 'settings';
type ThinkingLevel = 'low' | 'medium' | 'high';
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

const CLAUDE_THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  low: 8192,
  medium: 16384,
  high: 32768,
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
    ];
  }
  return [
    { value: null, label: 'Thinking: Off' },
    { value: 'low', label: 'Thinking: Low' },
    { value: 'medium', label: 'Thinking: Medium' },
    { value: 'high', label: 'Thinking: High' },
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

export default function App() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingSelection>('medium');
  const [composer, setComposer] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [activeView, setActiveView] = useState<ViewMode>('chat');
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return 'dark';
    return (storage.getItem('pro-chat-theme') as Theme) || 'dark';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamDuration, setStreamDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const streamTimerRef = useRef<number | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) || null;
  const selectedModel = models.find((model) => model.id === selectedModelId) || null;
  const thinkingOptions = useMemo(() => getThinkingOptions(selectedModel), [selectedModel]);
  const slashQuery = useMemo(() => {
    const trimmed = composer.trimStart();
    if (!trimmed.startsWith('/')) return null;
    if (composer.includes('\n')) return null;
    return trimmed.slice(1);
  }, [composer]);
  const modelSuggestions = useMemo(() => {
    if (slashQuery === null) return [];
    const query = normalizeModelText(slashQuery.trim());
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
  }, [models, slashQuery]);
  const slashCommandActive = slashQuery !== null;

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
    async function load() {
      const [modelList, threadList, settings] = await Promise.all([
        fetchModels(),
        fetchThreads(),
        fetchSettings(),
      ]);
      setModels(modelList);
      setThreads(threadList);
      if (modelList.length > 0) {
        setSelectedModelId(modelList[0].id);
      }
      setSystemPrompt(settings.systemPrompt ?? '');
      if (threadList.length > 0) {
        setActiveThreadId(threadList[0].id);
      }
    }
    load().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load');
    });
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    fetchMessages(activeThreadId)
      .then((data) => setMessages(data))
      .catch((error) =>
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load messages'),
      );
  }, [activeThreadId]);

  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
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

  const handleNewThread = useCallback(async () => {
    const thread = await createThread(null);
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
    setActiveView('chat');
    setMessages([]);
  }, []);

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
      setActiveThreadId(nextThread?.id ?? null);
      setMessages([]);
    }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    let threadId = activeThreadId;
    if (!threadId) {
      const newThread = await createThread(null);
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(newThread.id);
      setActiveView('chat');
      threadId = newThread.id;
    }
    const uploaded = await uploadFiles(threadId, fileList);
    setAttachments((prev) => [...prev, ...uploaded]);
  };

  const handleSelectModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setComposer('');
    if (composerRef.current) {
      composerRef.current.focus();
      composerRef.current.style.height = 'auto';
    }
  };

  const handleSend = async () => {
    if (isStreaming) return;
    let content = composer.trim();
    if (!content && attachments.length > 0) {
      content = 'Please review the attached file(s).';
    }
    if (!content) return;

    let threadId = activeThreadId;
    if (!threadId) {
      const newThread = await createThread(null);
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(newThread.id);
      setActiveView('chat');
      threadId = newThread.id;
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
    if (composerRef.current) {
      composerRef.current.style.height = 'auto';
    }

    const start = Date.now();
    streamTimerRef.current = window.setInterval(() => {
      setStreamDuration(Date.now() - start);
    }, 100);

    try {
      await streamChat(
        {
          threadId,
          content,
          modelId: selectedModelId,
          thinkingLevel: thinkingLevel ?? null,
          attachmentIds: attachments.map((a) => a.id),
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
              prev.map((thread) =>
                thread.id === threadId
                  ? { ...thread, totalCost: data.totalCost, updatedAt: new Date().toISOString() }
                  : thread,
              ),
            );
          },
          onError: (message) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempAssistantId
                  ? { ...msg, content: message, status: 'error' }
                  : msg,
              ),
            );
          },
        },
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Streaming failed');
    } finally {
      if (streamTimerRef.current) {
        window.clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      setIsStreaming(false);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (slashCommandActive && modelSuggestions.length > 0) {
        handleSelectModel(modelSuggestions[0].id);
        return;
      }
      handleSend();
    }
  };

  const handleSettingsSave = async () => {
    const updated = await updateSettings(systemPrompt);
    setSystemPrompt(updated.systemPrompt ?? '');
  };

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside
        className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
        aria-hidden={sidebarCollapsed}
      >
        <div className="sidebar-top">
          <div className="brand">{sidebarCollapsed ? 'pc' : 'pro-chat'}</div>
          <button
            className="icon-button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '>' : '<'}
          </button>
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
                  setActiveThreadId(thread.id);
                  setActiveView('chat');
                }}
              >
                <span className="thread-title">{thread.title ?? 'Untitled chat'}</span>
                <span className="thread-cost">{formatCost(thread.totalCost)}</span>
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
                <span className="cost-chip">Chat total {formatCost(chatTotalCost)}</span>
                {isStreaming && (
                  <span className="timer-chip">⏱ {(streamDuration / 1000).toFixed(2)}s</span>
                )}
              </div>
            </header>

            <section className="messages">
              {messages.length === 0 && (
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
                    {message.cost != null && message.role === 'assistant' && (
                      <span>{formatCost(message.cost)}</span>
                    )}
                    {message.role === 'assistant' && formatDuration(message.durationMs) && (
                      <span>⏱ {formatDuration(message.durationMs)}</span>
                    )}
                    {message.modelId && <span>{message.modelId}</span>}
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
                placeholder="Type your message..."
                rows={1}
              />
              {slashCommandActive && modelSuggestions.length > 0 && (
                <div className="composer-suggestions">
                  <div className="composer-suggestion-hint">Select a model</div>
                  {modelSuggestions.map((model, index) => (
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
                      (event.target.value || null) as 'low' | 'medium' | 'high' | null,
                    )
                  }
                >
                  {thinkingOptions.map((option) => (
                    <option key={option.label} value={option.value ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button className="button primary" onClick={handleSend} disabled={isStreaming}>
                  Send
                </button>
              </div>
            </section>
          </>
        ) : (
          <section className="settings-view">
            <div className="settings-header">
              <div>
                <h2>Settings</h2>
                <p>Customize your experience and system prompt.</p>
              </div>
              <button className="button ghost" onClick={() => setActiveView('chat')}>
                Back to Chat
              </button>
            </div>
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
            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <h3>System Prompt</h3>
                  <p>Applies to every message in the current session.</p>
                </div>
              </div>
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={6}
              />
              <div className="settings-actions">
                <button className="button primary" onClick={handleSettingsSave}>
                  Save Prompt
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {errorMessage && (
        <div className="toast" onClick={() => setErrorMessage(null)}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
