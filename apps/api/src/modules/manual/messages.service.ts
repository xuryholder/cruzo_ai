import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ContactTone,
  MessageChannel,
  MessageDraftStatus,
  MessageLogAction,
  MessageLogStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ManualUserService } from './manual-user.service.js';
import {
  decodeCursor,
  dayEndUtc,
  dayStartUtc,
  encodeCursor,
  parseIsoDateOnly,
  resolveSortField,
  type ManualSortField,
} from './manual.utils.js';
import {
  MANUAL_DEFAULT_PAGE_LIMIT,
  MANUAL_MAX_PAGE_LIMIT,
} from './manual.constants.js';

type MessageItem = {
  id: string;
  contactId: string;
  subject: string;
  text: string;
  status: MessageDraftStatus;
  channel: MessageChannel | null;
  language: string;
  tone: ContactTone;
  maxWords: number;
  createdAt: string;
  updatedAt: string;
};

type MessageLogItem = {
  id: string;
  action: MessageLogAction;
  status: MessageLogStatus;
  channel: MessageChannel | null;
  externalMessageId: string | null;
  error: string | null;
  notes: string | null;
  timestamp: string;
};

export type ListMessagesResult = {
  items: MessageItem[];
  nextCursor: string | null;
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manualUserService: ManualUserService,
  ) {}

  async generate(input: {
    contactId: string;
    tone?: ContactTone;
    maxWords?: number;
    language?: string;
  }): Promise<MessageItem> {
    const userId = await this.manualUserService.resolveUserId();
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: input.contactId,
        userId,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const tone = input.tone ?? contact.tone;
    const maxWords = clampMaxWords(input.maxWords);
    const language = (input.language?.trim() || 'en').slice(0, 16).toLowerCase();
    const generated = generateDraftContent({
      name: contact.name,
      tone,
      maxWords,
    });

    const draft = await this.prisma.$transaction(async (tx) => {
      const created = await tx.messageDraft.create({
        data: {
          userId,
          contactId: contact.id,
          subject: generated.subject,
          text: generated.text,
          status: MessageDraftStatus.draft,
          language,
          tone,
          maxWords,
        },
      });

      await tx.messageLog.create({
        data: {
          userId,
          contactId: contact.id,
          draftId: created.id,
          action: MessageLogAction.generated,
          status: MessageLogStatus.success,
        },
      });

      return created;
    });

    return toMessageItem(draft);
  }

  async list(params: {
    status?: MessageDraftStatus;
    channel?: MessageChannel;
    contactId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    cursor?: string;
    sort?: string;
  }): Promise<ListMessagesResult> {
    const userId = await this.manualUserService.resolveUserId();
    const limit = clampLimit(params.limit);
    const sort = resolveSortField(params.sort);
    const where: Prisma.MessageDraftWhereInput = { userId };
    const andClauses: Prisma.MessageDraftWhereInput[] = [];

    if (params.status) {
      andClauses.push({ status: params.status });
    }

    if (params.channel) {
      andClauses.push({ channel: params.channel });
    }

    if (params.contactId) {
      andClauses.push({ contactId: params.contactId });
    }

    if (params.dateFrom || params.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (params.dateFrom) {
        createdAt.gte = dayStartUtc(parseIsoDateOnly(params.dateFrom, 'date_from'));
      }

      if (params.dateTo) {
        createdAt.lte = dayEndUtc(parseIsoDateOnly(params.dateTo, 'date_to'));
      }

      andClauses.push({ createdAt });
    }

    if (params.cursor && params.cursor.trim().length > 0) {
      andClauses.push(buildDraftCursorWhere(sort, params.cursor));
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    const rows = await this.prisma.messageDraft.findMany({
      where,
      orderBy: draftSortOrder(sort),
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: sliced.map((row) => toMessageItem(row)),
      nextCursor: hasMore ? buildDraftCursor(sliced[sliced.length - 1], sort) : null,
    };
  }

  async getById(messageId: string): Promise<{
    draft: MessageItem;
    logs: MessageLogItem[];
  }> {
    const userId = await this.manualUserService.resolveUserId();
    const draft = await this.prisma.messageDraft.findFirst({
      where: {
        id: messageId,
        userId,
      },
    });

    if (!draft) {
      throw new NotFoundException('Message draft not found');
    }

    const logs = await this.prisma.messageLog.findMany({
      where: {
        userId,
        draftId: messageId,
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: 20,
    });

    return {
      draft: toMessageItem(draft),
      logs: logs.map((row) => toMessageLogItem(row)),
    };
  }

  async editDraft(messageId: string, input: { text: string }): Promise<MessageItem> {
    const userId = await this.manualUserService.resolveUserId();
    const text = normalizeText(input.text, 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.messageDraft.findFirst({
        where: {
          id: messageId,
          userId,
        },
      });

      if (!draft) {
        throw new NotFoundException('Message draft not found');
      }

      if (draft.status !== MessageDraftStatus.draft) {
        throw new ConflictException('Only draft messages can be edited');
      }

      const updated = await tx.messageDraft.update({
        where: { id: messageId },
        data: { text },
      });

      await tx.messageLog.create({
        data: {
          userId,
          contactId: draft.contactId,
          draftId: draft.id,
          action: MessageLogAction.edited,
          status: MessageLogStatus.success,
        },
      });

      return updated;
    });

    return toMessageItem(result);
  }

  async approveDraft(
    messageId: string,
    input: { subject?: string; text?: string },
  ): Promise<MessageItem> {
    const userId = await this.manualUserService.resolveUserId();
    const subject = input.subject !== undefined ? normalizeSubject(input.subject) : undefined;
    const text = input.text !== undefined ? normalizeText(input.text, 1000) : undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.messageDraft.findFirst({
        where: {
          id: messageId,
          userId,
        },
      });

      if (!draft) {
        throw new NotFoundException('Message draft not found');
      }

      if (draft.status === MessageDraftStatus.sent || draft.status === MessageDraftStatus.failed) {
        throw new ConflictException('Terminal status cannot be approved');
      }

      if (draft.status !== MessageDraftStatus.draft) {
        throw new ConflictException('Only draft messages can be approved');
      }

      const updated = await tx.messageDraft.update({
        where: { id: messageId },
        data: {
          status: MessageDraftStatus.approved,
          subject: subject ?? draft.subject,
          text: text ?? draft.text,
        },
      });

      await tx.messageLog.create({
        data: {
          userId,
          contactId: draft.contactId,
          draftId: draft.id,
          action: MessageLogAction.approved,
          status: MessageLogStatus.success,
        },
      });

      return updated;
    });

    return toMessageItem(result);
  }

  async sendNow(params: {
    messageId: string;
    channel: MessageChannel;
    idempotencyKey: string;
  }): Promise<{ draft: MessageItem; idempotent: boolean }> {
    return this.deliver({
      messageId: params.messageId,
      channel: params.channel,
      idempotencyKey: params.idempotencyKey,
      mode: 'send_now',
    });
  }

  async retry(params: {
    messageId: string;
    idempotencyKey: string;
  }): Promise<{ draft: MessageItem; idempotent: boolean }> {
    return this.deliver({
      messageId: params.messageId,
      idempotencyKey: params.idempotencyKey,
      mode: 'retry',
    });
  }

  async markSent(params: {
    messageId: string;
    channel: MessageChannel;
    externalMessageId?: string;
    notes?: string;
  }): Promise<MessageItem> {
    const userId = await this.manualUserService.resolveUserId();

    const result = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.messageDraft.findFirst({
        where: {
          id: params.messageId,
          userId,
        },
      });

      if (!draft) {
        throw new NotFoundException('Message draft not found');
      }

      if (draft.status !== MessageDraftStatus.approved) {
        throw new ConflictException('Only approved draft can be marked as sent');
      }

      const updated = await tx.messageDraft.update({
        where: { id: draft.id },
        data: {
          status: MessageDraftStatus.sent,
          channel: params.channel,
        },
      });

      await tx.messageLog.create({
        data: {
          userId,
          contactId: draft.contactId,
          draftId: draft.id,
          action: MessageLogAction.marked_sent,
          status: MessageLogStatus.success,
          channel: params.channel,
          externalMessageId: params.externalMessageId?.trim() || null,
          notes: params.notes?.trim() || null,
        },
      });

      return updated;
    });

    return toMessageItem(result);
  }

  async deleteDraft(messageId: string): Promise<void> {
    const userId = await this.manualUserService.resolveUserId();
    await this.prisma.$transaction(async (tx) => {
      const draft = await tx.messageDraft.findFirst({
        where: {
          id: messageId,
          userId,
        },
      });

      if (!draft) {
        throw new NotFoundException('Message draft not found');
      }

      if (draft.status === MessageDraftStatus.sent || draft.status === MessageDraftStatus.failed) {
        throw new ConflictException('Terminal status cannot be deleted');
      }

      await tx.messageLog.create({
        data: {
          userId,
          contactId: draft.contactId,
          draftId: draft.id,
          action: MessageLogAction.deleted,
          status: MessageLogStatus.success,
        },
      });

      await tx.messageDraft.delete({
        where: { id: draft.id },
      });
    });
  }

  private async deliver(params: {
    messageId: string;
    idempotencyKey: string;
    channel?: MessageChannel;
    mode: 'send_now' | 'retry';
  }): Promise<{ draft: MessageItem; idempotent: boolean }> {
    const userId = await this.manualUserService.resolveUserId();
    const key = params.idempotencyKey.trim();
    if (key.length === 0) {
      throw new BadRequestException('x-idempotency-key is required');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const draft = await tx.messageDraft.findFirst({
          where: {
            id: params.messageId,
            userId,
          },
          include: {
            contact: true,
          },
        });

        if (!draft) {
          throw new NotFoundException('Message draft not found');
        }

        const channel = params.channel ?? draft.channel;
        if (!channel) {
          throw new BadRequestException('Channel is required');
        }

        const existing = await tx.manualIdempotencyKey.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: key,
            },
          },
        });

        if (existing) {
          if (existing.draftId !== draft.id || existing.channel !== channel) {
            throw new ConflictException('Idempotency key payload mismatch');
          }

          const currentDraft = await tx.messageDraft.findUnique({
            where: { id: draft.id },
          });

          if (!currentDraft) {
            throw new NotFoundException('Message draft not found');
          }

          return {
            draft: toMessageItem(currentDraft),
            idempotent: true,
            failure: null,
          };
        }

        if (channel === MessageChannel.manual) {
          throw new BadRequestException('manual channel is only allowed in mark-sent');
        }

        if (channel !== MessageChannel.email) {
          throw new NotImplementedException('Channel integration is not implemented');
        }

        if (!draft.contact.email) {
          const failedDraft = await this.markDraftFailed(tx, {
            userId,
            draftId: draft.id,
            contactId: draft.contactId,
            channel,
            reason: 'Email channel requires contact email',
          });

          return {
            draft: toMessageItem(failedDraft),
            idempotent: false,
            failure: {
              kind: 'unprocessable_entity' as const,
              message: 'Email channel requires contact email',
            },
          };
        }

        if (params.mode === 'send_now' && draft.status !== MessageDraftStatus.approved) {
          throw new ConflictException('send-now requires approved status');
        }

        if (params.mode === 'retry' && draft.status !== MessageDraftStatus.failed) {
          throw new ConflictException('retry requires failed status');
        }

        await tx.manualIdempotencyKey.create({
          data: {
            userId,
            idempotencyKey: key,
            draftId: draft.id,
            channel,
          },
        });

        await tx.messageLog.create({
          data: {
            userId,
            contactId: draft.contactId,
            draftId: draft.id,
            action: MessageLogAction.send_requested,
            status: MessageLogStatus.success,
            channel,
          },
        });

        await tx.messageLog.create({
          data: {
            userId,
            contactId: draft.contactId,
            draftId: draft.id,
            action: MessageLogAction.send_attempt,
            status: MessageLogStatus.success,
            channel,
          },
        });

        const updated = await tx.messageDraft.update({
          where: { id: draft.id },
          data: {
            status: MessageDraftStatus.sent,
            channel,
          },
        });

        await tx.messageLog.create({
          data: {
            userId,
            contactId: draft.contactId,
            draftId: draft.id,
            action: MessageLogAction.sent,
            status: MessageLogStatus.success,
            channel,
            externalMessageId: `mock-email-${Date.now()}`,
          },
        });

        return {
          draft: toMessageItem(updated),
          idempotent: false,
          failure: null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.failure?.kind === 'unprocessable_entity') {
      throw new UnprocessableEntityException(result.failure.message);
    }

    return {
      draft: result.draft,
      idempotent: result.idempotent,
    };
  }

  private async markDraftFailed(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      contactId: string;
      draftId: string;
      channel: MessageChannel;
      reason: string;
    },
  ): Promise<{
    id: string;
    contactId: string;
    subject: string;
    text: string;
    status: MessageDraftStatus;
    channel: MessageChannel | null;
    language: string;
    tone: ContactTone;
    maxWords: number;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const updated = await tx.messageDraft.update({
      where: { id: params.draftId },
      data: {
        status: MessageDraftStatus.failed,
        channel: params.channel,
      },
    });

    await tx.messageLog.create({
      data: {
        userId: params.userId,
        contactId: params.contactId,
        draftId: params.draftId,
        action: MessageLogAction.send_failed,
        status: MessageLogStatus.failed,
        channel: params.channel,
        error: params.reason,
      },
    });

    return updated;
  }
}

function toMessageItem(draft: {
  id: string;
  contactId: string;
  subject: string;
  text: string;
  status: MessageDraftStatus;
  channel: MessageChannel | null;
  language: string;
  tone: ContactTone;
  maxWords: number;
  createdAt: Date;
  updatedAt: Date;
}): MessageItem {
  return {
    id: draft.id,
    contactId: draft.contactId,
    subject: draft.subject,
    text: draft.text,
    status: draft.status,
    channel: draft.channel,
    language: draft.language,
    tone: draft.tone,
    maxWords: draft.maxWords,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function toMessageLogItem(log: {
  id: string;
  action: MessageLogAction;
  status: MessageLogStatus;
  channel: MessageChannel | null;
  externalMessageId: string | null;
  error: string | null;
  notes: string | null;
  timestamp: Date;
}): MessageLogItem {
  return {
    id: log.id,
    action: log.action,
    status: log.status,
    channel: log.channel,
    externalMessageId: log.externalMessageId,
    error: log.error,
    notes: log.notes,
    timestamp: log.timestamp.toISOString(),
  };
}

function normalizeSubject(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    throw new BadRequestException('subject must not be empty');
  }

  if (normalized.length > 120) {
    throw new BadRequestException('subject must be <= 120 chars');
  }

  return normalized;
}

function normalizeText(value: string, maxLen: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    throw new BadRequestException('text must not be empty');
  }

  if (normalized.length > maxLen) {
    throw new BadRequestException(`text must be <= ${maxLen} chars`);
  }

  return normalized;
}

function generateDraftContent(params: {
  name: string | null;
  tone: ContactTone;
  maxWords: number;
}): { subject: string; text: string } {
  const subject = normalizeSubject(
    `Happy Birthday${params.name ? `, ${params.name}` : ''}!`,
  );

  const intro = params.name
    ? `Happy Birthday, ${params.name}!`
    : 'Happy Birthday!';
  const toneSentence = resolveToneSentence(params.tone);
  const body =
    `${intro} ${toneSentence} Wishing you health, joy, and many meaningful wins this year.`;

  const text = normalizeText(truncateWords(body, params.maxWords), 1000);
  return { subject, text };
}

function resolveToneSentence(tone: ContactTone): string {
  switch (tone) {
    case ContactTone.formal:
      return 'Please accept my sincere congratulations on your special day.';
    case ContactTone.semi_formal:
      return 'Wishing you a great day and a successful year ahead.';
    case ContactTone.friendly:
      return 'Hope your day is full of smiles and good energy.';
    case ContactTone.warm:
      return 'Sending warm wishes and heartfelt congratulations.';
    case ContactTone.playful:
      return 'Hope your cake is huge and your day is even better.';
    case ContactTone.neutral:
    default:
      return 'Best wishes on your special day.';
  }
}

function truncateWords(value: string, maxWords: number): string {
  const words = value.split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= maxWords) {
    return value;
  }

  return `${words.slice(0, maxWords).join(' ')}`.trim();
}

function clampLimit(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return MANUAL_DEFAULT_PAGE_LIMIT;
  }

  const parsed = Math.max(1, Math.floor(value));
  return Math.min(parsed, MANUAL_MAX_PAGE_LIMIT);
}

function clampMaxWords(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return 100;
  }

  return Math.min(Math.max(1, Math.floor(value)), 1000);
}

function draftSortOrder(sort: ManualSortField): Prisma.MessageDraftOrderByWithRelationInput[] {
  if (sort === 'updated_at') {
    return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }

  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

function buildDraftCursorWhere(sort: ManualSortField, cursor: string): Prisma.MessageDraftWhereInput {
  const decoded = decodeCursor(cursor);
  const cursorDate = new Date(decoded.ts);

  if (sort === 'updated_at') {
    return {
      OR: [
        { updatedAt: { lt: cursorDate } },
        {
          AND: [{ updatedAt: cursorDate }, { id: { lt: decoded.id } }],
        },
      ],
    };
  }

  return {
    OR: [
      { createdAt: { lt: cursorDate } },
      {
        AND: [{ createdAt: cursorDate }, { id: { lt: decoded.id } }],
      },
    ],
  };
}

function buildDraftCursor(
  row: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
  },
  sort: ManualSortField,
): string {
  const timestamp = sort === 'updated_at' ? row.updatedAt : row.createdAt;
  return encodeCursor({ timestamp, id: row.id });
}

class NotImplementedException extends HttpException {
  constructor(message: string) {
    super(
      {
      statusCode: 501,
      message,
      error: 'Not Implemented',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
