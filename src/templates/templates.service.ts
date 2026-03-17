import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Template, TemplateDocument } from './schemas/template.schema';
import { Channel, ChannelDocument } from '../whatsapp/schemas/channel.schema';
import { MetaService } from '../meta/meta.service';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @InjectModel(Template.name) private templateModel: Model<TemplateDocument>,
    @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>,
    private readonly metaService: MetaService,
  ) {}

  // ==========================================
  // 1. CREAR PLANTILLA (Enviar a Meta y Guardar Local)
  // ==========================================
  async createTemplate(apiKey: string, templateData: any) {
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    try {
      // 1. Enviamos la petición de creación a la Cloud API de Meta
      // templateData debe traer name, language, category y components
      const metaResponse = await this.metaService.registerTemplate(channel.wabaId, templateData);

      // 2. Si Meta responde OK, extraemos la info para nuestro modelo optimizado
      const headerComponent = templateData.components.find(c => c.type === 'HEADER');
      const bodyComponent = templateData.components.find(c => c.type === 'BODY');
      const footerComponent = templateData.components.find(c => c.type === 'FOOTER');
      const buttonsComponent = templateData.components.find(c => c.type === 'BUTTONS');

      const headerType = headerComponent ? headerComponent.format : 'NONE';
      const hasMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType);

      // 3. Guardamos en MongoDB con estado PENDING
      const newTemplate = new this.templateModel({
        internalApiKey: apiKey,
        name: templateData.name,
        language: templateData.language,
        category: templateData.category,
        status: 'PENDING', // Meta debe aprobarla
        hasMedia,
        headerType,
        headerContent: headerType === 'TEXT' ? headerComponent.text : null,
        bodyText: bodyComponent ? bodyComponent.text : '',
        footerText: footerComponent ? footerComponent.text : null,
        buttons: buttonsComponent ? buttonsComponent.buttons : [],
        rawComponents: templateData.components, // Guardamos el original por seguridad
        // Los mapeos se inicializan vacíos para que el usuario los configure luego
        headerVariablesMapping: [],
        bodyVariablesMapping: [],
        buttonVariablesMapping: []
      });

      await newTemplate.save();
      return { success: true, message: 'Plantilla enviada a revisión', data: newTemplate };

    } catch (error) {
      this.logger.error('Error creando plantilla:', error);
      throw new BadRequestException('Error al registrar la plantilla en Meta');
    }
  }

  // ==========================================
  // 2. SINCRONIZAR (Actualizar estados desde Meta)
  // ==========================================
  async syncTemplates(apiKey: string) {
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    try {
      // Pedimos a Meta todas las plantillas de esta cuenta
      const metaTemplates = await this.metaService.getTemplates(channel.wabaId);

      const syncResults = { added: 0, updated: 0 };

      // Iteramos sobre lo que devuelve Meta
      for (const t of metaTemplates) {
        // Analizamos los componentes
        const headerComponent = t.components?.find(c => c.type === 'HEADER');
        const bodyComponent = t.components?.find(c => c.type === 'BODY');
        const footerComponent = t.components?.find(c => c.type === 'FOOTER');
        const buttonsComponent = t.components?.find(c => c.type === 'BUTTONS');

        const headerType = headerComponent ? headerComponent.format : 'NONE';
        const hasMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType);

        const templateData = {
          status: t.status, // Aquí viene 'APPROVED', 'REJECTED', etc.
          category: t.category,
          hasMedia,
          headerType,
          headerContent: headerType === 'TEXT' ? headerComponent.text : null,
          bodyText: bodyComponent ? bodyComponent.text : '',
          footerText: footerComponent ? footerComponent.text : null,
          buttons: buttonsComponent ? buttonsComponent.buttons : [],
          rawComponents: t.components
        };

        // Upsert: Si existe la actualiza (ej: pasa de PENDING a APPROVED), si no, la crea
        const result = await this.templateModel.updateOne(
          { internalApiKey: apiKey, name: t.name, language: t.language },
          { $set: templateData },
          { upsert: true }
        );

        if (result.upsertedCount > 0) syncResults.added++;
        if (result.modifiedCount > 0) syncResults.updated++;
      }

      return { success: true, message: 'Sincronización completa', details: syncResults };
    } catch (error) {
      this.logger.error('Error sincronizando plantillas', error);
      throw new BadRequestException('Fallo al sincronizar con Meta');
    }
  }

  // ==========================================
  // 3. LEER LOCALES (Para tu Frontend)
  // ==========================================
  async getLocalTemplates(apiKey: string) {
    // Retorna las plantillas de Mongo, opcionalmente puedes filtrar solo las APPROVED
    return await this.templateModel.find({ internalApiKey: apiKey }).sort({ createdAt: -1 });
  }

  // ==========================================
  // 4. ELIMINAR PLANTILLA
  // ==========================================
  async deleteTemplate(apiKey: string, name: string) {
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    
    // 2. Borrar en Mongo
    await this.templateModel.deleteMany({ internalApiKey: apiKey, name: name });
    
    return { success: true, message: `Plantilla ${name} eliminada` };
  }

  // ==========================================
  // 5. CONSULTAR PLANTILLAS
  // ==========================================
  async queryTemplates(apiKey: string, body: any) {
    try {
      // 1. Extraemos la paginación, orden y el resto de los filtros dinámicos
      const { desde = 0, hasta = 50, sort = { createdAt: -1 }, ...query } = body;

      // 2. SEGURIDAD OBLIGATORIA: Forzamos que solo busque las plantillas de este canal
      query.internalApiKey = apiKey;

      // 3. Ejecutamos la búsqueda y el conteo en paralelo (Idéntico a tu Express)
      const [templates, total] = await Promise.all([
        this.templateModel.find(query)
          .sort(sort)
          .skip(Number(desde))
          .limit(Number(hasta)),
        this.templateModel.countDocuments(query) // Contamos usando los mismos filtros
      ]);

      return {
        ok: true,
        templates,
        total
      };
    } catch (error) {
      this.logger.error('Error en queryTemplates:', error);
      // NestJS maneja las excepciones HTTP de forma limpia
      throw new BadRequestException('Error inesperado al consultar plantillas');
    }
  }
}