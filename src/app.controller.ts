import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Ruta de ejemplo original; se mantiene para no romper consumidores existentes. */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Answers as long as the process is up and accepting requests. It does not check ' +
      'the database or any dependency, so a healthy answer here does not mean a login ' +
      'would succeed.',
  })
  @ApiOkResponse({
    description: 'The service is running.',
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', example: 'ok' } },
    },
  })
  health(): { status: 'ok' } {
    return this.appService.health();
  }
}
