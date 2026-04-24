import { Controller, Post, Body, Get } from '@nestjs/common';
import { MetaService } from './meta.service';

@Controller('meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  // Este es el que probablemente te da error. 
  // Lo actualizamos para recibir el phoneId y los datos del body.
  /* @Post('send-template')
  async sendTemplate(@Body() body: { phoneId: string, to: string }) {
    // Si aún quieres usar la plantilla hello_world por defecto para pruebas:
    // NOTA: Tendríamos que crear un método en el service para templates, 
    // pero por ahora usemos sendMessage para limpiar el error de compilación.
    
    return await this.metaService.sendMessage(
      body.phoneId, 
      body.to, 
      "Prueba de mensaje dinámico"
    );
  } */

  // Endpoint de prueba rápida
  @Get('test')
  test() {
    return { message: 'Meta Controller is working' };
  }
}