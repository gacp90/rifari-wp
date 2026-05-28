import { Injectable, Logger, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';

// Importamos tus 3 esquemas fundamentales
import { Channel, ChannelDocument } from '../whatsapp/schemas/channel.schema';
import { Message, MessageDocument } from '../whatsapp/schemas/message.schema';
import { Conversation } from './schemas/conversation.schema';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import * as crypto from 'crypto'; // Faltaba importar crypto
import sharp from 'sharp'; // Agregamos sharp para las imágenes del chat
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private s3Client!: S3Client;

  constructor(
    private configService: ConfigService,
    @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>, // Faltaba inyectar el Canal
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(Conversation.name) private conversationModel: Model<Conversation>,
  ) {
    this.s3Client = new S3Client({
      region: process.env.DO_SPACES_REGION || 'nyc3',
      endpoint: process.env.DO_SPACES_ENDPOINT,
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY || '',
        secretAccessKey: process.env.DO_SPACES_SECRET || '',
      }
    });
  }

  // ==========================================
  // 1. BANDEJA DE ENTRADA (Chats Activos 24h)
  // ==========================================
  async getChatList(internalApiKey: string) {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    return await this.conversationModel
      .find({
        internalApiKey: internalApiKey,
        lastInboundDate: { $gte: twentyFourHoursAgo }
      })
      .sort({ 'lastMessage.createdAt': -1 })
      .exec();
  }

  // ==========================================
  // 2. HISTORIAL DE UN CHAT
  // ==========================================
  async getMessagesByCustomer(internalApiKey: string, customerPhone: string, limit = 50) {
    return await this.messageModel
      .find({
        internalApiKey: internalApiKey,
        $or: [{ from: customerPhone }, { to: customerPhone }]
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  // ==========================================
  // 3. ENVÍO DE MULTIMEDIA Y NOTAS DE VOZ
  // ==========================================
  async processAndSendMedia(internalApiKey: string, to: string, file: Express.Multer.File) {
    // 1. TRAER EL CANAL PARA OBTENER TOKENS REALES
    const channel = await this.channelModel.findOne({ internalApiKey });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    let finalBuffer = file.buffer;
    let finalMimeType = file.mimetype;
    let extension = file.originalname.split('.').pop()?.toLowerCase() || 'bin';
    let metaType = this.getMetaType(finalMimeType);

    // 2. OPTIMIZACIÓN SEGÚN EL TIPO (Igual que en tus Templates)
    if (metaType === 'image') {
      try {
        finalBuffer = await sharp(file.buffer).jpeg({ quality: 80 }).toBuffer();
        finalMimeType = 'image/jpeg';
        extension = 'jpeg';
      } catch (err) {
        throw new BadRequestException('Error al comprimir la imagen');
      }
    } else if (metaType === 'audio') {
      this.logger.log(`Convirtiendo nota de voz a OGG Opus...`);
      finalBuffer = await this.convertToWhatsAppAudio(file.buffer);
      finalMimeType = 'audio/ogg';
      extension = 'ogg';
    }

    // 3. SUBIR A DIGITAL OCEAN
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const s3Key = `rifari-chat/${channel._id}/${metaType}s/${fileName}`;
    const bucketName = this.configService.get<string>('DO_SPACES_BUCKET') || 'rifari-bucket';

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          Body: finalBuffer,
          ContentType: finalMimeType,
          ACL: 'public-read',
        })
      );
    } catch (err) {
      this.logger.error('Error subiendo a DO Spaces:', err);
      throw new InternalServerErrorException('Error guardando el archivo en la nube');
    }

    const publicUrl = `https://${bucketName}.${process.env.DO_SPACES_REGION}.digitaloceanspaces.com/${s3Key}`;

    // 4. PREPARAR Y ENVIAR A META
    const metaPayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: metaType,
    };

    if (metaType === 'image') metaPayload.image = { link: publicUrl };
    else if (metaType === 'audio') metaPayload.audio = { link: publicUrl };
    else if (metaType === 'video') metaPayload.video = { link: publicUrl };
    else metaPayload.document = { link: publicUrl, filename: file.originalname };

    let wamid = '';
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v25.0/${channel.phoneNumberId}/messages`,
        metaPayload,
        { headers: { Authorization: `Bearer ${channel.access_token}` } }
      );
      wamid = response.data.messages[0].id;
    } catch (error: any) {
      this.logger.error('Error de Meta API:', error.response?.data || error.message);
      throw new BadRequestException('WhatsApp rechazó el archivo multimedia');
    }

    // 5. ACTUALIZAR BASE DE DATOS (Nuestra lógica dual de chat)
    const messageData = {
      internalApiKey: channel.internalApiKey,
      channelId: channel._id,
      wamid: wamid,
      from: channel.displayPhoneNumber, // Sale de nosotros
      to: to, // Va al cliente
      direction: 'outbound',
      type: metaType,
      content: {
        fileName: publicUrl, // Para que el frontend lo pinte al instante
        caption: file.originalname
      },
      status: 'sent',
    };

    // A. Guardamos el mensaje histórico
    await this.messageModel.updateOne(
      { wamid: wamid },
      { $setOnInsert: messageData },
      { upsert: true }
    );

    // B. Actualizamos la Conversación (Bandeja de Entrada)
    let textoResumen = `📁 Archivo adjunto`;
    if (metaType === 'audio') textoResumen = '🎤 Nota de voz';
    if (metaType === 'image') textoResumen = '🖼️ Imagen';

    await this.conversationModel.updateOne(
      { internalApiKey: channel.internalApiKey, customerPhone: to },
      {
        $set: {
          channelId: channel._id,
          lastMessage: {
            wamid: wamid,
            text: textoResumen,
            type: metaType,
            direction: 'outbound',
            createdAt: new Date(),
          },
        },
      },
      { upsert: true }
    );

    return messageData;
  }

  // ==========================================
  // UTILIDADES
  // ==========================================
  private getMetaType(mimeType: string): string {
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('audio') || mimeType.includes('video/webm')) return 'audio';
    if (mimeType.includes('video')) return 'video';
    return 'document';
  }

  private async convertToWhatsAppAudio(inputBuffer: Buffer): Promise<Buffer> {
    const tempInputPath = path.join(os.tmpdir(), `input_${Date.now()}.webm`);
    const tempOutputPath = path.join(os.tmpdir(), `output_${Date.now()}.ogg`);

    await fs.writeFile(tempInputPath, inputBuffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .toFormat('ogg')
        .audioCodec('libopus')
        .on('error', async (err) => {
          await this.cleanUpTempFiles([tempInputPath, tempOutputPath]);
          reject(new Error(`Error en FFmpeg: ${err.message}`));
        })
        .on('end', async () => {
          try {
            const outputBuffer = await fs.readFile(tempOutputPath);
            await this.cleanUpTempFiles([tempInputPath, tempOutputPath]);
            resolve(outputBuffer);
          } catch (e) {
            reject(e);
          }
        })
        .save(tempOutputPath);
    });
  }

  private async cleanUpTempFiles(files: string[]) {
    for (const file of files) {
      try {
        await fs.unlink(file);
      } catch (e) {}
    }
  }
}