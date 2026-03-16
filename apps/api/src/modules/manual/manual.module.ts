import { Module } from '@nestjs/common';
import { BirthdaysController } from './birthdays.controller.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { ManualUserService } from './manual-user.service.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  providers: [ManualUserService, ContactsService, MessagesService],
  controllers: [ContactsController, BirthdaysController, MessagesController],
})
export class ManualModule {}
