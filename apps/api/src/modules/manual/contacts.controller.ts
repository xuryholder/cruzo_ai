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
  Query,
} from '@nestjs/common';
import { ContactRelationship, ContactSource, ContactTone } from '@prisma/client';
import { z } from 'zod';
import { ContactsService } from './contacts.service.js';

const createContactSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  birthdayDate: z.string(),
  relationship: z.nativeEnum(ContactRelationship).optional(),
  tone: z.nativeEnum(ContactTone).optional(),
  source: z.nativeEnum(ContactSource).default(ContactSource.manual_test),
});

const updateContactSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    birthdayDate: z.string().optional(),
    relationship: z.nativeEnum(ContactRelationship).optional(),
    tone: z.nativeEnum(ContactTone).optional(),
    source: z.nativeEnum(ContactSource).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const listContactsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  relationship: z.nativeEnum(ContactRelationship).optional(),
  has_birthday_today: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
  sort: z.enum(['created_at', 'updated_at']).optional(),
});

@Controller('/v1/manual/contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const parsed = createContactSchema.parse(body);
    return this.contactsService.createContact(parsed);
  }

  @Get()
  async list(@Query() query: unknown) {
    const parsed = listContactsQuerySchema.parse(query);
    return this.contactsService.listContacts({
      q: parsed.q,
      relationship: parsed.relationship,
      hasBirthdayToday: parsed.has_birthday_today,
      limit: parsed.limit,
      cursor: parsed.cursor,
      sort: parsed.sort,
    });
  }

  @Patch('/:contactId')
  async update(@Param('contactId') contactId: string, @Body() body: unknown) {
    const parsed = updateContactSchema.parse(body);
    return this.contactsService.updateContact(contactId, parsed);
  }

  @Delete('/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('contactId') contactId: string): Promise<void> {
    await this.contactsService.deleteContact(contactId);
  }
}
