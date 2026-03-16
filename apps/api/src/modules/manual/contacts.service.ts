import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContactRelationship, ContactSource, ContactTone, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import {
  decodeCursor,
  encodeCursor,
  isLeapYear,
  normalizeEmail,
  parseIsoDateOnly,
  resolveSortField,
  toDateOnlyString,
  type ManualSortField,
} from './manual.utils.js';
import {
  MANUAL_DEFAULT_PAGE_LIMIT,
  MANUAL_MAX_PAGE_LIMIT,
} from './manual.constants.js';
import { ManualUserService } from './manual-user.service.js';

type ContactItem = {
  id: string;
  name: string | null;
  email: string | null;
  birthdayDate: string;
  relationship: ContactRelationship;
  tone: ContactTone;
  source: ContactSource;
  createdAt: string;
  updatedAt: string;
};

export type ListContactsResult = {
  items: ContactItem[];
  nextCursor: string | null;
};

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manualUserService: ManualUserService,
  ) {}

  async createContact(input: {
    name?: string;
    email?: string;
    birthdayDate: string;
    relationship?: ContactRelationship;
    tone?: ContactTone;
    source: ContactSource;
  }): Promise<ContactItem> {
    const userId = await this.manualUserService.resolveUserId();
    const email = input.email?.trim() || null;
    const emailNormalized = normalizeEmail(email);
    const birthdayDate = parseIsoDateOnly(input.birthdayDate, 'birthdayDate');

    try {
      const created = await this.prisma.contact.create({
        data: {
          userId,
          name: input.name?.trim() || null,
          email,
          emailNormalized,
          birthdayDate,
          relationship: input.relationship ?? ContactRelationship.other,
          tone: input.tone ?? ContactTone.neutral,
          source: input.source,
        },
      });

      return this.toContactItem(created);
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        throw new ConflictException('Contact with this email already exists');
      }

      throw error;
    }
  }

  async listContacts(params: {
    q?: string;
    relationship?: ContactRelationship;
    hasBirthdayToday?: boolean;
    limit?: number;
    cursor?: string;
    sort?: string;
  }): Promise<ListContactsResult> {
    const userId = await this.manualUserService.resolveUserId();
    const limit = clampLimit(params.limit);
    const sort = resolveSortField(params.sort);

    const where: Prisma.ContactWhereInput = { userId };
    const andClauses: Prisma.ContactWhereInput[] = [];
    if (params.relationship) {
      andClauses.push({ relationship: params.relationship });
    }

    if (params.q && params.q.trim().length > 0) {
      const query = params.q.trim();
      andClauses.push({
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      });
    }

    if (params.hasBirthdayToday) {
      const ids = await this.getBirthdayContactIdsForDate(userId, new Date());
      if (ids.length === 0) {
        return {
          items: [],
          nextCursor: null,
        };
      }

      andClauses.push({ id: { in: ids } });
    }

    if (params.cursor && params.cursor.trim().length > 0) {
      andClauses.push(this.buildCursorWhere(sort, params.cursor));
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    const rows = await this.prisma.contact.findMany({
      where,
      orderBy: sortOrder(sort),
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: sliced.map((row) => this.toContactItem(row)),
      nextCursor: hasMore ? buildContactCursor(sliced[sliced.length - 1], sort) : null,
    };
  }

  async updateContact(
    contactId: string,
    input: {
      name?: string | null;
      email?: string | null;
      birthdayDate?: string;
      relationship?: ContactRelationship;
      tone?: ContactTone;
      source?: ContactSource;
    },
  ): Promise<ContactItem> {
    const userId = await this.manualUserService.resolveUserId();
    const data: Prisma.ContactUpdateInput = {};

    if (input.name !== undefined) {
      data.name = input.name?.trim() || null;
    }

    if (input.email !== undefined) {
      const email = input.email?.trim() || null;
      data.email = email;
      data.emailNormalized = normalizeEmail(email);
    }

    if (input.birthdayDate !== undefined) {
      data.birthdayDate = parseIsoDateOnly(input.birthdayDate, 'birthdayDate');
    }

    if (input.relationship !== undefined) {
      data.relationship = input.relationship;
    }

    if (input.tone !== undefined) {
      data.tone = input.tone;
    }

    if (input.source !== undefined) {
      data.source = input.source;
    }

    try {
      const updated = await this.prisma.contact.updateMany({
        where: {
          id: contactId,
          userId,
        },
        data,
      });

      if (updated.count === 0) {
        throw new NotFoundException('Contact not found');
      }

      const contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
      });

      if (!contact || contact.userId !== userId) {
        throw new NotFoundException('Contact not found');
      }

      return this.toContactItem(contact);
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        throw new ConflictException('Contact with this email already exists');
      }

      throw error;
    }
  }

  async deleteContact(contactId: string): Promise<void> {
    const userId = await this.manualUserService.resolveUserId();
    const deleted = await this.prisma.contact.deleteMany({
      where: {
        id: contactId,
        userId,
      },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('Contact not found');
    }
  }

  async listBirthdaysForDate(dateInput?: string): Promise<{
    date: string;
    items: ContactItem[];
  }> {
    const userId = await this.manualUserService.resolveUserId();
    const date = dateInput ? parseIsoDateOnly(dateInput, 'date') : new Date();
    const ids = await this.getBirthdayContactIdsForDate(userId, date);

    if (ids.length === 0) {
      return {
        date: toDateOnlyString(date),
        items: [],
      };
    }

    const rows = await this.prisma.contact.findMany({
      where: {
        userId,
        id: { in: ids },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return {
      date: toDateOnlyString(date),
      items: rows.map((row) => this.toContactItem(row)),
    };
  }

  private buildCursorWhere(sort: ManualSortField, cursor: string): Prisma.ContactWhereInput {
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

  private toContactItem(contact: {
    id: string;
    name: string | null;
    email: string | null;
    birthdayDate: Date;
    relationship: ContactRelationship;
    tone: ContactTone;
    source: ContactSource;
    createdAt: Date;
    updatedAt: Date;
  }): ContactItem {
    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      birthdayDate: toDateOnlyString(contact.birthdayDate),
      relationship: contact.relationship,
      tone: contact.tone,
      source: contact.source,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    };
  }

  private async getBirthdayContactIdsForDate(
    userId: string,
    date: Date,
  ): Promise<string[]> {
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();
    const includeLeapDay = month === 2 && day === 28 && !isLeapYear(year);

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM contacts
      WHERE user_id = ${userId}
        AND (
          (EXTRACT(MONTH FROM birthday_date) = ${month}
            AND EXTRACT(DAY FROM birthday_date) = ${day})
          ${includeLeapDay
            ? Prisma.sql`OR (EXTRACT(MONTH FROM birthday_date) = 2 AND EXTRACT(DAY FROM birthday_date) = 29)`
            : Prisma.empty}
        )
    `);

    return rows.map((row) => row.id);
  }
}

function clampLimit(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return MANUAL_DEFAULT_PAGE_LIMIT;
  }

  const parsed = Math.max(1, Math.floor(value));
  return Math.min(parsed, MANUAL_MAX_PAGE_LIMIT);
}

function sortOrder(sort: ManualSortField): Prisma.ContactOrderByWithRelationInput[] {
  if (sort === 'updated_at') {
    return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }

  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

function buildContactCursor(
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

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
