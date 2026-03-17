import { Controller, Get, Param, Res, NotFoundException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import * as fs from 'fs';

@Controller('api/media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  @Get('whatsapp/:filename')
  async getWhatsAppFile(
    @Param('filename') filename: string, 
    @Res() res: Response
  ) {
    // Construimos la ruta absoluta a la carpeta uploads
    const filePath = join(process.cwd(), 'uploads', filename);

    // Verificamos si el archivo existe físicamente
    if (!fs.existsSync(filePath)) {
      this.logger.error(`Archivo no encontrado: ${filePath}`);
      throw new NotFoundException('El archivo solicitado no existe');
    }

    // Enviamos el archivo
    // NestJS/Express se encarga de detectar el MimeType (imagen, audio, etc.) automáticamente
    return res.sendFile(filePath);
  }
}