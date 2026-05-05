import { Injectable, Logger, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Template, TemplateDocument } from './schemas/template.schema';
import { Channel, ChannelDocument } from '../whatsapp/schemas/channel.schema';
import { MetaService } from '../meta/meta.service';
import 'multer';

import { ConfigService } from '@nestjs/config';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';
import sharp from 'sharp';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private s3Client!: S3Client;

  constructor(
    @InjectModel(Template.name) private templateModel: Model<TemplateDocument>,
    @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>,
    private readonly metaService: MetaService,
    private configService: ConfigService
  ) {

    this.s3Client = new S3Client({
      region: process.env.DO_SPACES_REGION || 'nyc3',
      endpoint: process.env.DO_SPACES_ENDPOINT,
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY || '',
        secretAccessKey: process.env.DO_SPACES_SECRET || '',
      }
    });

    if (process.env.DO_SPACES_KEY) {
      this.logger.log('Conexión a DigitalOcean Spaces preparada.');
    } else {
      this.logger.warn('ALERTA: Faltan credenciales de DigitalOcean en el .env');
    }

  }

  // ==========================================
  // 1. CREAR PLANTILLA (Enviar a Meta y Guardar Local)
  // ==========================================
  async createTemplate(apiKey: string, templateData: any) {
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    try {

      // 1. EL TRADUCTOR MÁGICO PARA META
      let metaBodyText = templateData.bodyText;
      const bodyVariablesMapping: string[] = [];
      let contador = 1;

      // Buscamos {{name}}, {{number}}, etc., y los cambiamos por {{1}}, {{2}}
      const regex = /\{\{([^}]+)\}\}/g;
      metaBodyText = metaBodyText.replace(regex, (match, variableNombre) => {
        bodyVariablesMapping.push(variableNombre); // Guardamos ['name', 'number']
        return `{{${contador++}}}`; // Retorna {{1}}, {{2}} para el texto de Meta
      });

      // 2. CONSTRUIMOS EL ARRAY 'COMPONENTS' ESTRICTO PARA META
      const components: any[] = [];

      const bodyComponent: any = { type: 'BODY', text: metaBodyText };
      // INYECTAMOS DIRECTAMENTE LO QUE VINO DEL FRONTEND
      if (templateData.exampleBodyText && templateData.exampleBodyText.length > 0) {
        bodyComponent.example = {
          body_text: templateData.exampleBodyText // Ya viene como [ ["Juan", "015"] ]
        };
      }

      components.push(bodyComponent);

      // Header
      if (templateData.headerType !== 'NONE') {
        const headerParams: any = { type: 'HEADER', format: templateData.headerType };
        
        if (templateData.headerType === 'TEXT') {
          // Si es texto, le asignamos el texto
          headerParams.text = templateData.headerText;
        } else if (templateData.headerHandle) {
          // LA MAGIA: Si es imagen/video/documento, le asignamos el handle de Meta
          headerParams.example = { header_handle: [templateData.headerHandle] };
        }
        
        components.push(headerParams);
      }

      // Footer
      if (templateData.footerText?.trim()) {
        components.push({ type: 'FOOTER', text: templateData.footerText.trim() });
      }

      // Botones
      if (templateData.quickReplies && templateData.quickReplies.length > 0) {
        const buttons = templateData.quickReplies.map(texto => ({
          type: 'QUICK_REPLY',
          text: texto
        }));
        components.push({ type: 'BUTTONS', buttons });
      }

      // 3. ENVIAMOS A META
      const metaPayload = {
        name: templateData.name,
        language: templateData.language,
        category: templateData.category,
        components: components
      };
      
      // Descomenta esto cuando estés listo para hacer la petición real
      await this.metaService.registerTemplate(channel.wabaId, metaPayload, channel.access_token);

      let contenidoDelHeader = null;
      if (templateData.headerType === 'TEXT') {
        contenidoDelHeader = templateData.headerText;
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateData.headerType)) {
        contenidoDelHeader = templateData.publicMediaUrl; // La URL de DigitalOcean
      }

      // 4. GUARDAMOS EN NUESTRA BASE DE DATOS LOCAL
      // Aquí guardamos la versión amigable para que tu software la lea fácil después
      const newTemplate = new this.templateModel({
        internalApiKey: apiKey,
        name: templateData.name,
        language: templateData.language,
        category: templateData.category,
        status: 'PENDING',
        hasMedia: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateData.headerType),
        headerType: templateData.headerType,

        headerContent: contenidoDelHeader,
        
        // LA CLAVE: Guardamos el texto original "Hola {{name}}"
        bodyText: templateData.bodyText, 
        
        footerText: templateData.footerText,
        buttons: templateData.quickReplies || [],
        
        // Y guardamos el mapa para cuando hagamos el envío masivo saber el orden exacto
        bodyVariablesMapping: bodyVariablesMapping 
      });

      await newTemplate.save();
      return { success: true, message: 'Plantilla enviada a revisión', data: newTemplate };

    } catch (error) {
      this.logger.error('Error creando plantilla:', error);
      throw new BadRequestException('Error al registrar la plantilla en Meta');
    }
  }

  // ==========================================
  // 2. CREAR PLANTILLA MULTIMEDIA
  // ==========================================
  async createMediaTemplate(channel: any, file: any, templateData: any) {
    let finalBuffer = file.buffer;
    let finalMimeType = file.mimetype;
    let extension = file.originalname.split('.').pop().toLowerCase();
    
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');

    if (!isImage && !isVideo) {
      throw new BadRequestException({ ok: false, msg: 'Solo se permiten imágenes (JPEG/PNG) o videos (MP4).' });
    }

    // --- PASO 1: OPTIMIZACIÓN (Solo para imágenes) ---
    if (isImage) {
      try {
        finalBuffer = await sharp(file.buffer)
          .jpeg({ quality: 80, progressive: true }) // Comprimimos en JPEG como exige Meta
          .toBuffer();
        finalMimeType = 'image/jpeg';
        extension = 'jpeg';
      } catch (err) {
        throw new BadRequestException({ ok: false, msg: 'Error al procesar la imagen con Sharp.' });
      }
    }

    // --- PASO 2: SUBIR A DIGITAL OCEAN SPACES ---
    const fileName = `${crypto.randomUUID()}.${extension}`;
    // Estructura limpia: rifari-media/ID_DEL_CANAL/images/uuid.jpeg
    const folder = isImage ? 'images' : 'videos';
    const s3Key = `rifari-media/${channel._id}/${folder}/${fileName}`; 
    const bucketName = this.configService.get<string>('DO_SPACES_BUCKET'); // ej: 'rifari-bucket'

    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: finalBuffer,
        ACL: 'public-read', // Para que puedas usar la URL luego en los envíos
        ContentType: finalMimeType,
      }));
    } catch (err) {
      this.logger.error('Error subiendo a DigitalOcean:', err);
      throw new InternalServerErrorException({ ok: false, msg: 'Error guardando el archivo en la nube.' });
    }

    // La URL pública que guardaremos en base de datos para el envío masivo futuro
    const publicUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_REGION}.digitaloceanspaces.com/${s3Key}`;


    // --- PASO 3: SUBIR A META (Resumable API) PARA REVISIÓN ---
    const metaHandle = await this.uploadToMetaResumableAPI(channel.access_token, finalBuffer, finalMimeType, finalBuffer.length);


    // --- PASO 4: INYECTAR EL HANDLE Y CREAR LA PLANTILLA EN META ---    
    // Buscamos el componente HEADER en el array que nos mandó Angular
    templateData.headerHandle = metaHandle;
    templateData.publicMediaUrl = publicUrl;

    // Ahora sí, creamos la plantilla usando la misma función de texto
    const templateResponse = await this.createTemplate(channel.internalApiKey, templateData);

    // --- PASO 5: RETORNO MÁGICO ---
    return {
      ok: true,
      msg: 'Plantilla multimedia enviada a revisión',
      metaData: templateResponse.data,
      publicUrl: publicUrl 
    };
  }

  // ==========================================
  // HELPER: META RESUMABLE UPLOAD API
  // ==========================================
  private async uploadToMetaResumableAPI(accessToken: string, buffer: Buffer, mimeType: string, fileLength: number): Promise<string> {
    const API_VERSION = this.configService.get<string>('META_API_VERSION') || 'v25.0';
    const APP_ID = this.configService.get<string>('APP_ID_DEVELOPERS_META');

    // Fase A: Crear la sesión de subida
    const sessionUrl = `https://graph.facebook.com/${API_VERSION}/${APP_ID}/uploads?file_length=${fileLength}&file_type=${mimeType}`;
    
    let sessionId: string;
    try {
      const sessionRes = await fetch(sessionUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const sessionData = await sessionRes.json();
      
      if (sessionData.error) throw new Error(sessionData.error.message);
      sessionId = sessionData.id;
    } catch (err) {
      this.logger.error('Error creando sesión Resumable en Meta:', err);
      throw new InternalServerErrorException({ ok: false, msg: 'Error iniciando subida a Meta' });
    }

    // Fase B: Subir los bytes usando el Session ID
    const uploadUrl = `https://graph.facebook.com/${API_VERSION}/${sessionId}`;
    
    // LA SOLUCIÓN: Convertimos el Buffer de Node a un Blob estándar web
    const fileBlob = new Blob([new Uint8Array(buffer)], { type: mimeType });

    try {
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `OAuth ${accessToken}`,
          'file_offset': '0'
          // Nota: fetch calculará el Content-Length automáticamente gracias al Blob
        },
        body: fileBlob // <-- Enviamos el Blob, no el Buffer crudo
      });
      
      const uploadData = await uploadRes.json();
      
      if (uploadData.error) throw new Error(uploadData.error.message);
      
      // Retornamos el famoso "handle" (ej: 4:W21hc...)
      return uploadData.h; 
      
    } catch (err) {
      this.logger.error('Error transfiriendo bytes a Meta:', err);
      throw new InternalServerErrorException({ ok: false, msg: 'Error transfiriendo archivo a Meta' });
    }
  }

  // ==========================================
  // 2. SINCRONIZAR (Actualizar estados desde Meta)
  // ==========================================
  async syncTemplates(apiKey: string) {
    // 1. Buscamos el canal para obtener el WABA ID
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    try {
      // 2. Traemos TODAS las plantillas directamente desde Meta
      // (Asumiendo que tienes un método getTemplates en tu meta.service)
      const metaResponse = await this.metaService.getTemplates(channel.wabaId, channel.access_token);
      
      const metaTemplates = metaResponse; // Array de plantillas de Facebook

      // 3. Traemos nuestras plantillas locales de Mongo
      const localTemplates = await this.templateModel.find({ internalApiKey: apiKey });

      let plantillasModificadas = 0;

      // 4. Comparamos una por una
      for (const metaTpl of metaTemplates) {
        // Buscamos si tenemos esta plantilla guardada (coincidiendo nombre e idioma)
        const localTpl = localTemplates.find(
          t => t.name === metaTpl.name && t.language === metaTpl.language
        );

        if (localTpl) {
          let necesitaActualizacion = false;
          const cambios: any = {};

          // A. ¿Cambió el estado? (ej: de PENDING a APPROVED)
          if (localTpl.status !== metaTpl.status) {
            cambios.status = metaTpl.status;
            necesitaActualizacion = true;
          }

          // B. LA MAGIA: ¿Meta nos cambió la categoría?
          if (localTpl.category !== metaTpl.category) {
            cambios.category = metaTpl.category;
            necesitaActualizacion = true;
            this.logger.log(`Categoría actualizada para ${metaTpl.name}: ${localTpl.category} -> ${metaTpl.category}`);
          }

          // Si detectamos algún cambio, actualizamos en Mongo
          if (necesitaActualizacion) {
            await this.templateModel.updateOne(
              { _id: localTpl._id },
              { $set: cambios }
            );
            plantillasModificadas++;
          }
        } 
        // Nota: Si quieres que las plantillas creadas directamente en el Business Manager 
        // de Facebook también se guarden en Rifari, podrías agregar un 'else' aquí 
        // para hacer un 'new this.templateModel(...).save()'.
      }

      return { 
        success: true, 
        message: 'Sincronización completada', 
        actualizadas: plantillasModificadas 
      };

    } catch (error) {
      this.logger.error('Error en la sincronización de plantillas:', error);
      throw new BadRequestException('No se pudo sincronizar con Meta');
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

  // ==========================================
  // 6. ACTIVAR O DESACTIVAR PLANTILLAS
  // ==========================================
  async toggleTemplateActive(apiKey: string, templateId: string, isActive: boolean) {
    try {
      // Usamos el apiKey en el filtro por seguridad, así nadie edita plantillas de otros
      const updatedTemplate = await this.templateModel.findOneAndUpdate(
        { _id: templateId, internalApiKey: apiKey },
        { $set: { active: isActive } },
        { new: true }
      );

      if (!updatedTemplate) {
        throw new NotFoundException('Plantilla no encontrada o no autorizada');
      }

      return { success: true, active: updatedTemplate.active };
    } catch (error) {
      this.logger.error('Error cambiando estado de plantilla:', error);
      throw new BadRequestException('No se pudo actualizar el estado');
    }
  }
}