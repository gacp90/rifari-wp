import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Channel, ChannelDocument } from '../whatsapp/schemas/channel.schema';
import { Message, MessageDocument } from '../whatsapp/schemas/message.schema';
import { MetaService } from '../meta/meta.service';
import { ChatGateway } from 'src/chat/chat.gateway';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private readonly metaService: MetaService, 
    private readonly chatGateway: ChatGateway,
  ) {}

  async processIncomingData(body: any) {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0]?.value;
      
      if (!changes) return;

      const destinationPhoneId = changes.metadata?.phone_number_id;
      const channel = await this.channelModel.findOne({ phoneNumberId: destinationPhoneId });
      
      if (!channel) {
        this.logger.warn(`Mensaje recibido para el número ${destinationPhoneId}, pero no está registrado.`);
        return;
      }

      if (changes.messages) {
        const msg = changes.messages[0];
        await this.saveIncomingMessage(channel, msg);
      } else if (changes.statuses) {
        const statusMsg = changes.statuses[0];
        await this.updateMessageStatus(statusMsg);
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
        
        const url = await this.metaService.getMediaUrl(extracted.mediaId);
        // downloadMedia ahora nos devuelve solo el nombre (según el cambio anterior)
        savedFileName = await this.metaService.downloadMedia(url, fileName);
        
        this.logger.log(`📁 Archivo descargado exitosamente: ${savedFileName}`);
      } catch (error) {
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