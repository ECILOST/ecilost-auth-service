import { Module } from '@nestjs/common';
import { UserCreatedPublisher } from './user-created.publisher.js';

@Module({ providers: [UserCreatedPublisher] })
export class EventsModule {}
