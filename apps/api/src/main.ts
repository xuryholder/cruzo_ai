import 'reflect-metadata';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { GoogleGenAI } from '@google/genai';
import { loadEnv } from './config/env.js';
import { AppModule } from './app.module.js';
import { ZodExceptionFilter } from './modules/common/zod-exception.filter.js';

type LiveSessionLike = {
  close?: () => void | Promise<void>;
  sendClientContent?: (payload: unknown) => void | Promise<void>;
  sendRealtimeInput?: (payload: unknown) => void | Promise<void>;
};

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    }),
  );

  // Fastify cookie typings may drift across minor versions; runtime plugin contract is stable.
  await app.register(cookie as unknown as Parameters<typeof app.register>[0]);
  await app.register(websocket as unknown as Parameters<typeof app.register>[0]);
  app.useGlobalFilters(new ZodExceptionFilter());

  const fastify = app.getHttpAdapter().getInstance();
  const ai = env.GOOGLE_API_KEY
    ? new GoogleGenAI({
        apiKey: env.GOOGLE_API_KEY,
        httpOptions: { apiVersion: 'v1alpha' },
      })
    : null;

  (fastify.get as unknown as (url: string, opts: unknown, handler: unknown) => void)(
    '/v1/live/realtime',
    { websocket: true },
    (connection: unknown) => {
      Logger.log('Live WS client connected', 'LiveProxy');
      const socket = (connection as { socket?: { send: (data: string) => void; on: (event: string, cb: (data?: unknown) => void) => void; close: () => void } })
        ?.socket ?? (connection as { send?: (data: string) => void; on?: (event: string, cb: (data?: unknown) => void) => void; close?: () => void });
      let session: LiveSessionLike | null = null;
      let activityStarted = false;

      const send = (payload: Record<string, unknown>) => {
        try {
          socket?.send?.(JSON.stringify(payload));
        } catch {
          // noop
        }
      };

      const closeSession = async () => {
        if (session?.close) {
          await Promise.resolve(session.close()).catch(() => undefined);
        }
        session = null;
        activityStarted = false;
      };

      const openSession = async (init: { model?: string; systemInstruction?: string }) => {
        if (!ai) {
          send({ type: 'error', message: 'Missing GOOGLE_API_KEY on backend.' });
          socket?.close?.();
          return;
        }
        const live = (ai as unknown as { live?: { connect?: (payload: unknown) => Promise<LiveSessionLike> } }).live;
        if (!live?.connect) {
          send({ type: 'error', message: 'Live connect is unavailable in server SDK.' });
          socket?.close?.();
          return;
        }

        try {
          session = await live.connect({
            model: init.model || env.GEMINI_LIVE_MODEL,
            config: {
              responseModalities: ['AUDIO'],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction: init.systemInstruction ?? '',
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: true,
                },
              },
            },
            callbacks: {
              onmessage: (message: unknown) => {
                send({ type: 'server', message });
              },
              onerror: (error: unknown) => {
                send({
                  type: 'error',
                  message: 'Gemini live transport error',
                  detail: (error as Error)?.message ?? String(error),
                });
              },
              onclose: (event: unknown) => {
                const code = (event as { code?: unknown })?.code;
                const reason = (event as { reason?: unknown })?.reason;
                send({
                  type: 'close',
                  code: typeof code === 'number' ? code : null,
                  reason: typeof reason === 'string' ? reason : null,
                });
              },
            },
          });
        } catch (error) {
          Logger.warn(`Live connect failed: ${(error as Error).message}`, 'LiveProxy');
          send({ type: 'error', message: 'Live connect failed', detail: (error as Error).message });
          socket?.close?.();
          return;
        }

        send({ type: 'ready' });
      };

      socket?.on?.('message', async (raw) => {
        let payload: Record<string, unknown> | null = null;
        try {
          payload = JSON.parse(String(raw)) as Record<string, unknown>;
        } catch {
          send({ type: 'error', message: 'Invalid JSON payload.' });
          return;
        }

        const type = payload?.type;
        if (type === 'init') {
          await openSession({
            model: typeof payload.model === 'string' ? payload.model : undefined,
            systemInstruction: typeof payload.systemInstruction === 'string' ? payload.systemInstruction : undefined,
          });
          return;
        }

        if (!session) {
          send({ type: 'error', message: 'Session not initialized.' });
          return;
        }

        if (type === 'audio') {
          if (!activityStarted) {
            await Promise.resolve(session.sendRealtimeInput?.({ activityStart: {} }));
            activityStarted = true;
          }
          await Promise.resolve(session.sendRealtimeInput?.({ audio: payload.audio }));
          return;
        }

        if (type === 'end') {
          if (activityStarted) {
            await Promise.resolve(session.sendRealtimeInput?.({ activityEnd: {} }));
            activityStarted = false;
          }
          return;
        }

        if (type === 'text' && typeof payload.text === 'string') {
          await Promise.resolve(
            session.sendClientContent?.({
              turns: [{ role: 'user', parts: [{ text: payload.text }] }],
              turnComplete: true,
            }),
          );
        }
      });

      socket?.on?.('close', () => {
        void closeSession();
        Logger.log('Live WS client disconnected', 'LiveProxy');
      });

      socket?.on?.('error', (error) => {
        Logger.warn(`Live WS error: ${(error as Error).message}`, 'LiveProxy');
      });
    },
  );

  await app.listen({
    host: '0.0.0.0',
    port: env.PORT,
  });

  Logger.log(`API is running on http://0.0.0.0:${env.PORT}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, 'Bootstrap');
  process.exit(1);
});
