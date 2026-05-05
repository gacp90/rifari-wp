import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { CreateSpidiDto } from './dto/create-spidi.dto';
import { UpdateSpidiDto } from './dto/update-spidi.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TransactionDocument } from './schema/transaction.schema';
import { ChannelDocument } from 'src/whatsapp/schemas/channel.schema';
import { ChatGateway } from 'src/chat/chat.gateway';

@Injectable()
export class SpidiService {
  
  private readonly logger = new Logger(SpidiService.name);

  constructor(
    @InjectModel('Transaction') private transactionModel: Model<TransactionDocument>,
    @InjectModel('Channel') private channelModel: Model<ChannelDocument>,
    private chatGateway: ChatGateway,
  ) {}

  // --- 1. AUTENTICACIÓN INTERNA CON SPIDI ---
  private async getSpidiToken(): Promise<string> {
    try {
      const response = await fetch(`${process.env.SPIDI_API_URL}/spidipagos/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          "short_name": process.env.SPIDI_SHORT_NAME,
          "password": process.env.SPIDI_PASSWORD
        })
      });
      
      const data = await response.json();

      
      if (!data.token) throw new Error('Credenciales inválidas');
      return data.token; 
    } catch (error) {
      this.logger.error('Error obteniendo token de Spidi', error);
      throw new InternalServerErrorException({ok: false, msg:'Error conectando con la pasarela'});
    }
  }

  // Función 1: Crea la intención de pago cuando Angular lo solicita
  async generateCheckoutLink(apiKey: string, creditosComprados: number, link: string, usuario: string) {
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    const token = await this.getSpidiToken();

    // Aquí haces el fetch a la API de Spidi para crear el link
    const spidiBody = {
      agreement_id: process.env.SPIDI_AGREEMENT_ID,
      amount_reference: creditosComprados, 
      currency_reference: "USDT", 
      identifier_label: usuario,
      identifier: usuario,
      description: `Recarga de creditos por ${creditosComprados}`,
      success_url: `${link}/pagos?status=exito`,
      failure_url: `${link}/pagos?status=fallido`,
      webhook_url: `${process.env.APP_PUBLIC_URL}/api/v1/spidi/webhook`
    };

    try {
      const response = await fetch(`${process.env.SPIDI_API_URL}/v1/ext/payment-sessions/buttons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(spidiBody)
      });
      
      const data = await response.json();
      if (!data.success) throw new Error(data.message);      

      // Guardamos el session_id de Spidi en nuestro PAYMENT para rastrearlo
      await new this.transactionModel({
        channelId: channel._id,
        internalApiKey: apiKey,
        externalReference: data.data.session_id,
        amount: creditosComprados,
        status: 'pending',
      }).save();

      return { ok: true, url: data.data.payment_url };


    } catch (error) {
      this.logger.error('Error creando sesión en Spidi', error);
      throw new InternalServerErrorException('No se pudo generar el link de pago');
    }

    
  }

  // Función 2: Procesa el Webhook cuando el cliente ya pagó
  async processSpidiWebhook(payload: any) {
    try {
      // 1. Leemos el formato EXACTO de la API de Spidi
      const eventType = payload.event;
      const sessionId = payload.data?.session_payment?.id;

      if (!sessionId) {
        this.logger.warn('Webhook recibido sin ID de sesión de Spidi');
        return { received: true }; 
      }

      const transaction = await this.transactionModel.findOne({ externalReference: sessionId });
      
      if (!transaction || transaction.status === 'completed') {
        return { received: true }; // Evitamos procesar pagos duplicados o no encontrados
      }

      // 2. Evaluamos según el EVENTO real de Spidi
      if (eventType === 'payment_session.paid') {
        
        // Actualizamos la transacción a completada
        transaction.status = 'completed';
        transaction.spidiRawData = payload;
        await transaction.save();

        // Le sumamos los créditos al cliente usando $inc
        const updatedChannel = await this.channelModel.findOneAndUpdate(
          { _id: transaction.channelId },
          { $inc: { amount: transaction.amount } }, 
          { new: true }
        );
        
        if (!updatedChannel) {
            this.logger.error(`ALERTA: Se recibió pago de Spidi pero el canal ${transaction.channelId} ya no existe en la BD.`);
            return { ok: true, warning: 'Canal no encontrado para asignar saldo' };
        }

        // Emitimos evento por WebSocket para que Angular actualice la UI al instante
        this.chatGateway.server.to(transaction.internalApiKey).emit('balanceUpdated', {
          nuevoSaldo: updatedChannel.amount,
          mensaje: '¡Recarga exitosa!'
        });

        this.logger.log(`✅ Recarga de ${transaction.amount} créditos aplicada al canal ${transaction.internalApiKey}`);
      
      } else if (eventType === 'payment_session.accreditation_to_recipient_failed' || eventType === 'payment_session.expired') {
        // El pago falló o el link de pago expiró sin que el cliente pagara
        transaction.status = 'failed';
        await transaction.save();
        this.logger.warn(`❌ Transacción fallida o expirada para sessionId: ${sessionId}`);
      }

      return { ok: true };
    } catch (error) {
      this.logger.error('Error procesando webhook de Spidi', error);
      throw error;
    }
  }

  async getPaymentHistory(apiKey: string) {
    try {
      const history = await this.transactionModel
        .find({ internalApiKey: apiKey })
        .sort({ createdAt: -1 }) // Orden descendente: lo más nuevo primero
        .select('-spidiRawData') // Excluimos el payload gigante de Spidi para ahorrar ancho de banda
        .limit(50); // Límite de seguridad para no saturar la red (opcional)

      return {
        ok: true,
        data: history
      };
    } catch (error) {
      this.logger.error(`Error obteniendo historial para apiKey: ${apiKey}`, error);
      throw new InternalServerErrorException({ 
        ok: false, 
        msg: 'Error al consultar el historial de pagos' 
      });
    }
  }

}
