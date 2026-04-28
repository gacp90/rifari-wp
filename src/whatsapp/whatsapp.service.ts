import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
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

  async exchangeCodeForToken(codeFromAngular: string, wabaId: string, phoneNumberId: string, business_id: string) {
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

      const infoUrl = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}?fields=display_phone_number,messaging_limit_tier`;
      const infoResponse = await fetch(infoUrl, {
        headers: { 'Authorization': `Bearer ${permanentAccessToken}` }
      });
      const infoData = await infoResponse.json();

      let limiteNumerico = 250; // Por defecto
      if (infoData.messaging_limit_tier) {
          if (infoData.messaging_limit_tier === 'TIER_1K') limiteNumerico = 1000;
          if (infoData.messaging_limit_tier === 'TIER_10K') limiteNumerico = 10000;
          if (infoData.messaging_limit_tier === 'TIER_100K') limiteNumerico = 100000;
          if (infoData.messaging_limit_tier === 'UNLIMITED') limiteNumerico = 9999999;
      }

      // Fase 3: Aquí agregaríamos el código para guardar este token 
      // en MongoDB vinculado al usuario de Rifari.
      const channel = await this.createChannel({
        wabaId: wabaId,
        internalApiKey: permanentAccessToken,
        access_token: permanentAccessToken,
        displayPhoneNumber: infoData.display_phone_number || 'Número Pendiente',
        messagingLimit: limiteNumerico,
        dailyMessagesSent: 0,
        lastMessageDate: new Date(),
        phoneNumberId: phoneNumberId,
        business_id: business_id,
        metaStatus: infoData.status
      });
      
      return channel;

    } catch (error) {
      console.error('Falló el intercambio de tokens:', error);
      throw new InternalServerErrorException('No se pudo validar el código de WhatsApp');
    }
  }

  async getChannelHealth(apiKey: string) {
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) throw new UnauthorizedException('Canal no encontrado');

    const API_VERSION = this.configService.get<string>('VERSION') || 'v25.0';
    
    // Pedimos los datos vitales a Meta
    const url = `https://graph.facebook.com/${API_VERSION}/${channel.phoneNumberId}?fields=quality_rating,messaging_limit_tier,status,display_phone_number`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${channel.access_token}`
        }
      });

      const metaData = await response.json();

      if (metaData.error) throw new Error(metaData.error.message);

      // --- 1. LÓGICA DE SINCRONIZACIÓN ---
      
      // Convertimos el TIER a número (reutilizamos tu lógica)
      let limiteNumerico = 250;
      if (metaData.messaging_limit_tier) {
          if (metaData.messaging_limit_tier === 'TIER_1K') limiteNumerico = 1000;
          if (metaData.messaging_limit_tier === 'TIER_10K') limiteNumerico = 10000;
          if (metaData.messaging_limit_tier === 'TIER_100K') limiteNumerico = 100000;
          if (metaData.messaging_limit_tier === 'UNLIMITED') limiteNumerico = 9999999;
      }

      // Evaluamos el estado para activar/desactivar el canal
      // Meta usa estos estados: CONNECTED, PENDING, OFFLINE, FLAGGED, RESTRICTED, DISCONNECTED
      const estaActivo = ['CONNECTED', 'FLAGGED'].includes(metaData.status);
      const numeroActualizado = metaData.display_phone_number || channel.displayPhoneNumber;
      const nuevoMetaStatus = metaData.status;

      // Actualización atómica y silenciosa en la base de datos
      const requiereActualizacion = 
        channel.messagingLimit !== limiteNumerico ||
        channel.isActive !== estaActivo ||
        channel.displayPhoneNumber !== numeroActualizado ||
        channel.metaStatus !== nuevoMetaStatus;

      // Solo tocamos la base de datos si Meta reporta algo distinto a lo que ya tenemos
      if (requiereActualizacion) {
          await this.channelModel.updateOne(
            { _id: channel._id },
            { 
                $set: { 
                    messagingLimit: limiteNumerico,
                    isActive: estaActivo,
                    displayPhoneNumber: numeroActualizado ,
                    metaStatus: nuevoMetaStatus
                } 
            }
          );
          console.log(`[Sync] Canal ${channel.phoneNumberId} actualizado en BD por cambios en Meta.`);
      }

      // --- 2. RETORNO AL FRONTEND ---
      return {
        success: true,
        data: {
          creditosRifari: channel.amount,
          telefono: metaData.display_phone_number || channel.displayPhoneNumber,
          estadoLinea: metaData.status, 
          calidad: metaData.quality_rating, 
          limiteDiario: metaData.messaging_limit_tier 
        }
      };

    } catch (error) {
      console.error('Error al sincronizar estado de Meta:', error);
      throw new InternalServerErrorException('No se pudo obtener el estado de Meta');
    }
  }

}