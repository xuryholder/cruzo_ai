'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '../(cruzo)/_lib/manual-client';
import { PcmAudioStream } from './_lib/audio-stream';
import { GeminiLiveClient } from './_lib/gemini-live-client';

type LivePhase =
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'user_speaking'
  | 'model_thinking'
  | 'model_streaming'
  | 'interrupted'
  | 'image_queued'
  | 'image_ready'
  | 'fallback';

type LiveMode = 'live' | 'fallback';
type Tone = 'warm' | 'friendly' | 'formal' | 'playful';
type VariantStatus = 'idle' | 'queued' | 'completed' | 'failed';

type TranscriptTurn = {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
};

type GuidedOutput = {
  greetingDraft: string;
  cardConcept: string;
};

type VisualVariant = {
  id: string;
  status: VariantStatus;
  prompt: string;
  imageUrl: string | null;
  createdAt: string;
};

type LiveTurnResponse = {
  greetingDraft: string;
  cardConcept: string;
  voiceSummary: string;
};

type LiveTokenResponse = {
  supported: boolean;
  token: string | null;
  model: string;
  message: string;
};

type LiveTranscribeResponse = {
  text: string;
  provider: 'gemini' | 'fallback';
};

const INTENTS: Array<{ label: string; tone?: Tone; instruction: string }> = [
  { label: 'Make it warmer', tone: 'warm', instruction: 'Make it emotionally warm and sincere.' },
  { label: 'Shorter', instruction: 'Reduce to 30-40 words max.' },
  { label: 'For colleague', tone: 'formal', instruction: 'Adjust for a professional colleague relationship.' },
  { label: 'Add humor', tone: 'playful', instruction: 'Add light playful humor without sarcasm.' },
];

const PHASE_LABEL: Record<LivePhase, string> = {
  connecting: 'Connecting',
  ready: 'Ready',
  listening: 'Listening',
  user_speaking: 'User speaking',
  model_thinking: 'Model thinking',
  model_streaming: 'Model streaming',
  interrupted: 'Interrupted',
  image_queued: 'Image queued',
  image_ready: 'Image ready',
  fallback: 'Fallback mode',
};

const LIVE_SYSTEM_PROMPT = [
  'You are Cruzo Live, a real-time greeting card agent.',
  'Return strict JSON with keys: greetingDraft, cardConcept, voiceSummary.',
  'greetingDraft: polished final message text.',
  'cardConcept: production-ready visual prompt under 220 chars.',
  'voiceSummary: one short sentence summary.',
  'No markdown. No code fences. JSON only.',
  'Do not include analysis or reasoning. Only output the JSON object.',
].join(' ');

export default function LivePage() {
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [studioSessionId, setStudioSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<LivePhase>('ready');
  const [mode, setMode] = useState<LiveMode>('live');
  const [tone, setTone] = useState<Tone>('friendly');
  const [liveInput, setLiveInput] = useState('');
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [output, setOutput] = useState<GuidedOutput>({
    greetingDraft: '',
    cardConcept: '',
  });
  const [variants, setVariants] = useState<VisualVariant[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [micSessionActive, setMicSessionActive] = useState(false);
  const [tokenState, setTokenState] = useState<'idle' | 'ready' | 'unavailable'>('idle');
  const [debugTrace, setDebugTrace] = useState<string[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const activeTurnAbortRef = useRef<AbortController | null>(null);
  const liveClientRef = useRef<GeminiLiveClient | null>(null);
  const audioStreamRef = useRef<PcmAudioStream | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const speechHardStopTimerRef = useRef<number | null>(null);
  const noSpeechTimerRef = useRef<number | null>(null);
  const lastUserRequestRef = useRef(liveInput);
  const toneRef = useRef<Tone>(tone);
  const modeRef = useRef<LiveMode>(mode);
  const micSessionActiveRef = useRef(false);
  const liveTransportFailedRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const liveAudioReadyRef = useRef(false);
  const liveUserHasSpokenRef = useRef(false);
  const liveTurnEndedRef = useRef(false);
  const liveFinalizedRef = useRef(false);
  const liveTranscriptBufferRef = useRef('');
  const startMicRef = useRef<((options?: { resetDraft?: boolean; appendUserPlaceholder?: boolean }) => Promise<void>) | null>(null);
  const bufferedAudioChunksRef = useRef<Array<{ audio: { mimeType: string; data: string }; level: number }>>([]);

  const lastVariant = useMemo(() => variants[0] || null, [variants]);

  const appendTurn = useCallback((role: 'user' | 'agent' | 'system', text: string) => {
    const cleaned = text.trim();
    if (!cleaned) {
      return;
    }

    setTranscript((prev) => [
      ...prev,
      {
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        text: cleaned,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  const pushDebug = useCallback((event: string, meta?: string) => {
    const stamp = new Date().toISOString().slice(11, 23);
    const line = meta ? `${stamp} ${event} | ${meta}` : `${stamp} ${event}`;
    setDebugTrace((prev) => [...prev.slice(-119), line]);
  }, []);

  const updateLastTurnDelta = useCallback((role: 'user' | 'agent', delta: string) => {
    if (!delta) {
      return;
    }

    setTranscript((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === role) {
        next[next.length - 1] = {
          ...last,
          text: `${last.text}${delta}`,
          timestamp: new Date().toISOString(),
        };
        return next;
      }

      next.push({
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        text: delta,
        timestamp: new Date().toISOString(),
      });
      return next;
    });
  }, []);

  const initializeLiveSession = useCallback(async () => {
    if (liveSessionId) {
      return liveSessionId;
    }

    const response = await fetch('/api/live/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locale: 'en-US',
        persona: 'cruzo-live-birthday-agent',
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      setMode('fallback');
      setPhase('fallback');
      const message = await readApiMessage(response, 'Live backend unavailable, using fallback mode.');
      setErrorMessage(message);
      return 'local-fallback';
    }

    const payload = (await response.json()) as { sessionId?: string; liveSessionId?: string; mode?: 'live' | 'fallback' };
    const sid = payload.liveSessionId || payload.sessionId || `local-${Date.now()}`;
    setLiveSessionId(sid);

    if (payload.mode === 'fallback') {
      setMode('fallback');
      setPhase('fallback');
    }

    return sid;
  }, [liveSessionId]);

  const ensureToken = useCallback(async (sid: string) => {
    const response = await fetch('/api/live/token', {
      method: 'POST',
      headers: {
        'x-live-session-id': sid,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      setTokenState('unavailable');
      return null;
    }

    const payload = (await response.json()) as LiveTokenResponse;
    setTokenState(payload.supported ? 'ready' : 'unavailable');
    return payload;
  }, []);

  const ensureStudioSession = useCallback(async () => {
    if (studioSessionId) {
      return studioSessionId;
    }

    const response = await fetch('/api/studio/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Cannot initialize studio session');
    }

    const payload = (await response.json()) as { sessionId: string };
    setStudioSessionId(payload.sessionId);
    return payload.sessionId;
  }, [studioSessionId]);

  const generateVisualVariant = useCallback(async (visualPrompt: string) => {
    const sid = await ensureStudioSession();
    const pendingId = `pending-${Date.now()}`;
    const createdAt = new Date().toISOString();

    const pendingVariant: VisualVariant = {
      id: pendingId,
      status: 'queued',
      prompt: visualPrompt,
      imageUrl: null,
      createdAt,
    };

    setVariants((prev) => [pendingVariant, ...prev].slice(0, 6));

    const createResponse = await fetch('/api/studio/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': sid,
        'x-idempotency-key': createIdempotencyKey('live-visual'),
      },
      body: JSON.stringify({
        prompt: visualPrompt,
        style: 'minimal',
        aspectRatio: '1:1',
      }),
      cache: 'no-store',
    });

    if (!createResponse.ok) {
      setVariants((prev) => prev.map((item) => item.id === pendingId ? { ...item, status: 'failed' } : item));
      return false;
    }

    const created = (await createResponse.json()) as { generationId: string };
    const generationId = created.generationId;
    let pollCount = 0;

    setVariants((prev) => prev.map((item) => item.id === pendingId ? { ...item, id: generationId } : item));

    while (pollCount < 30) {
      pollCount += 1;
      await sleep(1600);

      const statusResponse = await fetch(`/api/studio/generations/${generationId}`, {
        method: 'GET',
        headers: { 'x-session-id': sid },
        cache: 'no-store',
      });

      if (!statusResponse.ok) {
        continue;
      }

      const status = (await statusResponse.json()) as {
        id: string;
        status: 'queued' | 'processing_image' | 'completed' | 'failed' | 'canceled';
        imageUrl: string | null;
      };

      if (status.status === 'completed') {
        setVariants((prev) => prev.map((item) => item.id === generationId ? {
          ...item,
          status: 'completed',
          imageUrl: status.imageUrl,
        } : item));
        return true;
      }

      if (status.status === 'failed' || status.status === 'canceled') {
        setVariants((prev) => prev.map((item) => item.id === generationId ? { ...item, status: 'failed' } : item));
        return false;
      }
    }

    setVariants((prev) => prev.map((item) => item.id === generationId ? { ...item, status: 'failed' } : item));
    return false;
  }, [ensureStudioSession]);

  const setupLiveClient = useCallback((client: GeminiLiveClient) => {
    const cleanups: Array<() => void> = [];

    cleanups.push(client.on('state', ({ state }) => {
      pushDebug('live_state', state);
      if (state === 'connecting') {
        setPhase('connecting');
      }
      if (state === 'ready') {
        setPhase((prev) => (prev === 'connecting' ? 'ready' : prev));
      }
      if (state === 'disconnected') {
        if (manualDisconnectRef.current) {
          manualDisconnectRef.current = false;
          liveTransportFailedRef.current = false;
          liveAudioReadyRef.current = false;
          bufferedAudioChunksRef.current = [];
          setIsListeningMic(false);
          setPhase('ready');
          pushDebug('live_disconnected_manual');
          return;
        }
        pushDebug('live_disconnected_unexpected');
        liveTransportFailedRef.current = true;
        liveAudioReadyRef.current = false;
        bufferedAudioChunksRef.current = [];
        setMode('fallback');
        setPhase('fallback');
        setIsListeningMic(false);
        setErrorMessage('Gemini live transport disconnected');
        void audioStreamRef.current?.stop().catch(() => undefined);
        audioStreamRef.current = null;
      }
      if (state === 'error') {
        liveAudioReadyRef.current = false;
        setMode('fallback');
        setPhase('fallback');
      }
    }));

    cleanups.push(client.on('transcript_delta', ({ text }) => {
      pushDebug('transcript_delta', `len=${text.length}`);
      updateLastTurnDelta('user', text);
      liveTranscriptBufferRef.current += text;
    }));

    cleanups.push(client.on('response_delta', ({ text }) => {
      pushDebug('response_delta', `len=${text.length}`);
      setErrorMessage(null);
      setPhase('model_streaming');
    }));

    cleanups.push(client.on('response_complete', ({ text }) => {
      pushDebug('response_complete', `len=${text.length}`);
      if (liveFinalizedRef.current) {
        return;
      }
      if (!text.trim()) {
        return;
      }
      liveFinalizedRef.current = true;
      const parsed = parseGuidedOutput(text, lastUserRequestRef.current, toneRef.current);
      setOutput({
        greetingDraft: parsed.greetingDraft,
        cardConcept: parsed.cardConcept,
      });

      setTranscript((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'agent') {
          next[next.length - 1] = {
            ...last,
            text: parsed.voiceSummary,
            timestamp: new Date().toISOString(),
          };
          return next;
        }

        next.push({
          id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'agent',
          text: parsed.voiceSummary,
          timestamp: new Date().toISOString(),
        });
        return next;
      });

      const prompt = parsed.cardConcept || buildFallbackCardConcept(lastUserRequestRef.current);
      setPhase('image_queued');
      void generateVisualVariant(prompt).then((ok) => {
        setPhase(ok ? 'image_ready' : 'ready');
      });

      if (micSessionActiveRef.current) {
        window.setTimeout(() => {
          if (!micSessionActiveRef.current || modeRef.current !== 'live' || liveTransportFailedRef.current) {
            return;
          }
          void startMicRef.current?.({
            resetDraft: false,
            appendUserPlaceholder: false,
          });
        }, 250);
      }
    }));

    cleanups.push(client.on('interrupted', () => {
      pushDebug('provider_interrupted');
      setPhase('interrupted');
      if (micSessionActiveRef.current) {
        window.setTimeout(() => {
          if (!micSessionActiveRef.current || modeRef.current !== 'live' || liveTransportFailedRef.current) {
            return;
          }
          void startMicRef.current?.({
            resetDraft: false,
            appendUserPlaceholder: false,
          });
        }, 200);
      }
    }));

    cleanups.push(client.on('error', ({ message }) => {
      pushDebug('live_error', message);
      setErrorMessage(message);
      setMode('fallback');
      setPhase('fallback');
    }));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [generateVisualVariant, pushDebug, updateLastTurnDelta]);

  const finalizeLiveAudioTurn = useCallback(() => {
    if (liveTurnEndedRef.current) {
      return;
    }
    pushDebug('audio_turn_finalize');
    liveTurnEndedRef.current = true;
    liveFinalizedRef.current = false;
    const capturedTranscript = liveTranscriptBufferRef.current.trim();
    if (capturedTranscript) {
      lastUserRequestRef.current = capturedTranscript;
    }
    liveTranscriptBufferRef.current = '';
    liveAudioReadyRef.current = false;
    bufferedAudioChunksRef.current = [];
    setIsListeningMic(false);
    void audioStreamRef.current?.stop().catch(() => undefined);
    audioStreamRef.current = null;
    void liveClientRef.current?.endAudioStream().catch(() => undefined);
    setPhase('model_thinking');
  }, [pushDebug]);

  const connectLiveTransport = useCallback(async () => {
    const sid = await initializeLiveSession();
    const tokenPayload = await ensureToken(sid);
    if (!tokenPayload?.supported || !tokenPayload.token) {
      pushDebug('token_unavailable', tokenPayload?.message || 'unsupported');
      setMode('fallback');
      setPhase('fallback');
      setErrorMessage(tokenPayload?.message || 'Live token unavailable, switched to fallback mode.');
      return false;
    }

    if (!liveClientRef.current) {
      liveClientRef.current = new GeminiLiveClient();
    }

    try {
      manualDisconnectRef.current = false;
      pushDebug('live_connect_attempt', tokenPayload.model);
      const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const proxyUrl = `${base.replace(/^http/, 'ws')}/v1/live/realtime`;
      await liveClientRef.current.connect({
        model: tokenPayload.model,
        token: tokenPayload.token,
        systemInstruction: LIVE_SYSTEM_PROMPT,
        proxyUrl,
      });
      await sleep(1400);
      if (liveClientRef.current.getState() !== 'ready') {
        throw new Error('Live transport became unstable right after connect.');
      }
      setMode('live');
      setErrorMessage(null);
      pushDebug('live_connect_ready');
      return true;
    } catch {
      pushDebug('live_connect_failed');
      setMode('fallback');
      setPhase('fallback');
      setErrorMessage('Live WebSocket connection failed. Switched to fallback mode.');
      return false;
    }
  }, [ensureToken, initializeLiveSession, pushDebug]);

  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    const sid = await initializeLiveSession();
    const audioBase64 = await blobToBase64(audioBlob);

    const response = await fetch('/api/live/transcribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-live-session-id': sid,
      },
      body: JSON.stringify({
        audioBase64,
        mimeType: audioBlob.type || 'audio/webm',
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      setErrorMessage('Voice transcription unavailable. Please type your request.');
      return;
    }

    const payload = (await response.json()) as LiveTranscribeResponse;
    if (!payload.text?.trim()) {
      setErrorMessage('Could not recognize speech. Try again or type your request.');
      return;
    }

    setErrorMessage(null);
    setLiveInput(payload.text.trim());
  }, [initializeLiveSession]);

  const runFallbackTurn = useCallback(async (forcedInput?: string) => {
    const cleaned = (forcedInput ?? liveInput).trim();
    if (cleaned.length < 3) {
      setErrorMessage('Voice input text is too short.');
      return;
    }

    activeTurnAbortRef.current?.abort();
    const abortController = new AbortController();
    activeTurnAbortRef.current = abortController;

    lastUserRequestRef.current = cleaned;
    setErrorMessage(null);
    setPhase('model_thinking');
    appendTurn('user', cleaned);

    const sid = await initializeLiveSession();
    await ensureToken(sid);

    const response = await fetch('/api/live/turn', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-live-session-id': sid,
      },
      body: JSON.stringify({
        text: cleaned,
        tone,
        channel: 'voice',
      }),
      cache: 'no-store',
      signal: abortController.signal,
    }).catch((error) => {
      if ((error as Error).name === 'AbortError') {
        return null;
      }
      throw error;
    });

    if (response === null) {
      setPhase('interrupted');
      setErrorMessage('Turn interrupted.');
      return;
    }

    let turn: LiveTurnResponse;

    if (!response.ok) {
      turn = buildFallbackTurn(cleaned, tone);
      setPhase('fallback');
      setErrorMessage('Live API not available. Using fallback orchestration.');
    } else {
      turn = (await response.json()) as LiveTurnResponse;
    }

    setOutput({
      greetingDraft: turn.greetingDraft,
      cardConcept: turn.cardConcept,
    });
    appendTurn('agent', turn.voiceSummary);

    setPhase('image_queued');
    const ok = await generateVisualVariant(turn.cardConcept);
    setPhase(ok ? 'image_ready' : 'ready');
  }, [appendTurn, ensureToken, generateVisualVariant, initializeLiveSession, liveInput, tone]);

  const stopFallbackRecorder = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    audioChunksRef.current = [];
    activeTurnAbortRef.current?.abort();
    setIsListeningMic(false);
  }, []);

  const startFallbackRecorder = useCallback(() => {
    if (!micSupported || typeof window === 'undefined' || !window.MediaRecorder || !navigator.mediaDevices) {
      setErrorMessage('Microphone recording is not supported in this browser.');
      return;
    }

    setErrorMessage(null);
    setIsListeningMic(true);
    setPhase('listening');
    audioChunksRef.current = [];

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setErrorMessage('Mic recording failed. Type request and press Send Turn.');
      };

      recorder.onstop = () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsListeningMic(false);
        setPhase('ready');

        if (chunks.length === 0) {
          setErrorMessage('No audio captured. Try again.');
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        void transcribeAudio(blob);
      };

      recorder.start();
    }).catch(() => {
      setIsListeningMic(false);
      setPhase('ready');
      setErrorMessage('Microphone permission denied or unavailable.');
    });
  }, [micSupported, transcribeAudio]);

  const startMic = useCallback(async (options?: { resetDraft?: boolean; appendUserPlaceholder?: boolean }) => {
    const resetDraft = options?.resetDraft ?? true;
    const appendUserPlaceholder = options?.appendUserPlaceholder ?? true;
    setErrorMessage(null);
    pushDebug('start_mic');
    liveTransportFailedRef.current = false;
    liveAudioReadyRef.current = false;
    liveUserHasSpokenRef.current = false;
    liveTurnEndedRef.current = false;
    liveFinalizedRef.current = false;
    liveTranscriptBufferRef.current = '';
    bufferedAudioChunksRef.current = [];
    if (resetDraft) {
      setOutput((prev) => ({
        ...prev,
        greetingDraft: '',
        cardConcept: '',
      }));
    }

    if (audioStreamRef.current) {
      await audioStreamRef.current.stop().catch(() => undefined);
    }

    const stream = new PcmAudioStream();
    stream.onDebug((message) => {
      pushDebug('audio_debug', message);
    });
    stream.onChunk(({ audio, level }) => {
      if (liveTransportFailedRef.current) {
        return;
      }

      if (!liveAudioReadyRef.current) {
        const queue = bufferedAudioChunksRef.current;
        queue.push({ audio, level });
        if (queue.length > 20) {
          queue.shift();
        }
        return;
      }

      if (liveClientRef.current?.getState() !== 'ready') {
        return;
      }

      if (audio?.data) {
        pushDebug('audio_chunk', `${audio.mimeType} bytes=${audio.data.length} level=${level.toFixed(4)}`);
      } else {
        pushDebug('audio_chunk_empty', `level=${level.toFixed(4)}`);
      }

      void liveClientRef.current?.sendAudioChunk(audio).catch(() => {
        pushDebug('audio_chunk_send_failed');
        liveTransportFailedRef.current = true;
        setMode('fallback');
        setPhase('fallback');
        setIsListeningMic(false);
        setErrorMessage('Gemini live transport error');
        void audioStreamRef.current?.stop().catch(() => undefined);
      });

      if (level > 0.01) {
        liveUserHasSpokenRef.current = true;
        if (noSpeechTimerRef.current) {
          window.clearTimeout(noSpeechTimerRef.current);
          noSpeechTimerRef.current = null;
        }
        if (speechHardStopTimerRef.current) {
          window.clearTimeout(speechHardStopTimerRef.current);
        }
        speechHardStopTimerRef.current = window.setTimeout(() => {
          pushDebug('speech_hard_timeout');
          finalizeLiveAudioTurn();
          speechHardStopTimerRef.current = null;
        }, 20000);
        setPhase('user_speaking');
        if (silenceTimerRef.current) {
          window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else {
        if (silenceTimerRef.current) {
          window.clearTimeout(silenceTimerRef.current);
        }
        silenceTimerRef.current = window.setTimeout(() => {
          setPhase((prev) => (prev === 'user_speaking' ? 'listening' : prev));
          if (!liveUserHasSpokenRef.current || liveTurnEndedRef.current) {
            silenceTimerRef.current = null;
            return;
          }
          finalizeLiveAudioTurn();
          pushDebug('silence_boundary_commit');
          silenceTimerRef.current = null;
        }, 1200);
      }
    });

    try {
      audioStreamRef.current = stream;
      setIsListeningMic(true);
      setPhase('listening');
      if (appendUserPlaceholder) {
        appendTurn('user', '');
      }
      noSpeechTimerRef.current = window.setTimeout(() => {
        if (!liveUserHasSpokenRef.current && !liveTurnEndedRef.current) {
          pushDebug('no_speech_timeout');
          setErrorMessage('No speech detected. Try again.');
          finalizeLiveAudioTurn();
        }
        noSpeechTimerRef.current = null;
      }, 10000);
      await stream.start();
      pushDebug('audio_stream_started');

      const connected = await connectLiveTransport();
      if (!connected || !liveClientRef.current) {
        pushDebug('live_connect_not_ready_switch_fallback');
        liveTransportFailedRef.current = true;
        setMode('fallback');
        setPhase('fallback');
        setIsListeningMic(false);
        await stream.stop().catch(() => undefined);
        audioStreamRef.current = null;
        startFallbackRecorder();
        return;
      }

      liveAudioReadyRef.current = true;
      const queued = bufferedAudioChunksRef.current;
      bufferedAudioChunksRef.current = [];
      queued.forEach(({ audio }) => {
        void liveClientRef.current?.sendAudioChunk(audio).catch(() => {
          pushDebug('buffered_audio_send_failed');
          liveTransportFailedRef.current = true;
          setMode('fallback');
          setPhase('fallback');
          setIsListeningMic(false);
          setErrorMessage('Gemini live transport error');
          void audioStreamRef.current?.stop().catch(() => undefined);
          audioStreamRef.current = null;
        });
      });
    } catch {
      pushDebug('mic_stream_failed_switch_fallback');
      setMode('fallback');
      setPhase('fallback');
      setIsListeningMic(false);
      setErrorMessage('Microphone stream failed. Switched to fallback mode.');
      await stream.stop().catch(() => undefined);
      audioStreamRef.current = null;
      startFallbackRecorder();
    }
  }, [appendTurn, connectLiveTransport, finalizeLiveAudioTurn, pushDebug, startFallbackRecorder]);

  const stopMicSession = useCallback(async () => {
    pushDebug('stop_mic_session');
    setMicSessionActive(false);
    micSessionActiveRef.current = false;
    liveAudioReadyRef.current = false;
    activeTurnAbortRef.current?.abort();
    activeTurnAbortRef.current = null;
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (speechHardStopTimerRef.current) {
      window.clearTimeout(speechHardStopTimerRef.current);
      speechHardStopTimerRef.current = null;
    }
    if (noSpeechTimerRef.current) {
      window.clearTimeout(noSpeechTimerRef.current);
      noSpeechTimerRef.current = null;
    }

    if (mode === 'live') {
      await audioStreamRef.current?.stop().catch(() => undefined);
      audioStreamRef.current = null;
      setIsListeningMic(false);

      if (liveUserHasSpokenRef.current && !liveTurnEndedRef.current && liveClientRef.current?.getState() === 'ready') {
        finalizeLiveAudioTurn();
        return;
      }

      manualDisconnectRef.current = true;
      liveTurnEndedRef.current = true;
      bufferedAudioChunksRef.current = [];
      await liveClientRef.current?.disconnect().catch(() => undefined);
      setPhase('ready');
      return;
    }

    stopFallbackRecorder();
    setPhase('ready');
  }, [mode, pushDebug, stopFallbackRecorder]);

  const interruptCurrentTurn = useCallback(async () => {
    if (mode !== 'live') {
      return;
    }
    pushDebug('interrupt_current_turn');
    await audioStreamRef.current?.stop().catch(() => undefined);
    audioStreamRef.current = null;
    setIsListeningMic(false);
    setPhase('interrupted');
    manualDisconnectRef.current = true;
    await liveClientRef.current?.interrupt().catch(() => undefined);
  }, [mode, pushDebug]);

  const runLiveTextTurn = useCallback(async (forcedInput?: string) => {
    const cleaned = (forcedInput ?? liveInput).trim();
    if (cleaned.length < 3) {
      setErrorMessage('Prompt is too short.');
      return;
    }

    lastUserRequestRef.current = cleaned;
    setErrorMessage(null);

    const sid = await initializeLiveSession();
    await ensureToken(sid).catch(() => null);

    activeTurnAbortRef.current?.abort();
    const abortController = new AbortController();
    activeTurnAbortRef.current = abortController;

    appendTurn('user', cleaned);
    setOutput({ greetingDraft: '', cardConcept: '' });
    setPhase('model_thinking');
    setMode('live');

    const response = await fetch('/api/live/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-live-session-id': sid,
      },
      body: JSON.stringify({
        text: cleaned,
        tone,
        channel: 'text',
      }),
      cache: 'no-store',
      signal: abortController.signal,
    }).catch((error) => {
      if ((error as Error).name === 'AbortError') {
        return null;
      }
      throw error;
    });

    if (response === null) {
      setPhase('interrupted');
      setErrorMessage('Turn interrupted.');
      return;
    }

    if (!response.ok || !response.body) {
      setMode('fallback');
      setPhase('fallback');
      await runFallbackTurn(cleaned);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let draft = '';
    let finalCardConcept = '';
    let finalVoiceSummary = '';

    const emitAgentSummary = (summary: string) => {
      setTranscript((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'agent') {
          next[next.length - 1] = {
            ...last,
            text: summary,
            timestamp: new Date().toISOString(),
          };
          return next;
        }

        next.push({
          id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'agent',
          text: summary,
          timestamp: new Date().toISOString(),
        });
        return next;
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        frames.forEach((frame) => {
          const lines = frame.split('\n');
          const eventLine = lines.find((line) => line.startsWith('event:'));
          const dataLine = lines.find((line) => line.startsWith('data:'));
          if (!eventLine || !dataLine) {
            return;
          }

          const event = eventLine.slice(6).trim();
          const json = dataLine.slice(5).trim();
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(json) as Record<string, unknown>;
          } catch {
            return;
          }

          if (event === 'thinking') {
            setPhase('model_thinking');
            return;
          }

          if (event === 'draft_delta') {
            const text = typeof payload.text === 'string' ? payload.text : '';
            if (!text) {
              return;
            }
            draft += text;
            setPhase('model_streaming');
            setOutput((prev) => ({ ...prev, greetingDraft: draft }));
            updateLastTurnDelta('agent', text);
            return;
          }

          if (event === 'card_concept') {
            finalCardConcept = typeof payload.text === 'string' ? payload.text : finalCardConcept;
            setOutput((prev) => ({ ...prev, cardConcept: finalCardConcept }));
            return;
          }

          if (event === 'voice_summary') {
            finalVoiceSummary = typeof payload.text === 'string' ? payload.text : finalVoiceSummary;
            if (finalVoiceSummary) {
              emitAgentSummary(finalVoiceSummary);
            }
            return;
          }

          if (event === 'turn_completed') {
            const greetingDraft = typeof payload.greetingDraft === 'string' ? payload.greetingDraft : draft;
            const cardConcept = typeof payload.cardConcept === 'string' ? payload.cardConcept : finalCardConcept;
            const voiceSummary = typeof payload.voiceSummary === 'string' ? payload.voiceSummary : finalVoiceSummary;

            setOutput({
              greetingDraft,
              cardConcept,
            });

            if (voiceSummary) {
              emitAgentSummary(voiceSummary);
            }

            const prompt = cardConcept || buildFallbackCardConcept(cleaned);
            setPhase('image_queued');
            void generateVisualVariant(prompt).then((ok) => {
              setPhase(ok ? 'image_ready' : 'ready');
            });
          }
        });
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setPhase('interrupted');
        setErrorMessage('Turn interrupted.');
        return;
      }
      setMode('fallback');
      setPhase('fallback');
      await runFallbackTurn(cleaned);
    } finally {
      activeTurnAbortRef.current = null;
    }
  }, [
    appendTurn,
    ensureToken,
    generateVisualVariant,
    initializeLiveSession,
    liveInput,
    runFallbackTurn,
    tone,
    updateLastTurnDelta,
  ]);

  const applyIntent = useCallback(async (intent: { label: string; tone?: Tone; instruction: string }) => {
    if (intent.tone) {
      setTone(intent.tone);
    }

    const merged = `${liveInput.trim()} ${intent.instruction}`.trim();
    setLiveInput(merged);
    await runLiveTextTurn(merged);
  }, [liveInput, runLiveTextTurn]);

  useEffect(() => {
    toneRef.current = tone;
  }, [tone]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    micSessionActiveRef.current = micSessionActive;
  }, [micSessionActive]);

  useEffect(() => {
    startMicRef.current = startMic;
  }, [startMic]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const supported = typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices;
    setMicSupported(supported);

    if (!liveClientRef.current) {
      liveClientRef.current = new GeminiLiveClient();
    }

    const cleanupEvents = setupLiveClient(liveClientRef.current);

    return () => {
      cleanupEvents();
      void audioStreamRef.current?.stop().catch(() => undefined);
      audioStreamRef.current = null;
      setMicSessionActive(false);
      stopFallbackRecorder();
      void liveClientRef.current?.disconnect().catch(() => undefined);
      liveClientRef.current = null;
      liveAudioReadyRef.current = false;
      bufferedAudioChunksRef.current = [];
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (speechHardStopTimerRef.current) {
        window.clearTimeout(speechHardStopTimerRef.current);
        speechHardStopTimerRef.current = null;
      }
      if (noSpeechTimerRef.current) {
        window.clearTimeout(noSpeechTimerRef.current);
        noSpeechTimerRef.current = null;
      }
    };
  }, [setupLiveClient, stopFallbackRecorder]);

  const visualBadge = lastVariant ? (lastVariant.status === 'completed' ? 'ready' : lastVariant.status) : 'idle';
  const turnBadge = phase === 'model_streaming'
    ? 'streaming'
    : phase === 'interrupted'
      ? 'interrupted'
      : phase;

  return (
    <main className="live-root">
      <header className="live-header">
        <div>
          <p className="live-kicker">Gemini Live Agent Candidate</p>
          <h1 className="live-title">Live + Guided Canvas</h1>
        </div>
        <div className="live-header-actions">
          <span className={`live-phase live-phase-${phase}`}>{PHASE_LABEL[phase]}</span>
          <span className="live-chip">Mode: {mode}</span>
          <span className="live-chip">Transport: {mode === 'live' ? 'ws' : 'http'}</span>
          <span className="live-chip">Mic: {micSupported ? (isListeningMic ? 'listening' : 'ready') : 'unsupported'}</span>
          <span className="live-chip">Token: {tokenState}</span>
          <span className="live-chip">Turn: {turnBadge}</span>
          <span className="live-chip">Visual: {visualBadge}</span>
          <Link href="/studio" className="live-link">Switch to Studio Mode</Link>
        </div>
      </header>

      <section className="live-grid">
        <article className="live-card live-card-left">
          <div className="live-card-head">
            <h2>Live Agent</h2>
            <span className="live-chip">Tone: {tone}</span>
          </div>

          <div className="live-controls">
            <button
              type="button"
              className={`live-btn ${micSessionActive ? 'live-btn-danger' : 'live-btn-primary'}`}
              onClick={() => {
                if (!micSessionActive) {
                  setMicSessionActive(true);
                  micSessionActiveRef.current = true;
                  void startMic({
                    resetDraft: true,
                    appendUserPlaceholder: true,
                  });
                  return;
                }
                if (phase === 'model_streaming' || phase === 'model_thinking') {
                  void interruptCurrentTurn();
                } else {
                  void stopMicSession();
                }
              }}
            >
              {!micSessionActive
                ? 'Start Mic'
                : phase === 'model_streaming' || phase === 'model_thinking'
                  ? 'Interrupt'
                  : 'Stop Mic'}
            </button>
          </div>

          <textarea
            className="live-input"
            value={liveInput}
            onChange={(event) => setLiveInput(event.target.value)}
            placeholder="Speak request (or type): birthday context, tone, sender, constraints"
            maxLength={420}
            spellCheck={false}
          />

          <button type="button" className="live-btn live-btn-primary" onClick={() => void runLiveTextTurn()}>
            Send Turn
          </button>

          <div className="live-intents">
            {INTENTS.map((intent) => (
              <button key={intent.label} type="button" className="live-pill" onClick={() => void applyIntent(intent)}>
                {intent.label}
              </button>
            ))}
          </div>

          {errorMessage ? <p className="live-error">{errorMessage}</p> : null}

          <details className="live-debug">
            <summary>Runtime Debug Trace</summary>
            <pre className="live-debug-log">{debugTrace.join('\n') || 'No events yet'}</pre>
          </details>

          <div className="live-transcript">
            {transcript.length === 0 ? <p className="live-empty">No turns yet</p> : null}
            {transcript.map((turn) => (
              <div key={turn.id} className={`live-turn live-turn-${turn.role === 'system' ? 'agent' : turn.role}`}>
                <p className="live-turn-role">
                  {turn.role === 'user' ? 'You' : turn.role === 'system' ? 'System' : 'Agent'}
                </p>
                <p className="live-turn-text">{turn.text || '...'}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="live-card">
          <div className="live-card-head">
            <h2>Guided Output</h2>
            <span className="live-chip">Interleaved</span>
          </div>

          <section className="live-panel">
            <h3>Greeting Draft</h3>
            <textarea
              className="live-output-input"
              value={output.greetingDraft}
              onChange={(event) => setOutput((prev) => ({ ...prev, greetingDraft: event.target.value }))}
              placeholder="Live draft will appear here"
              spellCheck={false}
            />
          </section>

          <section className="live-panel">
            <h3>Card Concept</h3>
            <textarea
              className="live-output-input"
              value={output.cardConcept}
              onChange={(event) => setOutput((prev) => ({ ...prev, cardConcept: event.target.value }))}
              placeholder="Visual concept and art direction"
              spellCheck={false}
            />
          </section>
        </article>

        <article className="live-card live-card-right">
          <div className="live-card-head">
            <h2>Visual Canvas</h2>
            <button
              type="button"
              className="live-btn"
              onClick={() => void generateVisualVariant(output.cardConcept || buildFallbackCardConcept(liveInput))}
            >
              Regenerate
            </button>
          </div>

          <div className="live-image-frame">
            {lastVariant?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lastVariant.imageUrl} alt="Generated greeting card" className="live-image" />
            ) : (
              <p className="live-empty">Latest generated card will appear here.</p>
            )}
          </div>

          <div className="live-variants">
            {variants.length === 0 ? <p className="live-empty">No variants yet</p> : null}
            {variants.map((variant) => (
              <div className="live-variant" key={variant.id}>
                <p className="live-variant-title">{variant.id.slice(0, 16)}</p>
                <p className="live-variant-meta">{variant.status}</p>
                <p className="live-variant-prompt" title={variant.prompt}>{variant.prompt}</p>
                {variant.imageUrl ? (
                  <a className="live-link" href={variant.imageUrl} target="_blank" rel="noreferrer">
                    Open image
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function parseGuidedOutput(raw: string, input: string, tone: Tone): LiveTurnResponse {
  const candidate = safeParseJson(raw);
  if (candidate) {
    const greetingDraft = asString(candidate.greetingDraft);
    const cardConcept = asString(candidate.cardConcept);
    const voiceSummary = asString(candidate.voiceSummary);

    if (greetingDraft && cardConcept) {
      return {
        greetingDraft,
        cardConcept,
        voiceSummary: voiceSummary || greetingDraft,
      };
    }
  }

  return buildFallbackTurn(input, tone);
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  const direct = raw.trim();
  if (!direct) {
    return null;
  }

  try {
    return JSON.parse(direct) as Record<string, unknown>;
  } catch {
    // ignore
  }

  const start = direct.indexOf('{');
  const end = direct.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  const sliced = direct.slice(start, end + 1);
  try {
    return JSON.parse(sliced) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildFallbackCardConcept(input: string): string {
  const recipient = extractRecipient(input) || 'your teammate';
  return `Premium minimal greeting card, warm palette, clean editorial typography, subtle festive accents, recipient: ${recipient}.`;
}

function buildFallbackTurn(input: string, tone: Tone): LiveTurnResponse {
  const recipient = extractRecipient(input) || 'your teammate';
  const toneLine = tone === 'formal'
    ? 'Wishing you continued success, health, and meaningful achievements this year.'
    : tone === 'playful'
      ? 'Hope your cake is huge, your inbox is quiet, and your day is full of wins.'
      : tone === 'warm'
        ? 'Wishing you a day filled with gratitude, joy, and people who truly appreciate you.'
        : 'Wishing you an amazing day and a strong year ahead.';

  return {
    greetingDraft: `Happy Birthday, ${recipient}! ${toneLine}`,
    cardConcept: buildFallbackCardConcept(input),
    voiceSummary: `Draft ready for ${recipient}. I prepared a ${tone} version and generated a matching visual concept.`,
  };
}

function extractRecipient(input: string): string | null {
  const nameMatch = input.match(/for\s+([A-Za-z][A-Za-z\-']{1,30})/i);
  if (nameMatch?.[1]) {
    return nameMatch[1];
  }

  return null;
}

async function readApiMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message || fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
