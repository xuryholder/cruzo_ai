'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createIdempotencyKey } from '../(cruzo)/_lib/manual-client';

const MAX_PROMPT = 300;
const POLL_INTERVAL_MS = 2500;
const STORAGE_SESSION_KEY = 'cruzo.studio.sessionId';
const STORAGE_HISTORY_KEY = 'cruzo.studio.history.v1';
const HISTORY_LIMIT = 24;

type AspectRatio = '1:1' | '4:5' | '9:16';
type GenerationStatus = 'queued' | 'processing_image' | 'completed' | 'failed' | 'canceled';

type GenerationItem = {
  id: string;
  prompt: string;
  style: string;
  aspectRatio: AspectRatio;
  status: GenerationStatus;
  imageUrl: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T;
  retryAfterSeconds: number | null;
};

const ASPECT_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: '1:1', label: '1080 x 1080' },
  { value: '4:5', label: '1024 x 1280' },
  { value: '9:16', label: '1024 x 1792' },
];

const STYLE_PRESETS = ['photorealistic', '3d render', 'anime', 'watercolor', 'minimal'] as const;

const PROMPT_SUGGESTIONS = [
  'Birthday card with elegant confetti and soft pastel lighting',
  'Warm thank-you postcard with watercolor flowers',
  'Anniversary greeting with cinematic gold typography',
  'Minimal congratulation card with geometric shapes',
  'Festive holiday card with cozy night atmosphere',
] as const;

const STATUS_TEXT: Record<GenerationStatus, string> = {
  queued: 'Queued',
  processing_image: 'Generating...',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
};

export default function StudioPage() {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<(typeof STYLE_PRESETS)[number]>('photorealistic');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [balance, setBalance] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<GenerationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);

  const chars = useMemo(() => prompt.length, [prompt]);

  const selectedGeneration = useMemo(() => {
    if (selectedId) {
      return history.find((item) => item.id === selectedId) || null;
    }

    return history[0] || null;
  }, [history, selectedId]);

  const activeGenerationIds = useMemo(
    () => history.filter((item) => item.status === 'queued' || item.status === 'processing_image').map((item) => item.id),
    [history],
  );

  const canCreate = prompt.trim().length >= 3 && !isCreating && retryAfterSeconds <= 0 && (balance === null || balance > 0);
  const canDownload = selectedGeneration?.status === 'completed' && !!selectedGeneration.imageUrl;
  const canRegenerate = !!selectedGeneration && !isCreating && retryAfterSeconds <= 0;

  const updateHistory = useCallback((generationId: string, patch: Partial<GenerationItem>) => {
    setHistory((prev) => {
      const index = prev.findIndex((item) => item.id === generationId);
      if (index === -1) {
        if (!patch.prompt || !patch.style || !patch.aspectRatio || !patch.status) {
          return prev;
        }

        const next: GenerationItem = {
          id: generationId,
          prompt: patch.prompt,
          style: patch.style,
          aspectRatio: patch.aspectRatio,
          status: patch.status,
          imageUrl: patch.imageUrl ?? null,
          errorCode: patch.errorCode ?? null,
          createdAt: patch.createdAt || new Date().toISOString(),
          updatedAt: patch.updatedAt || new Date().toISOString(),
        };

        return [next, ...prev].slice(0, HISTORY_LIMIT);
      }

      const next = [...prev];
      next[index] = {
        ...next[index],
        ...patch,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selectedId && history.length > 0) {
      setSelectedId(history[0].id);
    }
  }, [history, selectedId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (sessionId) {
      window.localStorage.setItem(STORAGE_SESSION_KEY, sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    if (retryAfterSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setRetryAfterSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [retryAfterSeconds]);

  const callApi = useCallback(
    async <T,>(
      path: string,
      options?: {
        method?: 'GET' | 'POST';
        sessionId?: string;
        idempotencyKey?: string;
        body?: unknown;
      },
    ): Promise<ApiResult<T>> => {
      const headers: Record<string, string> = {};
      if (options?.sessionId) {
        headers['x-session-id'] = options.sessionId;
      }

      if (options?.idempotencyKey) {
        headers['x-idempotency-key'] = options.idempotencyKey;
      }

      if (options?.body !== undefined) {
        headers['content-type'] = 'application/json';
      }

      const response = await fetch(path, {
        method: options?.method ?? 'GET',
        headers,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
      });

      let data: T;
      try {
        data = (await response.json()) as T;
      } catch {
        data = { message: 'Unexpected API response' } as T;
      }

      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterFromHeader = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;
      const retryAfterFromBody = extractRetryAfterSeconds(data);

      return {
        ok: response.ok,
        status: response.status,
        data,
        retryAfterSeconds: retryAfterFromBody ?? retryAfterFromHeader,
      };
    },
    [],
  );

  const bootstrapSession = useCallback(async () => {
    const result = await callApi<{ sessionId: string; balance: number }>('/api/studio/bootstrap', {
      method: 'POST',
      body: {},
    });

    if (!result.ok || !result.data?.sessionId) {
      throw new Error('Failed to initialize session');
    }

    setSessionId(result.data.sessionId);
    setBalance(result.data.balance);
    return result.data.sessionId;
  }, [callApi]);

  const fetchBalance = useCallback(
    async (sid: string): Promise<boolean> => {
      const result = await callApi<{ balance: number; message?: string }>('/api/studio/balance', {
        method: 'GET',
        sessionId: sid,
      });

      if (!result.ok || typeof result.data?.balance !== 'number') {
        return false;
      }

      setBalance(result.data.balance);
      return true;
    },
    [callApi],
  );

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) {
      return sessionId;
    }

    return bootstrapSession();
  }, [bootstrapSession, sessionId]);

  const refreshGeneration = useCallback(
    async (sid: string, generationId: string) => {
      const result = await callApi<GenerationItem | { message?: string }>(`/api/studio/generations/${generationId}`, {
        method: 'GET',
        sessionId: sid,
      });

      if (!result.ok) {
        return;
      }

      const payload = result.data as GenerationItem;
      updateHistory(generationId, {
        status: payload.status,
        imageUrl: payload.imageUrl,
        errorCode: payload.errorCode,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      });

      if (payload.status === 'failed') {
        void fetchBalance(sid);
      }
    },
    [callApi, fetchBalance, updateHistory],
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const storedHistory = readHistoryFromStorage();
      if (!cancelled && storedHistory.length > 0) {
        setHistory(storedHistory);
      }

      const storedSessionId = readSessionIdFromStorage();
      if (storedSessionId) {
        setSessionId(storedSessionId);
        const balanceOk = await fetchBalance(storedSessionId);
        if (balanceOk) {
          return;
        }
      }

      try {
        await bootstrapSession();
      } catch (error) {
        if (!cancelled) {
          setErrorMessage((error as Error).message);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [bootstrapSession, fetchBalance]);

  useEffect(() => {
    if (!sessionId || activeGenerationIds.length === 0) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      await Promise.all(activeGenerationIds.map((generationId) => refreshGeneration(sessionId, generationId)));
    };

    void tick();
    const timer = window.setInterval(() => {
      if (!cancelled) {
        void tick();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeGenerationIds, refreshGeneration, sessionId]);

  const submitGeneration = useCallback(
    async (input?: { prompt: string; style: string; aspectRatio: AspectRatio }) => {
      const finalPrompt = (input?.prompt ?? prompt).trim();
      const finalStyle = (input?.style ?? style) as (typeof STYLE_PRESETS)[number];
      const finalAspect = input?.aspectRatio ?? aspectRatio;

      if (finalPrompt.length < 3) {
        setErrorMessage('Prompt is too short. Minimum 3 characters.');
        return;
      }

      if (retryAfterSeconds > 0) {
        setErrorMessage(`Request limit exceeded. Try again in ${retryAfterSeconds}s.`);
        return;
      }

      setIsCreating(true);
      setErrorMessage(null);

      try {
        const sid = await ensureSession();
        const idempotencyKey = createIdempotencyKey('studio-generate');

        const result = await callApi<{
          generationId: string;
          status: GenerationStatus;
          remainingCredits: number;
          deduplicated: boolean;
          message?: string;
          retryAfterSeconds?: number;
        }>('/api/studio/generations', {
          method: 'POST',
          sessionId: sid,
          idempotencyKey,
          body: {
            prompt: finalPrompt,
            style: finalStyle,
            aspectRatio: finalAspect,
          },
        });

        if (!result.ok) {
          const apiMessage = (result.data as { message?: string })?.message || 'Failed to create generation';
          setErrorMessage(apiMessage);

          if (result.status === 429 && result.retryAfterSeconds) {
            setRetryAfterSeconds(result.retryAfterSeconds);
          }
          return;
        }

        setBalance(result.data.remainingCredits);
        setSelectedId(result.data.generationId);

        updateHistory(result.data.generationId, {
          prompt: finalPrompt,
          style: finalStyle,
          aspectRatio: finalAspect,
          status: result.data.status,
          imageUrl: null,
          errorCode: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        setErrorMessage((error as Error).message || 'Unexpected network error');
      } finally {
        setIsCreating(false);
      }
    },
    [aspectRatio, callApi, ensureSession, prompt, retryAfterSeconds, style, updateHistory],
  );

  const onPromptSuggestion = useCallback((value: string) => {
    setPrompt(value.slice(0, MAX_PROMPT));
  }, []);

  const onDownload = useCallback(() => {
    if (!selectedGeneration?.imageUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = selectedGeneration.imageUrl;
    link.download = `${selectedGeneration.id}.png`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.click();
  }, [selectedGeneration]);

  const onRegenerate = useCallback(() => {
    if (!selectedGeneration) {
      return;
    }

    void submitGeneration({
      prompt: selectedGeneration.prompt,
      style: selectedGeneration.style,
      aspectRatio: selectedGeneration.aspectRatio,
    });
  }, [selectedGeneration, submitGeneration]);

  return (
    <div className="studio-root">
      <header className="studio-header">
        <span className="brand" aria-label="Cruzo AI Studio">
          <Image
            src="/cruzo_main_logo_black.png"
            alt="Cruzo AI"
            width={220}
            height={64}
            className="brand-logo"
            priority
          />
        </span>
        <Link href="/live" className="live-link">
          Open Live Canvas
        </Link>
      </header>

      <section className="studio-shell">
        <aside className="left-panel">
          <div className="panel-top">
            <span className="credits-chip">Credits: {balance === null ? '...' : balance}</span>
          </div>

          <div className="prompt-head">
            <label className="field-label" htmlFor="prompt-input">
              Prompt
            </label>
            <span className="counter">
              {chars}/{MAX_PROMPT}
            </span>
          </div>

          <textarea
            id="prompt-input"
            placeholder="Describe your birthday card"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, MAX_PROMPT))}
          />

          <div className="style-group">
            <span className="field-label">Style</span>
            <div className="style-chips">
              {STYLE_PRESETS.map((item) => {
                const active = style === item;
                return (
                  <button
                    key={item}
                    type="button"
                    className={`style-chip ${active ? 'style-chip-active' : ''}`}
                    onClick={() => setStyle(item)}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="style-group">
            <span className="field-label">Suggestions</span>
            <div className="style-chips">
              {PROMPT_SUGGESTIONS.map((item) => (
                <button key={item} type="button" className="style-chip" onClick={() => onPromptSuggestion(item)}>
                  Use
                </button>
              ))}
            </div>
          </div>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          {retryAfterSeconds > 0 ? (
            <p className="retry-text">Try again in {retryAfterSeconds}s.</p>
          ) : null}

          <div className="actions">
            <button type="button" className="create-btn" disabled={!canCreate} onClick={() => void submitGeneration()}>
              Generate
            </button>
            <button type="button" className="icon-btn" disabled={!canRegenerate} onClick={onRegenerate}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 4v6h-6" />
                <path d="M4 20v-6h6" />
                <path d="M20 10a8 8 0 0 0-13-4" />
                <path d="M4 14a8 8 0 0 0 13 4" />
              </svg>
            </button>
            <button type="button" className="icon-btn" disabled={!canDownload} onClick={onDownload}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M4 20h16" />
              </svg>
            </button>
          </div>
        </aside>

        <div className="canvas-zone">
          <div className="canvas-card">
            {selectedGeneration?.imageUrl ? (
              <img className="canvas-image" src={selectedGeneration.imageUrl} alt="Generated" />
            ) : (
              <div className="canvas-placeholder">
                {selectedGeneration?.status === 'queued' || selectedGeneration?.status === 'processing_image' ? (
                  <>
                    <span className="spinner" />
                    <p>Generating image...</p>
                    <small>This can take a few seconds.</small>
                  </>
                ) : (
                  <>
                    <p>Prompt a birthday image to start</p>
                    <small>Result will appear here</small>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="canvas-meta">
            {selectedGeneration ? (
              <span className={`status-pill status-${selectedGeneration.status}`}>
                {STATUS_TEXT[selectedGeneration.status]}
              </span>
            ) : null}
          </div>

          <div className="canvas-controls">
            <div className="select-wrap size-select">
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
                {ASPECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <aside className="thumb-panel">
          <p className="history-title">History</p>
          <div className="history-list">
            {history.length === 0 ? <p className="history-empty">No generations yet</p> : null}
            {history.map((item) => {
              const isActive = selectedGeneration?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`history-item ${isActive ? 'history-item-active' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="thumb-card">
                    {item.imageUrl ? (
                      <img className="thumb-image" src={item.imageUrl} alt={item.prompt} />
                    ) : (
                      <span className="thumb-state">{STATUS_TEXT[item.status]}</span>
                    )}
                  </div>
                  <span className="history-prompt" title={item.prompt}>
                    {item.prompt}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </section>

      <footer className="studio-footer" />
    </div>
  );
}

function extractRetryAfterSeconds(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as { retryAfterSeconds?: unknown; retryAfter?: unknown };

  if (typeof candidate.retryAfterSeconds === 'number' && Number.isFinite(candidate.retryAfterSeconds)) {
    return candidate.retryAfterSeconds;
  }

  if (typeof candidate.retryAfter === 'number' && Number.isFinite(candidate.retryAfter)) {
    return candidate.retryAfter;
  }

  return null;
}

function readSessionIdFromStorage(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_SESSION_KEY);
  if (!stored || stored.trim().length === 0) {
    return null;
  }

  return stored;
}

function readHistoryFromStorage(): GenerationItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_HISTORY_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (typeof item !== 'object' || item === null) {
          return null;
        }

        const candidate = item as Partial<GenerationItem>;
        if (!candidate.id || !candidate.prompt || !candidate.style || !candidate.aspectRatio || !candidate.status) {
          return null;
        }

        return {
          id: candidate.id,
          prompt: candidate.prompt,
          style: candidate.style,
          aspectRatio: candidate.aspectRatio,
          status: candidate.status,
          imageUrl: candidate.imageUrl ?? null,
          errorCode: candidate.errorCode ?? null,
          createdAt: candidate.createdAt ?? new Date().toISOString(),
          updatedAt: candidate.updatedAt ?? new Date().toISOString(),
        } as GenerationItem;
      })
      .filter((item): item is GenerationItem => item !== null)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}
