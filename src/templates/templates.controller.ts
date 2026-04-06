import { Controller, Get, Post, Delete, Body, Headers, Param, Patch } from '@nestjs/common';
import { TemplatesService } from './templates.service';

@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

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