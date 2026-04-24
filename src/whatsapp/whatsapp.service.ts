import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from './schemas/channel.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  constructor(
    @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>,
    private configService: ConfigService
  ) {}

  async createChannel(channelData: any) {
    return await this.channelModel.findOneAndUpdate(
      { phoneNumberId: channelData.phoneNumberId }, 
      channelData, 
      { new: true, upsert: true }
    );
  }

  async exchangeCodeForToken(codeFromAngular: string, wabaId: string, phoneNumberId: string) {
    try {

      const APP_ID = this.configService.get<string>('APP_ID_DEVELOPERS_META');
      const APP_SECRET = this.configService.get<string>('KEY_SECRET_DEVELOPERS_META');
      const API_VERSION = this.configService.get<string>('VERSION');

      // 1. Armamos la URL oficial de Meta para el intercambio
      const url = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`;

      // 2. Preparamos los datos
      const params = new URLSearchParams({
        client_id: APP_ID as string,
        client_secret: APP_SECRET as string,
        code: codeFromAngular
      });

      console.log('Enviando código a Meta para canjear...');

      // 3. Hacemos la petición a Meta
      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'GET', // Meta recomienda GET para este endpoint específico
      });

      const data = await response.json();

      if (data.error) {
        console.error('Error de Meta:', data.error);
        throw new Error(data.error.message);
      }

      // ¡AQUÍ ESTÁ EL ORO!
      const permanentAccessToken = data.access_token;
      
      console.log('¡Éxito! Token permanente obtenido:', permanentAccessToken);

      // Fase 3: Aquí agregaríamos el código para guardar este token 
      // en MongoDB vinculado al usuario de Rifari.
      const channel = await this.createChannel({
        phoneNumberId: phoneNumberId,
        wabaId: wabaId,
        internalApiKey: permanentAccessToken,
        access_token: permanentAccessToken,
      });
      
      return channel;

    } catch (error) {
      console.error('Falló el intercambio de tokens:', error);
      throw new InternalServerErrorException('No se pudo validar el código de WhatsApp');
    }
  }

}