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

      const infoUrl = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}?fields=display_phone_number,whatsapp_business_manager_messaging_limit,verified_name`;
      const infoResponse = await fetch(infoUrl, {
        headers: { 'Authorization': `Bearer ${permanentAccessToken}` }
      });
      const infoData = await infoResponse.json();

      let limiteNumerico = 250; // Por defecto
      if (infoData.whatsapp_business_manager_messaging_limit) {
          if (infoData.whatsapp_business_manager_messaging_limit === 'TIER_1K') limiteNumerico = 1000;
          if (infoData.whatsapp_business_manager_messaging_limit === 'TIER_2K') limiteNumerico = 2000;
          if (infoData.whatsapp_business_manager_messaging_limit === 'TIER_10K') limiteNumerico = 10000;
          if (infoData.whatsapp_business_manager_messaging_limit === 'TIER_100K') limiteNumerico = 100000;
          if (infoData.whatsapp_business_manager_messaging_limit === 'UNLIMITED') limiteNumerico = 9999999;
      }

      // Fase 3: Aquí agregaríamos el código para guardar este token 
      // en MongoDB vinculado al usuario de Rifari.
      const channel = await this.createChannel({
        wabaId: wabaId,
        internalApiKey: permanentAccessToken,
        access_token: permanentAccessToken,
        displayPhoneNumber: infoData.display_phone_number || 'Número Pendiente',
        messagingLimit: limiteNumerico,
        verified_name: infoData.verified_name || 'Nombre Pendiente',
        dailyMessagesSent: 0,
        lastMessageDate: new Date(),
        phoneNumberId: phoneNumberId,
        business_id: business_id,
        metaStatus: infoData.status
      });
      
      return channel;

    } catch (error) {
      console.error('Falló el intercambio de tokens:', error);
      throw new InternalServerErrorException({ok: false, msg:'No se pudo validar el código de WhatsApp'});
    }
  }

  async getChannelHealth(apiKey: string) {
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) throw new UnauthorizedException('Canal no encontrado');

    const API_VERSION = this.configService.get<string>('VERSION') || 'v25.0';
    
    // Pedimos los datos vitales a Meta
    const url = `https://graph.facebook.com/${API_VERSION}/${channel.phoneNumberId}?fields=quality_rating,whatsapp_business_manager_messaging_limit,status,display_phone_number,verified_name`;

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
      // Tomamos el límite que ya existe en la base de datos (por defecto 250 si es nuevo, o el manual si se modificó)
      
      let limiteNumerico = channel.messagingLimit; 
      let limiteDiarioString = metaData.whatsapp_business_manager_messaging_limit || 'TIER_250'; // Valor original de Meta o fallback

      // Solo si Meta envía explícitamente el dato, actualizamos nuestra variable
      if (metaData.whatsapp_business_manager_messaging_limit) {
          if (metaData.whatsapp_business_manager_messaging_limit === 'TIER_250') limiteNumerico = 250;
          if (metaData.whatsapp_business_manager_messaging_limit === 'TIER_1K') limiteNumerico = 1000;
          if (metaData.whatsapp_business_manager_messaging_limit === 'TIER_2K') limiteNumerico = 2000;
          if (metaData.whatsapp_business_manager_messaging_limit === 'TIER_10K') limiteNumerico = 10000;
          if (metaData.whatsapp_business_manager_messaging_limit === 'TIER_100K') limiteNumerico = 100000;
          if (metaData.whatsapp_business_manager_messaging_limit === 'UNLIMITED') limiteNumerico = 9999999;
      } else {
          // Si Meta no lo envía, reconstruimos el texto para el frontend basados en nuestra BD
          if (limiteNumerico === 250) limiteDiarioString = 'TIER_250';
          else if (limiteNumerico === 1000) limiteDiarioString = 'TIER_1K';
          else if (limiteNumerico === 2000) limiteDiarioString = 'TIER_2K';
          else if (limiteNumerico === 10000) limiteDiarioString = 'TIER_10K';
          else if (limiteNumerico === 100000) limiteDiarioString = 'TIER_100K';
          else if (limiteNumerico >= 9999999) limiteDiarioString = 'UNLIMITED';
          else limiteDiarioString = 'TIER_250'; // Fallback por seguridad
      }

      // Evaluamos el estado para activar/desactivar el canal
      const estaActivo = ['CONNECTED', 'FLAGGED'].includes(metaData.status);
      const numeroActualizado = metaData.display_phone_number || channel.displayPhoneNumber;
      const nuevoMetaStatus = metaData.status;

      // Actualización atómica y silenciosa en la base de datos
      const requiereActualizacion = 
        channel.messagingLimit !== limiteNumerico ||
        channel.isActive !== estaActivo ||
        channel.displayPhoneNumber !== numeroActualizado ||
        channel.metaStatus !== nuevoMetaStatus;

      // Solo tocamos la base de datos si algo cambió respecto a lo que tenemos
      if (requiereActualizacion) {
          await this.channelModel.updateOne(
            { _id: channel._id },
            { 
                $set: { 
                    messagingLimit: limiteNumerico,
                    isActive: estaActivo,
                    displayPhoneNumber: numeroActualizado ,
                    metaStatus: nuevoMetaStatus,
                    verified_name: metaData.verified_name || 'Nombre Pendiente',
                } 
            }
          );
          console.log(`[Sync] Canal ${channel.phoneNumberId} actualizado en BD. Límite numérico: ${limiteNumerico}`);
      }

      // --- 2. RETORNO AL FRONTEND ---
      return {
        success: true,
        data: {
          creditosRifari: channel.amount,
          telefono: numeroActualizado,
          estadoLinea: metaData.status, 
          calidad: metaData.quality_rating || 'UNKNOWN', 
          limiteDiario: limiteDiarioString, // Enviamos el string reconstruido o el original de Meta
          verified_name: metaData.verified_name || 'Nombre Pendiente',
        }
      };

    } catch (error) {
      console.error('Error al sincronizar estado de Meta:', error);
      throw new InternalServerErrorException({ok: false, msg:'No se pudo obtener el estado de Meta'});
    }
}

}