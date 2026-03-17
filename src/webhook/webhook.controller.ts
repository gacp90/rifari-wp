import { Controller, Get, Post, Body, Query, Res, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';

@Controller('api/webhook')
export class WebhookController {
  private readonly logger = new Logger('WebhookController');

  constructor(private configService: ConfigService,
              private webhookService: WebhookService
  ) {}

  // ==========================================
  // 1. RUTA GET: Verificación de Meta
  // ==========================================
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response
  ) {
    const myVerifyToken = this.configService.get<string>('WEBHOOK_VERIFY_TOKEN');

    if (mode && token) {
      if (mode === 'subscribe' && token === myVerifyToken) {
        this.logger.log('¡Webhook verificado por Meta exitosamente!');
        // Meta exige que devolvamos exactamente el número que nos mandaron en "challenge"
        return res.status(HttpStatus.OK).send(challenge);
      } else {
        this.logger.error('Fallo la verificación: Tokens no coinciden.');
        return res.sendStatus(HttpStatus.FORBIDDEN);
      }
    }
    return res.sendStatus(HttpStatus.BAD_REQUEST);
  }

  @Post()
  receiveMessage(@Body() body: any, @Res() res: Response) {
    // 1. Respondemos 200 OK a Meta inmediatamente
    res.sendStatus(HttpStatus.OK);

    // 2. Le pasamos el JSON a nuestro servicio para que lo analice y guarde en MongoDB
    if (body.object === 'whatsapp_business_account') {
      this.webhookService.processIncomingData(body);
    }
  }
}