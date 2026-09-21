import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { AuthConfig } from '../config/auth.config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const EXCHANGE = 'ecilost.events';
const ROUTING_KEY = 'user.created.v1';
const RETRY_DELAY_MS = 5_000;

/** Publica el outbox despues del commit. RabbitMQ confirma cada mensaje antes de marcarlo enviado. */
@Injectable()
export class UserCreatedPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserCreatedPublisher.name);
  private channel?: amqp.ConfirmChannel;
  private connection?: amqp.ChannelModel;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AuthConfig,
  ) {}

  onModuleInit(): void {
    this.schedule();
    void this.publishPending();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.channel?.close();
    await this.connection?.close();
  }

  private schedule(): void {
    this.timer = setInterval(() => void this.publishPending(), RETRY_DELAY_MS);
  }

  private async publishPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null, type: ROUTING_KEY },
        include: { user: true },
        orderBy: { occurredAt: 'asc' },
        take: 100,
      });
      if (!events.length) return;

      const channel = await this.getChannel();
      for (const event of events) {
        const body = Buffer.from(
          JSON.stringify({
            eventId: event.id,
            type: event.type,
            occurredAt: event.occurredAt.toISOString(),
            userId: event.userId,
            role: event.user.role,
          }),
        );
        channel.publish(EXCHANGE, ROUTING_KEY, body, {
          persistent: true,
          contentType: 'application/json',
          messageId: event.id,
          type: event.type,
        });
        await channel.waitForConfirms();
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 } },
        });
      }
    } catch (error) {
      this.logger.warn(`No fue posible publicar UserCreated: ${String(error)}`);
      await this.closeConnection();
    } finally {
      this.running = false;
    }
  }

  private async getChannel(): Promise<amqp.ConfirmChannel> {
    if (this.channel) return this.channel;
    this.connection = await amqp.connect(this.config.rabbitmqUrl);
    this.connection.on('error', () => void this.closeConnection());
    this.connection.on('close', () => void this.closeConnection());
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    return this.channel;
  }

  private async closeConnection(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}
