import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Headers } from '@nestjs/common';
import { SpidiService } from './spidi.service';
import { CreateSpidiDto } from './dto/create-spidi.dto';
import { UpdateSpidiDto } from './dto/update-spidi.dto';
import { ApiKeyGuard } from 'src/guards/api-key/api-key.guard';

@Controller('/api/spidi')
export class SpidiController {
  constructor(private readonly spidiService: SpidiService) {}

  // Ruta protegida: El frontend de Angular la llama para iniciar el pago
  @UseGuards(ApiKeyGuard)
  @Post('checkout')
  async createCheckout(
    @Req() req, 
    @Body('creditos') creditos: number, 
    @Body('link') link: string,
    @Body('usuario') usuario: string
  ) {
    
    const apiKey = req.headers['x-api-key'];
    return this.spidiService.generateCheckoutLink(apiKey, creditos, link, usuario);

  }

  @UseGuards(ApiKeyGuard)
  @Get('history')
  async getHistory(@Req() req) {
    // Gracias al ApiKeyGuard, sabemos que req.channel es seguro y válido
    const apiKey = req.channel.internalApiKey; 
    
    return this.spidiService.getPaymentHistory(apiKey);
  }

  // Ruta PÚBLICA: Spidi la llama para avisar que el pago se completó
  @Post('webhook')
  async handleWebhook(@Body() payload: any, @Headers('x-spidi-signature') signature: string) {    
    console.log(payload);
    
    return this.spidiService.processSpidiWebhook(payload);
  }
}
