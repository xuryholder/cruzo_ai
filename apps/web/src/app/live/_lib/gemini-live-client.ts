import { GoogleGenAI } from '@google/genai';

type LiveClientState = 'idle' | 'connecting' | 'ready' | 'disconnected' | 'error';

type LiveConnectInput = {
  model: string;
  token: string;
  systemInstruction: string;
  proxyUrl?: string;
};

type LiveClientEvents = {
  state: { state: LiveClientState };
  transcript_delta: { text: string };
  response_delta: { text: string };
  response_complete: { text: string };
  interrupted: { reason: string };
  error: { message: string; cause?: unknown };
};

type EventName = keyof LiveClientEvents;
type Handler<T extends EventName> = (payload: LiveClientEvents[T]) => void;

type LiveSessionLike = {
  close?: () => void | Promise<void>;
  sendClientContent?: (payload: unknown) => void | Promise<void>;
  sendRealtimeInput?: (payload: unknown) => void | Promise<void>;
};

type RealtimeAudioChunk = {
  mimeType: string;
  data: string;
};

export class GeminiLiveClient {
  private listeners: { [K in EventName]: Set<Handler<K>> } = {
    state: new Set(),
    transcript_delta: new Set(),
    response_delta: new Set(),
    response_complete: new Set(),
    interrupted: new Set(),
    error: new Set(),
  };

  private session: LiveSessionLike | null = null;
  private state: LiveClientState = 'idle';
  private responseBuffer = '';
  private lastConfig: LiveConnectInput | null = null;
  private ignoreServerEvents = false;
  private audioSent = false;
  private activityStarted = false;
  private proxySocket: WebSocket | null = null;

  on<T extends EventName>(event: T, handler: Handler<T>): () => void {
    const handlers = this.listeners[event] as Set<Handler<T>>;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  async connect(input: LiveConnectInput): Promise<void> {
    if (this.state === 'ready') {
      return;
    }

    this.lastConfig = input;
    this.ignoreServerEvents = false;
    this.responseBuffer = '';
    this.audioSent = false;
    this.activityStarted = false;
    this.proxySocket = null;
    this.updateState('connecting');

    try {
      if (input.proxyUrl) {
        await this.connectViaProxy(input);
        this.updateState('ready');
        return;
      }
      const ai = new GoogleGenAI({
        apiKey: input.token,
        httpOptions: {
          apiVersion: 'v1alpha',
        },
      });
      const live = (ai as unknown as { live?: { connect?: (payload: unknown) => Promise<LiveSessionLike> } }).live;
      if (!live?.connect) {
        throw new Error('Live connect is unavailable in @google/genai build.');
      }

      this.session = await live.connect({
        model: input.model,
        config: {
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: input.systemInstruction,
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: true,
            },
          },
        },
        callbacks: {
          onmessage: (message: unknown) => {
            this.handleServerMessage(message);
          },
          onerror: (error: unknown) => {
            this.emit('error', { message: 'Gemini live transport error', cause: error });
            this.updateState('error');
          },
          onclose: (event: unknown) => {
            this.session = null;
            if (event && typeof event === 'object') {
              const code = (event as { code?: unknown }).code;
              const reason = (event as { reason?: unknown }).reason;
              const codeText = typeof code === 'number' ? ` code=${code}` : '';
              const reasonText = typeof reason === 'string' && reason.length > 0 ? ` reason=${reason}` : '';
              if (codeText || reasonText) {
                this.emit('error', {
                  message: `Gemini live transport closed.${codeText}${reasonText}`,
                  cause: event,
                });
              }
            }
            if (this.state !== 'disconnected') {
              this.updateState('disconnected');
            }
          },
        },
      });

      this.updateState('ready');
    } catch (error) {
      this.emit('error', { message: 'Failed to open Gemini live session.', cause: error });
      this.updateState('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.ignoreServerEvents = false;
    this.responseBuffer = '';
    this.audioSent = false;
    this.activityStarted = false;
    if (this.proxySocket) {
      this.proxySocket.close();
      this.proxySocket = null;
    }
    if (this.session?.close) {
      await Promise.resolve(this.session.close());
    }
    this.session = null;
    this.updateState('disconnected');
  }

  async sendTextTurn(text: string): Promise<void> {
    if (this.proxySocket) {
      this.proxySocket.send(JSON.stringify({ type: 'text', text }));
      return;
    }
    const session = this.requireSession();
    this.responseBuffer = '';
    this.ignoreServerEvents = false;

    await Promise.resolve(
      session.sendClientContent?.({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      }),
    );
  }

  async sendAudioChunk(audioChunk: RealtimeAudioChunk): Promise<void> {
    if (this.proxySocket) {
      if (this.state === 'ready') {
        this.proxySocket.send(JSON.stringify({ type: 'audio', audio: audioChunk }));
        this.audioSent = true;
      }
      return;
    }
    if (this.state !== 'ready' || !this.session) {
      return;
    }
    const session = this.session;
    if (!session.sendRealtimeInput) {
      return;
    }

    await Promise.resolve(
      (async () => {
        if (!this.activityStarted) {
          await session.sendRealtimeInput?.({ activityStart: {} });
          this.activityStarted = true;
        }
        await session.sendRealtimeInput?.({ audio: audioChunk });
      })(),
    );
    this.audioSent = true;
  }

  async endAudioStream(): Promise<void> {
    if (this.proxySocket) {
      if (this.state === 'ready' && this.audioSent) {
        this.proxySocket.send(JSON.stringify({ type: 'end' }));
      }
      return;
    }
    if (this.state !== 'ready' || !this.session) {
      return;
    }
    const session = this.session;
    if (!session.sendRealtimeInput) {
      return;
    }

    if (!this.audioSent) {
      return;
    }
    if (!this.activityStarted) {
      return;
    }
    await Promise.resolve(session.sendRealtimeInput?.({ activityEnd: {} }));
    this.activityStarted = false;
  }

  async interrupt(): Promise<void> {
    if (!this.session) {
      return;
    }

    this.ignoreServerEvents = true;
    this.emit('interrupted', { reason: 'user_interrupt' });
    await this.disconnect();
  }

  async reconnect(): Promise<void> {
    if (!this.lastConfig) {
      throw new Error('Cannot reconnect before initial connect.');
    }
    await this.disconnect();
    await this.connect(this.lastConfig);
  }

  getState(): LiveClientState {
    return this.state;
  }

  private handleServerMessage(message: unknown): void {
    if (this.ignoreServerEvents) {
      return;
    }

    const transcriptDelta = readInputTranscriptDelta(message);
    if (transcriptDelta) {
      this.emit('transcript_delta', { text: transcriptDelta });
    }

    const responseDelta = readModelTextDelta(message);
    if (responseDelta) {
      this.responseBuffer += responseDelta;
      this.emit('response_delta', { text: responseDelta });
    }

    if (readInterrupted(message)) {
      this.emit('interrupted', { reason: 'provider_interrupt' });
      this.ignoreServerEvents = true;
      return;
    }

    if (readTurnComplete(message)) {
      this.emit('response_complete', { text: this.responseBuffer.trim() });
      this.responseBuffer = '';
      this.ignoreServerEvents = false;
    }
  }

  private requireSession(): LiveSessionLike {
    if (!this.session) {
      throw new Error('Live session is not connected.');
    }

    return this.session;
  }

  private emit<T extends EventName>(event: T, payload: LiveClientEvents[T]): void {
    const handlers = this.listeners[event] as Set<Handler<T>>;
    handlers.forEach((handler) => handler(payload));
  }

  private updateState(next: LiveClientState): void {
    this.state = next;
    this.emit('state', { state: next });
  }

  private async connectViaProxy(input: LiveConnectInput): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(input.proxyUrl!);
      this.proxySocket = socket;

      const onError = (error: Event) => {
        this.emit('error', { message: 'Live proxy connection error', cause: error });
        this.updateState('error');
        reject(error);
      };

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: 'init',
            model: input.model,
            systemInstruction: input.systemInstruction,
          }),
        );
      };

      socket.onmessage = (event) => {
        let payload: Record<string, unknown> | null = null;
        try {
          payload = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (payload.type === 'ready') {
          resolve();
          return;
        }

        if (payload.type === 'server' && payload.message) {
          this.handleServerMessage(payload.message);
          return;
        }

        if (payload.type === 'error') {
          this.emit('error', { message: String(payload.message || 'Live proxy error') });
          return;
        }

        if (payload.type === 'close') {
          const code = payload.code;
          const reason = payload.reason;
          const codeText = typeof code === 'number' ? ` code=${code}` : '';
          const reasonText = typeof reason === 'string' && reason.length > 0 ? ` reason=${reason}` : '';
          if (codeText || reasonText) {
            this.emit('error', { message: `Gemini live transport closed.${codeText}${reasonText}` });
          }
          this.updateState('disconnected');
        }
      };

      socket.onerror = onError;
      socket.onclose = (event) => {
        this.proxySocket = null;
        const code = (event as CloseEvent).code;
        const reason = (event as CloseEvent).reason;
        this.emit('error', {
          message: `Live proxy disconnected.${code ? ` code=${code}` : ''}${reason ? ` reason=${reason}` : ''}`,
        });
        if (this.state !== 'disconnected') {
          this.updateState('disconnected');
        }
      };
    });
  }
}

function readInputTranscriptDelta(message: unknown): string {
  const serverContent = getObject(getObject(message).serverContent);
  const inputTranscription = getObject(serverContent.inputTranscription);
  const text = inputTranscription.text;
  return typeof text === 'string' ? text : '';
}

function readModelTextDelta(message: unknown): string {
  const serverContent = getObject(getObject(message).serverContent);
  const outputTranscription = getObject(serverContent.outputTranscription);
  const transcriptionText = outputTranscription.text;
  if (typeof transcriptionText === 'string' && transcriptionText.length > 0) {
    return transcriptionText;
  }

  const modelTurn = getObject(serverContent.modelTurn);
  const parts = modelTurn.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  let delta = '';
  parts.forEach((part) => {
    const text = getObject(part).text;
    if (typeof text === 'string') {
      delta += text;
    }
  });
  return delta;
}

function readTurnComplete(message: unknown): boolean {
  const serverContent = getObject(getObject(message).serverContent);
  const turnComplete = serverContent.turnComplete;
  const generationComplete = serverContent.generationComplete;
  return turnComplete === true || generationComplete === true;
}

function readInterrupted(message: unknown): boolean {
  const serverContent = getObject(getObject(message).serverContent);
  return serverContent.interrupted === true;
}

function getObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }

  return {};
}
