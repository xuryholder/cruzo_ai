import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ContactsService } from './contacts.service.js';

const birthdaysTodayQuerySchema = z.object({
  date: z.string().optional(),
});

@Controller('/v1/manual/birthdays')
export class BirthdaysController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get('/today')
  async today(@Query() query: unknown) {
    const parsed = birthdaysTodayQuerySchema.parse(query);
    return this.contactsService.listBirthdaysForDate(parsed.date);
  }
}
