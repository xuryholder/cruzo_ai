import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ContactTone, MessageChannel, MessageDraftStatus } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MessagesService } from './messages.service.js';

const generateMessageSchema = z.object({
  contactId: z.string().min(1),
  tone: z.nativeEnum(ContactTone).optional(),
  maxWords: z.coerce.number().int().positive().max(1000).optional(),
  language: z.string().trim().min(2).max(16).optional(),
});

const listMessagesQuerySchema = z.object({
  status: z.nativeEnum(MessageDraftStatus).optional(),
  channel: z.nativeEnum(MessageChannel).optional(),
  contact_id: z.string().min(1).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
  sort: z.enum(['created_at', 'updated_at']).optional(),
});

const editDraftSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});

const approveDraftSchema = z
  .object({
    subject: z.string().trim().min(1).max(120).optional(),
    text: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((value) => value.subject !== undefined || value.text !== undefined, {
    message: 'Either subject or text must be provided',
  });

const sendNowSchema = z.object({
  channel: z.nativeEnum(MessageChannel),
});

const markSentSchema = z.object({
  channel: z.nativeEnum(MessageChannel),
  external_message_id: z.string().trim().min(1).max(256).optional(),
  notes: z.string().trim().min(1).max(500).optional(),
});

function requireIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['x-idempotency-key'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }

  if (Array.isArray(raw) && raw.length > 0 && raw[0].trim().length > 0) {
    return raw[0].trim();
  }

  return '';
}

@Controller('/v1/manual/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('/generate')
  @HttpCode(HttpStatus.CREATED)
  async generate(@Body() body: unknown) {
    const parsed = generateMessageSchema.parse(body);
    return this.messagesService.generate(parsed);
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const parsed = listMessagesQuerySchema.parse(request.query);
    return this.messagesService.list({
      status: parsed.status,
      channel: parsed.channel,
      contactId: parsed.contact_id,
      dateFrom: parsed.date_from,
      dateTo: parsed.date_to,
      limit: parsed.limit,
      cursor: parsed.cursor,
      sort: parsed.sort,
    });
  }

  @Get('/:messageId')
  async getById(@Param('messageId') messageId: string) {
    return this.messagesService.getById(messageId);
  }

  @Patch('/:messageId')
  async edit(@Param('messageId') messageId: string, @Body() body: unknown) {
    const parsed = editDraftSchema.parse(body);
    return this.messagesService.editDraft(messageId, parsed);
  }

  @Patch('/:messageId/approve')
  async approve(@Param('messageId') messageId: string, @Body() body: unknown) {
    const parsed = approveDraftSchema.parse(body);
    return this.messagesService.approveDraft(messageId, parsed);
  }

  @Post('/:messageId/send-now')
  async sendNow(
    @Param('messageId') messageId: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = sendNowSchema.parse(body);
    const idempotencyKey = requireIdempotencyKey(request);

    return this.messagesService.sendNow({
      messageId,
      channel: parsed.channel,
      idempotencyKey,
    });
  }

  @Post('/:messageId/retry')
  async retry(@Param('messageId') messageId: string, @Req() request: FastifyRequest) {
    const idempotencyKey = requireIdempotencyKey(request);
    return this.messagesService.retry({
      messageId,
      idempotencyKey,
    });
  }

  @Post('/:messageId/mark-sent')
  async markSent(@Param('messageId') messageId: string, @Body() body: unknown) {
    const parsed = markSentSchema.parse(body);
    return this.messagesService.markSent({
      messageId,
      channel: parsed.channel,
      externalMessageId: parsed.external_message_id,
      notes: parsed.notes,
    });
  }

  @Delete('/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('messageId') messageId: string): Promise<void> {
    await this.messagesService.deleteDraft(messageId);
  }
}
