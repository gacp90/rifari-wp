import { Controller, Get, Post, Delete, Body, Headers, Param, Patch, UseInterceptors, Req, UploadedFile, BadRequestException, UseGuards } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiKeyGuard } from 'src/guards/api-key/api-key.guard';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('api/templates')
@UseGuards(ApiKeyGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post('validar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads', // Crea esta carpeta en la raíz de tu proyecto
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // Límite de 20MB
    }),
  )
  async validar(
    @Headers('x-api-key') apiKey: string,
    @Body('texto') texto: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!texto || !apiKey) {
      throw new BadRequestException({ ok: false, msg: 'El texto de la plantilla y la API Key son obligatorios.' });
    }

    return await this.templatesService.procesarYValidar(apiKey, texto, file);
  }

  @Post('query')
  async searchTemplates(
    @Headers('x-api-key') apiKey: string,
    @Body() body: any
  ) {
    return this.templatesService.queryTemplates(apiKey, body);
  }

  @Get()
  async getTemplates(@Headers('x-api-key') apiKey: string) {
    return this.templatesService.getLocalTemplates(apiKey);
  }

  @Post('sync')
  async syncTemplates(@Headers('x-api-key') apiKey: string) {
    return this.templatesService.syncTemplates(apiKey);
  }

  @Post()
  async createTemplate(@Headers('x-api-key') apiKey: string, @Body() body: any) {
    return this.templatesService.createTemplate(apiKey, body);
  }

  @Post('media')
  @UseInterceptors(FileInterceptor('file')) 
  async createMediaTemplate(
    @Req() req,
    @UploadedFile() file: any, // Cambiado a any para evitar la alerta de Multer
    @Body('templateData') templateDataString: string // Angular enviará todo el objeto aquí
  ) {
    
    if (!file) {
      throw new BadRequestException({ ok: false, msg: 'El archivo multimedia es obligatorio.' });
    }

    const channel = req.channel;
    let templateData: any = {};

    try {
      // Convertimos el string que manda Angular a un objeto JSON real
      if (templateDataString) {
        templateData = JSON.parse(templateDataString);
      }
    } catch (error) {
      throw new BadRequestException({ ok: false, msg: 'El formato de templateData es inválido.' });
    }

    // ¡Descomentamos el return y enviamos los datos limpios!
    return this.templatesService.createMediaTemplate(channel, file, templateData);
  }

  @Patch(':id/toggle-active')
  async toggleActive(
    @Headers('x-api-key') apiKey: string,
    @Param('id') id: string,
    @Body('active') active: boolean
  ) {
    return this.templatesService.toggleTemplateActive(apiKey, id, active);
  }

  @Delete(':name')
  async deleteTemplate(@Headers('x-api-key') apiKey: string, @Param('name') name: string) {
    return this.templatesService.deleteTemplate(apiKey, name);
  }
}