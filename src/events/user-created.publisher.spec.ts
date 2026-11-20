import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from '../config/auth.config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UserCreatedPublisher } from './user-created.publisher.js';

const connect = vi.hoisted(() => vi.fn());
vi.mock('amqplib', () => ({ connect }));

const event = {
  id: 'event-1', type: 'user.created.v1', occurredAt: new Date('2025-01-01T00:00:00Z'),
  userId: 'student-id', user: { role: 'STUDENT' },
};

function setup() {
  const channel = {
    assertExchange: vi.fn(), publish: vi.fn(), waitForConfirms: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
  };
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: vi.fn().mockResolvedValue(channel), close: vi.fn().mockResolvedValue(undefined),
  });
  const outboxEvent = { findMany: vi.fn().mockResolvedValue([event]), update: vi.fn() };
  connect.mockResolvedValue(connection);
  const publisher = new UserCreatedPublisher(
    { outboxEvent } as unknown as PrismaService, { rabbitmqUrl: 'amqp://test' } as AuthConfig,
  );
  return { channel, connection, outboxEvent, publisher };
}

describe('UserCreatedPublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connect.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('marks each event published only after broker confirmation and closes on shutdown', async () => {
    const { channel, connection, outboxEvent, publisher } = setup();
    let confirm!: () => void;
    channel.waitForConfirms.mockReturnValue(new Promise<void>((resolve) => { confirm = resolve; }));
    publisher.onModuleInit();
    try {
      await vi.advanceTimersByTimeAsync(0);
      const [exchange, key, body, options] = channel.publish.mock.calls[0];
      expect([exchange, key]).toEqual(['ecilost.events', 'user.created.v1']);
      expect(JSON.parse(body.toString())).toEqual({
        eventId: event.id, type: event.type, occurredAt: event.occurredAt.toISOString(),
        userId: event.userId, role: 'STUDENT',
      });
      expect(options).toMatchObject({ persistent: true, messageId: event.id });
      expect(outboxEvent.update).not.toHaveBeenCalled();
      confirm();
      await vi.advanceTimersByTimeAsync(0);
      expect(outboxEvent.update).toHaveBeenCalledWith({
        where: { id: event.id }, data: { publishedAt: expect.any(Date), attempts: { increment: 1 } },
      });
    } finally {
      await publisher.onModuleDestroy();
    }
    expect(channel.close).toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalled();
  });

  it('keeps an unconfirmed event pending and reconnects on the next poll', async () => {
    const { channel, outboxEvent, publisher } = setup();
    channel.waitForConfirms.mockRejectedValueOnce(new Error('broker unavailable'));
    publisher.onModuleInit();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(outboxEvent.update).not.toHaveBeenCalled();
      expect(channel.close).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(outboxEvent.update).toHaveBeenCalledTimes(1);
    } finally {
      await publisher.onModuleDestroy();
    }
  });
});
