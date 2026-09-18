import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
