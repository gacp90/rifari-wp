import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Channel, ChannelDocument } from '../whatsapp/schemas/channel.schema';
import { Message, MessageDocument } from '../whatsapp/schemas/message.schema';
import { MetaService } from '../meta/meta.service';
import { ChatGateway } from 'src/chat/chat.gateway';
import { Template, TemplateDocument } from 'src/templates/schemas/template.schema';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(Template.name) private templateModel: Model<TemplateDocument>,
    private readonly metaService: MetaService, 
    private readonly chatGateway: ChatGateway,
  ) {}

  async processIncomingData(body: any) {
    try {
      
      // Validamos que sea un evento de WhatsApp
      if (body.object !== 'whatsapp_business_account') return;

      const entry = body.entry?.[0];
      if (!entry) return;

      // Extraemos el WABA ID y el objeto del cambio
      const wabaId = entry.id; 
      const changeObject = entry.changes?.[0]; 
      
      if (!changeObject) return;

      const field = changeObject.field; // Aquí Meta nos dice qué está enviando
      const value = changeObject.value; // Aquí vienen los datos reales

      // ====================================================
      // 1. RUTA DE PLANTILLAS (Template Status Update)
      // ====================================================
      if (field === 'message_template_status_update') {
        const templateName = value.message_template_name;
        const language = value.message_template_language;
        const newStatus = value.event; // 'APPROVED', 'REJECTED', 'PENDING'

        this.logger.log(`[Webhook] La plantilla '${templateName}' cambió a estado: ${newStatus}`);

        // Buscamos el canal usando el WABA ID (porque las plantillas son de la cuenta)
        const channel = await this.channelModel.findOne({ wabaId: wabaId });

        if (channel) {
          // Actualizamos en la base de datos
          await this.templateModel.updateOne(
            { internalApiKey: channel.internalApiKey, name: templateName, language: language },
            { $set: { status: newStatus } }
          );
          this.logger.log(`[Webhook] Estado de plantilla actualizado en BD.`);
        } else {
          this.logger.warn(`[Webhook] No se encontró canal para el WABA ID: ${wabaId}`);
        }
        
        return; // Terminamos aquí para no ejecutar la lógica de mensajes
      }

      // ====================================================
      // 2. RUTA DE MENSAJES (Tu lógica original intacta)
      // ====================================================
      if (field === 'messages') {
        const destinationPhoneId = value.metadata?.phone_number_id;
        const channel = await this.channelModel.findOne({ phoneNumberId: destinationPhoneId });
        
        if (!channel) {
          this.logger.warn(`Mensaje recibido para el número ${destinationPhoneId}, pero no está registrado.`);
          return;
        }

        if (value.messages && value.messages.length > 0) {
          // Extraemos el objeto del mensaje sin importar si es texto, imagen o botón
          const msg = value.messages[0]; 
          await this.saveIncomingMessage(channel, msg);
          
        } else if (value.statuses && value.statuses.length > 0) {
          const statusMsg = value.statuses[0];
          await this.updateMessageStatus(statusMsg);
        }
      }

    } catch (error) {
      this.logger.error('Error procesando el payload de Meta', error);
    }
  }

  private async saveIncomingMessage(channel: ChannelDocument, msg: any) {
    const extracted = this.extractMessageContent(msg);
    
    // 1. Declaramos la variable fuera del IF para que tenga alcance global en la función
    let savedFileName: string | null = null; 

    if (extracted.mediaId) {
      try {
        const extension = this.getExtensions(extracted.mimeType);
        // Generamos el nombre
        const fileName = `${extracted.mediaId}${extension}`;
        
        const url = await this.metaService.getMediaUrl(extracted.mediaId, channel.access_token);
        // downloadMedia ahora nos devuelve solo el nombre (según el cambio anterior)
        savedFileName = await this.metaService.downloadMedia(url, fileName, channel.access_token);
        
        this.logger.log(`📁 Archivo descargado exitosamente: ${savedFileName}`);
      } catch (error: any) {
        this.logger.error(`Error descargando media: ${error.message}`);
      }
    }

    const newMessage = new this.messageModel({
      internalApiKey: channel.internalApiKey,
      channelId: channel._id,
      wamid: msg.id,
      from: msg.from,
      to: channel.displayPhoneNumber,
      direction: 'inbound',
      type: msg.type,
      content: {
        ...extracted,
        fileName: savedFileName 
      },
      status: 'received',
    });

    const savedMsg = await newMessage.save();
    this.chatGateway.emitNewMessage(channel.internalApiKey, {
      message: savedMsg,
      customer: msg.from
    });
    this.logger.log(`✅ Mensaje [${msg.type}] de ${msg.from} guardado.`);
  }

  private async updateMessageStatus(statusMsg: any) {
    await this.messageModel.findOneAndUpdate(
      { wamid: statusMsg.id },
      { status: statusMsg.status }
    );
    this.logger.debug(`📊 Estado actualizado: ${statusMsg.id} -> ${statusMsg.status}`);
  }

  // Tu función mejorada para detectar mediaId
  private extractMessageContent(msg: any): Record<string, any> {
    if (msg.type === 'text') {
      return { text: msg.text.body };
    }
    
    // 2. Mensajes de botones de respuesta rápida (El que falló)
    if (msg.type === 'button') {
      return { 
        text: msg.button.text,       // Extraemos "Quiero saber mas..."
        payload: msg.button.payload  // Por si mandas IDs ocultos en el botón
      };
    }

    if (msg.type === 'interactive') {
      const interactiveType = msg.interactive.type; // 'list_reply' o 'button_reply'
      const replyObj = msg.interactive[interactiveType];
      return { 
        text: replyObj.title || replyObj.id || 'Selección interactiva', 
        payload: replyObj.id 
      };
    }
    
    // Si es imagen, audio, video o documento
    const mediaTypes = ['image', 'audio', 'video', 'document', 'voice', 'sticker'];
    if (mediaTypes.includes(msg.type)) {
      const mediaData = msg[msg.type];
      return {
        mediaId: mediaData.id,
        mimeType: mediaData.mime_type,
        text: mediaData.caption || '', // Capturamos el texto si mandan foto con descripción
      };
    }
    
    return { raw: 'Tipo de mensaje no soportado' };
  }

  // Helper para las extensiones
  private getExtensions(mimeType: string): string {
    const types: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'audio/ogg; codecs=opus': '.ogg',
      'audio/mpeg': '.mp3',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf'
    };
    return types[mimeType] || '.bin';
  }
}