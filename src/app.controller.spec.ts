import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns the liveness payload', () => {
      expect(appController.health()).toEqual({ status: 'ok' });
    });
  });

  describe('root', () => {
    it('keeps the existing response', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
